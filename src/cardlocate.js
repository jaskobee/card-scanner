// Find the card in a photograph: where it is, how big, and how far it is tilted.
// Pure typed-array code, so it runs — and is tested — without a canvas.
//
// Method: model the background from the frame's outer edge as a sloping plane
// (a table is rarely evenly lit), then mark whatever stands out from it by
// colour OR by texture. Texture matters because a card's body is full of text
// and detail while a table is smooth, so a silver card on a grey desk is still
// found even where the colours agree. Keep the largest connected blob, take its
// convex hull, and find the tightest rectangle around that hull at any tilt. A
// card is a rectangle, so a blob that is not one is not trusted and the caller
// reads the whole frame instead.

import { boxBlur } from './imageproc.js';
import { CARD_ASPECT } from './regions.js';

const WORK_EDGE = 400;      // analysis size: cheap, and plenty to find a card
const MIN_CONTRAST = 24;    // never treat a smaller colour difference than this as "card"
const MIN_TEXTURE = 10;     // ... or a smaller amount of local detail

/**
 * @param {{data: Uint8ClampedArray, width: number, height: number}} image RGBA
 * @returns {{cx:number, cy:number, w:number, h:number, angle:number, area:number} | null}
 *   In the input image's pixels. w is the card's short side, h its long side,
 *   angle how far it is turned clockwise from upright, in radians within
 *   (-pi/2, pi/2]. null when nothing card-shaped stands out.
 */
export function locateCard(image) {
  const { rgb, width: w, height: h, factor } = shrink(image, WORK_EDGE);
  if (w < 40 || h < 40) return null;

  const { distance, ringDistance } = distanceFromBackground(rgb, w, h);
  const { energy, ringEnergy } = detailEnergy(rgb, w, h);

  // "Stands out" is measured against how much the background itself varies, so
  // a mottled table is not mistaken for a card and a smooth one is not missed.
  const distanceLimit = Math.max(MIN_CONTRAST, 2.2 * percentile(ringDistance, 0.95));
  const energyLimit = Math.max(MIN_TEXTURE, 2.5 * percentile(ringEnergy, 0.95));

  // Mark what stands out, then despeckle: blur the mask and re-threshold so
  // stray pixels vanish and gaps between letters fill in.
  const raw = new Float32Array(w * h);
  for (let i = 0; i < raw.length; i++) raw[i] = distance[i] > distanceLimit || energy[i] > energyLimit ? 1 : 0;
  const soft = boxBlur(raw, w, h, 3);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = soft[i] > 0.5 ? 1 : 0;

  const blob = largestBlob(mask, w, h);
  if (!blob) return null;

  // A card that fills the frame has no background to stand out from.
  const touching = [blob.minX === 0, blob.maxX === w - 1, blob.minY === 0, blob.maxY === h - 1].filter(Boolean).length;
  if (touching >= 3) return null;

  const hull = convexHull(blob.rowExtremes);
  if (hull.length < 3) return null;

  const rect = tightestRectangle(hull);
  const frameArea = w * h;
  const areaFraction = rect.width * rect.height / frameArea;
  const hullFill = polygonArea(hull) / (rect.width * rect.height);
  const aspect = Math.min(rect.width, rect.height) / Math.max(rect.width, rect.height);

  if (areaFraction < 0.08 || areaFraction > 0.98) return null;
  if (hullFill < 0.88) return null;                       // not rectangular
  if (Math.abs(aspect - CARD_ASPECT) > 0.13) return null; // not card-shaped

  // Report with the long side vertical and the tilt in (-90deg, 90deg].
  let { cx, cy, width, height, angle } = rect;
  if (width > height) { [width, height] = [height, width]; angle += Math.PI / 2; }
  while (angle > Math.PI / 2) angle -= Math.PI;
  while (angle <= -Math.PI / 2) angle += Math.PI;

  return { cx: cx * factor, cy: cy * factor, w: width * factor, h: height * factor, angle, area: areaFraction };
}

/** Rescale a placement found on a smaller copy to the full-resolution bitmap. */
export function scalePlacement(p, scale) {
  return { ...p, cx: p.cx * scale, cy: p.cy * scale, w: p.w * scale, h: p.h * scale };
}

// --- internals ---------------------------------------------------------------

/** Average whole blocks of pixels down to at most `edge` on the long side. */
function shrink(image, edge) {
  const { data, width, height } = image;
  const factor = Math.max(1, Math.ceil(Math.max(width, height) / edge));
  const w = Math.floor(width / factor), h = Math.floor(height / factor);
  const rgb = new Float32Array(w * h * 3);
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        let i = ((y * factor + dy) * width + x * factor) * 4;
        for (let dx = 0; dx < factor; dx++, i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
      }
      const o = (y * w + x) * 3;
      rgb[o] = r / area; rgb[o + 1] = g / area; rgb[o + 2] = b / area;
    }
  }
  return { rgb, width: w, height: h, factor };
}

