// @ts-check
/**
 * The item statuses and run modes the ingest scripts write (state-machine catalogue IN-L, light
 * weight): one frozen union per vocabulary, shared by the plugin framework, and the fields of
 * each script that carry it. tests/intake/item-status.test.mjs reads every script named here and
 * fails on a quoted literal for one of those fields and on a name its vocabulary lacks. The
 * scripts write each value through the vocabulary's name map (MIRROR.uploaded, not 'uploaded'),
 * which holds every value under its own name, so the strings they write are unchanged.
 *
 * Each item status is the outcome of one item (a file, a page, a layer): from pending to one
 * terminal value, never back. Modes are chosen once per run.
 */

/** Files mirrored to the Internet Archive. */
export const MIRROR_ITEM = Object.freeze(/** @type {const} */ (['already', 'uploaded', 'failed', 'skipped-dynamic', 'mirrored']));
/** Agency layers mirrored to the Internet Archive. */
export const AGENCY_MIRROR_ITEM = Object.freeze(/** @type {const} */ (['already-on-ia', 'dry', 'uploaded']));
/** CSO historical report pages and their downloads. */
export const CSO_REPORT_ITEM = Object.freeze(/** @type {const} */ (['pending', 'ok', 'not_requested', 'cached', 'downloaded', 'failed']));
/** NISRA files recovered from the Wayback Machine. */
export const WAYBACK_ITEM = Object.freeze(/** @type {const} */ (['already-present-current-mirror', 'already-present-wayback-mirror', 'duplicate-wayback-digest', 'unavailable', 'would-download', 'downloaded', 'failed']));
/** Hill-domain layers registered in the metadata. */
export const LAYER_REGISTRATION = Object.freeze(/** @type {const} */ (['ok', 'converted']));
/** A census cleaning-model check. */
export const CLEANING_CHECK = Object.freeze(/** @type {const} */ (['ok', 'warnings', 'failed']));
/** PRONI detail scan: whether page snapshots are used. */
export const PRONI_SNAPSHOT_MODE = Object.freeze(/** @type {const} */ (['prefer', 'off', 'only']));
/** PRONI fast indexer: the run mode and the level a scan works at. */
export const PRONI_INDEX_MODE = Object.freeze(/** @type {const} */ (['index', 'discover', 'local-index', 'probe']));
export const PRONI_SCAN_LEVEL = Object.freeze(/** @type {const} */ (['index', 'discover-index', 'branch-discovery', 'branch-discovery-page']));
/** PRONI DFS benchmark: the traversal compared. */
export const PRONI_BENCHMARK_MODE = Object.freeze(/** @type {const} */ (['baseline', 'dfs']));
/** NI Assembly harvest phase. */
export const NIA_HARVEST_PHASE = Object.freeze(/** @type {const} */ (['seed', 'detail', 'supplement', 'all']));
/** A candidate's result on a Dail count sheet (the candidate-count vocabulary, RG-01). */
export const COUNT_RESULT = Object.freeze(/** @type {const} */ (['Elected', 'Excluded', 'Not Elected']));

/**
 * A vocabulary as a frozen name map: each value under its own name (NAME.value, or
 * NAME['with-hyphens']), so a script names a status rather than spelling it.
 * @template {string} V
 * @param {readonly V[]} vocabulary
 * @returns {Readonly<{ [K in V]: K }>}
 */
export function named(vocabulary) {
  return Object.freeze(/** @type {{ [K in V]: K }} */ (Object.fromEntries(vocabulary.map((v) => [v, v]))));
}

export const MIRROR = named(MIRROR_ITEM);
export const AGENCY_MIRROR = named(AGENCY_MIRROR_ITEM);
export const CSO_REPORT = named(CSO_REPORT_ITEM);
export const WAYBACK = named(WAYBACK_ITEM);
export const LAYER = named(LAYER_REGISTRATION);
export const CLEANING = named(CLEANING_CHECK);
export const SNAPSHOT = named(PRONI_SNAPSHOT_MODE);
export const INDEX_MODE = named(PRONI_INDEX_MODE);
export const SCAN_LEVEL = named(PRONI_SCAN_LEVEL);
export const BENCHMARK = named(PRONI_BENCHMARK_MODE);
export const HARVEST = named(NIA_HARVEST_PHASE);
export const RESULT = named(COUNT_RESULT);

