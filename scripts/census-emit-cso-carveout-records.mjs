#!/usr/bin/env node
/**
 * CSO CC-BY carveout emitter: the 35 rows in SPLIT-nisra-ogl.csv marked
 * attributionLicence 'review-CSO-or-defer' (provider 'CSO PXStat') are
 * CSO PxStat cubes with cross-border ("Ireland and Northern Ireland") content.
 * They were split out of the NISRA-OGL set and deferred pending rights
 * confirmation. Rights are now confirmed clear (CSO CC BY 4.0), so this emits
 * them in the SAME shape as the main CSO cube tranche (cat1-census-cso-ccby):
 * provider CSO, CC BY 4.0, dual references (PxStat table + JSON-stat cube).
 *
 * Distinct bucket `censusCsoNiCarveout` keeps the original auto-approved 6,560
 * count stable for provenance clarity.
 *
 * Usage: node scripts/census-emit-cso-carveout-records.mjs --out <path>
 */
import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'census-cso-carveout-records.json';

const CSV = 'data/review-inputs/census-publish-ready/SPLIT-nisra-ogl.csv';
const ATTRIBUTION = 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.';

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

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
const yearOf = (t) => (t.match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || '';

const sources = [];
for (const r of records) {
  const id = r[ix.id], title = r[ix.title], licenceCol = (r[ix.attributionLicence] || '').trim();
  // ONLY the CSO-PXStat-but-NI carveout (the rows the NISRA emitter skips)
  if (!(licenceCol === 'review-CSO-or-defer' || (r[ix.provider] || '').trim() === 'CSO PXStat')) continue;
  const codeLc = (id.match(/^census-\d+-(.+)$/) || [, id])[1];
  const CODE = codeLc.toUpperCase();
  sources.push({
    id: `approved-publication:census-cube-${codeLc}-${slugify(title)}`,
    slug: `approved-publication-census-cube-${codeLc}-${slugify(title)}`,
    type: 'approved-table-source',
    title,
    subtitle: 'CSO / census-statistical / Browse/Tables plus Sources',
    category: 'Approved tables',
    date: yearOf(title),
    dateSource: 'title',
    provider: ['CSO'],
    description: `CSO PxStat census statistical cube ${CODE} (cross-border Ireland / Northern Ireland). Published as a Books/Tables/Sources source record under Creative Commons Attribution 4.0. ${ATTRIBUTION}`,
    keywords: ['census-statistical', 'CSO', 'CC-BY-4.0', 'cross-border', 'northern-ireland', 'publish', 'approved-publication', CODE],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approved-staged',
    license: 'CC BY 4.0',
    licence: 'CC BY 4.0',
    attribution: ATTRIBUTION,
    references: [
      { label: `CSO PxStat table ${CODE}`, url: `https://data.cso.ie/table/${CODE}`, note: 'CC BY 4.0' },
      { label: `JSON-stat cube (${CODE})`, url: `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/${CODE}/JSON-stat/2.0/en`, note: 'CC BY 4.0' },
    ],
    approval: {
      stagingId: id,
      recommendedAction: 'publish',
      batchId: 'cat1-census-cso-ccby-ni-carveout',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-cso-pxstat',
      sourceResolutionConfidence: 'high',
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
      defaultConfidence: 'high',
      rightsNote: 'CSO CC-BY origin; NI-carveout rights confirmed clear 2026-07-07.',
    },
  });
}

const doc = {
  schemaVersion: 1,
  generatedFrom: CSV,
  candidateOnly: true,
  note: 'CSO CC-BY NI-carveout (35 CSO-PXStat cross-border cubes). Rights confirmed clear 2026-07-07; emitted in the same shape as cat1-census-cso-ccby.',
  counts: { total: sources.length },
  sources,
};
writeFileSync(out, JSON.stringify(doc, null, 2));
console.log(`emitted ${sources.length} CSO carveout records -> ${out}`);
