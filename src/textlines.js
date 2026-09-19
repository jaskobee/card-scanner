// Reading a card that is not in any database, from its text alone.
// Pure functions over words and their positions, so they are unit tested with
// real Tesseract output and no browser.
//
// A trading card database can vouch for a Pokémon card. Nothing can vouch for a
// wrestling card or a basketball rookie, so all that is available is what is
// printed on it. That is enough for a name, a brand, a year and a number when the
// text is found, and the rules here are deliberately about *finding the right
// text*, never about guessing what the card is.
//
// A word is { text, confidence (0..1), x0, y0, x1, y1 } in the pixels of the
// upright card.

// --- vocabulary ----------------------------------------------------------------
// Used two ways: to keep a brand or a league from being taken for a name, and to
// recognise a manufacturer or a product line when the card literally says so.
// Nothing is filled in from this list unless OCR read the word off the card.

export const MANUFACTURERS = {
  topps: 'Topps', panini: 'Panini', 'upper deck': 'Upper Deck', donruss: 'Donruss', fleer: 'Fleer',
  leaf: 'Leaf', score: 'Score', bowman: 'Bowman', skybox: 'SkyBox', pacific: 'Pacific', playoff: 'Playoff',
  pinnacle: 'Pinnacle', 'o-pee-chee': 'O-Pee-Chee', 'press pass': 'Press Pass', futera: 'Futera',
  cryptozoic: 'Cryptozoic', rittenhouse: 'Rittenhouse', konami: 'Konami',
};

export const PRODUCTS = {
  chrome: 'Chrome', prizm: 'Prizm', select: 'Select', optic: 'Optic', mosaic: 'Mosaic', heritage: 'Heritage',
  'stadium club': 'Stadium Club', finest: 'Finest', sapphire: 'Sapphire', chronicles: 'Chronicles',
  absolute: 'Absolute', certified: 'Certified', contenders: 'Contenders', origins: 'Origins',
  revolution: 'Revolution', 'crown royale': 'Crown Royale', 'court kings': 'Court Kings', hoops: 'Hoops',
  flawless: 'Flawless', immaculate: 'Immaculate', 'national treasures': 'National Treasures', noir: 'Noir',
  obsidian: 'Obsidian', phoenix: 'Phoenix', spectra: 'Spectra', illusions: 'Illusions',
  'allen & ginter': 'Allen & Ginter', 'gypsy queen': 'Gypsy Queen', archives: 'Archives', tribute: 'Tribute',
  inception: 'Inception', luminance: 'Luminance',
};

/** A league on a card. Sport is filled in only where the league makes it certain. */
export const LEAGUES = {
  nfl: { league: 'NFL', sport: 'Football' }, nba: { league: 'NBA', sport: 'Basketball' },
  wnba: { league: 'WNBA', sport: 'Basketball' }, mlb: { league: 'MLB', sport: 'Baseball' },
  nhl: { league: 'NHL', sport: 'Hockey' }, mls: { league: 'MLS', sport: 'Soccer' },
  nascar: { league: 'NASCAR', sport: 'Racing' }, ufc: { league: 'UFC', sport: 'MMA' },
  // Wrestling is entertainment rather than sport as far as a marketplace category
  // goes, and that is the seller's call, so the league is recorded and nothing more.
  wwe: { league: 'WWE', sport: null }, aew: { league: 'AEW', sport: null },
};

/** Finishes that are a parallel in their own right. A product line ("Chrome") is not one. */
export const FINISHES = [
  'superfractor', 'xfractor', 'x-fractor', 'refractor', 'holofoil', 'holo', 'foil', 'shimmer', 'mojo',
  'atomic', 'pulsar', 'sparkle', 'lazer', 'cracked ice', 'rainbow',
];

// Words that sit on a card without naming anyone.
const NOT_A_NAME = new Set([
  'rookie', 'rc', 'card', 'cards', 'trading', 'licensed', 'product', 'official', 'series', 'edition', 'limited',
  'autograph', 'auto', 'signature', 'jersey', 'patch', 'relic', 'base', 'insert', 'allstar', 'all-star',
  'draft', 'picks', 'future', 'stars', 'legends', 'legend', 'hall', 'fame', 'champion', 'mvp', 'pts', 'reb',
  'ast', 'sp', 'ssp', 'the', 'company', 'inc', 'llc', 'ltd', 'rights', 'reserved', 'made', 'usa', 'all',
  'guard', 'forward', 'center', 'centre', 'pitcher', 'catcher', 'quarterback', 'receiver', 'defense',
  'striker', 'midfielder', 'goalkeeper', 'wrestler', 'champion', 'superstar', 'superstars',
]);

