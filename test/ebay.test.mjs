import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_TYPES, CONDITION_ID, cardTypeOf, ungradedConditionId, graderId, gradeId, isGraded,
  ebayCardValues, descriptorField, starterTemplate, STARTER, ACTION_HEADER, singleLine, formatPrice,
} from '../src/ebay.js';
import { toCsv, parseTemplate, suggestMapping, buildTemplateRows, validateRows, MISSING } from '../src/csv.js';
import { newCard, valueOf, correct, extracted } from '../src/model.js';

// A card is read through `get(field)`. This builds one from a plain object.
const card = (values) => (field) => values[field] ?? null;

// --- what kind of card ---------------------------------------------------------

test('the three single-card categories carry the IDs eBay Germany uses', () => {
  assert.equal(CARD_TYPES.ccg.id, 183454);
  assert.equal(CARD_TYPES.sports.id, 261328);
  assert.equal(CARD_TYPES.nonsport.id, 183050);
});

test('the card type the user chose always wins', () => {
  assert.deepEqual(cardTypeOf(card({ cardType: 'sports', game: 'Pokémon' })), { type: 'sports', from: 'you' });
});

test('a card the database identified as belonging to a game is a trading-card-game card', () => {
  assert.deepEqual(cardTypeOf(card({ game: 'Pokémon' })), { type: 'ccg', from: 'game' });
});

test('a card with a sport recorded is a sports card', () => {
  assert.deepEqual(cardTypeOf(card({ sport: 'Football' })), { type: 'sports', from: 'sport' });
});

test('a card of unknown kind stays unknown: no default category is ever assumed', () => {
  assert.equal(cardTypeOf(card({ name: 'Brad Pitt' })), null);
  assert.equal(cardTypeOf(card({ cardType: 'gaming' })), null, 'a value that is not a card type is ignored');
});

// --- ungraded condition ------------------------------------------------------------

test('eBay\'s four ungraded conditions resolve by their English or German label', () => {
  assert.equal(ungradedConditionId('Near mint or better'), 400010);
  assert.equal(ungradedConditionId('So gut wie neu'), 400010);
  assert.equal(ungradedConditionId('exzellent'), 400011);
  assert.equal(ungradedConditionId('Sehr gut'), 400012);
  assert.equal(ungradedConditionId('Schlecht'), 400013);
  assert.equal(ungradedConditionId('POOR'), 400013);
});

test('the earlier "Near Mint" option is the same level with the qualifier dropped', () => {
  assert.equal(ungradedConditionId('Near Mint'), 400010);
});

test('conditions eBay does not offer for cards are not translated', () => {
  // These were options in an earlier version. Guessing a level for them would
  // misdescribe a card to a buyer, so they stay unplaced.
  for (const c of ['Good', 'Played', 'Lightly Played', 'Mint', 'Damaged', '5000']) {
    assert.equal(ungradedConditionId(c), null, c);
  }
  assert.equal(ungradedConditionId(''), null);
  assert.equal(ungradedConditionId(null), null);
});

// --- graders and grades -------------------------------------------------------------

test('a grader resolves by full name or by its usual abbreviation', () => {
  assert.equal(graderId('PSA'), 275010);
  assert.equal(graderId('psa'), 275010);
  assert.equal(graderId('Professional Sports Authenticator'), 275010);
  assert.equal(graderId('BGS'), 275013);
  assert.equal(graderId('SGC'), 275016);
  assert.equal(graderId('Other'), 2750123);
});

test('a grader eBay does not list is not mapped to "Other" behind the seller\'s back', () => {
  // CGC is not on eBay's list. Choosing "Other" is the seller's decision.
  assert.equal(graderId('CGC'), null);
  assert.equal(graderId('Beckett'), null, 'ambiguous between three Beckett services');
  assert.equal(graderId(''), null);
});

test('a grade is read from what a person writes', () => {
  assert.equal(gradeId('10'), 275020);
  assert.equal(gradeId('9.5'), 275021);
  assert.equal(gradeId('9.0'), 275022, 'a trailing .0 is the same grade');
  assert.equal(gradeId('PSA 10'), 275020);
  assert.equal(gradeId('Gem Mint 10'), 275020);
  assert.equal(gradeId('1'), 2750218);
  assert.equal(gradeId('Authentic'), 2750219);
  assert.equal(gradeId('Authentic Altered'), 2750220);
});

test('a grade that does not exist is not rounded to one that does', () => {
  assert.equal(gradeId('11'), null);
  assert.equal(gradeId('9.7'), null);
  assert.equal(gradeId('mint'), null);
});

