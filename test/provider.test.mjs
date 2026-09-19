import test from 'node:test';
import assert from 'node:assert/strict';

import { PokemonTcgdexProvider, parseNumber } from '../src/providers/pokemon-tcgdex.js';

// A tiny stand-in for the card database, shaped like the real one (checked
// against api.tcgdex.net): the set LIST has only id, name and cardCount, a set's
// own page adds the release date and series, and searches return brief records
// that must be fetched in full. No test touches the network.

const SETS = [
  { id: 'base1', name: 'Base Set', cardCount: { official: 102, total: 102 }, releaseDate: '1999-01-09', serie: { name: 'Base' } },
  { id: 'hgss4', name: 'HS—Triumphant', cardCount: { official: 102, total: 103 }, releaseDate: '2010-11-03', serie: { name: 'HeartGold & SoulSilver' } },
  { id: 'ex1', name: 'Ruby & Sapphire', cardCount: { official: 109, total: 109 }, releaseDate: '2003-06-18', serie: { name: 'EX' } },
  { id: 'dp1', name: 'Diamond & Pearl', cardCount: { official: 130, total: 130 }, releaseDate: '2007-05-23', serie: { name: 'Diamond & Pearl' } },
];

const CARDS = [
  { id: 'base1-1', localId: '1', name: 'Alakazam', set: 'base1', hp: 80 },
  { id: 'base1-4', localId: '4', name: 'Charizard', set: 'base1', hp: 120 },
  { id: 'hgss4-1', localId: '1', name: 'Aggron', set: 'hgss4', hp: 130 },
  { id: 'ex1-1', localId: '1', name: 'Aggron', set: 'ex1', hp: 110 },
  { id: 'ex1-14', localId: '14', name: 'Aggron', set: 'ex1', hp: 100 },
  { id: 'dp1-1', localId: '1', name: 'Dialga', set: 'dp1', hp: 90 },
];

function fakeDatabase() {
  const requests = [];
  const detail = (c) => {
    const s = SETS.find((x) => x.id === c.set);
    return {
      id: c.id, localId: c.localId, name: c.name, hp: c.hp, image: `https://assets/${c.id}`,
      variants: { normal: true, holo: false }, set: { id: s.id, name: s.name, cardCount: s.cardCount },
    };
  };
  const json = (body, status = 200) => ({ status, ok: status === 200, json: async () => body });

  const fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace('/v2/en', '');
    const raw = url.split('?')[1] ?? '';
    requests.push(path + (raw ? `?${raw}` : ''));

    if (path === '/sets') return json(SETS.map(({ id, name, cardCount }) => ({ id, name, cardCount })));

    let m = /^\/sets\/([^/]+)\/([^/]+)$/.exec(path);
    if (m) {
      const c = CARDS.find((x) => x.set === m[1] && Number(x.localId) === Number(m[2]));
      return c ? json(detail(c)) : json(null, 404);
    }
    m = /^\/sets\/([^/]+)$/.exec(path);
    if (m) {
      const s = SETS.find((x) => x.id === m[1]);
      return s ? json({ ...s, cards: [] }) : json(null, 404);
    }
    m = /^\/cards\/([^/]+)$/.exec(path);
    if (m) {
      const c = CARDS.find((x) => x.id === m[1]);
      return c ? json(detail(c)) : json(null, 404);
    }
    if (path === '/cards') {
      // Substring name match, and localId is a substring match too — as in the real API.
      const name = (searchParams.get('name') ?? '').replace(/^like:/, '').toLowerCase();
      const localId = searchParams.get('localId');
      const hp = searchParams.get('hp');
      const hits = CARDS.filter((c) => c.name.toLowerCase().includes(name)
        && (localId == null || c.localId.includes(localId.replace(/^0+/, '')))
        && (hp == null || c.hp === Number(hp)));
      return json(hits.map(({ id, localId: l, name: n }) => ({ id, localId: l, name: n, image: `https://assets/${id}` })));
    }
    return json(null, 404);
  };
  return { fetch, requests };
}

const provider = () => {
  const db = fakeDatabase();
  return { p: new PokemonTcgdexProvider({ language: 'en', fetchImpl: db.fetch }), requests: db.requests };
};
const ids = (records) => records.map((r) => r.id).sort();

// --- number route ------------------------------------------------------------

test('a number and set size that agree with the name identify one printing, with no name search', async () => {
  const { p, requests } = provider();
  const found = await p.search({ name: 'Charizard', nameText: 'Charizard 120 HP', number: '4/102', year: 1999 });
  assert.deepEqual(ids(found), ['base1-4']);
  assert.ok(!requests.some((r) => r.startsWith('/cards?')), 'the second signal agreeing means nothing more is asked of the database');
});

test('records carry the year and series from the set page, which the set list does not have', async () => {
  const { p } = provider();
  const [card] = await p.search({ name: 'Charizard', number: '4/102' });
  assert.equal(card.year, 1999);
  assert.equal(card.series, 'Base');
  assert.equal(card.set, 'Base Set');
  assert.equal(card.number, '4/102');
  assert.equal(card.hp, 120);
});

