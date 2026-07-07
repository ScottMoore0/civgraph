#!/usr/bin/env node
/**
 * NISRA OGL census emitter: turn SPLIT-nisra-ogl.csv into approved-publication
 * gate records under OGL v3.0. Fork of census-emit-gate-records.mjs.
 *
 * The CSV has a thin schema (id,title,organisation,provider,jurisdiction,
 * attributionLicence) with NO sourceSlugOrId/confidence. Per-record source URL:
 *   - 22 commissioned-table codes (slug matches commissioned-table-(ct|ext)...)
 *     -> https://data.nisra.gov.uk/table/{CODE}
 *   - the rest -> providerHome (https://www.nisra.gov.uk), sanctioned by
 *     attribution.json where no clean per-record URL is derivable.
 * Rows with attributionLicence 'review-CSO-or-defer' (35 CSO-PXStat-but-NI
 * carveout) are SKIPPED — CSO CC-BY origin, need manual rights confirmation.
 *
 * Usage: node scripts/census-emit-nisra-records.mjs [--limit N] --out <path>
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? +args[args.indexOf('--limit') + 1] : Infinity;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'census-nisra-records.json';

const CSV = 'data/review-inputs/census-publish-ready/SPLIT-nisra-ogl.csv';
const ATTR = JSON.parse(readFileSync('data/review-inputs/census-publish-ready/attribution.json', 'utf8')).variants.nisra;

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
let counted = 0, deferred = 0, withCode = 0, providerHomeOnly = 0;
for (const r of records) {
  if (counted >= limit) break;
  const id = r[ix.id], title = r[ix.title], licenceCol = (r[ix.attributionLicence] || '').trim();
  // skip the CSO-PXStat-but-NI carveout (CSO CC-BY origin; do not auto-apply OGL)
  if (licenceCol === 'review-CSO-or-defer' || (r[ix.provider] || '').trim() === 'CSO PXStat') { deferred++; continue; }
  counted++;
  const slug = (id.match(/^census-\d+-(.+)$/) || [, id])[1];
  const codeMatch = slug.match(/commissioned-table-((?:ct|ext)[\w-]+)/i);
  const code = codeMatch ? codeMatch[1].toUpperCase() : '';
  const references = code
    ? [{ label: `NISRA table ${code}`, url: ATTR.sourceUrlPattern.replace('{sourceSlugOrId}', code), note: 'OGL v3.0' }]
    : [{ label: 'NISRA', url: ATTR.providerHome, note: 'OGL v3.0' }];
  if (code) withCode++; else providerHomeOnly++;
  sources.push({
    id: `approved-publication:census-nisra-${slugify(id)}`,
    slug: `approved-publication-census-nisra-${slugify(id)}`,
    type: 'approved-table-source',
    title,
    subtitle: 'NISRA / census-statistical / Browse/Tables plus Sources',
    category: 'Approved tables',
    date: yearOf(title),
    provider: ['NISRA'],
    description: `NISRA census statistical source${code ? ` (commissioned table ${code})` : ''}. Published as a Books/Tables/Sources source record under the Open Government Licence v3.0. ${ATTR.attributionText}`,
    keywords: ['census-statistical', 'NISRA', 'OGL-v3.0', 'northern-ireland', 'publish', 'approved-publication', ...(code ? [code] : [])],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approved-staged',
    license: 'OGL v3.0',
    licence: 'OGL v3.0',
    attribution: ATTR.attributionText,
    references,
    approval: {
      stagingId: id,
      recommendedAction: 'publish',
      batchId: 'cat1-census-nisra-ogl',
      reviewState: 'approval-ready',
      sourceResolutionStatus: code ? 'resolved-nisra-table' : 'provider-home-fallback',
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
    },
  });
}

const doc = {
  schemaVersion: 1,
  generatedFrom: CSV,
  candidateOnly: true,
  note: 'NISRA census sources under OGL v3.0. 22 with real table URLs, rest cite providerHome (sanctioned fallback). 35 CSO-PXStat-but-NI carveout skipped/deferred.',
  counts: { total: sources.length, withTableUrl: withCode, providerHomeFallback: providerHomeOnly, deferredCarveout: deferred },
  sources,
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`emitted ${sources.length} NISRA records (${withCode} with table URL, ${providerHomeOnly} providerHome) -> ${out}; deferred ${deferred} carveout`);
