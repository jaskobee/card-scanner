// Job queue. See CLAUDE.md §2.5 and §4.
// One item, one job. A failure fails alone. State survives a refresh.

export const JOB = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export class JobQueue extends EventTarget {
  /**
   * @param {object} opts
   * @param {number} [opts.concurrency] tuned to the politest dependency, not the CPU
   * @param {number} [opts.maxAttempts]
   * @param {number} [opts.breakerThreshold] consecutive failures before pausing
   * @param {(job:object)=>Promise<*>} opts.worker
   */
  constructor({ concurrency = 4, maxAttempts = 3, breakerThreshold = 8, worker, onPersist } = {}) {
    super();
    this.concurrency = concurrency;
    this.maxAttempts = maxAttempts;
    this.breakerThreshold = breakerThreshold;
    this.worker = worker;
    this.onPersist = onPersist;

    this.jobs = new Map();
    this.running = new Set();
    this.paused = false;
    this.cancelled = false;
    this.consecutiveFailures = 0;
    this.breakerOpen = false;
    this.completionTimes = [];
  }

  add(id, payload) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    const job = { id, payload, state: JOB.QUEUED, attempts: 0, error: null, result: null, startedAt: null, finishedAt: null };
    this.jobs.set(id, job);
    this.#emit('added', job);
    return job;
  }

  /**
   * Rehydrate from persisted state. Anything left RUNNING was interrupted
   * mid-flight by a crash or a closed tab, so it goes back in the queue.
   */
  restore(jobs) {
    for (const j of jobs) {
      this.jobs.set(j.id, j.state === JOB.RUNNING ? { ...j, state: JOB.QUEUED } : { ...j });
    }
    this.#emit('restored', null);
  }

  get stats() {
    const s = { total: this.jobs.size, queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
    for (const j of this.jobs.values()) {
      if (j.state === JOB.QUEUED) s.queued++;
      else if (j.state === JOB.RUNNING) s.running++;
      else if (j.state === JOB.SUCCEEDED) s.succeeded++;
      else if (j.state === JOB.FAILED) s.failed++;
      else if (j.state === JOB.CANCELLED) s.cancelled++;
    }
    s.done = s.succeeded + s.failed + s.cancelled;
    s.progress = s.total === 0 ? 0 : s.done / s.total;
    s.etaMs = this.#eta(s);
    return s;
  }

  // Estimate from recent completions, not the run-wide mean: the first few
  // jobs pay for worker startup and would skew the whole estimate.
  #eta(s) {
    const remaining = s.total - s.done;
    if (remaining === 0 || this.completionTimes.length === 0) return 0;
    const recent = this.completionTimes.slice(-20);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    return Math.round((remaining * avg) / Math.max(1, this.concurrency));
  }

  async run() {
    this.cancelled = false;
    this.paused = false;
    await this.#pump();
  }

  pause() { this.paused = true; this.#emit('paused', null); }
  resume() { this.paused = false; this.breakerOpen = false; this.consecutiveFailures = 0; this.#pump(); }

  cancel() {
    this.cancelled = true;
    for (const j of this.jobs.values()) {
      if (j.state === JOB.QUEUED) { j.state = JOB.CANCELLED; this.#emit('job', j); }
    }
    this.#emit('cancelled', null);
  }

  retryFailed() {
    for (const j of this.jobs.values()) {
      if (j.state === JOB.FAILED) { j.state = JOB.QUEUED; j.attempts = 0; j.error = null; this.#emit('job', j); }
    }
    this.breakerOpen = false;
    this.consecutiveFailures = 0;
    this.#pump();
  }

  retry(id) {
    const j = this.jobs.get(id);
    if (!j || (j.state !== JOB.FAILED && j.state !== JOB.CANCELLED)) return;
    j.state = JOB.QUEUED; j.attempts = 0; j.error = null;
    this.#emit('job', j);
    this.#pump();
  }

  async #pump() {
    if (this.paused || this.cancelled || this.breakerOpen) return;
    while (this.running.size < this.concurrency) {
      const next = [...this.jobs.values()].find((j) => j.state === JOB.QUEUED);
      if (!next) break;
      this.#start(next);
    }
    if (this.running.size === 0) this.#emit('idle', null);
  }

  async #start(job) {
    job.state = JOB.RUNNING;
    job.attempts++;
    job.startedAt = Date.now();
    this.running.add(job.id);
    this.#emit('job', job);
    this.onPersist?.(job);

    try {
      job.result = await this.worker(job);
      job.state = JOB.SUCCEEDED;
      job.finishedAt = Date.now();
      this.completionTimes.push(job.finishedAt - job.startedAt);
      this.consecutiveFailures = 0;
    } catch (err) {
      job.error = { message: err?.message ?? String(err), retryable: err?.retryable !== false };
      if (job.attempts < this.maxAttempts && job.error.retryable && !this.cancelled) {
        job.state = JOB.QUEUED;
        await sleep(backoffMs(job.attempts));
      } else {
        job.state = JOB.FAILED;
        job.finishedAt = Date.now();
        this.consecutiveFailures++;
        // Circuit breaker: stop burning 400 jobs into the same outage.
        if (this.consecutiveFailures >= this.breakerThreshold) {
          this.breakerOpen = true;
          this.#emit('breaker', { failures: this.consecutiveFailures });
        }
      }
    } finally {
      this.running.delete(job.id);
      this.#emit('job', job);
      this.onPersist?.(job);
      this.#emit('progress', this.stats);
      this.#pump();
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** Exponential backoff with jitter — without jitter, retries synchronise. */
export function backoffMs(attempt, base = 400, cap = 8000) {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Token-bucket rate limiter, so a free API is not the thing we abuse. */
export class RateLimiter {
  constructor(ratePerSec = 5, burst = 10) {
    this.rate = ratePerSec;
    this.capacity = burst;
    this.tokens = burst;
    this.last = Date.now();
  }
  async take() {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.rate);
      this.last = now;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await sleep(Math.ceil(((1 - this.tokens) / this.rate) * 1000));
    }
  }
}
