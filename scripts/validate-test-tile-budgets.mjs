#!/usr/bin/env node
/**
 * Validate generated /test tile outputs against operational budgets.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/tile-budget-report.json');
const WARN_TILE_BYTES = 1.5 * 1024 * 1024;
const FAIL_TILE_BYTES = 4 * 1024 * 1024;
const WARN_LAYER_BYTES = 50 * 1024 * 1024;
const FAIL_LAYER_BYTES = 500 * 1024 * 1024;

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const errors = [];
const warnings = [];
const layers = metadata.layers || [];

for (const layer of layers) {
  if (layer.loadable === false) continue;
  if (!isValidBounds(layer.bounds)) errors.push(`${layer.id}: invalid bounds`);
  if (['mvt', 'pmtiles'].includes(layer.sourceType) && layer.labelProperty && !layer.featureIndexUrl) {
    warnings.push(`${layer.id}: label layer has no feature-search index`);
  }
  if (layer.sourceType === 'pmtiles') {
    if (!layer.tileUrl) errors.push(`${layer.id}: missing PMTiles tileUrl`);
    const local = localPath(layer.tileUrl);
    if (local && !existsSync(resolve(ROOT, local))) errors.push(`${layer.id}: PMTiles archive missing: ${local}`);
  }
  const generated = layer.generatedFrom || {};
  if (Number(generated.maxTileBytes || 0) > WARN_TILE_BYTES) warnings.push(`${layer.id}: max tile ${formatBytes(generated.maxTileBytes)} exceeds warning budget`);
  if (Number(generated.maxTileBytes || 0) > FAIL_TILE_BYTES) errors.push(`${layer.id}: max tile ${formatBytes(generated.maxTileBytes)} exceeds fail budget`);
  if (Number(generated.bytes || 0) > WARN_LAYER_BYTES) warnings.push(`${layer.id}: generated tile directory ${formatBytes(generated.bytes)} is large`);
  if (Number(generated.bytes || 0) > FAIL_LAYER_BYTES) errors.push(`${layer.id}: generated tile directory ${formatBytes(generated.bytes)} exceeds fail budget`);
}

const invalidCountiesDir = resolve(ROOT, 'test/tiles/generated/roi-counties-2011');
if (existsSync(invalidCountiesDir)) {
  errors.push('test/tiles/generated/roi-counties-2011 must be removed or quarantined outside the active generated tile path');
}
const quarantinePath = resolve(ROOT, 'test/metadata/quarantine/roi-counties-2011.json');
if (!existsSync(quarantinePath)) {
  errors.push('test/metadata/quarantine/roi-counties-2011.json must exist while roi-counties-2011 remains excluded');
}
for (const layer of layers) {
  if (layer.id.includes('roi-counties-2011') || layer.sourceMapId === 'roi-counties-2011') {
    errors.push(`${layer.id}: quarantined roi-counties-2011 must not be active in maps-test.json`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  budgets: {
    warnTileBytes: WARN_TILE_BYTES,
    failTileBytes: FAIL_TILE_BYTES,
    warnLayerBytes: WARN_LAYER_BYTES,
    failLayerBytes: FAIL_LAYER_BYTES
  },
  totals: {
    layers: layers.length,
    loadableLayers: layers.filter((layer) => layer.loadable !== false).length,
    pmtilesLayers: layers.filter((layer) => layer.sourceType === 'pmtiles').length,
    warnings: warnings.length,
    errors: errors.length
  },
  warnings,
  errors
};

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log('Civgraph /test Tile Budget Check');
console.log(`- layers: ${report.totals.layers}`);
console.log(`- pmtiles: ${report.totals.pmtilesLayers}`);
console.log(`- warnings: ${warnings.length}`);
console.log(`- errors: ${errors.length}`);
if (warnings.length) {
  console.log('\nWarnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}
if (errors.length) {
  console.log('\nErrors:');
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}
console.log('\nPASS: /test generated tile outputs are within hard budgets.');

function isValidBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[south, west], [north, east]] = bounds;
  return [south, west, north, east].every(Number.isFinite)
    && south < north
    && west < east
    && south >= 49
    && north <= 57
    && west >= -12.5
    && east <= -4;
}

function localPath(value) {
  if (typeof value !== 'string' || /^https?:\/\//i.test(value)) return null;
  return value.replace(/^\//, '').replaceAll('\\', '/');
}

function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}
