#!/usr/bin/env node
/**
 * Emit approved Books/Tables/Sources catalogue records for NISRA non-census
 * statistical publications enumerated from nisra.gov.uk/publications. Each links
 * to the live NISRA publication page (which carries the downloadable data
 * files). Census publications are excluded (covered by the census tranches).
 * Crown Copyright / Open Government Licence v3.0.
 *
 * IA-mirroring of the underlying data files is a separate, heavier job; these
 * records point at NISRA's own hosting so the publications are discoverable and
 * accessible via Civgraph now.
 *
 * Usage: node scripts/census/emit-nisra-publication-records.mjs <crawl.json> [outPath]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const inPath = process.argv[2];
const OUT = process.argv[3] || 'data/census/candidates/nisra-publications.approved.json';
if (!inPath) { console.error('usage: emit-nisra-publication-records.mjs <crawl.json> [out]'); process.exit(1); }

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
const isCensus = (slug) => /^census[-0-9]|-census-|census-20\d\d/.test(slug);
const parseYear = (s) => { const ys = String(s).match(/(19\d\d|20[0-3]\d)/g); return ys ? String(Math.max(...ys.map(Number))) : undefined; };

const ATTRIBUTION = 'Contains public sector information licensed under the Open Government Licence v3.0.';
const { publications } = JSON.parse(readFileSync(inPath, 'utf8'));

const sources = [];
const idSeen = new Set();
for (const p of publications) {
  if (!p.slug || isCensus(p.slug)) continue;
  const id = `approved-publication:nisra-pub-${slugify(p.slug)}`;
  if (idSeen.has(id)) continue;
  idSeen.add(id);
  const url = `https://www.nisra.gov.uk/publications/${p.slug}`;
  sources.push({
    id,
    slug: slugify(`approved-publication-nisra-pub-${p.slug}`),
    type: 'approved-source-reference-source',
    title: p.title || p.slug,
    subtitle: 'NISRA / statistics publication / Browse/Tables plus Sources',
    category: 'Approved statistics (NISRA)',
    date: parseYear(`${p.title} ${p.slug}`),
    provider: ['NISRA'],
    description: `Northern Ireland Statistics and Research Agency (NISRA) statistical publication. Catalogue reference record; the data files are served from nisra.gov.uk under the Open Government Licence v3.0. ${ATTRIBUTION}`,
    keywords: ['nisra', 'statistics', 'northern-ireland', 'catalogue', 'approved-publication'],
    url,
    license: 'Open Government Licence v3.0',
    licence: 'Open Government Licence v3.0',
    licenseUrl: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
    attribution: ATTRIBUTION,
    references: [{ label: `NISRA publication: ${p.title || p.slug}`, url, note: 'Open Government Licence v3.0' }],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approval-ready',
    approval: {
      stagingId: `nisra-pub-${slugify(p.slug)}`.slice(0, 120),
      recommendedAction: 'publish',
      batchId: 'cat1-nisra-publications',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-nisra-publication',
      sourceResolutionConfidence: 'high',
    },
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedFrom: 'nisra.gov.uk/publications (non-census)',
  tranche: 'cat1-nisra-publications',
  counts: { crawled: publications.length, emitted: sources.length },
  sources,
}, null, 2) + '\n');
console.log(`crawled ${publications.length} | emitted ${sources.length} non-census NISRA publication records`);
