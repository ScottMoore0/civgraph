// Election caching (src/map/election/cache.mjs): the election pane's in-memory caches and the
// helpers that fill them, moved out of app/src/election-manager.js.
//
//   node --test tests/unit/election-cache.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cachedLoad,
  createElectionCaches,
  ELECTION_CACHE_LIMITS,
  mapWithConcurrency,
  rememberLimitedCache,
  sharedLoad
} from '../../src/map/election/cache.mjs';

test('limits and empty caches', () => {
  assert.deepEqual({ ...ELECTION_CACHE_LIMITS }, { bundles: 4, featureIndexes: 3, trendSummaries: 160, trendRenders: 40 });
  const caches = createElectionCaches();
  assert.deepEqual(Object.keys(caches), ['bundleCache', 'trendSummaryCache', 'trendSummaryPromiseCache', 'trendRenderCache', 'featureIndexCache']);
  for (const cache of Object.values(caches)) assert.equal(cache.size, 0);
  assert.notEqual(createElectionCaches().bundleCache, caches.bundleCache);
});

test('rememberLimitedCache keeps the newest, refreshing a key it already holds', () => {
  const cache = new Map();
  for (const key of ['a', 'b', 'c']) rememberLimitedCache(cache, key, key.toUpperCase(), 3);
  rememberLimitedCache(cache, 'a', 'A2', 3); // a is now the newest
  assert.equal(rememberLimitedCache(cache, 'd', 'D', 3), 'D');
  assert.deepEqual([...cache.entries()], [['c', 'C'], ['a', 'A2'], ['d', 'D']]);
  assert.equal(rememberLimitedCache(cache, '', 'x', 3), 'x');
  assert.equal(rememberLimitedCache(null, 'k', 'y', 3), 'y');
  assert.equal(cache.size, 3);
});

test('cachedLoad loads once, and does not keep a missing value', async () => {
  const cache = new Map();
  let loads = 0;
  const load = async () => { loads += 1; return { n: loads }; };
  assert.deepEqual(await cachedLoad(cache, 'k', 2, load), { n: 1 });
  assert.deepEqual(await cachedLoad(cache, 'k', 2, load), { n: 1 });
  assert.equal(loads, 1);
  assert.equal(await cachedLoad(cache, 'gone', 2, async () => null), null);
  assert.equal(cache.has('gone'), false);
  await cachedLoad(cache, 'x', 2, load);
  await cachedLoad(cache, 'y', 2, load);
  assert.deepEqual([...cache.keys()], ['x', 'y']);
  await assert.rejects(cachedLoad(cache, 'bad', 2, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(cache.has('bad'), false);
});

test('sharedLoad runs one load per key at a time and forgets it when done', async () => {
  const inflight = new Map();
  let runs = 0;
  let release;
  const run = () => { runs += 1; return new Promise((resolve) => { release = resolve; }); };
  const first = sharedLoad(inflight, 'k', run);
  const second = sharedLoad(inflight, 'k', run);
  assert.equal(runs, 1);
  assert.equal(inflight.size, 1);
  release('value');
  assert.deepEqual(await Promise.all([first, second]), ['value', 'value']);
  assert.equal(inflight.size, 0);
  await assert.rejects(sharedLoad(inflight, 'k', async () => { throw new Error('nope'); }), /nope/);
  assert.equal(inflight.size, 0);
});

test('mapWithConcurrency keeps the order and the limit', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([30, 10, 20, 0, 5], 2, async (ms, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running -= 1;
    return `${index}:${ms}`;
  });
  assert.deepEqual(out, ['0:30', '1:10', '2:20', '3:0', '4:5']);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency(null, 3, async (x) => x), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (x) => x * 2), [2, 4]);
});
