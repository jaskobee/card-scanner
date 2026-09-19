import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals, pickName } from '../src/pipeline.js';
import { assessQuality, varianceOfLaplacian, ISSUE } from '../src/imagequality.js';

const GERMAN_CARD = `Glurak
Stufe 2
Entwicklungsstufe
Feuerwirbel 100
Schwäche Wasser
Illustrator Mitsuhiro Arita
004/102
© 1999 Wizards of the Coast`;

test('reads number, year and language off a German card', () => {
  const s = extractSignals(GERMAN_CARD);
  assert.equal(s.number.value, '004/102');
  assert.equal(s.number.raw, '004/102', 'the printed span is kept as evidence');
  assert.equal(s.year.value, 1999);
  assert.equal(s.language.value, 'de');
});

test('picks the card name from the top of the card, not the rules text', () => {
  const s = extractSignals(GERMAN_CARD);
  assert.equal(s.name.value, 'Glurak');
});

test('skips stage and HP lines when choosing a name', () => {
  assert.equal(pickName('Stage 2\nBasic\nCharizard 120 HP').value, 'Charizard');
});

test('strips a trailing HP figure from the name', () => {
  assert.equal(pickName('Pikachu 60 HP').value, 'Pikachu');
});

test('unreadable text yields no signals rather than a guess', () => {
  const s = extractSignals('~~~ ### ~~~');
  assert.equal(s.name, null);
  assert.equal(s.number, null);
  assert.equal(s.year, null);
});

test('finds every number on the card, not only the first', () => {
  const s = extractSignals('SV049/SV122 and 4/102');
  assert.equal(s.allNumbers.length, 2);
});

// --- image quality -------------------------------------------------------

function synthetic(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = fill(x, y);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

test('flags a flat grey image as blurry', () => {
  const q = assessQuality(synthetic(500, 500, () => 128));
  assert.ok(q.issues.includes(ISSUE.BLURRY));
});

test('flags a dark image', () => {
  const q = assessQuality(synthetic(500, 500, () => 20));
  assert.ok(q.issues.includes(ISSUE.DARK));
});

test('flags a small image', () => {
  const q = assessQuality(synthetic(120, 160, () => 128));
  assert.ok(q.issues.includes(ISSUE.SMALL));
});

test('flags a bright blown-out patch as glare', () => {
  const q = assessQuality(synthetic(500, 500, (x, y) => (x > 150 && x < 300 && y > 150 && y < 350 ? 255 : 120)));
  assert.ok(q.issues.includes(ISSUE.GLARE));
});

test('a wholly white frame is not reported as glare', () => {
  const q = assessQuality(synthetic(500, 500, () => 255));
  assert.ok(!q.issues.includes(ISSUE.GLARE));
});

test('sharp detail scores higher than flat grey', () => {
  const noisy = synthetic(200, 200, (x, y) => ((x + y) % 2 ? 250 : 5));
  const flat = synthetic(200, 200, () => 128);
  const s1 = varianceOfLaplacian(toLum(noisy), 200, 200);
  const s2 = varianceOfLaplacian(toLum(flat), 200, 200);
  assert.ok(s1 > s2);
});

function toLum(img) {
  const lum = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    lum[p] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  }
  return lum;
}
