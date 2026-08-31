#!/usr/bin/env node
/**
 * Complete the CSO PxStat coverage in the approved-publication gate.
 *
 * WHY THIS EXISTS
 *
 * The gate already holds 15,735 CSO records covering 12,563 PxStat matrices, emitted in
 * earlier tranches (cat1-census-cso-ccby, cat1-census-cso-ccby-ni-carveout). Measured against
 * the live PxStat catalogue on 2026-08-31, 214 of the 12,528 published cubes had no gate
 * record -- they were never census cubes, so no earlier tranche reached them. This emits the
 * missing 214 so the corpus is covered end to end rather than nearly.
 *
 * (The gate covers 35 matrices the catalogue no longer lists. Those are retired cubes, not an
 * error: a record for something CSO has since withdrawn is stale, not wrong, and deleting
 * approval records would lose the provenance of what was approved when.)
 *
 * RIGHTS
 *
 * No new rights decision is made here. CSO PxStat is CC BY 4.0 across the collection, already
 * determined and recorded in this repo -- see census-emit-cso-carveout-records.mjs, which
 * states the rights "confirmed clear (CSO CC BY 4.0)". Each cube's own metadata carries
 * extension.copyright naming the CSO but no per-cube licence, so the basis is the collection
 * licence, which is why it applies uniformly to these 214 as to the 12,314 already gated.
 *
 * Records are emitted in the SAME shape as the existing CSO tranche so that nothing
 * downstream has to special-case them.
 *
 *   node scripts/cso-emit-pxstat-gap-records.mjs --catalogue <mirror>/_catalogue.json \
 *        --out cso-pxstat-gap-records.json
 *
 * Then merge into the live gate under its own counts bucket:
 *
 *   node scripts/merge-census-pilot.mjs cso-pxstat-gap-records.json csoPxstatCompletion \
 *        cat1-cso-pxstat-completion
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const CATALOGUE = argOf('--catalogue');
const OUT = argOf('--out', 'cso-pxstat-gap-records.json');
const SHARD_DIR = 'data/database/approved-publication-sources-shards';

if (!CATALOGUE) {
  console.error('FAIL: --catalogue <path to PxStat _catalogue.json> is required.');
  console.error('  The catalogue lives outside the repo (it is a 12,528-cube mirror), so the');
  console.error('  path is passed in rather than hardcoded -- no local path may reach a record.');
  process.exit(1);
}

const ATTRIBUTION = 'Contains Irish Public Sector Data licensed under a Creative Commons '
  + 'Attribution 4.0 International (CC BY 4.0) licence.';

// Which matrices the gate already covers. Read from the shards rather than a stored list, so
// this cannot drift from the gate it is meant to complete.
const covered = new Set();
for (const file of readdirSync(SHARD_DIR)) {
  const items = JSON.parse(readFileSync(`${SHARD_DIR}/${file}`, 'utf8')).items || [];
  for (const record of items) {
    if (!(record.provider || []).includes('CSO')) continue;
    for (const match of JSON.stringify(record).matchAll(/\/table\/([A-Z0-9]+)|ReadDataset\/([A-Z0-9]+)\//g)) {
      covered.add((match[1] || match[2]).toUpperCase());
    }
  }
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const items = catalogue.link?.item || [];
if (!items.length) {
  console.error('FAIL: the catalogue has no link.item array. Wrong file?');
  process.exit(1);
}

const slugify = (value) => String(value)
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);

const records = [];
const seen = new Set();

for (const item of items) {
  const matrix = String(item.extension?.matrix || '').toUpperCase();
  if (!matrix || covered.has(matrix) || seen.has(matrix)) continue;
  seen.add(matrix);

  const title = String(item.label || '').trim() || matrix;
  // Same convention as the existing tranche: a leading year in the title is the date, and
  // dateSource records that it was inferred rather than supplied as a field.
  const year = (title.match(/\b(1[89]\d{2}|20\d{2})\b/) || [])[1];
  const slug = `cso-cube-${matrix}-${slugify(title)}`.toLowerCase();

  const record = {
    id: `approved-publication:${slug}`,
    slug: `approved-publication-${slug}`,
    type: 'approved-table-source',
    title,
    subtitle: 'CSO / statistical-cube / Browse/Tables plus Sources',
    category: 'Approved tables',
    provider: ['CSO'],
    description: `CSO PxStat statistical cube (matrix ${matrix}). Published as a `
      + `Books/Tables/Sources source-table record under CC BY 4.0. ${ATTRIBUTION}`,
    keywords: ['statistical-cube', 'CSO', 'CC-BY-4.0', 'publish', 'approved-publication', matrix],
    proposedBrowsePath: 'Browse/Tables plus Sources',
    publicationStatus: 'approved-staged',
    license: 'CC BY 4.0',
    licence: 'CC BY 4.0',
    attribution: ATTRIBUTION,
    references: [
      { label: `CSO PxStat table ${matrix}`, url: `https://data.cso.ie/table/${matrix}`, note: 'CC BY 4.0' },
      {
        label: `JSON-stat cube (${matrix})`,
        url: `https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/${matrix}/JSON-stat/2.0/en`,
        note: 'CC BY 4.0',
      },
    ],
    approval: {
      stagingId: `cso-pxstat-${matrix.toLowerCase()}`,
      recommendedAction: 'publish',
      batchId: 'cat1-cso-pxstat-completion',
      reviewState: 'approval-ready',
      sourceResolutionStatus: 'resolved-cso-pxstat',
      sourceResolutionConfidence: 'high',
      defaultAction: 'publish-as-books-tables-sources-entry-after-approval',
      defaultConfidence: 'high',
    },
  };
  if (year) {
    record.date = year;
    record.dateSource = 'title';
  }
  records.push(record);
}

// No local-path check here on purpose. merge-census-pilot.mjs refuses any record carrying one
// and runs before anything reaches the gate, so a copy of that rule here would be a second
// place to keep the pattern correct -- and the pattern itself reads as a machine-specific path
// to check:local-paths, which is the rule it exists to enforce. One owner is better.
writeFileSync(OUT, `${JSON.stringify({ sources: records }, null, 2)}\n`);
console.log(`Wrote ${records.length} record(s) to ${OUT}.`);
console.log(`  gate already covered ${covered.size} matrices; catalogue lists ${items.length}.`);
const dated = records.filter((record) => record.date).length;
console.log(`  ${dated} carry a year inferred from the title, ${records.length - dated} do not.`);
