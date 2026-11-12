#!/usr/bin/env node
/**
 * Parity crawl: fetch the same public URLs from two sites and compare the answers (data design
 * phase2-plan.md stage G.5). Read-only; GET only.
 *
 *   node scripts/records/parity-crawl.mjs --a https://civgraph.net --b http://127.0.0.1:8788
 *        [--db tmp/records/civgraph-records.sqlite] [--seed 1] [--scale 1] [--only kind,kind]
 *        [--delay-a 350] [--concurrency-b 6] [--out tmp/records/parity-report.json]
 *
 * Side A is the reference (before go-live: production on the old transport; after: production on
 * the new one), side B the candidate (the local rehearsal: wrangler pages dev over the local D1).
 * Requests to a host other than 127.0.0.1/localhost go one at a time, --delay-a ms apart, with the
 * User-Agent "civgraph-research (+https://civgraph.net)" and no personal identifiers.
 *
 * The URL sample is drawn deterministically (--seed) from the records database: election
 * bundles (the three largest always), the manifest, summaries, provenance shards, the elections,
 * persons, sources and register APIs, the /data/browse files Browse reads (index files, party
 * details and profiles, election details and contests, offices, votes), and the server-rendered
 * /browse/<type>/<slug> heads, with merged-person and retired-party redirects. --scale multiplies
 * the per-kind sample sizes.
 *
 * Data design phase 3 (PHASE3.md section 7) adds the maps kinds when the database has the maps
 * tables: the catalogue document and API, the agent index, the catalogue pane's documents at their
 * old and new URLs, the layer metadata (full, index, records, sidecars, other spellings), the
 * Browse map files and pages, the PRONI roots, and `catalogue-search`, which runs the pane's own
 * search (src/catalogue/search.js) over each side's documents. A URL renamed with a 301 is fetched
 * following the redirect on both sides (`follow`), the hop's target checked against the one
 * expected (`expect`), and the content compared; the intended differences (the index's detail URLs
 * name the API) are normalised away per kind (NORMALISE) and the report says so. With a database
 * that holds only the maps tables (records:build --only maps) only the maps kinds are drawn.
 *
 * JSON answers are compared deep, with generatedAt/builtAt dropped at any depth; a difference that
 * vanishes when arrays are sorted is reported as "order". HTML pages are compared on status,
 * redirect target, title, description and canonical. Exit 0 when every URL matches, 1 otherwise;
 * the report lists every difference with its first differing path.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openSqliteHandle } from '../../packages/storage/src/sqlite.mjs';
import { SITE } from '../../packages/config/src/node.mjs';
import { RECORDS_DB, REPO_ROOT } from '../../packages/loader/src/paths.mjs';
import { CatalogueSearch, PeopleSearch } from '../../src/catalogue/search.js';

/** @typedef {import('../../packages/storage/src/sqlite.mjs').SqliteHandle} SqliteHandle */
/**
 * One URL of the crawl: `urlB` when side B answers it at another URL, `follow` to follow a 301
 * (whose target must be `expect`).
 * @typedef {{ kind: string, url: string, mode: CrawlMode, urlB?: string, follow?: boolean, expect?: string }} CrawlUrl
 */
/** @typedef {(kind: string, url: string, mode?: CrawlMode, extra?: Record<string, unknown>) => number} AddUrl */
/**
 * One side's answer to a URL (status 0 with `error` when it could not be fetched); `hop` is the
 * last redirect followed.
 * @typedef {{ status: number, location?: string | null, type?: string, body: Buffer, ms?: number, error?: string,
 *   hop?: { status: number, location: string } }} Fetched
 */
/** Where two JSON values first differ. @typedef {{ path: string, a: unknown, b: unknown }} Diff */
/**
 * The comparison of one URL; `result` is 'same' or the kind of difference.
 * @typedef {{ kind: string, url: string, statusA: number, statusB: number, result: string, retried?: boolean,
 *   [field: string]: unknown }} CompareResult
 */
/** The catalogue pane's search over one side's documents. @typedef {{ maps: CatalogueSearch, people: PeopleSearch }} SearchEngines */
/** @typedef {{ id: string, detailUrl?: string, duplicateFeatureIdsUrl?: string, [key: string]: unknown }} LayerIndexEntry */

