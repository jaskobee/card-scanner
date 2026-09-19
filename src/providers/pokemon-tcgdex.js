// Pokémon card data via TCGdex. See CLAUDE.md §2.3, §2.4.
// Free, open, no API key, multilingual (German included). Official public API —
// no scraping. Everything here is behind the provider interface so it can be
// replaced without touching the pipeline, the UI or the exporter.

import { RateLimiter } from '../queue.js';
import { fold, similarity, containsFuzzy } from '../normalize.js';

const BASE = 'https://api.tcgdex.net/v2';

export class PokemonTcgdexProvider {
  constructor({ language = 'en', fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    this.id = 'tcgdex';
    this.label = 'TCGdex (Pokémon)';
    this.game = 'Pokémon';
    this.language = language;
    this.fetch = fetchImpl;
    this.limiter = new RateLimiter(3, 12); // three a second, as documented: this is a free, volunteer-run service
    this.cache = new Map();
    this.setIndex = null;
  }

  /** Card numbers on Pokémon cards are printed as x/y — a strong anchor. */
  get strongSignals() { return ['number', 'name']; }

  /**
   * Only a 404 means "no such thing" and comes back as null. Any other failure —
   * a timeout, a 500, being rate limited — throws, so the job is retried and a
   * real outage trips the circuit breaker. Swallowing it would turn a hiccup into
   * "no such card" and an outage into 500 cards quietly matched to nothing.
   */
  async #json(path) {
    if (this.cache.has(path)) return this.cache.get(path);
    await this.limiter.take();
    const res = await this.fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) { this.cache.set(path, null); return null; }
    if (res.status === 429) {
      const e = new Error('The card database is rate limiting us. Slowing down.');
      e.retryable = true;
      throw e;
    }
    if (!res.ok) {
      const e = new Error(`Card database returned ${res.status}`);
      e.retryable = res.status >= 500;
      throw e;
    }
    const data = await res.json();
    this.cache.set(path, data);
    return data;
  }

  /** Set list, used to resolve a printed set total (the /y of x/y) to a set. */
  async sets() {
    if (this.setIndex) return this.setIndex;
    const raw = await this.#json(`/${this.language}/sets`);
    this.setIndex = (raw ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      total: s.cardCount?.official ?? s.cardCount?.total ?? null,
      releaseDate: s.releaseDate ?? null,
    }));
    return this.setIndex;
  }

  /** The printed set totals the database knows, for sanity-checking a number read off a card. */
  async knownTotals() {
    return new Set((await this.sets()).map((x) => x.total).filter(Boolean));
  }

  /**
   * Search candidates from OCR signals. Returns provider records in the shape
   * match.js expects. Never fabricates a record when nothing is found — an
   * empty array is a real answer.
   *
   * Two routes, because either can fail on its own. The printed number and set
   * total identify one printing outright — but only if both were read right.
   * A name narrowed by the card number and HP finds the same printing even when
   * the set total was misread, at the cost of a few more requests.
   */
  async search(signals) {
    const results = new Map();
    const parsed = parseNumber(signals.number);

    // 1. Number plus set total: the strongest single path.
    if (parsed?.den) {
      const matching = (await this.sets()).filter((x) => x.total === parsed.den);
      for (const set of matching.slice(0, 12)) {
        const card = await this.#json(`/${this.language}/sets/${set.id}/${parsed.num}`);
        if (card) results.set(card.id, await this.#toRecord(card, set));
      }
    }

    // When the number already found a card whose name and year agree with what
    // was read, independent signals agree. Stop there. The year matters: a
    // misread set size lands on a different printing of the same Pokémon with the
    // same number, whose name agrees perfectly and whose year does not.
    const agrees = [...results.values()].some((r) => nameAgrees(signals, r.name) && yearAgrees(signals, r.year));
    if (agrees) return [...results.values()];

    // 2. By name, narrowed by number and HP where they were read.
    const name = queryName(signals.name);
    if (name) {
      for (const brief of await this.#findByName(name, { localId: parsed?.num, hp: signals.hp })) {
        if (results.has(brief.id)) continue;
        const card = await this.#json(`/${this.language}/cards/${brief.id}`);
        if (card) results.set(card.id, await this.#toRecord(card));
      }
    }

    return [...results.values()];
  }

  /**
   * Briefs for a name, narrowed as far as the evidence allows. Every filter is
   * dropped in turn if it leaves nothing, because a misread HP or number must
   * not hide the right card.
   *
   * A name that returns nothing may just be OCR junk on the end of a real one
   * ("Dialgawes"), so up to three characters are trimmed off in turn. Those
   * retries are one request each, narrowed by card number where it was read: a
   * garbled name must not cost a free service a dozen requests.
   */
  async #findByName(name, { localId, hp }) {
    const filters = [];
    if (localId != null && hp) filters.push({ localId, hp });
    if (localId != null) filters.push({ localId });
    if (hp) filters.push({ hp });
    filters.push({});

    for (const f of filters) {
      const found = await this.#briefs(name, f);
      if (found.length) return found;
    }

    const narrowest = localId != null ? { localId } : {};
    for (let cut = 1; cut <= 3 && name.length - cut >= 5; cut++) {
      const found = await this.#briefs(name.slice(0, name.length - cut), narrowest);
      if (found.length) return found;
    }
    return [];
  }

  async #briefs(name, { localId, hp }) {
    const q = [`name=like:${encodeURIComponent(name)}`];
    if (localId != null) q.push(`localId=${localId}`);
    if (hp) q.push(`hp=${hp}`);
    q.push('pagination:page=1', 'pagination:itemsPerPage=40');
    let list = (await this.#json(`/${this.language}/cards?${q.join('&')}`)) ?? [];

    // localId is matched as a substring ("1" also finds "14" and "111"), so keep
    // only the cards whose own number is the one that was read.
    if (localId != null) list = list.filter((b) => numerator(b.localId) === localId);

    return list
      .map((b) => ({ b, closeness: similarity(b.name, name) }))
      .sort((x, y) => y.closeness - x.closeness)
      .slice(0, 8)
      .map((x) => x.b);
  }

  /**
   * Year and series are not on the set list or on a card's own set stub — only
   * on the set's page. One request per set, cached, so a batch drawn from twenty
   * sets asks twenty times, not once per card.
   */
  async #setInfo(id) {
    if (!id) return { releaseDate: null, series: null };
    const detail = await this.#json(`/${this.language}/sets/${id}`);
    return { releaseDate: detail?.releaseDate ?? null, series: detail?.serie?.name ?? null };
  }

  async #toRecord(card, set) {
    const s = set ?? card.set ?? {};
    const info = await this.#setInfo(s.id);
    const total = s.cardCount?.official ?? s.total ?? null;
    const year = info.releaseDate ? Number(String(info.releaseDate).slice(0, 4)) : null;
    // A card has variants when the printing exists in more than one finish.
    const variants = card.variants ?? {};
    const variantCount = Object.values(variants).filter(Boolean).length;

    return {
      id: card.id,
      provider: this.id,
      name: card.name ?? null,
      number: total ? `${card.localId}/${total}` : String(card.localId ?? ''),
      set: s.name ?? null,
      setId: s.id ?? null,
      series: info.series,
      year,
      manufacturer: 'Pokémon',
      game: 'Pokémon',
      language: this.language,
      hp: card.hp ?? null,
      rarity: card.rarity ?? null,
      image: card.image ? `${card.image}/low.webp` : null,
      // Which finishes this printing exists in — the UI offers these rather
      // than letting the app pick one.
      availableVariants: Object.entries(variants).filter(([, v]) => v).map(([k]) => k),
      hasVariants: variantCount > 1,
      variant: null, // never assumed from the database; it must be read or chosen
    };
  }

  /** Reference image for side-by-side verification in the review queue. */
  imageFor(record) { return record.image; }
}

