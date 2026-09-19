// The processing pipeline. See CLAUDE.md §4.
// image → quality → find card → straighten → read strips → signals → provider → rank → confidence → card

import { assessQuality, ISSUE } from './imagequality.js';
import { downscale, renderCard, regionForOcr, makeThumbnail } from './ocr.js';
import { locateCard, scalePlacement } from './cardlocate.js';
import {
  findCardNumbers, findYears, findVariantTerms, guessLanguage, findCopyright,
  findHp, pickName, withoutEvolutionLines,
} from './normalize.js';
import { rankCandidates } from './match.js';
import { extracted, newCard, STATE, band, EMPTY } from './model.js';
import { readAnyCard } from './generic.js';
import { hashImageData } from './dupes.js';
import * as store from './storage.js';

export { pickName };

/**
 * Pull identification signals out of OCR text. Every signal keeps the raw span
 * that produced it, as evidence.
 *
 * The card is read in strips — the top (name, HP) and the bottom corners
 * (number, year, copyright) — so each signal is taken from the strip it lives
 * in. Given a single block of text, everything is read from that.
 *
 * `isKnownTotal` lets the caller say which set sizes really exist, so a
 * denominator that is not one can be recognised as a misread.
 */
export function extractSignals(text, { nameText = text, bottomText = text, isKnownTotal = null } = {}) {
  const numbers = findCardNumbers(bottomText);
  const years = findYears(bottomText);
  const variants = findVariantTerms(`${nameText}\n${bottomText}`);
  const language = guessLanguage(`${nameText}\n${bottomText}`);
  const copyright = findCopyright(bottomText);

  // The name is a heuristic over OCR text, so it is recorded as one and never
  // scores as certain.
  const candidateName = pickName(nameText);

  return {
    number: pickNumber(numbers, isKnownTotal),
    year: latest(years) ?? (copyright?.year ? { value: copyright.year, raw: copyright.raw } : null),
    variant: variants[0] ?? null,
    language: language ?? null,
    name: candidateName,
    hp: findHp(nameText),
    allNumbers: numbers,
    raw: `${nameText}\n${bottomText}`,
  };
}

/**
 * Base-set cards print "©1995, 96, 98, 99 Nintendo ... ©1999 Wizards": several
 * years, of which the latest is the one that matches the set's release.
 */
function latest(years) {
  return years.reduce((a, b) => (!a || b.value > a.value ? b : a), null);
}

/**
 * Which of the numbers read to trust. A denominator that is not a real set size
 * is a misread, or a stray "2007/" from the copyright line, so numbers whose set
 * size the database knows come first. Nothing is repaired or invented: the
 * value is still exactly what was read.
 */
function pickNumber(numbers, isKnownTotal) {
  const plausible = numbers.filter((n) => !(denominatorOf(n) < 5));
  const known = isKnownTotal ? plausible.filter((n) => isKnownTotal(denominatorOf(n))) : [];
  return known[0] ?? plausible[0] ?? null;
}

const denominatorOf = (n) => Number(String(n.denominator).replace(/\D/g, ''));

/** Did this text yield a number that can be trusted: a real set size, if we know them? */
function hasValidNumber(text, isKnownTotal) {
  const n = pickNumber(findCardNumbers(text), isKnownTotal);
  return Boolean(n) && (!isKnownTotal || isKnownTotal(denominatorOf(n)));
}

/**
 * Read the strips that identify a card: the top for the name and HP, the two
 * bottom corners for the number. Each is cropped, has its lighting removed, and
 * is read on its own. The corners are read as sparse text, which copes with the
 * illustrator credit, copyright and rarity mark sitting beside the number.
 *
 * Black-bordered cards print the number in white. If a normal reading finds no
 * valid number, the corners are read again inverted, and that reading is used
 * only if it does — so ordinary cards never pay for it and never risk it.
 */
async function readCard(cardCanvas, ocr, isKnownTotal) {
  const read = async (region, targetHeight, psm, invert = false) =>
    ocr.recognise(await regionForOcr(cardCanvas, region, { targetHeight, invert }), { psm });

  const readBottom = async (invert) => {
    const [left, right] = await Promise.all([
      read('bottomLeft', 240, 11, invert),
      read('bottomRight', 240, 11, invert),
    ]);
    return { text: `${left.text}\n${right.text}`, confidence: (left.confidence + right.confidence) / 2 };
  };

  const [top, normal] = await Promise.all([read('top', 200, 6), readBottom(false)]);
  let bottom = normal;
  if (!hasValidNumber(normal.text, isKnownTotal)) {
    const inverted = await readBottom(true);
    if (hasValidNumber(inverted.text, isKnownTotal)) bottom = inverted;
  }
  return {
    top,
    bottomText: bottom.text,
    bottomConfidence: bottom.confidence,
    confidence: (top.confidence + bottom.confidence) / 2,
  };
}

