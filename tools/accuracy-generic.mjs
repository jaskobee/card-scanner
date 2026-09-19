// How well does the scanner read a card that is NOT in any database?
//
//   npm start                                      # in another terminal
//   node tools/accuracy-generic.mjs
//   node tools/accuracy-generic.mjs --cards 10 --scen clean,easy
//   node tools/accuracy-generic.mjs --via reader   # only the text reader, faster
//   node tools/accuracy-generic.mjs --save /tmp/x  # save the cards that went wrong
//
// tools/accuracy.mjs measures Pokémon cards against a real database. Sports,
// wrestling and film cards have no free database, so there is nothing to look up
// and nothing to check against, except what was printed on them. So this draws
// cards (tools/synthetic-cards.js), records what it drew, degrades them into photos
// (tools/synthetic-photo.js), runs the scanner, and compares.
//
// Read this before quoting a number from it:
//
//  * The cards are DRAWN, with invented people. They have the awkward parts of real
//    ones (a nameplate low down, italic capitals, decoy text as big as the name,
//    logos, legal print) but not their photography, foil glare or print detail.
//    Real photos are harder. Use this to compare one version of the reader with
//    another and to find what breaks, never as a promise about real cards.
//  * It uses real text recognition, so the first run downloads its language data.
//    It is not part of CI.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://localhost:8080');
const count = Number(arg('cards', '20'));
const conditions = arg('scen', 'clean,easy,medium').split(',');
const via = arg('via', 'pipeline');
const saveDir = arg('save', '');

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright', '/usr/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright');
  process.exit(2);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.setDefaultTimeout(0);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
try { await page.goto(base, { waitUntil: 'networkidle' }); } catch {
  console.error(`Could not reach ${base}. Start the app first: npm start`);
  process.exit(2);
}

const started = Date.now();
const results = await page.evaluate(async ({ count, conditions, via, save }) => {
  const { drawCard, LAYOUTS, PEOPLE, BRANDS } = await import('/tools/synthetic-cards.js');
  const { makePhoto, seedFor } = await import('/tools/synthetic-photo.js');
  const { OcrPool, downscale, renderCard } = await import('/src/ocr.js');
  const { locateCard, scalePlacement } = await import('/src/cardlocate.js');
  const { readAnyCard } = await import('/src/generic.js');
  const { processImage } = await import('/src/pipeline.js');
  const { valueOf } = await import('/src/model.js');

  const pool = new OcrPool(); await pool.init();
  // A stand-in for a card database: this is about cards no database knows.
  const provider = { id: 'none', search: async () => [], knownTotals: async () => new Set() };
  const letters = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };

  const out = [];
  for (let i = 0; i < count; i++) {
    const layout = LAYOUTS[i % LAYOUTS.length];
    const name = PEOPLE[(i * 5 + Math.floor(i / LAYOUTS.length)) % PEOPLE.length];
    const brand = BRANDS[(i + Math.floor(i / 5)) % BRANDS.length];
    const id = `${layout}-${i}`;
    const { canvas, truth } = drawCard({ layout, name, brand, seed: 31 + i * 7 });
    const bitmap = await createImageBitmap(canvas);

    for (const cond of conditions) {
      const file = new File([await makePhoto(bitmap, cond, seedFor(id, cond))], `${id}-${cond}.jpg`, { type: 'image/jpeg' });
      const t0 = performance.now();
      let names = [], evidence = {}, gotName = null, error = null;
      try {
        if (via === 'reader') {
          const b = await createImageBitmap(file);
          const small = downscale(b);
          const p = locateCard(small.imageData);
          const upright = renderCard(b, p ? scalePlacement(p, b.width / small.width) : null); b.close();
          const r = await readAnyCard(upright, pool);
          names = r.names.map((n) => n.text); evidence = r.evidence; gotName = names[0] ?? null;
        } else {
          const card = await processImage({ file, projectId: 'g', provider, ocr: pool });
          gotName = valueOf(card, 'name');
          names = [gotName, ...(card.meta.names ?? [])].filter(Boolean);
          evidence = {
            manufacturer: { value: valueOf(card, 'manufacturer') }, product: { value: valueOf(card, 'set') },
            year: { value: valueOf(card, 'year') },
          };
        }
      } catch (e) { error = String(e.message ?? e); }

      out.push({
        id, condition: cond, layout, ms: Math.round(performance.now() - t0), error, truth,
        got: { name: gotName, names, manufacturer: evidence.manufacturer?.value ?? null, product: evidence.product?.value ?? null, year: evidence.year?.value ?? null },
        nameOk: letters(gotName) === letters(name),
        nameSpaced: String(gotName ?? '').trim().toLowerCase() === name.toLowerCase(),
        nameTop3: names.slice(0, 3).some((n) => letters(n) === letters(name)),
        brandOk: brand.manufacturer ? evidence.manufacturer?.value === brand.manufacturer : null,
        productOk: brand.product ? evidence.product?.value === brand.product : null,
        yearOk: truth.year ? Number(evidence.year?.value) === truth.year : null,
        wrong: Boolean(gotName) && letters(gotName) !== letters(name),
        image: save ? await b64(await file.slice()) : null,
      });
    }
  }
  return out;
}, { count, conditions, via, save: Boolean(saveDir) });

