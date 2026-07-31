#!/usr/bin/env node
/**
 * Every layer the catalogue shows a user must actually be renderable.
 *
 * WHY. The map app resolves layers from test/metadata/maps-test-index.json and draws
 * vector tiles. The catalogue that decides what a user can click is
 * data/database/maps.json. Nothing connected the two, so a layer could sit in the
 * catalogue, look completely healthy in Browse, and draw nothing -- which is precisely
 * what happened all week:
 *
 *   - 19 ED/local-authority layers registered on 27 July were never tiled, so the
 *     renderer had nothing to draw. Reported as "the new maps don't appear".
 *   - A scoped promotion run deleted 15 working layers from the index on 31 July while
 *     their PMTiles sat untouched on R2. Reported as "Wards 1993 loads raster maps".
 *   - Newly built layers were left pointing at /test/pmtiles/generated/..., a path
 *     excluded from the Pages deploy, so their tileUrls 404'd.
 *
 * All three are the same missing invariant, and all three were diagnosed by hand over
 * hours. This check states the invariant once.
 *
 * WHAT COUNTS AS RESOLVABLE, and why it is not simply "id is in the index":
 *   direct   the layer id or sourceMapId appears in the index
 *   variant  a variant resolves -- group records such as eds-roi-1941 own no files of
 *            their own and compose four provinces by cloneOf, so the group is fine as
 *            long as its members resolve
 *   chunked  chunked layers load a <id>-chunks.json index rather than tiles
 *
 * STUBS ARE NOT FAILURES. 131 visible catalogue entries carry no files and no variants
 * at all -- placeholders for material not yet digitised. They cannot render and never
 * could; flagging them would bury the real failures. They are counted and reported
 * separately, because a growing stub count is worth seeing.
 *
 * Usage: node scripts/validate-layer-resolution.mjs [--json]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const CATALOGUE = resolve(ROOT, 'data/database/maps.json');
const INDEX = resolve(ROOT, 'test/metadata/maps-test-index.json');
const CDN_PREFIX = 'https://data.civgraph.net/';
const AS_JSON = process.argv.includes('--json');

for (const p of [CATALOGUE, INDEX]) {
  if (!existsSync(p)) {
    console.error(`FAIL: missing required file ${p}`);
    process.exit(1);
  }
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8')).maps || [];
const indexLayers = JSON.parse(readFileSync(INDEX, 'utf8')).layers || [];

const indexed = new Set();
for (const layer of indexLayers) {
  if (layer?.id) indexed.add(layer.id);
  if (layer?.sourceMapId) indexed.add(layer.sourceMapId);
}

const hasData = (m) => Boolean(Object.keys(m.files || {}).length || (m.variants || []).length);
const resolvesVia = (m) => {
  if (indexed.has(m.id)) return 'direct';
  for (const v of m.variants || []) {
    if (indexed.has(v.id) || indexed.has(v.cloneOf)) return 'variant';
  }
  if (m.chunked) return 'chunked';
  return null;
};

const visible = catalogue.filter((m) => !m.hidden);
const stubs = [];
const unresolved = [];
for (const m of visible) {
  if (!hasData(m)) { stubs.push(m.id); continue; }
  if (!resolvesVia(m)) unresolved.push({ id: m.id, category: m.category || '(none)' });
}

// A tiled layer pointing at a repo-relative path is unreachable in production: the
// generated tile directories are excluded from the Pages deploy and served from R2.
const badTileUrl = indexLayers
  .filter((l) => l.sourceType === 'pmtiles' && l.tileUrl && !String(l.tileUrl).startsWith(CDN_PREFIX))
  .map((l) => ({ id: l.id, tileUrl: String(l.tileUrl).slice(0, 80) }));

const failures = unresolved.length + badTileUrl.length;

if (AS_JSON) {
  console.log(JSON.stringify({ visible: visible.length, stubs: stubs.length, unresolved, badTileUrl }, null, 2));
} else {
  console.log(`Layer resolution: ${visible.length} visible catalogue layers, ${indexLayers.length} in the tile index.`);
  console.log(`  placeholders with no data (not renderable by design): ${stubs.length}`);
  if (unresolved.length) {
    const byCat = unresolved.reduce((acc, u) => { acc[u.category] = (acc[u.category] || 0) + 1; return acc; }, {});
    console.error(`\nFAIL: ${unresolved.length} visible layer(s) have data but resolve to nothing renderable.`);
    console.error(`  by category: ${JSON.stringify(byCat)}`);
    for (const u of unresolved.slice(0, 25)) console.error(`    ${u.id}`);
    if (unresolved.length > 25) console.error(`    ... and ${unresolved.length - 25} more`);
    console.error(`  Convert them (npm run build:test:batch-vectors / :pmtiles / :promote) or hide them.`);
  }
  if (badTileUrl.length) {
    console.error(`\nFAIL: ${badTileUrl.length} tiled layer(s) have a non-CDN tileUrl and will 404 in production.`);
    for (const b of badTileUrl.slice(0, 15)) console.error(`    ${b.id}  ->  ${b.tileUrl}`);
    console.error(`  Run: node scripts/write-test-cdn-upload-manifest.mjs && node scripts/verify-test-pmtiles-cdn.mjs && node scripts/switch-test-pmtiles-to-cdn.mjs`);
  }
  if (!failures) console.log('\nPASS: every visible catalogue layer with data resolves, and every tiled layer serves from the CDN.');
}

process.exit(failures ? 1 : 0);
