#!/usr/bin/env node
/**
 * Validate the layer metadata the map app draws from (render/metadata/maps-test.json): every
 * layer's source type, zooms, bounds, labels, tile URLs and feature index, the alias layers, and
 * the port plan's converted rows.
 *
 * It used to validate the legacy /render/ test app as well (its page, bundle versions, modules and
 * service worker). That app retired on 7 Nov 2026 (site restructure F5), so those checks went
 * with it; the metadata checks guard the live map app and run in check:map-tiles.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidBounds } from '../../../packages/maps-pipeline/src/layer-bounds.mjs';
import { loadRegistry } from '../../../packages/registries/src/index.mjs';
import { drawnLayerTypes, typesWithBehaviour } from '../../../packages/registries/src/layers.mjs';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const PORT_PLAN_PATH = resolve(ROOT, 'render/metadata/main-site-port-plan.json');

/**
 * A layer of render/metadata/maps-test.json, as far as these checks read it (every layer has an
 * id and a sourceType; the rest is checked here).
 * @typedef {{
 *   id: string, sourceType: string, sourceMapId?: string, sourceLayer?: string, tiles?: string,
 *   minzoom: number, maxzoom: number, bounds?: unknown, geometryType?: string, aliasTargetLayerId?: string,
 *   labelStyle?: { fontWeight?: string, [key: string]: unknown },
 *   [field: string]: unknown
 * }} MetadataLayer
 */
/** @typedef {{ layers?: MetadataLayer[], [field: string]: unknown }} LayerMetadata */
/** @typedef {{ conversionStatus: string, testLayerId?: string, sourceMapId?: string }} PortPlanRow */
/** @typedef {{ errors: string[], warnings: string[] }} CheckResult */

/** @param {unknown} value */

