#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
// Deterministic stamp: this builder calls cleanOldRuntimeGeoJson() before
// regenerating, so there is no prior file to read a previous generatedAt from.
// A wall-clock stamp would make all ~850 MB of output differ on every run.
import { buildTimestamp } from './lib/build-timestamp.mjs';

const ROOT = process.cwd();
const SOURCE_DIR = join(ROOT, 'data', 'timeline-transitions');
const OUT_DIR = join(ROOT, 'data', 'timeline-transition-overlays');
const SOURCE_MANIFEST = join(SOURCE_DIR, 'manifest.json');
const OUT_MANIFEST = join(OUT_DIR, 'manifest.json');
const FALLBACK_TRANSITIONS = [
  'wards-1972__wards-1984',
  'wards-1984__wards-1993',
  'wards-1993__wards-2012',
  'wards-2012__wards-2022-final-recommendations'
];
const VISIBLE_TYPES = new Set(['split', 'territory-split', 'transfer']);
const MAX_SHARD_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_STRING_BYTES = 512 * 1024 * 1024;
const NUMERIC_PRECISION = 6;

function toPosix(path) {
  return path.replaceAll('\\', '/');
}

function rel(path) {
  return toPosix(relative(ROOT, path));
}

function readSourceManifest() {
  if (!existsSync(SOURCE_MANIFEST)) {
    return {
      version: 0,
      generatedAt: buildTimestamp(),
      transitions: FALLBACK_TRANSITIONS.map((id) => ({ id, path: `data/timeline-transitions/${id}.geojson` })),
      skipped: [],
      failed: []
    };
  }
  return JSON.parse(readFileSync(SOURCE_MANIFEST, 'utf8'));
}

function transitionType(feature) {
  return String(feature?.properties?.transitionType || feature?.properties?.changeType || '').trim();
}

function visibleTransitionFeature(feature) {
  return VISIBLE_TYPES.has(transitionType(feature));
}

function roundNumber(value, precision = NUMERIC_PRECISION) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const factor = 10 ** precision;
  return Math.round(number * factor) / factor;
}

function compactProperties(properties = {}) {
  const compact = {};
  const keys = [
    'transitionId',
    'transitionType',
    'transitionReason',
    'fromMapId',
    'toMapId',
    'fromMapName',
    'toMapName',
    'fromFeatureId',
    'toFeatureId',
    'fromFeatureName',
    'toFeatureName',
    'name',
    'area_m2',
    'area_km2',
    'fromFeatureAreaM2',
    'toFeatureAreaM2',
    'fromFeatureSharePct',
    'toFeatureSharePct'
  ];
  for (const key of keys) {
    if (properties[key] === undefined || properties[key] === null || properties[key] === '') continue;
    compact[key] = typeof properties[key] === 'number' ? roundNumber(properties[key]) : properties[key];
  }
  if (!compact.transitionType) compact.transitionType = properties.changeType || 'transfer';
  if (!compact.transitionId) {
    const fromId = compact.fromFeatureId || compact.fromFeatureName || 'from';
    const toId = compact.toFeatureId || compact.toFeatureName || 'to';
    compact.transitionId = `${compact.fromMapId || 'from'}__${compact.toMapId || 'to'}__${fromId}__${toId}__${compact.area_m2 || 0}`;
  }
  return compact;
}

function compactFeature(feature) {
  return {
    type: 'Feature',
    geometry: feature.geometry || null,
    properties: compactProperties(feature.properties || {})
  };
}

function writeCollection(path, name, metadata, featureJsons) {
  const json = `{"type":"FeatureCollection","name":${JSON.stringify(name)},"metadata":${JSON.stringify(metadata)},"features":[${featureJsons.join(',')}]}`;
  writeFileSync(path, json, 'utf8');
  return Buffer.byteLength(json);
}

function cleanOldRuntimeGeoJson() {
  if (!existsSync(OUT_DIR)) return;
  for (const file of readdirSync(OUT_DIR)) {
    if (file.endsWith('.geojson')) unlinkSync(join(OUT_DIR, file));
  }
}

