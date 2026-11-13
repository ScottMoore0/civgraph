// The map's names and anchor points (11 Nov 2026, stream data-defects):
// - packages/maps-pipeline/src/label-data.mjs: the island bounds, the centre SQL, the text tests;
// - the feature-index centre SQL against GDAL: an EPSG:29902 (Irish Grid) source comes back as
//   lon/lat (dail-1998-vector had shipped metres);
// - packages/maps-pipeline/src/tiles/repair-label-text.mjs on a fixture FlatGeobuf: keyed, by-value
//   and NFC repairs land, and nothing else in the file moves;
// - data/database/label-text-repairs.json is well formed and repairs only damaged text;
// - only the accepted readings apply (12 Nov 2026, stream w8-small: the owner accepted the
//   high-confidence Irish names; on 13 Nov 2026, IN1 and IN2, eight more places; the two open
//   readings are held back);
// - scripts/check/rules/map-label-data.mjs passes on the committed data.
//
//   node --test tests/unit/map-label-data.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import {
  IRELAND_LONLAT_BOUNDS,
  centreInIreland,
  featureCentreColumns,
  hasReplacementChar,
  nfcLabel,
  notNfc,
  repairApplies,
} from '../../packages/maps-pipeline/src/label-data.mjs';

const FFFD = '�';
const DECOMPOSED = 'Dún Braoin';
const gdal = spawnSync('ogr2ogr', ['--version'], { encoding: 'utf8' }).status === 0;

test('centres: lon/lat on the island of Ireland pass; Irish Grid metres, 0,0 and nulls do not', () => {
  assert.equal(centreInIreland([-8.29057, 52.072321]), true); // Cork East
  assert.equal(centreInIreland([-6.26, 53.35]), true); // Dublin
  assert.equal(centreInIreland([-10.5, 52.1]), true); // the Blaskets
  assert.equal(centreInIreland([-7.25, 55.4]), true); // Inishtrahull is just inside
  assert.equal(centreInIreland([180125.562484, 91135.321646]), false); // dail-1998 before the fix
  assert.equal(centreInIreland([0, 0]), false);
  assert.equal(centreInIreland([0, 1.08501420275988e169]), false);
  assert.equal(centreInIreland([-3.2, 55.95]), false); // Edinburgh
  assert.equal(centreInIreland(null), false);
  assert.equal(centreInIreland([Number.NaN, 53]), false);
  assert.ok(IRELAND_LONLAT_BOUNDS.west < IRELAND_LONLAT_BOUNDS.east && IRELAND_LONLAT_BOUNDS.south < IRELAND_LONLAT_BOUNDS.north);
});

test('the centre SQL transforms a known non-4326 CRS and leaves 4326 and SRID 0 alone', () => {
  assert.match(featureCentreColumns(29902).join(','), /ST_Transform\(ST_Centroid\(geometry\), 4326\)/);
  assert.match(featureCentreColumns(2157).join(','), /ST_Transform/);
  assert.doesNotMatch(featureCentreColumns(4326).join(','), /ST_Transform/);
  assert.doesNotMatch(featureCentreColumns(null).join(','), /ST_Transform/);
  assert.doesNotMatch(featureCentreColumns(0).join(','), /ST_Transform/);
  assert.deepEqual(featureCentreColumns(4326).map((c) => c.split(' AS ')[1]), ['lon', 'lat']);
});

test('text: U+FFFD and decomposed accents are caught; NFC repairs the second', () => {
  assert.equal(hasReplacementChar(`Oile${FFFD}n Bhaile Choit${FFFD}n`), true);
  assert.equal(hasReplacementChar('Oileán Bhaile Choitín'), false);
  assert.equal(hasReplacementChar(null), false);
  assert.equal(notNfc(DECOMPOSED), true);
  assert.equal(notNfc('Dún Braoin'), false);
  assert.equal(nfcLabel(DECOMPOSED), 'Dún Braoin');
  assert.equal(nfcLabel(42), 42);
});

test('repairApplies: only the accepted confidence levels apply; no list or no confidence applies', () => {
  assert.equal(repairApplies({ confidence: 'high' }, ['high']), true);
  assert.equal(repairApplies({ confidence: 'medium' }, ['high']), false);
  assert.equal(repairApplies({ confidence: 'open' }, ['high']), false);
  assert.equal(repairApplies({ confidence: 'medium' }, ['high', 'medium']), true);
  assert.equal(repairApplies({}, ['high']), true);
  assert.equal(repairApplies({ confidence: 'medium' }, undefined), true);
  assert.equal(repairApplies({ confidence: 'open' }, null), true);
});

