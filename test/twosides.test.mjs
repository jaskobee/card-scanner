import test from 'node:test';
import assert from 'node:assert/strict';

import { applyGeneral } from '../src/pipeline.js';
import { combineSides } from '../src/sides.js';
import { newCard, extracted } from '../src/model.js';

// What the general reader returned for the real cards, side by side: a wrestling card whose
// front is stencil lettering nothing reads and whose back prints the name, number and small print.

const back = () => ({
  names: [{ text: 'TOMMASO CIAMPA', confidence: 0.89, score: 0.9 }],
  texts: [{ text: 'TOMMASO CIAMPA', confidence: 0.89, size: 0.044 }],
  evidence: {
    manufacturer: { value: 'Topps', raw: 'All Rights Reserved. Topps', confidence: 0.87 },
    year: { value: 2025, raw: '© 2025 WWE. All Rights Reserved.', confidence: 0.81 },
    number: { value: '55', raw: '55', confidence: 0.95, inferred: 'the only large number near the top of the back' },
  },
});
const front = () => ({
  names: [{ text: 'AJ ASO EFYY', confidence: 0.34, score: 0.3 }],
  texts: [{ text: 'AJ ASO EFYY', confidence: 0.4, size: 0.02 }],
  evidence: { league: { value: { league: 'WWE', sport: null }, raw: 'WWE', confidence: 0.86 } },
});

test('a card read from both sides takes its name from the side that read it, saying which', () => {
  const card = newCard();
  applyGeneral(card, combineSides(front(), back()));
  assert.equal(card.fields.name.value, 'TOMMASO CIAMPA');
  assert.equal(card.fields.name.source, 'ocr');
  assert.match(card.fields.name.evidence, /^back: /);
});

test('a name read the same on both sides records both readings as its evidence', () => {
  const card = newCard();
  const f = { ...front(), names: [{ text: 'BRAY WYATT', confidence: 0.72, score: 0.8 }] };
  const b = { ...back(), names: [{ text: 'BRAY WYATT', confidence: 0.63, score: 0.8 }] };
  applyGeneral(card, combineSides(f, b));
  assert.match(card.fields.name.evidence, /front: “BRAY WYATT” \+ back: “BRAY WYATT”/);
  assert.ok(card.fields.name.confidence > 0.6, 'two readings agreeing is worth more than either');
});

test('each printed value says which side it was read from', () => {
  const card = newCard();
  applyGeneral(card, combineSides(front(), back()));
  assert.match(card.fields.manufacturer.evidence, /^back: /);
  assert.match(card.fields.year.evidence, /^back: /);
  assert.match(card.fields.league.evidence, /^front: /);
  assert.equal(card.fields.year.value, 2025);
});

test('the number found only by where it sat is an inference: it names its rule, is capped, and is flagged', () => {
  const card = newCard();
  applyGeneral(card, combineSides(front(), back()));
  const n = card.fields.number;
  assert.equal(n.value, '55');
  assert.equal(n.source, 'inferred');
  assert.ok(n.confidence <= 0.6);
  assert.match(n.evidence, /back: the only large number near the top of the back: “55”/);
  assert.ok(card.flags.includes('number'), 'a person confirms it');
});

test('a number the corner strips read at 0% does not stand in the way of the back, or stay if there is none', () => {
  const junk = () => { const c = newCard(); c.fields.number = extracted('53', 'ocr', 0, '#53'); return c; };

  const withBack = junk();
  applyGeneral(withBack, combineSides(front(), back()));
  assert.equal(withBack.fields.number.value, '55');

  const alone = junk();
  applyGeneral(alone, combineSides(front(), { ...back(), evidence: { ...back().evidence, number: undefined } }));
  assert.equal(alone.fields.number.value, null, 'a blank a person fills in beats a wrong number on a listing');
  assert.ok(alone.flags.includes('number'));
});

test('a number the strips read with real confidence is not thrown away', () => {
  const card = newCard();
  card.fields.number = extracted('004/102', 'ocr', 0.9, '004/102');
  applyGeneral(card, combineSides(front(), { ...back(), evidence: { ...back().evidence, number: undefined } }));
  assert.equal(card.fields.number.value, '004/102');
});

test('the back of a card a database matched only fills what the front left empty', () => {
  const card = newCard();
  card.fields.name = extracted('Charizard', 'ocr', 0.9, 'Charizard');
  card.fields.year = extracted(1999, 'ocr', 0.85, '© 1999');
  const noNumber = { ...back(), evidence: { ...back().evidence, number: undefined } };
  applyGeneral(card, combineSides(null, noNumber), { fillOnly: true });
  assert.equal(card.fields.name.value, 'Charizard', 'a back never renames a matched card');
  assert.equal(card.fields.year.value, 1999, 'nor changes a year already read');
  assert.equal(card.fields.manufacturer.value, 'Topps', 'but it may add a maker nobody had');
  assert.deepEqual(card.flags, [], 'and it adds no missing-field flags to a card that matched');
});

test('a number a matched card\'s back supplies by position is still an inference a person confirms', () => {
  const card = newCard();
  card.fields.name = extracted('Charizard', 'ocr', 0.9, 'Charizard');
  applyGeneral(card, combineSides(null, back()), { fillOnly: true });
  assert.equal(card.fields.number.source, 'inferred');
  assert.deepEqual(card.flags, ['number']);
});

test('an unmatched card with two sides still goes to review and flags what is missing', () => {
  const card = newCard();
  applyGeneral(card, combineSides(front(), { ...back(), evidence: { manufacturer: back().evidence.manufacturer } }));
  assert.ok(card.flags.includes('set'));
  assert.ok(card.flags.includes('number'));
  assert.ok(card.flags.includes('year'));
});
