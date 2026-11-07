/**
 * The RecordStore over a Cloudflare D1 binding (functions/_lib/storage/store.js).
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

const plain = (row) => (row ? { ...row } : null);

export function fromD1(binding, { session } = {}) {
  if (!binding || typeof binding.prepare !== 'function') throw new TypeError('fromD1(): not a D1 binding');
  // Read replication (D1 Sessions API): a session reads from a nearby replica when allowed.
  const db = session && typeof binding.withSession === 'function' ? binding.withSession(session) : binding;
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
      return (results || []).map(plain);
    },
    async value(sql, params) {
      const row = await prepared(sql, params).first();
      return row ? (Object.values(row)[0] ?? null) : null;
    },
    async run(sql, params) {
      const result = await prepared(sql, params).run();
      const meta = result?.meta || {};
      return { changes: Number(meta.changes ?? 0), lastRowId: meta.last_row_id ?? null };
    },
    async batch(statements) {
      if (!statements.length) return [];
      const results = await db.batch(statements.map((s) => prepared(s.sql, s.params)));
      return results.map((r) => (r?.results || []).map(plain));
    },
    async exec(sqlText) {
      await db.exec(sqlText);
    },
    async close() {},
  });
}
