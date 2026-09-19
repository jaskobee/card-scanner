// Card data model. See CLAUDE.md §2.1 and §5.
// Every identification value carries provenance. Absence is a real answer.

export const SOURCES = ['ocr', 'db_match', 'user', 'template', 'inferred'];

export const STATE = {
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  IDENTIFIED: 'IDENTIFIED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  VERIFIED: 'VERIFIED',
  READY: 'READY',
  EXPORTED: 'EXPORTED',
  FAILED: 'FAILED',
};

// Legal transitions. A card is always in exactly one state and never "lost".
const TRANSITIONS = {
  UPLOADED: ['PROCESSING', 'FAILED'],
  PROCESSING: ['IDENTIFIED', 'NEEDS_REVIEW', 'FAILED'],
  IDENTIFIED: ['NEEDS_REVIEW', 'VERIFIED', 'PROCESSING'],
  NEEDS_REVIEW: ['VERIFIED', 'FAILED', 'PROCESSING'],
  VERIFIED: ['READY', 'NEEDS_REVIEW'],
  READY: ['EXPORTED', 'NEEDS_REVIEW'],
  EXPORTED: ['READY', 'NEEDS_REVIEW'],
  FAILED: ['PROCESSING'], // always retryable
};

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function transition(card, to) {
  if (!canTransition(card.state, to)) {
    throw new Error(`Illegal card transition ${card.state} -> ${to}`);
  }
  return { ...card, state: to, updatedAt: Date.now() };
}

/**
 * Wrap a value with its provenance. Never construct a bare field.
 * @param {*} value    null when there is no evidence — do NOT guess.
 * @param {string} source one of SOURCES
 * @param {number} confidence 0..1
 * @param {string} [evidence] the OCR span, matched record id, or rule name
 */
export function extracted(value, source, confidence, evidence) {
  if (!SOURCES.includes(source)) {
    throw new Error(`Unknown provenance source: ${source}`);
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(`Confidence must be 0..1, got ${confidence}`);
  }
  // §2.1: an inference never presents as near-certain.
  if (source === 'inferred') {
    if (!evidence) throw new Error('inferred values must name the rule applied');
    if (confidence > 0.7) confidence = 0.7;
  }
  // The user is the authority on their own cards.
  if (source === 'user') confidence = 1;
  // No evidence, no value.
  if (value === null || value === undefined || value === '') {
    return { value: null, source, confidence: 0, evidence: evidence ?? null };
  }
  return { value, source, confidence, evidence: evidence ?? null };
}

export const EMPTY = Object.freeze({ value: null, source: 'ocr', confidence: 0, evidence: null });

export const IDENTIFICATION_FIELDS = [
  'name', 'number', 'set', 'series', 'year', 'manufacturer', 'brand',
  'game', 'sport', 'team', 'league', 'language', 'region',
];

export const VARIANT_FIELDS = ['variant', 'finish', 'edition', 'serial'];

// Fields the user owns outright. §5: condition is never inferred from an image.
// `cardType` is which eBay category the card is listed in (trading card game,
// sports, non-sport): a listing decision, so the user's, unless the database has
// identified the card as belonging to a game.
export const USER_FIELDS = [
  'condition', 'gradingCompany', 'grade', 'certNumber', 'graded', 'cardType',
  'quantity', 'sku', 'sellerNotes', 'price',
];

export function newCard(partial = {}) {
  const now = Date.now();
  const base = {
    id: partial.id ?? cryptoId(),
    state: STATE.UPLOADED,
    createdAt: now,
    updatedAt: now,
    projectId: partial.projectId ?? null,

    fields: {},          // name -> Extracted<T>
    user: {},            // user-owned values, plain
    candidates: [],      // ranked alternatives from matching
    confidence: 0,       // overall match confidence
    margin: 0,           // top score minus runner-up
    flags: [],           // field names needing attention
    errors: [],

    images: { front: null, back: null, thumb: null },
    meta: { provider: null, processingMs: null, ocrConfidence: null, hash: null },
  };
  for (const f of [...IDENTIFICATION_FIELDS, ...VARIANT_FIELDS]) base.fields[f] = { ...EMPTY };
  for (const f of USER_FIELDS) base.user[f] = f === 'quantity' ? 1 : null;
  return { ...base, ...partial, fields: { ...base.fields, ...(partial.fields || {}) } };
}

export function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- Confidence bands (CLAUDE.md §3) -------------------------------------
// Bands drive behaviour, not just colour. Margin matters as much as score:
// 0.92 against a 0.91 runner-up is a coin flip, not a high-confidence match.

export const BANDS = {
  HIGH: { key: 'HIGH', label: 'Identified', icon: '✓', min: 0.9 },
  MEDIUM: { key: 'MEDIUM', label: 'Check this', icon: '!', min: 0.7 },
  LOW: { key: 'LOW', label: 'Needs review', icon: '×', min: 0 },
};

export const MIN_MARGIN = 0.1;

export function band(confidence, margin = 1) {
  if (confidence >= BANDS.HIGH.min && margin >= MIN_MARGIN) return BANDS.HIGH;
  if (confidence >= BANDS.MEDIUM.min) return BANDS.MEDIUM;
  return BANDS.LOW;
}

/** Cards that may be auto-accepted in Fast Scan Mode. */
export function isAutoAcceptable(card) {
  return band(card.confidence, card.margin).key === 'HIGH' && card.flags.length === 0;
}

/** Plain value of a field, preferring a user correction. */
export function valueOf(card, field) {
  // Membership in USER_FIELDS, not in this card's own `user` object: a card
  // saved by an earlier version lacks keys for fields added since.
  if (USER_FIELDS.includes(field) && card.user?.[field] != null) return card.user[field];
  const f = card.fields[field];
  return f ? f.value : null;
}

/** Apply a user correction. User input is authoritative and never overwritten. */
export function correct(card, field, value) {
  const next = { ...card, fields: { ...card.fields }, user: { ...card.user } };
  if (USER_FIELDS.includes(field)) {
    next.user[field] = value === '' ? null : value;
  } else {
    next.fields[field] = extracted(value, 'user', 1, 'user correction');
  }
  next.flags = next.flags.filter((f) => f !== field);
  next.updatedAt = Date.now();
  return next;
}
