/**
 * The RecordStore over a local SQLite file, through node:sqlite (functions/_lib/storage/store.js).
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
import { assertRecordStore, bindParams } from '../../../functions/_lib/storage/store.js';

const plain = (row) => (row ? { ...row } : null);

export function openSqlite(file, { readOnly = false } = {}) {
  const db = file instanceof DatabaseSync ? file : new DatabaseSync(file, { readOnly: file === ':memory:' ? false : readOnly });
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
