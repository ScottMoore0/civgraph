/**
 * The RecordStore over a Cloudflare D1 binding (packages/storage/src/store.js).
 *
 *   const store = fromD1(context.env.ELECTIONS_DB);
 *   const row = await store.first('SELECT ... WHERE slug = ?', [slug]);
 *
 * batch() is D1's batch(), which D1 runs as one transaction: any failure rolls back the whole
 * batch (developers.cloudflare.com/d1/worker-api/d1-database/). exec() is D1's exec(), for
 * parameterless multi-statement text only. close() does nothing: a binding has no connection to
 * close.
 */
import { assertRecordStore, bindParams } from './store.js';

/**
 * A D1 row as a plain object. D1 hands back only SQL values (null, number, string, ArrayBuffer
 * views), so the copy is a Row.
 * @param {Record<string, unknown> | null | undefined} row
 * @returns {import('./store.js').Row | null}
 */
const plain = (row) => (row ? /** @type {import('./store.js').Row} */ ({ ...row }) : null);

/**
 * @param {D1Database} binding
 * @param {{ session?: string }} [options]
 */
export function fromD1(binding, { session } = {}) {
  if (!binding || typeof binding.prepare !== 'function') throw new TypeError('fromD1(): not a D1 binding');
  // Read replication (D1 Sessions API): a session reads from a nearby replica when allowed.
  const db = session && typeof binding.withSession === 'function' ? binding.withSession(session) : binding;
  /**
   * @param {string} sql
   * @param {unknown[]} [params]
   */
  const prepared = (sql, params) => {
    const values = bindParams(params);
    const stmt = db.prepare(sql);
    return values.length ? stmt.bind(...values) : stmt;
  };
  return assertRecordStore({
    kind: 'd1',
    async first(sql, params) {
      return plain(await prepared(sql, params).first());
    },
    async all(sql, params) {
      const { results } = await prepared(sql, params).all();
      return /** @type {import('./store.js').Row[]} */ ((results || []).map(plain));
    },
    async value(sql, params) {
      const row = await prepared(sql, params).first();
      return row ? /** @type {import('./store.js').SqlValue} */ (Object.values(row)[0] ?? null) : null;
    },
    async run(sql, params) {
      const result = await prepared(sql, params).run();
      const meta = result?.meta || {};
      return { changes: Number(meta.changes ?? 0), lastRowId: meta.last_row_id ?? null };
    },
    async batch(statements) {
      if (!statements.length) return [];
      const results = await db.batch(statements.map((s) => prepared(s.sql, s.params)));
      return results.map((r) => /** @type {import('./store.js').Row[]} */ ((r?.results || []).map(plain)));
    },
    async exec(sqlText) {
      await db.exec(sqlText);
    },
    async close() {},
  });
}

/** @type {WeakMap<object, import('./store.js').RecordStore>} */
const wrapped = new WeakMap();

/**
 * A RecordStore from either a store or a D1 binding: the shared helpers (functions/_api/_records.js
 * and the like) take whichever their caller holds, so the handlers move onto the adapter one route
 * at a time (storage slice ST-5). One store per binding object.
 * @param {import('./store.js').RecordStore | D1Database} db
 * @returns {import('./store.js').RecordStore}
 */
export function asStore(db) {
  const maybe = /** @type {{ kind?: unknown, all?: unknown, prepare?: unknown } | null} */ (db);
  if (maybe && typeof maybe.kind === 'string' && typeof maybe.all === 'function' && typeof maybe.prepare !== 'function') return /** @type {import('./store.js').RecordStore} */ (db);
  const known = wrapped.get(/** @type {object} */ (db));
  if (known) return known;
  /** @type {import('./store.js').RecordStore} */
  const store = fromD1(/** @type {D1Database} */ (db));
  wrapped.set(/** @type {object} */ (db), store);
  return store;
}