/**
 * Per-pixel colour distance from the background, where the background is a plane
 * fitted to the frame's edge — one per colour channel — so a table lit from one
 * side does not read as a card. The fit is repeated after discarding edge pixels
 * that do not agree with it (a card corner reaching the edge, a thumb).
 */
function distanceFromBackground(rgb, w, h) {
  const t = Math.max(2, Math.round(0.03 * Math.min(w, h)));
  const ring = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x < t || y < t || x >= w - t || y >= h - t) && (x + y) % 2 === 0) ring.push(y * w + x);
  }

  let use = ring;
  let planes = fitPlanes(rgb, w, use);
  for (let pass = 0; pass < 2; pass++) {
    const residuals = use.map((p) => planeResidual(rgb, w, p, planes));
    const limit = Math.max(12, 2.5 * percentile(residuals, 0.5));
    const kept = use.filter((_, i) => residuals[i] <= limit);
    if (kept.length < 20) break;
    use = kept;
    planes = fitPlanes(rgb, w, use);
  }

  const out = new Float32Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = Math.min(255, planeResidual(rgb, w, p, planes));
  return { distance: out, ringDistance: ring.map((p) => out[p]) };
}

/** Least-squares plane a + b*x + c*y for each of R, G, B over the given pixels. */
function fitPlanes(rgb, w, pixels) {
  // Normal equations for [1, x, y]; the matrix is shared by all three channels.
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  const rhs = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // per channel: sum v, sum x*v, sum y*v
  for (const p of pixels) {
    const x = p % w, y = (p / w) | 0;
    n++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
    for (let c = 0; c < 3; c++) {
      const v = rgb[p * 3 + c];
      rhs[c][0] += v; rhs[c][1] += x * v; rhs[c][2] += y * v;
    }
  }
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  return rhs.map((b) => solve3(A, b) ?? [b[0] / n, 0, 0]); // flat colour if the plane is degenerate
}

function solve3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

function planeResidual(rgb, w, p, planes) {
  const x = p % w, y = (p / w) | 0;
  let sum = 0;
  for (let c = 0; c < 3; c++) {
    const [a, bx, by] = planes[c];
    const d = rgb[p * 3 + c] - (a + bx * x + by * y);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Local detail: how much the brightness changes in the neighbourhood. Printed
 * text and artwork are dense with it; a table top is not.
 */
function detailEnergy(rgb, w, h) {
  const l = new Float32Array(w * h);
  for (let p = 0; p < l.length; p++) l[p] = 0.299 * rgb[p * 3] + 0.587 * rgb[p * 3 + 1] + 0.114 * rgb[p * 3 + 2];
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    grad[p] = Math.abs(l[p + 1] - l[p - 1]) + Math.abs(l[p + w] - l[p - w]);
  }
  const energy = boxBlur(grad, w, h, 3);
  const t = Math.max(2, Math.round(0.03 * Math.min(w, h)));
  const ringEnergy = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if ((x < t || y < t || x >= w - t || y >= h - t) && (x + y) % 2 === 0) ringEnergy.push(energy[y * w + x]);
  }
  return { energy, ringEnergy };
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** The biggest 4-connected blob, with its bounding box and each row's leftmost and rightmost pixels. */
function largestBlob(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = null;

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let sp = 0, count = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    const left = new Int32Array(h).fill(w), right = new Int32Array(h).fill(-1);
    stack[sp++] = start; seen[start] = 1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x < left[y]) left[y] = x;
      if (x > right[y]) right[y] = x;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (!best || count > best.count) {
      const rowExtremes = [];
      for (let y = minY; y <= maxY; y++) {
        if (right[y] >= 0) { rowExtremes.push([left[y], y], [right[y] + 1, y + 1]); }
      }
      best = { count, minX, maxX, minY, maxY, rowExtremes };
    }
  }
  return best;
}

/** Andrew's monotone chain. Points are [x, y]. */
function convexHull(points) {
  const pts = points.map((p) => p.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * The smallest rectangle around a hull, at any tilt from -45 to +45 degrees.
 * Returns its centre and size in the image's frame and the tilt that produced
 * it (how far the rectangle is turned clockwise from axis-aligned).
 */
function tightestRectangle(hull) {
  let best = null;
  const evaluate = (deg) => {
    const a = (-deg * Math.PI) / 180;              // rotate the points back by the tilt
    const cos = Math.cos(a), sin = Math.sin(a);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of hull) {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const width = maxX - minX, height = maxY - minY;
    if (!best || width * height < best.width * best.height) {
      // Centre in the rotated frame, brought back to the image frame.
      const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
      const back = -a;
      best = {
        cx: mx * Math.cos(back) - my * Math.sin(back),
        cy: mx * Math.sin(back) + my * Math.cos(back),
        width, height, angle: (deg * Math.PI) / 180,
      };
    }
  };
  for (let deg = -45; deg < 45; deg += 1) evaluate(deg);
  const coarse = (best.angle * 180) / Math.PI;
  for (let deg = coarse - 1; deg <= coarse + 1; deg += 0.1) evaluate(deg);
  return best;
}
