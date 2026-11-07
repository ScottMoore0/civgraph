#!/usr/bin/env node
/**
 * No tiled polygon/line layer may ship without a promoteId.
 *
 * WHY THIS MATTERS
 *
 * A polygon or line clipped across a tile boundary arrives as several features. Without
 * a promoteId MapLibre treats each fragment as its own feature, so hover highlights one
 * piece of a county, selection returns a fragment, and any per-feature statistic is
 * computed over a fragment rather than the feature. Points cannot split, so they are
 * exempt -- which is the whole distinction this validator draws.
 *
 * build-test-pmtiles.mjs injects `civ_fid` (the source FID) into every polygon/line
 * archive precisely so a promoteId is always available, and
 * promote-test-converted-layers.mjs ranks it last so a natural key wins. Three layers
 * still slipped through with no promoteId at all, and nothing reported it:
 *
 *   bedrock-geology-11000000-ireland-roini-itm
 *   community-scale-coastal-flood-extents-high-end-future-scenario
 *   community-scale-coastal-flood-extents-mid-range-future-scenario
 *
 * Verified 2026-08-23 by reading the published archives over HTTP: all three DO carry
 * civ_fid, in the tile metadata and in the tiles. So the archives were correct and only
 * the metadata record was wrong -- no rebuild, a metadata fix.
 *
 * MEASURED SCOPE, because the raw number is misleading: 116 vector layers had no
 * promoteId, and 113 of them are points. Counting points made a 3-layer defect look like
 * a 116-layer one.
 *
 * A promoteId must also be POPULATED. ded-1930-04-01 and ded-1939-04-01 named OBJECTID, which is
 * null on every one of their features, so MapLibre had no id at all to join tile pieces on
 * (fixed 2026-11-01: civ_fid). For every layer whose source FlatGeobuf is on this machine, the
 * validator reads the first SAMPLE features and fails when the promoteId property is missing or
 * empty on any of them. civ_fid is exempt: build-test-pmtiles injects it as the row number, so
 * it is never in the source file. Layers without a local source are counted, not checked.
 *
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/check/rules/vector-promote-id.mjs [--sample N] [--report-only]
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const RENDER = 'render/metadata/maps-test.json';
const SPLITTABLE = new Set(['polygon', 'multipolygon', 'line', 'linestring', 'multilinestring']);

const render = JSON.parse(readFileSync(RENDER, 'utf8'));

const offenders = [];
let checked = 0;
for (const layer of render.layers || []) {
  if (layer.sourceType !== 'pmtiles' && layer.sourceType !== 'mvt') continue;
  if (!SPLITTABLE.has(String(layer.geometryType || '').toLowerCase())) continue;
  checked += 1;
  if (!layer.promoteId) offenders.push(layer.id);
}

// Populated: the promoteId names a property every sampled source feature carries.
const argAt = process.argv.indexOf('--sample');
const SAMPLE = argAt >= 0 ? Number(process.argv[argAt + 1]) || 500 : 500;
const REPORT_ONLY = process.argv.includes('--report-only');
// Layers flagged when this check was added (2026-11-01) and left for a later batch: reported as
// warnings, so the check fails only on a NEW layer with an unpopulated promoteId. Remove an id here
// once its layer is switched to a populated key.
const KNOWN_UNPOPULATED = new Set([
  'admin-areas-1930-04-01-vector',
  'counties-county-boroughs-1915-vector',
  'dcc-journey-times-across-dublin-city-from-dublin-city-council-traffic-departments-trips-system-vector',
  'dcc-noise-maps-from-traffic-sources-in-dublin-city-council-vector',
  'deds-ni-1926-vector',
  'eds-munster-1911-vector',
  'lgd-1972-vector',
  'nuts-3-vector',
  'pc-1885-ireland-vector',
  'pc-1920-vector',
  'settlements-2015-craigavon-vector',
  'sligo-townlands-vector',
  'stormont-1920-v2-vector',
  'tii-national-road-network-vector',
  'county-ed-1911-vector',
]);
const unpopulated = [];
const knownUnpopulated = [];
let sampled = 0;
let noLocalSource = 0;
for (const layer of render.layers || []) {
  if (layer.sourceType !== 'pmtiles' && layer.sourceType !== 'mvt') continue;
  if (!SPLITTABLE.has(String(layer.geometryType || '').toLowerCase())) continue;
  if (!layer.promoteId || layer.promoteId === 'civ_fid') continue;
  if (!layer.sourceFile || !/\.fgb$/i.test(layer.sourceFile) || !existsSync(layer.sourceFile)) { noLocalSource += 1; continue; }
  sampled += 1;
  let seen = 0;
  let empty = 0;
  try {
    const stream = Readable.toWeb(createReadStream(layer.sourceFile));
    for await (const feature of deserialize(stream)) {
      const value = feature.properties?.[layer.promoteId];
      if (value === null || value === undefined || value === '') empty += 1;
      seen += 1;
      if (seen >= SAMPLE) break;
    }
  } catch (error) {
    unpopulated.push(`${layer.id}: could not read ${layer.sourceFile} (${error.message})`);
    continue;
  }
  if (seen && empty) (KNOWN_UNPOPULATED.has(layer.id) ? knownUnpopulated : unpopulated).push(`${layer.id}: promoteId ${layer.promoteId} is empty on ${empty} of the first ${seen} source features`);
}
if (knownUnpopulated.length) {
  console.warn(`WARN: ${knownUnpopulated.length} known layer(s) still have a promoteId their source features do not carry (KNOWN_UNPOPULATED):`);
  for (const line of knownUnpopulated) console.warn(`  - ${line}`);
}
if (unpopulated.length) {
  console.error(`${REPORT_ONLY ? 'REPORT' : 'FAIL'}: ${unpopulated.length} tiled polygon/line layer(s) have a promoteId their features do not carry.`);
  for (const line of unpopulated) console.error(`  - ${line}`);
  console.error('');
  console.error('  Switch them to a populated unique key (civ_fid, which the archives carry) and rebuild');
  console.error('  their feature indexes (build-test-feature-indexes.mjs --ids <id> with featureIndexIdFromFid).');
  if (!REPORT_ONLY) process.exit(1);
}

if (offenders.length) {
  console.error(`FAIL: ${offenders.length} tiled polygon/line layer(s) have no promoteId.`);
  for (const id of offenders.slice(0, 20)) console.error(`  - ${id}`);
  if (offenders.length > 20) console.error(`  ... and ${offenders.length - 20} more`);
  console.error('');
  console.error('  Features that cross a tile boundary will split into fragments: per-fragment');
  console.error('  hover, selection and statistics.');
  console.error('');
  console.error('  build-test-pmtiles.mjs injects civ_fid into every polygon/line archive, so the');
  console.error('  usual fix is promoteId: "civ_fid". CONFIRM the archive actually declares it');
  console.error('  before setting that -- a promoteId naming a field the tiles do not carry is');
  console.error('  no better than none, and it hides the problem instead of reporting it.');
  process.exit(1);
}

console.log(`PASS: all ${checked} tiled polygon/line layer(s) carry a promoteId; ${sampled} checked as populated against their local source (${noLocalSource} have no local source).`);
