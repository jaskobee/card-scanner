import test from 'node:test';
import assert from 'node:assert/strict';

import { pickName, findHp, findCardNumbers, containsFuzzy, withoutEvolutionLines } from '../src/normalize.js';
import { extractSignals } from '../src/pipeline.js';
import { rankCandidates } from '../src/match.js';

// The strings below are what Tesseract really returned for official card scans,
// not tidy examples. The name is the hardest thing to pull out of them.

// --- name ------------------------------------------------------------------

test('a name is found among junk before and after it', () => {
  assert.equal(pickName('735% Charizard 120 HP@').value, 'Charizard');
  assert.equal(pickName('| {Fa Charizard 0 HP |').value, 'Charizard');
});

test('a real name beats a junk line above it', () => {
  assert.equal(pickName('STAGE], va /\n| Beartic Aw 150 ©').value, 'Beartic');
});

test('an "Evolves from" line never supplies the name', () => {
  // Charmeleon is a different Pokémon; naming the card after it would be a wrong answer.
  assert.equal(pickName('Evolves from Charmeleon\nPikachu VMAX HP 310').value, 'Pikachu VMAX');
  assert.equal(pickName('afte 5 Evolves from Emon Put Charizard on the Stage | card\n735% Charizard 120 HP@').value, 'Charizard');
  assert.equal(pickName('Evolves from Charmeleon'), null);
});

test('printed labels beside a name are not part of it', () => {
  assert.equal(pickName('BASIC Pokémon Pikachu 60 HP').value, 'Pikachu');
  assert.equal(pickName('Stufe 2 Glurak 120 KP').value, 'Glurak');
});

test('suffixes that belong to the name are kept', () => {
  assert.equal(pickName('Charizard ex HP 330').value, 'Charizard ex');
  assert.equal(pickName('Pikachu VMAX HP 310').value, 'Pikachu VMAX');
});

test('titles inside a name survive', () => {
  assert.equal(pickName('Mr. Mime HP 70').value, 'Mr. Mime');
});

test('a lone suffix or fragment is not a name', () => {
  assert.equal(pickName('V'), null);
  assert.equal(pickName('va wa oo'), null);
  assert.equal(pickName('~~~ ### ~~~'), null);
});

test('position beats length: the name is near the top, junk can be any length', () => {
  assert.equal(pickName('Glurak\nStufe 2\nEntwicklungsstufe').value, 'Glurak');
});

// --- HP --------------------------------------------------------------------

test('HP is read in either order', () => {
  assert.equal(findHp('Beartic HP 150').value, 150);
  assert.equal(findHp('Charizard 120 HP').value, 120);
});

test('an HP that no card can have is a misread and is dropped, not passed on', () => {
  assert.equal(findHp('HP 155'), null, 'not a multiple of ten');
  assert.equal(findHp('450 HP'), null, 'above any real card');
  assert.equal(findHp('HP 1 50'), null);
});

// --- number ----------------------------------------------------------------

test('a slash read as a pipe or backslash is still the number, with the printed span kept', () => {
  const [n] = findCardNumbers('054|197');
  assert.equal(n.value, '054/197');
  assert.equal(n.raw, '054|197', 'evidence is what was read, not what we made of it');
  assert.equal(findCardNumbers('4\\102')[0].value, '4/102');
});

test('leading zeroes survive', () => {
  assert.equal(findCardNumbers('004/102')[0].value, '004/102');
});

test('a set size the database does not know marks a number as a misread', () => {
  const known = (d) => d === 197;
  const s = extractSignals('x', { nameText: 'Beartic', bottomText: '©2023 2004/13\n054/197', isKnownTotal: known });
  assert.equal(s.number.value, '054/197', 'the number with a real set size wins even though it came second');
});

test('a tiny denominator is stray text, not a card number', () => {
  const s = extractSignals('x', { nameText: 'Beartic', bottomText: '©2007/1 Pokémon' });
  assert.equal(s.number, null);
});

test('when no set size is recognised, the number is still reported as read, never repaired', () => {
  const s = extractSignals('x', { nameText: 'Aggron', bottomText: '1/102', isKnownTotal: () => false });
  assert.equal(s.number.value, '1/102');
});

// --- finding a name inside noisy text ----------------------------------------

test('a name is found inside the text around it', () => {
  assert.equal(containsFuzzy('Beartic Aw 150 ©', 'Beartic'), 1);
});

test('OCR junk stuck to a name still finds it', () => {
  assert.ok(containsFuzzy('* Dialgawes w90', 'Dialga') >= 0.99);
});

test('a slightly misread name still scores high, an unrelated one does not', () => {
  assert.ok(containsFuzzy('Charizrd 120 HP', 'Charizard') > 0.85);
  assert.ok(containsFuzzy('Charizard 120 HP', 'Blastoise') < 0.5);
});

test('a very short name must match exactly rather than fuzzily', () => {
  assert.equal(containsFuzzy('Mew HP 50', 'Mew'), 1);
  assert.equal(containsFuzzy('Mow HP 50', 'Mew'), 0);
});

test('lines about another Pokémon are removed before a name is matched', () => {
  const text = 'Evolves from Charmeleon\nCharizard 120 HP';
  assert.ok(!/Charmeleon/.test(withoutEvolutionLines(text)));
  assert.ok(/Charizard/.test(withoutEvolutionLines(text)));
});

// --- matching --------------------------------------------------------------

const record = (over) => ({ id: 'x', name: 'Charizard', number: '4/102', set: 'Base Set', year: 1999, hp: 120, language: 'en', ...over });

test('a correct name scores as a match even with junk around it', () => {
  const signals = { name: '735% Charizard 120', nameText: '735% Charizard 120 HP@', number: '4/102' };
  const r = rankCandidates(signals, [record()]);
  assert.equal(r.candidates[0].agreements.name, 1);
});

test('HP that agrees adds confidence, and a misread HP is never a field to fix', () => {
  const signals = { name: 'Charizard', number: '4/102', hp: 90 }; // the card says 120
  const r = rankCandidates(signals, [record()]);
  assert.equal(r.candidates[0].agreements.hp, 0);
  assert.ok(!r.flags.includes('hp'), 'HP is neither listed nor exported');
});

test('a wrong name still flags the name even when the number matches', () => {
  const r = rankCandidates({ name: 'Blastoise', nameText: 'Blastoise 120 HP', number: '4/102' }, [record()]);
  assert.ok(r.flags.includes('name'));
});
