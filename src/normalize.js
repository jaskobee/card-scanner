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
  const fixed = digitsOnly(text);
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
