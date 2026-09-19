// Turns a card image into something that looks like a phone photo of it: on a
// table, tilted, blurred, glared, noisy and compressed. Runs in the browser, and is
// shared by the accuracy tools so every one of them degrades a card the same way.
//
// A photo depends only on the card and the condition (see seedFor), never on which
// other runs are in the batch, so any subset of a run is comparable with any other.

// --- photo synthesis: a card on a table, tilted, blurred, glared, compressed ---
export const CONDITIONS = {
  clean:  { cardFrac: 1.0,  rot: 0,  skew: 0,    blur: 0,   jpeg: 0.95, glare: 0,    noise: 0 },
  easy:   { cardFrac: 0.85, rot: 2,  skew: 0.01, blur: 0.8, jpeg: 0.85, glare: 0,    noise: 6 },
  medium: { cardFrac: 0.66, rot: 6,  skew: 0.03, blur: 1.3, jpeg: 0.7,  glare: 0.45, noise: 12 },
  hard:   { cardFrac: 0.52, rot: 11, skew: 0.06, blur: 1.9, jpeg: 0.55, glare: 0.8,  noise: 20 },
};
const rng = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
// A photo depends only on the card and the condition, never on which other runs
// are in the batch, so any subset of a run is comparable with any other.
export const seedFor = (id, cond) => { let h = 2166136261; for (const ch of `${id}|${cond}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export async function makePhoto(bitmap, cond, seed) {
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
