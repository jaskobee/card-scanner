import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dedupeWords, groupIntoLines, spaceByGaps, nameLikeness, rankNames, readEvidence, betterReading, pickReading, cleanWord, tidyName,
} from '../src/textlines.js';

// The numbers below are what Tesseract really returned for synthetic cards drawn
// like a chrome wrestling card: a name plate low on the card, a stylised brand
// logo, decoy text. The card is 1000 x 1400 pixels.
const H = 1400;

// A word from its height as a % of the card, where its centre sits (% of card
// height) and how far in from the left it starts.
const word = (text, conf, hPct, yPct, x0 = 100, width = null) => {
  const h = (hPct / 100) * H, cy = (yPct / 100) * H;
  return { text, confidence: conf / 100, bbox: {}, x0, x1: x0 + (width ?? Math.max(20, text.length * h * 0.6)), y0: cy - h / 2, y1: cy + h / 2 };
};

// --- the name, among everything else ---------------------------------------------------

test('a name on a plate low on the card is found among logos and junk', () => {
  const words = [
    word('JORDAN ELLIS', 89, 5.2, 90, 150), word('°c', 45, 3.8, 44), word('HRC', 87, 3.3, 8, 100),
    word('NJ', 44, 3.3, 44), word('90', 66, 3.2, 44), word('CHROME', 97, 2.0, 8, 700), word('TOPPS', 92, 1.9, 8, 560),
    word('LEGENDS', 96, 1.1, 94, 170), word('WET', 50, 1.0, 61),
  ];
  const ranked = rankNames(groupIntoLines(dedupeWords(words)), H);
  assert.equal(ranked[0].text, 'JORDAN ELLIS');
});

test('brand and league words are never taken for a name, however big', () => {
  const words = [word('TOPPS CHROME', 96, 6, 8, 500), word('LEGENDS', 96, 6, 94), word('ROOKIE', 92, 4.1, 13)];
  assert.deepEqual(rankNames(groupIntoLines(dedupeWords(words)), H), []);
});

test('big text that Tesseract is not sure of is not a name', () => {
  // A 9.7%-tall "Ee" at 32% confidence was the largest thing on one card.
  const words = [word('Ee', 32, 9.7, 86), word('La', 43, 4.3, 26), word('JORDAN ELLIS', 74, 5.3, 83, 100)];
  assert.equal(rankNames(groupIntoLines(dedupeWords(words)), H)[0].text, 'JORDAN ELLIS');
});

test('a name in a banner near the top wins over a slightly smaller team name at the bottom', () => {
  const words = [word('Jordan Ellis', 97, 3.4, 10, 70), word('NORTH COAST', 97, 3.0, 89, 60)];
  const ranked = rankNames(groupIntoLines(dedupeWords(words)), H);
  assert.equal(ranked[0].text, 'Jordan Ellis');
  assert.equal(ranked[1].text, 'NORTH COAST', 'the runner-up is offered, so it can be chosen instead');
});

test('a name set on two lines is read as one name', () => {
  const words = [word('JORDAN', 96, 4.0, 73, 60), word('ELLIS', 95, 5.6, 80, 60), word('SUNSET KINGS', 96, 3.2, 93, 500)];
  const ranked = rankNames(groupIntoLines(dedupeWords(words)), H);
  assert.equal(ranked[0].text, 'JORDAN ELLIS');
});

test('a name with a hyphen or an apostrophe is still a name', () => {
  assert.ok(nameLikeness("De'Andre Kestrel") > 0.9);
  assert.ok(nameLikeness('TOBIAS BRANDT-KLEIN') > 0.9);
});

test('numbers, stats and fragments are not names', () => {
  for (const t of ['24.1', 'PTS 24.1 REB 6.3 AST 7.2', 'a', '37/99', '#12', 'AB 12 CD', '']) {
    assert.equal(nameLikeness(t), 0, t);
  }
});

test('a sentence is not a name', () => {
  assert.equal(nameLikeness('One of the finest players of the decade'), 0);
});

// --- punctuation and junk on the ends ----------------------------------------------------

test('stray marks hung on a word are taken off it', () => {
  // Real: "ELLIS," and "„JORDAN" for ELLIS and JORDAN.
  assert.equal(cleanWord('ELLIS,'), 'ELLIS');
  assert.equal(cleanWord('„JORDAN'), 'JORDAN');
  assert.equal(cleanWord('|Marino|'), 'Marino');
});

test('a full stop that belongs to the word is kept', () => {
  assert.equal(cleanWord('MR.'), 'MR.');
  assert.equal(cleanWord('A.J.'), 'A.J.');
});

