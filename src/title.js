// Listing title generation. See CLAUDE.md §6.
// The template is the user's. Empty tokens vanish cleanly; nothing is invented.

export const EBAY_TITLE_LIMIT = 80;

export const DEFAULT_TEMPLATE = '{year} {manufacturer} {set} {name} #{number} {variant} {language}';

export const TOKENS = [
  'year', 'manufacturer', 'brand', 'set', 'series', 'name', 'number',
  'variant', 'finish', 'edition', 'language', 'condition', 'grade', 'game',
];

/**
 * Render a title template against a card's values.
 * A token with no value is removed along with its adjacent literal decoration,
 * so "#{number}" leaves no orphan '#' and no double space.
 */
export function renderTitle(template, values, opts = {}) {
  const limit = opts.limit ?? EBAY_TITLE_LIMIT;

  let out = String(template).replace(/(\S*)\{(\w+)\}(\S*)/g, (whole, before, token, after) => {
    const v = values[token];
    if (v === null || v === undefined || v === '') return '';
    return `${before}${v}${after}`;
  });

  out = out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();

  const full = out;
  const truncated = out.length > limit;
  if (truncated) out = truncateAtWord(out, limit);

  return { title: out, truncated, full, length: out.length, limit };
}

/** Never cut mid-word — a title ending "Charizard Holo Fir" reads as damage. */
export function truncateAtWord(s, limit) {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Which tokens a template references, for the mapping UI. */
export function tokensUsed(template) {
  return [...String(template).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** Tokens a template uses that this app cannot supply. */
export function unknownTokens(template) {
  return tokensUsed(template).filter((t) => !TOKENS.includes(t));
}
