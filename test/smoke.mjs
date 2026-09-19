// Browser smoke test: does the app actually boot, render and export?
// Run with: node test/smoke.mjs   (requires the dev server on :8080)

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Resolve Playwright from wherever it is installed (local, global, or a path
// given by PLAYWRIGHT_PATH) so the smoke test needs no install of its own.
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/home/claude/.npm-global/lib/node_modules/playwright',
    '/usr/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* try the next one */ }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const URL_BASE = process.env.SMOKE_URL ?? 'http://localhost:8080';
const failures = [];
const log = (ok, name, extra = '') => {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(URL_BASE, { waitUntil: 'networkidle' });

log(await page.title() === 'Card Scanner', 'page loads with its title');
log(consoleErrors.length === 0, 'boots with no console errors', consoleErrors.join(' | '));

await page.waitForSelector('.dropzone', { timeout: 5000 });
log(true, 'upload view renders');

log(await page.locator('#tabs button').count() === 4, 'all four tabs render');

// Privacy statement must be visible on the first screen.
const privacy = await page.locator('.notice').first().innerText();
log(/never uploaded/i.test(privacy), 'privacy note is on the first screen');

// Navigate to Export and confirm the title preview and generic export exist
// without any cards present — an empty state must not throw.
await page.locator('#tabs button', { hasText: 'Export' }).click();
await page.waitForSelector('.panel');
const preview = await page.locator('.notice .mono').first().innerText();
log(/Charizard/.test(preview), 'title template shows a live preview', preview);

// Editing the template updates the preview.
await page.locator('input[aria-label="Title template"]').fill('{name} #{number}');
await page.waitForTimeout(150);
const preview2 = await page.locator('.notice .mono').first().innerText();
log(preview2.trim() === 'Charizard #4/102', 'preview follows the template', preview2);

// Cards view empty state.
await page.locator('#tabs button', { hasText: 'Cards' }).click();
await page.waitForSelector('.empty, .tablewrap');
log(true, 'cards view renders an empty state without throwing');

// Review view with nothing to review.
await page.locator('#tabs button', { hasText: 'Review' }).click();
await page.waitForSelector('.empty, .review');
log(true, 'review view handles having nothing to review');

// Accessibility basics: every control reachable by keyboard has a name.
const unnamed = await page.evaluate(() =>
  [...document.querySelectorAll('button, input, select')]
    .filter((el) => !el.textContent.trim() && !el.getAttribute('aria-label') && !el.labels?.length)
    .map((el) => el.outerHTML.slice(0, 60)));
log(unnamed.length === 0, 'every control has an accessible name', unnamed.join(' | '));

// --- pipeline end to end, in a real browser -------------------------------
// OCR and the card database are stubbed so this test covers our wiring rather
// than a third party's availability. It exercises the real canvas work,
// cropping, signal extraction, matching, scoring and persistence.

const pipeline = await page.evaluate(async () => {
  const { processImage } = await import('/src/pipeline.js');
  const { valueOf, band } = await import('/src/model.js');

  // A synthetic "card": a light rectangle on a dark background with text.
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 840;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#222'; ctx.fillRect(0, 0, 600, 840);
  ctx.fillStyle = '#f4f0e4'; ctx.fillRect(40, 40, 520, 760);
  ctx.fillStyle = '#111'; ctx.font = 'bold 48px sans-serif';
  ctx.fillText('Charizard', 70, 120);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], 'card.png', { type: 'image/png' });

  const ocr = {
    recognise: async () => ({
      text: 'Charizard\nStage 2\n120 HP\n4/102\n© 1999 Wizards of the Coast',
      confidence: 0.93,
      words: [],
    }),
    init: async () => {},
  };

  const provider = {
    id: 'stub',
    search: async () => ([
      { id: 'base1-4', name: 'Charizard', number: '4/102', set: 'Base Set', year: 1999, manufacturer: 'Pokémon', game: 'Pokémon', language: 'en', hasVariants: true, availableVariants: ['holo'] },
      { id: 'base2-4', name: 'Charizard', number: '4/130', set: 'Base Set 2', year: 2000, manufacturer: 'Pokémon', game: 'Pokémon', language: 'en' },
    ]),
  };

  const card = await processImage({ file, projectId: 'test', provider, ocr });

  return {
    name: valueOf(card, 'name'),
    number: valueOf(card, 'number'),
    set: valueOf(card, 'set'),
    year: valueOf(card, 'year'),
    numberSource: card.fields.number.source,
    numberEvidence: card.fields.number.evidence,
    setSource: card.fields.set.source,
    variantValue: card.fields.variant.value,
    confidence: card.confidence,
    margin: card.margin,
    bandKey: band(card.confidence, card.margin).key,
    flags: card.flags,
    candidateCount: card.candidates.length,
    hasThumb: Boolean(card.images.thumb),
    state: card.state,
    conditionValue: card.user.condition,
  };
});

