// The layer-id flip (scripts/maps/rename-layer-ids.mjs): ids, code and id-named files lose the
// -test suffix; tile keys and URLs keep it (old R2 keys stay 12 months); a second run is a no-op.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inScope, renameInText, renamedPath } from '../../scripts/maps/rename-layer-ids.mjs';

test('ids, template literals and patterns are renamed', () => {
  const src = '{"id": "lgd-2012-vector-test", "aliasOf": "x-alias-test", "r": "y-raster-test"}\nconst id = `${m}-vector-test`;\nid.replace(/-vector-test$/, "")';
  const { text, count } = renameInText(src);
  assert.equal(count, 5);
  assert.equal(text, '{"id": "lgd-2012-vector", "aliasOf": "x-alias", "r": "y-raster"}\nconst id = `${m}-vector`;\nid.replace(/-vector$/, "")');
  assert.equal(renameInText(text).count, 0, 'idempotent');
});

test('tile keys and URLs keep the old suffix', () => {
  const src = '"tileUrl": "https://data.civgraph.net/data/maps/test/pmtiles/generated/lgd-2012-vector-test.pmtiles", "tiles": ["https://x/tiles/eds-raster-test/{z}/{x}/{y}.png"], "localPath": "render/pmtiles/generated/a-vector-test.pmtiles"';
  assert.equal(renameInText(src).count, 0);
  const idx = '"featureIndexUrl": "/render/metadata/feature-indexes/lgd-2012-vector-test.json"';
  assert.equal(renameInText(idx).text, '"featureIndexUrl": "/render/metadata/feature-indexes/lgd-2012-vector.json"');
});

test('words that merely contain the suffix are left', () => {
  assert.equal(renameInText('a-vector-test-suite and vector-tests').count, 0);
});

test('files named by id are renamed; scope and skips', () => {
  assert.equal(renamedPath('render/metadata/feature-indexes/lgd-2012-vector-test.json'), 'render/metadata/feature-indexes/lgd-2012-vector.json');
  assert.equal(renamedPath('render/metadata/maps-test.json'), null);
  assert.ok(inScope('render/metadata/maps-test.json'));
  assert.ok(inScope('scripts/promote-test-converted-layers.mjs'));
  assert.ok(!inScope('render/metadata/cdn-upload-manifest.json'), 'reports keep their history');
  assert.ok(!inScope('scripts/lib/layer-renames.mjs'), 'the rename rule names both spellings');
  assert.ok(!inScope('docs/x.md'));
});