// --- graded or not ------------------------------------------------------------------

test('what the user said about grading wins, in either language', () => {
  assert.equal(isGraded(card({ graded: true, condition: 'Excellent' })), true);
  assert.equal(isGraded(card({ graded: 'Ja' })), true);
  assert.equal(isGraded(card({ graded: false, grade: '10' })), false);
  assert.equal(isGraded(card({ graded: 'nein' })), false);
});

test('a grader or a grade implies graded, and only a condition implies ungraded', () => {
  assert.equal(isGraded(card({ gradingCompany: 'PSA' })), true);
  assert.equal(isGraded(card({ grade: '9' })), true);
  assert.equal(isGraded(card({ condition: 'Excellent' })), false);
});

test('a card that says nothing about grading is undecided, not assumed ungraded', () => {
  assert.equal(isGraded(card({ name: 'Charizard' })), null);
});

// --- everything eBay wants to know about one card -------------------------------------

test('an ungraded card: Condition ID 4000 plus the card-condition descriptor', () => {
  const v = ebayCardValues(card({ game: 'Pokémon', condition: 'Near mint or better' }));
  assert.equal(v.categoryId, 183454);
  assert.equal(v.conditionId, CONDITION_ID.ungraded);
  assert.equal(v.cardCondition, 400010);
  assert.equal(v.grader, null);
  assert.deepEqual(v.problems, []);
});

test('a graded card: Condition ID 2750 plus grader, grade and certificate', () => {
  const v = ebayCardValues(card({ cardType: 'sports', gradingCompany: 'PSA', grade: '10', certNumber: '00123456' }));
  assert.equal(v.categoryId, 261328);
  assert.equal(v.conditionId, CONDITION_ID.graded);
  assert.equal(v.grader, 275010);
  assert.equal(v.grade, 275020);
  assert.equal(v.certNumber, '00123456', 'leading zeroes are part of a certificate number');
  assert.equal(v.cardCondition, null, 'a graded card has no ungraded condition');
  assert.deepEqual(v.problems, []);
});

test('the certificate number is optional', () => {
  const v = ebayCardValues(card({ cardType: 'nonsport', gradingCompany: 'BGS', grade: '9.5' }));
  assert.equal(v.certNumber, null);
  assert.deepEqual(v.problems, []);
});

test('what cannot be worked out is listed as a problem, never filled with a default', () => {
  const v = ebayCardValues(card({ name: 'Mystery' }));
  assert.equal(v.categoryId, null);
  assert.equal(v.conditionId, null);
  assert.deepEqual(v.problems, ['card type', 'graded or not']);
});