test('a set page is fetched once however many cards come from it', async () => {
  const { p, requests } = provider();
  await p.search({ name: 'Charizard', number: '4/102' });
  await p.search({ name: 'Alakazam', number: '1/102' });
  assert.equal(requests.filter((r) => r === '/sets/base1').length, 1);
});

test('leading zeroes on the printed number still find the card', async () => {
  const { p } = provider();
  assert.deepEqual(ids(await p.search({ name: 'Charizard', number: '004/102', year: 1999 })), ['base1-4']);
});

// --- when the set size was misread --------------------------------------------

test('a misread set size still finds the right printing through the name and card number', async () => {
  // The card is Aggron 1/109 (Ruby & Sapphire, 2003). The size was read as 102,
  // which is a real set size — a different Aggron, numbered 1, sits there. Its
  // name agrees, so only the year (2003 against 2010) shows it is not the card.
  const { p } = provider();
  const found = await p.search({ name: 'Aggron', nameText: 'Aggron 110 HP', number: '1/102', hp: 110, year: 2003 });
  assert.ok(ids(found).includes('ex1-1'), `the real card must be among the candidates: ${ids(found)}`);
});

test('a name that agrees but a year that does not is not accepted as the answer', async () => {
  const { p, requests } = provider();
  await p.search({ name: 'Aggron', nameText: 'Aggron', number: '1/102', year: 2003 });
  assert.ok(requests.some((r) => r.startsWith('/cards?')), 'it kept looking because the year contradicted the first hit');
});

test('a year one off is tolerated: copyright years run ahead of release now and then', async () => {
  const { p, requests } = provider();
  await p.search({ name: 'Charizard', nameText: 'Charizard', number: '4/102', year: 2000 });
  assert.ok(!requests.some((r) => r.startsWith('/cards?')));
});

// --- name route ---------------------------------------------------------------

test('a name narrowed by card number keeps only cards with exactly that number', async () => {
  // "1" also matches "14" as a substring in the real API; Aggron 14 is not card 1.
  const { p } = provider();
  const found = await p.search({ name: 'Aggron', hp: null });
  assert.equal(found.length, 3);
  const numbered = await p.search({ name: 'Aggron', number: '1' });
  assert.ok(!ids(numbered).includes('ex1-14'));
  assert.ok(ids(numbered).includes('ex1-1'));
});

test('filters are dropped in turn, so a misread HP cannot hide the right card', async () => {
  const { p } = provider();
  // The card really has 110 HP; it was read as 120.
  const found = await p.search({ name: 'Aggron', number: '1', hp: 120, year: 2003 });
  assert.ok(ids(found).includes('ex1-1'));
});

test('name junk on the end of a real name still finds it, by trying shorter prefixes', async () => {
  const { p } = provider();
  const found = await p.search({ name: 'Dialgawes', nameText: 'Dialgawes 90' });
  assert.ok(ids(found).includes('dp1-1'));
});

test('a name too short to mean anything is not sent to the database', async () => {
  const { p, requests } = provider();
  const found = await p.search({ name: 'ab' });
  assert.deepEqual(found, []);
  assert.ok(!requests.some((r) => r.startsWith('/cards?')));
});

test('nothing found is an empty answer, never a fabricated card', async () => {
  const { p } = provider();
  assert.deepEqual(await p.search({ name: 'Zzzzzzz', number: '999/999' }), []);
  assert.deepEqual(await p.search({}), []);
});

// --- failures ------------------------------------------------------------------

function failing(status) {
  const db = fakeDatabase();
  const fetch = async (url) => (url.includes('/sets/base1/4') ? { status, ok: false, json: async () => null } : db.fetch(url));
  return new PokemonTcgdexProvider({ language: 'en', fetchImpl: fetch });
}

test('a failing database is an error to retry, not "no such card"', async () => {
  await assert.rejects(
    () => failing(500).search({ name: 'Charizard', number: '4/102' }),
    (e) => e.retryable === true,
    'a server error must reach the queue so it can retry, and so a real outage trips the breaker',
  );
});

test('being rate limited is retryable too', async () => {
  await assert.rejects(() => failing(429).search({ name: 'Charizard', number: '4/102' }), (e) => e.retryable === true);
});

test('a card number that is not in the set is an empty answer, not an error', async () => {
  // The database says 404. That is a real answer — "there is no such card" —
  // and unlike a failure it is not retried.
  const { p } = provider();
  assert.deepEqual(await p.search({ number: '99/102' }), []);
});

// --- supporting pieces --------------------------------------------------------

test('the printed set sizes the database knows are available for checking a reading', async () => {
  const { p } = provider();
  const totals = await p.knownTotals();
  assert.ok(totals.has(102) && totals.has(109) && totals.has(130));
  assert.ok(!totals.has(1140), 'a misread like 1140 is not a set size');
});

test('a card number is split without losing what was printed', () => {
  assert.deepEqual(parseNumber('054/197'), { num: 54, den: 197 });
  assert.deepEqual(parseNumber('4/102'), { num: 4, den: 102 });
  assert.deepEqual(parseNumber('7'), { num: 7, den: null });
  assert.equal(parseNumber('SV049/SV122'), null, 'a promo prefix is not a plain number');
  assert.equal(parseNumber(null), null);
});
