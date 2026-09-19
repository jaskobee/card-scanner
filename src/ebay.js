// What eBay means by a single trading card. See docs/ebay-card-listings.md for
// how each fact here was checked, and which could not be.
//
// This file holds the parts of an eBay upload that are DATA, numbers eBay
// assigned, and not the layout of the file. The layout (column names, their
// order, the info line above them) comes from the template the user downloads,
// because eBay changes it and refuses files that alter it.
//
// Nothing here guesses. A value we cannot place is null, and the caller says so.

// --- what kind of card ---------------------------------------------------------

/** Category IDs for single cards, eBay Germany (183454 and 183050 confirmed on ebay.de). */
export const CARD_TYPES = {
  ccg: { id: 183454, label: 'Trading card game', hint: 'Pokémon, Magic, Yu-Gi-Oh!' },
  sports: { id: 261328, label: 'Sports card', hint: 'football, basketball, baseball' },
  nonsport: { id: 183050, label: 'Non-sport card', hint: 'film, TV, celebrities, music' },
};

export const isCardType = (t) => Object.hasOwn(CARD_TYPES, t);

/**
 * Which kind of card this is. The user's choice always wins. Otherwise a card the
 * database identified as belonging to a card game is a trading-card-game card,
 * and one with a sport recorded is a sports card. Anything else is unknown, and
 * an unknown card type is a question for the user, never a default.
 */
export function cardTypeOf(get) {
  const chosen = String(get('cardType') ?? '').trim();
  if (isCardType(chosen)) return { type: chosen, from: 'you' };
  if (get('game')) return { type: 'ccg', from: 'game' };
  if (get('sport')) return { type: 'sports', from: 'sport' };
  return null;
}

// --- condition -----------------------------------------------------------------
// Since 23 Oct 2023 a single card is either graded or ungraded, never a plain
// condition. Graded is Condition ID 2750, ungraded 4000, and each carries its
// own descriptors.

export const CONDITION_ID = { graded: 2750, ungraded: 4000 };

/** Ungraded "Card Condition" (descriptor 40001). eBay offers exactly these four. */
export const UNGRADED_CONDITIONS = [
  { id: 400010, en: 'Near mint or better', de: 'So gut wie neu' },
  { id: 400011, en: 'Excellent', de: 'Exzellent' },
  { id: 400012, en: 'Very good', de: 'Sehr gut' },
  { id: 400013, en: 'Poor', de: 'Schlecht' },
];

// "Near Mint" was an option in an earlier version of this app and is the same
// thing as eBay's first level with the qualifier dropped. Nothing else is
// translated: "Good" and "Played" have no eBay equivalent, so they stay unplaced.
const LEGACY_CONDITION = { 'near mint': 400010 };

/** Professional graders eBay lists (descriptor 27501). CGC is not among them. */
export const GRADERS = [
  { id: 275010, name: 'Professional Sports Authenticator', short: 'PSA' },
  { id: 275011, name: 'Beckett Collectors Club Grading', short: 'BCCG' },
  { id: 275012, name: 'Beckett Vintage Grading', short: 'BVG' },
  { id: 275013, name: 'Beckett Grading Services', short: 'BGS' },
  { id: 275014, name: 'Certified Sports Guaranty', short: 'CSG' },
  { id: 275016, name: 'Sportscard Guaranty Corporation', short: 'SGC' },
  { id: 275017, name: 'K Sportscard Authentication', short: 'KSA' },
  { id: 275018, name: 'Gem Mint Authentication', short: 'GMA' },
  { id: 275019, name: 'Hybrid Grading Approach', short: 'HGA' },
  { id: 2750110, name: 'International Sports Authentication', short: 'ISA' },
  { id: 2750112, name: 'Gold Standard Grading', short: 'GSG' },
  { id: 2750113, name: 'Platin Grading Service', short: 'PGS' },
  { id: 2750114, name: 'MNT Grading', short: 'MNT' },
  { id: 2750115, name: 'Technical Authentication & Grading', short: 'TAG' },
  { id: 2750116, name: 'Rare Edition', short: null },
  { id: 2750117, name: 'Revolution Card Grading', short: 'RCG' },
  { id: 2750120, name: 'Card Grading Australia', short: 'CGA' },
  { id: 2750121, name: 'Trading Card Grading', short: 'TCG' },
  { id: 2750123, name: 'Other', short: null },
];

