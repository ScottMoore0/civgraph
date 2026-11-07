// The approximate-boundary patch (boundary audit, 7 Nov 2026): every edition that carries
// approximateSegments is a drawn edition whose segment file is named after its own FGB, the editions
// sharing a file agree, the render records and the startup index carry the same field, and the
// renderer's helpers resolve and label the segments. Local segment files, when present (data/maps is
// gitignored), must match the counts the catalogue states.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  APPROXIMATE_REASONS, approximateSegmentIds, approximateSegmentLabel, resolveApproximateSegmentsUrl
} from '../../src/map/renderer/approximate-segments.js';

const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps;
const render = JSON.parse(readFileSync('render/metadata/maps-test.json', 'utf8')).layers;
const index = JSON.parse(readFileSync('render/metadata/maps-test-index.json', 'utf8'));
const indexLayers = Array.isArray(index) ? index : (index.layers || []);
const withSegments = maps.filter((m) => m.approximateSegments);
const fileOf = (m) => String(m.files?.fgb || '').split('?')[0].split('/').pop();

test('the audited editions carry approximateSegments', () => {
  const ids = new Set(withSegments.map((m) => m.id));
  for (const id of ['stormont-1969', 'admin-areas-1956-04-01', 'admin-areas-1967-04-01', 'admin-areas-1966-07-04',
    'admin-areas-1946-06-11', 'admin-areas-1938-04-01', 'ded-1939-04-01', 'lgd-1991-provisional']) {
    assert.ok(ids.has(id), `${id} has approximateSegments`);
  }
  // Editions on the published 1 Apr 1930 line, or taken whole from a source, have none.
  for (const id of ['admin-areas-1930-04-01', 'admin-areas-1921-05-03', 'stormont-1929', 'deas-1992-provisional', 'lgd-1993']) {
    assert.ok(!ids.has(id), `${id} has no approximateSegments`);
  }
});

test('each patch entry is well formed and named after its own file', () => {
  for (const m of withSegments) {
    const a = m.approximateSegments;
    const stem = fileOf(m).replace(/\.fgb$/, '');
    assert.ok(stem, `${m.id} draws a file`);
    assert.equal(a.url, `https://data.civgraph.net/data/maps/approximate/${stem}-approximate.geojson`, m.id);
    assert.ok(Number.isInteger(a.count) && a.count > 0, `${m.id} count`);
    assert.ok(typeof a.totalKm === 'number' && a.totalKm > 0, `${m.id} totalKm`);
    assert.match(a.note, /^Some lines on this map are approximate: .+\.$/, `${m.id} note`);
    assert.doesNotMatch(a.note, /PRONI viewer|iPhone|notes scan|overlay/i, `${m.id} note cites no private material`);
  }
});

test('editions that share a file share its approximateSegments', () => {
  const byFile = new Map();
  for (const m of maps) {
    const f = fileOf(m);
    if (!f) continue;
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(m);
  }
  for (const [f, group] of byFile) {
    const values = new Set(group.map((m) => JSON.stringify(m.approximateSegments || null)));
    assert.equal(values.size, 1, `${f}: ${group.map((m) => m.id).join(', ')}`);
  }
});

test('the render records and the startup index carry the same field', () => {
  const byId = new Map(maps.map((m) => [m.id, m]));
  let checked = 0;
  for (const layer of render) {
    const map = byId.get(layer.sourceMapId);
    if (!map) continue;
    assert.deepEqual(layer.approximateSegments ?? null, map.approximateSegments ?? null, layer.id);
    if (map.approximateSegments) checked += 1;
  }
  assert.ok(checked >= withSegments.length - 1, `render layers checked: ${checked}`);
  for (const layer of indexLayers) {
    const map = byId.get(layer.sourceMapId);
    if (map?.approximateSegments) assert.deepEqual(layer.approximateSegments, map.approximateSegments, `index ${layer.id}`);
  }
});

test('local segment files match the stated counts', { skip: !existsSync('data/maps/approximate') }, () => {
  for (const m of withSegments) {
    const local = `data/maps/approximate/${m.approximateSegments.url.split('/').pop()}`;
    if (!existsSync(local)) continue;
    const fc = JSON.parse(readFileSync(local, 'utf8'));
    assert.equal(fc.features.length, m.approximateSegments.count, local);
    const km = fc.features.reduce((s, f) => s + Number(f.properties.length_m || 0), 0) / 1000;
    assert.ok(Math.abs(km - m.approximateSegments.totalKm) < 0.02, `${local} ${km} km`);
    for (const f of fc.features) {
      assert.equal(f.geometry.type, 'LineString', local);
      assert.ok(APPROXIMATE_REASONS.includes(f.properties.reason), `${local} reason ${f.properties.reason}`);
      assert.ok(f.properties.label, local);
    }
  }
});

test('the renderer helpers resolve the url and label a segment', () => {
  const layer = { id: 'x-vector', approximateSegments: { url: 'https://data.civgraph.net/data/maps/approximate/a-approximate.geojson' } };
  assert.equal(resolveApproximateSegmentsUrl(layer, { hostname: 'civgraph.net', origin: 'https://civgraph.net' }), layer.approximateSegments.url);
  assert.equal(resolveApproximateSegmentsUrl(layer, { hostname: 'localhost', origin: 'http://localhost:5050' }),
    'http://localhost:5050/_r/data/maps/approximate/a-approximate.geojson');
  assert.equal(resolveApproximateSegmentsUrl({ id: 'y' }), '');
  assert.equal(resolveApproximateSegmentsUrl({ approximateSegments: { url: 'javascript:alert(1)' } }), '');
  assert.deepEqual(approximateSegmentIds('x'), { sourceId: 'x-approx-source', gapId: 'x-approx-gap', lineId: 'x-approx', hitId: 'x-approx-hit' });
  assert.equal(approximateSegmentLabel({ label: 'Traced; may be out by about 25 m.' }), 'Traced; may be out by about 25 m.');
  assert.equal(approximateSegmentLabel({ reason: 'map-line-~150m', uncertainty_m: 150 }), 'Cut along the line of a small-scale map; may be out by about 150 m.');
});