function writeRuntimeOverlay(entry, source, sourcePath, outBasePath) {
  const sourceFeatures = Array.isArray(source.features) ? source.features : [];
  const name = source.name || `Territorial transition: ${entry.id}`;
  const baseMetadata = {
    ...(source.metadata || {}),
    runtimeOverlay: true,
    runtimeCompacted: true,
    sourceSidecar: rel(sourcePath),
    omittedTransitionTypes: ['unchanged', 'retained'],
    omittedVerboseProperties: ['fromProperties', 'toProperties'],
    sourceFeatureCount: sourceFeatures.length,
    reason: 'Browser runtime overlay contains only visible red/purple transition parts and compact properties. Large overlays are split into browser-safe shard files.'
  };
  const shardPaths = [];
  const shardBytes = [];
  const tempPaths = [];
  let current = [];
  let currentBytes = 0;
  let runtimeFeatures = 0;
  let totalBytes = 0;
  let shardIndex = 0;
  const flush = () => {
    if (!current.length) return;
    shardIndex += 1;
    const tempPath = `${outBasePath}.part-${String(shardIndex).padStart(3, '0')}.geojson`;
    const metadata = {
      ...baseMetadata,
      shardIndex,
      runtimeFeatureCount: current.length
    };
    const bytes = writeCollection(tempPath, name, metadata, current);
    shardPaths.push(tempPath);
    tempPaths.push(tempPath);
    shardBytes.push(bytes);
    totalBytes += bytes;
    current = [];
    currentBytes = 0;
  };

  for (const feature of sourceFeatures) {
    if (!visibleTransitionFeature(feature)) continue;
    const compact = compactFeature(feature);
    const featureJson = JSON.stringify(compact);
    const featureBytes = Buffer.byteLength(featureJson) + (current.length ? 1 : 0);
    if (current.length && currentBytes + featureBytes > MAX_SHARD_BYTES) flush();
    current.push(featureJson);
    currentBytes += featureBytes;
    runtimeFeatures += 1;
  }
  flush();

  if (!shardPaths.length) {
    const metadata = { ...baseMetadata, shardIndex: 1, runtimeFeatureCount: 0 };
    const bytes = writeCollection(outBasePath, name, metadata, []);
    return {
      runtimePath: rel(outBasePath),
      runtimePaths: [rel(outBasePath)],
      runtimeFeatures: 0,
      runtimeBytes: bytes,
      runtimeShardCount: 1,
      runtimeShardBytes: [bytes],
      sourceFeatures: sourceFeatures.length
    };
  }

  if (shardPaths.length === 1) {
    renameSync(shardPaths[0], outBasePath);
    return {
      runtimePath: rel(outBasePath),
      runtimePaths: [rel(outBasePath)],
      runtimeFeatures,
      runtimeBytes: statSync(outBasePath).size,
      runtimeShardCount: 1,
      runtimeShardBytes: [statSync(outBasePath).size],
      sourceFeatures: sourceFeatures.length
    };
  }

  return {
    runtimePaths: tempPaths.map(rel),
    runtimeFeatures,
    runtimeBytes: totalBytes,
    runtimeShardCount: tempPaths.length,
    runtimeShardBytes: shardBytes,
    sourceFeatures: sourceFeatures.length
  };
}

mkdirSync(OUT_DIR, { recursive: true });
cleanOldRuntimeGeoJson();
const sourceManifest = readSourceManifest();
const summary = [];
const skipped = [];
const failed = [];

for (const entry of sourceManifest.transitions || []) {
  const id = entry.id;
  if (!id) continue;
  const sourcePath = join(ROOT, entry.path || `data/timeline-transitions/${id}.geojson`);
  const outPath = join(OUT_DIR, `${id}.geojson`);
  try {
    const sourceBytes = statSync(sourcePath).size;
    if (sourceBytes > MAX_SOURCE_STRING_BYTES) {
      skipped.push({
        ...(entry || {}),
        id,
        reason: 'runtime-source-sidecar-too-large-for-browser-json',
        sourcePath: rel(sourcePath),
        sourceBytes,
        recommendation: 'Generate a vector-tiled or streamed transition overlay before advertising this transition in the browser runtime manifest.'
      });
      continue;
    }
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    const runtime = writeRuntimeOverlay(entry, source, sourcePath, outPath);
    summary.push({
      ...(entry || {}),
      id,
      ...runtime,
      sourcePath: rel(sourcePath),
      sourceSidecar: `data/timeline-transitions/${basename(sourcePath)}`
    });
  } catch (error) {
    failed.push({ id, path: rel(sourcePath), reason: error?.name || 'Error', message: String(error?.message || error) });
  }
}

const manifest = {
  version: 2,
  generatedAt: buildTimestamp(),
  sourceManifest: rel(SOURCE_MANIFEST),
  minimumAreaM2: sourceManifest.minimumAreaM2 ?? 100,
  maxShardBytes: MAX_SHARD_BYTES,
  compactRuntimeProperties: true,
  transitionCount: summary.length,
  skippedCount: (Array.isArray(sourceManifest.skipped) ? sourceManifest.skipped.length : 0) + skipped.length,
  failedCount: failed.length + (Array.isArray(sourceManifest.failed) ? sourceManifest.failed.length : 0),
  transitions: summary,
  skipped: [...(sourceManifest.skipped || []), ...skipped],
  failed: [...(sourceManifest.failed || []), ...failed]
};
writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(JSON.stringify({ transitionCount: manifest.transitionCount, skippedCount: manifest.skippedCount, failedCount: manifest.failedCount }, null, 2));
