#!/usr/bin/env node
/**
 * The render tiles must be newer than the source they were built from.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-16 a contributor's corrected geometry was applied by replacing the
 * PUBLISHED DOWNLOAD -- data/maps/.../ROI_Local_Authorities_1915.fgb -- and
 * nothing else. That file was verified sha256-identical to what he submitted,
 * three times, and he was told three times that the fix was live. It was not.
 *
 * The map does not render from the download. Per the README: "MapLibre GL
 * rendering PMTiles vector tiles; FlatGeobuf is a download format, not a render
 * path." The tiles are built by build-test-pmtiles.mjs from a THIRD copy of the
 * geometry in test/source-cache/vector-intake/, and that copy was untouched --
 * dated 29 May, still holding the pre-correction boundary. So the download was
 * right, the catalogue was right, the cache tokens were right, and the map drew
 * the old boundary for a day and a half.
 *
 * Measured at the time, Antrim/Londonderry vertex counts in the served archive:
 *
 *   before   66087 / 31749
 *   after    66768 / 32473     (the contributor's delta was +719 / +732)
 *
 * WHAT THIS CHECKS, AND WHY IT IS THE WEAK VERSION
 *
 * That every layer's built PMTiles archive is at least as new as the source-cache
 * file it is built from. That catches "source updated, tiles not rebuilt", which
 * is exactly what happened.
 *
 * It does NOT catch "published download updated, source cache not updated", which
 * is the step BEFORE the one that failed here -- the source cache is gitignored
 * and the download lives in R2, so there is no offline way to compare them. That
 * gap is real and is recorded rather than papered over: whoever applies a
 * geometry correction must update the source cache, not just the download, and
 * `npm run verify:tiles` is the network check that would notice.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';

const METADATA = 'test/metadata/maps-test.json';
const TILE_DIR = 'test/pmtiles/generated';

const doc = JSON.parse(readFileSync(METADATA, 'utf8'));
const layers = (doc.layers || []).filter((l) => l.sourceType === 'pmtiles' && l.sourceFile);

const stale = [];
let checked = 0;
let skipped = 0;

for (const layer of layers) {
  const source = layer.sourceFile;
  const archive = `${TILE_DIR}/${layer.id}.pmtiles`;

  // The source cache is gitignored, so on a clean checkout most of these are
  // absent. Skipping is correct -- there is nothing to compare -- but it means a
  // green result here says less on CI than it does locally, which is worth
  // knowing before trusting it.
  if (!existsSync(source) || !existsSync(archive)) { skipped += 1; continue; }

  checked += 1;
  const sourceTime = statSync(source).mtimeMs;
  const archiveTime = statSync(archive).mtimeMs;
  if (archiveTime < sourceTime) {
    stale.push(`${layer.id}: source is newer than the archive `
      + `(source ${new Date(sourceTime).toISOString().slice(0, 10)}, `
      + `tiles ${new Date(archiveTime).toISOString().slice(0, 10)})`);
  }
}

if (stale.length) {
  console.error(`FAIL: ${stale.length} layer(s) have tiles older than their source:`);
  for (const s of stale) console.error(`  - ${s}`);
  console.error('');
  console.error('  The map renders from the PMTiles, not from the source and not from the');
  console.error('  published download. A source updated without a rebuild means the map');
  console.error('  keeps drawing the old geometry while every other check passes.');
  console.error('  Rebuild: node scripts/build-test-pmtiles.mjs --force --ids <id>');
  console.error('  Then upload: node scripts/upload-test-pmtiles-r2.mjs --ids <id>');
  process.exit(1);
}

console.log(`PASS: ${checked} layer(s) have tiles at least as new as their source `
  + `(${skipped} skipped: source cache or archive not present locally).`);
