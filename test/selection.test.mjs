import test from 'node:test';
import assert from 'node:assert/strict';

import { rangeIds, pruneSelection, selectionState } from '../src/selection.js';

const order = ['a', 'b', 'c', 'd', 'e'];

test('a shift-click range includes both ends, in display order', () => {
  assert.deepEqual(rangeIds(order, 'b', 'd'), ['b', 'c', 'd']);
});

test('a range selected backwards is the same range', () => {
  assert.deepEqual(rangeIds(order, 'd', 'b'), ['b', 'c', 'd']);
});

test('a range from a card to itself is just that card', () => {
  assert.deepEqual(rangeIds(order, 'c', 'c'), ['c']);
});

test('an anchor that is no longer shown falls back to the clicked card only', () => {
  assert.deepEqual(rangeIds(order, 'gone', 'c'), ['c']);
});

test('a clicked card that is not shown selects nothing', () => {
  assert.deepEqual(rangeIds(order, 'a', 'gone'), []);
});

test('narrowing the view drops selected cards that are no longer visible', () => {
  const kept = pruneSelection(new Set(['a', 'b', 'x']), ['b', 'c', 'a']);
  assert.deepEqual([...kept].sort(), ['a', 'b']);
});

test('pruning never adds cards that were not selected', () => {
  assert.equal(pruneSelection(new Set(), order).size, 0);
});

test('the header checkbox reports none, some and all', () => {
  assert.deepEqual(selectionState(new Set(), order), { count: 0, all: false, some: false });
  assert.deepEqual(selectionState(new Set(['a', 'c']), order), { count: 2, all: false, some: true });
  assert.deepEqual(selectionState(new Set(order), order), { count: 5, all: true, some: false });
});

test('selected cards outside the shown rows do not count towards the header', () => {
  const s = selectionState(new Set(['a', 'zzz']), ['a', 'b']);
  assert.equal(s.count, 1);
  assert.equal(s.some, true);
});

test('an empty table is never "all selected"', () => {
  assert.equal(selectionState(new Set(), []).all, false);
});
