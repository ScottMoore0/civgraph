// What a map label says and where it sits (styling plan OT22, approved 21 and 23 Nov 2026):
// title case at display time, the Irish second line, label points and their build's pieces.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bilingualLines,
  indexLabelPoints,
  labelCollisionBox,
  resolveLabelPointsUrl,
  titleCaseCaps
} from '@civgraph/map/renderer/label-text.mjs';
import { getFeatureLabel, getLabelLines, getLabelStyle, irishSecondLineField } from '@civgraph/map/renderer/labels.js';
import { boundaryLevelOf } from '@civgraph/maps-pipeline/boundary-levels.mjs';
import { labelPointColumns } from '@civgraph/maps-pipeline/label-data.mjs';
import { SITE } from '@civgraph/config';

test('an all-caps name is drawn in title case (the styling plan samples)', () => {
  const samples = {
    'MALONE UPPER (MAIN PORTION)': 'Malone Upper (Main Portion)',
    'GRANGE OF SHILVODAN': 'Grange of Shilvodan',
    'BELFAST CB': 'Belfast CB',
    'DROMORE III': 'Dromore III',
    "ST. ANNE'S": "St. Anne's",
    'BAILE NA NGALL': 'Baile na nGall',
    'NA HÁIRNEACHA': 'Na hÁirneacha',
    'ÁTHA AN TSLÉIBHE': 'Átha an tSléibhe',
    'MCCLEAN': 'McClean',
    "O'NEILL": "O'Neill",
    'DUBLIN NO. 2': 'Dublin No. 2',
    'KILLEA-ROSS': 'Killea-Ross'
  };
  for (const [caps, wanted] of Object.entries(samples)) assert.equal(titleCaseCaps(caps), wanted, caps);
});

test('a name with any lower case, a number alone or nothing is left as it is', () => {
  for (const value of ['Malone Upper', 'McVicker', 'Dún Laoghaire No. 2', '12', '', 'ÁTHA an tSLÉIBHE']) assert.equal(titleCaseCaps(value), value);
  assert.equal(titleCaseCaps(null), '');
  assert.equal(titleCaseCaps(undefined), '');
});

test('the Irish name is a second line only when it says something else, and never broken', () => {
  assert.deepEqual(bilingualLines('BALLYBOUGH', 'AN BAILE BOCHT'), { primary: 'Ballybough', secondary: 'An Baile Bocht' });
  assert.deepEqual(bilingualLines('Ballybough', 'An Baile Bocht'), { primary: 'Ballybough', secondary: 'An Baile Bocht' });
  assert.deepEqual(bilingualLines('Inishmore', 'inishmore'), { primary: 'Inishmore', secondary: '' });
  assert.deepEqual(bilingualLines('Skeam West', 'Sc�im Thiar'), { primary: 'Skeam West', secondary: '' }, 'a lost fada is not drawn');
  assert.deepEqual(bilingualLines('', 'An Spidéal'), { primary: 'An Spidéal', secondary: '' });
  assert.equal(bilingualLines('Ennis', 'Iniś').secondary, 'Iniś'.normalize('NFC'), 'NFC');
});

test('label points are read as id -> point and area, skipping broken features', () => {
  const points = indexLabelPoints({
    features: [
      { properties: { id: 7, area_m2: 1200 }, geometry: { coordinates: [-6.26, 53.35] } },
      { properties: { id: 'A1' }, geometry: { coordinates: [-7, 54] } },
      { properties: { id: null }, geometry: { coordinates: [-7, 54] } },
      { properties: { id: 'bad' }, geometry: { coordinates: ['x', 54] } },
      { properties: { id: 'none' }, geometry: null }
    ]
  });
  assert.deepEqual([...points.keys()], ['7', 'A1']);
  assert.deepEqual(points.get('7'), { lngLat: [-6.26, 53.35], area: 1200 });
  assert.equal(points.get('A1')?.area, 0);
  assert.equal(indexLabelPoints(null).size, 0);
});

test('a label-point file is fetched from the data origin, through /_r/ on localhost', () => {
  const url = `${SITE.dataOrigin}/data/maps/labels/dail-2023-vector.labels.geojson`;
  assert.equal(resolveLabelPointsUrl({ labelPointsUrl: url }, { hostname: 'civgraph.net', origin: 'https://civgraph.net' }), url);
  assert.equal(resolveLabelPointsUrl({ labelPointsUrl: url }, { hostname: 'localhost', origin: 'http://localhost:5190' }),
    'http://localhost:5190/_r/data/maps/labels/dail-2023-vector.labels.geojson');
  assert.equal(resolveLabelPointsUrl({}, null), '');
  assert.equal(resolveLabelPointsUrl({ labelPointsUrl: '/relative' }, null), '');
});

