import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeField, toCsv, parseCsv, detectDelimiter, parseTemplate,
  suggestMapping, normalizeHeader, buildTemplateRows, validateRows, MISSING,
} from '../src/csv.js';

test('escapes quotes by doubling', () => {
  assert.equal(escapeField('He said "hi"'), '"He said ""hi"""');
});

test('quotes fields containing the delimiter', () => {
  assert.equal(escapeField('a,b', ','), '"a,b"');
  assert.equal(escapeField('a,b', ';'), 'a,b');
  assert.equal(escapeField('a;b', ';'), '"a;b"');
});

test('preserves leading zeroes as quoted text', () => {
  assert.equal(escapeField('004/120'), '"004/120"');
  assert.equal(escapeField('0057'), '"0057"');
});

test('protects fraction-shaped card numbers from date coercion', () => {
  assert.equal(escapeField('4/102'), '"4/102"');
  assert.equal(escapeField('1-2'), '"1-2"');
});

test('protects long digit strings from scientific notation', () => {
  assert.equal(escapeField('123456789012345'), '"123456789012345"');
});

test('neutralises formula injection', () => {
  assert.equal(escapeField('=1+1'), "'=1+1");
  assert.equal(escapeField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeField('-2+3'), "'-2+3");
});

test('quotes embedded newlines', () => {
  assert.equal(escapeField('line1\nline2'), '"line1\nline2"');
});

test('empty and null render as empty, never as the string null', () => {
  assert.equal(escapeField(null), '');
  assert.equal(escapeField(undefined), '');
  assert.equal(escapeField(''), '');
});

test('toCsv writes a BOM by default so Excel reads UTF-8', () => {
  const out = toCsv(['a'], [{ a: 'Glück' }]);
  assert.ok(out.startsWith('﻿'));
});

test('round-trips every hazard in one row', () => {
  const headers = ['Title', 'Number', 'Notes', 'Price', 'Formula'];
  const row = {
    Title: 'Glurak "Öß" — 1ère édition, リザードン',
    Number: '004/120',
    Notes: 'line1\nline2, with comma; and semicolon',
    Price: '12,50',
    Formula: '=cmd()',
  };
  for (const delimiter of [',', ';']) {
    const csv = toCsv(headers, [row], { delimiter });
    const { rows } = parseCsv(csv, { delimiter });
    assert.deepEqual(rows[0], headers, `headers survive with ${delimiter}`);
    const parsed = rows[1];
    assert.equal(parsed[0], row.Title);
    assert.equal(parsed[1], '004/120');
    assert.equal(parsed[2], row.Notes);
    assert.equal(parsed[3], '12,50');
    assert.equal(parsed[4], "'=cmd()"); // neutralised, and stably so
  }
});

test('detects the German semicolon convention', () => {
  assert.equal(detectDelimiter('Titel;Preis;Menge\nA;1;2'), ';');
  assert.equal(detectDelimiter('Title,Price,Qty\nA,1,2'), ',');
});

test('does not count delimiters inside quoted headers', () => {
  assert.equal(detectDelimiter('"Last, First";Age'), ';');
});

test('normalizeHeader strips marketplace decoration', () => {
  assert.equal(normalizeHeader('*Title'), 'title');
  assert.equal(normalizeHeader('C:Card Number'), 'card number');
  assert.equal(normalizeHeader('Condition (required)'), 'condition');
});

const TEMPLATE = [
  '#INFO This template is generated for your account',
  '#INFO Do not remove the header row',
  '*Action(SiteID=Germany|Country=DE),*Title,*Category,C:Card Number,C:Set,*ConditionID,*Format,*StartPrice,*Quantity,CustomLabel,MysteryColumn',
  'Add,,,,,,,,,,',
].join('\n');

test('finds the header row below marketplace preamble', () => {
  const t = parseTemplate(TEMPLATE);
  assert.equal(t.columnCount, 11);
  assert.ok(t.headers.includes('*Title'));
  assert.equal(t.preamble.length, 2);
});

test('detects required columns from the asterisk convention', () => {
  const t = parseTemplate(TEMPLATE);
  assert.ok(t.required.includes('*Title'));
  assert.ok(!t.required.includes('CustomLabel'));
});

test('suggests a mapping and reports what it could not place', () => {
  const t = parseTemplate(TEMPLATE);
  const { mapping, unknownColumns } = suggestMapping(t.headers);
  assert.equal(mapping.title, '*Title');
  assert.equal(mapping.number, 'C:Card Number');
  assert.equal(mapping.set, 'C:Set');
  assert.equal(mapping.sku, 'CustomLabel');
  // An unrecognised column is reported, never quietly dropped or guessed at.
  assert.ok(unknownColumns.includes('MysteryColumn'));
});

test('unknown columns are emitted empty, never invented', () => {
  const t = parseTemplate(TEMPLATE);
  const { mapping } = suggestMapping(t.headers);
  const cards = [{ title: 'X' }];
  const rows = buildTemplateRows(cards, t, mapping, (c, f) => (f === 'title' ? c.title : null));
  assert.equal(rows[0]['MysteryColumn'], '');
  assert.equal(rows[0]['*Title'], 'X');
});

test('required fields with no evidence are marked, not guessed', () => {
  const t = parseTemplate(TEMPLATE);
  const { mapping } = suggestMapping(t.headers);
  const rows = buildTemplateRows([{}], t, mapping, () => null);
  assert.equal(rows[0]['*Title'], MISSING);
  assert.equal(rows[0]['C:Card Number'], ''); // optional stays empty
});

test('validation blocks on missing required fields and reports them by column', () => {
  const t = parseTemplate(TEMPLATE);
  const { mapping } = suggestMapping(t.headers);
  const rows = buildTemplateRows([{}, {}], t, mapping, () => null);
  const v = validateRows(rows, t);
  assert.equal(v.ok, false);
  assert.equal(v.total, 2);
  assert.equal(v.complete, 0);
  const titleIssue = v.issues.find((i) => i.header === '*Title');
  assert.deepEqual(titleIssue.indexes, [0, 1]);
});

test('parses a fully populated template row back out unchanged', () => {
  const src = 'A;B\n"x;y";"say ""hi"""\n';
  const { rows } = parseCsv(src);
  assert.deepEqual(rows[1], ['x;y', 'say "hi"']);
});
