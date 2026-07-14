#!/usr/bin/env node
/**
 * Harvest the full Open Data NI catalogue via its CKAN backend. The public
 * portal (www.opendatani.gov.uk) was rebuilt as a PortalJS/Apollo front end, but
 * the CKAN action API is live at admin.opendatani.gov.uk (a browser User-Agent is
 * required to clear the WAF). One record per dataset with slug, title, org,
 * licence, modified date and its resources (name/url/format — direct download
 * links). Output feeds emit-opendatani-catalogue-records.mjs.
 *
 * Usage: node scripts/census/harvest-opendatani-catalogue.mjs [outPath]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = process.argv[2] || 'data/census/candidates/opendatani-catalogue.json';
const BASE = 'https://admin.opendatani.gov.uk/api/3/action/package_search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const ROWS = 500;

function fetchPage(start) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const raw = execFileSync('curl', ['-s', '--max-time', '90', '-A', UA, `${BASE}?rows=${ROWS}&start=${start}`], { maxBuffer: 256 * 1024 * 1024 }).toString();
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
      orgSlug: r.organization?.name || null,
      license: r.license_title || r.license_id || null,
      licenseUrl: r.license_url || null,
      notes: (r.notes || '').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
      modified: r.metadata_modified || null,
      landing: r.url || null,
      resources: (r.resources || []).map((x) => ({
        name: (x.name || '').trim() || null,
        url: x.url || null,
        format: (x.format || '').trim() || null,
      })).filter((x) => x.url),
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
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'Open Data NI CKAN package_search (admin.opendatani.gov.uk)', count, datasets }, null, 0) + '\n');
console.log(`Wrote ${OUT}: ${datasets.length} datasets (catalogue count ${count})`);
