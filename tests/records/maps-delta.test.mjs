// Data design phase 3: the maps tables in the delta. The first load after migration 0003 diffs
// against a last-loaded snapshot that has none of them (every row inserted, nothing deleted), and
// adding one map or layer later changes about one row (stable sort keys, e079b0390b).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../../scripts/records/db.mjs';
import { buildDelta } from '../../scripts/records/diff-load.mjs';
import { ingestMaps } from '../../scripts/records/ingest-maps.mjs';
import { stabiliseOrder } from '../../scripts/records/stable-order.mjs';
import { TABLES } from '../../scripts/records/schema.mjs';
import { deltaKeys } from '../../scripts/records/verify-load.mjs';

const MAP_TABLES = TABLES.filter((t) => t.group === 'maps').map((t) => t.name);

function root(maps, layers) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-maps-root-'));
  mkdirSync(path.join(dir, 'data', 'database'), { recursive: true });
  mkdirSync(path.join(dir, 'render', 'metadata'), { recursive: true });
  writeFileSync(path.join(dir, 'data', 'database', 'maps.json'), `${JSON.stringify({ categories: [], maps }, null, 2)}\n`);
  writeFileSync(path.join(dir, 'render', 'metadata', 'maps-test.json'), `${JSON.stringify({ version: 1, layers, publicMapCount: layers.length }, null, 2)}\n`);
  return dir;
}

function build(dir, file, seed = null) {
  const db = createDatabase(file);
  ingestMaps(db, { root: dir });
  if (seed) stabiliseOrder(db, seed);
  db.close();
  return file;
}

const maps = (ids) => ids.map((id) => ({ id, slug: id, name: id.toUpperCase(), category: 'c' }));
const layers = (ids) => ids.map((id) => ({ id: `${id}-vector-test`, sourceMapId: id }));

test('a snapshot without the phase-3 tables: the delta inserts them whole and deletes nothing', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'civgraph-maps-delta-'));
  const dir = root(maps(['a', 'b', 'c']), layers(['a', 'b']));
  const to = build(dir, path.join(tmp, 'to.sqlite'));
  const from = path.join(tmp, 'from.sqlite');
  const old = createDatabase(from);
  for (const t of MAP_TABLES) old.exec(`DROP TABLE ${t}`);
  old.close();
  const lines = [];
  const { summary } = buildDelta({ toFile: to, fromFile: from, write: (s) => lines.push(s) });
  assert.deepEqual(summary.maps, { deleted: 0, upserted: 3 });
  assert.deepEqual(summary.layers, { deleted: 0, upserted: 2 });
  assert.equal(summary.layer_aliases.upserted, 2);
  assert.ok(!lines.some((l) => /^DELETE FROM (maps|layers)\b/.test(l)));
  // The bounded verify plans from the same comparison.
  const db = new DatabaseSync(to, { readOnly: true });
  db.exec(`ATTACH DATABASE '${from.replace(/'/g, "''")}' AS f`);
  const keys = deltaKeys(db);
  db.close();
  assert.equal(keys.maps.upserted.length, 3);
  assert.equal(keys.maps.deleted.length, 0);
});

test('adding one map and one layer changes about one row each (stable sort keys)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'civgraph-maps-order-'));
  const ids = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`);
  const first = build(root(maps(ids), layers(ids)), path.join(tmp, 'first.sqlite'));
  const more = [...ids.slice(0, 5), 'new-map', ...ids.slice(5)];
  const second = build(root(maps(more), layers(more)), path.join(tmp, 'second.sqlite'), first);
  const { summary } = buildDelta({ toFile: second, fromFile: first, write: () => {} });
  assert.deepEqual(summary.maps, { deleted: 0, upserted: 1 });
  assert.deepEqual(summary.layers, { deleted: 0, upserted: 1 });
  const db = new DatabaseSync(second, { readOnly: true });
  assert.deepEqual(db.prepare('SELECT map_id FROM maps ORDER BY ord, map_id').all().map((r) => r.map_id), more, 'source order kept');
  db.close();
});
