#!/usr/bin/env node
/**
 * Validate /test CDN manifest, PMTiles URL state, and quarantine records.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const QUARANTINE_PATH = resolve(ROOT, 'test/metadata/quarantine/roi-counties-2011.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-manifest-validation-report.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-range-report.json');
const MAP_CONTROLLER_PATH = resolve(ROOT, 'test/src/map-controller.js');

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;
const rangeReport = existsSync(RANGE_REPORT_PATH) ? JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8')) : null;
const errors = [];
const warnings = [];
const notes = [];
const resolvedCountiesLayer = (metadata.layers || []).find((layer) => isResolvedRoiCountiesLayer(layer));

if (!manifest) {
  errors.push('test/metadata/cdn-upload-manifest.json is missing; run npm run build:test:cdn-manifest');
} else {
  const pmtilesLayers = (metadata.layers || []).filter((layer) => layer.sourceType === 'pmtiles');
  const assets = (manifest.assets || []).filter((asset) => asset.kind === 'pmtiles');
  const assetByLayer = new Map(assets.map((asset) => [asset.layerId, asset]));
  const assetByLocal = new Map(assets.map((asset) => [normalize(asset.localPath), asset]));
  const verifiedByLayer = new Map((rangeReport?.results || []).map((item) => [item.layerId, item]));
  const localOnlyFallbacks = [];

  for (const layer of pmtilesLayers) {
    const asset = assetByLayer.get(layer.id);
    if (!asset) {
      errors.push(`${layer.id}: PMTiles layer missing from CDN manifest`);
      continue;
    }
    if (!asset.targetKey?.startsWith('data/maps/test/')) errors.push(`${layer.id}: R2 key must live under data/maps/test/`);
    if (!asset.targetKey?.endsWith('.pmtiles')) errors.push(`${layer.id}: R2 key must end in .pmtiles`);
    if (!asset.cdnUrl?.startsWith('https://data.civgraph.net/data/maps/test/')) errors.push(`${layer.id}: CDN URL must use data.civgraph.net/data/maps/test/`);
    if (!asset.localPath?.startsWith('test/pmtiles/generated/')) errors.push(`${layer.id}: local PMTiles path must live under test/pmtiles/generated/`);
    if (!asset.bytes || asset.bytes <= 0) errors.push(`${layer.id}: CDN manifest asset must record non-zero bytes`);
    if (layer.tileUrl?.startsWith('/test/pmtiles/')) warnings.push(`${layer.id}: still points at repo-local PMTiles URL`);
    if (layer.tileUrl?.startsWith('https://') && layer.tileUrl !== asset.cdnUrl) errors.push(`${layer.id}: tileUrl does not match manifest CDN URL`);
    if (layer.tileUrl?.startsWith('https://') && layer.tilesFallback?.startsWith('/test/tiles/')) {
      localOnlyFallbacks.push(layer.id);
    }
    if (!layer.tilePackage?.byteRangeVerifiedAt) errors.push(`${layer.id}: missing tilePackage.byteRangeVerifiedAt`);
    const verified = verifiedByLayer.get(layer.id);
    if (!verified?.ok) errors.push(`${layer.id}: missing successful CDN range verification report row`);
  }

  if (!rangeReport) {
    errors.push('test/metadata/cdn-range-report.json is missing; run npm run verify:test:pmtiles-cdn');
  } else {
    const verifiedActiveLayers = pmtilesLayers.filter((layer) => verifiedByLayer.get(layer.id)?.ok).length;
    if (verifiedActiveLayers !== pmtilesLayers.length) {
      errors.push(`CDN range report verified ${verifiedActiveLayers}/${pmtilesLayers.length} active PMTiles layers`);
    }
    if (Date.parse(rangeReport.generatedAt) < Date.parse(manifest.generatedAt)) {
      warnings.push('CDN range report is older than CDN upload manifest; rerun npm run verify:test:pmtiles-cdn after manifest changes');
    }
  }

  const localArchives = listLocalPmtiles();
  for (const localPath of localArchives) {
    if (!assetByLocal.has(normalize(localPath))) errors.push(`${localPath}: local PMTiles archive is not represented in CDN manifest`);
  }
  if (localOnlyFallbacks.length) {
    if (runtimeDisablesLocalFallbacks()) {
      notes.push(`${localOnlyFallbacks.length} PMTiles layer(s) retain local directory fallbacks for development only; production fallback is disabled by runtime guard.`);
    } else {
      errors.push(`${localOnlyFallbacks.length} production PMTiles layer(s) retain local-only directory fallbacks without a runtime production guard`);
    }
  }
}

if (!resolvedCountiesLayer && !existsSync(QUARANTINE_PATH)) {
  errors.push('test/metadata/quarantine/roi-counties-2011.json is missing');
} else if (!resolvedCountiesLayer) {
  const quarantine = JSON.parse(readFileSync(QUARANTINE_PATH, 'utf8'));
  if (quarantine.sourceMapId !== 'roi-counties-2011') errors.push('roi-counties-2011 quarantine record has wrong sourceMapId');
  if (!/invalid|bounds|not promoted/i.test(`${quarantine.reason} ${quarantine.action}`)) {
    warnings.push('roi-counties-2011 quarantine record should explain invalid bounds and non-promotion');
  }
} else {
  notes.push('roi-counties-2011 quarantine has been superseded by the resolved PMTiles/CDN layer built from the valid FlatGeobuf source.');
}

for (const layer of metadata.layers || []) {
  if (!resolvedCountiesLayer && (layer.sourceMapId === 'roi-counties-2011' || layer.id.includes('roi-counties-2011'))) {
    errors.push(`${layer.id}: quarantined roi-counties-2011 must not be present in active /test metadata`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  totals: { warnings: warnings.length, errors: errors.length, notes: notes.length },
  notes,
  warnings,
  errors
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log('Civgraph /test CDN Manifest Validation');
console.log(`- warnings: ${warnings.length}`);
console.log(`- errors: ${errors.length}`);
if (notes.length) {
  console.log('\nNotes:');
  for (const note of notes) console.log(`- ${note}`);
}
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

function isResolvedRoiCountiesLayer(layer) {
  return (layer.id === 'roi-counties-2011-vector-test' || layer.sourceMapId === 'roi-counties-2011')
    && layer.sourceType === 'pmtiles'
    && /^https:\/\/data\.civgraph\.net\/data\/maps\/test\/pmtiles\/generated\/roi-counties-2011-vector-test\.pmtiles$/i.test(layer.tileUrl || '')
    && /data\/maps\/baronies-parishes\/ROI_Counties_2011\.fgb$/i.test(String(layer.sourceFile || '').replaceAll('\\', '/'))
    && isValidBounds(layer.bounds, layer);
}

function isValidBounds(bounds, layer = null) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[south, west], [north, east]] = bounds;
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) return false;
  const nearNullIsland = Math.max(Math.abs(south), Math.abs(west), Math.abs(north), Math.abs(east)) < 1;
  if (nearNullIsland) return false;
  if (layer?.sourceMapId === 'britain-ireland-seas') {
    return south >= 45
      && north <= 63
      && west >= -18
      && east <= 14
      && south < 57
      && north > 49
      && west < -4
      && east > -12;
  }
  return south >= 49
    && north <= 57
    && west >= -12.5
    && east <= -4;
}

function runtimeDisablesLocalFallbacks() {
  if (!existsSync(MAP_CONTROLLER_PATH)) return false;
  const source = readFileSync(MAP_CONTROLLER_PATH, 'utf8');
  return /function\s+localTestTilesAvailable/.test(source)
    && /fallbackUnavailable/.test(source)
    && /Directory MVT fallback is not deployed on production Pages/.test(source);
}
