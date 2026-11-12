// The blob store (packages/storage/src/blob.js, blob-bindings.js, blob-fs.mjs; storage slice ST-2).
//
//   1. one conformance suite over every BlobStore: memory, a folder on disk, and the R2 and KV
//      adapters over stand-ins that answer as the Cloudflare bindings do;
//   2. the adapters call their binding exactly as the handlers called it before they moved
//      (the same method, arguments and option objects), so the answers are unchanged;
//   3. the boundary: no Function file outside packages/storage/ reads an R2 or KV binding itself
//      (the files not yet moved are pinned, and the list only shrinks).
//
//   node --test tests/functions/blob-store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertBlobStore, listPage, memoryBlobStore } from '../../packages/storage/src/blob.js';
import { blobStore, fromKV, fromR2 } from '../../packages/storage/src/blob-bindings.js';
import { fsBlobStore } from '../../packages/storage/src/blob-fs.mjs';
import * as storage from '../../packages/storage/src/index.js';
import { BINDINGS } from '../../packages/config/src/config.js';
import { REPO_ROOT } from '../../packages/config/src/node.mjs';

const text = (body) => (typeof body === 'string' ? body : new TextDecoder().decode(body));

/** An R2 bucket stand-in over a Map, listing as R2 does (sorted, delimited, paged); records every call. */
export function fakeR2() {
  const map = new Map();
  const calls = [];
  const object = (key, item) => ({
    key,
    size: item.bytes.byteLength,
    etag: `e-${key.length}`,
    httpEtag: `"e-${key.length}"`,
    uploaded: new Date(Date.UTC(2026, 10, 12)),
    httpMetadata: item.httpMetadata || {},
    customMetadata: item.customMetadata || {},
  });
  return {
    calls,
    map,
    async get(key, ...rest) {
      calls.push(['get', key, ...rest]);
      const item = map.get(key);
      if (!item) return null;
      return {
        ...object(key, item),
        body: item.bytes.slice(),
        async text() { return new TextDecoder().decode(item.bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(item.bytes)); },
      };
    },
    async put(key, value, options) {
      calls.push(['put', key, typeof value === 'string' ? value : '(bytes)', options]);
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : value.slice(0));
      map.set(key, { bytes, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
      return null;
    },
    async list(options) {
      calls.push(['list', options]);
      const page = listPage([...map.keys()], options || {}, (key) => ({ key }));
      return {
        objects: page.entries.map((e) => object(e.key, map.get(e.key))),
        delimitedPrefixes: page.prefixes,
        truncated: page.truncated,
        ...(page.truncated ? { cursor: page.cursor } : {}),
      };
    },
  };
}

/** A KV namespace stand-in over a Map, listing as KV does (sorted, paged, no delimiter); records every call. */
export function fakeKV() {
  const map = new Map();
  const calls = [];
  return {
    calls,
    map,
    async get(key, type) {
      calls.push(type === undefined ? ['get', key] : ['get', key, type]);
      if (!map.has(key)) return null;
      const { value } = map.get(key);
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value, options) {
      calls.push(['put', key, options]);
      map.set(key, { value: typeof value === 'string' ? value : new TextDecoder().decode(value), metadata: options?.metadata });
    },
    async list(options) {
      calls.push(['list', options]);
      const { prefix = '', limit = 1000, cursor } = options || {};
      const page = listPage([...map.keys()], { prefix, limit, cursor }, (key) => ({ key }));
      return {
        keys: page.entries.map((e) => ({ name: e.key, ...(map.get(e.key).metadata !== undefined ? { metadata: map.get(e.key).metadata } : {}) })),
        list_complete: !page.truncated,
        ...(page.truncated ? { cursor: page.cursor } : {}),
      };
    },
  };
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'civgraph-blob-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const STORES = {
  memory: () => memoryBlobStore(),
  fs: () => fsBlobStore(mkdtempSync(path.join(tmp, 'fs-'))),
  r2: () => fromR2(/** @type {any} */ (fakeR2())),
  kv: () => fromKV(/** @type {any} */ (fakeKV())),
};

for (const [name, make] of Object.entries(STORES)) {
  test(`${name}: a BlobStore that reads back what it wrote`, async () => {
    const store = assertBlobStore(make());
    assert.equal(store.kind, name);
    assert.equal(await store.get('missing/key.json'), null);
    assert.equal(await store.text('missing/key.json'), null);
    assert.equal(await store.json('missing/key.json'), null);
    await store.put('a/b/one.json', '{"n":1}', { contentType: 'application/json' });
    await store.put('a/b/two.txt', new TextEncoder().encode('two'));
    await store.put('a/three.txt', 'three', { metadata: { status: 'pending-review' } });
    assert.deepEqual(await store.json('a/b/one.json'), { n: 1 });
    assert.equal(await store.text('a/b/two.txt'), 'two');
    const got = await store.get('a/b/one.json');
    assert.equal(text(got.body instanceof ArrayBuffer ? new Uint8Array(got.body) : got.body), '{"n":1}');
    if (name !== 'kv') assert.equal(got.contentType, 'application/json'); // KV has no content type
    for (const op of ['get', 'put', 'list']) assert.equal(store.supports(op), true, op);
  });

  test(`${name}: lists a prefix in key order, a page at a time`, async () => {
    const store = make();
    for (const key of ['p/c.txt', 'p/a.txt', 'p/b.txt', 'q/x.txt']) await store.put(key, key);
    const first = await store.list({ prefix: 'p/', limit: 2 });
    assert.deepEqual(first.entries.map((e) => e.key), ['p/a.txt', 'p/b.txt']);
    assert.equal(first.truncated, true);
    assert.ok(first.cursor);
    const second = await store.list({ prefix: 'p/', limit: 2, cursor: first.cursor });
    assert.deepEqual(second.entries.map((e) => e.key), ['p/c.txt']);
    assert.equal(second.truncated, false);
    assert.equal(second.cursor, null);
  });

  if (name !== 'kv') {
    test(`${name}: a delimiter lists one level`, async () => {
      const store = make();
      for (const key of ['d/top.json', 'd/sub/one.json', 'd/sub/two.json', 'd/other/x.json']) await store.put(key, '1');
      const level = await store.list({ prefix: 'd/', delimiter: '/' });
      assert.deepEqual(level.entries.map((e) => e.key), ['d/top.json']);
      assert.deepEqual(level.prefixes, ['d/other/', 'd/sub/']);
      assert.equal(level.entries[0].size, 1);
      assert.match(level.entries[0].uploaded || '', /^\d{4}-\d\d-\d\dT/);
    });
  }
}

test('the KV adapter keeps metadata on put and returns it in listings', async () => {
  const store = fromKV(/** @type {any} */ (fakeKV()));
  await store.put('submissions/2026-11-12/sub_a.json', '{}', { metadata: { status: 'approved' } });
  const { entries } = await store.list({ prefix: 'submissions/' });
  assert.deepEqual(entries, [{ key: 'submissions/2026-11-12/sub_a.json', size: null, uploaded: null, etag: null, metadata: { status: 'approved' } }]);
});

test('the R2 adapter calls the bucket as the handlers did', async () => {
  const bucket = fakeR2();
  const store = fromR2(/** @type {any} */ (bucket));
  await store.put('submissions/x.json', '{}', { contentType: 'application/json' });
  await store.put('quarantine/y', new Uint8Array([1]), { contentType: 'application/octet-stream', metadata: { sha256: 'ab' } });
  await store.list({ prefix: 'data/', delimiter: '/', cursor: undefined, limit: 200 });
  await store.list({ prefix: 'data/', delimiter: '/', cursor: 'c1', limit: 200 });
  await store.list({ prefix: 'submissions/', limit: 1000 });
  await store.text('submissions/x.json');
  assert.deepEqual(bucket.calls, [
    ['put', 'submissions/x.json', '{}', { httpMetadata: { contentType: 'application/json' } }],
    ['put', 'quarantine/y', '(bytes)', { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { sha256: 'ab' } }],
    ['list', { prefix: 'data/', delimiter: '/', cursor: undefined, limit: 200, include: [] }],
    ['list', { prefix: 'data/', delimiter: '/', cursor: 'c1', limit: 200, include: [] }],
    ['list', { prefix: 'submissions/', cursor: undefined, limit: 1000, include: [] }],
    ['get', 'submissions/x.json'],
  ]);
  const listing = await store.list({ prefix: 'submissions/' });
  assert.deepEqual(listing.entries[0], { key: 'submissions/x.json', size: 2, uploaded: '2026-11-12T00:00:00.000Z', etag: '"e-18"', metadata: null });
});

test('the KV adapter calls the namespace as the handlers did', async () => {
  const ns = fakeKV();
  const store = fromKV(/** @type {any} */ (ns));
  await store.put('submissions/x.json', '{}', { metadata: { status: 'pending-review' } });
  await store.put('search:v:?q=a', '[]', { expirationTtl: 86400 });
  await store.text('submissions/x.json');
  await store.json('names');
  await store.list({ prefix: 'submissions/', limit: 1000, cursor: undefined });
  assert.deepEqual(ns.calls, [
    ['put', 'submissions/x.json', { metadata: { status: 'pending-review' } }],
    ['put', 'search:v:?q=a', { expirationTtl: 86400 }],
    ['get', 'submissions/x.json'],
    ['get', 'names', 'json'],
    ['list', { prefix: 'submissions/', limit: 1000, cursor: undefined }],
  ]);
});

test('supports() follows what the binding offers; blobStore() picks the adapter by the binding kind', () => {
  const putOnly = fromKV(/** @type {any} */ ({ async put() {} }));
  assert.equal(putOnly.supports('put'), true);
  assert.equal(putOnly.supports('list'), false);
  assert.equal(blobStore({}, 'MAPS_BUCKET'), null);
  assert.equal(blobStore({ MAPS_BUCKET: fakeR2() }, 'MAPS_BUCKET')?.kind, 'r2');
  assert.equal(blobStore({ SPATIAL_INDEX: fakeKV() }, 'SPATIAL_INDEX')?.kind, 'kv');
  assert.throws(() => blobStore({}, /** @type {any} */ ('ELECTIONS_DB')), /not an R2 or KV binding/);
  assert.throws(() => blobStore({}, /** @type {any} */ ('NO_SUCH_BINDING')), /not an R2 or KV binding|unknown binding/);
  assert.equal(typeof storage.blobStore, 'function');
  assert.equal(typeof storage.memoryBlobStore, 'function');
});

test('the file store refuses keys that leave its folder', async () => {
  const store = fsBlobStore(mkdtempSync(path.join(tmp, 'keys-')));
  for (const key of ['../x', 'a/../../x', '/abs', '', 'a//b', '.blob-meta/x']) {
    await assert.rejects(store.put(key, 'x'), /not a usable key/, key);
  }
});

// ------------------------------------------------------------------ the boundary

/** The R2 and KV bindings, from config.js BINDINGS. */
const BLOB_BINDINGS = Object.entries(BINDINGS).filter(([, b]) => b.kind === 'r2' || b.kind === 'kv').map(([name]) => name);

/** Function files that still read an R2 or KV binding themselves (ST-2 empties this list). */
const NOT_YET_ON_THE_BLOB_STORE = [
  'functions/data/maps/[[path]].js',
  'packages/api/src/handlers/_r2-listing.js',
  'packages/api/src/handlers/contributions/decide.js',
  'packages/api/src/handlers/contributions/intake.js',
  'packages/api/src/handlers/contributions/list.js',
  'packages/api/src/handlers/contributions/r2-index.js',
  'packages/api/src/handlers/contributions/submit.js',
  'packages/api/src/handlers/data-index/index.js',
  'packages/api/src/handlers/proni/search.js',
  'packages/api/src/handlers/search.js',
  'packages/api/src/handlers/spatial.js',
];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
};

test('only packages/storage/ reads an R2 or KV binding (the files not yet moved are pinned)', () => {
  assert.ok(BLOB_BINDINGS.includes('MAPS_BUCKET') && BLOB_BINDINGS.includes('SPATIAL_INDEX'));
  const names = BLOB_BINDINGS.join('|');
  // binding(env, 'MAPS_BUCKET'), env.MAPS_BUCKET, env['MAPS_BUCKET'], or the engine types themselves
  const direct = new RegExp(`binding\\([^)]*['"](${names})['"]|\\.(${names})\\b|\\[['"](${names})['"]\\]|\\b(R2Bucket|KVNamespace)\\b`);
  const reading = [...walk(path.join(REPO_ROOT, 'functions')), ...walk(path.join(REPO_ROOT, 'packages', 'api', 'src'))]
    // line comments are prose; JSDoc stays, so a `{R2Bucket}` parameter counts
    .filter((f) => direct.test(readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')))
    .map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'))
    .sort();
  assert.deepEqual(reading, [...NOT_YET_ON_THE_BLOB_STORE].sort(),
    'a file left the list (remove it from NOT_YET_ON_THE_BLOB_STORE) or a new one reads R2/KV directly (use blobStore() from packages/storage)');
});