const args = process.argv.slice(2);
/**
 * @template {string | number} F
 * @param {string} name
 * @param {F} fallback
 * @returns {string | F}
 */
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const A = String(opt('--a', SITE.origin)).replace(/\/$/, '');
const B = String(opt('--b', 'http://127.0.0.1:8788')).replace(/\/$/, '');
const DB = path.resolve(opt('--db', RECORDS_DB));
const SEED = Number(opt('--seed', 1));
const SCALE = Number(opt('--scale', 1));
const ONLY = opt('--only', '') ? new Set(opt('--only', '').split(',')) : null;
const DELAY_A = Number(opt('--delay-a', 350));
const CONC_B = Number(opt('--concurrency-b', 6));
const OUT = path.resolve(opt('--out', path.join(REPO_ROOT, 'tmp', 'records', 'parity-report.json')));
const UA = SITE.userAgent;

// ---------------------------------------------------------------- sampling
/** @param {number} seed */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}
const rand = rng(SEED);
/**
 * @template T
 * @param {T[]} list
 * @param {number} n
 * @returns {T[]}
 */
function sample(list, n) {
  const a = [...list];
  const k = Math.min(a.length, Math.max(0, Math.round(n * SCALE)));
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k).sort();
}

/**
 * How a URL is compared (state-machine catalogue RC-L, light): 'json' answers compared as JSON,
 * 'html' pages by their record content, 'search' a catalogue or people query run against both
 * sides' search documents instead of fetched.
 * @typedef {'json'|'html'|'search'} CrawlMode
 */
export const CRAWL_MODES = /** @type {readonly CrawlMode[]} */ (Object.freeze(['json', 'html', 'search']));

/**
 * @param {SqliteHandle} db
 * @returns {CrawlUrl[]}
 */
