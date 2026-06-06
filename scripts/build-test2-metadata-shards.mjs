#!/usr/bin/env node
/**
 * Build lightweight /test2 metadata for startup and lazy detail/duplicate-id
 * sidecars from the existing /test MapLibre metadata.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'test', 'metadata', 'maps-test.json');
const INDEX_OUTPUT = path.join(ROOT, 'test', 'metadata', 'maps-test-index.json');
const DETAIL_DIR = path.join(ROOT, 'test', 'metadata', 'layer-details-test2');
const DUPLICATE_DIR = path.join(ROOT, 'test', 'metadata', 'duplicate-feature-ids');

const COMPACT_LAYER_FIELDS = [
  'id',
  'sourceMapId',
  'parentId',
  'name',
  'category',
  'categoryId',
  'group',
  'provider',
  'date',
  'dateAdded',
  'dateEffective',
  'description',
  'notes',
  'sourceType',
  'geometryType',
  'renderer',
  'status',
  'conversionStatus',
  'loadable',
  'bounds',
  'minzoom',
  'maxzoom',
  'maxNativeZoom',
  'sourceLayer',
  'tileUrl',
  'tiles',
  'tilesFallback',
  'tilePackage',
  'tileSize',
  'metadataUrl',
  'imageUrl',
  'rasterOpacity',
  'style',
  'labelProperty',
  'labelPropertyFallbacks',
  'labelCanonicalProperty',
  'labelMinZoom',
  'labelMaxZoom',
  'labelMinZoomProperty',
  'labelRankProperty',
  'labelDensity',
  'labelStyle',
  'promoteId',
  'idProperty',
  'sourceFile',
  'sourceDatasetLayer',
  'featureIndexUrl',
  'numericProperties',
  'categoricalProperties',
  'popupProperties',
  'variants',
  'aliasOf',
  'aliasTargetLayerId',
  'cloneOf',
  'generatedFrom',
  'warning',
  'keywords',
  'isGroup',
  'members'
];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonIfChanged(file, value) {
  const next = stableJson(value);
  if (existsSync(file) && readFileSync(file, 'utf8') === next) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, next);
  return true;
}

function safeFileName(id) {
  return String(id || 'layer').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function copyCompactLayer(layer) {
  const compact = {};
  for (const field of COMPACT_LAYER_FIELDS) {
    if (layer[field] !== undefined) compact[field] = layer[field];
  }
  return compact;
}

function localPathForUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return null;
  const clean = String(url).split('?')[0].replace(/^\/+/, '');
  return path.join(ROOT, clean);
}

function itemsFromFeatureIndex(index) {
  if (Array.isArray(index)) return index;
  if (Array.isArray(index?.items)) return index.items;
  if (Array.isArray(index?.features)) return index.features;
  return [];
}

function duplicateIdsForFeatureIndex(url) {
  const file = localPathForUrl(url);
  if (!file || !existsSync(file)) return null;
  const index = readJson(file);
  const counts = new Map();
  for (const item of itemsFromFeatureIndex(index)) {
    const id = item?.id;
    if (id === undefined || id === null || id === '') continue;
    const key = String(id);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const duplicateFeatureIds = [...counts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    featureCount: counts.size,
    duplicateFeatureIds,
    featureIdMode: duplicateFeatureIds.length ? 'duplicate-aware' : 'unique'
  };
}

function build() {
  const raw = readJson(INPUT);
  rmSync(DETAIL_DIR, { recursive: true, force: true });
  rmSync(DUPLICATE_DIR, { recursive: true, force: true });
  mkdirSync(DETAIL_DIR, { recursive: true });
  mkdirSync(DUPLICATE_DIR, { recursive: true });

  let detailsWritten = 0;
  let duplicateSidecarsWritten = 0;
  const layers = (raw.layers || []).map((layer) => {
    const fileName = `${safeFileName(layer.id)}.json`;
    const detailUrl = `/test/metadata/layer-details-test2/${fileName}`;
    writeJsonIfChanged(path.join(DETAIL_DIR, fileName), layer);
    detailsWritten += 1;

    const compact = copyCompactLayer(layer);
    compact.detailUrl = detailUrl;

    const duplicateInfo = duplicateIdsForFeatureIndex(layer.featureIndexUrl);
    if (duplicateInfo) {
      const duplicateUrl = `/test/metadata/duplicate-feature-ids/${fileName}`;
      const sidecar = {
        layerId: layer.id,
        sourceMapId: layer.sourceMapId || null,
        featureIndexUrl: layer.featureIndexUrl,
        featureCount: duplicateInfo.featureCount,
        featureIdMode: duplicateInfo.featureIdMode,
        duplicateFeatureIds: duplicateInfo.duplicateFeatureIds
      };
      writeJsonIfChanged(path.join(DUPLICATE_DIR, fileName), sidecar);
      duplicateSidecarsWritten += 1;
      compact.duplicateFeatureIdsUrl = duplicateUrl;
      compact.duplicateFeatureIdCount = duplicateInfo.duplicateFeatureIds.length;
      compact.featureIdMode = duplicateInfo.featureIdMode;
    }

    return compact;
  });

  const index = {
    ...raw,
    generatedFrom: 'test/metadata/maps-test.json',
    detailIndex: true,
    detailLayerCount: layers.length,
    layers
  };
  writeJsonIfChanged(INDEX_OUTPUT, index);

  console.log(`Test2 metadata index: ${layers.length} compact layers`);
  console.log(`Test2 layer details: ${detailsWritten} files`);
  console.log(`Test2 duplicate-id sidecars: ${duplicateSidecarsWritten} files`);
}

build();
