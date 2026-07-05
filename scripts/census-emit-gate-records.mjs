#!/usr/bin/env node
/**
 * Category-1 census emitter: turn the CSO CC-BY publishable tranche
 * (publish-tranche-cso-highconf.csv) into approved-publication-sources.json
 * gate-file records (Books/Tables/Sources source-table entries), with CC BY 4.0
 * attribution + CSO source URLs.
 *
 * Writes a CANDIDATE file (not the live gate file). Once the representation is
 * approved, these records are merged into data/database/approved-publication-sources.json
 * and materialised via `npm run build:browse`.
 *
 * Usage: node scripts/census-emit-gate-records.mjs [--limit N] --out <path>
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'census-gate-records.json';

const CSV = 'data/review-inputs/census-publish-ready/publish-tranche-cso-highconf.csv';
const ATTR = JSON.parse(readFileSync('data/review-inputs/census-publish-ready/attribution.json', 'utf8')).variants.cso;

// minimal CSV parse (handles quoted fields with commas)
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; } if (c === '\r' && text[i+1] === '\n') i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const lines = parseCsv(readFileSync(CSV, 'utf8'));
const hdr = lines[0];
const ix = Object.fromEntries(hdr.map((h, i) => [h.trim(), i]));
const records = lines.slice(1).filter(r => r.length >= hdr.length && r[ix.id]);

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const yearOf = (t) => (t.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || '';

const sources = [];
for (const r of records.slice(0, limit === Infinity ? records.length : limit)) {
  const id = r[ix.id], title = r[ix.title], code = r[ix.sourceSlugOrId], conf = r[ix.confidence];
  const sourceUrl = ATTR.sourceUrlPattern.replace('{sourceSlugOrId}', code);
  const apiUrl = ATTR.apiUrlPattern.replace('{sourceSlugOrId}', code);
  sources.push({
    id: `approved-publication:census-cube-${slugify(code + '-' + title)}`,
    slug: `approved-publication-census-cube-${slugify(code + '-' + title)}`,
    type: 'approved-table-source',
    title,
    subtitle: 'CSO / census-statistical / Browse/Books plus Sources',
    category: 'Approved tables',
    date: yearOf(title),
    provider: ['CSO'],
    description: `CSO PxStat statistical cube (matrix ${code}). Published as a Books/Tables/Sources source-table record under CC BY 4.0.`,
    keywords: ['census-statistical', 'statistical-cube', 'CSO', 'CC-BY-4.0', 'publish', 'approved-publication', code],
    proposedBrowsePath: 'Browse/Books plus Sources',
    publicationStatus: 'approved-staged',
    licence: 'CC BY 4.0',
    attribution: ATTR.attributionText,
    references: [
      { label: `CSO PxStat table ${code}`, url: sourceUrl, note: 'CC BY 4.0' },
      { label: `JSON-stat cube (${code})`, url: apiUrl, note: 'CC BY 4.0' },
    ],
    approval: {
      stagingId: id,
      recommendedAction: 'publish',
      batchId: 'cat1-census-cso-ccby',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-cso-pxstat',
      sourceResolutionConfidence: conf,
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
      defaultConfidence: conf,
    },
  });
}

const doc = {
  schemaVersion: 1,
  generatedFrom: 'data/review-inputs/census-publish-ready/publish-tranche-cso-highconf.csv',
  candidateOnly: true,
  note: 'Category-1 CSO census cubes as Books/Tables/Sources source records. Merge into data/database/approved-publication-sources.json + run npm run build:browse to materialise.',
  counts: { total: sources.length, sourcePool: records.length },
  sources,
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`emitted ${sources.length} of ${records.length} census gate records -> ${out}`);
console.log('sample id:', sources[0]?.id);