await browser.close();

if (saveDir) {
  mkdirSync(saveDir, { recursive: true });
  for (const r of results.filter((x) => !x.nameOk && x.image)) writeFileSync(join(saveDir, `${r.id}-${r.condition}.jpg`), Buffer.from(r.image, 'base64'));
}
for (const r of results) delete r.image;

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-').padStart(5);
const has = (rs, k) => rs.filter((r) => r[k] !== null);
console.log(`\n${results.length} cards in ${Math.round((Date.now() - started) / 1000)}s, read via ${via}.  DRAWN cards, invented people: compare versions, do not quote.\n`);
console.log('condition       n   name  name+space  in top 3  maker  product  year  wrong name  median ms');
for (const cond of conditions) {
  const rs = results.filter((r) => r.condition === cond);
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    cond.padEnd(10), String(rs.length).padStart(4),
    pct(rs.filter((r) => r.nameOk).length, rs.length),
    pct(rs.filter((r) => r.nameSpaced).length, rs.length), '    ',
    pct(rs.filter((r) => r.nameTop3).length, rs.length), '  ',
    pct(has(rs, 'brandOk').filter((r) => r.brandOk).length, has(rs, 'brandOk').length),
    pct(has(rs, 'productOk').filter((r) => r.productOk).length, has(rs, 'productOk').length), ' ',
    pct(has(rs, 'yearOk').filter((r) => r.yearOk).length, has(rs, 'yearOk').length),
    pct(rs.filter((r) => r.wrong).length, rs.length), '     ',
    String(ms[Math.floor(ms.length / 2)] ?? '-').padStart(7),
  );
}
console.log('\nby layout (name found, all conditions):');
for (const l of [...new Set(results.map((r) => r.layout))]) {
  const rs = results.filter((r) => r.layout === l);
  console.log(' ', l.padEnd(18), pct(rs.filter((r) => r.nameOk).length, rs.length), ' in top 3', pct(rs.filter((r) => r.nameTop3).length, rs.length));
}
const bad = results.filter((r) => !r.nameOk).slice(0, 8);
if (bad.length) {
  console.log('\nmisses:');
  for (const r of bad) console.log(`  ${r.id}/${r.condition}: wanted "${r.truth.name}", got ${JSON.stringify(r.got.name)}  (others: ${r.got.names.slice(1, 3).map((n) => JSON.stringify(n)).join(', ') || 'none'})`);
}
// Right letters, wrong spaces ("JORDA NELLIS") count as found above but read badly on a listing.
const spacing = results.filter((r) => r.nameOk && !r.nameSpaced).slice(0, 8);
if (spacing.length) {
  console.log('\nright letters, wrong spaces:');
  for (const r of spacing) console.log(`  ${r.id}/${r.condition}: wanted "${r.truth.name}", got ${JSON.stringify(r.got.name)}`);
}
if (pageErrors.length) console.log('\npage errors:', pageErrors.slice(0, 3));
