import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getTileProfile } from '@civgraph/maps-pipeline/tiles/tile-profiles.mjs';

// Layers once held to minzoom 10 drew nothing at the zoom the map opens them at (Phelim Birch's
// catalogue review, #49 and the wave-16 follow-up). Their archives carry pruned attributes below
// z10 instead, and the DfI defect years leave out the defects recorded at the grid origin.

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const layers = new Map(read('render/metadata/maps-test.json').layers.map((l) => [l.id, l]));
const maps = new Map(read('data/database/maps.json').maps.map((m) => [m.id, m]));
const AGRI = 'wq-agricultural-critical-risk';
const CYCLE = 'dcc-dublin-metropolitan-area-existing-protected-cycle-infrastructure-2025';
const STRAY_YEARS = [2008, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017];

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

test('the DfI defect years leave out the grid-origin points and fit Northern Ireland', () => {
  assert.equal(getTileProfile('dfi-surface-defects-2008').sourceWhere, 'NOT (EASTING < 1000 AND NORTHING < 1000)');
  for (const y of STRAY_YEARS) {
    for (const entry of [layers.get(`dfi-surface-defects-${y}-vector`), maps.get(`dfi-surface-defects-${y}`)]) {
      const [[south, west], [north, east]] = entry.bounds;
      assert.ok(south > 54 && west > -8.2 && north < 55.4 && east < -5.4, `${y} bounds ${JSON.stringify(entry.bounds)}`);
      assert.match(entry.description, /recorded with no location .* not drawn on the map; (they are|it is) in the download\./, `${y}`);
    }
  }
});
