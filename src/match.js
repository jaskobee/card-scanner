// Candidate scoring. See CLAUDE.md §2.1, §3.
// We rank candidates and report the margin. We never silently pick a winner.

import { similarity, fold, containsFuzzy } from './normalize.js';

/**
 * Signal weights. An exact printed identifier is far more discriminating than
 * a name, because names repeat across sets, years and reprints.
 */
export const WEIGHTS = {
  number: 3.0,
  name: 2.0,
  set: 1.5,
  year: 1.0,
  hp: 0.8,
  language: 0.5,
  variant: 0.5,
};

/**
 * Score one candidate against the extracted signals.
 * Only signals we actually observed contribute — a missing signal neither
 * rewards nor punishes, it simply reduces the evidence available.
 *
 * @param {object} signals  { name, number, set, year, language, variant } raw values or null
 * @param {object} candidate a provider record with the same shape
 * @returns {{score:number, agreements:object, evidenceWeight:number}}
 */
export function scoreCandidate(signals, candidate) {
  let total = 0;
  let possible = 0;
  const agreements = {};

  for (const [field, weight] of Object.entries(WEIGHTS)) {
    const observed = signals[field];
    const expected = candidate[field];
    if (observed == null || observed === '' || expected == null || expected === '') continue;

    possible += weight;
    let agreement;
    if (field === 'number') {
      agreement = compareNumbers(observed, expected);
    } else if (field === 'year' || field === 'hp') {
      agreement = Number(observed) === Number(expected) ? 1 : 0;
    } else if (field === 'name' && signals.nameText) {
      // The name line carries junk around the name; look for the candidate's
      // name inside it as well as comparing the picked name directly.
      agreement = Math.max(similarity(observed, expected), containsFuzzy(signals.nameText, expected));
    } else if (field === 'language') {
      agreement = fold(observed) === fold(expected) ? 1 : 0;
    } else {
      agreement = similarity(observed, expected);
    }
    agreements[field] = agreement;
    total += weight * agreement;
  }

  return {
    score: possible === 0 ? 0 : total / possible,
    agreements,
    evidenceWeight: possible,
  };
}

/**
 * Card numbers compare on the numerator primarily. 4/102 and 004/102 are the
 * same card; 4/102 and 4/130 are different printings of the same name.
 */
export function compareNumbers(a, b) {
  const pa = splitNumber(a), pb = splitNumber(b);
  if (!pa || !pb) return fold(a) === fold(b) ? 1 : 0;
  const numMatch = pa.num === pb.num && pa.prefix === pb.prefix;
  if (!numMatch) return 0;
  if (pa.den && pb.den) return pa.den === pb.den ? 1 : 0.6; // same position, different set size
  return 0.85; // one side has no denominator to check
}

function splitNumber(s) {
  const m = /^([A-Za-z]*)0*(\d+)([a-z]?)(?:\s*\/\s*([A-Za-z]*)0*(\d+))?$/.exec(String(s).trim());
  if (!m) return null;
  return {
    prefix: (m[1] || '').toLowerCase(),
    num: Number(m[2]),
    suffix: m[3] || '',
    den: m[5] ? Number(m[5]) : null,
  };
}

/**
 * Rank candidates and derive overall confidence plus the diagnostics that
 * decide whether a human needs to look.
 *
 * Confidence is damped when little evidence was available: agreeing on one
 * weak signal is not a confident identification, however perfect the agreement.
 */
export function rankCandidates(signals, candidates, opts = {}) {
  const maxWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const scored = candidates
    .map((c) => {
      const r = scoreCandidate(signals, c);
      const coverage = r.evidenceWeight / maxWeight;
      // Damping: full score requires roughly half the available signal weight.
      const damped = r.score * Math.min(1, 0.4 + coverage * 1.2);
      return { candidate: c, ...r, coverage, confidence: round(damped) };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, opts.limit ?? 5);

  if (scored.length === 0) {
    return { best: null, candidates: [], confidence: 0, margin: 0, flags: [] };
  }

  const best = scored[0];
  const margin = round(best.confidence - (scored[1]?.confidence ?? 0));

  return {
    best: best.candidate,
    candidates: scored,
    confidence: best.confidence,
    margin,
    flags: fieldFlags(signals, best),
  };
}

/**
 * Field-level disagreement. A high overall score does not excuse a field that
 * contradicts what we read off the card — that field still gets flagged.
 */
export function fieldFlags(signals, best) {
  const flags = [];
  for (const [field, agreement] of Object.entries(best.agreements)) {
    // HP corroborates a match but is neither listed nor exported, so a misread
    // one is not a field the user needs to fix.
    if (field === 'hp') continue;
    if (agreement < 0.75) flags.push(field);
  }
  // Variant is first-class (§5): unobserved variant on a card whose candidate
  // set contains several variants is a review item, not a silent default.
  if (signals.variant == null && best.candidate.hasVariants) flags.push('variant');
  return [...new Set(flags)];
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
