/**
 * DuckDB-WASM for the pivot tables, loaded only when the pivot view opens. Pinned version from
 * jsDelivr (the module and its matching WebAssembly bundles); nothing is vendored. The database
 * reads the build-time Parquet extracts over HTTP from the app's own origin; it never queries
 * live D1.
 */
export const DUCKDB_VERSION = '1.29.0';
const MODULE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
/** Where the extracts are served (gitignored, local until the owner approves the app). */
export const EXTRACTS = '/apps/elections/extracts/';

/** @type {Promise<{ duckdb: any, db: any, conn: any }> | null} */
let ready = null;

/** Start DuckDB once (a worker from the pinned bundle); resolves to { duckdb, db, conn }. */
export function openDuckDb() {
  if (!ready) {
    ready = (async () => {
      const duckdb = await import(/* @vite-ignore */ MODULE);
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      const conn = await db.connect();
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
    await db.registerFileURL(`${b}.parquet`, new URL(`${EXTRACTS}${b}.parquet`, location.origin).toString(), duckdb.DuckDBDataProtocol.HTTP, false);
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

/** The extracts index (bodies, row counts), or null when the extracts are not built. */
export async function extractsIndex() {
  const res = await fetch(`${EXTRACTS}index.json`);
  if (!res.ok) return null;
  return res.json();
}
