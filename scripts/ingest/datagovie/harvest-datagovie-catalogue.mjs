#!/usr/bin/env node
/**
 * Harvest the data.gov.ie catalogue (CKAN package_search at 1,000 rows a page, at least 2 s apart,
 * no User-Agent of ours) into the `{ datasets: [...] }` file that
 * emit-datagovie-catalogue-records.mjs reads. The paging, the politeness and the stops (a 403, a
 * 429 or a bot challenge stops the run and writes nothing) are packages/intake/src/ckan-harvest.mjs.
 *
 * Usage: node scripts/ingest/datagovie/harvest-datagovie-catalogue.mjs <out.json> [--raw <pages.json>]
 *        node scripts/ingest/datagovie/harvest-datagovie-catalogue.mjs <out.json> --replay <pages.json>
 */
import { runCli } from '../../../packages/intake/src/ckan-harvest.mjs';

await runCli({
  origin: 'https://data.gov.ie',
  generatedFrom: 'data.gov.ie CKAN catalogue (package_search)',
  // The records carry CKAN's licence URL, and neither the description nor the download links.
  fields: { notesMax: 0, resources: false, licenseUrl: true },
}, process.argv.slice(2));