/** One full reading of the card as framed: read it, extract signals, look it up, rank. */
async function interpret({ canvas, ocr, provider, isKnownTotal }) {
  const reading = await readCard(canvas, ocr, isKnownTotal);
  // "Evolves from <another Pokémon>" must not be allowed to vouch for a name.
  const nameText = withoutEvolutionLines(reading.top.text);
  const signals = extractSignals(`${nameText}\n${reading.bottomText}`, {
    nameText, bottomText: reading.bottomText, isKnownTotal,
  });
  const query = {
    name: signals.name?.value ?? null,
    nameText,
    number: signals.number?.value ?? null,
    hp: signals.hp?.value ?? null,
    year: signals.year?.value ?? null,
    language: signals.language?.value ?? null,
    variant: signals.variant?.value ?? null,
  };
  const candidates = query.name || query.number ? await provider.search(query) : [];
  return { reading, signals, query, ranked: rankCandidates(query, candidates) };
}

/**
 * Read a card that nothing vouches for, in whichever framing reads best. The strips
 * choose a framing by what they found, and on a card that is not a Pokémon card what
 * they find is noise, so this reader chooses for itself: the located card first, then
 * the whole frame, then the card turned around (only this reader can tell that a
 * lettered card is upside down, because it is the one that knows what a name looks like).
 */
const GOOD_NAME = 0.6;
async function readAnyFraming(bitmap, placement, ocr, signal) {
  const framings = placement
    ? [['located', placement], ['whole-frame', null], ['turned-around', { ...placement, angle: placement.angle + Math.PI }]]
    : [['whole-frame', null]];
  let chosen = null;
  for (const [framing, p] of framings) {
    if (signal?.aborted) break;
    const g = await readAnyCard(renderCard(bitmap, p), ocr);
    const score = g.names[0]?.score ?? 0;
    if (!chosen || score > chosen.score) chosen = { ...g, framing, score };
    if (score >= GOOD_NAME) break;
  }
  return chosen;
}

const isConfident = (a) => band(a.ranked.confidence, a.ranked.margin).key === 'HIGH';
const hasSignal = (a) => Boolean(a.signals.name || a.signals.number);

function isBetter(a, b) {
  if (a.ranked.confidence !== b.ranked.confidence) return a.ranked.confidence > b.ranked.confidence;
  return hasSignal(a) && !hasSignal(b);
}

/**
 * Process one image into a card record.
 * Throws only on unrecoverable errors; a poor-quality image still produces a
 * card, flagged, because the user may know better than the detector.
 */
