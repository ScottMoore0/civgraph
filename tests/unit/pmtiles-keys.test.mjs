// The CDN upload manifest keeps each archive's existing R2 key (scripts/publish/pmtiles-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pmtilesTargetSuffix } from '../../scripts/publish/pmtiles-keys.mjs';

const ctx = { r2Prefix: 'data/maps/test', cdnBase: 'https://data.civgraph.net/data/maps/test' };
const OLD = 'pmtiles/generated/x-vector-test.pmtiles';
const NEW = 'pmtiles/generated/x-vector.pmtiles';

const renamedLayer = {
  id: 'x-vector',
  tileUrl: `${ctx.cdnBase}/${OLD}`,
  tilePackage: { localPath: `render/${OLD}`, r2Key: `${ctx.r2Prefix}/${OLD}`, cdnUrl: `${ctx.cdnBase}/${OLD}` },
};

test('a renamed layer whose archive is on disk keeps the archive name, not the new id', () => {
  assert.deepEqual(pmtilesTargetSuffix(renamedLayer, { ...ctx, exists: true }), { suffix: OLD, source: 'local-archive' });
});

test('a renamed layer whose archive is only on R2 keeps the key it is served from', () => {
  assert.deepEqual(pmtilesTargetSuffix(renamedLayer, { ...ctx, exists: false }), { suffix: OLD, source: 'r2-key' });
  const noKey = { ...renamedLayer, tilePackage: { ...renamedLayer.tilePackage, r2Key: undefined } };
  assert.deepEqual(pmtilesTargetSuffix(noKey, { ...ctx, exists: false }), { suffix: OLD, source: 'cdn-url' });
  const onlyTileUrl = { id: 'x-vector', tileUrl: `${ctx.cdnBase}/${OLD}` };
  assert.deepEqual(pmtilesTargetSuffix(onlyTileUrl, { ...ctx, exists: false }), { suffix: OLD, source: 'cdn-url' });
});

test('a rebuild written under a new name is a new upload and gets the new key', () => {
  const rebuilt = { ...renamedLayer, tilePackage: { ...renamedLayer.tilePackage, localPath: `render/${NEW}` } };
  assert.deepEqual(pmtilesTargetSuffix(rebuilt, { ...ctx, exists: true }), { suffix: NEW, source: 'local-archive' });
});

test('with nothing on disk and nothing on the layer, the prior manifest key wins', () => {
  const bare = { id: 'x-vector', tilePackage: { localPath: `render/${NEW}` } };
  const prior = { targetKey: `${ctx.r2Prefix}/${OLD}` };
  assert.deepEqual(pmtilesTargetSuffix(bare, { ...ctx, exists: false, prior }), { suffix: OLD, source: 'prior-manifest' });
});

test('a layer never uploaded gets its configured name, else the (renamed) layer id', () => {
  const fresh = { id: 'y-vector', tilePackage: { localPath: 'render/pmtiles/generated/y-vector.pmtiles' } };
  assert.deepEqual(pmtilesTargetSuffix(fresh, { ...ctx, exists: false }), { suffix: 'pmtiles/generated/y-vector.pmtiles', source: 'configured-name' });
  assert.deepEqual(pmtilesTargetSuffix({ id: 'z-vector' }, { ...ctx, exists: false }), { suffix: 'pmtiles/generated/z-vector.pmtiles', source: 'layer-id' });
});

test('URLs and keys outside the manifest roots are ignored, never half-parsed', () => {
  const elsewhere = {
    id: 'w-vector',
    tileUrl: 'https://data.civgraph.net/data/maps/pmtiles/w-vector.pmtiles',
    tilePackage: { r2Key: 'data/maps/pmtiles/w-vector.pmtiles', cdnUrl: 'https://other.example/data/maps/test/pmtiles/generated/w.pmtiles' },
  };
  assert.deepEqual(pmtilesTargetSuffix(elsewhere, { ...ctx, exists: false }), { suffix: 'pmtiles/generated/w-vector.pmtiles', source: 'layer-id' });
  // A tileUrl is not a local archive name even when the file "exists".
  assert.equal(pmtilesTargetSuffix({ id: 'v-vector', tileUrl: `${ctx.cdnBase}/${OLD}` }, { ...ctx, exists: true }).source, 'cdn-url');
});
