#!/usr/bin/env node
/**
 * Compile the cleaned NI census query model into a single, path-free bundle for
 * the interactive Census Explorer frontend (pages/census-explorer.html).
 *
 * Inputs (data/census/cleaned/):
 *   - concept-ontology.json          15 concepts, per-year sourceTables + coverage
 *   - website-bundles/catalogue.json tableIndex (10,341 raw staging rows)
 *   - availability-graph.json        per-concept year/geography/table availability
 *   - comparability-groups.json      cross-census concept groups + crosswalks
 *
 * Output: data/census/explorer-bundle.json  (all local file paths stripped)
 *
 * The catalogue tableIndex is ~92% raw per-file staging fragments (the
 * DATA/DESC/META x geography splits, e.g.
 * `local_archive_2011:nested:...::HIGHER_GEOGRAPHIES_DC1101NIDATA0_CSV`). We
 * extract a canonical table code (DC1101NI, MS-A01, CAS308, ...) and dedupe by
 * code+year, collapsing the digital-census years (2001/2011/2021) to ~644
 * logical NI tables. Each table + concept year resolves to a public provider
 * landing page (NISRA per census year, or the CSO Internet Archive historical
 * mirror) -- no invented deep links.
 *
 * Usage: node scripts/census/build-census-explorer-bundle.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const CLEANED = 'data/census/cleaned';
const OUT = 'data/census/explorer-bundle.json';
const DIGITAL_YEARS = [2001, 2011, 2021];

const ontology = JSON.parse(readFileSync(`${CLEANED}/concept-ontology.json`, 'utf8'));
const catalogue = JSON.parse(readFileSync(`${CLEANED}/website-bundles/catalogue.json`, 'utf8'));
const availability = JSON.parse(readFileSync(`${CLEANED}/availability-graph.json`, 'utf8'));
const comparability = JSON.parse(readFileSync(`${CLEANED}/comparability-groups.json`, 'utf8'));

// --- Public source resolution (stable provider landings; no invented deep links) ---
const CENSUS_SOURCE = {
  2001: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/census/2001-census', label: 'NISRA — Northern Ireland Census 2001' },
  2011: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/census/2011-census', label: 'NISRA — Northern Ireland Census 2011' },
  2021: { provider: 'NISRA', url: 'https://www.nisra.gov.uk/statistics/census/census-2021', label: 'NISRA — Northern Ireland Census 2021' },
};
const HISTORICAL_SOURCE = {
  provider: 'CSO / Internet Archive',
  url: 'https://archive.org/details/civgraph-cso-historical-reports',
  label: 'CSO historical census & statistical reports (Internet Archive mirror, CC BY 4.0)',
};

// --- Canonical table-code extraction ---
const lastSeg = (id) => { const p = String(id).split('::'); return p[p.length - 1]; };
function extractCode(id) {
  const raw = String(id);
  // 2021 NISRA flexible-table ids: MS-A01:all:dea
  let m = raw.match(/^([A-Za-z]{2,3}-[A-Za-z]\d{2,3}[A-Za-z]?)(?=[:_]|$)/);
  if (m) return m[1].toUpperCase();
  const seg = lastSeg(raw);
  // DATA/DESC/META fragment -> the code that precedes it
  m = seg.match(/([A-Za-z]{2,4}\d{3,4}[A-Za-z]{0,2})(?:DATA|DESC|META)/i);
  if (m) return m[1].toUpperCase();
  // 2001 TABLE_CAS308_WARD_csv
  m = seg.match(/TABLE[_-]([A-Za-z]{2,4}\d{3,4}[A-Za-z]{0,2})/i);
  if (m) return m[1].toUpperCase();
  // clean id that already IS a code
  m = raw.match(/^([A-Za-z]{2,4}\d{2,4}[A-Za-z]{0,2})$/);
  if (m) return m[1].toUpperCase();
  // generic census-code token in the last segment
  m = seg.match(/(?:^|_)([A-Za-z]{2,4}\d{3,4}[A-Za-z]{0,2})(?:_|$)/);
  if (m) return m[1].toUpperCase();
  return null;
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
function bestConfidence(a, b) {
  return (CONFIDENCE_RANK[b] || 0) > (CONFIDENCE_RANK[a] || 0) ? b : a;
}
function pickMode(counter) {
  let best = null, bestN = 0;
  for (const [k, n] of counter) if (n > bestN) { best = k; bestN = n; }
  return best;
}

// --- Collapse tableIndex to logical tables (code+year), digital years only ---
const logical = new Map(); // key `${code}@${year}`
for (const row of catalogue.tableIndex || []) {
  if (!DIGITAL_YEARS.includes(row.year)) continue;
  const code = extractCode(row.id);
  if (!code) continue; // geography code-files, table-outline xlsx, hierarchies
  const key = `${code}@${row.year}`;
  if (!logical.has(key)) {
    logical.set(key, {
      code,
      year: row.year,
      titles: new Map(),
      topics: new Map(),
      geographyLevels: new Set(),
      confidence: 'low',
      rowCount: 0,
    });
  }
  const e = logical.get(key);
  e.rowCount += 1;
  const t = (row.title || '').trim();
  if (t) e.titles.set(t, (e.titles.get(t) || 0) + 1);
  const topic = (row.topic || '').trim();
  if (topic && topic !== 'unknown') e.topics.set(topic, (e.topics.get(topic) || 0) + 1);
  const geo = (row.geographyLevel || '').trim();
  if (geo && geo !== 'unknown') e.geographyLevels.add(geo);
  e.confidence = bestConfidence(e.confidence, row.confidence);
}

const tables = [...logical.values()]
  .map((e) => {
    const src = CENSUS_SOURCE[e.year];
    const geos = [...e.geographyLevels].sort();
    return {
      code: e.code,
      year: e.year,
      title: pickMode(e.titles) || e.code,
      topic: pickMode(e.topics) || null,
      geographyLevels: geos.length ? geos : ['unknown'],
      confidence: e.confidence,
      fileCount: e.rowCount,
      source: { provider: src.provider, url: src.url, label: `${src.label} — table ${e.code}` },
    };
  })
  .sort((a, b) => a.year - b.year || a.code.localeCompare(b.code));

const tableCodeYear = new Set(tables.map((t) => `${t.code}@${t.year}`));

// --- Concepts with per-year source resolution ---
const comparabilityByTopic = new Map(
  (comparability.conceptGroups || []).map((g) => [g.topic, g]),
);

const concepts = (ontology.concepts || []).map((c) => {
  const yearsDigital = c.yearsAvailableDigital || [];
  const yearsHistorical = c.yearsAvailableHistorical || [];
  const availabilityEntry = availability.concepts?.[c.id] || null;

  const yearCells = DIGITAL_YEARS.map((year) => {
    const rawCode = c.sourceTables?.[String(year)] || null;
    const code = rawCode ? String(rawCode).toUpperCase() : null;
    const available = Boolean(code) && yearsDigital.includes(year);
    const src = CENSUS_SOURCE[year];
    return {
      year,
      available,
      code,
      // whether the declared code resolved to a real logical table in the catalogue
      resolvedTable: Boolean(code) && tableCodeYear.has(`${code}@${year}`),
      source: available ? { provider: src.provider, url: src.url, label: code ? `${src.label} — table ${code}` : src.label } : null,
    };
  });

  const historicalCells = yearsHistorical.map((year) => ({
    year,
    available: true,
    source: { provider: HISTORICAL_SOURCE.provider, url: HISTORICAL_SOURCE.url, label: HISTORICAL_SOURCE.label },
  }));

  const group = comparabilityByTopic.get(c.id);

  return {
    id: c.id,
    label: c.label,
    priority: c.priority,
    difficulty: c.difficulty,
    comparabilityNotes: c.comparabilityNotes || group?.notes || null,
    exactComparableYears: group?.exactComparableYears || yearsDigital,
    comparableNativeLevels: group?.comparableNativeLevels || null,
    yearsDigital,
    yearsHistorical,
    digitalYearCells: yearCells,
    historicalYearCells: historicalCells,
    geographyLevels: availabilityEntry?.geographyLevels
      ? Object.keys(availabilityEntry.geographyLevels).filter((g) => g !== 'unknown').sort()
      : [],
    tableCount: availabilityEntry?.tables ? new Set(availabilityEntry.tables).size : null,
  };
});

// --- Facets for the table finder ---
const topics = [...new Set(tables.map((t) => t.topic).filter(Boolean))].sort();
const geographyLevels = [...new Set(tables.flatMap((t) => t.geographyLevels).filter((g) => g !== 'unknown'))].sort();

const bundle = {
  schemaVersion: 1,
  generatedFrom: 'data/census/cleaned (concept-ontology, catalogue, availability-graph, comparability-groups)',
  scope: 'Northern Ireland census (NISRA digital tables 2001/2011/2021 + CSO historical reports 1841–1991)',
  sources: {
    census: CENSUS_SOURCE,
    historical: HISTORICAL_SOURCE,
  },
  facets: {
    years: DIGITAL_YEARS,
    topics,
    geographyLevels,
  },
  counts: {
    concepts: concepts.length,
    tables: tables.length,
    tablesByYear: DIGITAL_YEARS.reduce((acc, y) => { acc[y] = tables.filter((t) => t.year === y).length; return acc; }, {}),
  },
  concepts,
  tables,
};

writeFileSync(OUT, JSON.stringify(bundle) + '\n');
console.log(
  `Wrote ${OUT}: ${concepts.length} concepts, ${tables.length} logical tables ` +
  `(${JSON.stringify(bundle.counts.tablesByYear)}), ${topics.length} topics, ${geographyLevels.length} geography levels`
);

// Guard: never leak a local filesystem path into the shipped bundle.
const LOCAL = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/|data\/census\/\d{4}\/|data\/downloads\/|local_archive)/i;
if (LOCAL.test(JSON.stringify(bundle))) {
  throw new Error('explorer bundle leaked a local filesystem path or staging id');
}
