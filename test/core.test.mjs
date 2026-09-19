import test from 'node:test';
import assert from 'node:assert/strict';

import { extracted, newCard, band, canTransition, transition, correct, valueOf, isAutoAcceptable, STATE } from '../src/model.js';
import { fold, foldDe, findCardNumbers, findYears, findVariantTerms, guessLanguage, similarity, findCopyright } from '../src/normalize.js';
import { scoreCandidate, compareNumbers, rankCandidates } from '../src/match.js';
import { renderTitle, truncateAtWord, unknownTokens, EBAY_TITLE_LIMIT } from '../src/title.js';
import { identityKey, findDuplicates, mergeToQuantity } from '../src/dupes.js';
import { backoffMs, JobQueue, JOB } from '../src/queue.js';

// --- model ---------------------------------------------------------------

test('absent evidence yields a null value, never a guess', () => {
  const f = extracted(null, 'ocr', 0.9);
  assert.equal(f.value, null);
  assert.equal(f.confidence, 0);
});

test('an inference can never present as near-certain', () => {
  const f = extracted('Base Set', 'inferred', 0.99, 'set-from-number rule');
  assert.equal(f.confidence, 0.7);
});

test('an inference must name its rule', () => {
  assert.throws(() => extracted('x', 'inferred', 0.5));
});

test('user input is authoritative', () => {
  assert.equal(extracted('Charizard', 'user', 0.2).confidence, 1);
});

test('rejects an unknown provenance source', () => {
  assert.throws(() => extracted('x', 'vibes', 0.5));
});

test('confidence bands account for margin, not just score', () => {
  assert.equal(band(0.95, 0.4).key, 'HIGH');
  // 0.95 against a 0.94 runner-up is a coin flip, not a confident match.
  assert.equal(band(0.95, 0.01).key, 'MEDIUM');
  assert.equal(band(0.5, 1).key, 'LOW');
});

test('card lifecycle rejects illegal transitions', () => {
  assert.ok(canTransition(STATE.UPLOADED, STATE.PROCESSING));
  assert.ok(!canTransition(STATE.UPLOADED, STATE.EXPORTED));
  assert.ok(canTransition(STATE.FAILED, STATE.PROCESSING), 'failure is always retryable');
  assert.throws(() => transition(newCard(), STATE.EXPORTED));
});

test('a new card starts with every identification field empty', () => {
  const c = newCard();
  assert.equal(c.fields.name.value, null);
  assert.equal(c.fields.number.value, null);
  assert.equal(c.state, STATE.UPLOADED);
});

test('a correction clears that field flag and wins over OCR', () => {
  let c = newCard();
  c.fields.number = extracted('4/102', 'ocr', 0.6);
  c.flags = ['number', 'variant'];
  c = correct(c, 'number', '4/130');
  assert.equal(valueOf(c, 'number'), '4/130');
  assert.equal(c.fields.number.source, 'user');
  assert.deepEqual(c.flags, ['variant']);
});

test('condition is user-owned, never an extracted field', () => {
  let c = newCard();
  c = correct(c, 'condition', 'Near Mint');
  assert.equal(c.user.condition, 'Near Mint');
  assert.equal(c.fields.condition, undefined);
});

test('a flagged card is never auto-accepted however high the score', () => {
  const c = { ...newCard(), confidence: 0.99, margin: 0.5, flags: ['variant'] };
  assert.equal(isAutoAcceptable(c), false);
});

// --- normalize -----------------------------------------------------------

