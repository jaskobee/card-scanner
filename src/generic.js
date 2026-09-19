// Reading a card that no database can vouch for: sports, wrestling, film, anything.
// See docs/architecture.md, "Cards that are not in a database".
//
// The Pokémon reader looks where Pokémon put things: a strip along the top for the
// name, the bottom corners for a number. Other cards put the name on a nameplate
// low down, in a banner up high, stacked at the side. So this reader looks
// everywhere, then decides which text is which.
//
//   1. Find text: overlapping strips down the card, each read light-on-dark and
//      dark-on-light, because a nameplate is dark on light and a logo the reverse.
//   2. Group the words into lines, and rank the lines that could be a name.
//   3. Read the best few again, each on its own, as a single line. Sparse-text
//      mode merges the words of tightly set italics ("JORDANELLIS"); a single line
//      read keeps them apart, and the gaps between the letters settle what is left.
//
// Nothing is guessed. What comes back is text, where it was, and how sure the
// reading was; the pipeline decides what to record, and every value keeps the
// exact text it came from.

import { regionImage } from './ocr.js';
import {
  dedupeWords, groupIntoLines, rankNames, readEvidence, spaceByGaps, nameLikeness, pickReading, tidyName,
} from './textlines.js';

// Strips down the card, each a fifth or so of its height, overlapping so that a
// line cut by one strip's edge is whole in the next.
const STRIPS = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.82].map((y) => ({ x: 0, y, w: 1, h: Math.min(0.22, 1 - y) }));

// Finer strips, used only when the first pass found nothing that could be a name.
// Where a strip's edges fall matters more than it should: the same name is read
// perfectly through one and not at all through its neighbour.
const FINE_STRIPS = [0.02, 0.09, 0.16, 0.23, 0.3, 0.37, 0.44, 0.51, 0.58, 0.65, 0.72, 0.79, 0.86].map((y) => ({ x: 0, y, w: 1, h: 0.14 }));

// Legal print is tiny, so it is read close up on its own.
const LEGAL = { x: 0, y: 0.935, w: 1, h: 0.065 };

const lettersOf = (s) => String(s ?? '').replace(/[^A-Za-zÀ-ÿ0-9]/g, '').toLowerCase();
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

/** Words read from one strip, with their positions turned into positions on the card. */
async function readStrip(card, ocr, region, targetHeight, invert, psm = 11) {
  const r = await regionImage(card, region, { targetHeight, invert });
  const t = await ocr.recognise(r.blob, { psm });
  const words = t.words.filter((w) => w.bbox).map((w) => {
    const a = r.toCard(w.bbox.x0, w.bbox.y0), z = r.toCard(w.bbox.x1, w.bbox.y1);
    return { text: w.text, confidence: w.confidence, bbox: w.bbox, x0: a.x, y0: a.y, x1: z.x, y1: z.y };
  });
  return { words, symbols: t.symbols, scale: r.scale, text: t.text, confidence: t.confidence };
}

// How tall the capitals are when a line is read again. Tesseract reads best when they
// stand roughly 30 to 70 pixels tall, but photographs and scans differ: a blurred photo of
// a card reads better enlarged to about 100, while a real scan's clean 35-pixel "BRAY
// WYATT" read 92 percent sure at its own size and as "sway war" when enlarged. So two
// sizes are always read and compared, and two more only when neither convinced.
const FIRST_SIZES = [45, 100];
const OTHER_SIZES = [30, 70];
const CONVINCING = 0.85;

/**
 * Read one line again, on its own, in both polarities and at several sizes. Returns
 * every reading; pickReading decides which to trust. This is also what tells a name
 * from a pattern that looks like lettering: a name reads 85 to 95 percent sure when
 * read by itself, and stripes, logos and artwork stay under 50.
 */
export async function rereadLine(card, ocr, line) {
  const pad = line.height * 0.45;
  const top = Math.max(0, line.y0 - pad), bottom = Math.min(card.height, line.y1 + pad);
  const heightFor = (letters) => Math.max(40, Math.min(400, Math.round(((bottom - top) / line.height) * letters)));

  // The piece that was found, and the whole row it sits in: the piece may be only
  // half a name ("ELLIS," with "JORDAN" lost beside it).
  const near = { x: Math.max(0, line.x0 - pad * 2) / card.width, y: top / card.height, w: Math.min(card.width, line.x1 - line.x0 + pad * 4) / card.width, h: (bottom - top) / card.height };
  const row = { x: 0.03, y: top / card.height, w: 0.94, h: (bottom - top) / card.height };

  const read = async (region, sizes) => (await Promise.all(sizes.flatMap((letters) =>
    [false, true].map((invert) => readStrip(card, ocr, region, heightFor(letters), invert, 7)))))
    .map(asReading).filter(Boolean);
  // A reading that is sure of itself.
  const convincing = (rs) => rs.some((r) => r.confidence >= CONVINCING && nameLikeness(r.text) > 0);

  // The piece and the whole row are always both read. Half a name reads convincingly on
  // its own ("MARINO" of "SOFIA MARINO", "ENA OKA" of "LENA OKAFOR"), and nothing about
  // the reading says the crop cut it short, so there is no reading that lets the row be skipped.
  const [piece, whole] = await Promise.all([read(near, FIRST_SIZES), read(row, FIRST_SIZES)]);
  const readings = [...piece, ...whole];
  if (!convincing(readings)) readings.push(...await read(near, OTHER_SIZES));
  return readings;
}

