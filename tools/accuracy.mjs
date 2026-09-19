// Scan-accuracy measurement. Runs the app's REAL pipeline — real Tesseract, real
// TCGdex — on official card scans, clean and degraded to look like phone photos,
// and reports how often it finds the right card.
//
//   npm start                                   # in another terminal
//   node tools/accuracy.mjs
//   node tools/accuracy.mjs --scen easy,medium --cards en-base1-4,en-sv03-054
//   node tools/accuracy.mjs --save /tmp/overlays   # draw what the card finder saw
//
// Read this before quoting a number from it (CLAUDE.md §10):
//
//  * The photos are SYNTHETIC. They start from ~600px official scans, so the
//    "medium" and "hard" conditions blur away fine print a real 12-megapixel
//    photograph would still have. Treat the figures as a way to compare one
//    version of the code with another, not as a promise about real photos.
//  * The card set is small (see accuracy-set.json). Do not tune to it.
//  * Expected values come from the database itself, never from a person.
//  * It uses the network (the card database, and the OCR data on first use), so
//    it is not part of CI. Be polite: it fetches each fixture once, then caches.
//
// Fixtures are downloaded to test-data/cards/pokemon/.cache/ and are not
// committed: the card images belong to their publishers.

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SET_FILE = join(ROOT, 'test-data/cards/pokemon/accuracy-set.json');
const CACHE = join(ROOT, 'test-data/cards/pokemon/.cache');
const API = 'https://api.tcgdex.net/v2';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://localhost:8080');
const scenarios = arg('scen', 'clean,easy,medium,hard').split(',');
const only = arg('cards', '') ? arg('cards').split(',') : null;
const saveDir = arg('save', '');
const outFile = arg('out', '');

// --- fixtures: fetched once, cached, ground truth from the database ------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureFixtures() {
  mkdirSync(CACHE, { recursive: true });
  const wanted = JSON.parse(readFileSync(SET_FILE, 'utf8')).cards;
  const truth = [];
  for (const { lang, set, localId } of wanted) {
    const key = `${lang}-${set}-${localId}`;
    const meta = join(CACHE, `${key}.json`);
    const png = join(CACHE, `${key}.png`);
    if (!existsSync(meta) || !existsSync(png)) {
      await sleep(350); // three a second at most: a free, volunteer-run service
      const res = await fetch(`${API}/${lang}/sets/${set}/${localId}`);
      if (!res.ok) { console.error(`skipping ${key}: the database answered ${res.status}`); continue; }
      const c = await res.json();
      if (!c.image) { console.error(`skipping ${key}: no image published`); continue; }
      await sleep(350);
      const img = await fetch(`${c.image}/high.png`);
      if (!img.ok) { console.error(`skipping ${key}: image ${img.status}`); continue; }
      writeFileSync(png, Buffer.from(await img.arrayBuffer()));
      writeFileSync(meta, JSON.stringify({
        id: key, lang, cardId: c.id, name: c.name, localId: c.localId,
        set: c.set.name, official: c.set.cardCount?.official ?? null,
      }));
    }
    truth.push(JSON.parse(readFileSync(meta, 'utf8')));
  }
  return truth.filter((t) => !only || only.includes(t.id));
}

// --- browser ---------------------------------------------------------------------

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/usr/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) { try { return require(c); } catch { /* try the next */ } }
  console.error('Playwright is not installed. Run: npm i -D playwright');
  process.exit(2);
}