log(pipeline.name === 'Charizard', 'pipeline reads the card name', pipeline.name);
log(pipeline.number === '4/102', 'pipeline reads the printed number', pipeline.number);
log(pipeline.numberSource === 'ocr', 'the number is credited to OCR, not the database');
log(pipeline.numberEvidence === '4/102', 'the printed span is kept as evidence', pipeline.numberEvidence);
log(pipeline.set === 'Base Set', 'the set comes from the matched record', pipeline.set);
log(pipeline.setSource === 'db_match', 'the set is credited to the database');
log(pipeline.year === 1999, 'the copyright year is read', String(pipeline.year));
log(pipeline.variantValue === null, 'no variant was printed, so none was invented');
log(pipeline.flags.includes('variant'), 'the unread variant is flagged for review');
log(pipeline.candidateCount >= 2, 'alternatives are kept, not discarded');
log(pipeline.margin > 0, 'a margin over the runner-up is reported', String(pipeline.margin));
log(pipeline.conditionValue === null, 'condition is left for the user, never inferred');
log(pipeline.hasThumb, 'a thumbnail is stored so originals can be released');
log(pipeline.state === 'NEEDS_REVIEW', 'a flagged card routes to review rather than auto-accepting', pipeline.state);

// --- the eBay file, end to end, in a real browser ---------------------------------
// A mixed batch goes through the starter template and through a template shaped
// like the ones eBay issues. What is asserted is the file a person would upload.

await page.evaluate(async () => {
  const store = await import('/src/storage.js');
  const { newCard, extracted } = await import('/src/model.js');
  const [project] = await store.all('projects');
  const base = Date.now();
  const mk = (i, fields, user = {}) => {
    const c = newCard({ projectId: project.id });
    c.createdAt = base + i;
    for (const [k, v] of Object.entries(fields)) c.fields[k] = extracted(v, 'ocr', 0.9);
    Object.assign(c.user, user);
    return c;
  };
  for (const c of [
    mk(0, { name: 'Charizard', number: '4/102', set: 'Base Set', year: 1999, game: 'Pokémon' }, { condition: 'Near mint or better', price: '45' }),
    mk(1, { name: 'Mike Trout', number: '1', set: 'Topps Chrome', year: 2011 }, { cardType: 'sports', gradingCompany: 'PSA', grade: '10', certNumber: '00987654', price: '120,5' }),
    mk(2, { name: 'Brad Pitt', set: 'Celebrity Cards', year: 2003 }, { cardType: 'nonsport', condition: 'Sehr gut' }),
    mk(3, { name: 'Mystery card' }, { condition: 'Played' }),
  ]) await store.put('cards', c);
});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('#tabs button', { hasText: 'Export' }).click();
await page.locator('button', { hasText: 'Use a starter instead' }).click();

log(/not from eBay/i.test(await page.locator('.notice.warn').first().innerText()), 'the starter says plainly that it is not an eBay file');
const needs = await page.locator('.notice.warn', { hasText: 'Still to decide' }).innerText();
log(/card type \(1\)/.test(needs) && /condition \(not one eBay lists for cards\) \(1\)/.test(needs), 'what is still undecided is named, in words', needs.split('\n')[0]);

const download = async (click) => {
  page.once('dialog', (d) => d.accept()); // "export anyway": one card has no card type
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  return { text: readFileSync(await dl.path(), 'utf8'), name: dl.suggestedFilename() };
};
const parse = (text) => {
  const lines = text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  const header = lines.find((l) => l.startsWith('Action('))?.split(',') ?? [];
  const at = lines.findIndex((l) => l.startsWith('Action('));
  const col = (n) => lines.slice(at + 1).map((l) => l.split(',')[header.indexOf(n)]);
  return { lines, header, at, col };
};

const ebay = await download(() => page.locator('button', { hasText: /^eBay CSV$/ }).click());
const f = parse(ebay.text);
log(ebay.text.startsWith('﻿#INFO'), 'eBay\'s info line is the first line, after the UTF-8 mark');
log(f.header[0].startsWith('Action(SiteID=Germany'), 'Action is the first column');
log(JSON.stringify(f.col('Category ID')) === '["183454","261328","183050","Needs review"]',
  'each card is filed in its own category, and the one with none says so', JSON.stringify(f.col('Category ID')));
log(JSON.stringify(f.col('Condition ID')) === '["4000","2750","4000","4000"]', 'graded is 2750 and ungraded 4000', JSON.stringify(f.col('Condition ID')));
log(JSON.stringify(f.col('CD:Card Condition - (ID: 40001)')) === '["400010","","400012",""]',
  'an ungraded condition is its eBay descriptor, and a condition eBay lacks is left empty', JSON.stringify(f.col('CD:Card Condition - (ID: 40001)')));
