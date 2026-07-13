#!/usr/bin/env node
/**
 * Harvest the full data.gov.ie (Open Data Portal Ireland) CKAN catalogue into a
 * compact inventory: one record per dataset with slug, title, organisation,
 * licence and resource count. Paginates package_search via curl (which honours
 * the environment proxy). Output feeds emit-datagovie-catalogue-records.mjs.
 *
 * Usage: node scripts/census/harvest-datagovie-catalogue.mjs <outPath>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] || 'data/census/candidates/datagovie-catalogue.json';
const BASE = 'https://data.gov.ie/api/3/action/package_search';
const ROWS = 1000;

function fetchPage(start) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = execFileSync('curl', ['-s', '--max-time', '60', `${BASE}?rows=${ROWS}&start=${start}`], { maxBuffer: 256 * 1024 * 1024 }).toString();
      const j = JSON.parse(raw);
      if (!j.success) throw new Error('CKAN success=false');
      return j.result;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
}

const first = fetchPage(0);
const count = first.count;
const datasets = [];
function absorb(results) {
  for (const r of results) {
    datasets.push({
      slug: r.name,
      title: (r.title || r.name || '').trim(),
      org: r.organization?.title || null,
      license: r.license_title || r.license_id || null,
      licenseUrl: r.license_url || null,
      modified: r.metadata_modified || null,
      resources: r.num_resources || 0,
    });
  }
}
absorb(first.results);
for (let start = ROWS; start < count; start += ROWS) {
  absorb(fetchPage(start).results);
  process.stderr.write(`\rharvested ${datasets.length}/${count}`);
}
process.stderr.write('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'data.gov.ie CKAN package_search', count, datasets }, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${datasets.length} datasets (catalogue count ${count})`);
