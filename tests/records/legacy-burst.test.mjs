// The old /data/browse and /data/graph file URLs: retired on 8 Nov 2026 (owner) to 410 Gone, except
// the Browse kinds pages still read (D1, under the dataset version) and the graph's bulk dumps (R2,
// then 301 to the downloads). Then the gate on concurrent rebuilds (cachedJson in
// packages/api/src/handlers/_records.js), which a burst of 503s on 7 Nov 2026 made necessary.
// No records build needed: D1 and R2 are stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { context, installCaches } from './d1-shim.mjs';
import { cachedJson, gateState, GATE_ACTIVE, GATE_QUEUE, resetDatasetMemo } from '../../packages/api/src/handlers/_records.js';
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
const call = (mod, prefix, rel, env, method = 'GET') => {
  const ctx = context(`${prefix}${rel}`, env, { path: rel.split('/') });
  if (method !== 'GET') ctx.request = new Request(ctx.request.url, { method });
  return mod.onRequest(ctx).then(async (res) => { await Promise.all(ctx._pending); return res; });
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** @param {Response} res */
async function assertGone(res, label) {
  assert.equal(res.status, 410, label);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=300', label);
  assert.equal(JSON.parse(await res.text()).error, 'gone', label);
}

test('graph: every index and shard file answers 410 Gone, with neither D1 nor R2 read', async () => {
  fresh();
  const r2 = bucket({ 'data/graph/manifest.json': '{}', 'data/graph/indexes/entity-slugs-part-0.json': '{"part":0}' });
  for (const rel of ['manifest.json', 'entity-types.json', 'indexes/entity-slugs-part-0.json', 'indexes/lookup/browse/0001.json',
    'entity-shards/entities-000.json', 'indexes/statements-by-subject-shards/statements-by-subject-000.json',
    'indexes/statements-by-subject-map.json', 'indexes/browse-record-to-entity-persons.json', 'no/such/file.json', '../x', 'exports']) {
    await assertGone(await call(dataGraph, '/data/graph/', rel, { ELECTIONS_DB: fakeDb(), MAPS_BUCKET: r2 }), rel);
  }
  assert.deepEqual(r2.reads, []);
  const head = await call(dataGraph, '/data/graph/', 'manifest.json', { ELECTIONS_DB: fakeDb() }, 'HEAD');
  assert.equal(head.status, 410);
  assert.equal((await call(dataGraph, '/data/graph/', 'manifest.json', {}, 'POST')).status, 405);
});

test('graph: the bulk dumps 301 to the downloads and never read R2 (since 9 Nov 2026)', async () => {
  fresh();
  // An R2 copy, if one were left, must not be served: the bucket would throw if read.
  const r2 = { get() { throw new Error('the graph Function must not read R2'); } };
  const D = 'https://data.civgraph.net/data/downloads';
  const loc = async (p) => {
    const r = await call(dataGraph, '/data/graph/', p, { MAPS_BUCKET: r2 });
    assert.equal(r.status, 301, p);
    return r.headers.get('Location');
  };
  assert.equal(await loc('exports/civgraph.jsonld'), `${D}/civgraph.jsonld.gz`);
  assert.equal(await loc('exports/civgraph-rdf.ndjson'), `${D}/civgraph-rdf.ndjson.gz`);
  assert.equal(await loc('statement-shards/statements-000.json'), `${D}/civgraph-graph-shards.tar.gz`);
  assert.equal(await loc('exports/jsonld/part-001.json'), `${D}/civgraph-graph-shards.tar.gz`);
  assert.equal(await loc('exports/rdf-ndjson-shards/x.ndjson'), `${D}/civgraph-graph-shards.tar.gz`);
  assert.equal(await loc('exports/manifest.json'), `${D}/manifest.json`);
});

test('browse: the kinds no page reads, and unknown paths, answer 410 Gone without D1 or R2', async () => {
  fresh();
  const r2 = bucket({ 'data/browse/election-contest-parents.json': '{"items":{}}' });
  for (const rel of ['elections-list.json', 'election-contest-parents.json', 'election-contest-parents/0007.json', 'source-merges.json',
    'details/source-shards/sources-183.json', 'votes/persons/123.json', 'votes/parties/sdlp.json', 'votes/divisions/12.json',
    'corpus-index.json', 'no/such/file.json', '../x']) {
    await assertGone(await call(dataBrowse, '/data/browse/', rel, { ELECTIONS_DB: fakeDb(), MAPS_BUCKET: r2 }), rel);
  }
  assert.deepEqual(r2.reads, []);
  for (const k of dataBrowse.RETIRED) assert.ok(!dataBrowse.HEAVY.has(k), k);
});

test('browse: files Browse still reads answer from D1 under the dataset version; moved layouts still 301', async () => {
  fresh();
  const r2 = bucket({ 'data/browse/person-shards/persons-000.json': '{"stale":true}' });
  const live = await call(dataBrowse, '/data/browse/', 'person-shards/persons-000.json', {
    ELECTIONS_DB: fakeDb({ onQuery: () => ({ results: [] }) }), MAPS_BUCKET: r2,
  });
  assert.notEqual(live.status, 410);
  assert.notEqual(await live.text(), '{"stale":true}', 'a file Browse reads never comes from the R2 copy');
  assert.deepEqual(r2.reads, []);
  const doc = await call(dataBrowse, '/data/browse/', 'index.json', {
    ELECTIONS_DB: fakeDb({ onQuery: (sql) => (/FROM documents/.test(sql) ? { results: [{ body: '{"counts":{}}' }] } : { results: [] }) }),
  });
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('ETag'), '"data-browse-4-v1"');
  const mf = await call(dataBrowse, '/data/browse/', 'map-features/lgd-2012/0.json', {});
  assert.equal(mf.status, 301);
  assert.equal(mf.headers.get('Location'), 'https://data.civgraph.net/data/browse/map-features/lgd-2012/0.json');
  assert.equal((await call(dataBrowse, '/data/browse/', 'proni-roots.json', {})).status, 301);
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
