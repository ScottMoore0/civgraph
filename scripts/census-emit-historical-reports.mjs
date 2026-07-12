#!/usr/bin/env node
/**
 * Emit approved-publication records for the CSO historical census & statistical
 * reports mirrored to the Internet Archive item `civgraph-cso-historical-reports`
 * (https://archive.org/details/civgraph-cso-historical-reports, CC BY 4.0).
 *
 * Input:  data/census/source-inventory/cso-historical-reports-ia-manifest.json
 *           (2,172 original-content files; built by
 *            scripts/census/build-cso-historical-reports-ia-manifest.mjs)
 * Joins:  data/census/source-inventory/cso-historical-reports.json  (direct crawl)
 *         data/census/source-inventory/cso-wayback-recovery.json     (wayback recovery)
 *           to recover each file's original CSO source URL + descriptive link text.
 *           Join is by download-path basename (exact), falling back to a cleaned
 *           filename stem. ~1,757 of 2,172 files resolve to an original URL; the
 *           rest carry the Internet Archive item URL + mirror download only.
 *
 * Output: an approved-publication candidate file consumed by
 *         `node scripts/merge-census-pilot.mjs <out> censusHistoricalReports cat1-census-historical-reports`.
 *
 * GOTCHAS handled here:
 *  (a) Year parsing uses digit-only lookarounds — `_` is a regex word char so
 *      \b fails on "1971_Vol". We use /(?<![0-9])(?:1[6789]\d\d|20[0-2]\d)(?![0-9])/.
 *  (b) 561 files are Wayback-recovered, named
 *      `wayback/<Name>.<14-digit-timestamp>.<hash>.<ext>`. We strip the
 *      `wayback/` prefix, the trailing `.<hash>` and the `.<14 digits>` capture
 *      timestamp before matching/titling, and never read the capture timestamp
 *      as a census year.
 *
 * Usage: node scripts/census-emit-historical-reports.mjs [outPath]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const MANIFEST = 'data/census/source-inventory/cso-historical-reports-ia-manifest.json';
const HIST = 'data/census/source-inventory/cso-historical-reports.json';
const WAYBACK = 'data/census/source-inventory/cso-wayback-recovery.json';
const OUT = process.argv[2] || 'data/census/candidates/cso-historical-reports.approved.json';

const ITEM = 'civgraph-cso-historical-reports';
const ITEM_URL = `https://archive.org/details/${ITEM}`;
const ATTRIBUTION =
  'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.';

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const hist = JSON.parse(readFileSync(HIST, 'utf8'));
const way = JSON.parse(readFileSync(WAYBACK, 'utf8'));

const base = (p) => String(p).split('/').pop();
const stripExt = (n) => n.replace(/\.[^.]+$/, '');
// direct-crawl download filenames look like `<Name>-<10 hex>.<ext>`
const histStem = (n) => stripExt(n).replace(/-[0-9a-f]{10}$/i, '');
// wayback download filenames look like `<Name>.<14 digits>.<10 hex>.<ext>`
const wayStem = (n) =>
  stripExt(n).replace(/\.[0-9a-f]{10}$/i, '').replace(/\.\d{14}$/, '');

// Build lookup indexes over successfully-downloaded assets.
const histBase = new Map();
const histStemIdx = new Map();
for (const a of hist.assets || []) {
  if (!a.download?.path) continue;
  const b = base(a.download.path);
  histBase.set(b, a);
  const s = histStem(b);
  if (!histStemIdx.has(s)) histStemIdx.set(s, a);
}
const wayBase = new Map();
const wayStemIdx = new Map();
for (const a of way.assets || []) {
  if (!a.download?.path) continue;
  const b = base(a.download.path);
  wayBase.set(b, a);
  const s = wayStem(b);
  if (!wayStemIdx.has(s)) wayStemIdx.set(s, a);
}

const YEAR_RE = /(?<![0-9])(?:1[6789]\d\d|20[0-2]\d)(?![0-9])/;
function parseYear(text) {
  const m = String(text).match(YEAR_RE);
  return m ? m[0] : null;
}

function humanize(stem) {
  return stem
    .replace(/[._]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

const sources = [];
const slugSeen = new Set();
let matched = 0;
let matchedWayback = 0;

for (const file of manifest.files) {
  const rawName = file.name;
  const isWayback = Boolean(file.wayback);
  const nameNoPrefix = isWayback ? rawName.replace(/^wayback\//i, '') : rawName;

  // slug basis is the full IA filename (minus wayback/ prefix and extension) so
  // it stays unique across re-captures of the same document.
  const slugBasis = stripExt(nameNoPrefix);
  const cleanStem = isWayback ? wayStem(nameNoPrefix) : histStem(nameNoPrefix);

  // Resolve the original CSO source via the crawl inventories.
  let asset = null;
  if (isWayback) {
    asset = wayBase.get(nameNoPrefix) || wayStemIdx.get(cleanStem) || null;
  } else {
    asset = histBase.get(nameNoPrefix) || histStemIdx.get(cleanStem) || null;
  }
  if (asset) {
    matched += 1;
    if (isWayback) matchedWayback += 1;
  }

  const sourceUrl = asset?.url || null;
  const sourcePage = asset?.sourcePage || null;
  const snapshotUrl = asset?.recovery?.snapshotUrl || null;
  const linkText = (asset?.text || '').replace(/\s*\((?:PD[RF]|PDF|DOC|XLS[XM]?|CSV|ZIP)[^)]*\)\s*$/i, '').trim();

  const humanStem = humanize(cleanStem);
  const title = linkText && linkText.length > 3 && !/^description of contents$/i.test(linkText)
    ? (humanStem ? `${humanStem} — ${linkText}` : linkText)
    : humanStem || cleanStem;
  const year = parseYear(cleanStem) || parseYear(sourceUrl || '') || null;

  const isData = file.ext === '.csv' || file.ext === '.xlsx' || file.ext === '.zip';
  const type = isData ? 'approved-table-source' : 'approved-book-or-report-source';

  let slug = slugify(`approved-publication-census-historical-${slugBasis}`);
  if (slugSeen.has(slug)) {
    let i = 2;
    while (slugSeen.has(`${slug}-${i}`)) i += 1;
    slug = `${slug}-${i}`;
  }
  slugSeen.add(slug);
  const id = `approved-publication:census-historical-${slugify(slugBasis)}`;

  const references = [];
  if (sourceUrl) {
    references.push({
      label: 'Original CSO source',
      url: sourceUrl,
      source: 'CSO',
      role: 'source-download',
      status: 'ok',
      sourcePage: sourcePage || undefined,
    });
  }
  if (snapshotUrl) {
    references.push({
      label: 'Wayback Machine snapshot',
      url: snapshotUrl,
      source: 'Internet Archive Wayback Machine',
      role: 'recovered-snapshot',
    });
  }
  references.push({
    label: 'Internet Archive item',
    url: ITEM_URL,
    source: 'Internet Archive',
    role: 'mirror-item',
  });

  const downloads = [{
    label: `${file.ext.replace(/^\./, '').toUpperCase()} (Internet Archive mirror)`,
    url: file.downloadUrl,
    type: file.ext.replace(/^\./, ''),
    size: file.size,
    status: 'mirrored',
    source: 'Internet Archive',
  }];

  sources.push({
    id,
    slug,
    type,
    title,
    subtitle: 'Central Statistics Office — historical census & statistical reports (Internet Archive mirror)',
    category: 'Approved census sources',
    date: year || undefined,
    provider: ['CSO'],
    description: `CSO historical census/statistical ${isData ? 'data file' : 'report'} mirrored to the Internet Archive item ${ITEM} under CC BY 4.0.`,
    url: sourceUrl || file.downloadUrl,
    license: 'CC BY 4.0',
    licence: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: ATTRIBUTION,
    keywords: [
      'census',
      'cso',
      'historical',
      'internet-archive',
      file.ext.replace(/^\./, ''),
      'approved-publication',
    ],
    references,
    downloads,
    publicationStatus: 'approval-ready',
    proposedBrowsePath: 'Browse/Tables plus Sources',
    approval: {
      recommendedAction: 'publish',
      batchId: 'cat1-census-historical-reports',
      reviewState: 'approval-ready',
      sourceResolutionStatus: sourceUrl ? 'resolved-original-source' : 'internet-archive-mirror-only',
      sourceResolutionConfidence: sourceUrl ? 'high' : 'medium',
    },
  });
}

mkdirSync(dirname(OUT), { recursive: true });
const payload = {
  schemaVersion: 1,
  generatedFrom: MANIFEST,
  tranche: 'cat1-census-historical-reports',
  counts: {
    total: sources.length,
    matchedToOriginalSource: matched,
    matchedWayback,
    books: sources.filter((s) => s.type === 'approved-book-or-report-source').length,
    tables: sources.filter((s) => s.type === 'approved-table-source').length,
  },
  sources,
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
console.log(
  `Wrote ${OUT}: ${sources.length} records ` +
  `(${payload.counts.books} book/report, ${payload.counts.tables} table; ` +
  `${matched} matched original source, ${matchedWayback} wayback)`
);
