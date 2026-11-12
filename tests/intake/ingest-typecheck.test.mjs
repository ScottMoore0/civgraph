// The strict intake type check (scripts/intake/tsconfig.json, npm run check:types:intake) covers
// the ingest plugins and every ingest script typed so far (rf9-ingest, 12 Nov 2026). The include
// list only grows: a script named here may not leave it. No file under scripts/ingest,
// scripts/intake or packages/intake carries a type-check suppression.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const config = JSON.parse(readFileSync(path.join('scripts', 'intake', 'tsconfig.json'), 'utf8'));

// Paths relative to scripts/intake, as the tsconfig names them.
const TYPED = [
  '../ingest/*/plugin.mjs',
  '../ingest/persons/rebuild-person-ids.mjs',
  '../ingest/census/build-census-cleaning-model.mjs',
  '../ingest/census/build-census-source-inventory.mjs',
  '../ingest/census/build-cso-failed-link-report.mjs',
  '../ingest/census/build-cso-historical-reports-ia-manifest.mjs',
  '../ingest/census/census-emit-cso-carveout-records.mjs',
  '../ingest/census/census-emit-gate-records.mjs',
  '../ingest/census/crawl-nisra-publication-files.mjs',
  '../ingest/census/crawl-nisra-publications.mjs',
  '../ingest/census/cso-emit-pxstat-gap-records.mjs',
  '../ingest/census/emit-nisra-publication-records.mjs',
  '../ingest/census/emit-opendatani-catalogue-records.mjs',
  '../ingest/census/merge-census-pilot.mjs',
  '../ingest/census/mirror-nisra-files-to-ia.mjs',
  '../ingest/census/mirror-opendatani-to-ia.mjs',
  '../ingest/census/probe-nisra-throttle.mjs',
  '../ingest/census/scrape-cso-historical-reports.mjs',
  '../ingest/datagovie/emit-datagovie-catalogue-records.mjs',
  '../ingest/datagovie/harvest-datagovie-licences.mjs',
  '../ingest/dobih/build-dobih-assets.mjs',
  '../ingest/geoportal/build-peatland-geoportal-sources.mjs',
  '../ingest/hills/build-irish-hill-domain-metadata.mjs',
  '../ingest/idb-phelim/build-idb-20260525-lods.mjs',
  '../ingest/idb-phelim/parse-phelim-ed-notes.mjs',
  '../ingest/internet-archive/build-agency-ia-mirror.mjs',
  '../ingest/ni-assembly-opendata/harvest-niassembly-opendata.mjs',
  '../ingest/oireachtas/harvest-oireachtas-opendata.mjs',
  '../ingest/proni/proni-browse-async-fetch.mjs',
  '../ingest/proni/proni-direct-endpoint-probe.mjs',
];

test('check:types:intake is strict and covers the typed ingest scripts', () => {
  const o = config.compilerOptions;
  for (const flag of ['strict', 'checkJs', 'noImplicitReturns', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes']) {
    assert.equal(o[flag], true, `${flag} is off`);
  }
  assert.notEqual(o.noImplicitAny, false, 'noImplicitAny is off');
  const missing = TYPED.filter((p) => !config.include.includes(p));
  assert.deepEqual(missing, [], 'a typed ingest script left scripts/intake/tsconfig.json');
});

test('no type-check suppressions in the intake and ingest folders', () => {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m|c)?js$/.test(e.name) && /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(p, 'utf8'))) found.push(p);
    }
  };
  for (const dir of ['scripts/ingest', 'scripts/intake', 'packages/intake']) walk(dir);
  assert.deepEqual(found, []);
});