export function buildUrlList(db) {
  /** The first column's values (every query here reads one TEXT column), nulls left out. */
  const col = (/** @type {string} */ sql) => /** @type {string[]} */ (db.prepare(sql).all().map((r) => Object.values(r)[0]).filter((v) => v !== null && v !== undefined));
  /** @type {CrawlUrl[]} */
  const urls = [];
  /** @type {(kind: string, url: string, mode?: CrawlMode, extra?: Record<string, unknown>) => number} */
  const add = (kind, url, mode = 'json', extra = {}) => urls.push({ kind, url, mode, ...extra });
  const hasRows = (/** @type {string} */ name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
    && Boolean(db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get());
  if (hasRows('maps')) addMapUrls(db, { col, add, enc: encodeURIComponent });
  if (!hasRows('r_elections')) return urls.filter((u) => !ONLY || ONLY.has(u.kind));
  const enc = encodeURIComponent;

  const keys = col('SELECT key FROM r_elections ORDER BY key');
  const largest = col("SELECT election_key FROM election_aggregates GROUP BY election_key ORDER BY SUM(LENGTH(payload)) DESC LIMIT 3");
  const bundleKeys = [...new Set([...largest, ...sample(keys, 100)])];
  for (const k of bundleKeys) add('bundle', `/render/metadata/elections-test2/${k}.json`);
  add('manifest', '/render/metadata/elections-test2.json');
  for (const k of sample(keys, 50)) add('provenance-shard', `/render/metadata/election-provenance/${k}.json`);
  const summaries = col("SELECT file FROM election_summaries ORDER BY file");
  for (const n of sample(summaries, 50)) add('summary', `/render/metadata/elections-test2-summaries/${n}`);
  for (const k of sample(keys, 60)) add('api-bundle', `/_api/elections?key=${enc(k)}&format=bundle&lite=1`);
  const contests = db.prepare('SELECT election_key AS k, seq FROM contests ORDER BY election_key, seq').all();
  for (const c of sample(contests.map((r) => `${r.k}|${r.seq}`), 40)) {
    const [k, seq] = c.split('|');
    add('api-constituency', `/_api/elections?key=${enc(k)}&constituency=${seq}`);
  }
  add('api-elections-index', '/_api/elections');

  const persons = col('SELECT slug FROM person_cards ORDER BY slug');
  for (const s of sample(persons, 150)) add('api-person', `/_api/persons?slug=${enc(s)}`);
  for (const q of ['paisley', 'hume', 'devlin', 'kelly']) add('api-person-search', `/_api/persons?q=${q}&limit=25`);
  const sources = col('SELECT slug FROM sources ORDER BY slug');
  for (const s of sample(sources, 80)) add('api-source', `/_api/sources?slug=${enc(s)}`);
  const register = col('SELECT slug FROM register_entries ORDER BY slug');
  for (const s of sample(register, 40)) add('api-register', `/_api/register-interests?slug=${enc(s)}`);

  for (const f of ['index.json', 'persons.json', 'persons-facets.json', 'sources.json', 'register-interests.json', 'parties.json',
    'party-names.json', 'party-label-folds.json', 'offices.json', 'votes/index.json']) {
    add('browse-file', `/data/browse/${f}`);
  }
  const parties = col('SELECT slug FROM party_cards ORDER BY slug');
  for (const s of sample(parties, 120)) add('party-detail', `/data/browse/details/parties/${s}.json`);
  for (const s of sample(parties, 60)) add('party-profile', `/data/browse/party-profiles/${s}.json`);
  const retired = col('SELECT alias FROM party_aliases ORDER BY alias');
  for (const s of sample(retired, 20)) add('party-detail-retired', `/data/browse/details/parties/${s}.json`);
  const electionSlugs = col("SELECT slug FROM election_details WHERE detail IS NOT NULL ORDER BY slug");
  for (const s of sample(electionSlugs, 60)) add('election-detail', `/data/browse/details/elections/${s}.json`);
  const contestSlugs = col("SELECT slug FROM election_details WHERE contests IS NOT NULL ORDER BY slug");
  for (const s of sample(contestSlugs, 40)) add('election-contests', `/data/browse/details/election-contests/${s}.json`);
  const offices = col('SELECT slug FROM office_cards ORDER BY slug');
  for (const s of sample(offices, 60)) add('office-detail', `/data/browse/details/offices/${s}.json`);
  for (let i = 0; i < Math.ceil(persons.length / 5000); i += 1) add('person-shard', `/data/browse/person-shards/persons-${String(i).padStart(3, '0')}.json`);
  // The other sharded indexes, every shard: a shard is a slice of its table in source order, so
  // these hold the order of every row (the last shard of each included).
  for (let i = 0; i < Math.ceil(sources.length / 5000); i += 1) add('source-shard', `/data/browse/source-index-shards/sources-${String(i).padStart(3, '0')}.json`);
  for (let i = 0; i < Math.ceil(register.length / 5000); i += 1) add('register-shard', `/data/browse/register-interest-shards/register-interests-${String(i).padStart(3, '0')}.json`);
  for (const f of ['elections.json']) add('browse-file', `/data/browse/${f}`);
  // The list APIs in their default (source) order, first and later pages.
  for (const q of ['limit=50', 'limit=50&offset=10000', 'limit=50&offset=36300']) add('api-person-list', `/_api/persons?${q}`);
  for (const q of ['limit=60', 'limit=60&offset=20000', 'limit=60&offset=39300']) add('api-source-list', `/_api/sources?${q}`);
  for (const q of ['limit=60', 'limit=60&offset=5000']) add('api-register-list', `/_api/register-interests?${q}`);
  for (const q of ['view=list', 'view=list&decade=1920s&limit=40&offset=20', 'view=manifest']) add('api-election-list', `/_api/elections?${q}`);
  for (const q of ['', '?view=names']) add('api-party-list', `/_api/parties${q}`);
  for (const q of ['belfast', 'paisley', 'unionist']) add('api-graph-search', `/_api/graph?q=${q}`);
  for (const e of ['cg:party:uup', 'cg:party:sdlp', 'cg:party:sinn-fein']) add('api-graph-entity', `/_api/graph?entity=${enc(e)}&related=1`);
  const votePersons = col('SELECT person_id FROM vote_persons ORDER BY person_id');
  for (const id of sample(votePersons, 40)) add('votes-person', `/data/browse/votes/persons/${id}.json`);
  const voteParties = col('SELECT slug FROM vote_parties ORDER BY slug');
  for (const s of sample(voteParties, 10)) add('votes-party', `/data/browse/votes/parties/${s}.json`);

  const page = (/** @type {string} */ type, /** @type {string[]} */ slugs, /** @type {number} */ n) => { for (const s of sample(slugs, n)) add(`page-${type}`, `/browse/${type}/${enc(s)}`, 'html'); };
  page('persons', persons, 60);
  page('parties', parties, 30);
  page('sources', sources, 40);
  page('register-interests', register, 20);
  page('offices', offices, 30);
  page('elections', col("SELECT slug FROM election_cards ORDER BY slug"), 60);
  const mergedIds = col('SELECT alias FROM person_aliases ORDER BY alias');
  page('persons', mergedIds, 20);
  for (const s of sample(retired, 15)) add('page-parties-retired', `/browse/parties/${enc(s)}`, 'html');
  add('page-elections-alias', '/browse/elections/bangor-urban-district-council-1920-01-15', 'html');

  // The grouped local-election years (ni-local__YYYY from 1921, ireland-local__YYYY before):
  // the year files and coverage are committed static files, the year records come from D1.
  const groupYears = col("SELECT slug FROM election_cards ORDER BY slug").filter((s) => /^(ni|ireland)-local-\d{4}$/.test(s));
  for (const s of groupYears) add('ni-local-year-file', `/render/metadata/ni-local/${s.slice(-4)}.json`);
  add('ni-local-coverage', '/render/metadata/ni-local-coverage.json');
  for (const s of sample(groupYears, 15)) add('ni-local-detail', `/data/browse/details/elections/${s}.json`);
  for (const s of sample(groupYears, 15)) add('page-elections-ni-local', `/browse/elections/${enc(s)}`, 'html');
  return urls.filter((u) => !ONLY || ONLY.has(u.kind));
}

/**
 * The intended differences of phase 3, removed from both sides before comparing.
 * @type {Partial<Record<string, (doc: { layers?: LayerIndexEntry[], [key: string]: unknown }) => unknown>>}
 */
const NORMALISE = {
  // The startup index's entries name where the record and sidecar are served: the old files
  // before phase 3, /_api/layers after. The layer id is what both name.
  'layers-index': (doc) => ({
    ...doc,
    layers: (doc.layers || []).map((l) => ({ ...l, ...(l.detailUrl ? { detailUrl: l.id } : {}), ...(l.duplicateFeatureIdsUrl ? { duplicateFeatureIdsUrl: l.id } : {}) })),
  }),
};

/**
 * Phase 3: the map, layer and catalogue URLs, drawn from the maps tables.
 * @param {SqliteHandle} db
 * @param {{ col: (sql: string) => string[], add: AddUrl, enc: (value: string) => string }} helpers
 */
export function addMapUrls(db, { col, add, enc }) {
  add('maps-doc', '/data/database/maps.json');
  add('agent-index', '/agent/maps-index.json');
  add('api-catalogue', '/_api/catalogue');
  add('api-catalogue', '/_api/catalogue?visible=1');
  const mapIds = col('SELECT map_id FROM maps ORDER BY map_id');
  for (const id of sample(mapIds, 40)) add('api-catalogue-id', `/_api/catalogue?id=${enc(id)}`);
  const mapSlugs = col('SELECT slug FROM maps WHERE slug IS NOT NULL ORDER BY slug');
  for (const s of sample(mapSlugs, 20)) add('api-catalogue-slug', `/_api/catalogue?slug=${enc(s)}`);
  const categories = col('SELECT DISTINCT category FROM maps WHERE category IS NOT NULL ORDER BY category');
  for (const c of sample(categories, 10)) add('api-catalogue-category', `/_api/catalogue?category=${enc(c)}`);
  for (const name of ['catalogue', 'places', 'people']) add('catalogue-doc', `/data/catalogue/${name}.json`);
  // The pane's documents at their new URLs (side B), against the old file (side A).
  for (const [name, view] of [['catalogue', 'pane'], ['places', 'places'], ['people', 'people']]) {
    add('catalogue-doc-api', `/data/catalogue/${name}.json`, 'json', { urlB: `/_api/catalogue?view=${view}` });
  }
  add('layers-full', '/render/metadata/maps-test.json', 'json', { follow: true, expect: '/_api/layers' });
  add('layers-index', '/render/metadata/maps-test-index.json', 'json', { follow: true, expect: '/_api/layers?view=index' });
  const layerIds = col('SELECT layer_id FROM layers ORDER BY layer_id');
  const fileName = (/** @type {string} */ id) => `${String(id).replace(/[^A-Za-z0-9_.-]+/g, '-')}.json`;
  for (const id of sample(layerIds, 60)) {
    add('layer-detail', `/render/metadata/layer-details-test2/${fileName(id)}`, 'json', { follow: true, expect: `/_api/layers/${enc(id)}` });
  }
  const withDupes = col('SELECT layer_id FROM layers WHERE duplicates IS NOT NULL ORDER BY layer_id');
  for (const id of sample(withDupes, 30)) {
    add('layer-duplicates', `/render/metadata/duplicate-feature-ids/${fileName(id)}`, 'json', { follow: true, expect: `/_api/layers/${enc(id)}/duplicates` });
  }
  // Another spelling of a layer id: on side B its record (through the alias's 301, then the API),
  // against the live id's old detail file on side A.
  const aliases = /** @type {{ alias: string, layer_id: string }[]} */ (db.prepare('SELECT alias, layer_id FROM layer_aliases ORDER BY alias').all())
    .filter((r) => !/-test$/.test(r.alias)).map((r) => `${r.alias}|${r.layer_id}`);
  for (const a of sample(aliases, 20)) {
    const [alias, id] = a.split('|');
    add('layer-alias', `/render/metadata/layer-details-test2/${fileName(id)}`, 'json', { follow: true, urlB: `/_api/layers/${enc(alias)}`, expect: `/_api/layers/${enc(id)}` });
  }
  for (const f of ['maps.json', 'features.json']) add('browse-maps-file', `/data/browse/${f}`);
  const cards = col('SELECT slug FROM map_cards ORDER BY slug');
  for (const s of sample(cards, 60)) add('browse-map-detail', `/data/browse/details/maps/${s}.json`);
  for (const s of sample(cards, 40)) add('page-maps', `/browse/maps/${enc(s)}`, 'html');
  add('proni-roots', '/data/browse/proni-roots.json', 'json', { follow: true, expect: '/_api/proni/node' });
  // The pane's search over each side's documents (src/catalogue/search.js): one entry per query.
  for (const q of CATALOGUE_QUERIES) add('catalogue-search', `search:${q}`, 'search');
  for (const q of PEOPLE_QUERIES) add('catalogue-search', `people:${q}`, 'search');
}

// arch-ok R6: search phrases the parity crawl types into the catalogue, not body ids
export const CATALOGUE_QUERIES = ['wards', 'townlands 1911', 'dail constituencies', 'belfast', 'census', 'counties', 'parishes',
  'baronies', 'local government districts 2012', 'stormont 1929', 'poor law unions', 'electoral divisions', 'westminster 1885',
  'assembly areas', 'dispensary districts', 'derry', 'cork', 'flood', 'railways', 'lidar', 'geology', 'roads', 'schools', 'garda',
  'small areas 2022', 'super output areas', 'urban districts', 'rural districts 1920s', 'eds munster', 'peat'];
export const PEOPLE_QUERIES = ['paisley', 'hume', 'devlin', 'kelly', 'mary mcaleese'];

// ---------------------------------------------------------------- fetching
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const isLocal = (/** @type {string} */ base) => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base);

