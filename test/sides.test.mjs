import test from 'node:test';
import assert from 'node:assert/strict';

import { sameName, distance, combineNames, combineSides } from '../src/sides.js';

// Readings from the real cards: the front of a wrestling card is stylised and hard to read, its back is plain type.

test('edit distance counts single-letter differences', () => {
  assert.equal(distance('wyatt', 'watt'), 1);
  assert.equal(distance('same', 'same'), 0);
  assert.equal(distance('', 'abc'), 3);
});

test('two readings of one name match despite a misread letter or different spacing', () => {
  assert.ok(sameName('BRAY WYATT', 'BRAY WATT'));
  assert.ok(sameName('TOMMASO CIAMPA', 'Tommaso Ciampa'));
  assert.ok(sameName('JORDANELLIS', 'JORDAN ELLIS'));
});

test('a surname alone matches the full name that contains it', () => {
  assert.ok(sameName('JORDAN ELLIS', 'ELLIS'));
});

test('different people, or short names one letter apart, do not match', () => {
  assert.equal(sameName('ELLIS', 'ELLA'), false);
  assert.equal(sameName('JORDAN ELLIS', 'MARCUS VEGA'), false);
  assert.equal(sameName('', 'ELLIS'), false);
});

test('a name read on both sides is agreed, gains confidence, and outranks anything on one side', () => {
  const names = combineNames(
    [{ text: 'BRAY WYATT', confidence: 0.72, score: 0.8 }, { text: 'NLE SE', confidence: 0.53, score: 0.85 }],
    [{ text: 'BRAY WYATT', confidence: 0.63, score: 0.8 }],
  );
  assert.equal(names[0].text, 'BRAY WYATT');
  assert.equal(names[0].agreed, true);
  assert.ok(names[0].confidence > 0.72, 'two independent readings are better than one');
  assert.deepEqual(names[0].sources.map((s) => s.side), ['front', 'back']);
});

test('when the front is unreadable, the name plainly printed on the back is the name', () => {
  // Real: the front's stencil lettering read "AJ ASO EFYY" at 34%; the back said TOMMASO CIAMPA at 76%.
  const names = combineNames(
    [{ text: 'AJ ASO EFYY', confidence: 0.34, score: 0.35 }],
    [{ text: 'TOMMASO CIAMPA', confidence: 0.76, score: 0.9 }],
  );
  assert.equal(names[0].text, 'TOMMASO CIAMPA');
  assert.equal(names[0].side, 'back');
  assert.equal(names[0].agreed, undefined, 'nothing agreed: it simply read better');
  assert.equal(names[1].text, 'AJ ASO EFYY', 'the other reading is kept, one click away');
});

test('the surer spelling wins, unless the other is the fuller name and was not badly read', () => {
  const surer = combineNames([{ text: 'BRAY WATT', confidence: 0.4, score: 0.5 }], [{ text: 'BRAY WYATT', confidence: 0.9, score: 0.9 }]);
  assert.equal(surer[0].text, 'BRAY WYATT');
  const fuller = combineNames([{ text: 'ELLIS', confidence: 0.9, score: 0.9 }], [{ text: 'JORDAN ELLIS', confidence: 0.7, score: 0.8 }]);
  assert.equal(fuller[0].text, 'JORDAN ELLIS');
  const badlyRead = combineNames([{ text: 'ELLIS', confidence: 0.9, score: 0.9 }], [{ text: 'JORDAN ELLIS', confidence: 0.4, score: 0.8 }]);
  assert.equal(badlyRead[0].text, 'ELLIS');
});

test('confidence never passes 95% however many sides agree', () => {
  const [n] = combineNames([{ text: 'TOMMASO CIAMPA', confidence: 0.96, score: 1 }], [{ text: 'TOMMASO CIAMPA', confidence: 0.97, score: 1 }]);
  assert.ok(n.confidence <= 0.95);
});

test('a side with no names leaves the other side\'s untouched', () => {
  const only = combineNames([{ text: 'BRAY WYATT', confidence: 0.7, score: 0.8 }], []);
  assert.equal(only.length, 1);
  assert.equal(only[0].side, 'front');
});

test('evidence is taken from whichever side read it best, marked with that side', () => {
  const both = combineSides(
    { names: [], texts: [], evidence: { manufacturer: { value: 'Topps', raw: 'TOPPS', confidence: 0.6 }, league: { value: { league: 'WWE' }, raw: 'WWE', confidence: 0.86 } } },
    { names: [], texts: [], evidence: { manufacturer: { value: 'Topps', raw: 'The Topps Company', confidence: 0.87 }, year: { value: 2025, raw: '© 2025 WWE', confidence: 0.81 } } },
  );
  assert.equal(both.evidence.manufacturer.side, 'back');
  assert.equal(both.evidence.manufacturer.raw, 'The Topps Company');
  assert.equal(both.evidence.league.side, 'front');
  assert.equal(both.evidence.year.side, 'back');
});

test('a value printed as such beats a value inferred from where it sat, whatever the confidence', () => {
  const both = combineSides(
    { names: [], texts: [], evidence: { number: { value: '53', raw: '#53', confidence: 0.6 } } },
    { names: [], texts: [], evidence: { number: { value: '126', raw: '126', confidence: 0.97, inferred: 'the only large number near the top of the back' } } },
  );
  assert.equal(both.evidence.number.value, '53');
});

test('everything read is kept, marked with its side, biggest first', () => {
  const both = combineSides(
    { names: [], evidence: {}, texts: [{ text: 'TOPPS CHROME', confidence: 0.9, size: 0.03 }] },
    { names: [], evidence: {}, texts: [{ text: '126', confidence: 0.97, size: 0.027 }, { text: 'Bray Wyatt was a creature', confidence: 0.96, size: 0.014 }] },
  );
  assert.deepEqual(both.texts.map((t) => [t.text, t.side]), [['TOPPS CHROME', 'front'], ['126', 'back'], ['Bray Wyatt was a creature', 'back']]);
  assert.deepEqual(both.sides, ['front', 'back']);
});

test('a card with only a back combines the same way, and says so', () => {
  const back = combineSides(null, { names: [{ text: 'X', confidence: 0.5, score: 0.5 }], evidence: {}, texts: [] });
  assert.deepEqual(back.sides, ['back']);
});
