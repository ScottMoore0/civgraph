/**
 * The D1 binding API over node:sqlite, so every Function handler runs against a local records
 * database with no wrangler at all: prepare(sql).bind(...).first()/all()/run(), and batch().
 * all() resolves to { results }, first() to a row or null. Booleans are not translated: D1
 * returns 0/1 too. Rows are plain objects (node:sqlite returns null-prototype ones).
 */
import { DatabaseSync } from 'node:sqlite';

export function d1(file, { readOnly = true } = {}) {
  const db = typeof file === 'string' ? new DatabaseSync(file, { readOnly }) : file;
  const plain = (row) => (row ? { ...row } : null);
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    async first(column) {
      const row = plain(db.prepare(sql).get(...params));
      if (column) return row ? row[column] : null;
      return row;
    },
    async all() {
      return { results: db.prepare(sql).all(...params).map(plain), success: true };
    },
    async raw() {
      return db.prepare(sql).all(...params).map((r) => Object.values(r));
    },
    async run() {
      const info = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      return Promise.all(statements.map((s) => s.all()));
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    },
    _db: db,
  };
}

/** An in-memory caches.default (match/put by URL). */
/**
 * A build without the votes dataset (CI, and npm run check:clean: CIVGRAPH_VOTES_DIR is unset
 * there and there is no earlier build to carry votes over from) has empty votes tables, so the
 * votes routes answer 404 by design; tests check them only when the build holds votes.
 */
export function buildHasVotes(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM divisions').get().n > 0; } finally { db.close(); }
}

export function installCaches() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(request) {
        const hit = store.get(typeof request === 'string' ? request : request.url);
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        store.set(typeof request === 'string' ? request : request.url, response.clone());
      },
    },
  };
  return store;
}

/** A Pages Function context for a GET of `url`. */
export function context(url, env, params = {}) {
  const pending = [];
  return {
    request: new Request(new URL(url, 'https://civgraph.net').toString()),
    env,
    params,
    waitUntil: (p) => pending.push(p),
    next: async () => new Response('static', { status: 200, headers: { 'X-Static': '1' } }),
    _pending: pending,
  };
}
