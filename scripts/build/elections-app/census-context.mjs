#!/usr/bin/env node
/**
 * The Elections app's census context (el-context, 14 Nov 2026): a few standard census indicators
 * for each Northern Ireland electoral area whose boundaries a census was published on, or nests
 * into exactly, written to site/apps/elections/census/ni-areas.json. The app's area context
 * (site/apps/elections/lib/census-context.js) ranks each area among the others of its set and
 * finds the areas most like it; this script only gathers the counts.
 *
 * The boundary sets and the census each one has (the census published at that geography, or at
 * one that nests in it exactly, so no figure is estimated):
 *
 *   dea-2014  the 80 District Electoral Areas of 2014 (councils 2014, 2019, 2023; layer
 *             deas-2012-vector): Census 2021, NISRA's flexible table builder at DEA 2014;
 *   dea-1993  the 101 District Electoral Areas of 1993 (councils 1993 to 2011; deas-1993-vector):
 *             Census 2001 and 2011 Key Statistics by ward, summed into DEAs. The 582 wards of
 *             1992 nest in the 1993 DEAs; each ward's DEA comes from the 2001 Output Areas'
 *             crosswalk (derived/oa2001_to_deas.csv: an Output Area code starts with its ward's);
 *   pc-2008   the 18 constituencies of 2008 (Westminster 2010 to 2019, Assembly 2011 to 2022):
 *             Census 2011 Key Statistics at Assembly Area;
 *   pc-1995   the 18 constituencies of 1995 (Westminster 1997 to 2005, Assembly 1998 and 2003):
 *             Census 2001 Key Statistics at parliamentary constituency.
 *
 * Not held: the constituencies of 2023 (no census table is held at that geography, and Data
 * Zones do not nest in them), Republic of Ireland areas (no CSO table is held in the repository
 * at electoral-area level). The app says "not yet held" for them.
 *
 * The indicators are standard, not sensitive ones (no religion, national identity or health):
 * usual residents, aged 65 and over, owner-occupied and socially rented households, households
 * with no car or van, level 4 qualifications or above, and unemployment. Each is kept as its
 * numerator and denominator so the app can rank areas and give the Northern Ireland figure.
 *
 * Sources: Civgraph's copies of the NISRA tables on its data host (data/census/ on
 * SITE.dataOrigin: nisra-ftb/, 2001-cleaned/, 2011-cleaned/, derived/), the same files the
 * Census Explorer reads. NISRA census data: Open Government Licence v3.0. Each area is named as
 * its layer's feature index names it (render/metadata/feature-indexes/<layer>.json), and the
 * script fails if any census area or any feature is left unmatched.
 *
 *   node scripts/build/elections-app/census-context.mjs                 fetch from the data host, write
 *   node scripts/build/elections-app/census-context.mjs --from <dir>    read a local copy laid out as data/census/
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { SITE } from '@civgraph/config/node';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const OUT = 'site/apps/elections/census/ni-areas.json';
const fromFlag = process.argv.indexOf('--from');
const FROM = fromFlag > 0 ? path.resolve(String(process.argv[fromFlag + 1])) : null;

/**
 * One area's figures: indicator id -> [value] (a count) or [numerator, denominator].
 * @typedef {Record<string, number[]>} AreaFigures
 * @typedef {{ code: string, title: string }} TableRef
 * @typedef {{ year: number, date: string, source: string, tables: Record<string, TableRef>, areas: Record<string, AreaFigures> }} CensusBlock
 */

