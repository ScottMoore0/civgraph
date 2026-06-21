#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, 'data', 'timeline-transition-overlays', 'manifest.json');
const REQUIRED_TRANSITIONS = [
  'wards-1972__wards-1984',
  'wards-1984__wards-1993',
  'wards-1993__wards-2012',
  'wards-2012__wards-2022-final-recommendations'
];
const MAX_RUNTIME_BYTES = 24 * 1024 * 1024;
const VISIBLE_TYPES = new Set(['split', 'territory-split', 'transfer']);

function fail(message) {
  console.error(`[timeline-transitions] ${message}`);
  process.exitCode = 1;
}

if (!existsSync(MANIFEST_PATH)) {
  fail(`Missing runtime manifest: ${MANIFEST_PATH}`);
  process.exit();
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const declaredFailures = Number(manifest.failedCount || 0);
if (declaredFailures > 0) {
  fail(`Runtime manifest records ${declaredFailures} failed transition build(s).`);
}

const transitions = Array.isArray(manifest.transitions) ? manifest.transitions : [];
const ids = new Set(transitions.map((entry) => entry.id));
for (const id of REQUIRED_TRANSITIONS) {
  if (!ids.has(id)) fail(`Required Ward transition is missing from runtime manifest: ${id}`);
}

for (const entry of transitions) {
  const paths = Array.isArray(entry.runtimePaths) && entry.runtimePaths.length
    ? entry.runtimePaths
    : [entry.runtimePath].filter(Boolean);
  if (!entry.id || !paths.length) {
    fail(`Malformed transition entry: ${JSON.stringify(entry)}`);
    continue;
  }
  let featureCount = 0;
  let byteCount = 0;
  for (const runtimePath of paths) {
    const path = join(ROOT, runtimePath);
    if (!existsSync(path)) {
      fail(`Runtime overlay file is missing for ${entry.id}: ${runtimePath}`);
      continue;
    }
    const size = statSync(path).size;
    byteCount += size;
    if (size > MAX_RUNTIME_BYTES) {
      fail(`Runtime overlay shard exceeds Cloudflare Pages single-file safety budget (${size} bytes): ${runtimePath}`);
    }
    const geojson = JSON.parse(readFileSync(path, 'utf8'));
    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      fail(`Runtime overlay shard is not a FeatureCollection: ${runtimePath}`);
      continue;
    }
    featureCount += geojson.features.length;
    for (const feature of geojson.features) {
      const type = String(feature?.properties?.transitionType || feature?.properties?.changeType || '').trim();
      if (!VISIBLE_TYPES.has(type)) {
        fail(`Runtime overlay shard contains non-visible transition type for ${entry.id}: ${type || '(blank)'}`);
        break;
      }
      if (feature?.properties?.fromProperties || feature?.properties?.toProperties) {
        fail(`Runtime overlay shard contains verbose source properties for ${entry.id}: ${runtimePath}`);
        break;
      }
    }
  }
  if (Number(entry.runtimeFeatures) !== featureCount) {
    fail(`Runtime feature count mismatch for ${entry.id}: manifest=${entry.runtimeFeatures} files=${featureCount}`);
  }
  if (Number(entry.runtimeBytes) !== byteCount) {
    fail(`Runtime byte count mismatch for ${entry.id}: manifest=${entry.runtimeBytes} files=${byteCount}`);
  }
  if (Number(entry.runtimeShardCount || paths.length) !== paths.length) {
    fail(`Runtime shard count mismatch for ${entry.id}: manifest=${entry.runtimeShardCount} files=${paths.length}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[timeline-transitions] ${transitions.length} runtime overlays validated.`);
