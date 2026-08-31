#!/usr/bin/env node
/**
 * One index that answers "where is this corpus, and how do I fetch it".
 *
 * THE PROBLEM
 *
 * Civgraph's raw material is spread across three stores with no single map of them:
 *
 *   - R2 (data.civgraph.net)   -- fast, costs money, listable only via the API endpoints
 *   - Internet Archive         -- free and permanent, 151 items, but you must know the id
 *   - local disk only          -- not published anywhere, invisible to everyone
 *
 * Anyone wanting a file had to know which store it was in before they could look. The R2
 * side is listable at /_api/data-index, the IA side is partly covered by
 * raw-source-ia-mirrors.json (252 sources, per-FILE detail), and the local-only side was
 * recorded nowhere at all. This is the CORPUS-level map across all three.
 *
 * DELIBERATELY CORPUS-LEVEL, NOT FILE-LEVEL. Per-file resolution already exists and should
 * not be duplicated: /_api/data-index for R2, raw-source-ia-mirrors.json for mirrored raw
 * sources, and the IA item pages for everything else. Restating 1.9 million object keys here
 * would be a second copy to keep true. Each entry says which of those to ask.
 *
 * RIGHTS come from the R2 publication allowlist where the corpus is on R2, because that file
 * is already the reviewed record of what may be published and why. Nothing is asserted here
 * that is not asserted there.
 *
 * Sizes are stamped with measuredAt and will drift. They are for judging whether a download
 * is minutes or hours, not for accounting.
 *
 *   node scripts/build-corpus-index.mjs
 *   node scripts/build-corpus-index.mjs --check     # fails if stale; used by the gate
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ALLOWLIST = 'data/database/r2-publication-allowlist.json';
const IA_MIRRORS = 'data/database/raw-source-ia-mirrors.json';
const OUT = 'data/database/corpus-index.json';
const CHECK = process.argv.includes('--check');

const MEASURED_AT = '2026-08-31';
const R2_BASE = 'https://data.civgraph.net/';
const IA_DETAILS = 'https://archive.org/details/';
const IA_DOWNLOAD = 'https://archive.org/download/';

/**
 * The editorial layer: what corpora exist and where they live. Held here rather than in a
 * separate data file because every field is a judgement someone should read in review --
 * which store a corpus belongs in, and who may see it.
 *
 * access: 'public'       -- listed by /_api/data-index, fetchable by anyone
 *         'contributors' -- NOT in the publication allowlist; enumerable only via the
 *                           Access-gated /_api/contributions/r2-index. Note that objects
 *                           remain fetchable by exact key: not listing is not access control.
 *         'none'         -- held locally, published nowhere
 */
