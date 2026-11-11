/**
 * Where the Elections app reads its pivot extracts and its libraries (11 Nov 2026). One place, so
 * pointing the app at another copy is a change here and nowhere else.
 *
 * LIBRARIES are self-hosted (scripts/build/elections-app/vendor.mjs; src/libs/elections-app-vendor.json
 * lists every file with its SHA-256): DuckDB-WASM, MapLibre GL and PMTiles at the versions below,
 * which are the versions the app loaded from jsDelivr until then (and MapLibre and PMTiles as
 * packages/map pins them). Pages serves the modules and workers from /src/libs/. The two DuckDB
 * WebAssembly files are over Pages' 25 MiB per-file limit, so production reads them from R2.
 *
 * DATA: the pivot extracts (scripts/build/elections-app/data.mjs --extracts) are built from the
 * records build. Production reads them from the public R2 bucket under R2_PREFIX; local
 * development reads the gitignored copies the build writes into site/apps/elections/extracts/ and
 * the vendor script beside the DuckDB module. Until the owner approves the upload
 * (scripts/publish/elections-app-r2-upload.mjs) nothing is at the R2 address, and the views that
 * need the extracts say so.
 *
 * R2 key layout (bucket boundaries-data, served at https://data.civgraph.net/):
 *
 *   data/elections-app/v1/extracts/index.json                 bodies, row counts, file names (short cache)
 *   data/elections-app/v1/extracts/manifest.json              every file's bytes and SHA-256 (short cache)
 *   data/elections-app/v1/extracts/<body>-<sha256:12>.parquet one per body, named by content (immutable)
 *   data/elections-app/v1/duckdb-wasm-1.29.0/duckdb-{eh,mvp}.wasm                            (immutable)
 *
 * v1 is the extracts' schema (index.json schemaVersion 1, model.mjs EXTRACT_COLUMNS); a change to
 * the columns that old pages cannot read makes a v2 beside it.
 *
 * Embedding the widget on other sites is not a setting here: it is the frame-ancestors line of the
 * /apps/elections/embed/* block in site/_headers (off by default: 'self').
 *
 * No DOM at the top level: scripts/build/elections-app/vendor.mjs and the unit tests import it.
 */
export const DUCKDB_VERSION = '1.29.0';
export const MAPLIBRE_VERSION = '5.24.0';
export const PMTILES_VERSION = '4.5.0';

/** The public R2 bucket behind the CDN (packages/config/src/config.js SITE.dataOrigin). */
export const DATA_ORIGIN = 'https://data.civgraph.net';
/** The app's key prefix in that bucket (data/database/r2-publication-allowlist.json must cover it before an upload). */
export const R2_PREFIX = 'data/elections-app/v1/';

/** The self-hosted libraries, served by Pages (src/libs/ is served at /src/libs/). */
export const VENDOR = Object.freeze({
  duckdb: `/src/libs/duckdb-wasm-${DUCKDB_VERSION}/`,
  maplibre: `/src/libs/maplibre-gl-${MAPLIBRE_VERSION}/`,
  pmtiles: `/src/libs/pmtiles-${PMTILES_VERSION}/`,
});

/**
 * The two copies of the data: `local` the files this server has (development), `r2` the bucket.
 * @type {Readonly<Record<'local' | 'r2', Readonly<{ extracts: string, duckdbWasm: string }>>>}
 */
export const SOURCES = Object.freeze({
  local: Object.freeze({ extracts: '/apps/elections/extracts/', duckdbWasm: VENDOR.duckdb }),
  r2: Object.freeze({ extracts: `${DATA_ORIGIN}/${R2_PREFIX}extracts/`, duckdbWasm: `${DATA_ORIGIN}/${R2_PREFIX}duckdb-wasm-${DUCKDB_VERSION}/` }),
});

/** localStorage key that picks a copy by hand: 'local' or 'r2' (e.g. to try the R2 copy from a local server). */
export const SOURCE_OVERRIDE_KEY = 'civgraph.electionsData';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.localhost)$/;

/**
 * Which copy a page on `hostname` reads: local development hosts the local one, every other host
 * (civgraph.net, Pages previews) R2, unless `override` names one.
 * @param {string} hostname
 * @param {string | null} [override]
 * @returns {'local' | 'r2'}
 */
export function sourceFor(hostname, override = null) {
  if (override === 'local' || override === 'r2') return override;
  return LOCAL_HOST.test(String(hostname || '')) ? 'local' : 'r2';
}

/** The copy this page reads (browser only). */
export function currentSources() {
  let override = null;
  try { override = localStorage.getItem(SOURCE_OVERRIDE_KEY); } catch { /* storage blocked */ }
  return SOURCES[sourceFor(location.hostname, override)];
}
