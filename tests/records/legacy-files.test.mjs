// Data phase 4: every kind of old /data/graph and /data/browse file URL answers from the records
// database what the file held (deep-equal after dropping the wrapper's generatedAt), with no R2.
// Sampled from the build's own trees (tmp/records/graph, tmp/records/browse); skipped without a
// build or without those trees. The routing, 301s, 404s and HEAD run with no build at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { recordPaths, REPO_ROOT } from '../../scripts/records/paths.mjs';
import { driftedFile, readDrift } from '../../scripts/records/graph-files-freeze.mjs';
import { context, d1, installCaches } from './d1-shim.mjs';
import { resetDatasetMemo } from '../../functions/_api/_records.js';
import * as dataBrowse from '../../functions/data/browse/[[path]].js';
import * as dataGraph from '../../functions/data/graph/[[path]].js';

const DB = path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite');
const P = recordPaths({ CIVGRAPH_BUILD_DIR: 'tmp/records' });
const hasGraphFiles = () => {
  if (!existsSync(DB)) return false;
  const db = d1(DB);
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'graph_files'").first().then(Boolean);
};
const skipGraph = (!existsSync(DB) || !existsSync(P.GRAPH_DIR)) && 'no records build or no graph tree';
const skipBrowse = (!existsSync(DB) || !existsSync(P.BROWSE_DIR)) && 'no records build or no Browse tree';

