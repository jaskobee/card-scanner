// Run the real scanner on your own photos and show what it read, and from where.
//
//   node tools/scan-photos.mjs                       # every photo in test-data/local/
//   node tools/scan-photos.mjs --dir ~/Pictures/cards
//   node tools/scan-photos.mjs --save /tmp/overlays  # also draw what it found on each card
//   node tools/scan-photos.mjs --base http://localhost:8080   # use an app that is already running
//
// It starts the app itself for the length of the run unless you point it at one.
//
// For each photo it prints the fields the app would fill in, with where each came
// from and how sure it is, then every line of text it could read. When a card
// scans badly this is where to look first: either the text was there and the
// wrong piece was chosen, or it was never read at all.
//
// It uses the real text recogniser and the real card database, so it needs the
// network. Your photos stay on this machine: nothing is uploaded except the name
// and number the app looks up, exactly as in the app. It is not part of CI.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
let base = arg('base', '');
const dir = resolve(arg('dir', join(ROOT, 'test-data/local')));
const saveDir = arg('save', '');

const KINDS = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const photos = existsSync(dir) ? readdirSync(dir).filter((f) => KINDS[extname(f).toLowerCase()]).sort() : [];
if (!photos.length) {
  console.error(`No photos found in ${dir}\nPut the original .jpg / .png / .webp files there (see test-data/local/README.md).`);
  process.exit(2);
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core', '/usr/lib/node_modules/playwright'].filter(Boolean)) {
    try { return require(c); } catch { /* next */ }
  }
  console.error([
    'Playwright is not installed. This tool drives a real browser. Nothing here is added to package.json:',
    '  npm i --no-save playwright-core                 # small; then point it at a browser you already have:',
    '  CHROMIUM_PATH=/usr/bin/chromium node ' + process.argv[1].replace(process.cwd() + '/', ''),
    'or let Playwright fetch its own browser (larger):',
    '  npm i --no-save playwright && npx playwright install chromium',
  ].join('\n'));
  process.exit(2);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.setDefaultTimeout(0);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
const reachable = async (url) => { try { await page.goto(url, { waitUntil: 'networkidle' }); return true; } catch { return false; } };
let server = null;
process.on('exit', () => server?.kill());
if (!(base && await reachable(base))) {
  if (base) { console.error(`Could not reach ${base}. Leave --base off and the app is started for you.`); process.exit(2); }
  server = spawn(process.execPath, [join(ROOT, 'tools/serve.js')], { env: { ...process.env, PORT: '8123' }, stdio: 'ignore' });
  base = 'http://localhost:8123';
  for (let i = 0; i < 40 && !(await reachable(base)); i++) await new Promise((r) => setTimeout(r, 250));
}

await page.evaluate(async () => {
  const { OcrPool } = await import('/src/ocr.js');
  globalThis.__pool = new OcrPool();
  await globalThis.__pool.init();
});

if (saveDir) mkdirSync(saveDir, { recursive: true });

for (const name of photos) {
  const bytes = readFileSync(join(dir, name)).toString('base64');
  const r = await page.evaluate(async ({ name, bytes, type, draw }) => {
    const { processImage } = await import('/src/pipeline.js');
    const { PokemonTcgdexProvider } = await import('/src/providers/pokemon-tcgdex.js');
    const { downscale, renderCard } = await import('/src/ocr.js');
    const { locateCard, scalePlacement } = await import('/src/cardlocate.js');
    const { readAnyCard } = await import('/src/generic.js');

    const raw = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
    const file = new File([raw], name, { type });
    const pool = globalThis.__pool;
    const t0 = performance.now();
    let card = null, error = null;
    try { card = await processImage({ file, projectId: 'photos', provider: new PokemonTcgdexProvider({ language: 'en' }), ocr: pool }); }
    catch (e) { error = String(e.message ?? e); }

    let overlay = null, lines = [];
    if (draw) {
      // Draw the card as the reader saw it, with every line of text boxed and the
      // likeliest name marked, so a wrong pick can be seen at a glance.
      const b = await createImageBitmap(file);
      const small = downscale(b);
      const located = locateCard(small.imageData);
      const placement = located ? scalePlacement(located, b.width / small.width) : null;
      const canvas = renderCard(b, placement); b.close();
      const g = await readAnyCard(canvas, pool);
      lines = g.lines;
      const x = canvas.getContext('2d');
      const top = g.names[0]?.text;
      x.lineWidth = 3; x.font = '18px sans-serif';
      for (const l of g.lines) {
        const chosen = top && l.text.replace(/\W/g, '').toLowerCase() === top.replace(/\W/g, '').toLowerCase();
        x.strokeStyle = chosen ? '#00d26a' : '#ff9f0a';
        x.strokeRect(l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0);
        x.fillStyle = chosen ? '#00d26a' : '#ff9f0a';
        x.fillText(l.text.slice(0, 40), l.x0, Math.max(16, l.y0 - 4));
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
      overlay = btoa(s);
    }
    return {
      ms: Math.round(performance.now() - t0), error,
      state: card?.state, confidence: card?.confidence, flags: card?.flags, errors: card?.errors,
      fields: card ? Object.fromEntries(Object.entries(card.fields).filter(([, v]) => v?.value !== null && v?.value !== undefined && v?.value !== '')) : {},
      meta: card ? { framing: card.meta.framing, read: card.meta.read, names: card.meta.names, texts: card.meta.texts } : {},
      overlay,
    };
  }, { name, bytes, type: KINDS[extname(name).toLowerCase()], draw: Boolean(saveDir) });

  console.log(`\n=== ${name}  (${(r.ms / 1000).toFixed(1)}s)`);
  if (r.error) { console.log(`  FAILED: ${r.error}`); continue; }
  const pct = (n) => `${Math.round(n * 100)}%`;
  console.log(`  state ${r.state}, confidence ${pct(r.confidence ?? 0)}, framing ${r.meta.framing ?? '-'}${r.meta.read ? `, read as ${r.meta.read}` : ''}`);
  const rows = Object.entries(r.fields);
  if (!rows.length) console.log('  (no fields found)');
  for (const [k, v] of rows) console.log(`  ${k.padEnd(13)} ${String(v.value).padEnd(28)} ${v.source.padEnd(9)} ${pct(v.confidence).padStart(4)}   from ${JSON.stringify(v.evidence ?? '')}`);
  if (r.flags?.length) console.log(`  needs a look: ${r.flags.join(', ')}`);
  if (r.errors?.length) console.log(`  note: ${r.errors.join(' | ')}`);
  if (r.meta.names?.length) console.log(`  other names it considered: ${r.meta.names.map((n) => JSON.stringify(n)).join(', ')}`);
  if (r.meta.texts?.length) {
    console.log('  text it could read, biggest first:');
    for (const t of r.meta.texts.slice(0, 14)) console.log(`    ${pct(t.confidence).padStart(4)}  ${(t.size * 100).toFixed(1).padStart(4)}% tall  ${JSON.stringify(t.text)}`);
  }
  if (r.overlay) {
    const out = join(saveDir, `${basename(name, extname(name))}.card.png`);
    writeFileSync(out, Buffer.from(r.overlay, 'base64'));
    console.log(`  picture of what it saw: ${out}`);
  }
}
if (pageErrors.length) console.log('\npage errors:', pageErrors.slice(0, 3));
await browser.close();
server?.kill();