/** Grades (descriptor 27502), as eBay writes them. */
export const GRADES = [
  ['10', 275020], ['9.5', 275021], ['9', 275022], ['8.5', 275023], ['8', 275024],
  ['7.5', 275025], ['7', 275026], ['6.5', 275027], ['6', 275028], ['5.5', 275029],
  ['5', 2750210], ['4.5', 2750211], ['4', 2750212], ['3.5', 2750213], ['3', 2750214],
  ['2.5', 2750215], ['2', 2750216], ['1.5', 2750217], ['1', 2750218],
  ['Authentic', 2750219], ['Authentic Altered', 2750220],
  ['Authentic - Trimmed', 2750221], ['Authentic - Colored', 2750222],
].map(([label, id]) => ({ label, id }));

// --- looking values up -----------------------------------------------------------

const plain = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The eBay ID for an ungraded condition, from eBay's English or German label. Null if it is not one. */
export function ungradedConditionId(text) {
  const t = plain(text);
  if (!t) return null;
  const hit = UNGRADED_CONDITIONS.find((c) => plain(c.en) === t || plain(c.de) === t);
  return hit?.id ?? LEGACY_CONDITION[t] ?? null;
}

/** The eBay ID for a grader, from its full name or its usual abbreviation. Null if eBay does not list it. */
export function graderId(text) {
  const t = plain(text);
  if (!t) return null;
  return GRADERS.find((g) => plain(g.name) === t || (g.short && plain(g.short) === t))?.id ?? null;
}

/**
 * The eBay ID for a grade. Takes what a person writes ("9", "9.5", "PSA 10",
 * "Gem Mint 10") and reads the number, or "Authentic" and its variants.
 */
export function gradeId(text) {
  const t = plain(text);
  if (!t) return null;
  const words = GRADES.find((g) => plain(g.label) === t);
  if (words) return words.id;
  const nums = t.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  const n = String(Number(nums[nums.length - 1]));
  return GRADES.find((g) => g.label === n)?.id ?? null;
}

const YES = /^(yes|y|true|ja|graded|bewertet)$/i;
const NO = /^(no|n|false|nein|ungraded|unbewertet)$/i;

/**
 * Graded, ungraded, or not yet said. What the user chose wins. Otherwise a card
 * with a grader or a grade filled in is graded, and one with only a condition is
 * ungraded. A card with neither is left undecided rather than assumed.
 */
export function isGraded(get) {
  const said = get('graded');
  if (said === true || YES.test(String(said ?? ''))) return true;
  if (said === false || NO.test(String(said ?? ''))) return false;
  if (get('gradingCompany') || get('grade')) return true;
  if (get('condition')) return false;
  return null;
}

/**
 * Everything eBay wants to know about one card, with what could not be worked
 * out listed in `problems` so the export can say what to fix.
 * @param {(field: string) => *} get reads one field of the card
 */
export function ebayCardValues(get) {
  const problems = [];

  const type = cardTypeOf(get);
  if (!type) problems.push('card type');

  const graded = isGraded(get);
  let conditionId = null, cardCondition = null, grader = null, grade = null, certNumber = null;

  if (graded === true) {
    conditionId = CONDITION_ID.graded;
    grader = graderId(get('gradingCompany'));
    if (grader == null) problems.push(get('gradingCompany') ? 'grader (not one eBay lists)' : 'grader');
    grade = gradeId(get('grade'));
    if (grade == null) problems.push(get('grade') ? 'grade (not one eBay lists)' : 'grade');
    const cert = String(get('certNumber') ?? '').trim();
    certNumber = cert === '' ? null : cert;
  } else if (graded === false) {
    conditionId = CONDITION_ID.ungraded;
    cardCondition = ungradedConditionId(get('condition'));
    if (cardCondition == null) problems.push(get('condition') ? 'condition (not one eBay lists for cards)' : 'condition');
  } else {
    problems.push('graded or not');
  }

  return {
    type, categoryId: type ? CARD_TYPES[type.type].id : null,
    graded, conditionId, cardCondition, grader, grade, certNumber, problems,
  };
}

// --- reading a template's headers -------------------------------------------------

