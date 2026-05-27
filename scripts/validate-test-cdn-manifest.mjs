#!/usr/bin/env node
/**
 * Validate /test CDN manifest, PMTiles URL state, and quarantine records.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const QUARANTINE_PATH = resolve(ROOT, 'test/metadata/quarantine/roi-counties-2011.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-manifest-validation-report.json');

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;
const errors = [];
const warnings = [];

if (!manifest) {
  errors.push('test/metadata/cdn-upload-manifest.json is missing; run npm run build:test:cdn-manifest');
} else {
  const pmtilesLayers = (metadata.layers || []).filter((layer) => layer.sourceType === 'pmtiles');
  const assets = (manifest.assets || []).filter((asset) => asset.kind === 'pmtiles');
  const assetByLayer = new Map(assets.map((asset) => [asset.layerId, asset]));
  const assetByLocal = new Map(assets.map((asset) => [normalize(asset.localPath), asset]));

  for (const layer of pmtilesLayers) {
    const asset = assetByLayer.get(layer.id);
    if (!asset) {
      errors.push(`${layer.id}: PMTiles layer missing from CDN manifest`);
      continue;
    }
    if (!asset.targetKey?.startsWith('data/maps/test/')) errors.push(`${layer.id}: R2 key must live under data/maps/test/`);
    if (!asset.cdnUrl?.startsWith('https://data.civgraph.net/data/maps/test/')) errors.push(`${layer.id}: CDN URL must use data.civgraph.net/data/maps/test/`);
    if (layer.tileUrl?.startsWith('/test/pmtiles/')) warnings.push(`${layer.id}: still points at repo-local PMTiles URL`);
    if (layer.tileUrl?.startsWith('https://') && layer.tileUrl !== asset.cdnUrl) errors.push(`${layer.id}: tileUrl does not match manifest CDN URL`);
  }

  const localArchives = listLocalPmtiles();
  for (const localPath of localArchives) {
    if (!assetByLocal.has(normalize(localPath))) errors.push(`${localPath}: local PMTiles archive is not represented in CDN manifest`);
  }
}

if (!existsSync(QUARANTINE_PATH)) {
  errors.push('test/metadata/quarantine/roi-counties-2011.json is missing');
} else {
  const quarantine = JSON.parse(readFileSync(QUARANTINE_PATH, 'utf8'));
  if (quarantine.sourceMapId !== 'roi-counties-2011') errors.push('roi-counties-2011 quarantine record has wrong sourceMapId');
  if (!/invalid|bounds|not promoted/i.test(`${quarantine.reason} ${quarantine.action}`)) {
    warnings.push('roi-counties-2011 quarantine record should explain invalid bounds and non-promotion');
  }
}

for (const layer of metadata.layers || []) {
  if (layer.sourceMapId === 'roi-counties-2011' || layer.id.includes('roi-counties-2011')) {
    errors.push(`${layer.id}: quarantined roi-counties-2011 must not be present in active /test metadata`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totals: { warnings: warnings.length, errors: errors.length },
  warnings,
  errors
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log('Civgraph /test CDN Manifest Validation');
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
console.log('\nPASS: /test CDN manifest and quarantine records are valid.');

function listLocalPmtiles() {
  const dir = resolve(ROOT, 'test/pmtiles/generated');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.pmtiles'))
    .map((name) => `test/pmtiles/generated/${name}`)
    .filter((path) => statSync(resolve(ROOT, path)).isFile());
}

function normalize(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}