/**
 * GET `url` from `base` (a 5xx retried twice), following redirects with `follow`. Null only
 * past the last attempt, which always returns.
 * @param {string} base
 * @param {string} url
 * @param {{ follow?: boolean }} [options]
 * @returns {Promise<Fetched | null>}
 */
async function get(base, url, { follow = false } = {}) {
  if (follow) {
    const first = await get(base, url);
    if (!first || first.status < 300 || first.status >= 400 || !first.location) return first;
    const target = new URL(first.location, `${base}${url}`);
    const hop = { status: first.status, location: `${target.pathname}${target.search}` };
    // An alias may redirect twice (alias -> live id); the expected hop is the last one.
    const next = /** @type {Fetched} */ (await get(base, hop.location, { follow: true }));
    return { ...next, hop: next.hop || hop };
  }
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(base + url, { redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' } });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status >= 500 && attempt < 3) { await sleep(2000 * attempt); continue; }
      return { status: res.status, location: res.headers.get('location'), type: res.headers.get('content-type') || '', body, ms: Date.now() - started };
    } catch (error) {
      if (attempt === 3) return { status: 0, error: String(/** @type {Error} */ (error).message || error), body: Buffer.alloc(0), ms: Date.now() - started };
      await sleep(2000 * attempt);
    }
  }
  return null;
}

