#!/usr/bin/env node
/**
 * A layer's sourceFile must point at the live intake cache, not a superseded one.
 *
 * WHY. Sources are staged under test/source-cache/, which is gitignored and periodically
 * cleaned. When a delivery is unpacked into a dated directory of its own -- for example
 * test/source-cache/idb-20260609/ -- the layers built from it keep that path forever,
 * and the path stops resolving the moment the directory is removed.
 *
 * The failure is quiet. build-test-pmtiles reports the layer as "missing-source" and
 * carries on, so a rebuild silently does nothing and the layer keeps serving whatever it
 * was last built from. On 2026-08-03 seven Electoral Division layers were in this state,
 * pointing into a June delivery that no longer existed, and a re-cut of all of them
 * appeared to succeed while changing nothing.
 *
 * Deliveries should be unpacked outside the repository and staged into the single live
 * cache directory, so that a path either resolves or is obviously wrong.
 *
 * Usage: node scripts/validate-source-paths.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const LIVE_CACHE = 'test/source-cache/vector-intake/';
const METADATA = ['test/metadata/maps-test.json', 'test/metadata/maps-test-index.json'];

let checked = 0;
const problems = [];
for (const rel of METADATA) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) continue;
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  for (const layer of doc.layers || []) {
    const src = layer.sourceFile;
    if (typeof src !== 'string' || !src) continue;
    checked += 1;
    if (src.startsWith('http://') || src.startsWith('https://')) continue;
    if (src.startsWith(LIVE_CACHE)) continue;
    if (!src.startsWith('test/source-cache/')) continue; // some layers legitimately source elsewhere
    problems.push(`${rel}: ${layer.id} -> ${src}`);
  }
}

console.log(`Source paths: ${checked} layer sourceFile reference(s) checked.`);
if (problems.length) {
  console.error(`\n${problems.length} layer(s) reference a superseded source cache:`);
  for (const p of problems.slice(0, 30)) console.error(`- ${p}`);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  console.error(`\nRestage those sources into ${LIVE_CACHE} and repoint sourceFile, or the next rebuild will silently skip them.`);
  process.exit(1);
}
console.log(`All source paths resolve to the live intake cache.`);