const CORPORA = [
  // ---- on R2, public ----
  { id: 'cso-pxstat', title: 'CSO PxStat statistical cubes', provider: 'CSO', jurisdiction: 'IE',
    store: 'r2', access: 'public', r2Prefix: 'data/cso-pxstat/',
    measured: { files: 25060, gigabytes: 7.9 },
    note: 'Complete: all 12,528 matrices in the live PxStat catalogue, as JSON-stat plus release metadata.' },
  { id: 'datagovie', title: 'data.gov.ie mirror (Open Data Portal Ireland)', provider: 'data.gov.ie', jurisdiction: 'IE',
    store: 'r2', access: 'public', r2Prefix: 'data/datagovie/',
    measured: { files: 30252, gigabytes: 144.54, packages: 20700 },
    note: 'Licence is per package; see data/database/datagovie-licence-summary.json before reusing '
      + 'files from a given package. The mirror\'s own _manifest.csv is from the first run and '
      + 'describes 4,947 resources across 3,050 packages, about a sixth of what is here, so figures '
      + 'taken from it understate this prefix roughly six-fold. Upload and licence harvest were both '
      + 'in progress at measuredAt.' },
  { id: 'maps', title: 'Boundary geometry and map layers', provider: 'various', jurisdiction: 'IE/NI',
    store: 'r2', access: 'public', r2Prefix: 'data/maps/',
    note: 'Runtime store for the map viewer. Must stay on R2: the site fetches it directly.' },
  { id: 'pointclouds', title: 'Point clouds as 3D Tiles', provider: 'OpenDataNI', jurisdiction: 'NI',
    store: 'r2', access: 'public', r2Prefix: 'data/pointclouds/',
    measured: { files: 393355, gigabytes: 32.95 },
    note: 'Runtime store: deck.gl Tile3DLayer fetches these directly, so they cannot move to IA.' },
  { id: 'books', title: 'NI Hansard, Acts and boundary reports', provider: 'Parliament of Northern Ireland', jurisdiction: 'NI',
    store: 'both', access: 'public', r2Prefix: 'data/books/',
    iaIdentifiers: ['civgraph-ni-hansard-1921-1945', 'civgraph-ni-acts-sro-1921-1932'] },
  { id: 'nisra-files', title: 'NISRA source mirror', provider: 'NISRA', jurisdiction: 'NI',
    store: 'both', access: 'public', r2Prefix: 'data/nisra-files/',
    measured: { files: 33593, gigabytes: 7.52 },
    iaIdentifiers: ['civgraph-nisra-statistics-csv-tables'] },
  { id: 'nisra-portal', title: 'NISRA portal tables, cleaned', provider: 'NISRA', jurisdiction: 'NI',
    store: 'r2', access: 'public', r2Prefix: 'data/nisra-portal/',
    measured: { files: 1115, gigabytes: 0.05 } },
  { id: 'deprivation', title: 'NI Multiple Deprivation Measure originals', provider: 'NISRA', jurisdiction: 'NI',
    store: 'r2', access: 'public', r2Prefix: 'data/deprivation/',
    measured: { files: 6, gigabytes: 0.007 } },
  { id: 'thumbnails', title: 'Rendered feature thumbnails', provider: 'Civgraph', jurisdiction: 'IE/NI',
    store: 'r2', access: 'public', r2Prefix: 'data/thumbnails/',
    measured: { files: 47521, gigabytes: 0.204 },
    note: 'Derived renders. Rights follow the source maps.' },
  { id: 'oireachtas-fulltext', title: 'Oireachtas debates, full text', provider: 'Oireachtas', jurisdiction: 'IE',
    store: 'r2', access: 'public', r2Prefix: 'data/sources/oireachtas-fulltext/' },

  // ---- on R2, contributors only ----
  { id: 'polling', title: 'LucidTalk polling tables and reports', provider: 'LucidTalk', jurisdiction: 'NI',
    store: 'r2', access: 'contributors', r2Prefix: 'data/polling/',
    measured: { files: 116, gigabytes: 0.036 },
    note: 'Deliberately NOT in the publication allowlist, so it is absent from the public index. '
      + 'Commercial polling material; no open-government licence reaches it. Objects remain '
      + 'fetchable by exact key -- omission from the index is discoverability, not access control.' },

  // ---- Internet Archive ----
  { id: 'opendatani', title: 'Open Data NI mirror', provider: 'OpenDataNI', jurisdiction: 'NI',
    store: 'internet-archive', access: 'public',
    licence: 'OGL v3.0',
    iaIdentifiers: ['civgraph-opendatani-data-001', 'civgraph-opendatani-data-004', 'civgraph-opendatani-data-005',
      'civgraph-opendatani-data-006', 'civgraph-opendatani-data-007', 'civgraph-opendatani-data-008',
      'civgraph-opendatani-data-009', 'civgraph-opendatani-data-010', 'civgraph-opendatani-data-011'],
    measured: { localFiles: 5331, localGigabytes: 221.51, iaFiles: 2093, iaGigabytes: 38.94 },
    coverage: 'PARTIAL',
    note: 'Held on IA rather than R2 by decision, 2026-08-31, for durability and to keep 221.5 GB '
      + 'off paid storage. Coverage is thin and should not be read as done: counted from the IA '
      + 'metadata API on 2026-08-31, the nine items hold 2,093 files / 38.94 GB against 5,331 '
      + 'local files / 221.51 GB -- 39 per cent of files but only 17.6 per cent by volume, so the '
      + 'large files are disproportionately the missing ones. Identifiers -002 and -003 return no '
      + 'files and are effectively absent. Completing this mirror is outstanding work.' },
  { id: 'cso-historical-reports', title: 'CSO historical census and statistical reports', provider: 'CSO', jurisdiction: 'IE',
    store: 'internet-archive', access: 'public', licence: 'CC BY 4.0',
    iaIdentifiers: ['civgraph-cso-historical-reports'],
    measured: { localFiles: 5743, localGigabytes: 4.74 },
    note: '2,172 reports, PDF 1841-1991 plus SAPS 2016/2022.' },
  { id: 'raw-sources', title: 'Raw source files for Browse records', provider: 'various', jurisdiction: 'IE/NI',
    store: 'internet-archive', access: 'public',
    iaIdentifiers: ['civgraph-data-gov-ie-raw-sources', 'civgraph-open-data-ni-raw-sources'],
    note: 'Per-FILE resolution for these lives in data/database/raw-source-ia-mirrors.json, '
      + 'including names, formats, sizes and checksums.' },
  { id: 'scanned-maps', title: 'Scanned historic maps', provider: 'OSNI / Tailte Éireann / CSO / NISRA', jurisdiction: 'IE/NI',
    store: 'internet-archive', access: 'public',
    iaIdentifiers: ['civgraph-osni-maps', 'civgraph-tailte-eireann-maps', 'civgraph-cso-maps',
      'civgraph-nisra-maps', 'civgraph-osi-maps', 'civgraph-osni-boundary-data'],
    note: 'Plus ~120 per-sheet items for the 1974/1984/1992 LGD boundary map series, referenced '
      + 'individually from the map records rather than listed here.' },

  // ---- held locally, published nowhere ----
  { id: 'nisra-wayback', title: 'NISRA pages recovered from the Wayback Machine', provider: 'NISRA', jurisdiction: 'NI',
    store: 'local-only', access: 'none', licence: 'OGL v3.0',
    measured: { localFiles: 24889, localGigabytes: 14.16 },
    note: 'Candidate for IA. OGL, not runtime-fetched.' },
  { id: 'proni', title: 'PRONI eCatalogue material', provider: 'PRONI', jurisdiction: 'NI',
    store: 'local-only', access: 'none',
    measured: { localFiles: 5119, localGigabytes: 9.9 },
    note: 'The /proni app serves search from D1; these are the underlying files.' },
  { id: 'oireachtas-opendata', title: 'Oireachtas open data, structured', provider: 'Oireachtas', jurisdiction: 'IE',
    store: 'local-only', access: 'none',
    measured: { localFiles: 5290, localGigabytes: 5.04 },
    note: 'The full-text side is already on R2; this is the structured counterpart.' },
  { id: 'tellus', title: 'Tellus airborne geophysics', provider: 'GSNI', jurisdiction: 'NI',
    store: 'local-only', access: 'none', licence: 'OGL v3.0',
    measured: { localFiles: 27435, localGigabytes: 4.94 },
    note: 'Derived rasters are already published under data/maps/; these are the source grids.' },
  { id: 'niassembly-xml', title: 'NI Assembly XML dumps', provider: 'NI Assembly', jurisdiction: 'NI',
    store: 'local-only', access: 'none',
    measured: { localFiles: 2, localGigabytes: 4.47 } },
  { id: 'osni-fusion', title: 'OSNI Fusion extracts', provider: 'OSNI', jurisdiction: 'NI',
    store: 'local-only', access: 'none',
    measured: { localFiles: 11, localGigabytes: 3.68 } },
];