const plain = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9&'.\- ©#/]+/g, ' ').replace(/\s+/g, ' ').trim();

const isVocabulary = (token) =>
  Object.hasOwn(MANUFACTURERS, token) || Object.hasOwn(PRODUCTS, token) || Object.hasOwn(LEAGUES, token)
  || FINISHES.includes(token) || NOT_A_NAME.has(token);

// --- words into lines ------------------------------------------------------------

/** A word without the stray marks the reader hangs on it: „JORDAN and ELLIS, are JORDAN and ELLIS. */
export function cleanWord(text) {
  return String(text ?? '').trim().replace(/^[^A-Za-z0-9À-ÿ#©]+/, '').replace(/[^A-Za-z0-9À-ÿ.!?]+$/, '').replace(/[.!?]+$/, (m) => (m === '.' ? '.' : ''));
}

/**
 * A line with the junk taken off its ends: a lone letter is not part of a name, and
 * neither is a brand word that happens to share the row. "KESTREL a" is KESTREL,
 * "JORDAN ELLIS TOPPS" is JORDAN ELLIS. A single initial is kept when it has its
 * full stop ("A.J. GREEN").
 */
export function tidyName(text) {
  const junk = (t) => {
    const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    return letters.length === 0 || (letters.length === 1 && !t.includes('.')) || isVocabulary(plain(t));
  };
  const tokens = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  while (tokens.length && junk(tokens[0])) tokens.shift();
  while (tokens.length && junk(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

const height = (w) => w.y1 - w.y0;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
// Of two heights, the smaller: a box that is too big is far likelier than one too small.
const lowerMedian = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : 0; };

/**
 * Two readings of the same place. Judged by where the text sits along the row and
 * how high it is, not by how much the boxes overlap: a reading of the same word
 * can come back with a box twice as tall, and a fragment of a word ("JORDAN") sits
 * wholly inside the whole word's ("JORDANELLIS").
 */
function samePlace(a, b) {
  const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  if (across < 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) return false;
  const apart = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  return apart < 0.6 * Math.max(height(a), height(b));
}

/**
 * Words from overlapping reads (the same strip read twice, light on dark and dark
 * on light) collapse to one. Where two readings claim the same place the more
 * trustworthy one wins, and a longer reading beats a fragment of itself.
 */
export function dedupeWords(words) {
  const usable = words
    .map((w) => ({ ...w, text: cleanWord(w.text) }))
    .filter((w) => w.bbox !== null && /[A-Za-z0-9]/.test(w.text) && w.x1 > w.x0 && w.y1 > w.y0);
  const ranked = usable.sort((a, b) => b.confidence * Math.sqrt(b.text.length) - a.confidence * Math.sqrt(a.text.length));
  const kept = [];
  for (const w of ranked) if (!kept.some((k) => samePlace(k, w))) kept.push(w);
  return kept;
}

/**
 * Words that belong on one line of type, left to right, with the line's size and
 * confidence. Words are first sorted into rows by how high up they are, judged
 * against the smaller of the two heights so that one oversized junk word cannot
 * stretch the tolerance and swallow its neighbours, then each row is cut wherever
 * there is a real gap, so two pieces of text at the same height stay apart.
 */
export function groupIntoLines(words) {
  const rows = [];
  for (const w of [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))) {
    const cy = (w.y0 + w.y1) / 2;
    const row = rows.find((r) => Math.abs(cy - r.cy) < 0.5 * Math.min(height(w), r.h));
    if (row) {
      row.words.push(w);
      row.cy = row.words.reduce((n, x) => n + (x.y0 + x.y1) / 2, 0) / row.words.length;
      row.h = Math.min(row.h, height(w));
    } else {
      rows.push({ words: [w], cy, h: height(w) });
    }
  }

  const lines = [];
  for (const row of rows) {
    const ws = row.words.sort((a, b) => a.x0 - b.x0);
    let line = [ws[0]];
    for (const w of ws.slice(1)) {
      const prev = line[line.length - 1];
      const gap = w.x0 - prev.x1;
      if (gap > 2.2 * Math.min(height(w), height(prev))) { lines.push(fromWords(line)); line = [w]; } else line.push(w);
    }
    lines.push(fromWords(line));
  }
  return lines.sort((a, b) => a.y0 - b.y0);
}

function fromWords(words) {
  const l = { words };
  update(l);
  return l;
}

function update(line) {
  const ws = line.words;
  line.x0 = Math.min(...ws.map((w) => w.x0)); line.x1 = Math.max(...ws.map((w) => w.x1));
  line.y0 = Math.min(...ws.map((w) => w.y0)); line.y1 = Math.max(...ws.map((w) => w.y1));
  line.height = lowerMedian(ws.map(height));
  const weight = ws.reduce((n, w) => n + w.text.length, 0) || 1;
  line.confidence = ws.reduce((n, w) => n + w.confidence * w.text.length, 0) / weight;
  // "NLE SE" averaged to 53% because "NLE" was 73% sure and "SE" 22%, and the 22% was
  // stripe pattern. The average hides that; the weakest word does not.
  line.weakest = Math.min(...ws.map((w) => w.confidence));
  line.text = [...ws].sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' ');
}

/**
 * Put a space where letters are far apart. Italic capitals set close together
 * come back from Tesseract as one word ("JORDANELLIS"), but the gap between the
 * two names is still there in the letter boxes: wider than the gaps inside words,
 * both in itself and relative to the size of the letters.
 */
export function spaceByGaps(symbols, lineHeight) {
  const s = [...symbols].filter((x) => x.bbox && x.text?.trim()).sort((a, b) => a.bbox.x0 - b.bbox.x0);
  if (s.length < 2) return s.map((x) => x.text).join('');
  const gaps = s.slice(1).map((x, i) => x.bbox.x0 - s[i].bbox.x1);
  const typical = Math.max(1, median(gaps.filter((g) => g > -lineHeight * 0.5)));
  // A hyphen, apostrophe or full stop is small and sits with a gap on either side
  // of it, which is not a word break: "TANAKA-REYES", "DE'ANDRE", "MR. T".
  const joiner = (t) => /^[-–'’.]$/.test(t);

  // Every gap wide enough to be a word break, widest first. Slanted letters overlap,
  // so a narrow gap inside a word can pass the test too: "JORDA NELLIS" had a gap of 9
  // before the N and 17 before the E, and taking them in reading order let the smaller
  // one win. The widest are believed first.
  const candidates = gaps
    .map((g, k) => ({ g, at: k + 1 }))
    .filter(({ g, at }) => g > 0.14 * lineHeight && g > 2.6 * typical && !joiner(s[at].text) && !joiner(s[at - 1].text))
    .sort((a, b) => b.g - a.g);

  // No break may strand a single letter between two others ("TOBIAS" is not
  // "TO B IAS"): a word of one letter is far likelier a mis-split.
  const breaks = [];
  for (const { at } of candidates) {
    const before = Math.max(0, ...breaks.filter((b) => b < at));
    const after = Math.min(s.length, ...breaks.filter((b) => b > at));
    if (at - before >= 2 && after - at >= 2) breaks.push(at);
  }
  return s.map((x, i) => (breaks.includes(i) ? ' ' : '') + x.text).join('');
}

// --- the name --------------------------------------------------------------------

/** How much a line looks like a person's name, 0..1. */
export function nameLikeness(text) {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  const tokens = t.split(/\s+/);
  if (tokens.length > 4) return 0;
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '').length;
  // The marks a name may contain (De'Andre, Tanaka-Reyes, A.J.) do not count against it.
  if (letters < 4 || letters / t.replace(/[\s'’.\-]/g, '').length < 0.9) return 0;
  if (tokens.some((x) => !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.\-]*$/.test(x))) return 0;
  if (!tokens.some((x) => x.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3)) return 0;
  const cased = t === t.toUpperCase() || tokens.every((x) => /^[A-ZÀ-Þ]/.test(x));
  let score = cased ? 0.7 : 0.3;
  if (tokens.length >= 2) score += 0.3;
  return Math.min(1, score);
}

const containsVocabulary = (text) => {
  const p = plain(text);
  const tokens = p.split(' ');
  if (tokens.some(isVocabulary)) return true;
  return Object.keys(MANUFACTURERS).concat(Object.keys(PRODUCTS)).some((v) => v.includes(' ') && p.includes(v));
};

/**
 * The lines most likely to be a person's name, best first.
 *
 * The name is usually the biggest lettering on the front, and usually sits on a
 * nameplate low on the card or a banner high on it, but neither is certain: a team
 * name can be as big, and a giant faint decoration bigger. So size, how sure the
 * reading is, whether it looks like a name and where it sits all count, and a line
 * made of brand or league words is not a candidate at all.
 *
 * @param {Array} lines from groupIntoLines
 * @param {number} cardHeight the height of the upright card, in pixels
 */
export function rankNames(lines, cardHeight) {
  const pool = [...lines];
  // Two lines of the same size stacked closely are one name set on two lines.
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    const sameSize = Math.abs(a.height - b.height) < 0.45 * Math.max(a.height, b.height);
    const close = b.y0 - a.y1 < 0.9 * Math.max(a.height, b.height);
    const aligned = Math.abs(a.x0 - b.x0) < 2.5 * Math.max(a.height, b.height);
    const words = `${tidyName(a.text)} ${tidyName(b.text)}`.trim().split(/\s+/).filter(Boolean).length;
    // A first name over a surname, not a name over a team: at most three words in all,
    // and both lines have to be plausible in their own right.
    const both = nameLikeness(tidyName(a.text)) > 0 && nameLikeness(tidyName(b.text)) > 0 && a.confidence >= 0.5 && b.confidence >= 0.5;
    if (sameSize && close && aligned && words <= 3 && both) {
      pool.push({ text: `${a.text} ${b.text}`, height: Math.max(a.height, b.height), confidence: Math.min(a.confidence, b.confidence), weakest: Math.min(a.weakest ?? a.confidence, b.weakest ?? b.confidence), y0: a.y0, y1: b.y1, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), joined: true });
    }
  }

  return pool
    .map((l) => {
      const text = tidyName(l.text);
      const likeness = nameLikeness(text);
      if (likeness === 0 || containsVocabulary(text)) return null;
      const size = Math.min(1, l.height / (0.05 * cardHeight));
      const at = (l.y0 + l.y1) / 2 / cardHeight;
      // A nameplate low on the card and a banner high on it are equally likely homes
      // for a name, so neither is favoured over the other.
      const place = (at > 0.7 && at < 0.95) || (at > 0.03 && at < 0.2) ? 0.09 : 0;
      // Whether this is lettering at all, which is a different question from whether it is
      // the name. On real cards lettering reads 80 to 95 percent sure and the patterns that
      // pass for it (stripes, logos) 20 to 55, so confidence counts for nothing once it is
      // high enough: a team name read at 95 is not a better name than a player read at 85.
      // The least certain word counts a little on its own, but never rules a line out: a
      // real name can have one word read at 28 percent, and only reading it again settles that.
      const sure = 0.7 * l.confidence + 0.3 * (l.weakest ?? l.confidence);
      const lettering = Math.max(0, Math.min(1, (sure - 0.4) / 0.4));
      const score = 0.4 * size + 0.3 * lettering + 0.2 * likeness + place + (l.joined ? 0.09 : 0);
      return { text, score, confidence: l.confidence, height: l.height, line: l };
    })
    .filter((c) => c && c.confidence >= 0.35 && c.height >= 0.012 * cardHeight)
    .sort((a, b) => b.score - a.score);
}

// --- everything else printed on the card ---------------------------------------------

/**
 * Brand, product line, league, year and numbers, wherever the text says them.
 * Each carries the exact text it came from. A word that merely resembles a
 * manufacturer inside a sentence is not enough: the line has to be short and made
 * of brand words, or say "©", as a logo or a legal line does.
 */
export function readEvidence(lines) {
  const found = {};
  const note = (key, value, raw, confidence) => {
    if (!found[key] || found[key].confidence < confidence) found[key] = { value, raw, confidence };
  };

  for (const l of lines) {
    const p = plain(l.text);
    const words = p.split(' ').filter(Boolean);
    const legal = /©|\(c\)|copyright/.test(p);
    const brandish = words.length <= 6 || legal;

    if (brandish) {
      for (const [k, v] of Object.entries(MANUFACTURERS)) if (new RegExp(`(^|[ ©])${k.replace(/[-\s]/g, '[- ]')}($|[ ,.])`).test(p)) note('manufacturer', v, l.text, l.confidence);
      for (const [k, v] of Object.entries(PRODUCTS)) if (new RegExp(`(^|[ ©])${k.replace(/\s/g, ' ')}($|[ ,.])`).test(p)) note('product', v, l.text, l.confidence);
    }
    for (const w of words) if (Object.hasOwn(LEAGUES, w)) note('league', LEAGUES[w], l.text, l.confidence);
    for (const f of FINISHES) if (new RegExp(`(^|[ ])${f}($|[ ])`).test(p)) note('finish', f, l.text, l.confidence);

    // A year is believed when the line says ©, or names a manufacturer beside it.
    const year = /\b(19[3-9]\d|20[0-4]\d)\b/.exec(p);
    if (year && (legal || Object.keys(MANUFACTURERS).some((m) => p.includes(m)))) {
      const ys = [...p.matchAll(/\b(19[3-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
      note('year', Math.max(...ys), l.text, l.confidence);
    }

    const number = /(?:^|\s)(?:#|no\.?|nr\.?)\s*(\d{1,4}[a-z]?)(?:\s|$)/.exec(p);
    if (number && !legal) note('number', number[1].toUpperCase(), l.text, l.confidence);

    // "37/99" on a card is usually a print run, the serial of a numbered parallel,
    // not the card's own number. Recorded as what it is.
    const serial = /(?:^|\s)(\d{1,4})\s*\/\s*(\d{1,4})(?:\s|$)/.exec(p);
    if (serial && !legal && Number(serial[1]) <= Number(serial[2]) && Number(serial[2]) >= 2) note('serial', `${serial[1]}/${serial[2]}`, l.text, l.confidence);
  }
  return found;
}

const lettersOf = (t) => String(t ?? '').replace(/[^A-Za-zÀ-ÿ0-9]/g, '').toLowerCase();
const spaces = (t) => (String(t ?? '').match(/ /g) ?? []).length;

/**
 * Choose among further readings of a line. A single-line reading recovers word
 * spaces the first pass lost, and it can also drop a letter or split at a hyphen.
 * So a reading is preferred, in order:
 *   1. if the first reading is in capitals and this is the same letters with spaces
 *      put back (JORDANELLIS to JORDAN ELLIS): that is the first reading, corrected,
 *      and the most sure of those wins. Only capitals: tightly set italic capitals are
 *      what run together, and in ordinary type a gap inside a word is only a gap
 *      ("Regigigas" was split into "Regigi gas");
 *   2. otherwise the reading that looks most like a printed line, if it beats the
 *      first;
 *   3. otherwise the first reading, untouched.
 * A reading that is only part of a first reading that was already sure is ignored: a crop
 * that cut the line short reads its remainder confidently.
 * @param {{text: string, confidence: number}} original
 * @param {Array<{text: string, confidence: number}|null>} readings
 */
export function pickReading(original, readings) {
  // A reading that is only part of a good first reading is a crop that cut the line short,
  // not a correction: "ENA OKA" (95% sure) was read from a crop of "LENA OKAFOR" (93%).
  const first = lettersOf(original.text);
  const cutShort = (r) => original.confidence >= 0.8 && lettersOf(r.text).length < first.length && first.includes(lettersOf(r.text));
  const usable = (readings ?? []).filter((r) => r && r.text && !cutShort(r));
  const capitals = /[A-ZÀ-Þ]/.test(original.text) && original.text === original.text.toUpperCase();
  // Of the readings that put spaces back, the spacing most of them agree on wins, and the
  // most sure of those breaks a tie. One stray reading that splits a word ("SOFIA MA RINO")
  // must not beat the four that did not.
  const votes = new Map();
  if (capitals) {
    for (const r of usable) {
      if (lettersOf(r.text) !== lettersOf(original.text) || spaces(r.text) <= spaces(original.text) || nameLikeness(r.text) === 0) continue;
      const v = votes.get(r.text) ?? { text: r.text, n: 0, confidence: 0 };
      v.n += 1; v.confidence = Math.max(v.confidence, r.confidence);
      votes.set(r.text, v);
    }
  }
  const respaced = [...votes.values()].sort((a, b) => b.n - a.n || b.confidence - a.confidence)[0] ?? null;
  if (respaced) return { text: respaced.text, confidence: Math.max(original.confidence, respaced.confidence), weakest: respaced.confidence };

  const quality = (r) => r.confidence * nameLikeness(r.text);
  const best = usable.sort((a, b) => quality(b) - quality(a))[0];
  return best && quality(best) > quality(original) ? { text: best.text, confidence: best.confidence, weakest: best.confidence } : original;
}

/** The two-reading form of pickReading. */
export const betterReading = (original, again) => pickReading(original, [again]);