test('a lone letter on the end of a name is junk, but an initial with its full stop is not', () => {
  // Real: "KESTREL a".
  assert.equal(tidyName('KESTREL a'), 'KESTREL');
  assert.equal(tidyName('U ZARA HOLLIS'), 'ZARA HOLLIS');
  assert.equal(tidyName('A.J. GREEN'), 'A.J. GREEN');
});

test('a brand word that shares the row is not part of the name', () => {
  assert.equal(tidyName('JORDAN ELLIS TOPPS'), 'JORDAN ELLIS');
  assert.equal(tidyName('CHROME JORDAN ELLIS'), 'JORDAN ELLIS');
});

test('punctuation is tidied before a name is ranked, so ELLIS, still counts', () => {
  const ranked = rankNames(groupIntoLines(dedupeWords([word('ELLIS,', 67, 5.1, 90, 400, 140), word('„JORDAN', 28, 3, 90, 100, 280)])), H);
  assert.ok(ranked.length > 0);
  assert.match(ranked[0].text, /ELLIS/);
});

// --- several readings of the same text ---------------------------------------------------

test('a fragment and the whole word read from overlapping strips collapse to the whole word', () => {
  const words = [word('Jord', 97, 3.4, 10, 70, 90), word('Jordan', 96, 3.2, 10, 70, 150), word('Ellis', 97, 3.4, 10, 250, 100)];
  assert.deepEqual(dedupeWords(words).map((w) => w.text).sort(), ['Ellis', 'Jordan']);
});

test('a fragment inside the whole word, and a duplicate with an inflated box, both collapse', () => {
  // Real: "JORDAN" (box twice as tall) beside "JORDANELLIS" survived as two words.
  const words = [word('JORDANELLIS', 89, 5.2, 90, 150, 650), word('JORDAN', 60, 10.4, 88.6, 150, 300)];
  assert.deepEqual(dedupeWords(words).map((w) => w.text), ['JORDANELLIS']);
});

test('two different lines close together are not duplicates', () => {
  const words = [word('JORDAN', 96, 4.0, 73, 60, 250), word('ELLIS', 95, 4.0, 78.5, 60, 200)];
  assert.equal(dedupeWords(words).length, 2);
});

test('words with no position, or no letters, are dropped', () => {
  const ok = word('KEEP', 90, 3, 50);
  assert.deepEqual(dedupeWords([ok, { ...ok, text: '—', x0: 900, x1: 950 }, { ...ok, bbox: null, text: 'NOPOS', x0: 300, x1: 380 }]).map((w) => w.text), ['KEEP']);
});

test('words on the same line are grouped left to right, and a distant line stays separate', () => {
  const lines = groupIntoLines([word('ELLIS', 95, 4, 80, 400, 120), word('JORDAN', 95, 4, 80, 100, 250), word('LEGENDS', 90, 1.2, 94, 100)]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'JORDAN ELLIS');
});

test('one oversized junk word does not stop the words beside it forming a line', () => {
  // Real: a tall "U" (9.8%) sat just above ZARA HOLLIS (4.8%). Grouping in the order
  // words arrived let the U claim ZARA, and HOLLIS then had no line to join.
  const words = [
    word('HOLLIS', 93, 4.9, 85.8, 478, 334), word('U', 40, 9.8, 83.1, 83, 74), word('ZARA', 96, 4.8, 85.8, 188, 267),
  ];
  const lines = groupIntoLines(dedupeWords(words));
  assert.ok(lines.some((l) => l.text === 'ZARA HOLLIS'), lines.map((l) => l.text).join(' | '));
});

test('text at the same height on opposite sides of the card stays two lines', () => {
  const lines = groupIntoLines([word('NORTH COAST', 96, 3, 90, 60, 230), word('37/99', 96, 3, 90, 800, 90)]);
  assert.equal(lines.length, 2);
});

test('a line slanted a little by a tilted card is still one line', () => {
  const a = word('JORDAN', 95, 4, 80, 100, 250), b = word('ELLIS', 95, 4, 80.8, 390, 200);
  assert.equal(groupIntoLines([a, b]).length, 1);
});

// --- word spaces in tightly set italics ---------------------------------------------------

// Letter boxes Tesseract returned for "JORDAN ELLIS" in black italic capitals.
const letters = [['J', 146, 201], ['O', 204, 268], ['R', 272, 331], ['D', 332, 395], ['A', 392, 458], ['N', 466, 537],
  ['E', 554, 612], ['L', 611, 657], ['L', 663, 708], ['I', 714, 742], ['S', 742, 801]]
  .map(([text, x0, x1]) => ({ text, confidence: 0.9, bbox: { x0, y0: 0, x1, y1: 108 } }));

