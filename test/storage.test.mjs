import test from 'node:test';
import assert from 'node:assert/strict';

import { UrlCache } from '../src/storage.js';

test('a card with no photo asks the store for nothing, rather than throwing', async () => {
  // A card entered by hand has no photo. Asking IndexedDB for "no key" throws a
  // DataError, which surfaced as a console error on every table render.
  const urls = new UrlCache();
  assert.equal(await urls.urlFor(null), null);
  assert.equal(await urls.urlFor(undefined), null);
  assert.equal(await urls.urlFor(''), null);
});
