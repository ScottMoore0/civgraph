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
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const CHECK_ONLY = process.argv.includes('--check');

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const stale = [];

const layers = (metadata.layers || []).map((layer) => {
  const url = layer.featureIndexUrl;
  if (typeof url !== 'string' || /^https?:\/\//.test(url)) return layer;
  if (existsSync(resolve(ROOT, url.replace(/^\//, '')))) return layer;
  stale.push(layer.id);
  const { featureIndexUrl, ...rest } = layer;
  return rest;
});

console.log(`featureIndexUrl entries pointing at missing files: ${stale.length}`);
for (const id of stale.slice(0, 10)) console.log(`   ${id}`);
if (stale.length > 10) console.log(`   ... and ${stale.length - 10} more`);

if (CHECK_ONLY) {
  console.log('\n--check: nothing written');
  process.exit(stale.length ? 1 : 0);
}

if (stale.length) {
  writeArtefactJson(METADATA_PATH, { ...metadata, layers }, {
    collection: 'layers',
    idKey: 'id',
    label: 'test/metadata/maps-test.json'
  });
  console.log(`\nPruned ${stale.length}; wrote ${METADATA_PATH}`);
} else {
  console.log('\nNothing to prune.');
}
