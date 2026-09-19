import test from 'node:test';
import assert from 'node:assert/strict';

import { locateCard, scalePlacement } from '../src/cardlocate.js';
import { CARD_ASPECT } from '../src/regions.js';

const deg = (r) => (r * 180) / Math.PI;

/**
 * A photograph with known geometry: a card of the given height, tilted by
 * `tilt` degrees clockwise, on a noisy background. Deterministic noise, so a
 * failure is reproducible.
 */
function photo({ width = 900, height = 1200, bg = [96, 84, 70], face = [236, 228, 205], art = [90, 120, 170],
  cx = width / 2, cy = height / 2, cardHeight = 700, tilt = 0, noise = 10, slope = 0, text = false } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const cardWidth = cardHeight * CARD_ASPECT;
  const a = (tilt * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  let seed = 12345;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Into the card's own frame: undo the tilt about its centre.
      const dx = x - cx, dy = y - cy;
      const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
      const inCard = Math.abs(u) <= cardWidth / 2 && Math.abs(v) <= cardHeight / 2;
      const inArt = Math.abs(u) <= cardWidth * 0.4 && v > -cardHeight * 0.38 && v < cardHeight * 0.1;
      // Printed lines across the lower body of the card, like attack text.
      const inText = text && inCard && !inArt && v > cardHeight * 0.12 && Math.floor(v / 9) % 2 === 0 && Math.abs(u) < cardWidth * 0.42;
      const base = inCard ? (inArt ? art : inText ? face.map((f) => f * 0.45) : face) : bg;
      // A table lit from one side: brighter at the left, darker at the right.
      const c = inCard ? base : base.map((b) => b * (1 + slope * (0.5 - x / width)));
      const n = (rand() - 0.5) * 2 * noise;
      const i = (y * width + x) * 4;
      data[i] = c[0] + n; data[i + 1] = c[1] + n; data[i + 2] = c[2] + n; data[i + 3] = 255;
    }
  }
  return { data, width, height, cardWidth, cardHeight };
}

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual.toFixed(2)}, expected ${expected} ± ${tolerance}`);

test('finds an upright card: position and size', () => {
  const img = photo({ cx: 430, cy: 640 });
  const p = locateCard(img);
  assert.ok(p, 'a card should be found');
  near(p.cx, 430, 12, 'cx');
  near(p.cy, 640, 12, 'cy');
  near(p.h, img.cardHeight, img.cardHeight * 0.05, 'height');
  near(p.w, img.cardWidth, img.cardWidth * 0.06, 'width');
  near(deg(p.angle), 0, 1.5, 'tilt');
});

test('measures a clockwise tilt', () => {
  const p = locateCard(photo({ tilt: 7 }));
  assert.ok(p);
  near(deg(p.angle), 7, 1.5, 'tilt');
});

test('measures an anticlockwise tilt', () => {
  const p = locateCard(photo({ tilt: -12 }));
  assert.ok(p);
  near(deg(p.angle), -12, 1.5, 'tilt');
});

test('finds a dark card on a light table', () => {
  const p = locateCard(photo({ bg: [225, 220, 210], face: [40, 44, 60], art: [20, 30, 90], tilt: 5 }));
  assert.ok(p);
  near(deg(p.angle), 5, 1.5, 'tilt');
});

test('reports the long side as the card height, even for a card lying on its side', () => {
  // Turned 90 + 5 degrees: the long side runs left to right in the photo.
  const img = photo({ tilt: 95, cardHeight: 700, width: 1200, height: 900 });
  const p = locateCard(img);
  assert.ok(p, 'a sideways card should still be found');
  assert.ok(p.h > p.w, 'h is always the long side');
  // 95 degrees and -85 degrees are the same axis; the answer is the one in (-90, 90].
  near(deg(p.angle), -85, 1.5, 'tilt');
});

// Known limit, deliberately not tested as a guarantee: when a card fills the
// whole frame there is no background to stand out from, and its own artwork can
// be mistaken for the card. The finder cannot tell from colour alone, so the
// pipeline does not trust it blindly — a reading that is not confident is
// repeated on the whole frame (see test/smoke.mjs).

test('an empty table has no card', () => {
  assert.equal(locateCard(photo({ cardHeight: 0 })), null);
});

test('a small blob is not mistaken for a card', () => {
  assert.equal(locateCard(photo({ cardHeight: 120 })), null);
});

test('something that is not card-shaped is refused', () => {
  // A wide bar: bright, large, rectangular — and nothing like a 5:7 card.
  const w = 900, h = 1200, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bar = x > 100 && x < 800 && y > 500 && y < 640;
    const i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = bar ? 235 : 90; data[i + 3] = 255;
  }
  assert.equal(locateCard({ data, width: w, height: h }), null);
});

test('finds the card on a table lit from one side', () => {
  const p = locateCard(photo({ slope: 0.6, tilt: 4 }));
  assert.ok(p, 'a lighting gradient must not hide the card or invent one');
  near(deg(p.angle), 4, 1.5, 'tilt');
  near(p.h, 700, 40, 'height');
});

test('finds a card whose body is the same colour as the table, by its printing', () => {
  // Grey card on a grey table: colour alone cannot separate them, but the card
  // is covered in text and the table is not.
  const img = photo({ bg: [176, 172, 165], face: [180, 176, 170], art: [40, 60, 120], text: true, noise: 4 });
  const p = locateCard(img);
  assert.ok(p, 'the card should be found from its detail');
  // The strip above the artwork is blank and exactly table-coloured here, so it
  // cannot be seen and the card comes out a little short. A real card has a
  // printed border and name band there. What matters is that it is the card, not
  // the artwork (the next test) and roughly the right size.
  near(p.h, img.cardHeight, img.cardHeight * 0.15, 'height');
});

test('does not mistake the artwork window for the whole card', () => {
  // The artwork is strongly coloured and roughly card-shaped. Taking it for the
  // card would crop every strip from the wrong place.
  const img = photo({ bg: [176, 172, 165], face: [180, 176, 170], art: [40, 60, 120], text: true, noise: 4, cardHeight: 760 });
  const p = locateCard(img);
  assert.ok(p, 'a card should be found');
  assert.ok(p.h > img.cardHeight * 0.9, `found the ${p.h.toFixed(0)}px artwork instead of the ${img.cardHeight}px card`);
});

test('a photo with a lot of noise still finds the card', () => {
  const p = locateCard(photo({ noise: 38, tilt: 3 }));
  assert.ok(p);
  near(deg(p.angle), 3, 2, 'tilt');
});

test('a placement found on a small copy scales to the full-resolution bitmap', () => {
  const scaled = scalePlacement({ cx: 100, cy: 200, w: 50, h: 70, angle: 0.1 }, 3);
  assert.deepEqual([scaled.cx, scaled.cy, scaled.w, scaled.h, scaled.angle], [300, 600, 150, 210, 0.1]);
});