/** One reading of a line: word spaces put back by the gaps between the letters, where that is safe. */
function asReading(t) {
  const heights = t.symbols.filter((sy) => sy.bbox).map((sy) => sy.bbox.y1 - sy.bbox.y0);
  const spaced = spaceByGaps(t.symbols, median(heights) || 1);
  // Gaps are only trusted for capitals, which is what runs together when set tight. In
  // ordinary type Tesseract's own spacing is sound and a gap inside a word is only a gap.
  const capitals = /[A-Z]/.test(t.text) && t.text === t.text.toUpperCase();
  const sameLetters = lettersOf(spaced) === lettersOf(t.text);
  const text = tidyName(capitals && sameLetters ? spaced : t.text.replace(/\s+/g, ' ').trim());
  return text ? { text, confidence: t.confidence } : null;
}

/** The first pass: every line of text found anywhere on the card, before any is read again. */
export async function findLines(card, ocr, { fine = false } = {}) {
  const strips = await Promise.all([
    ...(fine ? FINE_STRIPS : STRIPS).flatMap((r) => [false, true].map((invert) => readStrip(card, ocr, r, 320, invert))),
    ...(fine ? [] : [false, true].map((invert) => readStrip(card, ocr, LEGAL, 220, invert))),
  ]);
  return strips.flatMap((s) => s.words);
}

/**
 * Everything readable on the card, and the most likely names.
 * @param {OffscreenCanvas} card the upright card
 * @param {{recognise: Function}} ocr
 * @returns {{lines: Array, names: Array, evidence: object, texts: Array}}
 */
export async function readAnyCard(card, ocr) {
  const H = card.height;
  let words = await findLines(card, ocr);
  // Nothing that could be a name? Look again, more finely, before giving up.
  if (!rankNames(groupIntoLines(dedupeWords(words)), H).length) words = [...words, ...(await findLines(card, ocr, { fine: true }))];
  const lines = groupIntoLines(dedupeWords(words));

  // Read the likeliest names again, one line at a time, all at once: the workers are
  // shared, so this only queues them and the slow lines do not hold the quick ones up.
  const candidates = rankNames(lines, H).slice(0, 5);
  const refined = new Map();
  await Promise.all(candidates.filter((c) => !c.line.joined).map(async (c) => {
    refined.set(c.line, await rereadLine(card, ocr, c.line));
  }));
  const sharper = lines.map((l) => {
    const readings = refined.get(l);
    return readings ? { ...l, ...pickReading({ text: l.text, confidence: l.confidence }, readings) } : l;
  });

  const ranked = rankNames(sharper, H).slice(0, 4);
  const names = ranked.map((n) => ({
    text: n.text, confidence: n.confidence, size: n.height / H, score: n.score,
  }));

  // A re-read is tidied to be a name: brand words, digits and marks are trimmed off its
  // ends. That is right for a name and ruinous for anything else, so a line that only
  // *looked* like a name ("© 2021 PANINI AMERICA, INC." became "AMERICA INC.") must still
  // give its year and maker from what was actually printed. Evidence reads the first pass.
  const named = new Set(ranked.map((n) => n.line));
  return {
    lines: sharper,
    names,
    evidence: readEvidence(lines),
    // Every line worth showing, biggest first, for the user to assign by hand. The lines
    // that became names show their corrected reading; the rest show what was printed.
    texts: sharper
      .map((l, i) => (named.has(l) ? l : lines[i]))
      .filter((l) => /[A-Za-z0-9]{2,}/.test(l.text) && l.confidence >= 0.4)
      .sort((a, b) => b.height - a.height)
      .slice(0, 24)
      .map((l) => ({ text: l.text, confidence: Math.round(l.confidence * 100) / 100, size: Math.round((l.height / H) * 1000) / 1000 })),
  };
}
