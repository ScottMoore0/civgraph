// The tile-layer lifecycle (scripts/publish/layer-lifecycle.mjs) and the guarded transitions under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineMachine } from '../../scripts/lib/state-machine.mjs';
import { checkTransition, defineGuards } from '../../scripts/publish/transition-check.mjs';
import { assertLayerTransition, checkLayerTransition, mvtDirectoryState, pmtilesLayerState } from '../../scripts/publish/layer-lifecycle.mjs';

const URL_OLD = 'https://data.civgraph.net/data/maps/test/pmtiles/generated/x-vector-test.pmtiles';
const URL_NEW = 'https://data.civgraph.net/data/maps/test/pmtiles/generated/x-vector.pmtiles';

test('guards must sit on a transition the table lists', () => {
  const m = defineMachine({ name: 'm', initial: 'a', transitions: { a: ['b'], b: [] } });
  assert.throws(() => defineGuards(m, { 'b->a': () => null }), /guard b->a/);
  const guards = defineGuards(m, { 'a->b': (ctx) => (ctx.allow ? null : 'not allowed yet') });
  assert.deepEqual(checkTransition(m, guards, 'a', 'b', { allow: true }), { ok: true });
  assert.match(checkTransition(m, guards, 'a', 'b', {}).reason, /m: a -> b: not allowed yet/);
  assert.match(checkTransition(m, guards, 'b', 'a').reason, /not allowed \(from b: none, it is final\)/);
  assert.match(checkTransition(m, guards, 'z', 'a').reason, /"z" is not a state/);
});

test('the lifecycle table forbids skipping verification or serving from a failure', () => {
  const forbidden = [
    ['local', 'serving'], ['failed', 'serving'], ['serving', 'uploaded'], ['verified', 'uploaded'],
    ['serving', 'serving'], ['verified', 'failed'], ['nonsense', 'local'],
  ];
  for (const [from, to] of forbidden) {
    assert.equal(checkLayerTransition(from, to, { kind: 'pmtiles' }).ok, false, `${from} -> ${to}`);
    assert.throws(() => assertLayerTransition(from, to, { kind: 'pmtiles' }), /layer lifecycle/);
  }
  for (const [from, to] of [['local', 'uploaded'], ['uploaded', 'verified'], ['local', 'verified'], ['failed', 'uploaded'], ['serving', 'local'], ['verified', 'local']]) {
    assert.equal(checkLayerTransition(from, to).ok, true, `${from} -> ${to}`);
  }
});

test('a PMTiles switch needs a passing range check of the URL it will serve', () => {
  const ok = checkLayerTransition('verified', 'serving', { kind: 'pmtiles', cdnUrl: URL_OLD, checkedUrl: URL_OLD });
  assert.deepEqual(ok, { ok: true });
  // The 7 Nov hazard: the manifest names a new key, the range check fetched the old one.
  const stale = checkLayerTransition('verified', 'serving', { kind: 'pmtiles', cdnUrl: URL_NEW, checkedUrl: URL_OLD });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /fetched .*x-vector-test\.pmtiles, not .*x-vector\.pmtiles/);
  assert.equal(checkLayerTransition('verified', 'serving', { kind: 'pmtiles', checkedUrl: URL_OLD }).ok, false);
  // An uploaded but unverified archive never serves.
  assert.equal(checkLayerTransition('uploaded', 'serving', { kind: 'pmtiles', uploadStatus: 'uploaded' }).ok, false);
});

test('an MVT directory switches from its directory upload, and only that', () => {
  assert.equal(checkLayerTransition('uploaded', 'serving', { kind: 'mvt-directory', uploadStatus: 'uploaded-directory' }).ok, true);
  assert.equal(checkLayerTransition('uploaded', 'serving', { kind: 'mvt-directory', uploadStatus: 'dry-run' }).ok, false);
  assert.equal(checkLayerTransition('verified', 'serving', { kind: 'mvt-directory', cdnUrl: URL_OLD, checkedUrl: URL_OLD }).ok, false);
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

test('a rebuilt archive that was never uploaded cannot switch on the old bytes passing', async () => {
  const { contentRangeTotal } = await import('../../scripts/publish/layer-lifecycle.mjs');
  assert.equal(contentRangeTotal('bytes 0-15/62661'), 62661);
  assert.equal(contentRangeTotal(undefined), null);
  assert.equal(contentRangeTotal('bytes 0-15/*'), null);
  const base = { kind: 'pmtiles', cdnUrl: URL_OLD, checkedUrl: URL_OLD };
  // The admin-areas 1921/1924/1928 case on 7 Nov: local 903,571 bytes, CDN 812,905.
  const stale = checkLayerTransition('verified', 'serving', { ...base, localBytes: 903571, remoteBytes: 812905 });
  assert.equal(stale.ok, false);
  assert.match(stale.reason, /rebuilt and not uploaded/);
  assert.equal(checkLayerTransition('verified', 'serving', { ...base, localBytes: 62661, remoteBytes: 62661 }).ok, true);
  // Remote-only archives (no local bytes) and checks without a Content-Range are not refused for size.
  assert.equal(checkLayerTransition('verified', 'serving', { ...base, localBytes: null, remoteBytes: 812905 }).ok, true);
  assert.equal(checkLayerTransition('verified', 'serving', { ...base, localBytes: 903571, remoteBytes: null }).ok, true);
});