// ---------------------------------------------------------------- the catalogue pane's search

/** Each side's catalogue, places and people documents (A at the file URLs, B at the API's). */
async function searchDocuments() {
  const load = async (/** @type {string} */ base, /** @type {Record<string, string>} */ urls) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, url] of Object.entries(urls)) {
      const r = await get(base, url);
      try { out[k] = r && r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; } catch { out[k] = null; }
      if (!isLocal(base)) await sleep(DELAY_A);
    }
    return out;
  };
  const docsA = await load(A, { catalogue: '/data/catalogue/catalogue.json', places: '/data/catalogue/places.json', people: '/data/catalogue/people.json' });
  const docsB = await load(B, { catalogue: '/_api/catalogue?view=pane', places: '/_api/catalogue?view=places', people: '/_api/catalogue?view=people' });
  /** @returns {SearchEngines | null} */
  const engines = (/** @type {Record<string, unknown>} */ docs) => {
    if (!docs.catalogue || !docs.people) return null;
    const maps = new CatalogueSearch(/** @type {ConstructorParameters<typeof CatalogueSearch>[0]} */ (docs.catalogue));
    if (docs.places) maps.setPlaces(/** @type {Parameters<CatalogueSearch['setPlaces']>[0]} */ (docs.places));
    return { maps, people: new PeopleSearch(/** @type {ConstructorParameters<typeof PeopleSearch>[0]} */ (docs.people)) };
  };
  return { a: engines(docsA), b: engines(docsB) };
}

