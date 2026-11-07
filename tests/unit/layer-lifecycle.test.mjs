// The tile-layer lifecycle (scripts/publish/layer-lifecycle.mjs) and the machine helper under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { InvalidTransitionError, defineMachine, defineToggle } from '../../scripts/publish/state-machine.mjs';
import { layerLifecycle, mvtDirectoryState, pmtilesLayerState } from '../../scripts/publish/layer-lifecycle.mjs';

const URL_OLD = 'https://data.civgraph.net/data/maps/test/pmtiles/generated/x-vector-test.pmtiles';
const URL_NEW = 'https://data.civgraph.net/data/maps/test/pmtiles/generated/x-vector.pmtiles';

test('defineMachine rejects malformed tables', () => {
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'a'], initial: 'a', transitions: { a: [] } }), /twice/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a'], initial: 'b', transitions: { a: [] } }), /initial/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'b'], initial: 'a', transitions: { a: ['b'] } }), /no transitions given for b/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a'], initial: 'a', transitions: { a: ['c'] } }), /unknown state/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a'], initial: 'a', transitions: { a: [], z: [] } }), /unknown state z/);
  assert.throws(() => defineMachine({ name: 'm', states: ['a', 'b'], initial: 'a', transitions: { a: [], b: [] }, guards: { 'a->b': () => null } }), /guard a->b/);
});

test('defineToggle flips both ways and nothing else', () => {
  const t = defineToggle('dry run', ['real', 'dry']);
  assert.equal(t.initial, 'real');
  assert.equal(t.assert('real', 'dry'), 'dry');
  assert.equal(t.assert('dry', 'real'), 'real');
  assert.equal(t.check('dry', 'dry').ok, false);
  assert.throws(() => t.assert('real', 'maybe'), InvalidTransitionError);
});

test('the lifecycle table forbids skipping verification or serving from a failure', () => {
  const forbidden = [
    ['local', 'serving'], ['failed', 'serving'], ['serving', 'uploaded'], ['verified', 'uploaded'],
    ['serving', 'serving'], ['verified', 'failed'], ['nonsense', 'local'],
  ];
  for (const [from, to] of forbidden) {
    assert.equal(layerLifecycle.check(from, to, { kind: 'pmtiles' }).ok, false, `${from} -> ${to}`);
    assert.throws(() => layerLifecycle.assert(from, to, { kind: 'pmtiles' }), InvalidTransitionError);
  }
  for (const [from, to] of [['local', 'uploaded'], ['uploaded', 'verified'], ['local', 'verified'], ['failed', 'uploaded'], ['serving', 'local'], ['verified', 'local']]) {
    assert.equal(layerLifecycle.check(from, to).ok, true, `${from} -> ${to}`);
  }
});

test('a PMTiles switch needs a passing range check of the URL it will serve', () => {
  const ok = layerLifecycle.check('verified', 'serving', { kind: 'pmtiles', cdnUrl: URL_OLD, checkedUrl: URL_OLD });
  assert.deepEqual(ok, { ok: true });
  // The 7 Nov hazard: the manifest names a new key, the range check fetched the old one.
  const stale = layerLifecycle.check('verified', 'serving', { kind: 'pmtiles', cdnUrl: URL_NEW, checkedUrl: URL_OLD });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /fetched .*x-vector-test\.pmtiles, not .*x-vector\.pmtiles/);
  assert.equal(layerLifecycle.check('verified', 'serving', { kind: 'pmtiles', checkedUrl: URL_OLD }).ok, false);
  // An uploaded but unverified archive never serves.
  assert.equal(layerLifecycle.check('uploaded', 'serving', { kind: 'pmtiles', uploadStatus: 'uploaded' }).ok, false);
});

test('an MVT directory switches from its directory upload, and only that', () => {
  assert.equal(layerLifecycle.check('uploaded', 'serving', { kind: 'mvt-directory', uploadStatus: 'uploaded-directory' }).ok, true);
  assert.equal(layerLifecycle.check('uploaded', 'serving', { kind: 'mvt-directory', uploadStatus: 'dry-run' }).ok, false);
  assert.equal(layerLifecycle.check('verified', 'serving', { kind: 'mvt-directory', cdnUrl: URL_OLD, checkedUrl: URL_OLD }).ok, false);
  assert.equal(mvtDirectoryState({ upload: { ok: true, status: 'uploaded-directory' } }), 'uploaded');
  assert.equal(mvtDirectoryState({ upload: { ok: true, status: 'dry-run' } }), 'local');
  assert.equal(mvtDirectoryState({ upload: { ok: false, status: 'partial-directory-upload' } }), 'failed');
  assert.equal(mvtDirectoryState({}), 'local');
});

test('pmtilesLayerState reads the reports, this run first', () => {
  const layer = { tileUrl: URL_OLD, tilePackage: { serving: 'cdn' } };
  const asset = { cdnUrl: URL_OLD };
  assert.equal(pmtilesLayerState({ layer, asset, range: { ok: true } }), 'verified', 'a re-verified serving layer is restamped');
  assert.equal(pmtilesLayerState({ layer, asset }), 'serving');
  assert.equal(pmtilesLayerState({ layer, asset: { cdnUrl: URL_NEW } }), 'local', 'serving another URL than the manifest names');
  assert.equal(pmtilesLayerState({ layer: {}, asset, upload: { ok: true, status: 'uploaded' } }), 'uploaded');
  assert.equal(pmtilesLayerState({ layer: {}, asset, upload: { ok: true, status: 'dry-run' } }), 'local');
  assert.equal(pmtilesLayerState({ layer: {}, asset, upload: { ok: false, status: 'upload-failed' } }), 'failed');
  assert.equal(pmtilesLayerState({ layer: {}, asset, range: { ok: false } }), 'failed');
});
