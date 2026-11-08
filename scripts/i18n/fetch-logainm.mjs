#!/usr/bin/env node
/**
 * Fill Irish place names from the Placenames Database of Ireland (Logainm) API.
 *
 * PIPELINE ONLY: it needs an API key that the site owner must request personally from the Gaois
 * Developer Hub (https://www.gaois.ie/en/technology/developers/registration/); an agent must not
 * create that account. Without LOGAINM_API_KEY it prints what it would do and stops.
 *
 * TERMS (checked 2026-11-01, https://docs.gaois.ie/en/data/logainm/v1.0/licence and
 * https://logainm.ie/en/about/open-data):
 *   - Logainm data is © Government of Ireland, licensed CC BY 4.0. Attribution: "Irish-language
 *     placename data by Logainm © Government of Ireland and licensed under CC BY 4.0."
 *   - The researchers' explanatory notes and the placename citations from other sources are NOT
 *     under CC BY and must not be reproduced: this script keeps names, ids and categories only.
 *   - The Logainm WEBSITE must not be scraped: only the API is used.
 *   - Each client needs its own API key (X-Api-Key header). Copies must be kept current:
 *     "apply changes in all copies of the data on a monthly basis" -- run with --since monthly.
 *   - No published rate limit; this script makes at most one request per second, caches every
 *     response, and never re-requests a cached id unless --refresh is given.
 *
 * WHAT IT DOES
 *   For each feature in the local crosswalk (scripts/i18n/build-place-name-crosswalk.mjs) that
 *   carries a Logainm id, GET https://www.logainm.ie/api/v1.0/<id> and record the Irish name,
 *   so names the boundary data lacks (blank GAEILGE) or has in an older spelling can be checked
 *   against the current Logainm form. Output: <cache>/logainm-names.tsv (id, english, irish,
 *   category, modified). Nothing is published by this script.
 *
 *   LOGAINM_API_KEY=... node scripts/i18n/fetch-logainm.mjs [--cache <dir>] [--limit 50]
 *   node scripts/i18n/fetch-logainm.mjs --dry-run      list what would be requested
 *
 * The User-Agent is "civgraph-research (+https://civgraph.net)". No personal email or other
 * identifier is ever sent.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SITE } from '../../packages/config/src/node.mjs';

/**
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
// Same cache as build-place-name-crosswalk.mjs: CIVGRAPH_I18N_CACHE, --cache, or tmp/i18n-cache.
const CACHE = arg('--cache', process.env.CIVGRAPH_I18N_CACHE || path.join('tmp', 'i18n-cache'));
const LIMIT = Number(arg('--limit', 0)) || Infinity;
const DRY = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh');
const KEY = process.env.LOGAINM_API_KEY || '';
const API = 'https://www.logainm.ie/api/v1.0/';
const UA = SITE.userAgent;
const DELAY_MS = 1100;

const crosswalk = path.join(CACHE, 'place-name-crosswalk.tsv');
if (!existsSync(crosswalk)) {
  console.error(`No crosswalk at ${crosswalk}: run node scripts/i18n/build-place-name-crosswalk.mjs first.`);
  process.exit(1);
}
/** @type {Map<string, { layer: string, english: string, irish: string }>} Logainm id -> its first crosswalk row */
const ids = new Map();
for (const line of readFileSync(crosswalk, 'utf8').split('\n').slice(1)) {
  const [layer, , english, irish, logainm] = line.split('\t');
  const id = String(logainm || '').trim();
  if (/^\d+$/.test(id) && !ids.has(id)) ids.set(id, { layer, english, irish });
}
console.log(`${ids.size} distinct Logainm ids in the crosswalk.`);

if (!KEY || DRY) {
  console.log(KEY ? 'Dry run: nothing requested.' : 'LOGAINM_API_KEY is not set: stopping before any request (the owner must register for a key).');
  console.log(`Would request up to ${Math.min(ids.size, LIMIT)} ids from ${API}<id>, one per ${DELAY_MS} ms, caching to ${path.join(CACHE, 'logainm-cache')}.`);
  process.exit(0);
}

const cacheDir = path.join(CACHE, 'logainm-cache');
mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(CACHE, 'logainm-names.tsv');
if (!existsSync(outFile)) writeFileSync(outFile, 'logainm_id\tenglish\tirish\tcategory\tmodified\n');
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The parts of a Logainm API place answer read here (names only).
 * @typedef {object} LogainmPlace
 * @property {Array<{ language: string, wording?: string }>} [placenames]
 * @property {{ nameEN?: string }} [category]
 * @property {Array<{ nameEN?: string }>} [categories]
 * @property {string} [modifiedDate]
 */

let done = 0;
for (const [id] of ids) {
  if (done >= LIMIT) break;
  const cached = path.join(cacheDir, `${id}.json`);
  /** @type {LogainmPlace | undefined} */
  let data;
  if (existsSync(cached) && !REFRESH) data = JSON.parse(readFileSync(cached, 'utf8'));
  else {
    const res = await fetch(`${API}${id}`, { headers: { 'X-Api-Key': KEY, 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) { console.error('Rate limited (429): stopping. Re-run later; cached ids are kept.'); break; }
    if (!res.ok) { console.error(`${id}: HTTP ${res.status}`); await sleep(DELAY_MS); continue; }
    data = /** @type {LogainmPlace} */ (await res.json());
    writeFileSync(cached, JSON.stringify(data));
    await sleep(DELAY_MS);
  }
  // Names only: never the explanatory notes or citations (not CC BY).
  const names = Array.isArray(data?.placenames) ? data.placenames : [];
  const ga = names.find((n) => n.language === 'ga')?.wording || '';
  const en = names.find((n) => n.language === 'en')?.wording || '';
  const category = (data?.category?.nameEN || data?.categories?.[0]?.nameEN || '').toString();
  appendFileSync(outFile, `${[id, en, ga, category, data?.modifiedDate || ''].map((v) => String(v).replace(/[\t\n]/g, ' ')).join('\t')}\n`);
  done += 1;
}
console.log(`Recorded ${done} ids in ${outFile}.`);
