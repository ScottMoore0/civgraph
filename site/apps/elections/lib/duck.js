/**
 * DuckDB-WASM for the pivot tables, loaded only when a view needs it. Self-hosted (11 Nov 2026,
 * ../config.js): the module and its workers from /src/libs/duckdb-wasm-<version>/, the WebAssembly
 * from the copy config.js picks (this server in development, R2 in production: it is over Pages'
 * 25 MiB file limit). The database reads the build-time Parquet extracts over HTTP; it never
 * queries live D1.
 */
import { DUCKDB_VERSION, VENDOR, currentSources } from '../config.js';
import { BOUND_BODIES, ENGINE, EXTRACTS_INDEX } from '../state-machines.js';
import { serial } from './lifecycle.js';

export { DUCKDB_VERSION };
const SOURCES = currentSources();
/** Where the extracts are read from (../config.js). */
export const EXTRACTS = SOURCES.extracts;

const abs = (/** @type {string} */ url) => new URL(url, location.origin).href;

/**
 * The parts of DuckDB-WASM this file uses. The module is loaded from this site at run time, not
 * installed, so there are no package types to import: these are typed by what the calls need.
 * @typedef {{ toJSON(): Record<string, unknown> }} DuckRow
 * @typedef {{ toArray(): DuckRow[] }} DuckTable
 * @typedef {{ query(sql: string): Promise<DuckTable> }} DuckConnection
 * @typedef {{ mainModule: string, mainWorker: string }} DuckBundleFiles
 * @typedef {DuckBundleFiles & { pthreadWorker?: string | null }} DuckBundle
 * @typedef {object} DuckDatabase
 * @property {(mainModule: string, pthreadWorker?: string | null) => Promise<unknown>} instantiate
 * @property {() => Promise<DuckConnection>} connect
 * @property {(name: string, url: string, protocol: number, directIO: boolean) => Promise<void>} registerFileURL
 * @typedef {object} DuckModule
 * @property {(bundles: { mvp: DuckBundleFiles, eh: DuckBundleFiles }) => Promise<DuckBundle>} selectBundle
 * @property {new (logger: unknown, worker: Worker) => DuckDatabase} AsyncDuckDB
 * @property {new (level: number) => unknown} ConsoleLogger
 * @property {{ WARNING: number }} LogLevel
 * @property {{ HTTP: number }} DuckDBDataProtocol
 */
/**
 * The extracts' index.json: one entry per body, with its row and election counts and the
 * content-named Parquet file.
 * @typedef {{ bodies: Array<{ body: string, slug: string, file: string, rows: number, elections: number }>, [key: string]: unknown }} ExtractsIndex
 */

/** EL-02 (state-machines.js ENGINE): not-started, starting, ready or failed (then tried again). */
const engine = ENGINE.start();
/** @type {Promise<{ duckdb: DuckModule, db: DuckDatabase, conn: DuckConnection }> | null} */
let ready = null;

/** The engine's state, for a view that wants to say why nothing is drawn yet. */
export const engineState = () => engine.state();

/** Start DuckDB once (a worker from the self-hosted bundle); resolves to { duckdb, db, conn }. */
export function openDuckDb() {
  if (!ready) {
    engine.to('starting');
    ready = (async () => {
      const duckdb = /** @type {DuckModule} */ (await import(/* @vite-ignore */ abs(`${VENDOR.duckdb}duckdb-browser.mjs`)));
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
      engine.to('ready');
      return { duckdb, db, conn };
    })().catch((err) => { engine.to('failed'); ready = null; throw err; });
  }
  return ready;
}

/** @type {Set<string>} */
const registered = new Set();
/** EL-03 (state-machines.js BOUND_BODIES): which bodies `rows` reads, and the lock that owns it. */
const binding = BOUND_BODIES.start();
let boundKey = '';
/** Runs a task alone: nothing else binds or queries `rows` until it settles. */
const exclusive = serial();

/** Make `rows` a view over the given bodies' extracts (registering each file once). Inside the lock only. */
async function bind(/** @type {string[]} */ bodies) {
  const key = bodies.join(',');
  if (binding.state() === 'bound' && key === boundKey) return;
  binding.to('binding');
  try {
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
    boundKey = key;
    binding.to('bound');
  } catch (err) {
    boundKey = '';
    binding.to('failed');
    throw err;
  }
}

/**
 * Run a query over the `rows` view of the given bodies' extracts: binding them and querying
 * happen under one lock, so the answer is always of these bodies, whichever view asked last.
 * Rows come as plain objects (BigInt sums made Numbers).
 * @param {string[]} bodies
 * @param {string} sql
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export function queryBodies(bodies, sql) {
  return exclusive(async () => {
    await bind(bodies);
    const { conn } = await openDuckDb();
    const table = await conn.query(sql);
    return table.toArray().map((row) => {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, v] of Object.entries(row.toJSON())) out[k] = typeof v === 'bigint' ? Number(v) : v;
      return out;
    });
  });
}

/** EL-04 (state-machines.js EXTRACTS_INDEX). */
const indexRun = EXTRACTS_INDEX.start();
/** @type {Promise<ExtractsIndex | null> | null} */
let index = null;

/** The extracts index (bodies, row counts, file names), or null when the extracts are not there. */
export function extractsIndex() {
  if (!index) {
    indexRun.to('loading');
    index = fetch(`${EXTRACTS}index.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null) // a cross-origin 404 without CORS headers is a network error, not a status
      .then((j) => {
        indexRun.to(j ? 'available' : 'unavailable');
        if (!j) index = null;
        return j;
      });
  }
  return index;
}

/** The extract file of a body, from the index. @param {string} body */
async function fileOf(body) {
  const idx = await extractsIndex();
  const entry = idx?.bodies?.find((x) => x.slug === body);
  if (!entry) throw new Error(idx ? `no extract for ${body}` : 'the pivot extracts are not available');
  return String(entry.file);
}
