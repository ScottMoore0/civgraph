#!/usr/bin/env node
/**
 * Build lightweight /test2 metadata for startup and lazy detail/duplicate-id
 * sidecars from the existing /test MapLibre metadata.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';
// The index entry and the duplicate-id sidecar are built by the same code the /_api/layers
// Function uses (data design phase 3), with the file URLs this committed copy has always had.
import { FILE_URLS, duplicateSidecar, indexDocument, indexEntry, layerFileName } from '../functions/_lib/layer-index.js';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'render', 'metadata', 'maps-test.json');
const INDEX_OUTPUT = path.join(ROOT, 'render', 'metadata', 'maps-test-index.json');
const DETAIL_DIR = path.join(ROOT, 'render', 'metadata', 'layer-details-test2');
const DUPLICATE_DIR = path.join(ROOT, 'render', 'metadata', 'duplicate-feature-ids');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJsonIfChanged(file, value) {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  mkdirSync(path.dirname(file), { recursive: true });
  writeStableGeneratedJson(file, value);
  const after = existsSync(file) ? readFileSync(file, 'utf8') : null;
  return before !== after;
}

function localPathForUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return null;
  const clean = String(url).split('?')[0].replace(/^\/+/, '');
  return path.join(ROOT, clean);
}

function duplicateIdsForFeatureIndex(layer) {
  const file = localPathForUrl(layer.featureIndexUrl);
  if (!file || !existsSync(file)) return null;
  return duplicateSidecar(layer, readJson(file));
}

function removeStaleJsonFiles(dir, expectedNames) {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (expectedNames.has(entry.name)) continue;
    unlinkSync(path.join(dir, entry.name));
    removed += 1;
  }
  return removed;
}

function build() {
  const raw = readJson(INPUT);
  mkdirSync(DETAIL_DIR, { recursive: true });
  mkdirSync(DUPLICATE_DIR, { recursive: true });

  let detailsWritten = 0;
  let duplicateSidecarsWritten = 0;
  const expectedDetailFiles = new Set();
  const expectedDuplicateFiles = new Set();
  const layers = (raw.layers || []).map((layer) => {
    const fileName = layerFileName(layer.id);
    expectedDetailFiles.add(fileName);
    if (writeJsonIfChanged(path.join(DETAIL_DIR, fileName), layer)) {
      detailsWritten += 1;
    }
    const sidecar = duplicateIdsForFeatureIndex(layer);
    if (sidecar) {
      expectedDuplicateFiles.add(fileName);
      if (writeJsonIfChanged(path.join(DUPLICATE_DIR, fileName), sidecar)) {
        duplicateSidecarsWritten += 1;
      }
    }
    return indexEntry(layer, sidecar, FILE_URLS);
  });

  const index = indexDocument(raw, layers);
  writeJsonIfChanged(INDEX_OUTPUT, index);
  const staleDetailsRemoved = removeStaleJsonFiles(DETAIL_DIR, expectedDetailFiles);
  const staleDuplicateSidecarsRemoved = removeStaleJsonFiles(DUPLICATE_DIR, expectedDuplicateFiles);

  console.log(`Test2 metadata index: ${layers.length} compact layers`);
  console.log(`Test2 layer details: ${detailsWritten} changed, ${staleDetailsRemoved} stale removed`);
  console.log(`Test2 duplicate-id sidecars: ${duplicateSidecarsWritten} changed, ${staleDuplicateSidecarsRemoved} stale removed`);
}

build();
