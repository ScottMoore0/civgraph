#!/usr/bin/env node
/**
 * Build the data files behind the Census Explorer (pages/census-explorer.html).
 *
 * Every output lands under data/census/ (gitignored) and is published to R2 at the same
 * key under https://data.civgraph.net/, which is where the page reads it from:
 *
 *   data/census/explorer-bundle.json        concepts, the NI table list (2001, 2011, 2021),
 *                                           the geography -> map-layer registry, NI totals and
 *                                           council comparisons, and pointers to the files below
 *   data/census/explorer-roi.json           the ROI census cubes (CSO PxStat), with years, the
 *                                           dimension names that search reads, and map links
 *   data/census/explorer-dz-series.json     small-area series on the 2021 Data Zone frame
 *                                           (1971-2021, mostly ESTIMATED; each year says how)
 *   data/census/explorer/ftb/*.json         the NISRA 2021 flexible-table index (147,492 tables)
 *                                           split into per-dataset, per-geography, per-variable
 *                                           shards, each small enough for a browser
 *
 * INPUTS
 *   data/census/cleaned/concept-ontology.json, comparability-groups.json, availability-graph.json
 *   data/census/derived/*.csv                  crosswalks and derived series (see CONCEPT notes)
 *   scripts/census/explorer/*.json             tracked reference lists: the 2001 bulk-table titles,
 *                                              the 2021 ready-made table list, FTB variable labels
 *   R2 manifests (fetched once into --cache):  data/census/{2001,2011}-cleaned/manifest.json and
 *                                              data/census/nisra-ftb/manifest.json (70 MB)
 *   R2 cleaned tables (into --cache):          the NI- and district-level files the totals use
 *   --pxstat <dir>                             the CSO PxStat mirror (default D:/cso-pxstat):
 *                                              _catalogue.json plus <3>/<code>.json for sizes
 *
 * Every outside request carries the User-Agent "civgraph-research (+https://civgraph.net)" and
 * goes only to data.civgraph.net (Civgraph's own bucket).
 *
 * Usage:
 *   node scripts/census/build-census-explorer-bundle.mjs [--cache <dir>] [--pxstat <dir>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const CACHE = argVal('--cache', existsSync('E:/') ? 'E:/civgraph-census-explorer/r2cache' : path.join(os.tmpdir(), 'civgraph-census-explorer'));
const PXSTAT = argVal('--pxstat', 'D:/cso-pxstat');
const R2 = 'https://data.civgraph.net/';
const UA = 'civgraph-research (+https://civgraph.net)';

const CENSUS = 'data/census';
const CLEANED = `${CENSUS}/cleaned`;
const DERIVED = `${CENSUS}/derived`;
const INPUTS = 'scripts/census/explorer';
const OUT_BUNDLE = `${CENSUS}/explorer-bundle.json`;
const OUT_ROI = `${CENSUS}/explorer-roi.json`;
const OUT_DZ = `${CENSUS}/explorer-dz-series.json`;
const OUT_FTB = `${CENSUS}/explorer/ftb`;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const round = (n, dp = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

// ---------------------------------------------------------------------------------------
// Small CSV reader (RFC 4180 quoting). The inputs here are all a few MB at most.
// ---------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else q = false; } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
function csvObjects(text) {
  const [head, ...rest] = parseCsv(text);
  return rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const readCsv = (p) => csvObjects(readFileSync(p, 'utf8'));
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return v === '' || v == null || !Number.isFinite(n) ? null : n; };

// ---------------------------------------------------------------------------------------
// R2 cache: Civgraph's own published files, fetched once.
// ---------------------------------------------------------------------------------------
async function r2(key) {
  const local = path.join(CACHE, key.replace(/^data\/census\//, ''));
  if (!existsSync(local)) {
    mkdirSync(path.dirname(local), { recursive: true });
    const res = await fetch(R2 + key, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`R2 ${key}: HTTP ${res.status}`);
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 120));
  }
  const buf = readFileSync(local);
  return key.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
}
/** A cleaned 2001/2011 table as rows of { code, label, cats: 'a | b', value }. */
async function cleanedRows(year, table, geo) {
  const text = await r2(`data/census/${year}-cleaned/${table}__${geo}.csv.gz`);
  const [head, ...rows] = parseCsv(text);
  const catIdx = head.map((h, i) => (/^Category \d+$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const vi = head.indexOf('Count');
  return rows.filter((r) => r.length > 2).map((r) => ({
    code: r[0], label: r[1], cats: catIdx.map((i) => r[i]).join(' | '), value: num(r[vi]),
  }));
}

// ---------------------------------------------------------------------------------------
// Public sources, licences and reports.
// ---------------------------------------------------------------------------------------
const NISRA = {
  2001: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/2011-and-earlier-censuses/2001-census', label: 'NISRA, Census 2001' },
  2011: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/2011-and-earlier-censuses/2011-census', label: 'NISRA, Census 2011' },
  2021: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/census/census-2021', label: 'NISRA, Census 2021' },
};
const LICENCES = {
  nisra: { name: 'Open Government Licence v3.0', short: 'OGL v3.0', url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', credit: 'NISRA and GRO NI census material, Crown copyright, under the Open Government Licence v3.0.' },
  cso: { name: 'Creative Commons Attribution 4.0 International', short: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', credit: 'CSO material: contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.' },
};
const CSO_HISTORICAL = { label: 'CSO historical census reports, 1821-1911 (Internet Archive copy)', url: 'https://archive.org/details/civgraph-cso-historical-reports' };

// The Northern Ireland census reports converted to text and published on R2.
const NI_REPORTS = {
  1926: [['General report, part 1', 'data/census/census-1926-part-1.md'], ['Part 2', 'data/census/census-1926-part-2.md']],
  1937: [['General report, part 1', 'data/census/census-1937-part-1.md'], ['Part 2', 'data/census/census-1937-part-2.md']],
  1951: [['General report, part 1', 'data/census/census-1951-part-1.md'], ['Part 2', 'data/census/census-1951-part-2.md']],
  1961: [['General report, part 1', 'data/census/census-1961-part-1.md'], ['Part 2', 'data/census/census-1961-part-2.md']],
  1966: [['General report', 'data/census/census-1966.md']],
  1971: [['Summary tables', 'data/census/census-1971.md']],
  1981: [['Summary report', 'data/census/census-1981.md']],
  1991: [['Summary report (text)', 'data/census/1991/1991-census-summary-report.md'], ['Summary report (NISRA PDF)', 'https://www.nisra.gov.uk/files/nisra/publications/1991-census-summary-report.pdf']],
};
// The 1991 topic reports: Civgraph's text on R2 (the original PDFs are NISRA's; they are
// not on R2, so the PDF link goes to NISRA).
const NI_TOPIC_REPORTS_1991 = {
  religion: ['Religion report', '1991-census-religion-report'],
  irish_language: ['Irish language report', '1991-census-irish-language-report'],
  economic_activity: ['Economic activity report', '1991-census-economic-activity-report'],
  qualifications: ['Education report', '1991-census-education-report'],
  household_composition: ['Household composition report', '1991-census-household-composition-report'],
  travel_to_work: ['Workplace and transport report', '1991-census-workplace-transport-report'],
};
const reportLinks = (year, conceptId) => {
  const out = (NI_REPORTS[year] || []).map(([label, key]) => ({ label: `${year} census: ${label}`, url: /^https?:/.test(key) ? key : R2 + key }));
  if (year === 1991 && NI_TOPIC_REPORTS_1991[conceptId]) {
    const [label, stem] = NI_TOPIC_REPORTS_1991[conceptId];
    out.push({ label: `1991 census: ${label} (text)`, url: `${R2}data/census/1991/${stem}.md` });
    out.push({ label: `1991 census: ${label} (NISRA PDF)`, url: `https://www.nisra.gov.uk/files/nisra/publications/${stem}.pdf` });
  }
  return out;
};

// ---------------------------------------------------------------------------------------
// Geography registry: every geography a table or cube is published at, with the Civgraph
// boundary layer that draws it. Map ids are checked against data/database/maps.json below.
// ---------------------------------------------------------------------------------------
const GEO = {
  // Northern Ireland
  NI: { label: 'Northern Ireland', map: null },
  LGD2001: { label: 'Local Government Districts (26, 1993-2015)', map: 'lgd-1993' },
  WARD2001: { label: 'Wards (582, 1993-2014)', map: 'wards-2001' },
  OA2001: { label: 'Output Areas 2001', map: 'oa-2001' },
  PARLCON2001: { label: 'Parliamentary constituencies (18, 1997-2010)', map: 'assembly-areas-1995' },
  ELB: { label: 'Education and Library Boards', map: 'elb-1993' },
  HSSB: { label: 'Health and Social Services Boards', map: null },
  NUTS3: { label: 'NUTS 3 regions (NI)', map: null },
  HIGHER: { label: 'Northern Ireland, the 26 districts, boards and trusts', map: 'lgd-1993' },
  SA2011: { label: 'Small Areas 2011', map: 'sa-2011' },
  SOA2011: { label: 'Super Output Areas 2011', map: 'soa-2011' },
  WARD2014: { label: 'Wards (462, 2014-)', map: 'wards-2012' },
  AA2014: { label: 'Assembly Areas (18, 2011-2023)', map: 'assembly-areas-2008' },
  LGD2014: { label: 'Local Government Districts (11, 2015-)', map: 'lgd-2012' },
  DEA2014: { label: 'District Electoral Areas (80, 2014-)', map: 'deas-2012' },
  SDZ2021: { label: 'Super Data Zones 2021', map: 'sdz-2021' },
  DZ2021: { label: 'Data Zones 2021', map: 'dz-2021' },
  SETTLEMENT2015: { label: 'Settlements 2015', map: 'settlements-2015' },
  HSCT: { label: 'Health and Social Care Trusts', map: 'ni-health-trust-boundaries' },
  // Republic of Ireland (CSO PxStat geography classifications)
  ROI_STATE: { label: 'State', map: null },
  ROI_PROVINCE: { label: 'Provinces', map: 'provinces' },
  ROI_COUNTY: { label: 'Counties and cities', map: 'counties-ireland' },
  ROI_LA2014: { label: 'Administrative counties (local authorities, 2014-2019)', map: 'local-authorities-2014' },
  ROI_LA2019: { label: 'Administrative counties (local authorities, 2019-)', map: 'local-authorities-2024' },
  ROI_ED1986: { label: 'Electoral Divisions (1986-2002 censuses)', map: 'eds-1986' },
  ROI_ED2006: { label: 'Electoral Divisions (2006-2016 censuses)', map: 'eds-2006' },
  ROI_ED2022: { label: 'Electoral Divisions (2022 census)', map: 'eds-2022' },
  ROI_SA2011: { label: 'Small Areas (2011 and 2016 censuses)', map: 'roi-small-areas-2011' },
  ROI_SA2022: { label: 'Small Areas (2022 census)', map: 'roi-small-areas-2022' },
  ROI_LEA2008: { label: 'Local Electoral Areas 2008', map: 'roi-lea-2008' },
  ROI_LEA2014: { label: 'Local Electoral Areas 2014', map: 'roi-lea-2014' },
  ROI_LEA2019: { label: 'Local Electoral Areas 2019', map: 'roi-lea-2019' },
  ROI_DAIL2005: { label: 'Dáil constituencies (2005 Act)', map: 'dail-2005' },
  ROI_DAIL2013: { label: 'Dáil constituencies (2013 Act)', map: 'dail-2013' },
  ROI_DAIL2017: { label: 'Dáil constituencies (2017 Act)', map: 'dail-2017' },
  ROI_DAIL2023: { label: 'Dáil constituencies (2023 Act)', map: 'dail-2023' },
  ROI_GAELTACHT: { label: 'Gaeltacht areas', map: 'roi-gaeltacht-areas' },
  ROI_LPA: { label: 'Language Planning Areas', map: 'tailte-gaeltacht-language-planning-area-boundaries-generalised-20m' },
  ROI_TOWN: { label: 'Towns and settlements', map: null },
  ROI_OTHER: { label: 'Other areas', map: null },
};
// Only link a layer the catalogue actually has. Scans ids without loading the 2 MB file
// into anything bigger than a Set.
{
  const ids = new Set();
  for (const m of readFileSync('data/database/maps.json', 'utf8').matchAll(/"id":\s*"([^"]+)"/g)) ids.add(m[1]);
  for (const [k, g] of Object.entries(GEO)) {
    if (g.map && !ids.has(g.map)) { console.warn(`  map layer ${g.map} (for ${k}) is not in maps.json; link dropped`); g.map = null; }
  }
}
const mapHref = (id) => (id ? `/maps/#layers=${encodeURIComponent(id)}` : null);

// ---------------------------------------------------------------------------------------
// Topics: one classifier for NI tables, the 2021 flexible-table variables and ROI cubes.
// Order matters: the first rule that matches wins.
// ---------------------------------------------------------------------------------------
const TOPICS = [
  ['religion', 'Religion and community background', /relig|catholic|protestant|church|denomination|community background/i],
  ['language', 'Language', /irish|gaeilge|gaeltacht|ulster.scots|language|speak|english proficiency|teanga/i],
  ['identity', 'Ethnicity, nationality and identity', /ethnic|national identity|nationality|passport|traveller|citizenship/i],
  ['birthplace', 'Birthplace and migration', /birth|born|migra|usual residence one year|previous residence|year of arrival|moved|address one year|usually resident one year/i],
  ['health', 'Health, disability and care', /health|disab|illness|carer|unpaid care|condition|smok|limiting/i],
  ['housing', 'Housing and accommodation', /tenure|accommodation|dwelling|room|heating|household space|bedroom|rent|landlord|occupancy|housing|vacant|amenit|sewerage|water supply|internet|broadband|year built|fuel|type of private/i],
  ['transport', 'Cars and travel', /car[s ]|car$|cars or van|van|travel|commut|distance to|journey|means of transport|place of work|time leaving|leaving home|place of study/i],
  ['education', 'Education and qualifications', /qualif|education|student|school|degree|third level|apprentice|field of study/i],
  ['work', 'Work and economic activity', /econom|employ|occupation|industr|labour|at work|socio.economic|ns.?sec|social class|hours worked|unemploy|work|job|earnings|volunteer/i],
  ['households', 'Households and families', /household|family|families|marital|civil partner|children|lone parent|couple|living arrangement|married|widow|single|homeless/i],
  ['population', 'Population, age and sex', /populat|age|sex|resident|density|person|males|females|people|enumerat|census/i],
];
const TOPIC_LABEL = Object.fromEntries(TOPICS.map(([id, label]) => [id, label]));
TOPIC_LABEL.other = 'Other';
function topicOf(...texts) {
  const hay = texts.filter(Boolean).join(' ');
  for (const [id, , re] of TOPICS) if (re.test(hay)) return id;
  return 'other';
}

// Sentence case for NISRA's upper-case titles, keeping acronyms.
const KEEP = new Set(['NI', 'HRP', 'FRP', 'NS-SEC', 'NS-SEC.', 'GRP', 'HSCT', 'ELB', 'HSSB', 'NUTS3', 'UK', 'EU', 'TV', 'SOA', 'SA', 'DEA', 'LGD', 'II', 'III', 'IV', 'A', 'B']);
function sentence(s) {
  const t = String(s || '').trim();
  if (!t || t !== t.toUpperCase()) return t;
  const words = t.toLowerCase().split(/(\s+|-|\(|\)|\/|,)/);
  let first = true;
  return words.map((w) => {
    if (!w.trim() || /^[\s\-()/,]+$/.test(w)) return w;
    const up = w.toUpperCase();
    if (KEEP.has(up) && up.length > 1) { first = false; return up; }
    if (/^(irish|ireland|northern|catholic|protestant|presbyterian|methodist|church|christian|england|scotland|wales|europe|european|ulster-scots|ulster)$/.test(w)) { first = false; return w[0].toUpperCase() + w.slice(1); }
    if (first) { first = false; return w[0].toUpperCase() + w.slice(1); }
    return w;
  }).join('').replace(/\(\d\)/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------------------
// 1. Concepts. The ontology is gitignored, so its corrections live here, in git.
// ---------------------------------------------------------------------------------------
const ontology = readJson(`${CLEANED}/concept-ontology.json`);
const comparability = readJson(`${CLEANED}/comparability-groups.json`);
const availability = readJson(`${CLEANED}/availability-graph.json`);

/**
 * Per concept and year, the tables that carry it: [code, role]. Overrides the ontology,
 * which (a) keyed religion as 2001_religion/2001_community_bg, so a plain year lookup found
 * nothing; (b) coded 2001 Knowledge of Irish as KS22, which is "Lone parent households with
 * dependent children" (it is KS24); (c) held free text ("MS-A06 or MS-A02 (5-year bands)",
 * "MS-D01, MS-D02") where codes belong; and (d) mapped 2021 accommodation type to MS-E05,
 * the usual-resident table, where 2001 KS16 and 2011 KS401NI count dwellings and household
 * spaces. Every 2001 and 2011 code was checked against the bulk-file titles on 2026-11-01.
 */
const CONCEPT_TABLES = {
  population_by_area: { 2001: [['KS01']], 2011: [['KS101NI']], 2021: [['MS-A01']] },
  religion: {
    2001: [['KS07a', 'Religion'], ['KS07b', 'Community background']],
    2011: [['KS211NI', 'Religion'], ['KS212NI', 'Religion or religion brought up in']],
    2021: [['MS-B19', 'Religion'], ['MS-B23', 'Religion or religion brought up in']],
  },
  age_structure: { 2001: [['KS02']], 2011: [['KS102NI']], 2021: [['MS-A02', 'Five-year bands'], ['MS-A06', 'Age structure (NI only)']] },
  ethnicity: { 2001: [['KS06']], 2011: [['KS201NI']], 2021: [['MS-B01']] },
  housing_tenure: { 2001: [['KS18']], 2011: [['KS402NI']], 2021: [['MS-E15']] },
  economic_activity: { 2001: [['KS09a']], 2011: [['KS601NI']], 2021: [['MS-H02']] },
  qualifications: { 2001: [['KS13']], 2011: [['KS501NI']], 2021: [['MS-G01']] },
  country_of_birth: { 2001: [['KS05']], 2011: [['KS204NI']], 2021: [['MS-A16']] },
  accommodation_type: { 2001: [['KS16']], 2011: [['KS401NI']], 2021: [['MS-E07', 'Household spaces'], ['MS-E06', 'Households']] },
  car_availability: { 2001: [['KS17']], 2011: [['KS405NI']], 2021: [['MS-E10']] },
  travel_to_work: { 2001: [['KS15']], 2011: [['KS701NI']], 2021: [['MS-I01']] },
  irish_language: { 2001: [['KS24']], 2011: [['KS209NI']], 2021: [['MS-B05']] },
  health_disability: { 2001: [['KS08']], 2011: [['KS301NI']], 2021: [['MS-D01', 'General health'], ['MS-D02', 'Long-term health problem or disability']] },
  marital_status: { 2001: [['KS04']], 2011: [['KS103NI']], 2021: [['MS-A30']] },
  household_composition: { 2001: [['KS20']], 2011: [['KS105NI']], 2021: [['MS-A26']] },
};
// Historical years per concept: the ontology's, plus 1991 where Civgraph holds the 1991
// district table, and 1981/1991 religion (religion-1981-lgd.csv, religion-1991-lgd.csv).
const HISTORICAL_EXTRA = {
  population_by_area: [1991], religion: [1981, 1991], irish_language: [1991], housing_tenure: [1991],
  car_availability: [1991], economic_activity: [1991], qualifications: [1991], health_disability: [1991],
};
// The NI-total indicator series (built in section 6) that illustrate each concept.
const CONCEPT_SERIES = {
  population_by_area: ['population'], religion: ['catholic', 'catholic_bg'], irish_language: ['irish'],
  housing_tenure: ['owner_occupied', 'social_rented'], car_availability: ['no_car'], qualifications: ['level4', 'no_quals'],
  country_of_birth: ['born_ni'], health_disability: ['llti'], economic_activity: ['unemployed'],
};

// ---------------------------------------------------------------------------------------
// 2. NI table list: 2001, 2011 and 2021, with real titles.
// ---------------------------------------------------------------------------------------
const GEO_2001 = { NI: 'NI', LGD2001: 'LGD2001', WARD2001: 'WARD2001', OA2001: 'OA2001', PARLCON2001: 'PARLCON2001', ELB: 'ELB', HSSB: 'HSSB', NUTS3: 'NUTS3' };
const GEO_2011 = { SA2011: 'SA2011', SOA2011: 'SOA2011', WARD2014: 'WARD2014', AA2014: 'AA2014', HIGHER: 'HIGHER' };
const GEO_2021 = { NI: 'NI', LGD: 'LGD2014', DEA: 'DEA2014', SDZ: 'SDZ2021', DZ: 'DZ2021', Ward: 'WARD2014', Settlement: 'SETTLEMENT2015', HSCT: 'HSCT' };
const GEO_ORDER = Object.keys(GEO);
const sortGeos = (list) => [...new Set(list)].sort((a, b) => GEO_ORDER.indexOf(a) - GEO_ORDER.indexOf(b));

const bulk2001 = readJson(`${INPUTS}/ni-2001-bulk-tables.json`).tables;
const tables2021 = readJson(`${INPUTS}/ni-2021-tables.json`).tables;
const FAMILY_2011 = { KS: 'Key Statistics', QS: 'Quick Statistics', DC: 'Detailed Characteristics', LC: 'Local Characteristics' };
const FAMILY_2001_PREFIX = { KS: 'Key Statistics', CAS: 'Census Area Statistics', UV: 'Univariate Tables', S: 'Standard Tables', T: 'Theme Tables' };

async function niTables() {
  const out = [];
  // 2001
  const m01 = JSON.parse(await r2('data/census/2001-cleaned/manifest.json'));
  const by01 = new Map();
  for (const t of m01.tables) {
    const code = t.table.replace(/\(NI\)$/i, '');
    const e = by01.get(code) || { code, title: t.title, unit: t.unit, sfx: /\(NI\)$/i.test(t.table) ? '(NI)' : '', files: {} };
    if (t.file !== `${code}${e.sfx}__${t.geography}.csv.gz`) throw new Error(`2001 file name not derivable: ${t.file}`);
    e.files[GEO_2001[t.geography] || t.geography] = Math.max(1, Math.round(t.bytes / 1024));
    by01.set(code, e);
  }
  const codes01 = new Set([...by01.keys(), ...Object.keys(bulk2001)]);
  for (const code of codes01) {
    const e = by01.get(code);
    const b = bulk2001[code];
    const title = sentence(b?.title || e?.title || code);
    const family = b?.family || FAMILY_2001_PREFIX[code.match(/^[A-Z]+/)[0]] || 'Other';
    const geos = e ? sortGeos(Object.keys(e.files)) : ['NI', 'LGD2001', 'WARD2001', 'PARLCON2001', 'ELB', 'HSSB', 'NUTS3'];
    out.push({
      code, year: 2001, family, title, topic: topicOf(title), unit: e?.unit || null, geos,
      data: e ? { base: 'data/census/2001-cleaned/', sfx: e.sfx || undefined, kb: e.files } : null,
      note: e ? null : 'Not in Civgraph\'s cleaned 2001 set (the source file did not parse); the original CSV is in the 2001 bulk-download ZIPs.',
    });
  }
  // 2011
  const m11 = JSON.parse(await r2('data/census/2011-cleaned/manifest.json'));
  const by11 = new Map();
  for (const t of m11.tables) {
    const e = by11.get(t.table) || { code: t.table, title: t.title, dims: t.dimensions || [], unit: t.unit, files: {} };
    if (t.file !== `${t.table}__${t.geography}.csv.gz`) throw new Error(`2011 file name not derivable: ${t.file}`);
    e.files[GEO_2011[t.geography] || t.geography] = Math.max(1, Math.round(t.bytes / 1024));
    by11.set(t.table, e);
  }
  for (const e of by11.values()) {
    const title = sentence(e.title);
    out.push({
      code: e.code, year: 2011, family: FAMILY_2011[e.code.slice(0, 2)] || 'Other', title,
      topic: topicOf(title, e.dims.join(' ')), unit: e.unit, dims: e.dims.map(sentence), geos: sortGeos(Object.keys(e.files)),
      data: { base: 'data/census/2011-cleaned/', kb: e.files },
    });
  }
  // 2021 ready-made tables, plus the derived extracts Civgraph holds for some of them.
  const derived = readdirSync(DERIVED).filter((f) => /^ms-[a-z]\d{2}.*\.csv$/.test(f));
  const DERIVED_GEO = { lgd: 'LGD2014', dea: 'DEA2014', ward: 'WARD2014', settlement: 'SETTLEMENT2015', sdz: 'SDZ2021', dz: 'DZ2021' };
  for (const t of tables2021) {
    const code = t.code;
    const files = {};
    for (const f of derived) {
      const m = f.match(/^ms-([a-z]\d{2})(?:-(.+))?-(lgd|dea|ward|settlement|sdz|dz)\.csv$/);
      if (!m || `MS-${m[1].toUpperCase()}` !== code) continue;
      const geo = DERIVED_GEO[m[3]];
      (files[geo] ||= []).push([f, statSync(path.join(DERIVED, f)).size, m[2] ? sentence(m[2].replace(/-/g, ' ')) : null]);
    }
    const family = code.startsWith('MS') ? 'Main statistics' : code.startsWith('DT') ? 'Selected multivariate tables' : 'Alternative populations';
    const title = String(t.title).replace(/\s+/g, ' ').trim();
    out.push({
      code, year: 2021, family, release: t.releases.join('; '), title, topic: topicOf(title),
      geos: sortGeos(t.geos.map((g) => GEO_2021[g] || 'NI')),
      data: Object.keys(files).length ? { base: 'data/census/derived/', extracts: files } : null,
    });
  }
  out.sort((a, b) => a.year - b.year || a.code.localeCompare(b.code, 'en', { numeric: true }));
  return out;
}

// ---------------------------------------------------------------------------------------
// 3. The 2021 flexible-table index, sharded. Each shard holds every table at one
//    dataset x geography that includes one variable, so the browser loads only the shard
//    for the variable a reader picks.
// ---------------------------------------------------------------------------------------
const FTB_LABELS = readJson(`${INPUTS}/ftb-variable-labels.json`);
async function buildFtb() {
  const man = JSON.parse(await r2('data/census/nisra-ftb/manifest.json'));
  const vars = [...new Set(man.tables.flatMap((t) => t.variables))].sort();
  const vi = new Map(vars.map((v, i) => [v, i]));
  const shards = new Map(); // `${ds}~${geo}~${var}~${k}` -> entries
  const counts = {};
  const b36 = (i) => i.toString(36).padStart(2, '0');
  for (const t of man.tables) {
    const geo = t.geography === 'OTHER' ? 'NI' : t.geography;
    const key0 = `${t.dataset}~${geo}`;
    counts[key0] = (counts[key0] || 0) + 1;
    // Rebuild the file name from parts so the shard need not carry it; check that holds.
    const expect = t.geography === 'OTHER' ? `${t.dataset}__${t.variables.join('~')}.csv.gz` : `${t.dataset}__${t.geography}~${t.variables.join('~')}.csv.gz`;
    if (expect !== t.file) throw new Error(`FTB file name not derivable: ${t.file}`);
    const k = t.variables.length;
    for (const v of t.variables) {
      const sk = `${key0}~${v}~${k}`;
      if (!shards.has(sk)) shards.set(sk, []);
      // The other variables (2 base-36 characters each, in the file's order with this one
      // marked by its position) and the size in KB.
      shards.get(sk).push(`${t.variables.map((x) => (x === v ? '' : b36(vi.get(x)))).join('.')},${Math.max(1, Math.round(t.bytes / 1024))}`);
    }
  }
  if (existsSync(OUT_FTB)) rmSync(OUT_FTB, { recursive: true });
  mkdirSync(OUT_FTB, { recursive: true });
  // A shard over SPLIT entries is split again by a second variable, so no file a reader
  // loads is much over 150 KB; the index then records the per-variable counts instead of a
  // single count, and the page asks for that second variable first.
  const SPLIT = 9000;
  let maxBytes = 0; let total = 0; let files = 0; const shardIndex = {};
  const write = (name, list) => {
    list.sort();
    const body = JSON.stringify(list);
    writeFileSync(path.join(OUT_FTB, `${name}.json`), body);
    maxBytes = Math.max(maxBytes, body.length); total += body.length; files += 1;
  };
  for (const [k, entries] of shards) {
    const [ds, geo, v, n] = k.split('~');
    const slot = ((shardIndex[`${ds}~${geo}`] ||= {})[v] ||= {});
    if (entries.length <= SPLIT) { write(k, entries); slot[n] = entries.length; continue; }
    const byW = new Map();
    for (const e of entries) {
      for (const code of e.split(',')[0].split('.')) {
        if (!code) continue;
        if (!byW.has(code)) byW.set(code, []);
        byW.get(code).push(e);
      }
    }
    const split = {};
    for (const [w, list] of byW) { write(`${k}~${vars[parseInt(w, 36)]}`, list); split[vars[parseInt(w, 36)]] = list.length; }
    slot[n] = { total: entries.length, by: split };
  }
  const variables = vars.map((v) => ({ id: v, label: FTB_LABELS[v]?.label || v, dataset: FTB_LABELS[v]?.dataset || null, topic: topicOf(FTB_LABELS[v]?.label || v) }));
  const index = {
    about: 'Index of the NISRA Census 2021 flexible-table-builder corpus on R2 (147,492 tables), split for the Census Explorer. Shard <dataset>~<geography>~<variable>~<n>.json lists every n-variable table at that dataset and geography that includes the variable, as "<vars>,<KB>": vars are the table variables in file order, each as its 2-character base-36 index into variables[], with the shard variable left empty. Where shards[ds~geo][var][n] is an object rather than a count, that shard is split by a second variable into <dataset>~<geography>~<variable>~<n>~<second variable>.json. The table file is <dataset>__<geography>~<var1>~<var2>....csv.gz under data/census/nisra-ftb/ (no geography part for NI-wide tables, geography NI here).',
    count: man.tables.length, variables, counts, shards: shardIndex,
    geographies: { LGD14: 'LGD2014', DEA14: 'DEA2014', SDZ21: 'SDZ2021', DZ21: 'DZ2021', NI: 'NI' },
    fileBase: 'data/census/nisra-ftb/', shardBase: 'data/census/explorer/ftb/',
  };
  writeFileSync(path.join(OUT_FTB, 'index.json'), JSON.stringify(index));
  console.log(`  FTB: ${man.tables.length} tables in ${files} shards, ${(total / 1e6).toFixed(1)} MB, largest ${(maxBytes / 1e3).toFixed(0)} KB`);
  if (maxBytes > 200_000) console.warn(`  WARNING: an FTB shard is ${(maxBytes / 1e3).toFixed(0)} KB`);
  return { count: man.tables.length, shards: files, largestKB: Math.round(maxBytes / 1e3), index: `${OUT_FTB}/index.json` };
}

// ---------------------------------------------------------------------------------------
// 4. ROI census cubes from the CSO PxStat catalogue.
// ---------------------------------------------------------------------------------------
const ROI_YEARS = [1841, 1851, 1861, 1871, 1881, 1891, 1901, 1911, 1926, 1936, 1946, 1951, 1956, 1961, 1966, 1971, 1979, 1981, 1986, 1991, 1996, 2002, 2006, 2011, 2016, 2022];
const NI_YEARS = [1926, 1937, 1951, 1961, 1966, 1971, 1981, 1991, 2001, 2011, 2021];
const CENSUS_YEARS = new Set([...ROI_YEARS, ...NI_YEARS].map(String));
// Census families whose cubes use an ordinary "Year" time dimension (about 46 cubes).
const CENSUS_FAMILY = /^(A\d|B\d|C\d|CD\d|CDD|CDR|CDS|CSR|E\d|EY\d|F\d|FY\d|SAP|CNA\d|CPNI|HC[A-Z]?\d)/;
const NOT_CENSUS = /^(AVA|PEC|C19|CNAPA)/; // agricultural census, projections, COVID, national accounts

function roiGeoKey(dimLabel, years) {
  const l = dimLabel; const last = Math.max(...years);
  if (/small area/i.test(l)) return last >= 2022 ? 'ROI_SA2022' : 'ROI_SA2011';
  if (/electoral division/i.test(l)) return last >= 2022 ? 'ROI_ED2022' : last >= 2006 ? 'ROI_ED2006' : 'ROI_ED1986';
  if (/local electoral area/i.test(l)) return /2008/.test(l) ? 'ROI_LEA2008' : /2014/.test(l) ? 'ROI_LEA2014' : 'ROI_LEA2019';
  if (/constituenc/i.test(l)) {
    if (/2023/.test(l)) return 'ROI_DAIL2023';
    if (/2017/.test(l)) return 'ROI_DAIL2017';
    if (/2013/.test(l)) return 'ROI_DAIL2013';
    if (/2007|2005/.test(l)) return 'ROI_DAIL2005';
    return null;
  }
  if (/language planning|limist/i.test(l)) return 'ROI_LPA';
  if (/gaeltacht/i.test(l)) return 'ROI_GAELTACHT';
  if (/administrative count/i.test(l)) return last >= 2019 && /2019/.test(l) ? 'ROI_LA2019' : last >= 2016 ? 'ROI_LA2014' : 'ROI_COUNTY';
  if (/county|counties|city/i.test(l) && !/usual residence|previous|birth|one year/i.test(l)) return 'ROI_COUNTY';
  if (/^provinces?$/i.test(l)) return 'ROI_PROVINCE';
  if (/town|settlement|aggregate town/i.test(l)) return 'ROI_TOWN';
  return null;
}
const ROI_GEO_RANK = ['ROI_SA2022', 'ROI_SA2011', 'ROI_ED2022', 'ROI_ED2006', 'ROI_ED1986', 'ROI_LEA2019', 'ROI_LEA2014', 'ROI_LEA2008', 'ROI_DAIL2023', 'ROI_DAIL2017', 'ROI_DAIL2013', 'ROI_DAIL2005', 'ROI_LPA', 'ROI_GAELTACHT', 'ROI_LA2019', 'ROI_LA2014', 'ROI_COUNTY', 'ROI_PROVINCE', 'ROI_TOWN'];

function buildRoi() {
  const catFile = path.join(PXSTAT, '_catalogue.json');
  if (!existsSync(catFile)) {
    console.warn(`  ROI: ${catFile} not found; keeping the existing ${OUT_ROI}`);
    return existsSync(OUT_ROI) ? readJson(OUT_ROI).summary : null;
  }
  const cat = readJson(catFile);
  const cubes = []; const large = {};
  let dropped = 0;
  for (const it of cat.link.item) {
    const code = it.extension?.matrix;
    if (!code || NOT_CENSUS.test(code)) { dropped += 1; continue; }
    const timeId = it.id.find((d) => /^TLIST/.test(d));
    const time = timeId ? it.dimension[timeId] : null;
    if (!time) { dropped += 1; continue; }
    const rawYears = (time.category?.index || []).map(String);
    const isCensusDim = /census\s*year/i.test(time.label || '');
    const allCensus = rawYears.length && rawYears.every((y) => CENSUS_YEARS.has(y.slice(0, 4)));
    if (!(isCensusDim || (CENSUS_FAMILY.test(code) && allCensus))) { dropped += 1; continue; }
    if (!isCensusDim && !allCensus) { dropped += 1; continue; }
    if (isCensusDim && !allCensus && !CENSUS_FAMILY.test(code)) { dropped += 1; continue; }
    const years = [...new Set(rawYears.map((y) => Number(y.slice(0, 4))).filter((y) => CENSUS_YEARS.has(String(y))))].sort((a, b) => a - b);
    if (!years.length) { dropped += 1; continue; }
    const dims = it.id.filter((d) => d !== timeId && d !== 'STATISTIC').map((d) => ({ id: d, label: it.dimension[d].label }));
    const geoKeys = dims.map((d) => roiGeoKey(d.label, years)).filter(Boolean);
    const geo = ROI_GEO_RANK.find((k) => geoKeys.includes(k)) || null;
    let bytes = null;
    try { bytes = statSync(path.join(PXSTAT, code.slice(0, 3), `${code}.json`)).size; } catch { /* not mirrored */ }
    const title = String(it.label || code).replace(/\s+/g, ' ').trim();
    const subjectDims = dims.filter((d) => !roiGeoKey(d.label, years) && !/^(sex|state|ireland and northern ireland)$/i.test(d.label)).map((d) => d.label).join(' ');
    let topic = topicOf(title);
    if (topic === 'population' || topic === 'other') { const t2 = topicOf(subjectDims); if (t2 !== 'other') topic = t2; }
    cubes.push([code, title, years.join(','), dims.map((d) => d.label).join('|'), geo, bytes ? Math.round(bytes / 1024) : null, topic]);
    if (bytes && bytes > 5 * 1024 * 1024) {
      // Large cubes: ship their dimension categories so a reader can pick a slice before
      // committing to the download. Very long lists (thousands of small areas) are named only.
      const full = readJson(path.join(PXSTAT, code.slice(0, 3), `${code}.json`));
      large[code] = full.id.map((d) => {
        const c = full.dimension[d].category; const idx = Array.isArray(c.index) ? c.index : Object.keys(c.index);
        return { id: d, label: full.dimension[d].label, n: idx.length, cats: idx.length <= 400 ? idx.map((k) => [k, c.label?.[k] ?? k]) : null };
      });
    }
  }
  cubes.sort((a, b) => Number(b[2].split(',').pop()) - Number(a[2].split(',').pop()) || a[0].localeCompare(b[0], 'en', { numeric: true }));
  const years = [...new Set(cubes.flatMap((c) => c[2].split(',').map(Number)))].sort((a, b) => b - a);
  const multi = cubes.filter((c) => c[2].includes(',')).length;
  const summary = { count: cubes.length, multiYear: multi, years, droppedNonCensus: dropped, catalogueCubes: cat.link.item.length, large: Object.keys(large).length };
  const roi = {
    about: 'Census of Population cubes published by the CSO on PxStat, as mirrored on R2 at data/cso-pxstat/<first 3 characters>/<code>.json (JSON-stat 2.0). c = [code, title, census years, dimension names, geography key, size in KB, topic]. Only cubes with a census-year time dimension (or a census-family code whose years are all census years) are listed; the agricultural census and projections are excluded.',
    licence: LICENCES.cso, source: { label: 'CSO PxStat', url: 'https://data.cso.ie/' },
    tableUrlPrefix: 'https://data.cso.ie/table/', dataBase: 'data/cso-pxstat/',
    summary, fields: ['code', 'title', 'years', 'dims', 'geo', 'kb', 'topic'], cubes, large,
  };
  writeFileSync(OUT_ROI, JSON.stringify(roi));
  console.log(`  ROI: ${cubes.length} census cubes (${multi} span several censuses; ${dropped} non-census cubes left out), ${Object.keys(large).length} over 5 MB`);
  return summary;
}

// ---------------------------------------------------------------------------------------
// 5. NI indicators for comparisons across years. Each indicator is a share (num/den) or a
//    count, defined per census year from the table that carries it.
// ---------------------------------------------------------------------------------------
const IND = [
  { id: 'population', label: 'Usual residents', unit: 'count', y2001: ['KS01', /^All persons$/], y2011: ['KS101NI', /^All usual residents$/], y2021: ['ms-a01', 'AllUsualResidents'] },
  { id: 'catholic', label: 'Catholic, by religion', unit: 'pct', note: '2001 combines "no religion" with "not stated". 1981 is depressed by an 18.5% non-response during the hunger strikes; read it as a floor.', y2001: ['KS07a', /Catholic/, /^All persons$/], y2011: ['KS211NI', /^Religion: Catholic$/, /^All usual residents$/], y2021: ['ms-b19-catholic', 'Catholic', 'Total'] },
  { id: 'catholic_bg', label: 'Catholic, by community background (religion or religion brought up in)', unit: 'pct', note: '1971 is CAIN\'s retabulation of the 1971 census onto the 26 districts.', y2001: ['KS07b', /community background: Catholic/, /^All persons$/], y2011: ['KS212NI', /brought up in: Catholic$/, /^All usual residents$/], y2021: ['ms-b23-catholic-background', 'CatholicBackground', 'Total'] },
  { id: 'irish', label: 'Some knowledge of Irish (aged 3 and over)', unit: 'pct', note: 'Any of understanding, speaking, reading or writing Irish. 1991 is left out: the 1991 table held here counts speakers only.', y2001: ['KS24', /Some knowledge of Irish/, /^All persons aged 3 and over$/], y2011: ['KS209NI', /Some ability in Irish/, /^All usual residents: Aged 3\+ years$/], y2021: ['ms-b05-irish', 'SomeIrish', 'Total'] },
  { id: 'owner_occupied', label: 'Households owner-occupied (including shared ownership)', unit: 'pct', y2001: ['KS18', /Owner occupied/, /^All households$/], y2011: ['KS402NI', /^(Owner occupied|Shared ownership)/, /^All households$/], y2021: ['ms-e15-owner-occupied', 'OwnerOccupied', 'Total'] },
  { id: 'social_rented', label: 'Households socially rented (Housing Executive or housing association)', unit: 'pct', y2001: ['KS18', /Housing Executive|Housing Association/, /^All households$/], y2011: ['KS402NI', /Rented from: (Northern Ireland Housing Executive|Housing association)/, /^All households$/], y2021: ['ms-e15-social-rented', 'SocialRented', 'Total'] },
  { id: 'no_car', label: 'Households with no car or van', unit: 'pct', y2001: ['KS17', /Households with: \| No cars or vans$/, /Households with: \|/], y2011: ['KS405NI', /^No cars or vans in household$/, /^All households$/], y2021: ['ms-e10-no-car', 'NoCar', 'Total'] },
  { id: 'level4', label: 'Degree-level qualification or above (level 4+)', unit: 'pct', note: '2001 counts people aged 16-74; 2011 and 2021 count everyone aged 16 and over.', y2001: ['KS13', /Level 4\(4\)|Level 5\(5\)/, /^All persons aged 16-74$/], y2011: ['KS501NI', /Level 4 qualifications and above/, /^All usual residents: Aged 16\+ years$/], y2021: ['ms-g01-level-4-plus', 'Level4Plus', 'Total'] },
  { id: 'no_quals', label: 'No qualifications', unit: 'pct', note: '2001 counts people aged 16-74; 2011 and 2021 count everyone aged 16 and over.', y2001: ['KS13', /No qualifications/, /^All persons aged 16-74$/], y2011: ['KS501NI', /^No qualifications: Aged 16\+ years$/, /^All usual residents: Aged 16\+ years$/], y2021: ['ms-g01-no-quals', 'NoQuals', 'Total'] },
  { id: 'born_ni', label: 'Born in Northern Ireland', unit: 'pct', y2001: ['KS05', /born in Northern Ireland/, /^All persons$/], y2011: ['KS204NI', /^Country of birth: Northern Ireland$/, /^All usual residents$/], y2021: ['ms-a16-born-in-ni', 'BornInNI', 'Total'] },
  { id: 'llti', label: 'Long-term illness or condition that limits daily activities', unit: 'pct', note: 'The question changed: 1991 and 2001 asked about a limiting long-term illness; 2011 about a long-term health problem or disability; 2021 about a long-term condition limiting day-to-day activities.', y2001: ['KS08', /^Persons with limiting long-term illness/, /^All persons$/], y2011: ['KS301NI', /^Long-term health problem or disability: Day-to-day activities limited a (lot|little)$/, /^All usual residents$/], y2021: ['ms-d02-limiting-condition', 'LimitingCondition', 'Total'] },
  { id: 'unemployed', label: 'Unemployed (share of the economically active)', unit: 'pct', note: 'Shown for 1991 only, from the district table; later tables in Civgraph\'s extracts use different bases.' },
];
const IND_1991 = { catholic: 'rc_pct', owner_occupied: 'owner_occ_pct', social_rented: 'social_rent_pct', no_car: 'no_car_pct', llti: 'llti_pct', unemployed: 'unemployment_pct' };

const HIST_POP = [ // NI totals printed in the converted reports; each is checked against its file.
  [1926, 1256561, 'data/census/census-1926-part-1.md'], [1937, 1279745, 'data/census/census-1937-part-1.md'],
  [1951, 1370921, 'data/census/census-1951-part-2.md'], [1961, 1425042, 'data/census/census-1961-part-2.md'],
  [1966, 1484775, 'data/census/census-1966.md'], [1971, 1536065, 'data/census/census-1981.md'],
  [1981, 1481959, 'data/census/census-1981.md'],
];
function share(rows, numRe, denRe) {
  const sum = (re) => rows.filter((r) => re.test(r.cats)).reduce((s, r) => s + (r.value || 0), 0);
  const n = sum(numRe); const d = denRe ? sum(denRe) : null;
  return { n, d };
}

async function buildComparisons() {
  const ni = Object.fromEntries(IND.map((i) => [i.id, { id: i.id, label: i.label, unit: i.unit, note: i.note || null, points: [] }]));
  const lgd26 = {}; // code -> { name, values: { ind: { year: v } } }
  const lgdName = {};
  const put26 = (code, name, ind, year, value, est) => {
    if (value == null) return;
    const e = lgd26[code] ||= { name, v: {} };
    ((e.v[ind] ||= {})[year] = est ? [round(value, ind === 'population' ? 0 : 1), 1] : round(value, ind === 'population' ? 0 : 1));
  };

  // Historical NI population from the reports.
  for (const [year, value, key] of HIST_POP) {
    const text = readFileSync(key, 'utf8');
    if (!text.includes(value.toLocaleString('en-GB'))) throw new Error(`${value} not found in ${key}`);
    ni.population.points.push({ year, value, src: { label: `GRO NI census report (text in ${key.split('/').pop()})`, url: R2 + key } });
  }
  // 1971/1981/1991 religion and population on the 26 districts.
  const cb = readCsv(`${DERIVED}/religion-common-basis-lgd.csv`);
  const cbNi = readCsv(`${DERIVED}/religion-common-basis-ni.csv`)[0];
  const r81 = readCsv(`${DERIVED}/religion-1981-lgd.csv`);
  const src81 = { label: '1981 census, Table 8 (religion-1981-lgd.csv)', url: `${R2}${DERIVED}/religion-1981-lgd.csv` };
  const srcCb = { label: 'Common-basis religion series (religion-common-basis-ni.csv)', url: `${R2}${DERIVED}/religion-common-basis-ni.csv` };
  ni.population.points.push({ year: 1991, value: num(cbNi.pop_1991), src: srcCb });
  ni.catholic.points.push({ year: 1981, value: num(cbNi.raw_pct_1981), src: src81, flag: 'floor' });
  ni.catholic.points.push({ year: 1991, value: num(cbNi.raw_pct_1991), src: srcCb });
  ni.catholic_bg.points.push({ year: 1971, value: num(cbNi.cain_pct_1971), src: { label: 'CAIN retabulation of the 1971 census (religion-common-basis-ni.csv)', url: srcCb.url }, flag: 'est' });
  // 26-district codes: match names to the 2001 district codes (95AA..95ZZ) below.
  const r91 = readCsv(`${DERIVED}/census-1991-lgd-full.csv`);
  const src91 = { label: '1991 census district table (census-1991-lgd-full.csv)', url: `${R2}${DERIVED}/census-1991-lgd-full.csv` };

  // 2001 and 2011 from Civgraph's cleaned tables (NI and the 26 districts natively).
  const ks = (y, t) => (y === 2001 ? [t, ['NI', 'LGD2001']] : [t, ['HIGHER']]);
  for (const ind of IND) {
    for (const year of [2001, 2011]) {
      const spec = ind[`y${year}`]; if (!spec) continue;
      const [table, numRe, denRe] = spec;
      const files = year === 2001 ? ['NI', 'LGD2001'] : ['HIGHER'];
      const rows = [];
      for (const g of files) rows.push(...await cleanedRows(year, table, g));
      const byArea = new Map();
      for (const r of rows) { if (!byArea.has(r.code)) byArea.set(r.code, { name: r.label, rows: [] }); byArea.get(r.code).rows.push(r); }
      const srcT = { label: `${NISRA[year].label}, table ${table}`, url: `${R2}data/census/${year}-cleaned/${table}__${files[files.length - 1]}.csv.gz` };
      for (const [code, { name, rows: rr }] of byArea) {
        const isNi = code === '95' || code === 'N92000002';
        const is26 = /^95[A-Z]{2}$/.test(code);
        if (!isNi && !is26) continue;
        const { n, d } = share(rr, numRe, denRe);
        const value = ind.unit === 'count' ? n : (d ? (100 * n) / d : null);
        if (isNi) ni[ind.id].points.push({ year, value: round(value, ind.unit === 'count' ? 0 : 2), src: srcT, n: ind.unit === 'pct' ? n : undefined, d: ind.unit === 'pct' ? d : undefined });
        if (is26) { lgdName[code] = sentence(name); put26(code, lgdName[code], ind.id, year, value, false); }
      }
    }
  }
  const nameTo26 = new Map(Object.entries(lgdName).map(([c, n]) => [n.toLowerCase().replace(/[^a-z]/g, ''), c]));
  const code26 = (name) => nameTo26.get(String(name).toLowerCase().replace(/[^a-z]/g, '').replace(/^londonderry$/, 'derry'));
  for (const r of r91) {
    const c = code26(r.lgd); if (!c) { console.warn(`  1991 district not matched: ${r.lgd}`); continue; }
    put26(c, lgdName[c], 'population', 1991, num(r.total_pop), false);
    for (const [ind, col] of Object.entries(IND_1991)) put26(c, lgdName[c], ind, 1991, num(r[col]), false);
  }
  for (const r of cb) {
    const c = code26(r.area); if (!c) continue;
    put26(c, lgdName[c], 'population', 1971, num(r.pop_1971), false);
    put26(c, lgdName[c], 'population', 1981, num(r.pop_1981), false);
    put26(c, lgdName[c], 'catholic_bg', 1971, num(r.cain_pct_1971), true);
  }
  for (const r of r81) { const c = code26(r.lgd); if (c) put26(c, lgdName[c], 'catholic', 1981, num(r.catholic_pct), false); }
  // NI 1991 indicators: population-weighted district values (the district table has no NI row).
  for (const [ind, col] of Object.entries(IND_1991)) {
    if (ind === 'catholic') continue; // from the common-basis file above
    let s = 0; let w = 0;
    for (const r of r91) { const v = num(r[col]); const p = num(r.total_pop); if (v != null && p) { s += v * p; w += p; } }
    if (w) ni[ind].points.push({ year: 1991, value: round(s / w, 2), src: src91, flag: 'wtd' });
  }

  // 2021: NI totals from the district extracts (sums), and 11-council values natively.
  const lgd11 = {};
  for (const ind of IND) {
    const spec = ind.y2021; if (!spec) continue;
    const [stem, numCol, denCol] = spec;
    const rows = readCsv(`${DERIVED}/${stem}-lgd.csv`);
    let N = 0; let D = 0;
    for (const r of rows) {
      const code = r.LGDCode || r.GeographyCode; const n = num(r[numCol]); const d = denCol ? num(r[denCol]) : null;
      N += n || 0; D += d || 0;
      const v = ind.unit === 'count' ? n : (d ? (100 * n) / d : null);
      ((lgd11[code] ||= { name: r.Geography, v: {} }).v[ind.id] ||= {})[2021] = round(v, ind.unit === 'count' ? 0 : 1);
    }
    const value = ind.unit === 'count' ? N : (100 * N) / D;
    ni[ind.id].points.push({ year: 2021, value: round(value, ind.unit === 'count' ? 0 : 2), src: { label: `${NISRA[2021].label}, table ${stem.slice(0, 6).toUpperCase()} (sum of the 11 districts)`, url: `${R2}${DERIVED}/${stem}-lgd.csv` }, n: ind.unit === 'pct' ? N : undefined, d: ind.unit === 'pct' ? D : undefined });
  }

  // 2011 on the 11 councils: ESTIMATED from Small Areas, each assigned whole to the council
  // its 2014 District Electoral Area lies in (best fit; SAs were built on the old wards).
  const deaRows = readCsv(`${DERIVED}/ms-a01-dea.csv`);
  const deaToLgd = new Map(deaRows.map((r) => [r.Geography, `N090000${r.GeographyCode.slice(5, 7)}`]));
  const saDea = new Map(readCsv(`${DERIVED}/sa2011_to_deas.csv`).map((r) => [r.SA2011, r.dea_2012]));
  const sa11 = readCsv(`${DERIVED}/census-2011-sa.csv`);
  const acc11 = {};
  for (const r of sa11) {
    const lgd = deaToLgd.get(saDea.get(r.SA2011)); if (!lgd) continue;
    const p = num(r.AllUsualResidents) || 0; const cbp = num(r.Catholic_background_pct);
    const a = acc11[lgd] ||= { pop: 0, cb: 0, cbw: 0 };
    a.pop += p; if (cbp != null) { a.cb += (cbp * p) / 100; a.cbw += p; }
  }
  for (const [code, a] of Object.entries(acc11)) {
    const e = lgd11[code] ||= { name: code, v: {} };
    (e.v.population ||= {})[2011] = [Math.round(a.pop), 1];
    (e.v.catholic_bg ||= {})[2011] = [round((100 * a.cb) / a.cbw, 1), 1];
  }

  // 2021 on the 26 districts: ESTIMATED from Data Zones, each assigned whole to the 1993
  // district it lies mostly in.
  const dzLgd93 = new Map(readCsv(`${DERIVED}/dz2021_to_lgd1993.csv`).map((r) => [r.DZ2021_cd, r.lgd1993]));
  const dzCommunity = new Map(readCsv(`${DERIVED}/dz21-community-2021.csv`).map((r) => [r.DZ21, r]));
  const acc26 = {};
  for (const r of readCsv(`${DERIVED}/ms-a01-dz.csv`)) {
    const c = code26(dzLgd93.get(r.GeographyCode)); if (!c) continue;
    const p = num(r.AllUsualResidents) || 0; const cbp = num(dzCommunity.get(r.GeographyCode)?.catholic_bg_pct);
    const a = acc26[c] ||= { pop: 0, cb: 0, cbw: 0 };
    a.pop += p; if (cbp != null) { a.cb += (cbp * p) / 100; a.cbw += p; }
  }
  for (const [c, a] of Object.entries(acc26)) {
    put26(c, lgdName[c], 'population', 2021, a.pop, true);
    put26(c, lgdName[c], 'catholic_bg', 2021, (100 * a.cb) / a.cbw, true);
  }

  for (const s of Object.values(ni)) s.points.sort((a, b) => a.year - b.year);
  return {
    niTotals: Object.values(ni).filter((s) => s.points.length),
    lgd26: {
      label: 'The 26 districts of 1973-2015', map: 'lgd-1993',
      note: '1971-2011 are as published for these districts (1971 Catholic share: CAIN\'s retabulation). 2021 is estimated: each 2021 Data Zone is counted whole in the 1993 district it lies mostly in.',
      areas: lgd26,
    },
    lgd11: {
      label: 'The 11 districts of 2015 onwards', map: 'lgd-2012',
      note: '2021 is as published. 2011 is estimated: each 2011 Small Area is counted whole in the district its 2014 District Electoral Area lies in.',
      areas: lgd11,
    },
    indicators: IND.map((i) => ({ id: i.id, label: i.label, unit: i.unit, note: i.note || null })),
  };
}

// ---------------------------------------------------------------------------------------
// 6. Small-area series on the 2021 Data Zone frame. Mostly ESTIMATED: each value records
//    its method. 2021 is as published.
// ---------------------------------------------------------------------------------------
async function buildDzSeries() {
  const pop21 = new Map(readCsv(`${DERIVED}/ms-a01-dz.csv`).map((r) => [r.GeographyCode, [r.Geography, num(r.AllUsualResidents)]]));
  const ts = new Map(readCsv(`${DERIVED}/dz21-catholic-timeseries.csv`).map((r) => [r.DZ2021_cd, r]));
  const c01 = new Map(readCsv(`${DERIVED}/dz21-census-2001.csv`).map((r) => [r.DZ2021_cd, r]));
  const c91 = new Map(readCsv(`${DERIVED}/dz21-census-1991.csv`).map((r) => [r.DZ2021_cd, r]));
  const comm = new Map(readCsv(`${DERIVED}/dz21-community-2021.csv`).map((r) => [r.DZ21, r]));
  const dzDea = new Map(readCsv(`${DERIVED}/dz2021_to_deas.csv`).map((r) => [r.DZ2021_cd, r.DEA2014_nm]));
  // 1971/1981 population apportioned from the 1972 wards by area.
  const p7181 = new Map();
  for (const r of readCsv(`${DERIVED}/ward1972_to_dz2021_weights.csv`)) {
    const a = p7181.get(r.DZ2021_cd) || [0, 0];
    a[0] += num(r.pop_1971_apportioned) || 0; a[1] += num(r.pop_1981_apportioned) || 0;
    p7181.set(r.DZ2021_cd, a);
  }
  // 2011 apportioned from Small Areas by the SA->DZ weights.
  const sa11 = new Map(readCsv(`${DERIVED}/census-2011-sa.csv`).map((r) => [r.SA2011, r]));
  const e11 = new Map();
  for (const r of readCsv(`${DERIVED}/sa2011_to_dz2021_weights.csv`)) {
    const sa = sa11.get(r.SA2011); if (!sa) continue;
    const w = num(r.weight) || 0; const p = (num(sa.AllUsualResidents) || 0) * w; const cbp = num(sa.Catholic_background_pct);
    const a = e11.get(r.DZ2021_cd) || { pop: 0, cb: 0, cbw: 0 };
    a.pop += p; if (cbp != null) { a.cb += (cbp * p) / 100; a.cbw += p; }
    e11.set(r.DZ2021_cd, a);
  }
  // 2021 shares from the flexible-table builder at Data Zone level.
  const ftbShare = async (file, isNum, isDen) => {
    const rows = parseCsv(await r2(`data/census/nisra-ftb/${file}`)).slice(1).filter((r) => r.length > 3);
    const acc = new Map();
    for (const r of rows) { const a = acc.get(r[0]) || [0, 0]; const c = num(r[2]); const v = num(r[4]) || 0; if (isNum(c)) a[0] += v; if (isDen(c)) a[1] += v; acc.set(r[0], a); }
    return new Map([...acc].map(([k, [n, d]]) => [k, d ? (100 * n) / d : null]));
  };
  const car21 = await ftbShare('HOUSEHOLD__DZ21~HH_CAR_VAN_TC5.csv.gz', (c) => c === 0, (c) => c >= 0);
  const own21 = await ftbShare('HOUSEHOLD__DZ21~HH_TENURE_AGG7.csv.gz', (c) => c === 1 || c === 2, (c) => c >= 1);
  const soc21 = await ftbShare('HOUSEHOLD__DZ21~HH_TENURE_AGG7.csv.gz', (c) => c === 3 || c === 4, (c) => c >= 1);
  const iri21 = await ftbShare('PEOPLE__DZ21~IRISH_SKILLS_INTERMEDIATE.csv.gz', (c) => c >= 2 && c <= 4, (c) => c >= 1);
  const deaToLgd = new Map(readCsv(`${DERIVED}/ms-a01-dea.csv`).map((r) => [r.Geography, `N090000${r.GeographyCode.slice(5, 7)}`]));

  const series = [
    { id: 'population', label: 'Usual residents', unit: 'count', years: [1971, 1981, 2001, 2011, 2021], method: { 1971: 'est-area', 1981: 'est-area', 2001: 'est-pop', 2011: 'est-pop', 2021: 'actual' } },
    { id: 'catholic', label: 'Catholic share (religion, or religion brought up in)', unit: 'pct', years: [1971, 1981, 1991, 2001, 2011, 2021], method: { 1971: 'district', 1981: 'district', 1991: 'ward', 2001: 'est-pop', 2011: 'est-pop', 2021: 'actual' }, note: '1971 is CAIN\'s community-style estimate; 1981 and 1991 are stated religion (1981 depressed by non-response); 2001, 2011 and 2021 are community background.' },
    { id: 'no_car', label: 'Households with no car or van', unit: 'pct', years: [1991, 2001, 2021], method: { 1991: 'ward', 2001: 'est-pop', 2021: 'actual' } },
    { id: 'owner_occupied', label: 'Households owner-occupied', unit: 'pct', years: [1991, 2001, 2021], method: { 1991: 'ward', 2001: 'est-pop', 2021: 'actual' } },
    { id: 'social_rented', label: 'Households socially rented', unit: 'pct', years: [1991, 2001, 2021], method: { 1991: 'ward', 2001: 'est-pop', 2021: 'actual' } },
    { id: 'irish', label: 'Speaks Irish (aged 3+)', unit: 'pct', years: [1991, 2001, 2021], method: { 1991: 'ward', 2001: 'est-pop', 2021: 'actual' } },
  ];
  const rows = {};
  for (const [dz, [name, p21]] of pop21) {
    const t = ts.get(dz) || {}; const a = c01.get(dz) || {}; const b = c91.get(dz) || {}; const e = e11.get(dz); const p = p7181.get(dz);
    const cm = comm.get(dz);
    rows[dz] = [
      name, t.lgd1993 || null, deaToLgd.get(dzDea.get(dz)) || null,
      [p ? Math.round(p[0]) : null, p ? Math.round(p[1]) : null, round(num(a.total_pop), 0), e ? Math.round(e.pop) : null, p21],
      [round(num(t.cath_1971)), round(num(t.cath_1981)), round(num(t.cath_1991) ?? num(b.rc_pct)), round(num(a.cb_catholic_pct)), e && e.cbw ? round((100 * e.cb) / e.cbw) : null, round(num(cm?.catholic_bg_pct) ?? num(t.cath_2021))],
      [round(num(b.no_car_pct)), round(num(a.no_car_pct)), round(car21.get(dz))],
      [round(num(b.owner_occ_pct)), round(num(a.owner_occ_pct)), round(own21.get(dz))],
      [round(num(b.social_rent_pct)), round(num(a.social_rent_pct)), round(soc21.get(dz))],
      [round(num(b.irish_speak_pct)), round(num(a.irish_speak_pct)), round(iri21.get(dz))],
    ];
  }
  const out = {
    about: 'Small-area series on the 2021 Data Zone (DZ2021) frame. Values other than 2021 are ESTIMATES carried onto the 2021 Data Zones from older geographies; each year\'s method is in series[].method. rows[dz] = [name, 1993 district, 2015 council code, ...one array per series in series[] order].',
    methods: {
      actual: 'As published for this Data Zone.',
      'est-pop': 'Estimated: the older small areas (2001 Output Areas or 2011 Small Areas) are split across the 2021 Data Zones by population-weighted overlap and their counts added up.',
      'est-area': 'Estimated: the 1972 wards are split across the 2021 Data Zones by area overlap.',
      ward: 'The rate for the whole 1984 ward the Data Zone lies in; not a Data Zone figure.',
      district: 'The rate for the whole district the Data Zone lies in; not a Data Zone figure.',
    },
    series, map: 'dz-2021', rows,
  };
  writeFileSync(OUT_DZ, JSON.stringify(out));
  console.log(`  DZ series: ${Object.keys(rows).length} Data Zones, ${(JSON.stringify(out).length / 1e3).toFixed(0)} KB`);
  return { file: OUT_DZ, count: Object.keys(rows).length };
}

// ---------------------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------------------
const tables = await niTables();
const tableKey = new Set(tables.map((t) => `${t.code}@${t.year}`));
const compare = await buildComparisons();
const seriesById = Object.fromEntries(compare.niTotals.map((s) => [s.id, s]));

const comparabilityByTopic = new Map((comparability.conceptGroups || []).map((g) => [g.topic, g]));
const concepts = (ontology.concepts || []).map((c) => {
  const spec = CONCEPT_TABLES[c.id] || {};
  const digitalYearCells = [2001, 2011, 2021].map((year) => {
    const codes = (spec[year] || []).map(([code, role]) => ({ code, role: role || null, resolved: tableKey.has(`${code}@${year}`) }));
    for (const x of codes) if (!x.resolved) console.warn(`  concept ${c.id} ${year}: ${x.code} is not in the table list`);
    return {
      year, available: codes.length > 0, code: codes[0]?.code || null, codes,
      resolvedTable: codes.length > 0 && codes.every((x) => x.resolved),
      source: codes.length ? { provider: 'NISRA', url: NISRA[year].url, label: `${NISRA[year].label} (find table${codes.length > 1 ? 's' : ''} ${codes.map((x) => x.code).join(' and ')})` } : null,
    };
  });
  const histYears = [...new Set([...(c.yearsAvailableHistorical || []), ...(HISTORICAL_EXTRA[c.id] || [])])].sort((a, b) => a - b);
  const series = (CONCEPT_SERIES[c.id] || []).map((id) => seriesById[id]).filter(Boolean);
  const historicalYearCells = histYears.map((year) => {
    const figures = series.map((s) => { const p = s.points.find((x) => x.year === year); return p ? { series: s.id, label: s.label, unit: s.unit, value: p.value, flag: p.flag || null } : null; }).filter(Boolean);
    return { year, available: true, reports: reportLinks(year, c.id), figures };
  });
  const group = comparabilityByTopic.get(c.id);
  const availabilityEntry = availability.concepts?.[c.id] || null;
  return {
    id: c.id, label: c.label, priority: c.priority, difficulty: c.difficulty,
    comparabilityNotes: c.comparabilityNotes || group?.notes || null,
    yearsDigital: [2001, 2011, 2021], yearsHistorical: histYears,
    digitalYearCells, historicalYearCells, series: series.map((s) => s.id),
    geographyLevels: availabilityEntry?.geographyLevels ? Object.keys(availabilityEntry.geographyLevels).filter((g) => g !== 'unknown').sort() : [],
  };
});

const ftb = await buildFtb();
const roi = buildRoi();
const dz = await buildDzSeries();

const topicsUsed = [...new Set(tables.map((t) => t.topic))];
const bundle = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString().slice(0, 10),
  scope: 'Northern Ireland census (GRO NI and NISRA, 1926-2021) and the Republic of Ireland census (CSO PxStat cubes, 1841-2022).',
  r2: R2,
  sources: { nisra: NISRA, csoHistorical: CSO_HISTORICAL, licences: LICENCES },
  geographies: Object.fromEntries(Object.entries(GEO).map(([k, g]) => [k, { label: g.label, map: g.map, href: mapHref(g.map) }])),
  topics: [...TOPICS.map(([id, label]) => ({ id, label })), { id: 'other', label: 'Other' }].filter((t) => topicsUsed.includes(t.id) || t.id !== 'other'),
  counts: {
    concepts: concepts.length,
    tables: tables.length,
    tablesByYear: [2001, 2011, 2021].reduce((a, y) => { a[y] = tables.filter((t) => t.year === y).length; return a; }, {}),
    tablesWithData: tables.filter((t) => t.data).length,
    ftbTables: ftb.count,
    roiCubes: roi?.count ?? null,
    roiMultiYear: roi?.multiYear ?? null,
  },
  concepts,
  tables,
  ftb: { index: `${OUT_FTB}/index.json`, count: ftb.count, shards: ftb.shards },
  roi: { file: OUT_ROI, count: roi?.count ?? null, multiYear: roi?.multiYear ?? null, years: roi?.years ?? [] },
  compare: { ...compare, dzSeries: { file: OUT_DZ, count: dz.count } },
};
writeFileSync(OUT_BUNDLE, JSON.stringify(bundle) + '\n');
console.log(`Wrote ${OUT_BUNDLE} (${(JSON.stringify(bundle).length / 1e3).toFixed(0)} KB): ${concepts.length} concepts, ${tables.length} NI tables ${JSON.stringify(bundle.counts.tablesByYear)}, ${bundle.counts.tablesWithData} with data on R2`);

// Guard: never leak a local filesystem path or staging id into a shipped file.
const LOCAL = /(?:[A-Z]:\\|\\\\|C:\/Users\/|[A-Z]:\/(?:cso|civgraph|Users)|local_archive|data\/downloads\/)/i;
for (const f of [OUT_BUNDLE, OUT_ROI, OUT_DZ, `${OUT_FTB}/index.json`]) {
  if (existsSync(f) && LOCAL.test(readFileSync(f, 'utf8'))) throw new Error(`${f} leaked a local filesystem path`);
}