const truth = await ensureFixtures();
if (!truth.length) { console.error('No fixtures to run.'); process.exit(2); }

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.setDefaultTimeout(0);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.route('**/__fixture/*.png', (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  route.fulfill({ path: join(CACHE, name), contentType: 'image/png' });
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
} catch {
  console.error(`Could not reach ${base}. Start the app first: npm start`);
  process.exit(2);
}

const started = Date.now();
const results = await page.evaluate(async ({ truth, scenarios, save }) => {
  const { processImage } = await import('/src/pipeline.js');
  const { OcrPool, downscale } = await import('/src/ocr.js');
  const { locateCard } = await import('/src/cardlocate.js');
  const { PokemonTcgdexProvider } = await import('/src/providers/pokemon-tcgdex.js');
  const { valueOf } = await import('/src/model.js');
  const { similarity } = await import('/src/normalize.js');

  // --- photo synthesis: a card on a table, tilted, blurred, glared, compressed ---
  const CONDITIONS = {
    clean:  { cardFrac: 1.0,  rot: 0,  skew: 0,    blur: 0,   jpeg: 0.95, glare: 0,    noise: 0 },
    easy:   { cardFrac: 0.85, rot: 2,  skew: 0.01, blur: 0.8, jpeg: 0.85, glare: 0,    noise: 6 },
    medium: { cardFrac: 0.66, rot: 6,  skew: 0.03, blur: 1.3, jpeg: 0.7,  glare: 0.45, noise: 12 },
    hard:   { cardFrac: 0.52, rot: 11, skew: 0.06, blur: 1.9, jpeg: 0.55, glare: 0.8,  noise: 20 },
  };
  const rng = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
  // A photo depends only on the card and the condition, never on which other runs
  // are in the batch, so any subset of a run is comparable with any other.
  const seedFor = (id, cond) => { let h = 2166136261; for (const ch of `${id}|${cond}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  async function makePhoto(bitmap, cond, seed) {
    const sc = CONDITIONS[cond];
    if (cond === 'clean') {
      const c = new OffscreenCanvas(bitmap.width, bitmap.height);
      c.getContext('2d').drawImage(bitmap, 0, 0);
      return c.convertToBlob({ type: 'image/png' });
    }
    const R = rng(seed);
    const W = 1500, H = 2000;
    const c = new OffscreenCanvas(W, H);
    const x = c.getContext('2d');
    const tables = ['#7a6650', '#c9c3b8', '#2b2b30', '#4d6b57'];
    x.fillStyle = tables[seed % tables.length]; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) {
      x.fillStyle = `rgba(${R() < .5 ? 255 : 0},${R() < .5 ? 255 : 0},${R() < .5 ? 255 : 0},${R() * 0.06})`;
      x.fillRect(R() * W, R() * H, R() * 50 + 2, R() * 3 + 1);
    }
    const light = x.createLinearGradient(0, 0, W * R(), H);
    light.addColorStop(0, 'rgba(255,255,255,0.2)'); light.addColorStop(1, 'rgba(0,0,0,0.3)');
    x.fillStyle = light; x.fillRect(0, 0, W, H);

    const ch = sc.cardFrac * H, cw = ch * bitmap.width / bitmap.height;
    x.save();
    x.translate(W / 2 + (R() - .5) * W * 0.05, H / 2 + (R() - .5) * H * 0.05);
    x.rotate((R() * 2 - 1) * sc.rot * Math.PI / 180);
    x.transform(1, 0, (R() * 2 - 1) * sc.skew, 1, 0, 0);
    x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 35; x.shadowOffsetY = 14;
    x.drawImage(bitmap, -cw / 2, -ch / 2, cw, ch);
    x.shadowColor = 'transparent';
    if (sc.glare > 0) {
      // A broad bright band across the card, like light off a sleeve or a holo.
      const gy = (R() * 1.6 - 0.8) * ch / 2;
      const band = x.createLinearGradient(-cw / 2, gy - ch * 0.10, cw / 2, gy + ch * 0.10);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, `rgba(255,255,255,${sc.glare})`);
      band.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = band; x.fillRect(-cw / 2, -ch / 2, cw, ch);
      const bx = (R() - .5) * cw * .7, by = (R() - .5) * ch * .7;
      const spot = x.createRadialGradient(bx, by, 0, bx, by, cw * 0.22);
      spot.addColorStop(0, `rgba(255,255,255,${Math.min(1, sc.glare + .15)})`); spot.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = spot; x.fillRect(-cw / 2, -ch / 2, cw, ch);
    }
    x.restore();

    const c2 = new OffscreenCanvas(W, H);
    const y = c2.getContext('2d', { willReadFrequently: true });
    y.filter = `blur(${sc.blur}px)`; y.drawImage(c, 0, 0); y.filter = 'none';
    if (sc.noise) {
      const id = y.getImageData(0, 0, W, H), d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (R() + R() + R() - 1.5) * sc.noise;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      y.putImageData(id, 0, 0);
    }
    return c2.convertToBlob({ type: 'image/jpeg', quality: sc.jpeg });
  }

  // What the card finder saw: the located card in red, the strips read in yellow.
  async function overlay(file) {
    const b = await createImageBitmap(file);
    const small = downscale(b); b.close();
    const p = locateCard(small.imageData);
    const g = small.canvas.getContext('2d');
    g.lineWidth = 5; g.strokeStyle = p ? '#ff2d2d' : '#2d7bff';
    if (p) {
      g.save(); g.translate(p.cx, p.cy); g.rotate(p.angle);
      g.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -p.h / 2); g.stroke();
      g.strokeStyle = '#ffd400'; g.lineWidth = 3;
      g.strokeRect(-p.w / 2 + p.w * 0.02, -p.h / 2 + p.h * 0.012, p.w * 0.96, p.h * 0.13);
      g.strokeRect(-p.w / 2, -p.h / 2 + p.h * 0.90, p.w * 0.42, p.h * 0.10);
      g.strokeRect(-p.w / 2 + p.w * 0.55, -p.h / 2 + p.h * 0.90, p.w * 0.45, p.h * 0.10);
      g.restore();
    }
    const blob = await small.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { found: Boolean(p), image: btoa(bin) };
  }

  // --- run ---------------------------------------------------------------------
  const pool = new OcrPool();
  await pool.init();
  const providers = {};
  const numerator = (s) => { const m = /^\D*0*(\d+)/.exec(String(s ?? '')); return m ? Number(m[1]) : null; };
  const out = [];

  for (const t of truth) {
    providers[t.lang] ??= new PokemonTcgdexProvider({ language: t.lang });
    const bitmap = await createImageBitmap(await (await fetch(`/__fixture/${t.id}.png`)).blob());
    for (const cond of scenarios) {
      const file = new File([await makePhoto(bitmap, cond, seedFor(t.id, cond))], `${t.id}-${cond}.jpg`, { type: 'image/jpeg' });
      const t0 = performance.now();
      let card = null, error = null;
      // The app's job queue retries a failed card up to three times; do the same,
      // so a passing hiccup at the database is not counted as a missed card.
      for (let attempt = 1; attempt <= 3 && !card; attempt++) {
        try { card = await processImage({ file, projectId: 'accuracy', provider: providers[t.lang], ocr: pool }); error = null; }
        catch (e) {
          error = String(e.message ?? e);
          if (e.retryable === false) break;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      const ms = Math.round(performance.now() - t0);

      const name = card ? valueOf(card, 'name') : null;
      const number = card ? valueOf(card, 'number') : null;
      const seen = save ? await overlay(file) : null;
      out.push({
        id: t.id, condition: cond, ms, error, framing: card?.meta?.framing ?? null,
        expected: { name: t.name, number: `${t.localId}/${t.official}`, set: t.set, cardId: t.cardId },
        got: card && { name, number, set: valueOf(card, 'set'), state: card.state, confidence: card.confidence, margin: card.margin, flags: card.flags, matched: card.reference?.id ?? null },
        nameOk: Boolean(name) && similarity(name, t.name) >= 0.85,
        numberOk: Boolean(number) && numerator(number) === numerator(t.localId)
          && (!/\//.test(number) || Number(String(number).split('/')[1].replace(/\D/g, '')) === t.official),
        rightCard: card?.reference?.id === t.cardId,
        offered: Boolean(card) && (card.reference?.id === t.cardId || (card.candidates ?? []).some((c) => c.id === t.cardId)),
        overlay: seen?.image ?? null,
      });
    }
  }
  return out;
}, { truth, scenarios, save: Boolean(saveDir) });

await browser.close();

if (saveDir) {
  mkdirSync(saveDir, { recursive: true });
  for (const r of results) if (r.overlay) writeFileSync(join(saveDir, `${r.id}-${r.condition}.jpg`), Buffer.from(r.overlay, 'base64'));
}
for (const r of results) delete r.overlay;
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 1));

// --- report ------------------------------------------------------------------------

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-').padStart(5);
console.log(`\n${results.length} runs in ${Math.round((Date.now() - started) / 1000)}s.  SYNTHETIC photos from official scans: use to compare versions, not as a promise.\n`);
console.log('condition      n   name  number  right card  offered  auto-accepted  confidently WRONG  median ms');
for (const cond of scenarios) {
  const rs = results.filter((r) => r.condition === cond);
  const accepted = rs.filter((r) => r.got && (r.got.state === 'IDENTIFIED' || r.got.state === 'VERIFIED'));
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  console.log(
    cond.padEnd(10), String(rs.length).padStart(3),
    pct(rs.filter((r) => r.nameOk).length, rs.length),
    pct(rs.filter((r) => r.numberOk).length, rs.length), '  ',
    pct(rs.filter((r) => r.rightCard).length, rs.length), '   ',
    pct(rs.filter((r) => r.offered).length, rs.length), '   ',
    pct(accepted.length, rs.length), '       ',
    String(accepted.filter((r) => !r.rightCard).length).padStart(9), '        ',
    String(ms[Math.floor(ms.length / 2)] ?? '-').padStart(9),
  );
}
const failed = results.filter((r) => r.error);
if (failed.length) console.log(`\n${failed.length} run(s) failed outright, e.g. ${failed[0].id}/${failed[0].condition}: ${failed[0].error}`);
console.log('\n"offered" = the right card is the top pick or in the alternatives, so one click fixes it.');
console.log('"confidently WRONG" is the number that matters most: it must stay at zero.');
if (pageErrors.length) console.log('\npage errors:', pageErrors.slice(0, 3));