const DESCRIPTOR_BY_ID = { 40001: 'cardConditionId', 27501: 'graderId', 27502: 'gradeId', 27503: 'certificationNumber' };
const DESCRIPTOR_BY_WORDS = {
  'card condition': 'cardConditionId',
  'professional grader': 'graderId',
  grade: 'gradeId',
  'certification number': 'certificationNumber',
};

/**
 * Which card descriptor a template column is, or null. eBay names these
 * `CD:Card Condition - (ID: 40001)` (or `CD:40001`), and the ID is the same in
 * every language, so the ID is read first and the words only as a fallback.
 * German wording is deliberately not guessed at.
 */
export function descriptorField(header) {
  const h = String(header ?? '').trim();
  if (!/^CDA?:/i.test(h)) return null;
  const id = /\(ID:\s*(\d+)\)/i.exec(h)?.[1] ?? /^CDA?:\s*(\d+)\s*$/i.exec(h)?.[1];
  if (id && DESCRIPTOR_BY_ID[id]) return DESCRIPTOR_BY_ID[id];
  const words = plain(h.replace(/^CDA?:/i, '').replace(/\(ID:[^)]*\)/i, ''));
  return DESCRIPTOR_BY_WORDS[words] ?? null;
}

// --- the starter template -----------------------------------------------------------
// A best-effort DRAFT template for people who have not downloaded one. It uses
// only column names that eBay's own help pages give, and leaves out the item
// specifics, whose German names could not be verified. It is not eBay's file,
// eBay may reject it, and the interface says so. See docs/ebay-card-listings.md.

export const ACTION_HEADER = 'Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8)';

export const STARTER = {
  label: 'Starter for eBay Germany (unverified)',
  info: '#INFO Version=0.0.2 Template= eBay-draft-listings-template_DE',
  headers: [
    ACTION_HEADER, 'Category ID', 'Title', 'Condition ID',
    'CD:Card Condition - (ID: 40001)', 'CD:Professional Grader - (ID: 27501)',
    'CD:Grade - (ID: 27502)', 'CDA:Certification Number - (ID: 27503)',
    'Start price', 'Quantity', 'Format', 'Duration', 'Description', 'Item photo URL',
  ],
  // For a draft eBay makes only these two mandatory.
  required: [ACTION_HEADER, 'Category ID'],
  // Not needed to create a draft, but needed before it can be published.
  recommended: ['Title', 'Condition ID', 'Start price', 'Quantity'],
};

/** The starter as a template object, in the same shape parseTemplate returns. */
export function starterTemplate() {
  return {
    delimiter: ',',
    headers: [...STARTER.headers],
    preamble: [[STARTER.info]],
    sampleRows: [],
    required: [...STARTER.required],
    recommended: [...STARTER.recommended],
    columnCount: STARTER.headers.length,
    starter: true,
  };
}

// --- values eBay expects that are not about the card -----------------------------------

export const ACTIONS = [
  // Older eBay guides recommend checking a first upload this way. Whether the
  // current Seller Hub accepts it is unverified, hence the way out in the label.
  { value: 'VerifyAdd', label: 'Check only, nothing is created (if eBay rejects this, use Create)' },
  { value: 'Add', label: 'Create the listings' },
];

// eBay Germany's guide: Format defaults to Auction when left blank, so it is always written out.
export const FORMATS = [
  { value: 'FixedPrice', label: 'Fixed price' },
  { value: 'Auction', label: 'Auction' },
];

export const DURATIONS = [
  { value: 'GTC', label: 'Until cancelled' },
  { value: '30', label: '30 days' },
  { value: '10', label: '10 days' },
  { value: '7', label: '7 days' },
];

/** eBay Germany's own descriptions cannot hold line breaks; it asks for <br>. */
export function singleLine(text) {
  return String(text ?? '').replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * A price for the file. Anything that is not a plain amount is refused (null),
 * because a price is money and is never guessed at. `mark` is the decimal mark
 * the file should use.
 */
export function formatPrice(text, mark = '.') {
  const s = String(text ?? '').trim().replace(/\s|€|eur/gi, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(s)) return null;
  const [whole, cents = ''] = s.split(/[.,]/);
  return cents === '' ? whole : `${whole}${mark}${cents.padEnd(2, '0')}`;
}