export async function processImage({ file, projectId, provider, ocr, signal }) {
  const startedAt = performance.now();
  const card = newCard({ projectId });

  // Which set sizes exist, to tell a misread number from a real one.
  const totals = provider.knownTotals ? await provider.knownTotals() : null;
  const isKnownTotal = totals ? (d) => totals.has(d) : null;

  // 1. Decode once at full resolution. Measure on a smaller copy; render the
  //    card from the original so small print keeps the detail the photo has.
  const bitmap = await createImageBitmap(file);
  let best = null;
  let general = null;
  let quality, hash;
  try {
    const small = downscale(bitmap);
    quality = assessQuality(small.imageData);
    hash = await hashImageData(small.imageData);
    const located = locateCard(small.imageData);
    const placement = located ? scalePlacement(located, bitmap.width / small.width) : null;

    // 2. Persist images out of the record itself.
    const thumb = await makeThumbnail(file);
    await store.putBlob(`${card.id}:front`, file);
    await store.putBlob(`${card.id}:thumb`, thumb);
    card.images = { front: `${card.id}:front`, back: null, thumb: `${card.id}:thumb` };
    card.meta.hash = hash;
    card.quality = quality;

    if (signal?.aborted) throw abortError();

    // 3. Read the card as located; if that is not a confident identification,
    //    take a second opinion before troubling the user. The finder can mistake
    //    a card's own artwork for the card when it fills the frame, and a photo
    //    can be upside down, so the alternatives are tried in turn.
    const framings = placement
      ? [['located', placement], ['whole-frame', null]]
      : [['whole-frame', null]];
    for (const [label, p] of framings) {
      const canvas = renderCard(bitmap, p);
      const attempt = { ...(await interpret({ canvas, ocr, provider, isKnownTotal })), framing: label, canvas };
      if (!best || isBetter(attempt, best)) best = attempt;
      if (isConfident(best) || signal?.aborted) break;
    }
    if (placement && !isConfident(best) && !hasSignal(best) && !signal?.aborted) {
      const turned = { ...placement, angle: placement.angle + Math.PI };
      const canvas = renderCard(bitmap, turned);
      const attempt = { ...(await interpret({ canvas, ocr, provider, isKnownTotal })), framing: 'turned-around', canvas };
      // Upside-down lettering reads as plausible junk, so being turned around only wins
      // when it finds something a database agrees with, not merely something.
      if (attempt.ranked.confidence > best.ranked.confidence) best = attempt;
    }

    // No database vouches for this card. It may be a sports card, a wrestling card, a
    // film card: something the strips above were never built to read. So read what is
    // printed on it, wherever it is printed. This is only ever text, with the place it
    // was read from; nothing here says what the card is.
    if ((!best.ranked.best || best.ranked.confidence < 0.5) && !signal?.aborted) {
      general = await readAnyFraming(bitmap, placement, ocr, signal);
    }
  } finally {
    bitmap.close();
  }

  if (signal?.aborted) throw abortError();

  const { reading, signals, query, ranked } = best;
  card.meta.ocrConfidence = reading.confidence;
  card.meta.framing = best.framing;

  if (general) {
    card.meta.framing = general.framing;
    card.meta.read = 'text';
    card.meta.texts = general.texts;
    card.meta.names = general.names.slice(1).map((n) => n.text);
  }

  // Nothing readable is a real outcome, not a reason to guess.
  if (!query.name && !query.number && !general?.names.length && !Object.keys(general?.evidence ?? {}).length) {
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

  card.meta.provider = provider.id;
  card.confidence = ranked.confidence;
  card.margin = ranked.margin;
  card.candidates = ranked.candidates.map((c) => ({
    id: c.candidate.id,
    confidence: c.confidence,
    agreements: c.agreements,
    record: c.candidate,
  }));

  // 4. Populate fields, each with its own provenance.
  if (signals.number) card.fields.number = extracted(signals.number.value, 'ocr', clamp(reading.bottomConfidence), signals.number.raw);
  if (signals.name) card.fields.name = extracted(signals.name.value, 'ocr', clamp(reading.top.confidence * 0.9), signals.name.raw);
  if (signals.variant) card.fields.variant = extracted(signals.variant.value, 'ocr', clamp(reading.confidence), signals.variant.raw);
  if (signals.language) card.fields.language = extracted(signals.language.value, 'ocr', 0.8, signals.language.raw);
  if (signals.year) card.fields.year = extracted(signals.year.value, 'ocr', 0.85, signals.year.raw);

  if (general) applyGeneral(card, general);

  if (ranked.best) {
    const b = ranked.best;
    const c = ranked.confidence;

    // OCR spells a name however it managed to read it ("Dialgawes"). When the
    // match judged the names to agree, the database's spelling is the card's
    // name, and what was actually read stays on record as the evidence.
    const nameAgreement = ranked.candidates[0]?.agreements?.name ?? 0;
    if (b.name && signals.name && nameAgreement >= 0.75 && signals.name.value !== b.name) {
      card.fields.name = extracted(b.name, 'db_match', clamp(c), `${b.id} (read as “${signals.name.value}”)`);
    }

    // Other database values fill only what OCR found nothing for, so a printed
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

/**
 * Record what the general reader found. Each value keeps the exact text it was read
 * from. Nothing overwrites what the card already has, with three exceptions that are
 * about *where* the strips looked: the name, because the strip reader takes it from
 * where Pokémon put it and on any other card that is usually junk from the edge; the
 * year, because a strip's guess at digits is weaker than a line that says ©; and a
 * variant that is really a product line.
 */
function applyGeneral(card, g) {
  const has = (f) => Boolean(card.fields[f]?.value);
  const put = (field, value, confidence, evidence, source = 'ocr') => {
    card.fields[field] = extracted(value, source, clamp(confidence), evidence);
  };
  const e = g.evidence;

  const name = g.names[0];
  if (name) put('name', name.text, name.confidence * 0.85, name.text);

  if (e.manufacturer && !has('manufacturer')) put('manufacturer', e.manufacturer.value, e.manufacturer.confidence * 0.9, e.manufacturer.raw);
  if (e.product && !has('set')) put('set', e.product.value, e.product.confidence * 0.85, e.product.raw);
  if (e.year) put('year', e.year.value, e.year.confidence * 0.85, e.year.raw);
  if (e.number && !has('number')) put('number', e.number.value, e.number.confidence * 0.8, e.number.raw);

  if (e.league) {
    const { league, sport } = e.league.value;
    put('league', league, e.league.confidence * 0.9, e.league.raw);
    // An NBA card is a basketball card. That is a rule, so it is recorded as one, and
    // an inference never scores as certain.
    if (sport && !has('sport')) put('sport', sport, 0.7, `${league} is a ${sport} league`, 'inferred');
  }

  // "37/99" on a card is the print run of a numbered parallel, not the card's number.
  if (e.serial) {
    put('serial', e.serial.value, e.serial.confidence * 0.8, e.serial.raw);
    if (card.fields.number?.value === e.serial.value) card.fields.number = { ...EMPTY };
  }

  // Chrome and Prizm are product lines. A parallel is a finish such as a refractor.
  if (e.finish) put('variant', e.finish.value, e.finish.confidence * 0.8, e.finish.raw);
  else if (/^(chrome|prizm)$/i.test(card.fields.variant?.value ?? '')) card.fields.variant = { ...EMPTY };

  const missing = ['name', 'set', 'number', 'year'].filter((f) => !has(f));
  const unsure = name && name.confidence >= 0.6 ? [] : ['name'];
  card.flags = [...new Set([...card.flags, ...missing, ...unsure])];
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