test('two names set too close to be read as two words are separated by the gap between the letters', () => {
  assert.equal(spaceByGaps(letters, 108), 'JORDAN ELLIS');
});

test('italic letters that overlap one another are not split', () => {
  assert.equal(spaceByGaps(letters.slice(0, 6), 108), 'JORDAN');
});

test('a single word stays a single word', () => {
  assert.equal(spaceByGaps(letters.slice(6), 108), 'ELLIS');
});

test('the widest gap is the word break, not the first gap that qualifies', () => {
  // Real, from a photographed card. Tesseract itself read "JORDAN ELLIS"; the gap before
  // the N (9) and the gap before the E (17) both pass, and taking them in reading order
  // gave "JORDA NELLIS", because the first one then forbade the second.
  const real = [['J', 190, 238], ['O', 216, 354], ['R', 309, 359], ['D', 356, 411], ['A', 410, 467], ['N', 476, 538],
    ['E', 555, 604], ['L', 605, 644], ['L', 651, 690], ['I', 697, 720], ['S', 722, 771]]
    .map(([text, x0, x1]) => ({ text, confidence: 0.9, bbox: { x0, y0: 0, x1, y1: 60 } }));
  assert.equal(spaceByGaps(real, 60), 'JORDAN ELLIS');
});

test('a hyphen with a gap either side of it is not a word break', () => {
  const box = (text, x0, x1) => ({ text, confidence: 0.9, bbox: { x0, y0: 0, x1, y1: 100 } });
  const hyphenated = [box('T', 0, 40), box('A', 42, 84), box('N', 88, 130), box('A', 133, 175), box('K', 178, 220),
    box('A', 222, 264), box('-', 288, 310), box('R', 335, 377), box('E', 380, 422), box('Y', 425, 467), box('E', 470, 512), box('S', 515, 557)];
  assert.equal(spaceByGaps(hyphenated, 100), 'TANAKA-REYES');
});

test('an apostrophe is not a word break either', () => {
  const box = (text, x0, x1) => ({ text, confidence: 0.9, bbox: { x0, y0: 0, x1, y1: 100 } });
  assert.equal(spaceByGaps([box('D', 0, 40), box('E', 43, 83), box("'", 110, 122), box('A', 150, 190), box('N', 193, 233)], 100), "DE'AN");
});

test('a gap inside a word does not strand a single letter', () => {
  // Real: TOBIAS came back as "TO B IAS".
  const box = (text, x0, x1) => ({ text, confidence: 0.9, bbox: { x0, y0: 0, x1, y1: 100 } });
  const tobias = [box('T', 0, 40), box('O', 43, 84), box('B', 130, 172), box('I', 176, 190), box('A', 194, 236), box('S', 240, 282)];
  assert.equal(spaceByGaps(tobias, 100).includes(' B '), false);
  assert.ok(spaceByGaps(tobias, 100).split(' ').every((w) => w.length >= 2));
});

test('no letters gives nothing, and one letter gives that letter', () => {
  assert.equal(spaceByGaps([], 100), '');
  assert.equal(spaceByGaps([letters[0]], 100), 'J');
});

// --- brand, year and numbers ----------------------------------------------------------------

const line = (text, conf = 0.9) => ({ text, confidence: conf, height: 30 });

test('a brand logo gives the manufacturer and the product line', () => {
  const e = readEvidence([line('TOPPS CHROME')]);
  assert.equal(e.manufacturer.value, 'Topps');
  assert.equal(e.product.value, 'Chrome');
  assert.equal(e.manufacturer.raw, 'TOPPS CHROME', 'the text it was read from is kept');
});

test('a legal line gives the year and the manufacturer', () => {
  const e = readEvidence([line('© 2022 THE TOPPS COMPANY, INC.')]);
  assert.equal(e.year.value, 2022);
  assert.equal(e.manufacturer.value, 'Topps');
});

test('a product line is not a finish: Chrome does not make a card a parallel', () => {
  assert.equal(readEvidence([line('TOPPS CHROME')]).finish, undefined);
  assert.equal(readEvidence([line('GOLD REFRACTOR')]).finish.value, 'refractor');
});

test('a brand word inside a sentence is not a brand', () => {
  const e = readEvidence([line('He was the score leader in the chrome era of the league')]);
  assert.equal(e.manufacturer, undefined);
  assert.equal(e.product, undefined);
});

test('a print run is a serial number, not the card number', () => {
  const e = readEvidence([line('37/99'), line('#12')]);
  assert.equal(e.serial.value, '37/99');
  assert.equal(e.number.value, '12');
});

