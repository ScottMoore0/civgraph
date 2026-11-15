import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTileProfile } from '../../packages/maps-pipeline/src/tiles/tile-profiles.mjs';

// Layers once held to minzoom 10 drew nothing at the zoom the map opens them at (Phelim Birch's
// catalogue review, #49 and the wave-16 follow-up). Their archives carry pruned attributes below
// z10 instead.

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const layers = new Map(read('render/metadata/maps-test.json').layers.map((l) => [l.id, l]));
const AGRI = 'wq-agricultural-critical-risk';
const CYCLE = 'dcc-dublin-metropolitan-area-existing-protected-cycle-infrastructure-2025';

test('the agricultural critical risk and cycle infrastructure layers start at z0, with pruned low zooms', () => {
  for (const id of [AGRI, CYCLE]) {
    assert.equal(layers.get(`${id}-vector`).minzoom, 0, id);
    const profile = getTileProfile(id);
    assert.equal(profile.lowZoomAttributeCutoff, 9, id);
    assert.ok(Array.isArray(profile.lowZoomKeep) && profile.lowZoomKeep.length, id);
  }
  assert.equal(getTileProfile(CYCLE).keepProseAboveCutoff, true, 'the KML table stays in the z10+ tiles');
  assert.equal(layers.get(`${CYCLE}-vector`).labelMinZoom, 10, 'its id labels still start at z10');
  assert.equal(layers.get('transport-carriageway-defects-2021-vector').minzoom, 10, 'the hidden copy is unchanged');
});
