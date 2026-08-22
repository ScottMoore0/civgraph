#!/usr/bin/env node
/**
 * Every published archive must record the exact source bytes it was built from.
 *
 * WHY THIS AND NOT THE FRESHNESS CHECK
 *
 * validate-tile-source-freshness.mjs compares modification times. It fails when a
 * source is newer than its archive and CANNOT fail when the archive is newer and wrong
 * -- and the second case is the one that happened. niah-buildings sat published at
 * 19 MB while its source yielded 204 MB, carrying ten attribute columns against the
 * source's twelve, and passed that check on every run, because an archive pulled from
 * R2 gets a fresh mtime for free. An mtime records a filesystem operation. It says
 * nothing about content.
 *
 * WHY NOT A SCHEMA COMPARISON. One was built first, and deleted on 2026-08-22 after
 * this replaced it. The record is kept here because the reasoning is the valuable part
 * and the code was not.
 *
 * It read attribute names back out of the built tiles and compared them against the
 * source. That cannot work, and not for want of care: MVT omits a field from any feature
 * whose value is null, so a tile's key dictionary is a LOWER BOUND on the schema, and
 * GDAL's writer drops a column that is null across everything it writes. A sparse column
 * and a dropped one are therefore indistinguishable in principle.
 *
 * Three generations of it reported 22, then 8, then 7 stale layers; each fall was a
 * defect in its own probe rather than a change in the corpus, and of the final 7 at
 * least five were artefacts. Seven archives were rebuilt and republished on the strength
 * of findings that did not survive checking. Two of them still reported stale after
 * being rebuilt from the exact source on disk minutes earlier, which is what finally
 * settled it.
 *
 * A content hash has none of that. It is exact or it is silent.
 *
 * COST: 3.3 seconds for the whole 2.9 GB source corpus, measured at 876 MB/s. No cache,
 * no mtime pre-filter, no cleverness -- those would reintroduce the assumption this
 * exists to remove.
 *
 * WHAT IT DOES NOT COVER, stated because the gap is the interesting one: whether the
 * SOURCE is itself current. In August the source cache held the stale copy and the
 * archive was built from it faithfully. Source and archive agreed; this check would
 * have passed while the map drew the wrong boundary. That hop is verify:source-cache.
 *
 * Offline. Skips layers whose source is absent, which on a clean checkout is most of
 * them -- the source cache is gitignored, so a green result here means much less on CI
 * than it does locally. Worth knowing before trusting it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const METADATA = 'render/metadata/maps-test.json';
const doc = JSON.parse(readFileSync(METADATA, 'utf8'));

const mismatched = [];
const unrecorded = [];
let checked = 0;
let skipped = 0;

for (const layer of doc.layers || []) {
  if (layer.sourceType !== 'pmtiles' || !layer.sourceFile) continue;
  if (!existsSync(layer.sourceFile)) { skipped += 1; continue; }
  const recorded = layer.tilePackage?.sourceSha256;
  if (!recorded) { unrecorded.push(layer.id); continue; }
  checked += 1;
  const actual = createHash('sha256').update(readFileSync(layer.sourceFile)).digest('hex');
  if (actual !== recorded) {
    mismatched.push(`${layer.id}: source has changed since the archive was built\n`
      + `      recorded ${recorded.slice(0, 16)}…\n`
      + `      actual   ${actual.slice(0, 16)}…`);
  }
}

if (mismatched.length) {
  console.error(`FAIL: ${mismatched.length} archive(s) were not built from the source now on disk:`);
  for (const m of mismatched) console.error(`  - ${m}`);
  console.error('');
  console.error('  The map renders from the archive. A source edited without a rebuild means');
  console.error('  the map keeps drawing the old geometry while every other check passes.');
  console.error('  Rebuild: node scripts/build-test-pmtiles.mjs --force --ids <id>');
  console.error('  Then upload: node scripts/upload-test-pmtiles-r2.mjs --ids <id>');
  process.exit(1);
}

// A RATCHET ON THE UNRECORDED COUNT.
//
// 520 layers were built before sourceSha256 existed and carry no record of their input.
// They cannot be backfilled: writing today's source hash against an archive built at an
// unknown time would assert exactly the thing that is not known, and would do it
// silently for every layer at once.
//
// So coverage grows the only honest way -- a layer becomes covered when it is next
// rebuilt -- and this stops it going backwards in the meantime. A new layer that ships
// without a hash, or a rebuild that stops recording one, pushes the count up and fails
// here. The number may fall freely; it may never rise.
const BASELINE = 'data/database/tile-content-hash-baseline.json';
const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { unrecorded: unrecorded.length };

if (process.argv.includes('--update-baseline')) {
  writeFileSync(BASELINE, `${JSON.stringify({ unrecorded: unrecorded.length }, null, 2)}
`);
  console.log(`Re-pinned baseline: ${unrecorded.length} layer(s) without a recorded source hash.`);
  process.exit(0);
}

if (unrecorded.length > baseline.unrecorded) {
  console.error(`FAIL: layers without a recorded source hash grew ${baseline.unrecorded} -> ${unrecorded.length}.`);
  console.error(`  e.g. ${unrecorded.slice(0, 5).join(', ')}`);
  console.error('');
  console.error('  A layer becomes covered when it is rebuilt. Growth means either a new layer');
  console.error('  shipped without one, or the build stopped recording it -- and the second');
  console.error('  would silently uncover the whole corpus over time.');
  console.error('  If the growth is genuinely intended: --update-baseline');
  process.exit(1);
}

console.log(`PASS: ${checked} archive(s) match the source they record `
  + `(${skipped} skipped: source not present locally; ${unrecorded.length} of a permitted `
  + `${baseline.unrecorded} predate the hash).`);