log(f.col('CD:Professional Grader - (ID: 27501)')[1] === '275010' && f.col('CD:Grade - (ID: 27502)')[1] === '275020', 'a graded card carries grader and grade');
log(f.col('CDA:Certification Number - (ID: 27503)')[1] === '"00987654"', 'the certificate number keeps its leading zeroes');
log(JSON.stringify(f.col('Start price')) === '["45","120.50","",""]', 'prices are plain amounts, or empty', JSON.stringify(f.col('Start price')));
log(f.col('Format').every((v) => v === 'FixedPrice'), 'Format is always written, because eBay defaults it to Auction');
log(f.col(f.header[0]).every((v) => v === 'VerifyAdd'), 'the first upload is a check, not a live listing');
log(f.col('Title').every((t) => t.length <= 80), 'titles stay within eBay\'s 80 characters');

// The mark can be left off, in case eBay objects to it on the first line.
await page.locator('label', { hasText: 'Mark the file as UTF-8' }).locator('input').uncheck();
const plain = await download(() => page.locator('button', { hasText: /^eBay CSV$/ }).click());
log(plain.text.startsWith('#INFO'), 'without the mark the file starts with the info line');
await page.locator('label', { hasText: 'Mark the file as UTF-8' }).locator('input').check();

const blank = readFileSync(await (await Promise.all([
  page.waitForEvent('download'), page.locator('button', { hasText: 'Download the blank starter' }).click(),
]))[0].path(), 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean);
log(blank.length === 2 && blank[0].startsWith('#INFO'), 'the blank starter is the info line and the header, nothing else', String(blank.length));

// One file per kind of card, for when eBay refuses a mixed file.
const names = [];
page.on('download', (d) => names.push(d.suggestedFilename()));
page.once('dialog', (d) => d.accept());
await page.locator('button', { hasText: 'one file per card type' }).click();
await page.waitForTimeout(2200);
log(['ccg', 'sports', 'nonsport', 'no-card-type'].every((k) => names.some((n) => n.includes(`-ebay-${k}`))),
  'one file per kind of card, and one for cards with no kind', names.join(', '));

// A template shaped like eBay's: info lines above the header, and a column we do not know.
const template = [
  '#INFO,Version=1.0.0,Template=fx_category_template_EBAY_DE,,,,',
  '#INFO,Action and Category ID are required,,,,,',
  'Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8),Category ID,Title,Condition ID,C:Game,C:Zzz Unknown Column',
].join('\r\n') + '\r\n';
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'Upload eBay template' }).click()]);
await chooser.setFiles({ name: 'template.csv', mimeType: 'text/csv', buffer: Buffer.from(template) });
await page.waitForSelector('text=Your template: 6 columns');
const own = await download(() => page.locator('button', { hasText: /^eBay CSV$/ }).click());
const o = own.text.replace(/^﻿/, '').split('\r\n');
log(o[0] === '#INFO,Version=1.0.0,Template=fx_category_template_EBAY_DE,,,,' && o[1].startsWith('#INFO,Action and Category'),
  'a template\'s own info lines are written back exactly as they came', o[0]);
const oc = parse(own.text);
log(oc.col('C:Zzz Unknown Column').every((v) => v === ''), 'a column we do not know is preserved, and left empty rather than invented');
log(oc.col('C:Game')[0] === 'Pokémon', 'a column we do recognise is filled from the card');

// eBay's default download is Excel, which is not read yet: say what to do.
const [xl] = await Promise.all([page.waitForEvent('filechooser'), page.locator('button', { hasText: 'Upload eBay template' }).click()]);
await xl.setFiles({ name: 'template.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') });
await page.waitForSelector('#toast.show');
log(/download the template as \.csv/i.test(await page.locator('#toast').innerText()), 'an Excel template is explained, not silently ignored');

// On a card: choose what eBay needs to know, and it is remembered.
await page.locator('#tabs button', { hasText: 'Cards' }).click();
await page.locator('tbody tr', { hasText: 'Mystery card' }).locator('button[aria-label="Open this card"]').click();
await page.waitForSelector('.review');
await page.locator('select[aria-label="Card type"]').selectOption('nonsport');
await page.waitForTimeout(250);
log(await page.locator('.review').count() === 1, 'editing a card opened from the table keeps it on screen, not the review queue');
await page.waitForTimeout(250);
const stored = await page.evaluate(async () => {
  const store = await import('/src/storage.js');
  return (await store.all('cards')).find((c) => c.fields.name.value === 'Mystery card')?.user.cardType;
});
log(stored === 'nonsport', 'a card type chosen on a card is saved', String(stored));
log(await page.locator('select[aria-label="Condition"] option[value="Played"]').count() === 1,
  'a condition eBay does not offer stays visible, marked, instead of vanishing');

log(consoleErrors.length === 0, 'no console errors after navigating every view', consoleErrors.join(' | '));

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed.`);
  process.exit(1);
}
console.error('\nAll smoke checks passed.');
