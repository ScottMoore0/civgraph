#!/usr/bin/env node
/**
 * Validate the isolated /test MapLibre/vector-tile rewrite assets.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const PORT_PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const INDEX_PATH = resolve(ROOT, 'test/index.html');
const APP_PATH = resolve(ROOT, 'test/src/app.js');
const CONFIG_PATH = resolve(ROOT, 'test/src/config.js');
const SERVICE_WORKER_PATH = resolve(ROOT, 'test/sw.js');
const REQUIRED_MODULES = [
  'test/src/config.js',
  'test/src/dom.js',
  'test/src/utils.js',
  'test/src/labels.js',
  'test/src/metadata-service.js',
  'test/src/map-controller.js',
  'test/src/catalogue-controller.js',
  'test/src/active-layers.js',
  'test/src/feature-details.js',
  'test/src/diagnostics.js',
  'test/src/url-state.js',
  'test/src/search-service.js',
  'test/src/time-series-controller.js',
  'test/src/election-service.js',
  'test/src/conditional-styling.js',
  'test/src/migration-readiness.js'
];

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
  if (!['mvt', 'pmtiles', 'raster'].includes(layer.sourceType)) errors.push(`${layer.id}: unsupported sourceType ${layer.sourceType}`);
  if (layer.sourceType !== 'raster' && !layer.sourceLayer) errors.push(`${layer.id}: missing sourceLayer`);
  if (!Number.isInteger(layer.minzoom) || !Number.isInteger(layer.maxzoom) || layer.minzoom < 0 || layer.maxzoom < layer.minzoom) {
    errors.push(`${layer.id}: invalid minzoom/maxzoom`);
  }
  if (!isValidBounds(layer.bounds)) errors.push(`${layer.id}: invalid bounds`);
  if (layer.geometryType !== undefined && !['polygon', 'line', 'point'].includes(layer.geometryType)) {
    errors.push(`${layer.id}: geometryType must be polygon, line, or point`);
  }
  if (layer.references !== undefined && !Array.isArray(layer.references)) {
    errors.push(`${layer.id}: references must be an array`);
  }
  if (layer.sourceDownloads !== undefined && !Array.isArray(layer.sourceDownloads)) {
    errors.push(`${layer.id}: sourceDownloads must be an array`);
  }
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

  if (layer.sourceType === 'raster' && !layer.tiles && !layer.tileUrl) {
    errors.push(`${layer.id}: missing raster tiles URL template`);
  }

  if (layer.sourceType === 'pmtiles' && !layer.tileUrl) {
    errors.push(`${layer.id}: missing tileUrl`);
  }

  if (layer.featureIndexUrl !== undefined) {
    if (typeof layer.featureIndexUrl !== 'string') {
      errors.push(`${layer.id}: featureIndexUrl must be a string`);
    } else if (!/^https?:\/\//.test(layer.featureIndexUrl)) {
      const indexPath = resolve(ROOT, layer.featureIndexUrl.replace(/^\//, ''));
      if (!existsSync(indexPath)) {
        errors.push(`${layer.id}: feature index missing: ${layer.featureIndexUrl}`);
      }
    }
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
  const configJs = readFileSync(CONFIG_PATH, 'utf8');
  const serviceWorker = readFileSync(SERVICE_WORKER_PATH, 'utf8');

  const indexVersions = [...indexHtml.matchAll(/\/test\/build\/test\.bundle\.(?:js|css)\?v=(test-\d+)/g)]
    .map((match) => match[1]);
  const appVersion = configJs.match(/TEST_ASSET_VERSION\s*=\s*['"](test-\d+)['"]/)?.[1];
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
  if (!appVersion) errors.push('test/src/config.js must define TEST_ASSET_VERSION');
  if (!swVersion) errors.push('test/sw.js must define TEST_CACHE_VERSION as test-vN');

  if (indexVersion && appVersion && indexVersion !== appVersion) {
    errors.push(`/test app asset version mismatch: index uses ${indexVersion}, app uses ${appVersion}`);
  }

  if (indexVersionNumber && swVersion && Number(indexVersionNumber) !== Number(swVersion)) {
    errors.push(`/test service-worker version mismatch: index uses ${indexVersion}, service worker uses test-v${swVersion}`);
  }

  return errors;
}

function validateModules() {
  const errors = [];
  for (const modulePath of REQUIRED_MODULES) {
    if (!existsSync(resolve(ROOT, modulePath))) errors.push(`missing /test module: ${modulePath}`);
  }
  return errors;
}

function validateMetadataContract(metadata) {
  const errors = [];
  const warnings = [];
  if (Number(metadata.schemaVersion || 0) < 2) errors.push('metadata schemaVersion must be at least 2');
  if (!Array.isArray(metadata.categories)) warnings.push('metadata has no categories array; catalogue grouping will be inferred');
  if (!metadata.capabilities || typeof metadata.capabilities !== 'object') warnings.push('metadata has no capabilities object');
  if (!metadata.readiness || typeof metadata.readiness !== 'object') warnings.push('metadata has no migration readiness object');
  if (!Array.isArray(metadata.timeSeriesChains)) warnings.push('metadata has no timeSeriesChains array');
  if (!Array.isArray(metadata.electionCatalogues)) warnings.push('metadata has no electionCatalogues array');
  return { errors, warnings };
}

function validatePortPlan(metadata) {
  const errors = [];
  const warnings = [];
  if (!existsSync(PORT_PLAN_PATH)) {
    warnings.push('test/metadata/main-site-port-plan.json is missing; run npm run build:test:metadata to refresh migration inventory');
    return { errors, warnings };
  }
  const plan = JSON.parse(readFileSync(PORT_PLAN_PATH, 'utf8'));
  if (!Array.isArray(plan.rows) || plan.rows.length === 0) {
    errors.push('main-site port plan must contain rows');
  }
  const convertedIds = new Set((plan.rows || []).filter((row) => row.conversionStatus === 'converted').map((row) => row.testLayerId));
  for (const layer of metadata.layers || []) {
    if (!convertedIds.has(layer.id)) {
      errors.push(`${layer.id}: missing converted row in main-site port plan`);
    }
  }
  return { errors, warnings };
}

function main() {
  const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
  const layers = metadata.layers || [];
  const errors = [...validateAssetVersions(), ...validateModules()];
  const warnings = [];
  const metadataResult = validateMetadataContract(metadata);
  errors.push(...metadataResult.errors);
  warnings.push(...metadataResult.warnings);
  const portPlanResult = validatePortPlan(metadata);
  errors.push(...portPlanResult.errors);
  warnings.push(...portPlanResult.warnings);

  for (const layer of layers) {
    const result = validateLayer(layer);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  console.log('Civgraph /test Validation');
  console.log(`- metadata: test/metadata/maps-test.json`);
  console.log(`- layers: ${layers.length}`);
  if (existsSync(PORT_PLAN_PATH)) console.log(`- port plan: test/metadata/main-site-port-plan.json`);

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
