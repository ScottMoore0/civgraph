#!/usr/bin/env node
/**
 * Emit approved Books/Tables/Sources catalogue records for the data.gov.ie
 * (Open Data Portal Ireland) datasets not already on Civgraph. Each is a
 * catalogue-reference record linking to the live data.gov.ie dataset page,
 * carrying the dataset's organisation and CKAN-reported licence. Data is served
 * from data.gov.ie; Civgraph provides discovery/search.
 *
 * Usage: node scripts/census/emit-datagovie-catalogue-records.mjs <harvest.json> [outPath]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveApprovedPublicationSources } from '../lib/approved-publication-index.mjs';

const harvestPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/candidates/datagovie-catalogue.approved.json';
if (!harvestPath) { console.error('usage: emit-datagovie-catalogue-records.mjs <harvest.json> [out]'); process.exit(1); }

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
const year = (iso) => { const m = String(iso || '').match(/^(\d{4})/); return m ? m[1] : undefined; };

const { datasets } = JSON.parse(readFileSync(harvestPath, 'utf8'));

// Organisations whose output is already comprehensively catalogued elsewhere on
// Civgraph, so their data.gov.ie re-listings are skipped to avoid double-
// cataloguing the same underlying datasets. CSO statistical products are covered
// by the dedicated PxStat tranches (cat1-census-cso-ccby + cat1-cso-pxstat-full).
const EXCLUDE_ORGS = new Set(['Central Statistics Office']);

// already-covered data.gov.ie dataset slugs across the live databases
const covered = new Set();
const re = /data\.gov\.ie\/(?:dataset|datasets)\/([a-z0-9][a-z0-9-]{2,})/gi;
for (const p of ['data/database/approved-publication-sources.json', 'data/database/medium-priority-publication-sources.json']) {
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  const list = p.includes('approved-publication') ? resolveApprovedPublicationSources(doc) : (doc.sources || []);
  for (const s of list) { let m; const str = JSON.stringify(s); while ((m = re.exec(str))) covered.add(m[1].toLowerCase()); }
}

const sources = [];
const idSeen = new Set();
for (const d of datasets) {
  const slug = d.slug;
  if (!slug || covered.has(slug.toLowerCase())) continue;
  if (d.org && EXCLUDE_ORGS.has(d.org)) continue;
  const id = `approved-publication:opendata-ie-${slugify(slug)}`;
  if (idSeen.has(id)) continue;
  idSeen.add(id);
  const org = d.org || 'data.gov.ie';
  const url = `https://data.gov.ie/dataset/${slug}`;
  const lic = d.license || null;
  sources.push({
    id,
    slug: slugify(`approved-publication-opendata-ie-${slug}`),
    type: 'approved-source-reference-source',
    title: d.title || slug,
    subtitle: `${org} / data.gov.ie / Browse/Tables plus Sources`,
    category: 'Approved open data (data.gov.ie)',
    date: year(d.modified),
    provider: [org],
    description: `Open data dataset published on data.gov.ie (Open Data Portal Ireland) by ${org}${lic ? `, licensed ${lic}` : ''}. Catalogue reference record; the data is served from data.gov.ie.`,
    keywords: ['opendata-ie', 'data.gov.ie', slugify(org), 'catalogue', 'approved-publication'],
    url,
    license: lic || undefined,
    licence: lic || undefined,
    licenseUrl: d.licenseUrl || undefined,
    references: [{ label: `data.gov.ie dataset: ${d.title || slug}`, url, note: lic || undefined }],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approval-ready',
    approval: {
      stagingId: `opendata-ie-${slugify(slug)}`.slice(0, 120),
      recommendedAction: 'publish',
      batchId: 'cat1-opendata-ie-portal',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-ckan-dataset',
      sourceResolutionConfidence: 'high',
    },
  });
}

// organisation breakdown (the "curated by organisation" view)
const byOrg = {};
for (const s of sources) { const o = s.provider[0]; byOrg[o] = (byOrg[o] || 0) + 1; }
const topOrgs = Object.entries(byOrg).sort((a, b) => b[1] - a[1]).slice(0, 15);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedFrom: 'data.gov.ie CKAN catalogue',
  tranche: 'cat1-opendata-ie-portal',
  counts: { catalogueTotal: datasets.length, alreadyCovered: covered.size, emitted: sources.length, organisations: Object.keys(byOrg).length },
  sources,
}, null, 2) + '\n');
console.log(`catalogue ${datasets.length} | covered ${covered.size} | emitted ${sources.length} | orgs ${Object.keys(byOrg).length}`);
console.log('top organisations:', JSON.stringify(topOrgs));
