// The old /data/browse and /data/graph file URLs under a burst (data phase 4; 15 of 294 answered
// 503 in a production crawl on 7 Nov 2026): long edge caching, the R2 copy before D1 for the
// heavy legacy kinds, and the gate on concurrent rebuilds (cachedJson in functions/_api/_records.js).
// No records build needed: D1 and R2 are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, installCaches } from './d1-shim.mjs';
import { cachedJson, gateState, GATE_ACTIVE, GATE_QUEUE, resetDatasetMemo } from '../../functions/_api/_records.js';
import * as dataBrowse from '../../functions/data/browse/[[path]].js';
import * as dataGraph from '../../functions/data/graph/[[path]].js';

/** A D1 stub: the dataset rows, and any other query runs `onQuery` (default: throws). */
function fakeDb({ version = 'v1', onQuery = () => { throw new Error('D1 must not be read'); } } = {}) {
  return {
    prepare(sql) {
      const stmt = {
        bind: () => stmt,
        all: async () => (/FROM dataset/.test(sql) ? { results: [{ key: 'version', value: version }] } : onQuery(sql)),
        first: async () => (await stmt.all()).results?.[0] ?? null,
      };
      return stmt;
    },
  };
}
const bucket = (objects) => ({
  reads: [],
  async get(key) { this.reads.push(key); return key in objects ? { body: objects[key] } : null; },
});
const fresh = () => { installCaches(); resetDatasetMemo(); gateState.reset(); };
const call = (mod, prefix, rel, env) => {
  const ctx = context(`${prefix}${rel}`, env, { path: rel.split('/') });
  return mod.onRequest(ctx).then(async (res) => { await Promise.all(ctx._pending); return res; });
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('graph: a heavy kind answers from R2 without D1, and the edge keeps it for 30 days across publishes', async () => {
  fresh();
  const rel = 'indexes/entity-slugs-part-0.json';
  const r2 = bucket({ [`data/graph/${rel}`]: '{"part":0}' });
  const res = await call(dataGraph, '/data/graph/', rel, { ELECTIONS_DB: fakeDb(), MAPS_BUCKET: r2 });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"part":0}');
  assert.match(res.headers.get('Cache-Control'), /s-maxage=2592000/);
  assert.equal(res.headers.get('ETag'), '"data-graph-2"');
  // A publish (a new dataset version) and R2 gone: the edge copy still answers, D1 untouched.
  resetDatasetMemo();
  const again = await call(dataGraph, '/data/graph/', rel, { ELECTIONS_DB: fakeDb({ version: 'v2' }), MAPS_BUCKET: bucket({}) });
  assert.equal(again.status, 200);
  assert.equal(await again.text(), '{"part":0}');
});

test('graph: a light kind rebuilds from D1; if D1 fails, the R2 copy; with neither, 503 with Retry-After', async () => {
  fresh();
  const rel = 'indexes/lookup/browse/0001.json';
  const r2 = bucket({ [`data/graph/${rel}`]: '{"items":{}}' });
  const res = await call(dataGraph, '/data/graph/', rel, { ELECTIONS_DB: fakeDb({ onQuery: () => { throw new Error('D1 overloaded'); } }), MAPS_BUCKET: r2 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Civgraph-Copy'), 'r2');
  assert.deepEqual(r2.reads, [`data/graph/${rel}`], 'R2 read only after D1 failed');
  fresh();
  const none = await call(dataGraph, '/data/graph/', rel, { ELECTIONS_DB: fakeDb({ onQuery: () => { throw new Error('D1 overloaded'); } }) });
  assert.equal(none.status, 503);
  assert.equal(none.headers.get('Retry-After'), '5');
  assert.equal(none.headers.get('Cache-Control'), 'no-store');
});

test('browse: legacy-only heavy kinds read R2 first; files Browse still reads stay on D1 under the dataset version', async () => {
  fresh();
  const r2 = bucket({ 'data/browse/election-contest-parents.json': '{"items":{}}', 'data/browse/person-shards/persons-000.json': '{"stale":true}' });
  const legacy = await call(dataBrowse, '/data/browse/', 'election-contest-parents.json', { ELECTIONS_DB: fakeDb(), MAPS_BUCKET: r2 });
  assert.equal(legacy.status, 200);
  assert.equal(await legacy.text(), '{"items":{}}');
  assert.ok(dataBrowse.LEGACY_HEAVY.has('source-shard') && !dataBrowse.LEGACY_HEAVY.has('shard'));
  const live = await call(dataBrowse, '/data/browse/', 'person-shards/persons-000.json', {
    ELECTIONS_DB: fakeDb({ onQuery: () => ({ results: [] }) }), MAPS_BUCKET: r2,
  });
  assert.notEqual(await live.text(), '{"stale":true}', 'a file Browse reads never comes from the go-live R2 copy');
  assert.ok(!r2.reads.includes('data/browse/person-shards/persons-000.json'));
});

test('gate: a burst of distinct rebuilds runs at most GATE_ACTIVE at once; past the queue, 503', async () => {
  fresh();
  const hold = deferred();
  let running = 0;
  let most = 0;
  const env = { ELECTIONS_DB: fakeDb() };
  const handler = async () => {
    running += 1;
    most = Math.max(most, running);
    await hold.promise;
    running -= 1;
    return new Response('{}', { status: 200 });
  };
  const burst = Array.from({ length: GATE_ACTIVE + GATE_QUEUE + 1 }, (_, i) => {
    const ctx = context(`/data/graph/x-${i}.json`, env);
    return cachedJson(ctx, 't', handler, { stable: true, gate: true });
  });
  await tick();
  assert.equal(gateState.active, GATE_ACTIVE);
  assert.equal(gateState.queued, GATE_QUEUE);
  hold.resolve();
  const answers = await Promise.all(burst);
  assert.equal(most, GATE_ACTIVE);
  assert.equal(answers.filter((r) => r.status === 200).length, GATE_ACTIVE + GATE_QUEUE);
  const refused = answers.filter((r) => r.status === 503);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].headers.get('Retry-After'), '5');
  assert.equal(gateState.active, 0);
});

test('gate: a burst on one URL rebuilds it once; the rest take the stored copy', async () => {
  fresh();
  const hold = deferred();
  let calls = 0;
  const env = { ELECTIONS_DB: fakeDb() };
  const handler = async () => {
    calls += 1;
    await hold.promise;
    return new Response('{"n":1}', { status: 200 });
  };
  const burst = Array.from({ length: 8 }, () => cachedJson(context('/data/graph/same.json', env), 't', handler, { stable: true, gate: true }));
  await tick();
  hold.resolve();
  const answers = await Promise.all(burst);
  assert.equal(calls, 1);
  for (const r of answers) assert.equal(await r.text(), '{"n":1}');
});
