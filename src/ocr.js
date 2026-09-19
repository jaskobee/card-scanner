// OCR via Tesseract.js, off the main thread. See CLAUDE.md §4.
// Nothing here uploads an image: recognition runs entirely in the browser.

const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let tesseractPromise = null;

async function loadTesseract() {
  if (globalThis.Tesseract) return globalThis.Tesseract;
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN;
      s.onload = () => resolve(globalThis.Tesseract);
      s.onerror = () => reject(new Error('Could not load the text recogniser. Check your connection and reload.'));
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

/**
 * A small pool of Tesseract workers. Each worker is a real Web Worker, so a
 * 500-card run never blocks the interface.
 */
export class OcrPool {
  constructor({ size = navigator.hardwareConcurrency ? Math.min(4, navigator.hardwareConcurrency) : 2, languages = 'eng+deu' } = {}) {
    this.size = size;
    this.languages = languages;
    this.workers = [];
    this.available = [];
    this.waiting = [];
    this.ready = null;
  }

  async init(onProgress) {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const T = await loadTesseract();
      for (let i = 0; i < this.size; i++) {
        const w = await T.createWorker(this.languages, 1, {
          logger: onProgress ? (m) => onProgress(m) : undefined,
        });
        this.workers.push(w);
        this.available.push(w);
      }
    })();
    return this.ready;
  }

  async #acquire() {
    if (this.available.length) return this.available.pop();
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  #release(w) {
    const next = this.waiting.shift();
    if (next) next(w); else this.available.push(w);
  }

  /**
   * Recognise text in an image. Returns the raw text and Tesseract's own
   * confidence, which becomes one input to matching — never the answer itself.
   */
  async recognise(source) {
    await this.init();
    const w = await this.#acquire();
    try {
      const { data } = await w.recognize(source);
      return {
        text: data.text ?? '',
        confidence: (data.confidence ?? 0) / 100,
        words: (data.words ?? []).map((x) => ({ text: x.text, confidence: (x.confidence ?? 0) / 100 })),
      };
    } finally {
      this.#release(w);
    }
  }

  async terminate() {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = []; this.available = []; this.ready = null;
  }
}

/**
 * Prepare an image for OCR: downscale to a working resolution, grey, and
 * stretch contrast. The full-resolution bitmap is released immediately —
 * holding 500 of those is its own outage (§4).
 */
export async function prepareForOcr(blob, { maxEdge = 1400 } = {}) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  return { canvas, ctx, imageData, width: w, height: h };
}

/** A small thumbnail for the results list, so the originals can be released. */
export async function makeThumbnail(blob, edge = 220) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
  return out;
}

/** Raise local contrast; printed card text survives compression poorly. */
export function boostContrast(imageData) {
  const d = imageData.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, ((l - min) / range) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return imageData;
}
