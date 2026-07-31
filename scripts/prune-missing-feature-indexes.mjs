#!/usr/bin/env node
/**
 * Drop featureIndexUrl entries that point at files which do not exist.
 *
 * Promotion used to advertise a feature index for every layer with a labelProperty, but
 * build-test-feature-indexes.mjs skips any layer with no local source file or no usable
 * label property. The result was 638 layers promising an index the app would fetch and
 * 404 on. promote-test-converted-layers.mjs now only advertises an index that is on disk,
 * so this is a repair for metadata written before that change -- and a safety net,
 * because several generators read-modify-write maps-test.json and a long-running one can
 * restore stale fields from a copy it loaded minutes earlier. That is exactly how these
 * came back once already: the PMTiles build held the pre-repair file in memory and wrote
 * it out again on completion.
 *
 * Idempotent. Safe to run after any metadata step.
 *
 * Usage: node scripts/prune-missing-feature-indexes.mjs [--check]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeArtefactJson } from './lib/safe-artefact-write.mjs';

const ROOT = resolve(process.cwd());
// BOTH files, because they are fetched by different things. maps-test.json is the
// build-side metadata the validator reads; maps-test-index.json is what the running app
// fetches, so a stale entry left there is the one that actually 404s in a browser.
// Pruning only the first left counties-ireland-vector-test advertising a missing index to
// every visitor while the check reported success.
const METADATA_PATHS = ['test/metadata/maps-test.json', 'test/metadata/maps-test-index.json'];
const CHECK_ONLY = process.argv.includes('--check');

let total = 0;

for (const rel of METADATA_PATHS) {
  const path = resolve(ROOT, rel);
  if (!existsSync(path)) {
    console.error(`skipping ${rel}: not present`);
    continue;
  }
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  const stale = [];

  const layers = (metadata.layers || []).map((layer) => {
    const url = layer.featureIndexUrl;
    if (typeof url !== 'string' || /^https?:\/\//.test(url)) return layer;
    if (existsSync(resolve(ROOT, url.replace(/^\//, '')))) return layer;
    stale.push(layer.id);
    const { featureIndexUrl, ...rest } = layer;
    return rest;
  });

  console.log(`${rel}: ${stale.length} featureIndexUrl entr(ies) pointing at missing files`);
  for (const id of stale.slice(0, 10)) console.log(`   ${id}`);
  if (stale.length > 10) console.log(`   ... and ${stale.length - 10} more`);

  total += stale.length;
  if (stale.length && !CHECK_ONLY) {
    writeArtefactJson(path, { ...metadata, layers }, {
      collection: 'layers', idKey: 'id', label: rel
    });
    console.log(`   wrote ${rel}`);
  }
}

if (CHECK_ONLY) {
  console.log(`\n--check: nothing written (${total} would be pruned)`);
  process.exit(total ? 1 : 0);
}
console.log(`\n${total ? `Pruned ${total}.` : 'Nothing to prune.'}`);