test('folds diacritics and case for comparison', () => {
  assert.equal(fold('Glück  ÖÄÜ'), 'gluck öäü'.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  assert.equal(fold('Pokémon'), 'pokemon');
});

test('German ß folds to ss only in the German comparison', () => {
  assert.equal(foldDe('Straße'), 'strasse');
});

test('finds card numbers and preserves leading zeroes', () => {
  const hits = findCardNumbers('Glurak 004/120 Stufe 2');
  assert.equal(hits[0].value, '004/120');
  assert.equal(hits[0].raw, '004/120');
});

test('repairs common OCR digit confusions inside card numbers', () => {
  const hits = findCardNumbers('4/1O2'); // letter O for zero
  assert.equal(hits[0].value, '4/102');
  assert.equal(hits[0].raw, '4/1O2', 'the raw span survives as evidence');
});

test('finds plausible years only', () => {
  assert.deepEqual(findYears('© 1999 Wizards, item 2999').map((y) => y.value), [1999]);
});

test('reads the copyright line', () => {
  const c = findCopyright('© 1999 Wizards of the Coast');
  assert.equal(c.year, 1999);
  assert.match(c.holder, /Wizards/);
});

test('prefers the most specific variant term', () => {
  const hits = findVariantTerms('Reverse Holo Rare');
  assert.deepEqual(hits.map((h) => h.value), ['reverse holo']);
});

test('detects German and Japanese printings', () => {
  assert.equal(guessLanguage('Entwicklungsstufe 1').value, 'de');
  assert.equal(guessLanguage('リザードン').value, 'ja');
  assert.equal(guessLanguage('Charizard Stage 2'), null, 'unknown stays unknown');
});

test('similarity is 1 for equal strings and 0 for hopeless length gaps', () => {
  assert.equal(similarity('Charizard', 'charizard'), 1);
  assert.equal(similarity('Charizard', 'a'), 0);
  assert.ok(similarity('Charizard', 'Chariznrd') > 0.8);
});

// --- match ---------------------------------------------------------------

test('card numbers match across leading zeroes', () => {
  assert.equal(compareNumbers('4/102', '004/102'), 1);
});

test('same position in a different set size is not a confident match', () => {
  assert.ok(compareNumbers('4/102', '4/130') < 1);
  assert.ok(compareNumbers('4/102', '4/130') > 0);
});

test('a different number is not a match at all', () => {
  assert.equal(compareNumbers('4/102', '5/102'), 0);
});

test('scoring ignores signals that were never observed', () => {
  const r = scoreCandidate({ name: 'Charizard', number: null }, { name: 'Charizard', number: '4/102' });
  assert.equal(r.score, 1);
  assert.equal(r.agreements.number, undefined);
});

test('thin evidence is damped, however perfect the agreement', () => {
  const thin = rankCandidates({ name: 'Charizard' }, [{ name: 'Charizard' }]);
  const rich = rankCandidates(
    { name: 'Charizard', number: '4/102', set: 'Base Set', year: 1999, language: 'en' },
    [{ name: 'Charizard', number: '4/102', set: 'Base Set', year: 1999, language: 'en' }],
  );
  assert.ok(thin.confidence < rich.confidence, 'one agreeing signal is not a confident id');
  assert.ok(rich.confidence >= 0.9);
});

test('reports the margin so near-ties can be demoted', () => {
  const r = rankCandidates(
    { name: 'Charizard', number: '4/102', year: 1999 },
    [
      { name: 'Charizard', number: '4/102', year: 1999, id: 'base1-4' },
      { name: 'Charizard', number: '4/130', year: 2000, id: 'base2-4' },
    ],
  );
  assert.equal(r.best.id, 'base1-4');
  assert.ok(r.margin > 0);
  assert.equal(r.candidates.length, 2, 'alternatives are always kept');
});

test('flags a field that contradicts the chosen candidate', () => {
  const r = rankCandidates(
    { name: 'Charizard', number: '4/102', set: 'Jungle' },
    [{ name: 'Charizard', number: '4/102', set: 'Base Set' }],
  );
  assert.ok(r.flags.includes('set'));
});

test('flags variant when the candidate has variants and none was read', () => {
  const r = rankCandidates(
    { name: 'Charizard', number: '4/102' },
    [{ name: 'Charizard', number: '4/102', hasVariants: true }],
  );
  assert.ok(r.flags.includes('variant'));
});

test('no candidates means no identification, not a low-confidence guess', () => {
  const r = rankCandidates({ name: 'Charizard' }, []);
  assert.equal(r.best, null);
  assert.equal(r.confidence, 0);
});

// --- title ---------------------------------------------------------------

test('renders a title and drops empty tokens with their decoration', () => {
  const { title } = renderTitle('{year} {manufacturer} {set} {name} #{number} {variant}', {
    year: 1999, manufacturer: 'Pokemon', set: 'Base Set', name: 'Charizard', number: '4/102', variant: null,
  });
  assert.equal(title, '1999 Pokemon Base Set Charizard #4/102');
});

test('an empty number leaves no orphan hash', () => {
  const { title } = renderTitle('{name} #{number}', { name: 'Charizard', number: null });
  assert.equal(title, 'Charizard');
});

test('truncates at a word boundary, never mid-word', () => {
  const long = 'Charizard Holo First Edition Shadowless Near Mint Extremely Long Suffix Here And More';
  const { title, truncated } = renderTitle('{name}', { name: long });
  assert.ok(truncated);
  assert.ok(title.length <= EBAY_TITLE_LIMIT);
  assert.ok(long.startsWith(title), 'the kept text is a prefix of the original');
  assert.equal(long[title.length], ' ', 'the cut lands on a word boundary');
});

test('truncateAtWord falls back to a hard cut for one huge word', () => {
  const s = 'x'.repeat(200);
  assert.equal(truncateAtWord(s, 80).length, 80);
});

test('reports template tokens this app cannot supply', () => {
  assert.deepEqual(unknownTokens('{name} {astrologicalSign}'), ['astrologicalSign']);
});

// --- duplicates ----------------------------------------------------------

const vo = (c, f) => c[f] ?? null;

test('identity ignores condition and price', () => {
  const a = { set: 'Base', number: '4/102', name: 'Charizard', variant: 'holo', language: 'en', condition: 'NM' };
  const b = { ...a, condition: 'Played', price: 99 };
  assert.equal(identityKey(a, vo), identityKey(b, vo));
});

test('a different variant is a different card', () => {
  const a = { set: 'Base', number: '4/102', name: 'Charizard', variant: 'holo' };
  const b = { ...a, variant: 'reverse holo' };
  assert.notEqual(identityKey(a, vo), identityKey(b, vo));
});

test('cards with no identifying evidence are never grouped', () => {
  const blanks = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(findDuplicates(blanks, vo), []);
});

test('groups duplicates and reports the count', () => {
  const c = { set: 'Base', number: '4/102', name: 'Charizard' };
  const groups = findDuplicates([{ ...c, id: 1 }, { ...c, id: 2 }, { set: 'Jungle', number: '1/64', name: 'Clefable', id: 3 }], vo);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test('merging keeps the most confident card and sums quantity', () => {
  const group = [
    { id: 'a', confidence: 0.7, user: { quantity: 2 } },
    { id: 'b', confidence: 0.95, user: { quantity: 3 } },
  ];
  const { keep, remove } = mergeToQuantity(group);
  assert.equal(keep.id, 'b');
  assert.equal(keep.user.quantity, 5);
  assert.deepEqual(remove, ['a']);
});

// --- queue ---------------------------------------------------------------

test('backoff grows and stays within the cap', () => {
  assert.ok(backoffMs(1) <= 400);
  assert.ok(backoffMs(10) <= 8000);
  assert.ok(backoffMs(10) >= 4000);
});

test('one failing job does not sink the batch', async () => {
  const q = new JobQueue({
    concurrency: 4,
    maxAttempts: 1,
    worker: async (job) => {
      if (job.id === 'bad') throw new Error('unreadable image');
      return 'ok';
    },
  });
  for (let i = 0; i < 20; i++) q.add(`c${i}`, {});
  q.add('bad', {});
  await new Promise((resolve) => { q.addEventListener('idle', resolve, { once: true }); q.run(); });

  const s = q.stats;
  assert.equal(s.succeeded, 20);
  assert.equal(s.failed, 1);
  assert.equal(q.jobs.get('bad').error.message, 'unreadable image');
});

test('a retryable job is retried up to maxAttempts then fails cleanly', async () => {
  let attempts = 0;
  const q = new JobQueue({
    concurrency: 1, maxAttempts: 3,
    worker: async () => { attempts++; throw new Error('flaky provider'); },
  });
  q.add('a', {});
  await new Promise((resolve) => { q.addEventListener('idle', resolve, { once: true }); q.run(); });
  assert.equal(attempts, 3);
  assert.equal(q.jobs.get('a').state, JOB.FAILED);
});

test('restore puts interrupted jobs back in the queue', () => {
  const q = new JobQueue({ worker: async () => 'ok' });
  q.restore([
    { id: 'a', state: JOB.RUNNING, attempts: 1 },
    { id: 'b', state: JOB.SUCCEEDED, attempts: 1 },
  ]);
  assert.equal(q.jobs.get('a').state, JOB.QUEUED, 'a closed tab must not lose the job');
  assert.equal(q.jobs.get('b').state, JOB.SUCCEEDED);
});

test('the circuit breaker stops a run against a dead provider', async () => {
  const q = new JobQueue({
    concurrency: 1, maxAttempts: 1, breakerThreshold: 3,
    worker: async () => { throw new Error('provider down'); },
  });
  for (let i = 0; i < 50; i++) q.add(`c${i}`, {});
  const opened = new Promise((r) => q.addEventListener('breaker', r, { once: true }));
  q.run();
  await opened;
  assert.ok(q.breakerOpen);
  assert.ok(q.stats.failed < 50, 'it stops rather than burning every job into the same outage');
});