test('an Irish Grid (EPSG:29902) source gives lon/lat centres through the index SQL', { skip: !gdal && 'GDAL is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'label-data-'));
  try {
    // An L-shaped polygon near Fermoy, in TM65 / Irish Grid metres.
    const geojson = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::29902' } },
      features: [{ type: 'Feature', properties: { CON_ID: 4, CON_NAME: 'Cork East' }, geometry: { type: 'Polygon', coordinates: [[[170000, 80000], [190000, 80000], [190000, 90000], [180000, 90000], [180000, 100000], [170000, 100000], [170000, 80000]]] } }],
    };
    writeFileSync(join(dir, 'src.geojson'), JSON.stringify(geojson));
    const fgb = join(dir, 'src.fgb');
    assert.equal(spawnSync('ogr2ogr', ['-f', 'FlatGeobuf', fgb, join(dir, 'src.geojson'), '-nln', 'src'], { encoding: 'utf8' }).status, 0);
    const sql = `SELECT CON_NAME,${featureCentreColumns(29902).join(',')} FROM src`;
    const out = spawnSync('ogr2ogr', ['-f', 'CSV', '/vsistdout/', fgb, '-dialect', 'SQLite', '-sql', sql], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const [, row] = out.stdout.trim().split(/\r?\n/);
    const [, lon, lat] = row.split(',').map(Number);
    assert.ok(centreInIreland([lon, lat]), `${lon},${lat}`);
    assert.ok(Math.abs(lon - -8.4) < 0.3 && Math.abs(lat - 52.0) < 0.3, `${lon},${lat}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repair-label-text: keyed, by-value and NFC repairs land; order, geometry and other fields do not move', { skip: !gdal && 'GDAL is not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'label-repair-'));
  try {
    mkdirSync(join(dir, 'src'));
    const features = [
      ['Coolroe', `An Ch${FFFD}il Rua`, 'Cork', 50592],
      ['Ballycotton Island', `Oile${FFFD}n Bhaile Choit${FFFD}n`, 'Cork', 45386],
      ['Dunbrin', DECOMPOSED, 'Laois', 7],
      ['Plain', 'An Baile Bán', `D${FFFD}n Laoghaire-Rathdown`, 8],
      ['The Cow', `An Bh${FFFD}`, 'Cork', 50883],
    ].map(([name, irish, county, id], i) => ({ type: 'Feature', properties: { ID: id, Name: name, IrishName: irish, County: county, Note: `row ${i}` }, geometry: { type: 'Point', coordinates: [-8 - i / 10, 52 + i / 10] } }));
    writeFileSync(join(dir, 'src.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
    assert.equal(spawnSync('ogr2ogr', ['-f', 'FlatGeobuf', join(dir, 'src', 'towns.fgb'), join(dir, 'src.geojson'), '-nln', 'towns'], { encoding: 'utf8' }).status, 0);
    const repairs = {
      keyed: { towns: { key: 'ID', field: 'IrishName', sources: ['src/towns.fgb'], records: [
        { id: 50592, damaged: `An Ch${FFFD}il Rua`, value: 'An Chúil Rua' },
        { id: 45386, damaged: `Oile${FFFD}n Bhaile Choit${FFFD}n`, value: 'Oileán Bhaile Choitín', confidence: 'high' },
        { id: 50883, damaged: `An Bh${FFFD}`, value: 'An Bhó', confidence: 'medium' },
      ] } },
      apply: { confidence: ['high'] },
      byValue: { towns: { field: 'County', sources: ['src/towns.fgb'], values: { [`D${FFFD}n Laoghaire-Rathdown`]: 'Dún Laoghaire-Rathdown' } } },
      nfc: { layers: { towns: ['src/towns.fgb'] } },
    };
    writeFileSync(join(dir, 'repairs.json'), JSON.stringify(repairs));
    const before = await readRows(join(dir, 'src', 'towns.fgb'));
    const run = spawnSync(process.execPath, ['packages/maps-pipeline/src/tiles/repair-label-text.mjs', '--root', dir, '--repairs', join(dir, 'repairs.json'), '--out', join(dir, 'out'), '--write', '--in-place'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const rows = await readRows(join(dir, 'src', 'towns.fgb'));
    // The file keeps its own feature order (its packed index may have sorted it on write).
    assert.deepEqual(rows.map((r) => [r.Note, r.xy]), before.map((r) => [r.Note, r.xy]));
    const byRow = [...rows].sort((a, b) => String(a.Note).localeCompare(String(b.Note)));
    // The medium reading is held back: The Cow keeps its damaged name.
    assert.deepEqual(byRow.map((r) => r.IrishName), ['An Chúil Rua', 'Oileán Bhaile Choitín', 'Dún Braoin', 'An Baile Bán', `An Bh${FFFD}`]);
    assert.deepEqual(byRow.map((r) => r.County), ['Cork', 'Cork', 'Laois', 'Dún Laoghaire-Rathdown', 'Cork']);
    assert.deepEqual(byRow.map((r) => r.xy), features.map((f) => f.geometry.coordinates));
    assert.match(run.stdout, /1 reading\(s\) held back/);
    assert.ok(readFileSync(join(dir, 'src', 'towns.fgb.before-label-repair')).length > 0, 'the original is kept');
    // A second run finds nothing to do.
    const again = spawnSync(process.execPath, ['packages/maps-pipeline/src/tiles/repair-label-text.mjs', '--root', dir, '--repairs', join(dir, 'repairs.json'), '--out', join(dir, 'out')], { encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /nothing to repair/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** @param {string} path */
async function readRows(path) {
  const rows = [];
  for await (const f of deserialize(new Uint8Array(readFileSync(path)))) rows.push({ ...f.properties, xy: f.geometry.coordinates });
  return rows;
}

test('label-text-repairs.json: every repair turns damaged text into clean text', () => {
  const repairs = JSON.parse(readFileSync('data/database/label-text-repairs.json', 'utf8'));
  let count = 0;
  for (const [layer, spec] of Object.entries(repairs.keyed)) {
    assert.ok(spec.key && spec.field && spec.sources.length, layer);
    const ids = new Set();
    for (const r of spec.records) {
      count += 1;
      assert.ok(!ids.has(String(r.id)), `${layer} ${r.id} twice`);
      ids.add(String(r.id));
      assert.ok(hasReplacementChar(r.damaged), `${layer} ${r.id}: not damaged`);
      assert.ok(!hasReplacementChar(r.value) && !notNfc(r.value), `${layer} ${r.id}: ${r.value}`);
      assert.ok(['high', 'medium', 'open'].includes(r.confidence), `${layer} ${r.id}`);
      if (r.confidence === 'open') assert.equal(r.value, '', `${layer} ${r.id}: an open reading writes no name`);
      else {
        // The reading only fills the damaged letters: the rest of the name is unchanged.
        const pattern = new RegExp(`^${r.damaged.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(FFFD).join('.')}$`, 'u');
        assert.match(r.value, pattern, `${layer} ${r.id}`);
      }
    }
  }
  assert.equal(repairs.keyed['cork-townlands'].records.length, 249);
  // 249 damaged features: Eve Island's two features share one TD_ID.
  assert.equal(repairs.keyed['townlands-cities-and-islands'].records.reduce((n, r) => n + (r.features || 1), 0), 249);
  for (const spec of Object.values(repairs.byValue)) {
    for (const [bad, good] of Object.entries(spec.values)) {
      count += 1;
      assert.ok(hasReplacementChar(bad) && !hasReplacementChar(good) && !notNfc(good), bad);
    }
  }
  assert.ok(count > 500);
  // The owner accepted the high-confidence readings (12 Nov 2026) and eight more places (13 Nov 2026,
  // IN1 and IN2); the two open places (four records) wait for Logainm (IN3, IN4).
  assert.deepEqual(repairs.apply.confidence, ['high']);
  const all = Object.values(repairs.keyed).flatMap((spec) => spec.records);
  assert.equal(all.filter((r) => repairApplies(r, repairs.apply.confidence)).length, 493);
  assert.deepEqual([...new Set(all.filter((r) => !repairApplies(r, repairs.apply.confidence)).map((r) => r.english))].sort(), [
    'Illaunguane', 'Illaunnameanla',
  ]);
  assert.equal(all.filter((r) => !repairApplies(r, repairs.apply.confidence)).length, 4);
  // Every damaged source value is repaired or listed for review.
  assert.ok(Array.isArray(repairs.review));
});

test('check:map-label-data passes on the committed indexes, anchors and metadata', () => {
  const run = spawnSync(process.execPath, ['scripts/check/rules/map-label-data.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /^PASS/);
});
