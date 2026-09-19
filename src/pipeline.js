// The processing pipeline. See CLAUDE.md §4.
// image → quality → crop → OCR → signals → provider → rank → confidence → card

import { assessQuality, detectCardBounds, ISSUE } from './imagequality.js';
import { prepareForOcr, makeThumbnail, boostContrast } from './ocr.js';
import { findCardNumbers, findYears, findVariantTerms, guessLanguage, lines, findCopyright } from './normalize.js';
import { rankCandidates } from './match.js';
import { extracted, newCard, STATE, band } from './model.js';
import { hashImageData } from './dupes.js';
import * as store from './storage.js';

/**
 * Pull identification signals out of OCR text.
 * Every signal keeps the raw span that produced it, as evidence.
 */
export function extractSignals(text) {
  const numbers = findCardNumbers(text);
  const years = findYears(text);
  const variants = findVariantTerms(text);
  const language = guessLanguage(text);
  const copyright = findCopyright(text);

  // The card name is the longest plausible line in the top third of the card —
  // a heuristic, so it is recorded as such and never scores as certain.
  const candidateName = pickName(text);

  return {
    number: numbers[0] ?? null,
    year: years[0] ?? (copyright?.year ? { value: copyright.year, raw: copyright.raw } : null),
    variant: variants[0] ?? null,
    language: language ?? null,
    name: candidateName,
    allNumbers: numbers,
    raw: text,
  };
}

const NOISE = /^(basic|stage \d|grundphase|stufe \d|hp|ps|weakness|resistance|retreat|schwäche|resistenz|rückzug|illus|illustrator|©|\d+$)/i;

export function pickName(text) {
  const ls = lines(text).slice(0, 6);
  const scored = ls
    .filter((l) => l.length >= 3 && l.length <= 40)
    .filter((l) => !NOISE.test(l))
    .filter((l) => /[A-Za-zÀ-ÿ]{3,}/.test(l))
    .map((l, i) => ({
      value: l.replace(/\s*\d+\s*(HP|PS)\s*$/i, '').trim(),
      raw: l,
      score: (6 - i) + (/^[A-ZÀ-Þ]/.test(l) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0] ?? null;
}

/**
 * Process one image into a card record.
 * Throws only on unrecoverable errors; a poor-quality image still produces a
 * card, flagged, because the user may know better than the detector.
 */
export async function processImage({ file, projectId, provider, ocr, signal }) {
  const startedAt = performance.now();
  const card = newCard({ projectId });

  // 1. Prepare and measure.
  const prepared = await prepareForOcr(file);
  const quality = assessQuality(prepared.imageData);
  const hash = await hashImageData(prepared.imageData);

  // 2. Persist images out of the record itself.
  const thumb = await makeThumbnail(file);
  await store.putBlob(`${card.id}:front`, file);
  await store.putBlob(`${card.id}:thumb`, thumb);
  card.images = { front: `${card.id}:front`, back: null, thumb: `${card.id}:thumb` };
  card.meta.hash = hash;
  card.quality = quality;

  if (signal?.aborted) throw abortError();

  // 3. Crop to the card when one clearly stands out; otherwise use the frame.
  const bounds = detectCardBounds(prepared.imageData);
  let ocrSource = prepared.canvas;
  if (bounds) {
    const c = new OffscreenCanvas(bounds.width, bounds.height);
    c.getContext('2d').drawImage(
      prepared.canvas, bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, bounds.width, bounds.height,
    );
    ocrSource = c;
  } else {
    card.flags = [...card.flags, 'crop'];
  }

  // 4. Read the text.
  const ctx = ocrSource.getContext('2d', { willReadFrequently: true });
  const forOcr = ctx.getImageData(0, 0, ocrSource.width, ocrSource.height);
  ctx.putImageData(boostContrast(forOcr), 0, 0);

  const blob = await ocrSource.convertToBlob({ type: 'image/png' });
  const recognised = await ocr.recognise(blob);
  card.meta.ocrConfidence = recognised.confidence;

  if (signal?.aborted) throw abortError();

  // 5. Turn text into signals, and signals into a provider query.
  const signals = extractSignals(recognised.text);
  const query = {
    name: signals.name?.value ?? null,
    number: signals.number?.value ?? null,
    year: signals.year?.value ?? null,
    language: signals.language?.value ?? null,
    variant: signals.variant?.value ?? null,
  };

  // Nothing readable is a real outcome, not a reason to guess.
  if (!query.name && !query.number) {
    card.state = STATE.NEEDS_REVIEW;
    card.errors.push(
      quality.issues.length
        ? `We could not read this card. ${quality.issues.includes(ISSUE.GLARE) ? 'Glare is covering the text.' : 'The image quality is low.'}`
        : 'We could not read any text on this card.',
    );
    card.flags = [...new Set([...card.flags, 'name', 'number'])];
    card.meta.processingMs = Math.round(performance.now() - startedAt);
    return card;
  }

  // 6. Candidates and ranking.
  const candidates = await provider.search(query);
  const ranked = rankCandidates(query, candidates);

  card.meta.provider = provider.id;
  card.confidence = ranked.confidence;
  card.margin = ranked.margin;
  card.candidates = ranked.candidates.map((c) => ({
    id: c.candidate.id,
    confidence: c.confidence,
    agreements: c.agreements,
    record: c.candidate,
  }));

  // 7. Populate fields, each with its own provenance.
  if (signals.number) card.fields.number = extracted(signals.number.value, 'ocr', clamp(recognised.confidence), signals.number.raw);
  if (signals.name) card.fields.name = extracted(signals.name.value, 'ocr', clamp(recognised.confidence * 0.9), signals.name.raw);
  if (signals.variant) card.fields.variant = extracted(signals.variant.value, 'ocr', clamp(recognised.confidence), signals.variant.raw);
  if (signals.language) card.fields.language = extracted(signals.language.value, 'ocr', 0.8, signals.language.raw);
  if (signals.year) card.fields.year = extracted(signals.year.value, 'ocr', 0.85, signals.year.raw);

  if (ranked.best) {
    const b = ranked.best;
    const c = ranked.confidence;
    // Database values overwrite OCR only where OCR found nothing, so a printed
    // value the user can see on the card is never replaced behind their back.
    fill(card, 'name', b.name, c, b.id);
    fill(card, 'number', b.number, c, b.id);
    fill(card, 'set', b.set, c, b.id);
    fill(card, 'series', b.series, c, b.id);
    fill(card, 'year', b.year, c, b.id);
    fill(card, 'manufacturer', b.manufacturer, c, b.id);
    fill(card, 'game', b.game, c, b.id);
    fill(card, 'language', b.language, c, b.id);
    card.reference = { image: b.image ?? null, id: b.id, availableVariants: b.availableVariants ?? [] };
  }

  card.flags = [...new Set([...card.flags, ...ranked.flags])];
  card.state = band(card.confidence, card.margin).key === 'HIGH' && card.flags.length === 0
    ? STATE.IDENTIFIED
    : STATE.NEEDS_REVIEW;

  if (quality.issues.length && card.state === STATE.NEEDS_REVIEW) {
    card.errors.push(...quality.issues.map((i) => i));
  }

  card.meta.processingMs = Math.round(performance.now() - startedAt);
  return card;
}

function fill(card, field, value, confidence, evidence) {
  if (value === null || value === undefined || value === '') return;
  if (card.fields[field]?.value) return; // OCR already read it off the card
  card.fields[field] = extracted(value, 'db_match', clamp(confidence), evidence);
}

function clamp(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }

function abortError() {
  const e = new Error('Cancelled');
  e.retryable = false;
  return e;
}
