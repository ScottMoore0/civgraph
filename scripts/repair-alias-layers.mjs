#!/usr/bin/env node
/**
 * An alias layer must describe the same tiles as the layer it aliases.
 *
 * WHY ALIASES EXIST. Where a boundary set did not change between two years, the later year
 * does not get its own PMTiles archive -- it points at the earlier year's. eds-roi-1953's
 * Munster variant serves eds-munster-1950's tiles because Munster's divisions were
 * unchanged. That is deliberate deduplication, not an error, and 149 layers rely on it.
 *
 * WHAT DRIFTED. Nine of those 149 were left with status 'converted' instead of
 * 'converted-alias', and with a '?v=civfid1' cache-bust appended to their tileUrl that
 * their targets do not carry. Nine tileUrls out of 963 carry that query string and they
 * are exactly these nine, so they are leftovers from a hand-edit during the civ_fid
 * conversion rather than anything a script emits -- no script in the repo contains the
 * string. The other 140 aliases are correct.
 *
 * The effect is mild but real: an alias and its target request the same archive under two
 * different URLs, so a viewer who loads both fetches the file twice and caches it twice.
 *
 * The invariant is simply that an alias carries its target's tile description. That is
 * what validate-test-app.mjs checks and what this restores, by copying from the target
 * rather than by pattern-matching the defect, so any future drift in these fields is
 * repaired too.
 *
 * Idempotent. Safe to run after any metadata step.
 *
 * Usage: node scripts/repair-alias-layers.mjs [--check]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeArtefactJson } from './lib/safe-artefact-write.mjs';

const ROOT = resolve(process.cwd());
const FILES = ['render/metadata/maps-test.json', 'render/metadata/maps-test-index.json'];
const CHECK_ONLY = process.argv.includes('--check');

// Copied from the target, because an alias is a pointer to it. status and
// conversionStatus are set to the alias constants instead: an alias is not itself a
// conversion, and validate-test-app.mjs distinguishes the two.
const FROM_TARGET = ['tileUrl', 'tiles', 'sourceLayer', 'sourceType'];

let totalChanged = 0;

for (const rel of FILES) {
  const path = resolve(ROOT, rel);
  if (!existsSync(path)) {
    console.error(`skipping ${rel}: not present`);
    continue;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const layers = doc.layers || [];
  const byId = new Map(layers.map((l) => [l.id, l]));

  const changed = [];
  const orphans = [];

  for (const layer of layers) {
    if (!layer.aliasOf && !layer.cloneOf && layer.conversionStatus !== 'convertedAlias') continue;
    const target = byId.get(layer.aliasTargetLayerId);
    if (!target) { orphans.push(layer.id); continue; }

    const before = JSON.stringify(layer);
    for (const key of FROM_TARGET) {
      if (target[key] === undefined) delete layer[key];
      else layer[key] = target[key];
    }
    layer.status = 'converted-alias';
    layer.conversionStatus = 'convertedAlias';
    if (JSON.stringify(layer) !== before) changed.push(layer.id);
  }

  console.log(`${rel}: ${changed.length} alias layer(s) out of sync with their target`);
  for (const id of changed.slice(0, 12)) console.log(`   ${id}`);
  if (changed.length > 12) console.log(`   ... and ${changed.length - 12} more`);
  if (orphans.length) {
    console.error(`   ${orphans.length} alias(es) name a target that is not in this file: ${orphans.slice(0, 5).join(', ')}`);
  }

  totalChanged += changed.length;
  if (changed.length && !CHECK_ONLY) {
    writeArtefactJson(path, doc, { collection: 'layers', idKey: 'id', label: rel });
    console.log(`   wrote ${rel}`);
  }
}

if (CHECK_ONLY) {
  console.log(`\n--check: nothing written (${totalChanged} would change)`);
  process.exit(totalChanged ? 1 : 0);
}
console.log(`\n${totalChanged ? `Repaired ${totalChanged} alias record(s).` : 'Nothing to repair.'}`);
