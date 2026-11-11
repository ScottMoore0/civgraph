// Where a feature link frames the map (packages/map/src/app/feature-bounds.mjs; QA 2026-11-11, H2:
// the Belfast West link opened on the whole island at zoom 6). Over the real indexes for
// Westminster constituencies 2023: the spatial index (data/database/spatial-index/pc-2023.json)
// and the feature index (render/metadata/feature-indexes/pc-2023-vector.json).
//
//   node --test tests/unit/feature-bounds.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  bboxAround,
  featureBoundsFromIndex,
  featureBoundsFromSpatial,
  sameFeature,
  validBbox,
} from '../../packages/map/src/app/feature-bounds.mjs';

const SPATIAL = JSON.parse(readFileSync('data/database/spatial-index/pc-2023.json', 'utf8'));
const INDEX = JSON.parse(readFileSync('render/metadata/feature-indexes/pc-2023-vector.json', 'utf8'));

// Belfast West lies within about -6.1..-5.9 E, 54.5..54.65 N.
const inBelfast = (box) => box && box[0] > -6.2 && box[2] < -5.8 && box[1] > 54.45 && box[3] < 54.7;
// Zoom 6 shows the island; a box this small means a fit to well past zoom 10.
const small = (box) => box && box[2] - box[0] < 0.4 && box[3] - box[1] < 0.3;

test('the shared link\'s featureId (a name) finds Belfast West in the spatial index', () => {
  const box = featureBoundsFromSpatial(SPATIAL, 'pc-2023', 'BELFAST WEST', 'BELFAST WEST');
  assert.ok(inBelfast(box) && small(box), JSON.stringify(box));
  // Case and spacing as a reader types them.
  assert.deepEqual(featureBoundsFromSpatial(SPATIAL, 'pc-2023', 'belfast  west', null), box);
});

test('the spatial index matches its own "<mapId>:<index>" ids and bare ids', () => {
  const entries = [{ id: 'm:7', name: 'A', bbox: [1, 2, 3, 4] }, { id: 8, name: 'B', bbox: [5, 6, 7, 8] }];
  assert.deepEqual(featureBoundsFromSpatial(entries, 'm', '7'), [1, 2, 3, 4]);
  assert.deepEqual(featureBoundsFromSpatial(entries, 'm', 8), [5, 6, 7, 8]);
  assert.equal(featureBoundsFromSpatial(entries, 'm', 'nothing'), null);
  assert.equal(featureBoundsFromSpatial([], 'm', '7'), null);
  assert.equal(featureBoundsFromSpatial(null, 'm', '7'), null);
});

test('the feature index frames a feature by tile id or name from its centre and area', () => {
  const item = INDEX.items.find((row) => row.name === 'BELFAST WEST');
  assert.ok(item, 'Belfast West is in the feature index');
  const byId = featureBoundsFromIndex(INDEX, item.id, null);
  const byName = featureBoundsFromIndex(INDEX, 'BELFAST WEST', 'BELFAST WEST');
  assert.ok(inBelfast(byId) && small(byId), JSON.stringify(byId));
  assert.deepEqual(byName, byId);
  assert.equal(featureBoundsFromIndex(INDEX, 'ATLANTIS', 'ATLANTIS'), null);
  assert.equal(featureBoundsFromIndex(null, '1'), null);
});

test('parts of one feature are framed together; same-named features far apart are not', () => {
  const parts = [{ name: 'Rathlin', bbox: [-6.3, 55.27, -6.15, 55.31] }, { name: 'rathlin', bbox: [-6.25, 55.28, -6.2, 55.3] }];
  assert.deepEqual(featureBoundsFromSpatial(parts, 'm', 'Rathlin'), [-6.3, 55.27, -6.15, 55.31]);
  const apart = [{ name: 'Ballymore', bbox: [-10, 52, -9.9, 52.1] }, { name: 'Ballymore', bbox: [-6, 55, -5.9, 55.1] }];
  assert.equal(featureBoundsFromSpatial(apart, 'm', 'Ballymore'), null);
  assert.equal(sameFeature(null), null);
});

test('a box around a centre is at least 1.5 km and grows with the area', () => {
  const point = bboxAround([-5.93, 54.6], undefined);
  const km = (box) => (box[3] - box[1]) * 111.32;
  assert.ok(Math.abs(km(point) - 1.5) < 0.01, String(km(point)));
  const county = bboxAround([-6.5, 54.5], 2_800_000_000);   // about Tyrone's 3,266 km2
  assert.ok(km(county) > 100 && km(county) < 110, String(km(county)));
  assert.equal(bboxAround(null, 1), null);
  assert.equal(bboxAround([0, 95], 1), null);
});

test('validBbox refuses what fitBounds could not use', () => {
  assert.deepEqual(validBbox(['1', 2, 3, 4]), [1, 2, 3, 4]);
  assert.equal(validBbox([3, 2, 1, 4]), null);
  assert.equal(validBbox([1, 2, 3]), null);
  assert.equal(validBbox([1, 2, 3, Number.NaN]), null);
});
