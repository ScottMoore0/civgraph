#!/usr/bin/env node
/**
 * Emit approved Books/Tables/Sources catalogue records for Open Data NI datasets
 * not already on Civgraph. Each links to the live www.opendatani.gov.uk dataset
 * page and carries the dataset's direct resource download links (served from
 * Open Data NI / departmental hosts). Catalogue-reference records; Civgraph
 * provides discovery/search, the data is served from Open Data NI.
 *
 * Dedup: skips any dataset already referenced (by its opendatani slug) anywhere
 * in the live gate, so re-running never double-catalogues. Nothing is uploaded to
 * Internet Archive or R2 by this step.
 *
 * Usage: node scripts/census/emit-opendatani-catalogue-records.mjs <harvest.json> [outPath]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveApprovedPublicationSources } from '../lib/approved-publication-index.mjs';

const harvestPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/candidates/opendatani-catalogue.approved.json';
if (!harvestPath) { console.error('usage: emit-opendatani-catalogue-records.mjs <harvest.json> [out]'); process.exit(1); }

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
const year = (iso) => { const m = String(iso || '').match(/^(\d{4})/); return m ? m[1] : undefined; };
const MAX_DL = 30;

const { datasets } = JSON.parse(readFileSync(harvestPath, 'utf8'));

// already-covered Open Data NI dataset slugs across the live databases (so a
// re-run, or a dataset already catalogued elsewhere, is never duplicated)
const covered = new Set();
const re = /opendatani\.gov\.uk\/(?:dataset|@[a-z0-9-]+)\/([a-z0-9][a-z0-9-]{2,})/gi;
for (const p of ['data/database/approved-publication-sources.json', 'data/database/medium-priority-publication-sources.json']) {
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
  const list = p.includes('approved-publication') ? resolveApprovedPublicationSources(doc) : (doc.sources || []);
  for (const s of list) { let m; const str = JSON.stringify(s); while ((m = re.exec(str))) covered.add(m[1].toLowerCase()); }
}

const OGL = 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
const sources = [];
const idSeen = new Set();
for (const d of datasets) {
  const slug = d.slug;
  if (!slug || covered.has(slug.toLowerCase())) continue;
  const id = `approved-publication:opendata-ni-${slugify(slug)}`;
  if (idSeen.has(id)) continue;
  idSeen.add(id);
  const org = d.org || 'Open Data NI';
  const url = `https://www.opendatani.gov.uk/dataset/${slug}`;
  const lic = d.license || null;
  const licUrl = d.licenseUrl || (lic && /open government/i.test(lic) ? OGL : undefined);
  const downloads = (d.resources || []).slice(0, MAX_DL).map((r) => ({
    label: r.name || r.url.split('/').pop() || 'resource',
    url: r.url,
    type: (r.format || '').toLowerCase() || undefined,
    source: 'Open Data NI',
  }));
  sources.push({
    id,
    slug: slugify(`approved-publication-opendata-ni-${slug}`),
    type: 'approved-source-reference-source',
    title: d.title || slug,
    subtitle: `${org} / Open Data NI / Browse/Tables plus Sources`,
    category: 'Approved open data (Open Data NI)',
    date: year(d.modified),
    provider: [org],
    description: `Open data dataset published on Open Data NI (opendatani.gov.uk) by ${org}${lic ? `, licensed ${lic}` : ''}. Catalogue reference record; the data is served from Open Data NI.${d.notes ? ` ${d.notes}` : ''}`.slice(0, 900),
    keywords: ['opendata-ni', 'opendatani.gov.uk', 'northern-ireland', slugify(org), 'catalogue', 'approved-publication'],
    url,
    license: lic || undefined,
    licence: lic || undefined,
    licenseUrl: licUrl,
    downloads: downloads.length ? downloads : undefined,
    references: [{ label: `Open Data NI dataset: ${d.title || slug}`, url, note: lic || undefined }],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approval-ready',
    approval: {
      stagingId: `opendata-ni-${slugify(slug)}`.slice(0, 120),
      recommendedAction: 'publish',
      batchId: 'cat1-opendata-ni-portal',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-ckan-dataset',
      sourceResolutionConfidence: 'high',
    },
  });
}

const byOrg = {};
for (const s of sources) { const o = s.provider[0]; byOrg[o] = (byOrg[o] || 0) + 1; }
const topOrgs = Object.entries(byOrg).sort((a, b) => b[1] - a[1]).slice(0, 15);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedFrom: 'Open Data NI CKAN catalogue (admin.opendatani.gov.uk)',
  tranche: 'cat1-opendata-ni-portal',
  counts: { catalogueTotal: datasets.length, alreadyCovered: covered.size, emitted: sources.length, organisations: Object.keys(byOrg).length },
  sources,
}, null, 2) + '\n');
console.log(`catalogue ${datasets.length} | covered ${covered.size} | emitted ${sources.length} | orgs ${Object.keys(byOrg).length}`);
console.log('top organisations:', JSON.stringify(topOrgs));