function localPathFromUrlTemplate(value) {
  if (typeof value !== 'string') return null;
  if (/^https?:\/\//.test(value)) return null;
  return value
    .replace(/^\//, '')
    .replace('/{z}/{x}/{y}.pbf', '')
    .replace('/{z}/{x}/{y}.mvt', '');
}



// Source types that are not vector tiles. raster-dem (94 layers) and point-cloud (5)
// were added to the site after this validator was written, so they were rejected as
// "unsupported" and then failed two further checks each -- sourceLayer and geometryType --
// that only mean anything for vector data. That is ~300 of the failures that pushed
// check:test out of the default gate and left the tile metadata unguarded. They are the
// layer-types registry's rasterSource and threeD types; the vector ones are its vectorTiles types.
const LAYER_TYPES = loadRegistry('layers');
const NON_VECTOR_SOURCE_TYPES = new Set([...typesWithBehaviour(LAYER_TYPES, 'rasterSource'), ...typesWithBehaviour(LAYER_TYPES, 'threeD')]);
// A layer the map app can draw: its type has a renderer module (the registry's drawnBy, the
// layer-type code registry packages/map/src/renderer/layer-kinds/).
const SUPPORTED_SOURCE_TYPES = new Set(drawnLayerTypes(LAYER_TYPES));

/**
 * @param {MetadataLayer} layer
 * @returns {CheckResult}
 */
function validateLayer(layer) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (!layer.id) errors.push('missing id');
  if (!layer.name) errors.push(`${layer.id || '(unknown)'}: missing name`);
  if (layer.renderer !== 'maplibre') errors.push(`${layer.id}: renderer must be "maplibre"`);
  if (!SUPPORTED_SOURCE_TYPES.has(layer.sourceType)) errors.push(`${layer.id}: unsupported sourceType ${layer.sourceType}`);
  if (!NON_VECTOR_SOURCE_TYPES.has(layer.sourceType) && !layer.sourceLayer) errors.push(`${layer.id}: missing sourceLayer`);
  if (!Number.isInteger(layer.minzoom) || !Number.isInteger(layer.maxzoom) || layer.minzoom < 0 || layer.maxzoom < layer.minzoom) {
    errors.push(`${layer.id}: invalid minzoom/maxzoom`);
  }
  if (!isValidBounds(layer.bounds, layer)) errors.push(`${layer.id}: invalid bounds`);
  if (!NON_VECTOR_SOURCE_TYPES.has(layer.sourceType) && layer.geometryType !== undefined && !['polygon', 'line', 'point'].includes(layer.geometryType)) {
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

  if (layer.sourceType === 'image') {
    if (!layer.imageUrl && !layer.url) errors.push(`${layer.id}: missing imageUrl`);
    if (!isValidBounds(layer.bounds)) errors.push(`${layer.id}: image source requires valid bounds`);
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

/** @param {string} path */
function directorySize(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    // the loop runs only while the stack is non-empty
    const current = /** @type {string} */ (stack.pop());
    const entries = safeReadDir(current);
    for (const entry of entries) {
      const child = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      if (entry.isFile()) total += statSync(child).size;
    }
  }
  return total;
}

/** @param {string} path */
function safeReadDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** @param {number} bytes */
function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @param {LayerMetadata} metadata
 * @returns {CheckResult}
 */
function validateMetadataContract(metadata) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (Number(metadata.schemaVersion || 0) < 2) errors.push('metadata schemaVersion must be at least 2');
  if (!Array.isArray(metadata.categories)) warnings.push('metadata has no categories array; catalogue grouping will be inferred');
  if (!metadata.capabilities || typeof metadata.capabilities !== 'object') warnings.push('metadata has no capabilities object');
  if (!metadata.readiness || typeof metadata.readiness !== 'object') warnings.push('metadata has no migration readiness object');
  if (!Array.isArray(metadata.timeSeriesChains)) warnings.push('metadata has no timeSeriesChains array');
  if (!Array.isArray(metadata.electionCatalogues)) warnings.push('metadata has no electionCatalogues array');
  return { errors, warnings };
}

/**
 * @param {LayerMetadata} metadata
 * @returns {CheckResult}
 */
function validatePortPlan(metadata) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (!existsSync(PORT_PLAN_PATH)) {
    warnings.push('render/metadata/main-site-port-plan.json is missing; run npm run build:test:metadata to refresh migration inventory');
    return { errors, warnings };
  }
  /** @type {{ rows?: PortPlanRow[] }} */
  const plan = JSON.parse(readFileSync(PORT_PLAN_PATH, 'utf8'));
  if (!Array.isArray(plan.rows) || plan.rows.length === 0) {
    errors.push('main-site port plan must contain rows');
  }
  const convertedRows = (plan.rows || [])
    .filter((row) => ['converted', 'convertedAlias', 'convertedComposite'].includes(row.conversionStatus));
  const convertedIds = new Set(convertedRows.map((row) => row.testLayerId));
  // A COMPOSITE ROW NAMES ITS PARTS, NOT THE LAYER. counties-ireland is planned as a
  // composite of counties-ni-1915 and roi-counties-2011, so its row carries the pseudo-id
  // 'composite:counties-ni-1915,roi-counties-2011' rather than counties-ireland-vector.
  // The layer is nonetheless a real conversion -- its archive is on the CDN -- so matching
  // only on testLayerId reported a healthy layer as unplanned. sourceMapId is the stable
  // link between a layer and its plan row, and still requires a row to exist.
  const convertedSourceMapIds = new Set(convertedRows.map((row) => row.sourceMapId).filter(Boolean));
  for (const layer of metadata.layers || []) {
    // Only vector layers come from the conversion pipeline. raster-dem, point-cloud and
    // image layers reach the metadata by other routes and have no converted row by
    // design, so requiring one flagged 99 healthy layers.
    if (NON_VECTOR_SOURCE_TYPES.has(layer.sourceType)) continue;
    if (!convertedIds.has(layer.id) && !convertedSourceMapIds.has(layer.sourceMapId)) {
      errors.push(`${layer.id}: missing converted row in main-site port plan`);
    }
  }
  return { errors, warnings };
}

/**
 * @param {LayerMetadata} metadata
 * @returns {string[]}
 */
function validateAliasLayers(metadata) {
  /** @type {string[]} */
  const errors = [];
  const layers = metadata.layers || [];
  /** @type {Map<string | undefined, MetadataLayer>} */
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const aliases = layers.filter((layer) => layer.aliasOf || layer.cloneOf || layer.conversionStatus === 'convertedAlias');
  for (const layer of aliases) {
    if (layer.status !== 'converted-alias') errors.push(`${layer.id}: alias layer must have converted-alias status`);
    if (layer.conversionStatus !== 'convertedAlias') errors.push(`${layer.id}: alias layer must have convertedAlias conversionStatus`);
    if (!layer.aliasOf || !layer.cloneOf) errors.push(`${layer.id}: alias layer must retain aliasOf and cloneOf metadata`);
    if (!layer.aliasTargetLayerId) errors.push(`${layer.id}: alias layer missing aliasTargetLayerId`);
    const target = byId.get(layer.aliasTargetLayerId);
    if (!target) {
      errors.push(`${layer.id}: alias target layer missing: ${layer.aliasTargetLayerId}`);
      continue;
    }
    if (target.loadable === false) errors.push(`${layer.id}: alias target layer is not loadable`);
    if (layer.sourceType !== target.sourceType) errors.push(`${layer.id}: alias sourceType differs from target ${target.id}`);
    if (layer.tileUrl !== target.tileUrl) errors.push(`${layer.id}: alias tileUrl differs from target ${target.id}`);
    if (layer.tiles !== target.tiles) errors.push(`${layer.id}: alias tiles fallback differs from target ${target.id}`);
    if (layer.sourceLayer !== target.sourceLayer) errors.push(`${layer.id}: alias sourceLayer differs from target ${target.id}`);
  }
  return errors;
}

function main() {
  /** @type {LayerMetadata} */
  const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
  const layers = metadata.layers || [];
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const metadataResult = validateMetadataContract(metadata);
  errors.push(...metadataResult.errors);
  warnings.push(...metadataResult.warnings);
  const portPlanResult = validatePortPlan(metadata);
  errors.push(...portPlanResult.errors);
  warnings.push(...portPlanResult.warnings);
  errors.push(...validateAliasLayers(metadata));

  for (const layer of layers) {
    const result = validateLayer(layer);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  console.log('Civgraph layer metadata validation');
  console.log(`- metadata: render/metadata/maps-test.json`);
  console.log(`- layers: ${layers.length}`);
  if (existsSync(PORT_PLAN_PATH)) console.log(`- port plan: render/metadata/main-site-port-plan.json`);

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  if (errors.length) {
    console.log('\nErrors:');
    for (const error of errors) console.log(`- ${error}`);
    process.exit(1);
  }

  console.log('\nPASS: the layer metadata and local vector-tile assets are valid.');
}

main();
