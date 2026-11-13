#!/usr/bin/env node
/**
 * Harvest the Open Data NI catalogue (www.opendatani.gov.uk, CKAN package_search at 1,000 rows a
 * page, at least 2 s apart, no User-Agent of ours) into the `{ datasets: [...] }` file that
 * emit-opendatani-catalogue-records.mjs reads. The paging, the politeness and the stops (a 403, a
 * 429 or a bot challenge stops the run and writes nothing) are packages/intake/src/ckan-harvest.mjs.
 *
 * Usage: node scripts/ingest/census/harvest-opendatani-catalogue.mjs <out.json> [--raw <pages.json>]
 *        node scripts/ingest/census/harvest-opendatani-catalogue.mjs <out.json> --replay <pages.json>
 */
import { runCli } from '../../../packages/intake/src/ckan-harvest.mjs';

await runCli({
  origin: 'https://www.opendatani.gov.uk',
  generatedFrom: 'Open Data NI CKAN catalogue (package_search)',
  // The records carry the description and the download links; their licence URL is the
  // emitter's own (the OGL page for an Open Government Licence).
  fields: { notes: true, resources: true, licenseUrl: false },
}, process.argv.slice(2));
