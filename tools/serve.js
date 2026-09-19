// Zero-dependency static server for local development.
// ES modules need a real origin, so opening index.html from the filesystem
// will not work — run `npm start` instead.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // Never serve outside the project root.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, rel === '/' ? 'index.html' : rel);

    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // The app needs these for OffscreenCanvas + worker-based OCR.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Card Scanner running at http://localhost:${PORT}`);
});