/** A source file's text: from --from, else the data host (our own service). @param {string} rel */
async function source(rel) {
  /** @type {Buffer} */
  let buf;
  if (FROM) buf = readFileSync(path.join(FROM, rel));
  else {
    const res = await fetch(`${SITE.dataOrigin}/data/census/${rel}`);
    if (!res.ok) throw new Error(`${res.status} for data/census/${rel}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  return (rel.endsWith('.gz') ? gunzipSync(buf) : buf).toString('utf8');
}

/** RFC 4180 rows of a CSV text. @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** An area name's matching key: letters and digits only, upper case, "&" as AND. @param {string} name */
export const areaKey = (name) => String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]/g, '');

/**
 * Sum category counts into each geography's figures.
 * @param {Map<string, Record<string, number>>} into geography code -> indicator part -> count
 * @param {string} code
 * @param {Record<string, number>} parts
 */
function add(into, code, parts) {
  const cur = into.get(code) || {};
  for (const [k, v] of Object.entries(parts)) cur[k] = (cur[k] || 0) + v;
  into.set(code, cur);
}

/**
 * A long KS table (Geography Code, Geography Label, Category 1, Count) as code -> category -> count,
 * with each code's label.
 * @param {string} text
 */
function ksTable(text) {
  const rows = parseCsv(text);
  /** @type {Map<string, Map<string, number>>} */
  const out = new Map();
  /** @type {Map<string, string>} */
  const labels = new Map();
  const head = /** @type {string[]} */ (rows[0]);
  const cat = head.indexOf('Category 1');
  const count = head.length - 1;
  for (const r of rows.slice(1)) {
    const m = out.get(/** @type {string} */ (r[0])) || new Map();
    // KS17 (2001) has three category columns: the households total, a heading and the category.
    const key = head.length > 4 ? r.slice(cat + 1, count).join(' | ') : r[cat];
    m.set(key, Number(r[count]));
    if (head.length > 4) m.set('__total', Number(r[cat]));
    out.set(/** @type {string} */ (r[0]), m);
    labels.set(/** @type {string} */ (r[0]), /** @type {string} */ (r[1]));
  }
  return { out, labels };
}

/**
 * The sum of the categories that match each pattern (exactly one category must match each).
 * @param {Map<string, number>} cats @param {RegExp[]} patterns @param {string} where
 */
function pick(cats, patterns, where) {
  let sum = 0;
  for (const re of patterns) {
    const hits = [...cats.keys()].filter((k) => re.test(k));
    if (hits.length !== 1) throw new Error(`${where}: ${re} matched ${hits.length} categories (${hits.join('; ')})`);
    sum += /** @type {number} */ (cats.get(/** @type {string} */ (hits[0])));
  }
  return sum;
}

/**
 * The Key Statistics indicators of one census (2001 or 2011), by geography code.
 * @param {2001 | 2011} year
 * @param {string} geo the file's geography suffix
 * @returns {Promise<{ figures: Map<string, Record<string, number>>, labels: Map<string, string>, tables: Record<string, TableRef> }>}
 */
async function keyStatistics(year, geo) {
  const dir = `${year}-cleaned/`;
  /** @type {Record<string, { code: string, title: string, parts: Record<string, RegExp[]> }>} */
  const spec = year === 2011 ? {
    residents: { code: 'KS101NI', title: 'Usual resident population', parts: { v: [/^All usual residents$/] } },
    age65: { code: 'KS102NI', title: 'Age structure', parts: { n: [/^Age 65-74 years$/, /^Age 75-84 years$/, /^Age 85-89 years$/, /^Age 90\+ years$/], d: [/^All usual residents$/] } },
    owner: { code: 'KS402NI', title: 'Tenure and landlord', parts: { n: [/^Owner occupied: Owns outright$/, /^Owner occupied: Owns with a mortgage or loan$/, /^Shared ownership$/], d: [/^All households$/] } },
    social: { code: 'KS402NI', title: 'Tenure and landlord', parts: { n: [/^Rented from: Northern Ireland Housing Executive$/, /^Rented from: Housing association or charitable trust$/], d: [/^All households$/] } },
    nocar: { code: 'KS405NI', title: 'Car or van availability', parts: { n: [/^No cars or vans in household$/], d: [/^All households$/] } },
    level4: { code: 'KS501NI', title: 'Qualifications and students', parts: { n: [/^Highest level of qualification: Level 4 qualifications and above: Aged 16\+ years$/], d: [/^All usual residents: Aged 16\+ years$/] } },
    unemployed: { code: 'KS601NI', title: 'Economic activity', parts: { n: [/^Economically active: Unemployed: Aged 16-74 years$/], d: [/^Economically active: Employee: Part-time/, /^Economically active: Employee: Full-time/, /^Economically active: Self-employed/, /^Economically active: Unemployed: Aged 16-74 years$/, /^Economically active: Full-time student/] } },
  } : {
    residents: { code: 'KS01', title: 'Usually resident population', parts: { v: [/^All persons$/] } },
    age65: { code: 'KS02', title: 'Age structure', parts: { n: [/^Persons aged 65-74$/, /^Persons aged 75-84$/, /^Persons aged 85-89$/, /^Persons aged 90 and over$/], d: [/^All persons$/] } },
    owner: { code: 'KS18', title: 'Tenure', parts: { n: [/Owner occupied: Owns outright$/, /Owner occupied: Owns with a mortgage or loan$/, /Owner occupied: Shared ownership/], d: [/^All households$/] } },
    social: { code: 'KS18', title: 'Tenure', parts: { n: [/rented from.*Northern Ireland Housing Executive$/i, /rented from.*Housing Association/i], d: [/^All households$/] } },
    nocar: { code: 'KS17', title: 'Cars or vans', parts: { n: [/^Households with: \| No cars or vans$/], d: [/^__total$/] } },
    level4: { code: 'KS13', title: 'Qualifications and students', parts: { n: [/Highest qualification attained: Level 4/, /Highest qualification attained: Level 5/], d: [/^All persons aged 16-74$/] } },
    unemployed: { code: 'KS09a', title: 'Economic activity - all persons', parts: { n: [/Economically active, Unemployed$/], d: [/Economically active, {1,2}Employee - full-time/, /Economically active, {1,2}Employee - part-time/, /Economically active, Self-employed$/, /Economically active, Unemployed$/, /Economically active, Full-time student$/] } },
  };
  /** @type {Map<string, Record<string, number>>} */
  const figures = new Map();
  /** @type {Map<string, string>} */
  let labels = new Map();
  /** @type {Map<string, Awaited<ReturnType<typeof ksTable>>>} */
  const files = new Map();
  for (const [id, s] of Object.entries(spec)) {
    if (!files.has(s.code)) files.set(s.code, ksTable(await source(`${dir}${s.code}__${geo}.csv.gz`)));
    const { out, labels: l } = /** @type {Awaited<ReturnType<typeof ksTable>>} */ (files.get(s.code));
    labels = l;
    for (const [code, cats] of out) {
      /** @type {Record<string, number>} */
      const parts = {};
      for (const [part, res] of Object.entries(s.parts)) parts[`${id}.${part}`] = pick(cats, res, `${s.code} ${geo} ${code}`);
      add(figures, code, parts);
    }
  }
  /** @type {Record<string, TableRef>} */
  const tables = Object.fromEntries(Object.entries(spec).map(([id, s]) => [id, { code: s.code, title: s.title }]));
  return { figures, labels, tables };
}

/**
 * Census 2021 at DEA 2014, from the flexible table builder's one-variable tables.
 * @returns {Promise<{ figures: Map<string, Record<string, number>>, labels: Map<string, string>, tables: Record<string, TableRef> }>}
 */
async function census2021Dea() {
  /** @type {Array<{ id: string, file: string, code: string, title: string, n: (c: string) => boolean, d: (c: string) => boolean }>} */
  const spec = [
    { id: 'residents', file: 'PEOPLE__DEA14~AGE_BAND_BROAD', code: 'AGE_BAND_BROAD', title: 'Age - 4 categories (usual residents)', n: () => true, d: () => false },
    { id: 'age65', file: 'PEOPLE__DEA14~AGE_BAND_BROAD', code: 'AGE_BAND_BROAD', title: 'Age - 4 categories (usual residents)', n: (c) => c === '4', d: () => true },
    { id: 'owner', file: 'HOUSEHOLD__DEA14~HH_TENURE_AGG7', code: 'HH_TENURE_AGG7', title: 'Tenure - 7 categories (households)', n: (c) => c === '1' || c === '2', d: () => true },
    { id: 'social', file: 'HOUSEHOLD__DEA14~HH_TENURE_AGG7', code: 'HH_TENURE_AGG7', title: 'Tenure - 7 categories (households)', n: (c) => c === '3' || c === '4', d: () => true },
    { id: 'nocar', file: 'HOUSEHOLD__DEA14~HH_CAR_VAN_TC5', code: 'HH_CAR_VAN_TC5', title: 'Car or van availability (households)', n: (c) => c === '0', d: () => true },
    { id: 'level4', file: 'PEOPLE__DEA14~HIGHEST_QUALIFICATION', code: 'HIGHEST_QUALIFICATION', title: 'Qualifications (highest level)', n: (c) => c === '5', d: (c) => c !== '-8' },
    { id: 'unemployed', file: 'PEOPLE__DEA14~ECONOMIC_ACTIVITY_AGG9', code: 'ECONOMIC_ACTIVITY_AGG9', title: 'Economic activity - 9 categories', n: (c) => c === '3', d: (c) => c === '1' || c === '2' || c === '3' },
  ];
  /** @type {Map<string, Record<string, number>>} */
  const figures = new Map();
  /** @type {Map<string, string>} */
  const labels = new Map();
  /** @type {Map<string, string[][]>} */
  const files = new Map();
  for (const s of spec) {
    if (!files.has(s.file)) files.set(s.file, parseCsv(await source(`nisra-ftb/${s.file}.csv.gz`)));
    const rows = /** @type {string[][]} */ (files.get(s.file));
    for (const r of rows.slice(1)) {
      const [code, label, cat, count] = [/** @type {string} */ (r[0]), /** @type {string} */ (r[1]), /** @type {string} */ (r[2]), Number(r[4])];
      labels.set(code, label);
      const isCount = s.id === 'residents';
      add(figures, code, isCount ? { [`${s.id}.v`]: count } : { [`${s.id}.n`]: s.n(cat) ? count : 0, [`${s.id}.d`]: s.d(cat) ? count : 0 });
    }
  }
  /** @type {Record<string, TableRef>} */
  const tables = Object.fromEntries(spec.map((s) => [s.id, { code: s.code, title: s.title }]));
  return { figures, labels, tables };
}

/** Each 1992 ward's 1993 DEA, from the 2001 Output Areas' crosswalk. @returns {Promise<Map<string, string>>} */
async function wardsToDea1993() {
  const rows = parseCsv(await source('derived/oa2001_to_deas.csv'));
  const col = /** @type {string[]} */ (rows[0]).indexOf('dea_1993');
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const r of rows.slice(1)) {
    const ward = /** @type {string} */ (r[0]).slice(0, 6);
    const dea = /** @type {string} */ (r[col]);
    if (out.has(ward) && out.get(ward) !== dea) throw new Error(`ward ${ward} lies in two 1993 DEAs (${out.get(ward)}, ${dea})`);
    out.set(ward, dea);
  }
  return out;
}

/** The feature names of a layer, by matching key. @param {string} layer */
function featureNames(layer) {
  const idx = JSON.parse(readFileSync(path.join(REPO, 'render/metadata/feature-indexes', `${layer}.json`), 'utf8'));
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const it of idx.items) out.set(areaKey(it.name), it.name);
  return out;
}

/**
 * Figures by code -> figures by the layer's feature name (summing codes that share an area), each
 * indicator as [value] or [numerator, denominator]; every area and feature matched.
 * @param {Map<string, Record<string, number>>} figures
 * @param {(code: string) => string} areaOf the area name of a code
 * @param {string} layer
 * @returns {Record<string, AreaFigures>}
 */
function byArea(figures, areaOf, layer) {
  const names = featureNames(layer);
  /** @type {Map<string, Record<string, number>>} */
  const summed = new Map();
  for (const [code, parts] of figures) {
    const name = names.get(areaKey(areaOf(code)));
    if (!name) throw new Error(`${layer}: no feature for census area "${areaOf(code)}" (${code})`);
    add(summed, name, parts);
  }
  const missing = [...names.values()].filter((n) => !summed.has(n));
  if (missing.length) throw new Error(`${layer}: no census figures for ${missing.join(', ')}`);
  /** @type {Record<string, AreaFigures>} */
  const out = {};
  for (const name of [...summed.keys()].sort()) {
    const parts = /** @type {Record<string, number>} */ (summed.get(name));
    /** @type {AreaFigures} */
    const area = {};
    for (const id of INDICATOR_IDS) area[id] = parts[`${id}.v`] !== undefined ? [/** @type {number} */ (parts[`${id}.v`])] : [/** @type {number} */ (parts[`${id}.n`]), /** @type {number} */ (parts[`${id}.d`])];
    out[name] = area;
  }
  return out;
}

/** The indicators, in display order (labels and definitions: site/apps/elections/lib/census-context.js). */
export const INDICATOR_IDS = Object.freeze(['residents', 'age65', 'owner', 'social', 'nocar', 'level4', 'unemployed']);

const CENSUS = {
  2001: { date: '2001-04-29', source: 'NISRA Census 2001 Key Statistics' },
  2011: { date: '2011-03-27', source: 'NISRA Census 2011 Key Statistics' },
  2021: { date: '2021-03-21', source: 'NISRA Census 2021 flexible table builder' },
};

async function main() {
  const ward2dea = await wardsToDea1993();
  const ks2001pc = await keyStatistics(2001, 'PARLCON2001');
  const ks2011aa = await keyStatistics(2011, 'AA2014');
  const ks2001w = await keyStatistics(2001, 'WARD2001');
  const ks2011w = await keyStatistics(2011, 'WARD2014');
  const c2021 = await census2021Dea();
  const deaOf = (/** @type {string} */ code) => {
    const dea = ward2dea.get(code);
    if (!dea) throw new Error(`ward ${code} has no 1993 DEA`);
    return dea;
  };
  /** @param {2001 | 2011 | 2021} year @param {{ tables: Record<string, TableRef> }} t @param {Record<string, AreaFigures>} areas @param {string} geography @returns {CensusBlock & { geography: string }} */
  const block = (year, t, areas, geography) => ({ year, date: CENSUS[year].date, source: CENSUS[year].source, geography, tables: t.tables, areas });
  const out = {
    schemaVersion: 1,
    about: 'Census indicators for Northern Ireland electoral areas, for the Elections app\'s area context. Built by scripts/build/elections-app/census-context.mjs from NISRA census tables (Civgraph\'s copies on its data host). Each indicator is [value] or [numerator, denominator]; areas are named as their layer\'s features.',
    licence: 'NISRA census data: Open Government Licence v3.0',
    licenceUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    indicators: INDICATOR_IDS,
    sets: [
      { id: 'dea-2014', layers: ['deas-2012-vector'], censuses: [block(2021, c2021, byArea(c2021.figures, (c) => /** @type {string} */ (c2021.labels.get(c)), 'deas-2012-vector'), 'District Electoral Areas 2014')] },
      { id: 'dea-1993', layers: ['deas-1993-vector'], censuses: [
        block(2001, ks2001w, byArea(ks2001w.figures, deaOf, 'deas-1993-vector'), 'wards of 1992, summed into District Electoral Areas'),
        block(2011, ks2011w, byArea(ks2011w.figures, deaOf, 'deas-1993-vector'), 'wards of 1992, summed into District Electoral Areas'),
      ] },
      { id: 'pc-2008', layers: ['pc-2008-vector', 'assembly-areas-2008-alias'], censuses: [block(2011, ks2011aa, byArea(ks2011aa.figures, (c) => /** @type {string} */ (ks2011aa.labels.get(c)), 'pc-2008-vector'), 'Assembly Areas')] },
      { id: 'pc-1995', layers: ['pc-1995-vector', 'assembly-areas-1995-alias'], censuses: [block(2001, ks2001pc, byArea(ks2001pc.figures, (c) => /** @type {string} */ (ks2001pc.labels.get(c)), 'pc-1995-vector'), 'parliamentary constituencies')] },
    ],
  };
  mkdirSync(path.dirname(path.join(REPO, OUT)), { recursive: true });
  // One line an area, so a rebuild's diff shows which areas' figures changed.
  const text = JSON.stringify(out, (k, v) => (k === 'areas' ? Object.fromEntries(Object.entries(v).map(([n, a]) => [n, JSON.stringify(a)])) : v), 1)
    .replace(/"(\{\\"residents.*?\})"/g, (_, s) => s.replace(/\\"/g, '"'));
  JSON.parse(text);
  writeFileSync(path.join(REPO, OUT), `${text}\n`);
  const counts = out.sets.map((s) => `${s.id}: ${s.censuses.map((c) => `${c.year} ${Object.keys(c.areas).length}`).join(', ')}`).join('; ');
  console.log(`wrote ${OUT} (${counts})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (FROM && !existsSync(FROM)) throw new Error(`--from ${FROM}: no such directory`);
  await main();
}
