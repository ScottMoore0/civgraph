/**
 * DuckDB-WASM for the pivot tables, loaded only when a view needs it. Self-hosted (11 Nov 2026,
 * ../config.js): the module and its workers from /src/libs/duckdb-wasm-<version>/, the WebAssembly
 * from the copy config.js picks (this server in development, R2 in production: it is over Pages'
 * 25 MiB file limit). The database reads the build-time Parquet extracts over HTTP; it never
 * queries live D1.
 */
import { DUCKDB_VERSION, VENDOR, currentSources } from '../config.js';

export { DUCKDB_VERSION };
const SOURCES = currentSources();
/** Where the extracts are read from (../config.js). */
export const EXTRACTS = SOURCES.extracts;

const abs = (/** @type {string} */ url) => new URL(url, location.origin).href;

/** @type {Promise<{ duckdb: any, db: any, conn: any }> | null} */
let ready = null;

/** Start DuckDB once (a worker from the self-hosted bundle); resolves to { duckdb, db, conn }. */
export function openDuckDb() {
  if (!ready) {
    ready = (async () => {
      const duckdb = await import(/* @vite-ignore */ abs(`${VENDOR.duckdb}duckdb-browser.mjs`));
      // The bundles getJsDelivrBundles() named, at this site's addresses.
      const bundle = await duckdb.selectBundle({
        mvp: { mainModule: abs(`${SOURCES.duckdbWasm}duckdb-mvp.wasm`), mainWorker: abs(`${VENDOR.duckdb}duckdb-browser-mvp.worker.js`) },
        eh: { mainModule: abs(`${SOURCES.duckdbWasm}duckdb-eh.wasm`), mainWorker: abs(`${VENDOR.duckdb}duckdb-browser-eh.worker.js`) },
      });
      const worker = new Worker(bundle.mainWorker);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      // read_parquet() autoloads the parquet extension: from our copy, not DuckDB's extension server
      // (scripts/build/elections-app/vendor.mjs: <repository>/v1.1.1/<platform>/parquet.duckdb_extension.wasm).
      await conn.query(`SET custom_extension_repository = '${abs(`${SOURCES.duckdbWasm}extensions`)}'`);
      return { duckdb, db, conn };
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/** @type {Set<string>} */
const registered = new Set();

/**
 * Make `rows` a view over the given bodies' extracts (registering each file once).
 * @param {string[]} bodies
 */
export async function useBodies(bodies) {
  const { duckdb, db, conn } = await openDuckDb();
  for (const b of bodies) {
    if (registered.has(b)) continue;
    // The files are named by content (<body>-<sha256:12>.parquet, index.json says which), so a
    // cached copy is never a mix of two builds; DuckDB knows each by its body.
    await db.registerFileURL(`${b}.parquet`, abs(`${EXTRACTS}${await fileOf(b)}`), duckdb.DuckDBDataProtocol.HTTP, false);
    registered.add(b);
  }
  const files = bodies.map((b) => `'${b}.parquet'`).join(', ');
  await conn.query(`CREATE OR REPLACE VIEW rows AS SELECT * FROM read_parquet([${files}])`);
}

/**
 * Run a query; rows as plain objects (BigInt sums made Numbers).
 * @param {string} sql
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function query(sql) {
  const { conn } = await openDuckDb();
  const table = await conn.query(sql);
  return table.toArray().map((/** @type {any} */ row) => {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(row.toJSON())) out[k] = typeof v === 'bigint' ? Number(v) : v;
    return out;
  });
}

/** @type {Promise<any> | null} */
let index = null;

/** The extracts index (bodies, row counts, file names), or null when the extracts are not there. */
export function extractsIndex() {
  if (!index) {
    index = fetch(`${EXTRACTS}index.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null) // a cross-origin 404 without CORS headers is a network error, not a status
      .then((j) => { if (!j) index = null; return j; });
  }
  return index;
}

/** The extract file of a body, from the index. @param {string} body */
async function fileOf(body) {
  const idx = await extractsIndex();
  const entry = idx?.bodies?.find((/** @type {any} */ x) => x.slug === body);
  if (!entry) throw new Error(idx ? `no extract for ${body}` : 'the pivot extracts are not available');
  return String(entry.file);
}
