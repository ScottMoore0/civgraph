import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapDate } from '../../packages/map/src/catalogue/util.js';

// Live planning layers are dated by the snapshot Civgraph holds, shown "as at <date>" (owner, 11 Nov 2026).

test('a snapshot date reads "as at <date>"; other dates read as before', () => {
  assert.equal(mapDate({ date: '2026-04-20', dateAsAt: true }), 'as at 20 Apr 2026');
  assert.equal(mapDate({ date: '2026-04-20' }), '20 Apr 2026');
  assert.equal(mapDate({ date: '1977-01-01', id: 'eds-1977' }), '1977');
  assert.equal(mapDate({ date: '', dateAsAt: true }), '');
});

test('the two planning maps carry their snapshot dates in maps.json', () => {
  const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps;
  const byId = new Map(maps.map((m) => [m.id, m]));
  const national = byId.get('roi-national-planning-applications');
  const roscommon = byId.get('oda-map-00115-planning-application-boundaries-roscommon');
  assert.deepEqual([national.date, national.dateKind], ['2026-04-20', 'as-at']);
  assert.deepEqual([roscommon.date, roscommon.dateKind], ['2026-07-08', 'as-at']);
  assert.match(national.dateNote, /ETL\) of 20 Apr 2026/);
  assert.match(roscommon.dateNote, /downloaded 8 Jul 2026/);
  // The live layer is the 8 Jul 2026 fetch, not the April download (owner, 13 Nov 2026).
  for (const path of ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json']) {
    const layer = JSON.parse(readFileSync(path, 'utf8')).layers.find((l) => l.id === 'oda-map-00115-planning-application-boundaries-roscommon-vector');
    assert.equal(layer.date, '2026-07-08', path);
  }
});

test('eleven more live layers are dated as at their snapshot (owner, 13 Nov 2026, OT17)', () => {
  const maps = JSON.parse(readFileSync('data/database/maps.json', 'utf8')).maps;
  const byId = new Map(maps.map((m) => [m.id, m]));
  // The date of the data as fetched: the download, or the data's own date where it states one.
  const expected = {
    'oda-map-00300-planning-application-points-roscommon': '2026-07-08',
    'oda-map-00303-westmeath-planning-applications': '2026-07-08',
    'oda-map-00302-planning-register': '2026-07-08',
    'oda-map-00221-eia-location-point': '2026-07-08',
    'dlr-derelict-sites-register': '2026-04-26',
    'dlr-public-ev-charging-points': '2026-04-26',
    'dlr-dlr-residential-land-availability': '2026-04-26',
    'roads-pothole-enquiries': '2018-03-31',
    'ni-licensed-waste-facilities': '2026-06-30',
    'gsni-core-cuttings-register': '2026-04-25',
    'ni-mineral-prospecting-licences': '2025-09-30',
  };
  for (const [id, date] of Object.entries(expected)) {
    const m = byId.get(id);
    assert.deepEqual([m.date, m.dateKind], [date, 'as-at'], id);
    assert.ok(m.dateNote && m.dateNote.length <= 300, id);
  }
  assert.match(byId.get('roads-pothole-enquiries').dateNote, /1 Apr 2017 to 31 Mar 2018/);
  assert.match(byId.get('ni-mineral-prospecting-licences').dateNote, /published 30 Sep 2025/);
  // Only these thirteen are dated this way.
  assert.deepEqual(maps.filter((m) => m.dateKind).map((m) => m.id).sort(), [
    'oda-map-00115-planning-application-boundaries-roscommon', 'roi-national-planning-applications', ...Object.keys(expected),
  ].sort());
  // The render record and the app's layer index carry the same date.
  for (const path of ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json']) {
    const layers = new Map(JSON.parse(readFileSync(path, 'utf8')).layers.map((l) => [l.id, l]));
    for (const [id, date] of Object.entries(expected)) assert.equal(layers.get(`${id}-vector`).date, date, `${path} ${id}`);
  }
});
