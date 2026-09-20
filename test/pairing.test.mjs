import test from 'node:test';
import assert from 'node:assert/strict';

import { pairPhotos, sideOf, stemOf, swapSides } from '../src/pairing.js';

const files = (...names) => names.map((name) => ({ name }));
const names = (pairs) => pairs.map((p) => [p.front?.name ?? null, p.back?.name ?? null]);

test('a name says which side it is by the word front or back, on its own among letters', () => {
  assert.equal(sideOf('bray-front.jpg'), 'front');
  assert.equal(sideOf('BRAY_BACK.JPG'), 'back');
  assert.equal(sideOf('front1.jpg'), 'front');
  assert.equal(sideOf('126 back.png'), 'back');
  assert.equal(sideOf('frontier.jpg'), null, 'a word that merely contains it is not it');
  assert.equal(sideOf('IMG_2041.jpg'), null);
});

test('German, French and Spanish names work too, since the cards are sold in Germany', () => {
  assert.equal(sideOf('ciampa_vorne.jpg'), 'front');
  assert.equal(sideOf('ciampa_hinten.jpg'), 'back');
  assert.equal(sideOf('ciampa_rückseite.jpg'), 'back');
  assert.equal(sideOf('carte-recto.jpg'), 'front');
  assert.equal(sideOf('carte-verso.jpg'), 'back');
});

test('a name that says both sides says neither', () => {
  assert.equal(sideOf('front-and-back.jpg'), null);
});

test('the rest of a name, without its side word, is what ties a front to its back', () => {
  assert.equal(stemOf('bray-front.jpg'), 'bray');
  assert.equal(stemOf('bray_back.jpg'), 'bray');
  assert.equal(stemOf('front1.jpg'), '1');
  assert.equal(stemOf('back.jpg'), '');
});

test('when every file says its side, a front is paired with the back that has the same name', () => {
  // Added out of order on purpose: names, not position, decide.
  const { pairs, method } = pairPhotos(files('bray-back.jpg', 'ciampa-front.jpg', 'bray-front.jpg', 'ciampa-back.jpg'));
  assert.equal(method, 'names');
  assert.deepEqual(names(pairs), [['ciampa-front.jpg', 'ciampa-back.jpg'], ['bray-front.jpg', 'bray-back.jpg']]);
});

test('fronts and backs named front, back, front1, back1 pair up by their number', () => {
  const { pairs } = pairPhotos(files('back1.jpg', 'front.jpg', 'front1.jpg', 'back.jpg'));
  assert.deepEqual(names(pairs), [['front.jpg', 'back.jpg'], ['front1.jpg', 'back1.jpg']]);
});

test('a front with no back is kept as a card with no back, and a back with no front is kept, marked', () => {
  const { pairs } = pairPhotos(files('a-front.jpg', 'b-front.jpg', 'b-back.jpg', 'c-back.jpg'));
  assert.deepEqual(names(pairs), [['a-front.jpg', null], ['b-front.jpg', 'b-back.jpg'], [null, 'c-back.jpg']]);
});

test('when the names do not all say a side, photos are paired in the order they were added', () => {
  const { pairs, method } = pairPhotos(files('IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_4.jpg'));
  assert.equal(method, 'order');
  assert.deepEqual(names(pairs), [['IMG_1.jpg', 'IMG_2.jpg'], ['IMG_3.jpg', 'IMG_4.jpg']]);
});

test('some names saying a side is not enough to trust them: it falls back to order', () => {
  const { method } = pairPhotos(files('a-front.jpg', 'IMG_2.jpg', 'b-front.jpg', 'b-back.jpg'));
  assert.equal(method, 'order');
});

test('an odd photo by order is a front with no back', () => {
  const { pairs } = pairPhotos(files('1.jpg', '2.jpg', '3.jpg'));
  assert.deepEqual(names(pairs), [['1.jpg', '2.jpg'], ['3.jpg', null]]);
});

test('no photos gives no pairs', () => {
  assert.deepEqual(pairPhotos([]).pairs, []);
});

test('swapping the two photos of a pair is how a wrong guess is put right', () => {
  const [pair] = pairPhotos(files('1.jpg', '2.jpg')).pairs;
  assert.deepEqual(names([swapSides(pair)]), [['2.jpg', '1.jpg']]);
});