if (!existsSync(ALLOWLIST)) {
  console.error(`FAIL: ${ALLOWLIST} is missing; it is the source of the rights text.`);
  process.exit(1);
}
const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
const rightsByPrefix = new Map((allowlist.prefixes || []).map((p) => [p.prefix, p.rights]));
const iaMirrors = existsSync(IA_MIRRORS) ? JSON.parse(readFileSync(IA_MIRRORS, 'utf8')) : null;

const entries = CORPORA.map((corpus) => {
  const entry = {
    id: corpus.id,
    title: corpus.title,
    provider: corpus.provider,
    jurisdiction: corpus.jurisdiction,
    store: corpus.store,
    access: corpus.access,
  };
  if (corpus.coverage) entry.coverage = corpus.coverage;

  if (corpus.r2Prefix) {
    entry.r2 = {
      prefix: corpus.r2Prefix,
      baseUrl: R2_BASE + corpus.r2Prefix,
      allowlisted: rightsByPrefix.has(corpus.r2Prefix),
      listVia: corpus.access === 'public'
        ? `https://civgraph.net/_api/data-index?prefix=${encodeURIComponent(corpus.r2Prefix)}`
        : `https://civgraph.net/_api/contributions/r2-index?prefix=${encodeURIComponent(corpus.r2Prefix)}`,
    };
  }
  if (corpus.iaIdentifiers?.length) {
    entry.internetArchive = corpus.iaIdentifiers.map((identifier) => ({
      identifier,
      details: IA_DETAILS + identifier,
      download: IA_DOWNLOAD + identifier,
      // `ia` CLI equivalent, because bulk retrieval by hand from a details page is miserable.
      bulk: `ia download ${identifier}`,
    }));
  }
  const rights = corpus.licence || (corpus.r2Prefix ? rightsByPrefix.get(corpus.r2Prefix) : undefined);
  if (rights) entry.rights = rights;
  if (corpus.measured) entry.measured = { ...corpus.measured, measuredAt: MEASURED_AT };
  if (corpus.note) entry.note = corpus.note;
  return entry;
});

