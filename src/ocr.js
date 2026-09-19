// OCR via Tesseract.js, off the main thread. See CLAUDE.md §4.
// Nothing here uploads an image: recognition runs entirely in the browser.

import { luma, flattenIllumination, stretchContrast, toRgba } from './imageproc.js';
import { CARD_ASPECT, regionRect } from './regions.js';

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
        // Always pass a logger: an explicit `undefined` replaces Tesseract's own
        // no-op default, and every progress message then throws in the page.
        const w = await T.createWorker(this.languages, 1, {
          logger: onProgress ? (m) => onProgress(m) : () => {},
        });
        // Tesseract sizes text against a resolution; an unset one makes it guess.
        await w.setParameters({ user_defined_dpi: '300' });
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
   *
   * `psm` is Tesseract's page-segmentation mode: 6 reads a block of lines, 7 a
   * single line, 11 finds sparse text wherever it sits. `whitelist` limits the
   * characters it may answer with. Workers are shared, so both are set on every
   * call rather than assumed left over from the last one.
   */
  async recognise(source, { psm = 3, whitelist = '' } = {}) {
    await this.init();
    const w = await this.#acquire();
    try {
      await w.setParameters({
        tessedit_pageseg_mode: String(psm),
        tessedit_char_whitelist: whitelist,
      });
      const { data } = await w.recognize(source);
      return {
        text: data.text ?? '',
        confidence: (data.confidence ?? 0) / 100,
        words: (data.words ?? []).map((x) => ({ text: x.text, confidence: (x.confidence ?? 0) / 100 })),
        lines: (data.lines ?? []).map((x) => ({ text: (x.text ?? '').trim(), confidence: (x.confidence ?? 0) / 100 })),
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
 * A downscaled working copy for the cheap measurements (quality, duplicate hash,
 * locating the card). The caller keeps the full-resolution bitmap for as long
 * as it needs it and must close it — holding 500 of those is its own outage (§4).
 */
export function downscale(bitmap, { maxEdge = 1400 } = {}) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

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

/**
 * Draw the card upright, cropped from the full-resolution source. With a
 * placement (from locateCard) the card is rotated, cropped and stretched to a
 * standard 5:7 canvas; without one the whole frame is used as it is, which is
 * right for a scan and merely unhelpful for a photograph.
 *
 * `placement` is in the source's own pixels: { cx, cy, w, h, angle }, where w is
 * the card's short side and angle is how far it is turned clockwise from upright.
 */
export function renderCard(source, placement = null, { width = 1000 } = {}) {
  if (!placement) {
    const w = Math.min(width, source.width);
    const h = Math.round((w * source.height) / source.width);
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(source, 0, 0, w, h);
    return c;
  }
  const W = width;
  const H = Math.round(W / CARD_ASPECT);
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.translate(W / 2, H / 2);
  x.scale(W / placement.w, H / placement.h);
  x.rotate(-placement.angle);
  x.translate(-placement.cx, -placement.cy);
  x.drawImage(source, 0, 0);
  return c;
}

/**
 * Crop one region off the upright card, take away its lighting so glare and
 * shadows stop competing with the ink, and scale it to a height Tesseract reads
 * well. Returns a PNG blob.
 *
 * Removing the lighting keeps only what is darker than its surroundings, so
 * light lettering on a dark ground — the credits on a black card border — needs
 * `invert`. Guessing that from the pixels proved unreliable (a strip that takes
 * in a little dark table looks like light-on-dark), so the caller decides, by
 * retrying inverted when a normal reading finds nothing valid.
 */
export async function regionForOcr(cardCanvas, region, { targetHeight = 240, invert = false } = {}) {
  const { sx, sy, sw, sh } = regionRect(region, cardCanvas.width, cardCanvas.height);
  const k = targetHeight / sh;
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const pad = 12; // a margin of plain background helps Tesseract find the text edge

  const c = new OffscreenCanvas(w + 2 * pad, h + 2 * pad);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.drawImage(cardCanvas, sx, sy, sw, sh, pad, pad, w, h);

  const img = x.getImageData(0, 0, c.width, c.height);
  const g = luma(img.data, c.width, c.height);
  if (invert) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  img.data.set(toRgba(stretchContrast(flattenIllumination(g, c.width, c.height, Math.round(h * 0.3)))));
  x.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/png' });
}
