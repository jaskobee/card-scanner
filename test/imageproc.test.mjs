import test from 'node:test';
import assert from 'node:assert/strict';

import { luma, boxBlur, flattenIllumination, stretchContrast, otsuThreshold, binarize, toRgba } from '../src/imageproc.js';

// A row of dark "ink" strokes on a page whose lighting falls off left to right,
// the way glare or a shadow gradient does.
function inkOnGradient(width, height) {
  const g = new Float32Array(width * height);
  const inkAt = (x, y) => y > 8 && y < height - 8 && x % 12 < 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const light = 240 - (x / width) * 150; // 240 on the left, 90 on the right
      g[y * width + x] = inkAt(x, y) ? light * 0.35 : light;
    }
  }
  return { g, inkAt };
}

test('luma weights green above red above blue', () => {
  const l = luma(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
  assert.ok(l[1] > l[0] && l[0] > l[2]);
});

test('a box blur of a flat image changes nothing, edges included', () => {
  const flat = new Float32Array(40 * 30).fill(100);
  const out = boxBlur(flat, 40, 30, 5);
  assert.ok(out.every((v) => Math.abs(v - 100) < 1e-3));
});

test('a box blur averages a single bright pixel into its neighbourhood', () => {
  const src = new Float32Array(11 * 11);
  src[5 * 11 + 5] = 121;
  const out = boxBlur(src, 11, 11, 5);
  assert.ok(Math.abs(out[5 * 11 + 5] - 1) < 1e-3); // 121 spread over 11x11
});

test('one global threshold cannot separate ink across a lighting gradient', () => {
  const { g, inkAt } = inkOnGradient(240, 40);
  const t = otsuThreshold(g);
  const bin = binarize(g, t);
  let wrong = 0;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 240; x++) {
    if ((bin[y * 240 + x] === 0) !== inkAt(x, y)) wrong++;
  }
  assert.ok(wrong > 240 * 40 * 0.05, `expected the gradient to defeat a global threshold, got ${wrong} wrong`);
});

test('flattening the lighting lets one threshold read ink everywhere', () => {
  const { g, inkAt } = inkOnGradient(240, 40);
  const flat = flattenIllumination(g, 240, 40, 20);
  const bin = binarize(flat, otsuThreshold(flat));
  let wrong = 0;
  for (let y = 0; y < 40; y++) for (let x = 0; x < 240; x++) {
    if ((bin[y * 240 + x] === 0) !== inkAt(x, y)) wrong++;
  }
  assert.ok(wrong < 240 * 40 * 0.03, `${wrong} pixels wrong after flattening`);
});

test('flattening leaves a uniformly lit page white', () => {
  const flat = flattenIllumination(new Float32Array(50 * 50).fill(80), 50, 50, 10);
  assert.ok(flat.every((v) => v > 254));
});

test('percentile stretching is not defeated by one blown-out pixel', () => {
  const g = new Float32Array(1000);
  for (let i = 0; i < g.length; i++) g[i] = 100 + (i % 50); // 100..149
  g[0] = 255; // one specular highlight
  const out = stretchContrast(g);
  const spread = Math.max(...out.slice(1)) - Math.min(...out.slice(1));
  assert.ok(spread > 200, `contrast collapsed to ${spread}`);
});

test('otsu finds the gap between two flat levels', () => {
  const g = new Float32Array(200);
  for (let i = 0; i < 200; i++) g[i] = i < 60 ? 30 : 200;
  const t = otsuThreshold(g);
  assert.ok(t >= 30 && t < 200);
  const bin = binarize(g, t);
  assert.equal(bin[0], 0);
  assert.equal(bin[199], 255);
});

test('binarizing a flat image does not throw and yields one colour', () => {
  const bin = binarize(new Float32Array(30).fill(128), otsuThreshold(new Float32Array(30).fill(128)));
  assert.equal(new Set(bin).size, 1);
});

test('greyscale converts to opaque RGBA', () => {
  const rgba = toRgba(new Float32Array([0, 128, 255]));
  assert.deepEqual([...rgba], [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
});

// Strokes of one brightness on a ground of another, as text is on a card.
function strokes(width, height, ground, ink) {
  const g = new Float32Array(width * height).fill(ground);
  for (let y = 10; y < height - 10; y++) for (let x = 0; x < width; x++) if (x % 14 < 3) g[y * width + x] = ink;
  return g;
}

test('flattening keeps dark print on a light ground', () => {
  const g = strokes(200, 40, 220, 30);
  const out = flattenIllumination(g, 200, 40, 12);
  assert.ok(out[20 * 200 + 1] < 100, 'a stroke pixel comes out dark');
  assert.ok(out[20 * 200 + 8] > 240, 'the ground comes out white');
});

test('flattening loses white lettering on a black ground unless it is inverted first', () => {
  // Why the number is re-read inverted when a normal reading finds nothing: the
  // credits and number on a black-bordered card are white on black.
  const g = strokes(200, 40, 25, 235);
  const lost = flattenIllumination(g, 200, 40, 12);
  assert.ok(lost[20 * 200 + 1] > 250, 'the white stroke is clipped to white, so it is gone');
  const kept = flattenIllumination(g.map((v) => 255 - v), 200, 40, 12);
  assert.ok(kept[20 * 200 + 1] < 100, 'inverted first, the same stroke survives as dark ink');
});
