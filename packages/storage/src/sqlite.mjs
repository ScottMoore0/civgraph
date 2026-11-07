/**
 * The RecordStore over a local SQLite file, through node:sqlite (packages/storage/src/store.js).
 *
 *   const store = openSqlite('tmp/records/civgraph-records.sqlite', { readOnly: true });
 *   const store = openSqlite(':memory:');
 *
 * The records build, the tests and the local tools use it; it never runs in Pages Functions
 * (node:sqlite is not in the Workers runtime), which is why it lives under scripts/. It answers
 * exactly as fromD1() does: plain row objects, booleans bound as 1/0, batch() in one
 * transaction that rolls back on any failure.
 */
import { DatabaseSync } from 'node:sqlite';
import { assertRecordStore, bindParams } from './store.js';

/** @typedef {import('node:sqlite').DatabaseSync} SqliteHandle */

/**
 * A raw node:sqlite handle, for the records loader's bulk paths (prepared inserts by the million,
 * iterate() over whole tables, ATTACH of a snapshot), which stay synchronous and on the engine's
 * own API (REFACTOR-PLAN.md ST-7). Everything under scripts/records opens a database here or
 * through openSqlite(), so the engine is named in this file only (tests/unit/storage-adoption.test.mjs).
 * @param {string} file
 * @param {{ readOnly?: boolean }} [options]
 * @returns {SqliteHandle}
 */
export function openSqliteHandle(file, { readOnly = false } = {}) {
  return new DatabaseSync(file, { readOnly });
}

const plain = (row) => (row ? { ...row } : null);

/**
 * @param {string|SqliteHandle} file   a path, ':memory:', or a handle to wrap
 * @param {{ readOnly?: boolean }} [options]
 * @returns {import('./store.js').RecordStore & { _db: SqliteHandle }}
 */
export function openSqlite(file, { readOnly = false } = {}) {
  const db = file instanceof DatabaseSync ? file : openSqliteHandle(file, { readOnly: file === ':memory:' ? false : readOnly });
  const cache = new Map();
  const statement = (sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, stmt);
    }
    return stmt;
  };
  return assertRecordStore({
    kind: 'sqlite',
    async first(sql, params) {
      return plain(statement(sql).get(...bindParams(params)));
    },
    async all(sql, params) {
      return statement(sql).all(...bindParams(params)).map(plain);
    },
    async value(sql, params) {
      const row = statement(sql).get(...bindParams(params));
      return row ? (Object.values(row)[0] ?? null) : null;
    },
    async run(sql, params) {
      const info = statement(sql).run(...bindParams(params));
      return { changes: Number(info.changes), lastRowId: info.lastInsertRowid === undefined ? null : Number(info.lastInsertRowid) };
    },
    async batch(statements) {
      if (!statements.length) return [];
      // Bind every statement before the transaction opens, so a bad parameter fails with
      // nothing written, as D1 refuses a batch that does not prepare.
      const ready = statements.map((s) => [statement(s.sql), bindParams(s.params)]);
      db.exec('BEGIN');
      try {
        const out = ready.map(([stmt, values]) => stmt.all(...values).map(plain));
        db.exec('COMMIT');
        return out;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sqlText) {
      db.exec(sqlText);
    },
    async close() {
      cache.clear();
      if (db.isOpen) db.close();
    },
    /** The underlying DatabaseSync, for the loader's bulk paths. Not part of the interface. */
    _db: db,
  });
}
