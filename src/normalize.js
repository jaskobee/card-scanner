// OCR text normalisation and field candidate extraction.
// Normalised text is for comparison only — the raw span is kept as evidence.

/** Fold case, diacritics and whitespace for comparison. */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// German cards keep ß distinct from ss in print but not in search intent.
export function foldDe(s) {
  return fold(s).replace(/ß/g, 'ss');
}

// Characters OCR habitually confuses, applied only inside digit contexts.
const DIGIT_CONFUSIONS = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2', G: '6', T: '7' };

export function digitsOnly(s) {
  return String(s ?? '')
    .split('')
    .map((c) => (/\d/.test(c) ? c : DIGIT_CONFUSIONS[c] ?? c))
    .join('');
}

/**
 * Find card-number candidates such as 4/102, 004/120, 011/195, SV049/SV122.
 * Returns the raw span (evidence) alongside the normalised parts.
 * Leading zeroes are preserved exactly — 004/120 is not 4/120.
 */
export function findCardNumbers(text) {
  const out = [];
  const re = /([A-Z]{0,3}\d{1,4}[a-z]?)\s*\/\s*([A-Z]{0,3}\d{1,4})/g;
  let m;
  // A slash is often read as a pipe or backslash. Swap one for one, so the
  // indices still line up with the original text kept as evidence.
  const slashed = String(text ?? '').replace(/(?<=[\dOoQDIlSsBZzGT])[|\\](?=[\dOoQDIlSsBZzGT])/g, '/');
  const fixed = digitsOnly(slashed);
  while ((m = re.exec(fixed)) !== null) {
    const raw = text.slice(m.index, m.index + m[0].length);
    out.push({
      value: `${m[1]}/${m[2]}`,
      numerator: m[1],
      denominator: m[2],
      raw,
      index: m.index,
    });
  }
  return out;
}

/** Four-digit years plausible for trading cards. */
export function findYears(text) {
  const out = [];
  const re = /\b(19[3-9]\d|20[0-4]\d)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ value: Number(m[1]), raw: m[0], index: m.index });
  return out;
}

