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
 * Offline, so it belongs to `check:` rather than `verify:`.
 *
 *   node scripts/validate-vector-promote-id.mjs
 */
import { readFileSync } from 'node:fs';

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

console.log(`PASS: all ${checked} tiled polygon/line layer(s) carry a promoteId.`);