test('a fraction with a year or a copyright mark is neither', () => {
  const e = readEvidence([line('© 2022 12/99')]);
  assert.equal(e.serial, undefined);
});

test('a bare year is not believed without a copyright mark or a manufacturer beside it', () => {
  assert.equal(readEvidence([line('SEASON 2022')]).year, undefined);
  assert.equal(readEvidence([line('2021 PANINI')]).year.value, 2021);
});

test('a league gives the sport only where the league makes it certain', () => {
  assert.deepEqual(readEvidence([line('NBA')]).league.value, { league: 'NBA', sport: 'Basketball' });
  assert.deepEqual(readEvidence([line('WWE')]).league.value, { league: 'WWE', sport: null });
});

test('the more trustworthy reading of the same thing wins', () => {
  const e = readEvidence([line('TOPPS', 0.5), line('TOPPS CHROME', 0.95)]);
  assert.equal(e.manufacturer.confidence, 0.95);
});

test('nothing found is nothing, never a guess', () => {
  assert.deepEqual(readEvidence([line('JORDAN ELLIS'), line('SUNSET KINGS')]), {});
  assert.deepEqual(readEvidence([]), {});
});

// --- reading a line a second time ---------------------------------------------------------

test('a second reading that puts the word spaces back replaces the first', () => {
  const r = betterReading({ text: 'JORDANELLIS', confidence: 0.89 }, { text: 'JORDAN ELLIS', confidence: 0.85 });
  assert.equal(r.text, 'JORDAN ELLIS');
});

test('a second reading that is worse does not replace a good first one', () => {
  // Real: the first pass had YUKI TANAKA-REYES at 88%; the re-read gave "-REYES" split off.
  const r = betterReading({ text: 'YUKI TANAKA-REYES', confidence: 0.88 }, { text: 'YUKI TANAKA -REYES', confidence: 0.63 });
  assert.equal(r.text, 'YUKI TANAKA-REYES');
});

test('a second reading that is clearly better replaces a poor first one', () => {
  const r = betterReading({ text: 'HOLLIS', confidence: 0.4 }, { text: 'ZARA HOLLIS', confidence: 0.9 });
  assert.equal(r.text, 'ZARA HOLLIS');
});

test('no second reading leaves the first alone', () => {
  const first = { text: 'JORDAN ELLIS', confidence: 0.9 };
  assert.equal(betterReading(first, null), first);
  assert.equal(betterReading(first, { text: '', confidence: 0.9 }), first);
});

test('of several rereadings, the one that keeps the first reading\'s letters and adds the spaces wins', () => {
  // Real: the tight re-read gave JORDAN ELLIS; the whole-row re-read dropped the J and
  // gave "ORDAN ELLIS", which looks more like a name but is wrong.
  const r = pickReading({ text: 'JORDANELLIS', confidence: 0.89 }, [
    { text: 'ORDAN ELLIS', confidence: 0.9 }, { text: 'JORDAN ELLIS', confidence: 0.85 },
  ]);
  assert.equal(r.text, 'JORDAN ELLIS');
});

test('with no rereading that agrees, the best looking one is used if it beats the first', () => {
  const r = pickReading({ text: 'HOLLIS', confidence: 0.5 }, [{ text: 'ZARA HOLLIS', confidence: 0.9 }, { text: 'xx', confidence: 0.9 }]);
  assert.equal(r.text, 'ZARA HOLLIS');
});

test('no usable rereading leaves the first reading alone', () => {
  const first = { text: 'JORDAN ELLIS', confidence: 0.9 };
  assert.equal(pickReading(first, []), first);
  assert.equal(pickReading(first, [null, { text: '', confidence: 1 }]), first);
});

test('a first name stacked over a surname is preferred to the surname alone', () => {
  const words = [word("DE'ANDRE", 90, 3.9, 73, 60, 260), word('KESTREL', 96, 5.6, 80, 60, 300)];
  const ranked = rankNames(groupIntoLines(dedupeWords(words)), H);
  assert.equal(ranked[0].text, "DE'ANDRE KESTREL");
});

test('a name is never joined to the team name under it', () => {
  const words = [word('JORDAN ELLIS', 95, 5, 80, 60, 420), word('SUNSET KINGS', 95, 4.6, 86.5, 60, 400)];
  const ranked = rankNames(groupIntoLines(dedupeWords(words)), H);
  assert.ok(ranked.every((r) => r.text !== 'JORDAN ELLIS SUNSET KINGS'));
  assert.ok(ranked.some((r) => r.text === 'JORDAN ELLIS'));
});
