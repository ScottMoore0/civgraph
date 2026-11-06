// The migrations and scripts/records/schema.mjs describe the same database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLES, schemaSql } from '../../scripts/records/schema.mjs';
import { REPO_ROOT } from '../../scripts/records/paths.mjs';

const MIGRATIONS = path.join(REPO_ROOT, 'migrations');

function migrated() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

test('0001 is exactly what schema.mjs generates', () => {
  assert.equal(readFileSync(path.join(MIGRATIONS, '0001_records.sql'), 'utf8'), schemaSql());
});

test('every table in schema.mjs exists after the migrations, with its columns in order', () => {
  const db = migrated();
  for (const t of TABLES) {
    const cols = db.prepare(`SELECT name, pk FROM pragma_table_info('${t.name}')`).all();
    assert.deepEqual(cols.map((col) => col.name), t.columns.map((col) => col.name), t.name);
    const pk = cols.filter((col) => col.pk > 0).sort((a, b) => a.pk - b.pk).map((col) => col.name);
    assert.deepEqual(pk, t.pk, `${t.name} primary key`);
    if (t.hashed) assert.ok(t.columns.some((col) => col.name === 'row_hash_n'), `${t.name} row_hash_n`);
  }
});

test('the migrations create none of the live table names', () => {
  const live = ['elections', 'constituencies', 'candidates', 'counts', 'constituency_animation', 'constituency_features', 'browse_persons', 'browse_sources', 'browse_register_interests'];
  const names = new Set(TABLES.map((t) => t.name));
  for (const name of live) assert.ok(!names.has(name), name);
});