/**
 * @param {CrawlUrl} u
 * @param {{ a: SearchEngines | null, b: SearchEngines | null } | null} searches
 * @returns {CompareResult}
 */
export function compareSearch(u, searches) {
  const base = { kind: u.kind, url: u.url, statusA: searches?.a ? 200 : 0, statusB: searches?.b ? 200 : 0 };
  if (!searches?.a || !searches?.b) return { ...base, result: 'status', note: 'a side could not load the catalogue documents' };
  const at = u.url.indexOf(':');
  const which = u.url.slice(0, at);
  const q = u.url.slice(at + 1);
  const run = (/** @type {SearchEngines} */ e) => JSON.stringify(which === 'people' ? e.people.query(q, { limit: 50 }) : e.maps.query(q));
  const ra = run(searches.a);
  const rb = run(searches.b);
  return ra === rb ? { ...base, result: 'same', note: `${JSON.parse(ra).length} results` } : { ...base, result: 'data', diff: firstDiff(JSON.parse(ra), JSON.parse(rb)) };
}

// ---------------------------------------------------------------- comparing
const DROP = new Set(['generatedAt', 'builtAt']);
/**
 * The value with generatedAt / builtAt dropped at any depth.
 * @param {unknown} v
 * @returns {unknown}
 */
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Object.keys(v)) if (!DROP.has(k)) out[k] = clean(/** @type {Record<string, unknown>} */ (v)[k]);
    return out;
  }
  return v;
}
/**
 * The value with object keys sorted and arrays sorted by their JSON.
 * @param {unknown} v
 * @returns {unknown}
 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon).map((x) => JSON.stringify(x)).sort().map((s) => JSON.parse(s));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(/** @type {Record<string, unknown>} */ (v)[k])]));
  return v;
}
const stable = (/** @type {unknown} */ v) => JSON.stringify(canon(v));
/**
 * The value with object keys sorted (arrays keep their order).
 * @param {unknown} v
 * @returns {unknown}
 */
