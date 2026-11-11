/**
 * The small records database for tests: the tables of packages/schema/src/schema.mjs, created
 * in memory, filled from records-mini.jsonl (written by ./build-records-mini.mjs from a records
 * build). It is a coherent slice of real public record data: one election with its contests,
 * candidates and their persons, a division, parties, sources, register entries, maps, layers,
 * graph entities and every document, so each records handler has something to answer.
 *
 *   const env = { ELECTIONS_DB: recordsMini() };      // the D1 binding API (tests/records/d1-shim.mjs)
 *
 * Refuses a fixture whose columns differ from schema.mjs: re-run the builder after a schema
 * change.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { TABLES, createTableSql } from '../../../packages/schema/src/schema.mjs';
import { toD1 } from '../../../packages/storage/src/store.js';
import { openSqlite } from '../../../packages/storage/src/sqlite.mjs';

export const RECORDS_MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'records-mini.jsonl');

/** The fixture's header: { fixture, election, note }. */
export function recordsMiniHeader() {
  return JSON.parse(readFileSync(RECORDS_MINI, 'utf8').split('\n', 1)[0]);
}

/** A fresh in-memory records database holding the fixture, as a DatabaseSync. */
export function recordsMiniDatabase() {
  const db = new DatabaseSync(':memory:');
  const spec = new Map(TABLES.map((t) => [t.name, t]));
  for (const t of TABLES) db.exec(createTableSql(t));
  const lines = readFileSync(RECORDS_MINI, 'utf8').split('\n').filter(Boolean).slice(1);
  let insert = null;
  db.exec('BEGIN');
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!Array.isArray(row)) {
      const t = spec.get(row.table);
      if (!t) throw new Error(`records-mini: table ${row.table} is not in schema.mjs; re-run tests/records/fixtures/build-records-mini.mjs`);
      const want = t.columns.map((c) => c.name).join(',');
      if (row.columns.join(',') !== want) throw new Error(`records-mini: ${row.table} columns differ from schema.mjs; re-run tests/records/fixtures/build-records-mini.mjs`);
      insert = db.prepare(`INSERT INTO ${row.table} (${row.columns.join(', ')}) VALUES (${row.columns.map(() => '?').join(', ')})`);
      continue;
    }
    insert.run(...row);
  }
  db.exec('COMMIT');
  return db;
}

/** The fixture behind the D1 binding API, as tests/records/d1-shim.mjs d1() gives it. */
export function recordsMini() {
  const store = openSqlite(recordsMiniDatabase());
  return Object.assign(toD1(store), { _db: store._db, _store: store });
}