/** Narrow a candidate list by a language hint without discarding evidence. */
export function preferLanguage(records, language) {
  if (!language) return records;
  const hit = records.filter((r) => fold(r.language) === fold(language));
  return hit.length ? hit : records;
}

/** "054/197" -> { num: 54, den: 197 }. Null for anything not purely numeric, such as a promo prefix. */
export function parseNumber(value) {
  const m = /^\s*0*(\d+)\s*(?:\/\s*0*(\d+))?\s*$/.exec(String(value ?? ''));
  return m ? { num: Number(m[1]), den: m[2] ? Number(m[2]) : null } : null;
}

/** The numeric part of a card's own number: "054" -> 54, "SWSH001" -> 1. */
function numerator(localId) {
  const m = /(\d+)/.exec(String(localId ?? ''));
  return m ? Number(m[1]) : null;
}

/** A name worth sending to a database. Junk this short would match half of it. */
function queryName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  return n.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 4 ? n : null;
}

/** Copyright years run a year ahead of a release now and then, so allow one. Unknown agrees. */
function yearAgrees(signals, recordYear) {
  if (signals.year == null || recordYear == null) return true;
  return Math.abs(Number(signals.year) - Number(recordYear)) <= 1;
}

function nameAgrees(signals, recordName) {
  if (!recordName) return false;
  if (signals.name && similarity(signals.name, recordName) >= 0.8) return true;
  return Boolean(signals.nameText) && containsFuzzy(signals.nameText, recordName) >= 0.85;
}