test('a two-line label takes more room than one line', () => {
  const one = labelCollisionBox({ x: 100, y: 100 }, 'Ballybough');
  const two = labelCollisionBox({ x: 100, y: 100 }, 'Ballybough', 'An Baile Bocht');
  assert.ok(two.bottom - two.top > one.bottom - one.top);
  assert.ok(two.right - two.left >= one.right - one.left);
  assert.equal(one.left + one.right, 200, 'centred');
});

test('map labels: title case on the drawn label only, and the Irish line only with the language control on', () => {
  const layer = { id: 'test-townlands-vector', labelProperty: 'ENG_NAME_VALUE' };
  const props = { ENG_NAME_VALUE: 'BALLYBOUGH', GLE_NAME_VALUE: 'AN BAILE BOCHT' };
  const saved = globalThis.civgraphI18n;
  try {
    delete globalThis.civgraphI18n;
    assert.equal(irishSecondLineField(layer), null, 'no language control: no Irish');
    assert.deepEqual(getLabelLines(layer, props), { primary: 'Ballybough', secondary: '' });
    assert.equal(getFeatureLabel(layer, props), 'BALLYBOUGH', 'the official form elsewhere');
    // The control turned on (the runtime is loaded), interface in English: the Irish second line.
    globalThis.civgraphI18n = { placeNameField: () => null, irishNameField: () => 'GLE_NAME_VALUE' };
    assert.deepEqual(getLabelLines(layer, props), { primary: 'Ballybough', secondary: 'An Baile Bocht' });
    // Interface in Irish: the Irish name alone, as before.
    globalThis.civgraphI18n = { placeNameField: () => 'GLE_NAME_VALUE', irishNameField: () => 'GLE_NAME_VALUE' };
    assert.deepEqual(getLabelLines(layer, props), { primary: 'An Baile Bocht', secondary: '' });
  } finally {
    if (saved === undefined) delete globalThis.civgraphI18n; else globalThis.civgraphI18n = saved;
  }
});

test('on a dark base map the halo is dark and the label colour is lightened against it', () => {
  const layer = { id: 'x', style: { color: '#1f3a93' }, labelStyle: { haloColor: '#ffffff' } };
  const light = getLabelStyle(layer);
  const dark = getLabelStyle(layer, null, { darkBase: true });
  assert.equal(light.haloColor, '#ffffff');
  assert.equal(light.color, '#1f3a93');
  assert.equal(dark.haloColor, '#111111');
  assert.notEqual(dark.color, '#1f3a93', 'a dark blue is lightened on a dark halo');
});

test('boundary levels follow the styling plan registry rules', () => {
  const cases = {
    'dail-2023-vector': 'district',
    'antrim-townlands-vector': 'townland',
    'district-electoral-divisions-boundaries-vector': 'ward',
    'counties-ireland-vector': 'county',
    'provinces-vector': 'province',
    'roi-small-areas-2022-vector': 'small-area',
    'plu-1911-vector': 'district',
    'npws-special-areas-of-conservation-vector': 'other'
  };
  for (const [id, level] of Object.entries(cases)) assert.equal(boundaryLevelOf({ id }), level, id);
  assert.equal(boundaryLevelOf({ id: 'something-new-vector', category: 'Townlands' }), 'townland', 'by category');
  assert.equal(boundaryLevelOf({}), 'other');
});

test('label-point SQL: point on surface of the joined pieces, in lon/lat, with a geodesic area', () => {
  const [area, point] = labelPointColumns(29902);
  assert.match(point, /^ST_PointOnSurface\(ST_Union\(ST_Transform\(ST_MakeValid\(geometry\), 4326\)\)\) AS geometry$/);
  assert.match(area, /^SUM\(ST_Area\(ST_Transform\(ST_MakeValid\(geometry\), 4326\), 1\)\) AS area_m2$/);
  assert.match(labelPointColumns(4326)[1], /ST_Union\(ST_MakeValid\(geometry\)\)/);
  assert.equal(labelPointColumns(null)[0], '0 AS area_m2', 'an SRID-0 source cannot be measured');
});