test('an ungraded condition eBay does not offer is a problem with the reason stated', () => {
  const v = ebayCardValues(card({ game: 'Pokémon', condition: 'Played' }));
  assert.equal(v.cardCondition, null);
  assert.ok(v.problems.some((p) => /condition \(not one eBay lists/.test(p)));
});

test('a graded card with a grader eBay does not list says so', () => {
  const v = ebayCardValues(card({ game: 'Pokémon', gradingCompany: 'CGC', grade: '9' }));
  assert.equal(v.grader, null);
  assert.ok(v.problems.some((p) => /grader \(not one eBay lists\)/.test(p)));
  assert.equal(v.grade, 275022, 'the grade that did resolve is kept');
});

// --- reading a template's card columns ----------------------------------------------------

test('descriptor columns are recognised by the ID in the header, whatever the words', () => {
  assert.equal(descriptorField('CD:Card Condition - (ID: 40001)'), 'cardConditionId');
  assert.equal(descriptorField('CD:Professional Grader - (ID: 27501)'), 'graderId');
  assert.equal(descriptorField('CD:Grade - (ID: 27502)'), 'gradeId');
  assert.equal(descriptorField('CDA:Certification Number - (ID: 27503)'), 'certificationNumber');
  // A localised label with the same ID still resolves.
  assert.equal(descriptorField('CD:Kartenzustand - (ID: 40001)'), 'cardConditionId');
});

test('the short spelling eBay also accepts is recognised', () => {
  assert.equal(descriptorField('CD:40001'), 'cardConditionId');
  assert.equal(descriptorField('CDA:27503'), 'certificationNumber');
});

test('other columns are not mistaken for descriptors', () => {
  assert.equal(descriptorField('C:Grade'), null, 'an ordinary item specific');
  assert.equal(descriptorField('Condition ID'), null);
  assert.equal(descriptorField('CD:Something Else - (ID: 99999)'), null);
  assert.equal(descriptorField(''), null);
});

// --- the starter template -------------------------------------------------------------------

test('for a draft eBay makes only Action and Category ID mandatory', () => {
  const t = starterTemplate();
  assert.deepEqual(t.required, [ACTION_HEADER, 'Category ID']);
  assert.ok(t.recommended.includes('Title') && t.recommended.includes('Start price'));
});

test('the starter names all four card descriptors, so nothing drifts from the mapping', () => {
  const found = STARTER.headers.map(descriptorField).filter(Boolean).sort();
  assert.deepEqual(found, ['cardConditionId', 'certificationNumber', 'gradeId', 'graderId']);
});

test('the starter leads with Action, as eBay requires of the first column', () => {
  assert.equal(STARTER.headers[0], ACTION_HEADER);
  assert.match(ACTION_HEADER, /^Action\(SiteID=Germany\|Country=DE\|Currency=EUR\|Version=\d+\|CC=UTF-8\)$/);
});

test('the starter leaves out item specifics whose German names could not be verified', () => {
  assert.ok(!STARTER.headers.some((h) => /^C:/.test(h)), 'a wrong C: name is rejected, not approximated');
});

// --- a mixed batch, through the template machinery --------------------------------------------

// What a card export supplies for each internal field.
function cellFor(c, defaults = {}) {
  const get = (f) => valueOf(c, f);
  const e = ebayCardValues(get);
  return (_card, field) => ({
    action: defaults.action ?? 'VerifyAdd',
    category: e.categoryId,
    title: get('name'),
    conditionId: e.conditionId,
    cardConditionId: e.cardCondition,
    graderId: e.grader,
    gradeId: e.grade,
    certificationNumber: e.certNumber,
    price: formatPrice(get('price')),
    quantity: get('quantity') ?? 1,
    format: 'FixedPrice',
    duration: 'GTC',
  })[field] ?? null;
}

function cardWith(fields, user = {}) {
  const c = newCard({ projectId: 'p' });
  for (const [k, v] of Object.entries(fields)) c.fields[k] = extracted(v, 'ocr', 0.9);
  Object.assign(c.user, user);
  return c;
}

test('the starter\'s own headers map to the fields a card supplies', () => {
  const { mapping } = suggestMapping(starterTemplate().headers);
  assert.equal(mapping.action, ACTION_HEADER);
  assert.equal(mapping.category, 'Category ID');
  assert.equal(mapping.conditionId, 'Condition ID', 'the numeric ID is not the written condition');
  assert.equal(mapping.cardConditionId, 'CD:Card Condition - (ID: 40001)');
  assert.equal(mapping.graderId, 'CD:Professional Grader - (ID: 27501)');
  assert.equal(mapping.gradeId, 'CD:Grade - (ID: 27502)');
  assert.equal(mapping.certificationNumber, 'CDA:Certification Number - (ID: 27503)');
  assert.equal(mapping.price, 'Start price');
  assert.equal(mapping.title, 'Title');
});

test('a mixed batch gets each card its own category, in one file', () => {
  const template = starterTemplate();
  const { mapping } = suggestMapping(template.headers);
  const cards = [
    cardWith({ name: 'Charizard', game: 'Pokémon' }, { condition: 'Near mint or better', price: '45' }),
    cardWith({ name: 'Mike Trout' }, { cardType: 'sports', gradingCompany: 'PSA', grade: '10', certNumber: '00987654', price: '120,5' }),
    cardWith({ name: 'Brad Pitt' }, { cardType: 'nonsport', condition: 'Sehr gut', price: '3' }),
  ];
  const rows = cards.flatMap((c) => buildTemplateRows([c], template, mapping, cellFor(c)));

  assert.deepEqual(rows.map((r) => r['Category ID']), [183454, 261328, 183050]);
  assert.deepEqual(rows.map((r) => r['Condition ID']), [4000, 2750, 4000]);
  assert.equal(rows[0]['CD:Card Condition - (ID: 40001)'], 400010);
  assert.equal(rows[0]['CD:Grade - (ID: 27502)'], '', 'ungraded rows leave the grading columns empty');
  assert.equal(rows[1]['CD:Professional Grader - (ID: 27501)'], 275010);
  assert.equal(rows[1]['CD:Grade - (ID: 27502)'], 275020);
  assert.equal(rows[1]['CDA:Certification Number - (ID: 27503)'], '00987654');
  assert.equal(rows[1]['CD:Card Condition - (ID: 40001)'], '', 'graded rows leave the ungraded condition empty');
  assert.equal(rows[2]['CD:Card Condition - (ID: 40001)'], 400012);
  assert.ok(rows.every((r) => r[ACTION_HEADER] === 'VerifyAdd'));
  assert.ok(rows.every((r) => r.Format === 'FixedPrice'), 'Format defaults to Auction at eBay, so it is always written');
});

test('a card with no category is blocked, and says so, rather than filed somewhere', () => {
  const template = starterTemplate();
  const { mapping } = suggestMapping(template.headers);
  const c = cardWith({ name: 'Mystery' }, { condition: 'Excellent' });
  const rows = buildTemplateRows([c], template, mapping, cellFor(c));
  assert.equal(rows[0]['Category ID'], MISSING);
  const v = validateRows(rows, template);
  assert.equal(v.ok, false);
  assert.deepEqual(v.issues.map((i) => i.header), ['Category ID']);
});

test('columns a draft does not need warn but never block', () => {
  const template = starterTemplate();
  const { mapping } = suggestMapping(template.headers);
  const c = cardWith({ name: 'Charizard', game: 'Pokémon' }, { condition: 'Excellent' }); // no price
  const v = validateRows(buildTemplateRows([c], template, mapping, cellFor(c)), template);
  assert.equal(v.ok, true, 'eBay makes only Action and Category ID mandatory for a draft');
  assert.ok(v.warnings.some((w) => w.header === 'Start price'), 'but a price is needed before it can be published');
});

// --- writing the file ----------------------------------------------------------------------------

test('the info line above the header survives the round trip', () => {
  const template = starterTemplate();
  const csv = toCsv(template.headers, [], { preamble: template.preamble });
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  assert.match(lines[0], /^#INFO/, 'eBay reads the first line to learn which template this is');
  assert.equal(lines[1].split(',')[0], ACTION_HEADER);

  const back = parseTemplate(csv);
  assert.deepEqual(back.headers, template.headers);
  assert.equal(back.preamble.length, 1);
});

test('a template\'s info lines are written back exactly as they came, empty cells and all', () => {
  const original = '#INFO,Version=1.0.0,Template=fx_category_template_EBAY_US,,,\r\n#INFO Action and Category ID are required,,,,,\r\nAction(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Category ID,Title,,,\r\n';
  const t = parseTemplate(original);
  const out = toCsv(t.headers, [], { preamble: t.preamble, bom: false });
  assert.deepEqual(parseTemplate(out).preamble, t.preamble);
});

test('the byte-order mark can be left off, in case eBay objects to it on the first line', () => {
  const t = starterTemplate();
  assert.ok(toCsv(t.headers, [], { preamble: t.preamble }).startsWith('﻿#INFO'));
  assert.ok(toCsv(t.headers, [], { preamble: t.preamble, bom: false }).startsWith('#INFO'));
});

test('a certificate number keeps its leading zeroes through the file', () => {
  const t = starterTemplate();
  const csv = toCsv(t.headers, [{ 'CDA:Certification Number - (ID: 27503)': '00987654' }], {
    textColumns: ['CDA:Certification Number - (ID: 27503)'], bom: false,
  });
  assert.ok(csv.includes('"00987654"'));
});

// --- prices, descriptions ----------------------------------------------------------------------------

test('a plain amount is accepted in either decimal mark and written in the one asked for', () => {
  assert.equal(formatPrice('10'), '10');
  assert.equal(formatPrice('10.5'), '10.50');
  assert.equal(formatPrice('10,5'), '10.50');
  assert.equal(formatPrice('12,99', ','), '12,99');
  assert.equal(formatPrice('€ 12.99'), '12.99');
});

test('anything that is not a plain amount is refused, never reinterpreted', () => {
  for (const p of ['free', '1,000.00', '1.000,00', '12.999', '-5', '', null, '10 - 20']) {
    assert.equal(formatPrice(p), null, String(p));
  }
});

test('line breaks in a description become the HTML break eBay asks for', () => {
  assert.equal(singleLine('one\r\ntwo\nthree'), 'one<br>two<br>three');
});

// --- cards saved before card type existed -------------------------------------------------------------------

test('a card saved before cardType existed can still have one set and read back', () => {
  const old = newCard({ projectId: 'p' });
  delete old.user.cardType; // what an earlier version stored
  assert.equal(valueOf(old, 'cardType'), null);
  const updated = correct(old, 'cardType', 'sports');
  assert.equal(updated.user.cardType, 'sports', 'stored with the user\'s other choices, not filed as a scanned field');
  assert.equal(valueOf(updated, 'cardType'), 'sports');
});