/** Each name map, by the name the scripts import it under, with its vocabulary. */
export const NAME_MAPS = Object.freeze({
  MIRROR: MIRROR_ITEM, AGENCY_MIRROR: AGENCY_MIRROR_ITEM, CSO_REPORT: CSO_REPORT_ITEM, WAYBACK: WAYBACK_ITEM,
  LAYER: LAYER_REGISTRATION, CLEANING: CLEANING_CHECK, SNAPSHOT: PRONI_SNAPSHOT_MODE, INDEX_MODE: PRONI_INDEX_MODE,
  SCAN_LEVEL: PRONI_SCAN_LEVEL, BENCHMARK: PRONI_BENCHMARK_MODE, HARVEST: NIA_HARVEST_PHASE, RESULT: COUNT_RESULT,
});

/**
 * The names a script reads from one name map: NAME.value and NAME['value'].
 * @param {string} source
 * @param {string} map
 */
export function namesOf(source, map) {
  const out = new Set();
  const re = new RegExp(String.raw`\b${map}(?:\.([A-Za-z_$][\w$]*)|\[\s*(["'])([^"']+)\2\s*\])`, 'g');
  for (const m of source.matchAll(re)) out.add(m[1] ?? m[3]);
  return out;
}

/**
 * Which field of which script (under scripts/ingest/) carries which vocabulary.
 * @type {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>}
 */
export const SCRIPT_VOCABULARIES = Object.freeze({
  'census/mirror-nisra-files-to-ia.mjs': { status: MIRROR_ITEM },
  'census/mirror-opendatani-to-ia.mjs': { status: MIRROR_ITEM },
  'census/reenrich-opendatani-with-ia.mjs': { status: MIRROR_ITEM },
  'internet-archive/build-agency-ia-mirror.mjs': { status: AGENCY_MIRROR_ITEM },
  'census/scrape-cso-historical-reports.mjs': { status: CSO_REPORT_ITEM },
  'census/wayback-nisra-recover.mjs': { status: WAYBACK_ITEM },
  'hills/build-irish-hill-domain-metadata.mjs': { status: LAYER_REGISTRATION },
  'census/build-census-cleaning-model.mjs': { status: CLEANING_CHECK },
  'proni/proni-detail-quick-scan.mjs': { snapshotMode: PRONI_SNAPSHOT_MODE },
  'proni/proni-fast-indexer.mjs': { mode: PRONI_INDEX_MODE, scanLevel: PRONI_SCAN_LEVEL },
  'proni/proni-dfs-benchmark.mjs': { mode: PRONI_BENCHMARK_MODE },
  'ni-assembly-opendata/harvest-niassembly-opendata.mjs': { PHASE: NIA_HARVEST_PHASE },
  'wikipedia/import-dail-wikipedia-counts.mjs': { status: COUNT_RESULT },
});

/**
 * @param {readonly string[]} vocabulary
 * @param {unknown} value
 */
export function isItemStatus(vocabulary, value) {
  return typeof value === 'string' && vocabulary.includes(value);
}

/**
 * The literals a script assigns to or compares with a field: `field: 'x'`, `field = 'x'`,
 * `field === 'x'`, and the branches of `field: cond ? 'x' : 'y'`.
 * @param {string} source
 * @param {string} field
 */
export function literalsOf(source, field) {
  const out = new Set();
  const direct = new RegExp(`\\b${field}\\b\\??\\s*(?::|=|===|!==|==)\\s*["'\`]([A-Za-z][A-Za-z0-9 _-]*)["'\`]`, 'g');
  for (const m of source.matchAll(direct)) out.add(m[1]);
  const ternary = new RegExp(`\\b${field}\\s*:\\s*[^,\\n]*\\?[^\\n]*`, 'g');
  for (const m of source.matchAll(ternary)) for (const q of m[0].matchAll(/["'`]([A-Za-z][A-Za-z0-9 _-]*)["'`]/g)) out.add(q[1]);
  return out;
}
