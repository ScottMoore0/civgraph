#!/usr/bin/env node
/**
 * Add the 1946/1950/1953/1954/1955 Republic of Ireland District Electoral
 * Divisions/Wards map layers, following the existing eds-roi-1957 pattern:
 * each year is an `isGroup` "wards" record with four province variants
 * (Connacht/Leinster/Munster/Ulster), each variant cloning a province-level
 * boundary base and pointing at its FlatGeobuf on R2.
 *
 * The per-year province vintages come from the transcription sidecars supplied
 * with the Irish Digitised Boundaries batch ("District Electoral Divisions Wards
 * <year>.txt"), which spell out the exact "Files to use". New geometry from this
 * batch: Leinster 1946/1953/1954 and Munster 1944/1950 (hosted as new hidden
 * province bases); Connacht 1919, Ulster 1921 and Munster 1955 are already live.
 *
 * eds-roi-1950 and eds-roi-1954 already exist as `placeholder` stubs and are
 * upgraded in place (not duplicated); 1946/1953/1955 are created new.
 *
 * Idempotent: re-running replaces any record it manages by id.
 *
 * Usage: node scripts/census/add-roi-ded-1946-1955.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const MAPS = 'data/database/maps.json';
const BASE = 'https://data.civgraph.net/data/maps/electoral-divisions/';
const DOCS = 'https://data.civgraph.net/data/documents/dublin-electoral-history/';
const STYLE = { color: '#1B5E20', weight: 2 };
const PROVIDER = ['Phelim Birch', 'Paddy Matthews'];
const NATIONAL_BOUNDS = [[51.4, -10.75], [55.5, -5.4]];

const enc = (rel) => BASE + rel.replace(/ /g, '%20');
const raw = (rel) => BASE + rel;

// Province vintage registry: which base record + FlatGeobuf backs each
// province-year, and whether it is already live on the site.
const PROV = {
  'connacht-1919': { prov: 'Connacht', base: 'eds-connacht-1919', rel: 'DEDs_Connacht_1919.fgb', existing: true, date: 1919 },
  'ulster-1921': { prov: 'Ulster', base: 'eds-ulster-1921', rel: 'DEDs_Ulster_1921.fgb', existing: true, date: 1921 },
  'munster-1955': { prov: 'Munster', base: 'eds-munster-1955', rel: 'Electoral Divisions 1986-2019/Wards_DEDs_Munster_1955.fgb', existing: true, date: 1955 },
  'leinster-1946': { prov: 'Leinster', base: 'eds-leinster-1946', rel: 'Wards_DEDs_Leinster_1946.fgb', existing: false, date: 1946 },
  'leinster-1953': { prov: 'Leinster', base: 'eds-leinster-1953', rel: 'Wards_DEDs_Leinster_1953.fgb', existing: false, date: 1953 },
  'leinster-1954': { prov: 'Leinster', base: 'eds-leinster-1954', rel: 'Wards_DEDs_Leinster_1954.fgb', existing: false, date: 1954 },
  'munster-1944': { prov: 'Munster', base: 'eds-munster-1944', rel: 'Wards_DEDs_Munster_1944.fgb', existing: false, date: 1944 },
  'munster-1950': { prov: 'Munster', base: 'eds-munster-1950', rel: 'Wards_DEDs_Munster_1950.fgb', existing: false, date: 1950 },
};

// Per-composite-year province grid (from the transcription "Files to use" lines).
const GRID = {
  1946: { connacht: 'connacht-1919', leinster: 'leinster-1946', munster: 'munster-1944', ulster: 'ulster-1921' },
  1950: { connacht: 'connacht-1919', leinster: 'leinster-1946', munster: 'munster-1950', ulster: 'ulster-1921' },
  1953: { connacht: 'connacht-1919', leinster: 'leinster-1953', munster: 'munster-1950', ulster: 'ulster-1921' },
  1954: { connacht: 'connacht-1919', leinster: 'leinster-1954', munster: 'munster-1950', ulster: 'ulster-1921' },
  1955: { connacht: 'connacht-1919', leinster: 'leinster-1954', munster: 'munster-1955', ulster: 'ulster-1921' },
};

const META = {
  1946: {
    date: '1946-07-15',
    notes: 'Republic of Ireland District Electoral Divisions/Wards as at 1946, assembled from Connacht 1919, Leinster 1946, Munster 1944, and the unchanged Ulster ROI DED component. The Dublin ward detail is transcribed from the Minutes of Dublin City Council of 15 July 1946; the full source-note sidecar is pending in a later batch.',
    sources: ['Dublin Wards, 15 July 1946 (Minutes of Dublin City Council 146, Item 154)'],
    sidecar: { kind: 'PDF', rel: DOCS + 'Dublin Wards 15-07-1946 (Minutes of Dublin City Council 146 Item 154).pdf' },
  },
  1950: {
    date: '1950-01-05',
    notes: "Republic of Ireland District Electoral Divisions/Wards as at 5 January 1950, assembled from Connacht 1919, Leinster 1946, Munster 1950, and the unchanged Ulster ROI DED component. In 1950 the new DED of Limerick Rural was formed out of parts of Limerick North Rural and Limerick South Rural ahead of the expansion of Limerick county borough.",
    sources: ['County Limerick (District Electoral Divisions) Order, 1950'],
    sidecar: { kind: 'Source notes', rel: raw('District Electoral Divisions Wards 1950.txt') },
  },
  1953: {
    date: '1953-04-01',
    notes: "Republic of Ireland District Electoral Divisions/Wards as at 1 April 1953, assembled from Connacht 1919, Leinster 1953, Munster 1950, and the unchanged Ulster ROI DED component. In 1953 Dublin county borough's boundary was expanded into the DEDs of Castleknock, Clondalkin, Coolock, Drumcondra Rural, Finglas, Howth Rural, Palmerstown, Rathfarnham and Terenure.",
    sources: ['Local Government Provisional Order Confirmation Act, 1953'],
    sidecar: { kind: 'Source notes', rel: raw('District Electoral Divisions Wards 1953.txt') },
  },
  1954: {
    date: '1954-06-14',
    notes: "Republic of Ireland District Electoral Divisions/Wards as at 14 June 1954, assembled from Connacht 1919, Leinster 1954, Munster 1950, and the unchanged Ulster ROI DED component. Following the 1953 expansion of Dublin county borough, 9 new wards replaced the portions of 9 DEDs absorbed by the borough, with minor changes to some of the 33 existing wards (42 in total).",
    sources: ['Minutes of Dublin City Council 1954 (from page 91)', 'Dublin City Popular Edition (1953)', 'Irish Townland and Historical Map Viewer, 6 Inch Last Edition basemap', '1958 Geographia Plan of Dublin'],
    sidecar: { kind: 'Source notes', rel: raw('District Electoral Divisions Wards 1954.txt') },
    extraRefs: [{ label: 'Dublin ward definitions 1954 (Minutes of Dublin City Council 1954, Item 144)', url: DOCS + 'Dublin Wards 14-06-1954 (Minutes of Dublin City Council 1954 Item 144).pdf' }],
  },
  1955: {
    date: '1955-04-01',
    notes: "Republic of Ireland District Electoral Divisions/Wards as at 1 April 1955, assembled from Connacht 1919, Leinster 1954, Munster 1955, and the unchanged Ulster ROI DED component. In 1955 Cork county borough expanded into the DEDs of Bishopstown, St. Mary's and Blackrock, and Waterford county borough expanded into Ballynakill, Waterford Rural and the DED of Kilculliheen in County Kilkenny.",
    sources: ['Local Government Provisional Orders Confirmation Act, 1955'],
    sidecar: { kind: 'Source notes', rel: raw('District Electoral Divisions Wards 1955.txt') },
  },
};

// Which years used each new Leinster/Munster base (for base-record descriptions).
const usedBy = {};
for (const [year, g] of Object.entries(GRID)) {
  for (const key of Object.values(g)) (usedBy[key] ||= []).push(year);
}

function provinceLabel(key, compositeYear) {
  const p = PROV[key];
  if (p.prov === 'Ulster') return `Ulster (ROI: Cavan/Donegal/Monaghan; ${p.date} boundaries)`;
  if (p.date === compositeYear) return `${p.prov} ${p.date}`;
  return `${p.prov} (= ${p.date} boundaries)`;
}

function variant(year, province, key) {
  const p = PROV[key];
  return {
    id: `eds-roi-${year}-${province}`,
    label: provinceLabel(key, year),
    cloneOf: p.base,
    files: { fgb: enc(p.rel) },
    style: { ...STYLE },
    labelProperty: 'ENGLISH',
    useLOD: false,
  };
}

function baseRecord(key) {
  const p = PROV[key];
  const years = (usedBy[key] || []).sort();
  const list = years.length > 1 ? years.slice(0, -1).join(', ') + ' and ' + years[years.length - 1] : years[0];
  return {
    id: p.base,
    name: `${p.prov} District Electoral Divisions/Wards ${p.date}`,
    slug: p.base,
    category: 'electoral-divisions',
    hidden: true,
    featured: false,
    provider: [...PROVIDER],
    files: { fgb: enc(p.rel) },
    style: { ...STYLE },
    keywords: [p.prov.toLowerCase(), 'ED', 'DED', 'ward', String(p.date)],
    labelProperty: 'ENGLISH',
    date: p.date,
    description: `${p.prov} component used by the ${list} Republic of Ireland District Electoral Divisions/Wards ${years.length > 1 ? 'entries' : 'entry'}.`,
  };
}

function compositeRecord(year) {
  const g = GRID[year];
  const m = META[year];
  const order = ['connacht', 'leinster', 'munster', 'ulster'];
  const variants = order.map((prov) => variant(year, prov, g[prov]));
  const downloads = order.map((prov) => {
    const p = PROV[g[prov]];
    return { label: `${p.prov} DEDs/Wards ${p.date}`, url: raw(p.rel), type: 'FlatGeobuf' };
  });
  downloads.push({ label: `Source notes ${year}`, url: m.sidecar.rel, type: m.sidecar.kind });

  const references = [
    { label: `District Electoral Divisions/Wards ${year} source notes`, url: m.sidecar.rel, note: 'Sidecar notes supplied in the Irish Digitised Boundaries archive.' },
    ...(m.extraRefs || []),
    ...m.sources.map((s) => ({ label: s })),
  ];

  return {
    id: `eds-roi-${year}`,
    name: `District Electoral Divisions/Wards ${year}`,
    slug: `eds-roi-${year}`,
    category: 'wards',
    isGroup: true,
    featured: true,
    date: m.date,
    provider: [...PROVIDER],
    style: { ...STYLE },
    labelProperty: 'ENGLISH',
    variants,
    downloads,
    references,
    keywords: ['electoral division', 'district electoral division', 'DED', 'ward', String(year), 'republic of ireland', 'historic', 'small electoral units'],
    bounds: NATIONAL_BOUNDS.map((b) => [...b]),
    description: m.notes,
  };
}

// ---- Apply ----
const doc = JSON.parse(readFileSync(MAPS, 'utf8'));
const byId = new Map(doc.maps.map((m, i) => [m.id, i]));

function upsert(record) {
  if (byId.has(record.id)) { doc.maps[byId.get(record.id)] = record; return 'replaced'; }
  doc.maps.push(record); byId.set(record.id, doc.maps.length - 1); return 'added';
}

const log = [];
// New hidden province bases (skip the ones already live).
for (const key of Object.keys(PROV)) {
  if (PROV[key].existing) continue;
  log.push(`base ${PROV[key].base}: ${upsert(baseRecord(key))}`);
}
// Composite year records (1950/1954 replace placeholders; others new).
for (const year of Object.keys(GRID)) {
  log.push(`composite eds-roi-${year}: ${upsert(compositeRecord(Number(year)))}`);
}

writeFileSync(MAPS, JSON.stringify(doc, null, 2) + '\n');
console.log(log.join('\n'));
console.log(`\nmaps total: ${doc.maps.length}`);
