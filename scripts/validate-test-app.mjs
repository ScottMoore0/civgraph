#!/usr/bin/env node
/**
 * Validate the isolated /test MapLibre/vector-tile rewrite assets.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const INDEX_PATH = resolve(ROOT, 'test/index.html');
const APP_PATH = resolve(ROOT, 'test/src/app.js');
const SERVICE_WORKER_PATH = resolve(ROOT, 'test/sw.js');

function localPathFromUrlTemplate(value) {
  if (typeof value !== 'string') return null;
  if (/^https?:\/\//.test(value)) return null;
  return value
    .replace(/^\//, '')
    .replace('/{z}/{x}/{y}.pbf', '')
    .replace('/{z}/{x}/{y}.mvt', '');
}

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

function validateLayer(layer) {
  const errors = [];
  const warnings = [];
  if (!layer.id) errors.push('missing id');
  if (!layer.name) errors.push(`${layer.id || '(unknown)'}: missing name`);
  if (layer.renderer !== 'maplibre') errors.push(`${layer.id}: renderer must be "maplibre"`);
  if (!['mvt', 'pmtiles'].includes(layer.sourceType)) errors.push(`${layer.id}: unsupported sourceType ${layer.sourceType}`);
  if (!layer.sourceLayer) errors.push(`${layer.id}: missing sourceLayer`);
  if (!Number.isInteger(layer.minzoom) || !Number.isInteger(layer.maxzoom) || layer.minzoom < 0 || layer.maxzoom < layer.minzoom) {
    errors.push(`${layer.id}: invalid minzoom/maxzoom`);
  }
  if (!isValidBounds(layer.bounds)) errors.push(`${layer.id}: invalid bounds`);
  if (layer.labelProperty) {
    if (layer.labelPropertyFallbacks && !Array.isArray(layer.labelPropertyFallbacks)) {
      errors.push(`${layer.id}: labelPropertyFallbacks must be an array`);
    }
    for (const key of ['labelCanonicalProperty', 'labelRankProperty', 'labelMinZoomProperty']) {
      if (layer[key] !== undefined && typeof layer[key] !== 'string') errors.push(`${layer.id}: ${key} must be a string`);
    }
    if (layer.labelMinZoom !== undefined && layer.labelMinZoom !== null && (!Number.isFinite(Number(layer.labelMinZoom)) || Number(layer.labelMinZoom) < 0)) {
      errors.push(`${layer.id}: labelMinZoom must be a non-negative number`);
    }
    const hasLabelMaxZoom = layer.labelMaxZoom !== undefined && layer.labelMaxZoom !== null && layer.labelMaxZoom !== '';
    if (hasLabelMaxZoom && (!Number.isFinite(Number(layer.labelMaxZoom)) || Number(layer.labelMaxZoom) <= Number(layer.labelMinZoom ?? 0))) {
      errors.push(`${layer.id}: labelMaxZoom must be greater than labelMinZoom`);
    }
    if (layer.labelStyle !== undefined) {
      if (!layer.labelStyle || typeof layer.labelStyle !== 'object' || Array.isArray(layer.labelStyle)) {
        errors.push(`${layer.id}: labelStyle must be an object`);
      } else {
        for (const key of ['color', 'hoverColor', 'selectedColor', 'haloColor']) {
          if (layer.labelStyle[key] !== undefined && typeof layer.labelStyle[key] !== 'string') {
            errors.push(`${layer.id}: labelStyle.${key} must be a string`);
          }
        }
        for (const key of ['haloWidth', 'haloBlur', 'fontSize', 'maxWidth', 'lineHeight']) {
          if (layer.labelStyle[key] !== undefined && !Number.isFinite(Number(layer.labelStyle[key]))) {
            errors.push(`${layer.id}: labelStyle.${key} must be numeric`);
          }
        }
        if (layer.labelStyle.fontWeight !== undefined && !['regular', 'bold'].includes(layer.labelStyle.fontWeight)) {
          errors.push(`${layer.id}: labelStyle.fontWeight must be "regular" or "bold"`);
        }
      }
    }
  }

  if (layer.sourceType === 'mvt') {
    if (!layer.tiles) {
      errors.push(`${layer.id}: missing tiles URL template`);
    } else if (!layer.tiles.includes('{z}') || !layer.tiles.includes('{x}') || !layer.tiles.includes('{y}')) {
      errors.push(`${layer.id}: tiles URL must include {z}/{x}/{y}`);
    }
    const relativeRoot = localPathFromUrlTemplate(layer.tiles);
    if (relativeRoot) {
      const tileRoot = resolve(ROOT, relativeRoot);
      if (!existsSync(tileRoot)) {
        errors.push(`${layer.id}: local tile directory missing: ${relativeRoot}`);
      } else {
        const metadataPath = resolve(tileRoot, 'metadata.json');
        if (!existsSync(metadataPath)) errors.push(`${layer.id}: local metadata.json missing: ${relativeRoot}/metadata.json`);
        const totalBytes = directorySize(tileRoot);
        if (totalBytes === 0) errors.push(`${layer.id}: local tile directory is empty: ${relativeRoot}`);
        if (totalBytes > 250 * 1024 * 1024) warnings.push(`${layer.id}: local tile directory is large (${formatBytes(totalBytes)})`);
      }
    }
  }

  if (layer.sourceType === 'pmtiles' && !layer.tileUrl) {
    errors.push(`${layer.id}: missing tileUrl`);
  }

  return { errors, warnings };
}

function directorySize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const current = stack.pop();
    const entries = safeReadDir(current);
    for (const entry of entries) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      if (entry.isFile()) total += statSync(child).size;
    }
  }
  return total;
}

function safeReadDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateAssetVersions() {
  const errors = [];
  const indexHtml = readFileSync(INDEX_PATH, 'utf8');
  const appJs = readFileSync(APP_PATH, 'utf8');
  const serviceWorker = readFileSync(SERVICE_WORKER_PATH, 'utf8');

  const indexVersions = [...indexHtml.matchAll(/\/test\/build\/test\.bundle\.(?:js|css)\?v=(test-\d+)/g)]
    .map((match) => match[1]);
  const appVersion = appJs.match(/const\s+TEST_ASSET_VERSION\s*=\s*['"](test-\d+)['"]/)?.[1];
  const swVersion = serviceWorker.match(/const\s+TEST_CACHE_VERSION\s*=\s*['"]test-v(\d+)['"]/)?.[1];

  if (indexVersions.length !== 2) {
    errors.push('/test index must version both JS and CSS bundle URLs');
  }

  const uniqueIndexVersions = [...new Set(indexVersions)];
  if (uniqueIndexVersions.length > 1) {
    errors.push(`/test index bundle versions differ: ${uniqueIndexVersions.join(', ')}`);
  }

  const indexVersion = uniqueIndexVersions[0];
  const indexVersionNumber = indexVersion?.match(/^test-(\d+)$/)?.[1];
  if (!appVersion) errors.push('test/src/app.js must define TEST_ASSET_VERSION');
  if (!swVersion) errors.push('test/sw.js must define TEST_CACHE_VERSION as test-vN');

  if (indexVersion && appVersion && indexVersion !== appVersion) {
    errors.push(`/test app asset version mismatch: index uses ${indexVersion}, app uses ${appVersion}`);
  }

  if (indexVersionNumber && swVersion && Number(indexVersionNumber) !== Number(swVersion)) {
    errors.push(`/test service-worker version mismatch: index uses ${indexVersion}, service worker uses test-v${swVersion}`);
  }

  return errors;
}

function main() {
  const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
  const layers = metadata.layers || [];
  const errors = validateAssetVersions();
  const warnings = [];

  for (const layer of layers) {
    const result = validateLayer(layer);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  console.log('Civgraph /test Validation');
  console.log(`- metadata: test/metadata/maps-test.json`);
  console.log(`- layers: ${layers.length}`);

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length) {
    console.log('\nErrors:');
    for (const error of errors) console.log(`- ${error}`);
    process.exit(1);
  }

  console.log('\nPASS: /test MapLibre metadata and local vector-tile assets are valid.');
}

main();
