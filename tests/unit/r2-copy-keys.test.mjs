/**
 * The wave-3 rename rules (scripts/lib/layer-renames.mjs) and the server-side R2 copy
 * (scripts/publish/r2-copy-keys.mjs), against a fake S3 client: no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyLayerId, renameLayerId, renamePmtilesKey } from '../../packages/core/src/layer-renames.mjs';
import { copyPairs, copySource, MAX_SINGLE_COPY_BYTES, planManifest, validateManifest, verifyPairs } from '../../scripts/publish/r2-copy-keys.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('layer ids lose their -test suffix, and the rule reverses', () => {
  assert.equal(renameLayerId('admin-areas-1921-05-03-vector-test'), 'admin-areas-1921-05-03-vector');
  assert.equal(renameLayerId('pc-2023-raster-test'), 'pc-2023-raster');
  assert.equal(renameLayerId('admin-areas-1939-05-23-alias-test'), 'admin-areas-1939-05-23-alias');
  assert.equal(renameLayerId('election-dail-eireann-2024-11-29'), 'election-dail-eireann-2024-11-29');
  assert.equal(renameLayerId('-vector-test'), '-vector-test', 'a bare suffix is not an id');
  assert.equal(legacyLayerId('pc-2023-raster'), 'pc-2023-raster-test');
  assert.equal(legacyLayerId(renameLayerId('x-alias-test')), 'x-alias-test');
});

test('PMTiles keys and CDN URLs map to the new prefix; anything else is not covered', () => {
  assert.deepEqual(renamePmtilesKey('https://data.civgraph.net/data/maps/test/pmtiles/generated/wards-1984-vector-test.pmtiles'),
    { from: 'data/maps/test/pmtiles/generated/wards-1984-vector-test.pmtiles', to: 'data/maps/pmtiles/wards-1984-vector.pmtiles' });
  assert.equal(renamePmtilesKey('/render/pmtiles/generated/wards-1984-vector-test.pmtiles'), null);
  assert.equal(renamePmtilesKey('data/maps/test/pmtiles/generated/sub/x-vector-test.pmtiles'), null);
  assert.equal(renamePmtilesKey('data/maps/test/pmtiles/generated/x.pmtiles'), null);
  assert.equal(renamePmtilesKey('data/maps/test/pmtiles/generated/x-vector-test.json'), null);
});

test('plan: one pair per distinct object, aliases share their target, the rest is listed', () => {
  const doc = { layers: [
    { id: 'a-vector-test', tileUrl: 'https://data.civgraph.net/data/maps/test/pmtiles/generated/a-vector-test.pmtiles' },
    { id: 'a-alias-test', tileUrl: 'https://data.civgraph.net/data/maps/test/pmtiles/generated/a-vector-test.pmtiles' },
    { id: 'b-vector-test', nested: { tileUrl: 'https://data.civgraph.net/data/maps/test/pmtiles/generated/b-vector-test.pmtiles' } },
    { id: 'c-vector-test', tileUrl: '/render/pmtiles/generated/c-vector-test.pmtiles' },
  ] };
  const m = planManifest(doc, { today: new Date('2026-11-06T00:00:00Z') });
  assert.deepEqual(m.pairs.map((p) => p.to), ['data/maps/pmtiles/a-vector.pmtiles', 'data/maps/pmtiles/b-vector.pmtiles']);
  assert.deepEqual(m.notCovered, [{ url: '/render/pmtiles/generated/c-vector-test.pmtiles', count: 1 }]);
  assert.equal(m.retainOldUntil, '2027-11-06');
  assert.equal(m.approval, null);
  assert.deepEqual(validateManifest(m), []);
});

test('plan over the real layer registry is valid and covers every CDN PMTiles URL', () => {
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'render/metadata/maps-test.json'), 'utf8'));
  const m = planManifest(doc);
  assert.deepEqual(validateManifest(m), []);
  assert.ok(m.pairs.length > 800, `${m.pairs.length} pairs`);  // 873 distinct archives on 2026-11-06: alias layers share their target's file
  assert.ok(m.notCovered.every((n) => !n.url.includes('data/maps/test/pmtiles/generated/')), 'every old-prefix URL is renamed');
});

test('validateManifest refuses keys outside the two prefixes and duplicate destinations', () => {
  const base = { kind: 'r2-key-renames', schemaVersion: 1 };
  assert.match(validateManifest({ ...base, pairs: [{ from: 'data/maps/test/pmtiles/generated/a.pmtiles', to: 'data/browse/a.pmtiles' }] }).join(), /outside/);
  assert.match(validateManifest({ ...base, pairs: [
    { from: 'data/maps/test/pmtiles/generated/a.pmtiles', to: 'data/maps/pmtiles/x.pmtiles' },
    { from: 'data/maps/test/pmtiles/generated/b.pmtiles', to: 'data/maps/pmtiles/x.pmtiles' },
  ] }).join(), /destination twice/);
  assert.match(validateManifest({ ...base, pairs: [] }).join(), /no pairs/);
});

class Head { constructor(input) { this.kind = 'head'; this.input = input; } }
class Copy { constructor(input) { this.kind = 'copy'; this.input = input; } }
const commands = { HeadObjectCommand: Head, CopyObjectCommand: Copy };

function fakeS3(objects) {
  const sent = [];
  return {
    sent,
    objects,
    async send(cmd) {
      sent.push(cmd);
      if (cmd.kind === 'head') {
        const o = objects.get(cmd.input.Key);
        if (!o) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
        return { ContentLength: o.size, ETag: o.etag };
      }
      const key = decodeURIComponent(cmd.input.CopySource.slice(cmd.input.CopySource.indexOf('/') + 1));
      objects.set(cmd.input.Key, { ...objects.get(key) });
      return {};
    },
  };
}

const OLD = 'data/maps/test/pmtiles/generated/a-vector-test.pmtiles';
const NEW = 'data/maps/pmtiles/a-vector.pmtiles';

test('a dry run sends nothing', async () => {
  const s3 = fakeS3(new Map([[OLD, { size: 10, etag: '"e"' }]]));
  const results = await copyPairs([{ from: OLD, to: NEW }], { client: s3, commands, bucket: 'b', apply: false, log: () => {} });
  assert.equal(s3.sent.length, 0);
  assert.equal(results[0].status, 'planned');
});

test('apply copies server-side with metadata, confirms, and is idempotent', async () => {
  const s3 = fakeS3(new Map([[OLD, { size: 10, etag: '"e"' }]]));
  const opts = { client: s3, commands, bucket: 'boundaries-data', apply: true, log: () => {} };
  const first = await copyPairs([{ from: OLD, to: NEW }], opts);
  assert.equal(first[0].status, 'copied');
  const copy = s3.sent.find((c) => c.kind === 'copy');
  assert.equal(copy.input.MetadataDirective, 'COPY');
  assert.equal(copy.input.CopySource, `boundaries-data/${OLD}`);
  assert.ok(s3.objects.has(OLD), 'the old object stays');
  const sentBefore = s3.sent.length;
  const second = await copyPairs([{ from: OLD, to: NEW }], opts);
  assert.equal(second[0].status, 'already-copied');
  assert.ok(!s3.sent.slice(sentBefore).some((c) => c.kind === 'copy'), 'no second copy');
});

test('apply never overwrites a different destination and reports a missing or oversized source', async () => {
  const s3 = fakeS3(new Map([[OLD, { size: 10, etag: '"e"' }], [NEW, { size: 9, etag: '"x"' }], ['data/maps/test/pmtiles/generated/big-vector-test.pmtiles', { size: MAX_SINGLE_COPY_BYTES + 1, etag: '"b"' }]]));
  const results = await copyPairs([
    { from: OLD, to: NEW },
    { from: 'data/maps/test/pmtiles/generated/none-vector-test.pmtiles', to: 'data/maps/pmtiles/none-vector.pmtiles' },
    { from: 'data/maps/test/pmtiles/generated/big-vector-test.pmtiles', to: 'data/maps/pmtiles/big-vector.pmtiles' },
  ], { client: s3, commands, bucket: 'b', apply: true, log: () => {} });
  assert.deepEqual(results.map((r) => r.status), ['error', 'error', 'error']);
  assert.match(results[0].detail, /not overwritten/);
  assert.match(results[1].detail, /source missing/);
  assert.match(results[2].detail, /multipart/);
  assert.equal(s3.objects.get(NEW).size, 9);
  assert.ok(!s3.sent.some((c) => c.kind === 'copy'));
});

test('verify compares both keys without writing', async () => {
  const s3 = fakeS3(new Map([[OLD, { size: 10, etag: '"e"' }], [NEW, { size: 10, etag: '"e"' }]]));
  const results = await verifyPairs([{ from: OLD, to: NEW }, { from: OLD, to: 'data/maps/pmtiles/missing.pmtiles' }], { client: s3, commands, bucket: 'b' });
  assert.deepEqual(results.map((r) => r.status), ['ok', 'new-missing']);
  assert.ok(s3.sent.every((c) => c.kind === 'head'));
});

test('copy sources encode each path segment', () => {
  assert.equal(copySource('b', 'data/maps/a b+c.pmtiles'), 'b/data/maps/a%20b%2Bc.pmtiles');
});