/** Copyright lines are the most reliable year and publisher evidence on a card. */
export function findCopyright(text) {
  const m = /(?:©|\(c\)|copyright)\s*([0-9]{4})?\s*([A-Za-zÀ-ÿ'.\- ]{2,40})?/i.exec(text);
  if (!m) return null;
  return {
    year: m[1] ? Number(m[1]) : null,
    holder: m[2] ? m[2].trim() : null,
    raw: m[0].trim(),
  };
}

// Variant / finish vocabulary. These are printed or visually evident terms —
// never inferred from the absence of something.
export const VARIANT_TERMS = [
  ['reverse holo', ['reverse holo', 'reverse foil', 'rev holo']],
  ['holo', ['holo', 'holofoil', 'holographic']],
  ['first edition', ['1st edition', 'first edition', '1. auflage', 'edition 1']],
  ['unlimited', ['unlimited']],
  ['promo', ['promo', 'promotional', 'black star promo']],
  ['refractor', ['refractor']],
  ['prizm', ['prizm']],
  ['chrome', ['chrome']],
  ['foil', ['foil']],
  ['shadowless', ['shadowless']],
];

export function findVariantTerms(text) {
  const f = fold(text);
  const hits = [];
  for (const [canonical, aliases] of VARIANT_TERMS) {
    const alias = aliases.find((a) => f.includes(a));
    if (alias) hits.push({ value: canonical, raw: alias });
  }
  // 'reverse holo' contains 'holo' — keep the most specific hit only.
  if (hits.some((h) => h.value === 'reverse holo')) {
    return hits.filter((h) => h.value !== 'holo');
  }
  return hits;
}

const LANGUAGE_HINTS = [
  ['de', ['basis-set', 'grundschule', 'stufe 1', 'entwicklungsstufe', 'schaden', 'lebenspunkte', 'illustrator']],
  ['fr', ['niveau', 'illustrateur', 'points de vie', 'dégâts']],
  ['es', ['nivel', 'ilustrador', 'puntos de vida']],
  ['it', ['livello', 'illustratore', 'punti vita']],
  ['ja', []],
];

/** Language evidence from printed rules text. Returns null when unknown. */
export function guessLanguage(text) {
  if (/[぀-ヿ一-龯]/.test(text)) return { value: 'ja', raw: 'japanese script' };
  const f = fold(text);
  for (const [code, hints] of LANGUAGE_HINTS) {
    const hit = hints.find((h) => f.includes(h));
    if (hit) return { value: code, raw: hit };
  }
  return null;
}

/**
 * Levenshtein-based similarity, 0..1. Short-circuits on large length gaps so a
 * 500-card batch does not pay for hopeless comparisons.
 */
export function similarity(a, b) {
  const s = fold(a), t = fold(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  if (Math.abs(s.length - t.length) / Math.max(s.length, t.length) > 0.5) return 0;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

/** Split OCR output into trimmed, non-empty lines. */
export function lines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Hit points. Every Pokémon's HP is a multiple of ten, so a reading that is not
 * one is a misread, and is dropped rather than passed on as a guess.
 */
export function findHp(text) {
  const t = String(text ?? '');
  const m = /\b(?:HP|PS|PV|LP)\s*[:.]?\s*(\d{2,3})\b/i.exec(t) ?? /\b(\d{2,3})\s*(?:HP|PS|PV|LP)\b/i.exec(t);
  if (!m) return null;
  const hp = Number(m[1]);
  if (hp < 10 || hp > 340 || hp % 10 !== 0) return null;
  return { value: hp, raw: m[0] };
}

// --- card name ---------------------------------------------------------------
// The name is the hardest thing to pick out of OCR text, because the strip it
// sits in also holds stage labels, "Evolves from <another Pokémon>", the HP and
// whatever the artwork's edge looks like to a text reader.

const WORD = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*$/;
// Printed labels that sit beside a name without being part of it.
const LABEL = /^(?:basic|stage|stufe|grundphase|phase|niveau|pok[eé]mon|trainer|dresseur|hp|ps|pv|lp)$/i;
// Suffixes that ARE part of the name: "Charizard ex", "Pikachu VMAX".
const SUFFIX = /^(?:ex|gx|v|vmax|vstar|vunion|break|prime|star)$/i;
const TITLE = /^(?:mr|dr|jr)\.?$/i;
const SHORT_NAMES = /^(?:mew|muk|ho-oh)$/i;
// A line about a different Pokémon. Taking a name from it would be a wrong answer.
const ABOUT_ANOTHER = /\b(?:evolves?\s+(?:from|de|aus)|put\s+.+\s+on\s+the|entwickelt|[eé]volue)\b/i;

function nameFromLine(line) {
  const kept = line
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9.'’]+$/g, ''))
    .filter((t) => WORD.test(t) && !LABEL.test(t)
      && (t.length >= 4 || SUFFIX.test(t) || TITLE.test(t) || SHORT_NAMES.test(t)));
  // A suffix or title alone is not a name.
  if (!kept.some((t) => !SUFFIX.test(t) && !TITLE.test(t))) return null;
  return kept.join(' ');
}

/**
 * The card name from the top of the card. Position beats length: names come
 * first, while junk and rules text can be any length anywhere.
 */
export function pickName(text) {
  let best = null;
  lines(text).slice(0, 8).forEach((line, i) => {
    if (ABOUT_ANOTHER.test(line)) return;
    const value = nameFromLine(line);
    if (!value) return;
    const score = 10 - i * 2.5 + Math.min(value.replace(/[^A-Za-zÀ-ÿ]/g, '').length, 12) * 0.3;
    if (!best || score > best.score) best = { value, raw: line, score };
  });
  return best;
}

/**
 * How well `needle` appears somewhere inside `haystack`, 0..1. The text around
 * a name is full of junk — HP, symbols, a stage label — so comparing a whole
 * line to the name punishes a correct read. This looks for the name inside it.
 * Very short needles must match exactly: they would fuzzy-match almost anything.
 */
export function containsFuzzy(haystack, needle) {
  const h = fold(haystack), n = fold(needle);
  if (!n || !h) return 0;
  if (h.includes(n)) return 1;
  if (n.length < 4) return 0;
  let best = 0;
  for (const len of [n.length - 1, n.length, n.length + 1]) {
    if (len > h.length) continue;
    for (let i = 0; i + len <= h.length; i++) {
      best = Math.max(best, similarity(h.slice(i, i + len), n));
      if (best === 1) return 1;
    }
  }
  return best;
}

/**
 * The text with any "Evolves from <another Pokémon>" lines removed. Matching a
 * candidate's name against text that mentions a different Pokémon would let the
 * wrong card score as a perfect match.
 */
export function withoutEvolutionLines(text) {
  return lines(text).filter((l) => !ABOUT_ANOTHER.test(l)).join('\n');
}
