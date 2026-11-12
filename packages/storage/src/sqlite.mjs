/**
 * The RecordStore over a local SQLite file, through node:sqlite (packages/storage/src/store.js).
 *
 *   const store = openSqlite('tmp/records/civgraph-records.sqlite', { readOnly: true });
 *   const store = openSqlite(':memory:');
 *
 * The records build, the tests and the local tools use it; it never runs in Pages Functions
 * (node:sqlite is not in the Workers runtime). It answers exactly as fromD1() does: plain row
 * objects, booleans bound as 1/0, batch() in one transaction that rolls back on any failure.
 *
 * This is the only module that imports the engine (architecture rule R1, held by
 * check:boundaries' `engines` rule in config/boundaries.json): the loader, the build scripts, the
 * check rules and the maps pipeline open a database here, through openSqliteHandle() or
 * openSqlite(), and name its types through the typedefs below, never through 'node:sqlite'.
 */
import { DatabaseSync } from 'node:sqlite';
import { assertRecordStore, bindParams } from './store.js';

/**
 * The synchronous handle the bulk paths use (prepared inserts by the million, iterate() over whole
 * tables, ATTACH of a snapshot; REFACTOR-PLAN.md ST-7). It is the engine's own object narrowed to
 * the calls Civgraph makes, so tsc refuses any other: an engine swap supplies these four.
 * @typedef {Pick<DatabaseSync, 'prepare' | 'exec' | 'close' | 'isOpen'>} SqliteHandle
 */
/**
 * A prepared statement, narrowed the same way: run, get, all and iterate.
 * @typedef {Pick<import('node:sqlite').StatementSync, 'run' | 'get' | 'all' | 'iterate'>} SqliteStatement
 */
/** A value a statement binds. @typedef {import('node:sqlite').SQLInputValue} SqliteInput */
/** A value a row holds. @typedef {import('node:sqlite').SQLOutputValue} SqliteValue */
/** A row as a statement returns it. @typedef {Record<string, SqliteValue>} SqliteRow */
/** @typedef {import('./store.js').RecordStore} RecordStore */
/** @typedef {import('./store.js').Row} Row */

/**
 * A raw handle on a database file (or ':memory:'): read-only when asked, read-write and created
 * when missing by default. Everything outside packages/storage opens a database here or through
 * openSqlite(), so the engine is named in this file only.
 * @param {string} file
 * @param {{ readOnly?: boolean }} [options]
 * @returns {SqliteHandle}
 */
export function openSqliteHandle(file, { readOnly = false } = {}) {
  return new DatabaseSync(file, { readOnly });
}

/** A row copied to a plain object, or null when there is none. */
const plain = (/** @type {SqliteRow|undefined} */ row) => (row ? /** @type {Row} */ ({ ...row }) : null);

/**
 * @param {string|SqliteHandle} file   a path, ':memory:', or a handle to wrap
 * @param {{ readOnly?: boolean }} [options]
 * @returns {import('./store.js').RecordStore & { _db: SqliteHandle }}
 */
export function openSqlite(file, { readOnly = false } = {}) {
  const db = typeof file === 'string' ? openSqliteHandle(file, { readOnly: file === ':memory:' ? false : readOnly }) : file;
  /** @type {Map<string, SqliteStatement>} */
  const cache = new Map();
  const statement = (/** @type {string} */ sql) => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      if (cache.size > 500) cache.clear();
      cache.set(sql, stmt);
    }
    return stmt;
  };
  /** @type {RecordStore & { _db: SqliteHandle }} */
  const store = {
    kind: 'sqlite',
    async first(sql, params) {
      return plain(statement(sql).get(...bindParams(params)));
    },
    async all(sql, params) {
      return /** @type {Row[]} */ (statement(sql).all(...bindParams(params)).map(plain));
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
      const ready = statements.map((s) => /** @type {const} */ ([statement(s.sql), bindParams(s.params)]));
      db.exec('BEGIN');
      try {
        const out = ready.map(([stmt, values]) => /** @type {Row[]} */ (stmt.all(...values).map(plain)));
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
  };
  return assertRecordStore(store);
}