const counts = entries.reduce((acc, entry) => {
  acc[entry.store] = (acc[entry.store] || 0) + 1;
  return acc;
}, {});

const index = {
  schemaVersion: 1,
  description: 'Corpus-level map of where Civgraph\'s raw material lives and how to fetch it. '
    + 'Per-file resolution is deliberately not duplicated here: use the listVia endpoint for R2, '
    + 'raw-source-ia-mirrors.json for mirrored raw sources, or the Internet Archive item page.',
  measuredAt: MEASURED_AT,
  stores: {
    r2: { base: R2_BASE, note: 'Public prefixes are listable at /_api/data-index. Everything in the bucket, including unallowlisted prefixes, is listable by contributors at /_api/contributions/r2-index.' },
    internetArchive: { base: IA_DETAILS, note: 'Free, permanent, no authentication. `ia download <identifier>` retrieves a whole item.' },
    localOnly: { note: 'Held on the maintainer\'s disk and published nowhere. Listed so the gap is visible rather than forgotten.' },
  },
  counts,
  perFileIndexes: iaMirrors
    ? [{ file: IA_MIRRORS, covers: `${iaMirrors.summary?.totalSources ?? '?'} sources, ${iaMirrors.summary?.files ?? '?'} files`, note: 'names, formats, sizes and checksums' }]
    : [],
  corpora: entries,
};

const body = `${JSON.stringify(index, null, 2)}\n`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== body) {
    console.error(`FAIL: ${OUT} is stale. Rebuild: node scripts/build-corpus-index.mjs`);
    process.exit(1);
  }
  console.log(`PASS: ${OUT} matches (${entries.length} corpora).`);
  process.exit(0);
}

writeFileSync(OUT, body);
console.log(`Wrote ${OUT}: ${entries.length} corpora.`);
for (const [store, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(2)}  ${store}`);
const gap = entries.filter((e) => e.store === 'local-only');
const gapGb = gap.reduce((sum, e) => sum + (e.measured?.localGigabytes || 0), 0);
console.log(`  ${gap.length} corpora (${gapGb.toFixed(1)} GB) are published nowhere.`);
