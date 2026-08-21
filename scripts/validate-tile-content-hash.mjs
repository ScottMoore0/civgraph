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
 * WHY NOT THE SCHEMA AUDIT, which was built first and demoted. Reading attribute names
 * back out of the tiles cannot separate a stale archive from a column that is null
 * everywhere, because MVT omits nulls per feature. It reported 22, then 8, then 7 stale
 * layers across three attempts and most were its own artefacts; seven archives were
 * rebuilt and republished on the strength of findings that did not survive checking.
 * A content hash has no such failure mode. It is exact or it is silent.
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
import { existsSync, readFileSync } from 'node:fs';

const METADATA = 'test/metadata/maps-test.json';
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

console.log(`PASS: ${checked} archive(s) match the source they record `
  + `(${skipped} skipped: source not present locally; ${unrecorded.length} predate the hash).`);
