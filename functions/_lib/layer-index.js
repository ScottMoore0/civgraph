/**
 * The map app's startup index, built from the full layer records (render/metadata/maps-test.json).
 *
 * One function for both places that build it, so they cannot disagree:
 *   - functions/_api/layers (data design phase 3): from the `layers` rows, at request time;
 *   - scripts/build-test2-metadata-shards.mjs: the committed maps-test-index.json, which scripts
 *     still read from disk until phase 4.
 * Pure and dependency-free (it runs in the Workers runtime and under Node).
 *
 * An entry is the layer's COMPACT_LAYER_FIELDS, then where its full record lives (detailUrl)
 * and, when its feature index has been read, its duplicate-feature-id summary.
 */

export const COMPACT_LAYER_FIELDS = [
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
  // 3D raster-dem terrain fields
  'demEncoding',
  'exaggeration',
  'hillshadeTiles',
  'hillshadeOpacity',
  'hillshadeMinzoom',
  'hillshadeMaxzoom',
  // variant linkage (per-basin terrain variants)
  'variantOf',
  'parentCard',
  // deck.gl point-cloud fields
  'tilesetUrl',
  'pointSize',
  'maxScreenSpaceError',
  'maxMemoryMB',
  'interleaved',
  'vertexColors',
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
  // dotted approximate stretches of a reconstructed edition (src/map/renderer/approximate-segments.js)
  'approximateSegments',
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

/** The file name a layer's sidecars had under render/metadata (build-test2-metadata-shards). */
export function layerFileName(id) {
  return `${String(id || 'layer').replace(/[^A-Za-z0-9_.-]+/g, '-')}.json`;
}

/** Where the full record and the duplicate-id sidecar are served: the API, or the old files. */
export const API_URLS = {
  detail: (id) => `/_api/layers/${encodeURIComponent(id)}`,
  duplicates: (id) => `/_api/layers/${encodeURIComponent(id)}/duplicates`,
};
export const FILE_URLS = {
  detail: (id) => `/render/metadata/layer-details-test2/${layerFileName(id)}`,
  duplicates: (id) => `/render/metadata/duplicate-feature-ids/${layerFileName(id)}`,
};

/** The compact copy of one layer record. */
export function compactLayer(layer) {
  const compact = {};
  for (const field of COMPACT_LAYER_FIELDS) {
    if (layer[field] !== undefined) compact[field] = layer[field];
  }
  // The startup index needs only how a package is served (the app) and where it lives locally
  // (validate-test2-pmtiles-cdn). Its build record -- source hash, byte counts, verification
  // dates -- stays in the full record, where the checks that use it read it.
  if (layer.tilePackage && typeof layer.tilePackage === 'object') {
    const { serving, localPath } = layer.tilePackage;
    compact.tilePackage = Object.fromEntries(Object.entries({ serving, localPath }).filter(([, value]) => value !== undefined));
  }
  return compact;
}

/**
 * The index entry of one layer. `duplicates` is its sidecar ({ featureCount, featureIdMode,
 * duplicateFeatureIds, ... }) or null when the layer has no readable feature index.
 */
export function indexEntry(layer, duplicates, urls = API_URLS) {
  const entry = compactLayer(layer);
  entry.detailUrl = urls.detail(layer.id);
  if (duplicates) {
    entry.duplicateFeatureIdsUrl = urls.duplicates(layer.id);
    entry.duplicateFeatureIdCount = (duplicates.duplicateFeatureIds || []).length;
    entry.featureIdMode = duplicates.featureIdMode;
  }
  return entry;
}

/**
 * The whole index document: maps-test.json's head with the compact layers. `head` keeps its
 * `layers` key (any value) in its place, so the index has the same key order as the file.
 */
export function indexDocument(head, entries) {
  return {
    ...head,
    generatedFrom: 'render/metadata/maps-test.json',
    detailIndex: true,
    detailLayerCount: entries.length,
    layers: entries,
  };
}

/** A feature index's items, whatever its shape. */
export function itemsFromFeatureIndex(index) {
  if (Array.isArray(index)) return index;
  if (Array.isArray(index?.items)) return index.items;
  if (Array.isArray(index?.features)) return index.features;
  return [];
}

/** The duplicate-feature-id sidecar of a layer, from its parsed feature index. */
export function duplicateSidecar(layer, featureIndex) {
  const counts = new Map();
  for (const item of itemsFromFeatureIndex(featureIndex)) {
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
    layerId: layer.id,
    sourceMapId: layer.sourceMapId || null,
    featureIndexUrl: layer.featureIndexUrl,
    featureCount: counts.size,
    featureIdMode: duplicateFeatureIds.length ? 'duplicate-aware' : 'unique',
    duplicateFeatureIds,
  };
}
