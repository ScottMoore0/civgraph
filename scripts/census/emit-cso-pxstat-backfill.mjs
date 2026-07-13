#!/usr/bin/env node
/**
 * Backfill the CSO PxStat cubes that are not yet on Civgraph.
 *
 * The live PxStat catalogue (ReadCollection) lists 12,777 tables; ~5,809 are
 * already published as census-cube source records. This emits approved
 * Books/Tables/Sources catalogue records for the remaining tables (mostly
 * non-census social/economic statistics), each linking to the live PxStat
 * table page + JSON-stat cube API. Records are catalogue links (CC BY 4.0),
 * exactly like the existing census-cube tranche — no file mirroring.
 *
 * Inputs:
 *   - PxStat ReadCollection JSON (pass path; fetch once with curl:
 *       curl -s https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadCollection)
 *   - the live gate + medium-priority DBs (to compute already-covered codes)
 *
 * Usage: node scripts/census/emit-cso-pxstat-backfill.mjs <ReadCollection.json> [outPath]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const collPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/candidates/cso-pxstat-backfill.approved.json';
if (!collPath) { console.error('usage: emit-cso-pxstat-backfill.mjs <ReadCollection.json> [out]'); process.exit(1); }

const ATTRIBUTION = 'Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence.';

const coll = JSON.parse(readFileSync(collPath, 'utf8'));
const items = (coll.link && coll.link.item) || [];

// code -> { label, updated, year }
const catalogue = new Map();
for (const it of items) {
  const code = it.extension?.matrix || (Array.isArray(it.id) ? null : it.id);
  if (!code) continue;
  const label = (it.label || '').trim();
  // latest year from the time dimension (role.time), else from the label
  let year = null;
  const timeDims = (it.role && it.role.time) || [];
  const years = [];
  for (const d of timeDims) {
    const idx = it.dimension?.[d]?.category?.index || [];
    for (const p of idx) { const m = String(p).match(/(1[6789]\d\d|20[0-3]\d)/); if (m) years.push(Number(m[1])); }
  }
  if (years.length) year = String(Math.max(...years));
  else { const m = label.match(/(?<![0-9])(1[6789]\d\d|20[0-3]\d)(?![0-9])/); if (m) year = m[1]; }
  catalogue.set(code, { label, updated: it.updated || null, year });
}

// already-covered PxStat codes across the live databases
const covered = new Set();
const codeRe = /(?:data\.cso\.ie\/table\/|ReadDataset\/)([A-Z0-9]{3,10})(?:[\/"]|$)/g;
for (const p of ['data/database/approved-publication-sources.json', 'data/database/medium-priority-publication-sources.json']) {
  const j = JSON.parse(readFileSync(p, 'utf8'));
  for (const s of j.sources || []) {
    const str = JSON.stringify(s);
    let m; while ((m = codeRe.exec(str))) if (catalogue.has(m[1])) covered.add(m[1]);
  }
}

function slugify(v) {
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
}

const sources = [];
const slugSeen = new Set();
let n = 0;
for (const [code, meta] of catalogue) {
  if (covered.has(code)) continue;
  n += 1;
  const title = meta.label || code;
  let slug = slugify(`approved-publication-cso-pxstat-${code}-${title}`);
  if (slugSeen.has(slug)) { let i = 2; while (slugSeen.has(`${slug}-${i}`)) i++; slug = `${slug}-${i}`; }
  slugSeen.add(slug);
  sources.push({
    id: `approved-publication:cso-pxstat-${code.toLowerCase()}-${slugify(title)}`,
    slug,
    type: 'approved-table-source',
    title,
    subtitle: 'CSO / PxStat statistical cube / Browse/Tables plus Sources',
    category: 'Approved tables',
    date: meta.year || undefined,
    provider: ['CSO'],
    description: `CSO PxStat statistical cube (matrix ${code}). Published as a Books/Tables/Sources source-table record under CC BY 4.0. ${ATTRIBUTION}`,
    keywords: ['cso-pxstat', 'statistical-cube', 'CSO', 'CC-BY-4.0', 'publish', 'approved-publication', code],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approval-ready',
    license: 'CC BY 4.0',
    licence: 'CC BY 4.0',
    attribution: ATTRIBUTION,
    references: [
      { label: `CSO PxStat table ${code}`, url: `https://data.cso.ie/table/${code}`, note: 'CC BY 4.0' },
      { label: `JSON-stat cube (${code})`, url: `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/${code}/JSON-stat/2.0/en`, note: 'CC BY 4.0' },
    ],
    approval: {
      stagingId: `cso-pxstat-${code.toLowerCase()}`,
      recommendedAction: 'publish',
      batchId: 'cat1-cso-pxstat-full',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-cso-pxstat',
      sourceResolutionConfidence: 'high',
    },
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedFrom: 'CSO PxStat ReadCollection',
  tranche: 'cat1-cso-pxstat-full',
  counts: { pxstatTotal: catalogue.size, alreadyCovered: covered.size, emitted: sources.length },
  sources,
}, null, 2) + '\n');
console.log(`PxStat total ${catalogue.size} | already covered ${covered.size} | emitted ${sources.length} -> ${OUT}`);
