/**
 * The D1 binding API over node:sqlite, so every Function handler runs against a local records
 * database with no wrangler at all: prepare(sql).bind(...).first()/all()/raw()/run(), batch()
 * and exec(). Since storage slice ST-3 this is the storage adapter itself, toD1(openSqlite(file))
 * (packages/storage/src/store.js, packages/storage/src/sqlite.mjs): the tests run the handlers
 * over the same RecordStore the Functions use in production through fromD1(), so parameters bind
 * as they do there (booleans as 1/0, undefined as NULL) and a batch is one transaction. Rows are
 * plain objects; booleans are not translated in results (D1 returns 0/1 too). `_db` is the
 * underlying DatabaseSync, for tests that close it or read it directly.
 */
import { DatabaseSync } from 'node:sqlite';
import { toD1 } from '../../packages/storage/src/store.js';
import { openSqlite } from '../../packages/storage/src/sqlite.mjs';

export function d1(file, { readOnly = true } = {}) {
  const store = openSqlite(file, { readOnly });
  return Object.assign(toD1(store), { _db: store._db, _store: store });
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