const sorted = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(/** @type {Record<string, unknown>} */ (v)[k])])) : Array.isArray(v) ? v.map(sorted) : v);

/**
 * The first path at which two JSON values differ, with both values (clipped).
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [at]
 * @returns {Diff | null}
 */
export function firstDiff(a, b, at = '$') {
  if (JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { path: `${at}.length`, a: a.length, b: b.length };
    for (let i = 0; i < a.length; i += 1) { const d = firstDiff(a[i], b[i], `${at}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!(k in a)) return { path: `${at}.${k}`, a: '(absent)', b: clip(/** @type {Record<string, unknown>} */ (b)[k]) };
      if (!(k in b)) return { path: `${at}.${k}`, a: clip(/** @type {Record<string, unknown>} */ (a)[k]), b: '(absent)' };
      const d = firstDiff(/** @type {Record<string, unknown>} */ (a)[k], /** @type {Record<string, unknown>} */ (b)[k], `${at}.${k}`); if (d) return d;
    }
    return null;
  }
  return { path: at, a: clip(a), b: clip(b) };
}
const clip = (/** @type {unknown} */ v) => { const s = JSON.stringify(v); return s && s.length > 200 ? `${s.slice(0, 200)}...` : v; };

/** @param {Buffer} body */
function htmlHead(body) {
  const text = body.toString('utf8');
  const pick = (/** @type {RegExp} */ re) => (text.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
  return {
    title: pick(/<title>([^<]*)<\/title>/i),
    description: pick(/<meta\s+name="description"\s+content="([^"]*)"/i),
    canonical: pick(/<link\s+rel="canonical"\s+href="([^"]*)"/i),
  };
}

/**
 * @param {CrawlUrl} u
 * @param {Fetched} a
 * @param {Fetched} b
 * @returns {CompareResult}
 */
export function compare(u, a, b) {
  const base = { kind: u.kind, url: u.url, statusA: a.status, statusB: b.status, ...(u.urlB ? { urlB: u.urlB } : {}) };
  // A renamed URL: B must redirect where the rename says (A, the old site, may answer directly).
  if (u.expect && (!b.hop || b.hop.location !== u.expect)) return { ...base, result: 'redirect', a: a.hop?.location || '(direct)', b: b.hop?.location || '(no redirect)', expected: u.expect };
  const sha = (/** @type {Buffer} */ buf) => createHash('sha1').update(buf).digest('hex').slice(0, 12);
  if (a.status !== b.status) return { ...base, result: 'status', note: a.error || b.error || undefined };
  if (a.status >= 300 && a.status < 400) {
    const loc = (/** @type {unknown} */ l) => String(l || '').replace(/^https?:\/\/[^/]+/, '');
    return loc(a.location) === loc(b.location) ? { ...base, result: 'same' } : { ...base, result: 'redirect', a: a.location, b: b.location };
  }
  if (a.status !== 200) return { ...base, result: 'same' };
  if (u.mode === 'html') {
    const ha = htmlHead(a.body);
    const hb = htmlHead(b.body);
    const keys = /** @type {('title' | 'description' | 'canonical')[]} */ (['title', 'description', 'canonical']).filter((k) => ha[k] !== hb[k]);
    return keys.length ? { ...base, result: 'html', fields: keys.map((k) => ({ field: k, a: ha[k], b: hb[k] })) } : { ...base, result: 'same' };
  }
  if (sha(a.body) === sha(b.body)) return { ...base, result: 'same', bytes: a.body.length };
  /** @type {unknown} */
  let ja;
  /** @type {unknown} */
  let jb;
  try { ja = clean(JSON.parse(a.body.toString('utf8'))); jb = clean(JSON.parse(b.body.toString('utf8'))); } catch {
    return { ...base, result: 'bytes', bytesA: a.body.length, bytesB: b.body.length };
  }
  const intended = NORMALISE[u.kind];
  if (intended) { ja = intended(/** @type {{ layers?: LayerIndexEntry[] }} */ (ja)); jb = intended(/** @type {{ layers?: LayerIndexEntry[] }} */ (jb)); }
  if (JSON.stringify(sorted(ja)) === JSON.stringify(sorted(jb))) return { ...base, result: 'same', note: `equal after dropping generatedAt / key order${intended ? ' / the intended differences of its kind' : ''}` };
  if (stable(ja) === stable(jb)) return { ...base, result: 'order', diff: firstDiff(ja, jb) };
  return { ...base, result: 'data', diff: firstDiff(ja, jb), bytesA: a.body.length, bytesB: b.body.length };
}

/**
 * @param {CrawlUrl[]} urls
 * @returns {Promise<CompareResult[]>}
 */
async function crawl(urls) {
  /** @type {CompareResult[]} */
  const results = new Array(urls.length);
  /** @type {(Fetched | null)[]} */
  const fetchB = new Array(urls.length);
  // B (local) in parallel; A (production) one at a time, politely.
  let next = 0;
  const workerB = async () => {
    while (next < urls.length) {
      const i = next;
      next += 1;
      const u = urls[i];
      if (u.mode !== 'search') fetchB[i] = await get(B, u.urlB || u.url, { follow: Boolean(u.follow) });
    }
  };
  const bDone = Promise.all(Array.from({ length: isLocal(B) ? CONC_B : 1 }, workerB));
  await bDone;
  const searches = urls.some((u) => u.mode === 'search') ? await searchDocuments() : null;
  for (let i = 0; i < urls.length; i += 1) {
    if (urls[i].mode === 'search') { results[i] = compareSearch(urls[i], searches); continue; }
    const a = await get(A, urls[i].url, { follow: Boolean(urls[i].follow) });
    results[i] = compare(urls[i], /** @type {Fetched} */ (a), /** @type {Fetched} */ (fetchB[i]));
    if (!isLocal(A)) await sleep(DELAY_A);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${urls.length}`);
  }
  // A transient 5xx on either side (production answers 500 while a legacy D1 reload has its
  // tables dropped) is fetched again once, a minute later, before it counts as a difference.
  const again = results.map((r, i) => (r.result === 'status' && (r.statusA >= 500 || r.statusB >= 500 || !r.statusA || !r.statusB) ? i : -1)).filter((i) => i >= 0);
  if (again.length) {
    console.log(`  retrying ${again.length} URL(s) that answered 5xx`);
    await sleep(60_000);
    for (const i of again) {
      const a = await get(A, urls[i].url);
      const b = await get(B, urls[i].url);
      results[i] = { ...compare(urls[i], /** @type {Fetched} */ (a), /** @type {Fetched} */ (b)), retried: true };
      if (!isLocal(A)) await sleep(DELAY_A);
    }
  }
  return results;
}

async function main() {
  const db = openSqliteHandle(DB, { readOnly: true });
  const urls = buildUrlList(db);
  db.close();
  console.log(`parity: ${urls.length} URLs, A=${A} B=${B}`);
  const t0 = Date.now();
  const results = await crawl(urls);
  /** @type {Record<string, { urls: number, same: number, differ: number }>} */
  const byKind = {};
  for (const r of results) {
    const k = (byKind[r.kind] ||= { urls: 0, same: 0, differ: 0 });
    k.urls += 1;
    if (r.result === 'same') k.same += 1; else k.differ += 1;
  }
  const differences = results.filter((r) => r.result !== 'same');
  const report = { a: A, b: B, seed: SEED, scale: SCALE, ranAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), urls: urls.length, differences: differences.length, byKind, results: differences };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  for (const [kind, k] of Object.entries(byKind)) console.log(`  ${kind.padEnd(24)} ${String(k.urls).padStart(4)} urls  ${k.differ ? `${k.differ} differ` : 'all same'}`);
  console.log(`${differences.length ? 'DIFFERENCES' : 'PASS'}: ${differences.length} of ${urls.length} URLs differ (report: ${path.relative(REPO_ROOT, OUT)})`);
  return differences.length ? 1 : 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'parity-crawl.mjs') {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 2; });
}