let env;
const setup = () => {
  if (!env) {
    installCaches();
    resetDatasetMemo();
    env = { ELECTIONS_DB: d1(DB) };
  }
  return env;
};
const call = (mod, prefix, rel, e = setup(), method = 'GET') => {
  const ctx = context(`${prefix}${rel}`, e, { path: rel.split('/') });
  if (method !== 'GET') ctx.request = new Request(ctx.request.url, { method });
  return mod.onRequest(ctx);
};
const dropGeneratedAt = (doc) => {
  const { generatedAt: _g, ...rest } = doc;
  return rest;
};
const sample = (list, n) => {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

async function same(mod, prefix, root, rel) {
  const res = await call(mod, prefix, rel);
  assert.equal(res.status, 200, `${prefix}${rel} -> ${res.status}`);
  // The registries stored whole (manifest.json ...) keep their generatedAt; the rest drop it.
  assert.deepEqual(dropGeneratedAt(await res.json()), dropGeneratedAt(readJson(path.join(root, ...rel.split('/')))), rel);
}

/** Each kind of graph file, by directory and file-name pattern, and how many to sample. */
const GRAPH_KINDS = [
  ['entity-shards', /^entities-\d+\.json$/, 4],
  ['indexes/lookup/browse', /^\d{4}\.json$/, 8],
  ['indexes/lookup/slug', /^\d{4}\.json$/, 8],
  ['indexes/lookup/entity', /^\d{4}\.json$/, 8],
  ['indexes/statements-by-subject-shards', /\.json$/, 8],
  ['indexes/reverse-entity-value-shards', /\.json$/, 8],
  ['indexes/source-statements-shards', /\.json$/, 3],
  ['indexes/entity-summary-shards', /\.json$/, 6],
  ['indexes', /^(entity-search-part-\d|entity-slugs-part-\d|browse-record-to-entity.*|lookup|entity-slugs|entity-search|property-summary|(statements-by-subject|reverse-entity-value|source-statements)-map)\.json$/, 100],
  ['', /^(manifest|entity-types|properties)\.json$/, 10],
  ['quality', /\.json$/, 5],
];

test('data/graph: every file kind deep-equals the build\'s file', { skip: skipGraph }, async (t) => {
  if (!(await hasGraphFiles())) return t.skip('build predates graph_files (migration 0004)');
  for (const [dir, pattern, n] of GRAPH_KINDS) {
    const abs = path.join(P.GRAPH_DIR, dir);
    if (!existsSync(abs)) continue;
    const files = readdirSync(abs).filter((f) => pattern.test(f)).sort();
    assert.ok(files.length, `${dir}: no files`);
    // graph_files is frozen: a file whose keys have changed since go-live is skipped.
    const drift = readDrift();
    for (const f of sample(files, n)) {
      const rel = dir ? `${dir}/${f}` : f;
      if (driftedFile(rel, drift)) t.diagnostic(`skipped (graph_files frozen, keys changed): ${rel}`);
      else await same(dataGraph, '/data/graph/', P.GRAPH_DIR, rel);
    }
  }
});

test('data/browse: source detail shards rebuild from sources', { skip: skipBrowse }, async () => {
  const dir = path.join(P.BROWSE_DIR, 'details', 'source-shards');
  for (const f of sample(readdirSync(dir).sort(), 12)) await same(dataBrowse, '/data/browse/', P.BROWSE_DIR, `details/source-shards/${f}`);
});

test('data/graph: bulk dumps go to the R2 copy, else the downloads; unknown paths 404', async () => {
  const e = { ELECTIONS_DB: null };
  for (const [rel, where] of [
    ['exports/civgraph.jsonld', 'https://data.civgraph.net/downloads/civgraph.jsonld.gz'],
    ['exports/manifest.json', 'https://data.civgraph.net/downloads/manifest.json'],
    ['exports/jsonld/statement-shards/statements-jsonld-000.jsonld.gz', 'https://data.civgraph.net/downloads/manifest.json'],
    ['statement-shards/statements-000.json', 'https://data.civgraph.net/downloads/manifest.json'],
  ]) {
    const res = await call(dataGraph, '/data/graph/', rel, e);
    assert.equal(res.status, 301, rel);
    assert.equal(res.headers.get('Location'), where, rel);
  }
  const withCopy = { MAPS_BUCKET: { get: async (key) => (key === 'data/graph/statement-shards/statements-000.json' ? { body: '{"items":[]}' } : null) } };
  const r2 = await call(dataGraph, '/data/graph/', 'statement-shards/statements-000.json', withCopy);
  assert.equal(r2.status, 200);
  assert.equal(await r2.text(), '{"items":[]}');
  for (const rel of ['nothing.json', 'indexes/lookup/entity/12.json', 'entity-shards/../manifest.json']) {
    assert.equal((await call(dataGraph, '/data/graph/', rel, e)).status, 404, rel);
  }
  assert.equal((await call(dataGraph, '/data/graph/', 'manifest.json', e, 'POST')).status, 405);
  assert.equal(dataGraph.matchGraphPath('indexes/statements-by-subject-shards/statements-by-subject-0042.json').kind, 'statements-by-subject');
  assert.equal(dataGraph.matchGraphPath('indexes/browse-record-to-entity-register-interests.json').kind, 'browse-type');
});

test('data/browse: older layouts answer 301 to their API; unknown paths 404; no R2 read', async () => {
  const e = { ELECTIONS_DB: null, MAPS_BUCKET: { get: async () => { throw new Error('R2 must not be read'); } } };
  for (const [rel, where] of [
    ['proni-roots.json', '/_api/proni/node'],
    ['proni.json', '/_api/proni/node'],
    ['details/proni/D~1234~5.json', '/_api/proni/node?ref=D%2F1234%2F5'],
    ['details/sources/a-source.json', '/_api/sources?slug=a-source&view=detail'],
    ['details/register-interests/ni-register-record-1.json', '/_api/register-interests?slug=ni-register-record-1&view=detail'],
    ['map-features/lgd-2012/0001.json', 'https://data.civgraph.net/data/browse/map-features/lgd-2012/0001.json'],
  ]) {
    const res = await call(dataBrowse, '/data/browse/', rel, e);
    assert.equal(res.status, 301, rel);
    assert.equal(res.headers.get('Location'), where, rel);
  }
  for (const rel of ['nothing.json', 'details/unknown/x.json', 'person-shards/../index.json']) {
    assert.equal((await call(dataBrowse, '/data/browse/', rel, e)).status, 404, rel);
  }
  const head = await call(dataBrowse, '/data/browse/', 'proni-roots.json', e, 'HEAD');
  assert.equal(head.status, 301);
  assert.equal(head.body, null);
});
