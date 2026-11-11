import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapDate } from '../../src/catalogue/util.js';

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
  assert.deepEqual([roscommon.date, roscommon.dateKind], ['2026-04-26', 'as-at']);
  assert.match(national.dateNote, /ETL\) of 20 Apr 2026/);
  assert.match(roscommon.dateNote, /up to 23 Apr 2026/);
  // Only these two are dated this way (the others are listed for the owner, not changed).
  assert.deepEqual(maps.filter((m) => m.dateKind).map((m) => m.id).sort(), [roscommon.id, national.id].sort());
});
