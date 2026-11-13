/**
 * The storage adapter: one interface over the records database wherever it lives.
 *
 * REFACTOR-PLAN.md item 4. Implementations:
 *   packages/storage/src/d1.js        fromD1(binding)      Cloudflare D1 (production)
 *   packages/storage/src/sqlite.mjs      openSqlite(file)     node:sqlite (records build, tests, tools)
 * The blob store over R2, KV, memory and the local file system is packages/storage/src/blob.js.
 *
 * The interface is SQL-level on purpose. Both stores speak SQLite's dialect, the queries are the
 * schema's (migrations/), and the handlers already hold their SQL; what differs between D1 and a
 * local file is only the calling convention (prepare/bind/first/all/batch vs StatementSync), how
 * parameters bind and what a batch guarantees. A database swap to another engine is then the
 * adapter plus a dialect check over the named queries, not a change to every handler.
 *
 * Every Function reads D1 through it (storage slice ST-5): a handler holds fromD1(binding) and
 * runs the named queries of packages/api/src/queries/ (ST-6); nothing outside this folder calls the
 * engine API (tests/functions/named-queries.test.mjs). toD1() below wraps any store in the D1
 * binding shape, so the tests run the real handlers over a local SQLite file
 * (tests/records/d1-shim.mjs is toD1(openSqlite(file)), ST-3).
 *
 * No file system, no Node imports: this file is bundled into Pages Functions.
 */

/**
 * @typedef {null|number|string|bigint|Uint8Array} SqlValue
 * @typedef {Record<string, SqlValue>} Row
 * @typedef {{ sql: string, params?: unknown[] }} Statement
 * @typedef {{ changes: number, lastRowId: number|null }} RunResult
 *
 * @typedef {object} RecordStore
 * @property {string} kind                                   'd1' | 'sqlite' | ...
 * @property {(sql: string, params?: unknown[]) => Promise<Row|null>} first   first row, or null
 * @property {(sql: string, params?: unknown[]) => Promise<Row[]>} all        every row, as plain objects
 * @property {(sql: string, params?: unknown[]) => Promise<SqlValue|null>} value  first column of the first row
 * @property {(sql: string, params?: unknown[]) => Promise<RunResult>} run      a write
 * @property {(statements: Statement[]) => Promise<Row[][]>} batch  in ONE transaction: all or nothing
 * @property {(sqlText: string) => Promise<void>} exec       several statements, no parameters (migrations)
 * @property {() => Promise<void>} close
 *
 * @typedef {object} D1ShimStatement  one statement of toD1()'s binding
 * @property {string} sql
 * @property {unknown[]} params
 * @property {(...args: unknown[]) => D1ShimStatement} bind
 * @property {(column?: string) => Promise<Row|SqlValue|null>} first
 * @property {() => Promise<{ results: Row[], success: true, meta: {} }>} all
 * @property {() => Promise<SqlValue[][]>} raw
 * @property {() => Promise<{ results: [], success: true, meta: { changes: number, last_row_id: number|null } }>} run
 */

export const RECORD_STORE_METHODS = Object.freeze(['first', 'all', 'value', 'run', 'batch', 'exec', 'close']);

/**
 * One parameter as both stores bind it: booleans as 1/0 (D1 does this itself, node:sqlite
 * refuses them), undefined as NULL. Anything else that is not a SQL value is refused here, in
 * the same words on every store, rather than in each engine's own way.
 * @param {unknown} value
 * @returns {SqlValue}
 */
export function bindValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`storage: cannot bind ${value}`);
    return value;
  }
  if (typeof value === 'string' || typeof value === 'bigint' || value instanceof Uint8Array) return value;
  throw new TypeError(`storage: cannot bind a ${Object.prototype.toString.call(value).slice(8, -1)}; pass JSON text or a scalar`);
}

/** @param {unknown[] | null | undefined} [params] */
export const bindParams = (params = []) => (params || []).map(bindValue);

/**
 * Throws unless `store` has every RecordStore method; returns it.
 * @template {RecordStore} S
 * @param {S} store
 * @returns {S}
 */
export function assertRecordStore(store) {
  const missing = RECORD_STORE_METHODS.filter((m) => typeof /** @type {Record<string, unknown> | null | undefined} */ (/** @type {unknown} */ (store))?.[m] !== 'function');
  if (missing.length || typeof store?.kind !== 'string') {
    throw new TypeError(`not a RecordStore: missing ${missing.length ? missing.join(', ') : 'kind'}`);
  }
  return store;
}

/**
 * The records dataset's version and loading flag (DESIGN.md 3.2), on any store.
 * @param {Pick<RecordStore, 'all'>} store
 * @returns {Promise<{ version: string, loading: string }>}
 */
export async function datasetState(store) {
  let version = '';
  let loading = '';
  try {
    for (const r of /** @type {import('../../types/index.js').RecordsDb.DatasetRow[]} */ (/** @type {unknown} */ (await store.all("SELECT key, value FROM dataset WHERE key IN ('version', 'loading') ORDER BY key")))) {
      if (r.key === 'version') version = r.value || '';
      if (r.key === 'loading') loading = r.value || '';
    }
  } catch { /* no dataset table: '' */ }
  return { version, loading };
}

/**
 * The D1 binding shape over any RecordStore: prepare(sql).bind(...).first(column?)/all()/raw()/
 * run(), batch() and exec(), as the handlers call them today. withSession() returns the same
 * object (a local store has no replicas).
 * @param {RecordStore} store
 */
export function toD1(store) {
  assertRecordStore(store);
  /**
   * @param {string} sql
   * @param {unknown[]} [params]
   * @returns {D1ShimStatement}
   */
  const statement = (sql, params = []) => ({
    sql,
    params,
    bind: (...args) => statement(sql, args),
    async first(column) {
      const row = await store.first(sql, params);
      if (column !== undefined) return row ? (row[column] ?? null) : null;
      return row;
    },
    async all() {
      return { results: await store.all(sql, params), success: true, meta: {} };
    },
    async raw() {
      return (await store.all(sql, params)).map((r) => Object.values(r));
    },
    async run() {
      const { changes, lastRowId } = await store.run(sql, params);
      return { results: [], success: true, meta: { changes, last_row_id: lastRowId } };
    },
  });
  const binding = {
    prepare: (/** @type {string} */ sql) => statement(sql),
    /** @param {Statement[]} statements */
    async batch(statements) {
      const results = await store.batch(statements.map((s) => (/** @type {Statement} */ ({ sql: s.sql, params: s.params }))));
      return results.map((rows) => ({ results: rows, success: true, meta: {} }));
    },
    /** @param {string} sqlText */
    async exec(sqlText) {
      await store.exec(sqlText);
      return { count: 1, duration: 0 };
    },
    withSession: () => binding,
  };
  return binding;
}
