#!/usr/bin/env node
/**
 * Promote verified /test conversion outputs into maps-test.json.
 *
 * This script only promotes MVT directories that were successfully verified by
 * build-test-vector-batch.mjs. It can also add georeferenced raster image
 * overlays for raster rows with bounds and hosted image URLs.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeArtefactJson, allowDeletionsFlag } from '../safe-artefact-write.mjs';
import { isValidBounds } from '../layer-bounds.mjs';
import { SITE } from '@civgraph/config/node';
import { loadRegistry } from '@civgraph/registries/index.mjs';
import { typesWithBehaviour } from '@civgraph/registries/layers.mjs';

const ROOT = resolve(process.cwd());
// Layers drawn from raster tiles or an image (the layer-types registry's rasterSource types).
const RASTER_SOURCE_TYPES = typesWithBehaviour(loadRegistry('layers'), 'rasterSource');
const MAIN_PATH = resolve(ROOT, 'data/database/maps.json');
const PLAN_PATH = resolve(ROOT, 'render/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'render/metadata/vector-conversion-report.json');
const TEST_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const PMTILES_DIR = resolve(ROOT, 'render/pmtiles/generated');
const MAX_GITHUB_BYTES = 95 * 1024 * 1024;
const DATA_HOST = SITE.dataOrigin;
const INCLUDE_RASTERS = !process.argv.includes('--no-rasters');
const RASTER_LIMIT = readNumberArg('--raster-limit', Infinity);
const GENERATED_PIPELINE = 'build-test-vector-batch';
const RASTER_PIPELINE = 'promote-test-raster-image';
const RASTER_TILE_PIPELINE = 'promote-test-raster-tiles';
const ALIAS_PIPELINE = 'promote-test-clone-alias';
const MANUAL_ALIAS_TARGETS = new Map([
  // The legacy NI civil-parishes catalogue variant should resolve to the
  // unified converted civil-parishes layer used by /test and /test2.
  ['civil-parishes', 'civil-parishes-by-province']
]);

/** @typedef {{ color?: string, fillColor?: string, fillOpacity?: number, weight?: number }} Style */
/** @typedef {{ file?: string, url?: string, label?: string }} Download */
/**
 * A record of the four documents this reads: a catalogue entry of maps.json (or a variant merged over its
 * map), a port-plan row, or a layer of maps-test.json. They share their field names; the fields read here
 * are listed, and a record may carry others (written through untouched).
 * @typedef {{ id?: string | undefined, sourceMapId?: string | undefined, name?: string | null | undefined, label?: string | undefined, category?: string | null | undefined,
 *   categoryId?: string | null | undefined, group?: string | null | undefined, provider?: string | string[] | null | undefined, description?: string | undefined,
 *   note?: string | undefined, cloneOf?: string | null | undefined, conversionStatus?: string | undefined, recommendedTarget?: string | undefined,
 *   aliasTargetLayerId?: string | null | undefined, labelProperty?: string | null | undefined, idProperty?: string | undefined,
 *   promoteId?: string | undefined, sourceType?: string | undefined, metadataUrl?: string | undefined, aliasOf?: string | null | undefined,
 *   date?: string | number | null, dateAdded?: string | null, dateEffective?: string | null, bounds?: unknown,
 *   style?: Style, rasterStyle?: { opacity?: number, minZoom?: number, maxZoom?: number, maxNativeZoom?: number, tileSize?: number },
 *   opacity?: number, variants?: Rec[], compositeSources?: string[], keywords?: unknown[] | undefined, references?: unknown[] | undefined,
 *   sourceDownloads?: Download[] | undefined, sourceCredits?: string[] | undefined, sourceFiles?: Array<{ file?: string }>,
 *   popupProperties?: unknown[], loadable?: boolean, generatedFrom?: { pipeline?: string, [field: string]: unknown },
 *   labelStyle?: { color?: string | undefined, [field: string]: unknown }, tilePackage?: unknown, warning?: string,
 *   [field: string]: unknown }} Rec
 */
/** @typedef {{ sourceMapId: string, sourceFile: string, outputDirectory: string, sourceLayer?: string, bytes?: number, files?: number, pbfFiles?: number, maxTileBytes?: number }} Converted */
/** @typedef {{ id?: string | undefined, name?: string | null | undefined, group?: string | null | undefined, description?: string | undefined }} Category */
/** @typedef {{ attribute: string, count?: number, type?: string, values?: unknown[] }} TilestatsAttribute */
/** @typedef {{ count?: number, geometry?: string, attributes?: TilestatsAttribute[] }} TilestatsLayer */
/** @typedef {ReturnType<typeof parseTileMetadata>} TileInfo */
/** @type {{ maps?: Rec[], categories?: Category[] }} */
const main = JSON.parse(readFileSync(MAIN_PATH, 'utf8'));
/** @type {{ rows?: Rec[] }} */
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
/** @type {{ skippedExisting?: Converted[], converted?: Converted[] }} */
const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
/** @type {{ layers?: Rec[], categories?: Category[] }} */
const test = JSON.parse(readFileSync(TEST_PATH, 'utf8'));
const verifiedConversions = [...(report.skippedExisting || []), ...(report.converted || [])];
const verifiedSourceIds = new Set(verifiedConversions.map((row) => row.sourceMapId));

/** @type {Map<string | undefined, Rec>} */
const directMainById = new Map((main.maps || []).map((map) => [map.id, map]));
const mainById = new Map(directMainById);
for (const map of main.maps || []) {
  for (const variant of map.variants || []) {
    mainById.set(variant.id, { ...map, ...variant, parentId: map.id, parentName: map.name });
  }
}
const categoriesById = new Map((main.categories || []).map((category) => [category.id, category]));
const rowsById = new Map((plan.rows || []).map((row) => [row.sourceMapId, row]));
const rasterRows = INCLUDE_RASTERS
  ? (plan.rows || [])
    .filter((row) => isValidBounds(row.bounds, row))
    .filter((row) => findRasterFile(row) || findRasterTileTemplate(row))
    .slice(0, RASTER_LIMIT)
  : [];
const aliasRows = buildAliasRows();
const regeneratedSourceIds = new Set([
  ...verifiedSourceIds,
  ...rasterRows.map((row) => row.sourceMapId),
  ...aliasRows.map((row) => row.sourceMapId)
]);
for (const row of plan.rows || []) {
  const map = directMainById.get(row.sourceMapId);
  if (!map || !Array.isArray(map.variants) || !map.variants.length) continue;
  const childIds = unique(map.variants.map((variant) => variant.id).filter(Boolean));
  const availableIds = new Set([
    ...(test.layers || []).flatMap((layer) => [layer.sourceMapId, layer.id]).filter(Boolean),
    ...verifiedSourceIds
  ]);
  if (childIds.length && childIds.every((id) => availableIds.has(id))) {
    regeneratedSourceIds.add(row.sourceMapId);
  }
}

// UPSERT, DO NOT PRE-FILTER. This previously dropped every existing layer whose
// sourceMapId appeared in regeneratedSourceIds, then relied on the promotion loops to
// put it back. regeneratedSourceIds includes every alias row in the port plan -- not
// just the ones in scope -- so a run filtered with --ids removed layers it never
// intended to touch and could not restore, because their targets were out of scope. On
// 2026-07-31 that destroyed 15 working layers (wards-1972/1984/1993/2001/2012,
// lgd-1984, eds-1971/1977/1980/1983, baronies-all-ireland, pc-2023, stormont-1920,
// assembly-areas-2023, ni-townlands-1844) whose tiles were still live on R2.
//
// Every existing layer is now carried forward and freshly promoted entries are appended
// after it, so dedupeLayers()/chooseLayerForDuplicate() lets the new record win for the
// same id. Additions and updates behave exactly as before; only the silent deletions go.
const baseLayers = (test.layers || []);
/** @type {Rec[]} */
const promotedVectorLayers = [];
/** @type {Rec[]} */
const promotedRasterLayers = [];
/** @type {Rec[]} */
const promotedAliasLayers = [];

const verifiedBySourceId = new Map(verifiedConversions.map((row) => [row.sourceMapId, row]));
for (const converted of verifiedBySourceId.values()) {
  const row = rowsById.get(converted.sourceMapId);
  if (!row) continue;
  const map = /** @type {Rec} */ (mainById.get(converted.sourceMapId) || {});
  const layer = buildVectorLayer(converted, row, map);
  if (layer) promotedVectorLayers.push(layer);
}

if (INCLUDE_RASTERS) {
  for (const row of rasterRows) {
    const map = /** @type {Rec} */ (mainById.get(row.sourceMapId) || {});
    promotedRasterLayers.push(findRasterTileTemplate(row)
      ? buildRasterTileLayer(row, map)
      : buildRasterImageLayer(row, map));
  }
}

const preAliasLayers = dedupeLayers([...baseLayers, ...promotedVectorLayers, ...promotedRasterLayers])
  .map((layer) => refreshLayerIdentity(layer));
for (const row of aliasRows) {
  const aliasTargetId = row.cloneOf || MANUAL_ALIAS_TARGETS.get(/** @type {string} */ (row.sourceMapId));
  if (!aliasTargetId) continue;
  const target = findLayerForSource(preAliasLayers, aliasTargetId);
  if (!target || target.loadable === false) continue;
  const map = /** @type {Rec} */ (mainById.get(row.sourceMapId) || {});
  promotedAliasLayers.push(buildAliasLayer(row, map, target, aliasTargetId));
}

const layers = dedupeLayers([...preAliasLayers, ...promotedAliasLayers])
  .map((layer) => refreshLayerIdentity(layer));
const categories = mergeCategories(test.categories || [], layers);
const next = {
  ...test,
  categories,
  layers
};

writeArtefactJson(TEST_PATH, next, {
  collection: 'layers',
  idKey: 'id',
  allowDeletions: allowDeletionsFlag(),
  label: 'render/metadata/maps-test.json'
});
syncPortPlan(layers);
console.log(`Promoted ${promotedVectorLayers.length} vector layer(s).`);
console.log(`Promoted ${promotedRasterLayers.length} raster layer(s).`);
console.log(`Promoted ${promotedAliasLayers.length} alias layer(s).`);
console.log(`Wrote ${TEST_PATH.replace(`${ROOT}\\`, '')}`);

/** @param {Rec[]} promotedLayers */
function syncPortPlan(promotedLayers) {
  const bySourceId = new Map(promotedLayers.map((layer) => [layer.sourceMapId, layer]));
  const directSourceIds = new Set(layers.flatMap((layer) => [layer.sourceMapId, layer.id]).filter(Boolean));
  const rows = (plan.rows || []).map((row) => {
    const layer = bySourceId.get(row.sourceMapId);
    if (!layer) {
      const compositeChildIds = convertedCompositeChildIds(row, directSourceIds);
      if (compositeChildIds.length) {
        return {
          ...row,
          conversionStatus: 'convertedComposite',
          recommendedTarget: row.recommendedTarget || 'composite-vector-tiles',
          testLayerId: `composite:${compositeChildIds.join(',')}`,
          unsupportedReason: null
        };
      }
      return row;
    }
    return {
      ...row,
      conversionStatus: layer.aliasOf ? 'convertedAlias' : 'converted',
      recommendedTarget: layer.aliasOf ? 'maplibre-clone-alias' : (row.recommendedTarget || 'mvt-or-pmtiles'),
      testLayerId: layer.id,
      aliasTargetLayerId: layer.aliasTargetLayerId || row.aliasTargetLayerId || null,
      bounds: layer.bounds || row.bounds
    };
  });
  writeFileSync(PLAN_PATH, `${JSON.stringify({ ...plan, totals: summarizeRows(rows), rows }, null, 2)}\n`);
}

/** @returns {Rec[]} */
function buildAliasRows() {
  /** @type {Map<string, Rec>} */
  const rowsBySourceId = new Map();
  for (const row of plan.rows || []) {
    if (row?.sourceMapId && (row.cloneOf || MANUAL_ALIAS_TARGETS.has(row.sourceMapId))) {
      rowsBySourceId.set(row.sourceMapId, row);
    }
  }
  for (const map of main.maps || []) {
    for (const variant of map.variants || []) {
      if (!variant?.id || !variant.cloneOf || rowsBySourceId.has(variant.id)) continue;
      rowsBySourceId.set(variant.id, {
        ...map,
        ...variant,
        sourceMapId: variant.id,
        name: variant.label || variant.name || map.name || variant.id,
        category: variant.category || map.category || 'Maps',
        categoryId: variant.categoryId || map.categoryId || null,
        group: variant.group || map.group || null,
        provider: variant.provider || map.provider || null,
        description: variant.description || map.description || '',
        references: variant.references || map.references || [],
        sourceCredits: variant.sourceCredits || map.sourceCredits || [],
        sourceDownloads: variant.sourceDownloads || [],
        style: variant.style || map.style || {},
        cloneOf: variant.cloneOf
      });
    }
  }
  return [...rowsBySourceId.values()];
}
/** @param {Rec[]} inputLayers */
function dedupeLayers(inputLayers) {
  /** @type {Map<string, Rec>} */
  const byId = new Map();
  /** @type {string[]} */
  const order = [];
  for (const layer of inputLayers) {
    if (!layer?.id) continue;
    if (!byId.has(layer.id)) {
      byId.set(layer.id, layer);
      order.push(layer.id);
      continue;
    }
    byId.set(layer.id, chooseLayerForDuplicate(/** @type {Rec} */ (byId.get(layer.id)), layer));
  }
  return /** @type {Rec[]} */ (order.map((id) => byId.get(id)).filter(Boolean));
}

/** @param {Rec} current @param {Rec} next */
function chooseLayerForDuplicate(current, next) {
  const currentGenerated = isGeneratedLayer(current);
  const nextGenerated = isGeneratedLayer(next);
  if (currentGenerated !== nextGenerated) return currentGenerated ? next : current;
  return next;
}

/** @param {Rec} row @param {Set<string | undefined>} directSourceIds */
function convertedCompositeChildIds(row, directSourceIds) {
  if (row.conversionStatus === 'converted') return [];
  const map = directMainById.get(row.sourceMapId);
  if (!map) return [];
  const candidates = [
    ...(Array.isArray(map.compositeSources) ? map.compositeSources : []),
    ...(Array.isArray(map.variants) ? map.variants.map((variant) => variant.id) : [])
  ].filter(Boolean);
  const uniqueCandidates = unique(candidates);
  if (!uniqueCandidates.length) return [];
  return uniqueCandidates.every((id) => directSourceIds.has(id)) ? uniqueCandidates : [];
}

/** @param {Rec[]} rows */
function summarizeRows(rows) {
  const directConverted = rows.filter((row) => row.conversionStatus === 'converted').length;
  const compositeConverted = rows.filter((row) => row.conversionStatus === 'convertedComposite').length;
  const aliasConverted = rows.filter((row) => row.conversionStatus === 'convertedAlias').length;
  return {
    total: rows.length,
    converted: directConverted + compositeConverted + aliasConverted,
    convertedDirect: directConverted,
    convertedComposite: compositeConverted,
    convertedAlias: aliasConverted,
    needsVectorTileConversion: rows.filter((row) => row.conversionStatus === 'needsVectorTileConversion').length,
    metadataOnly: rows.filter((row) => row.conversionStatus === 'metadataOnly').length,
    needsMapLibreSourceMapping: rows.filter((row) => row.conversionStatus === 'needsMapLibreSourceMapping').length
  };
}

/** @param {Rec[]} inputLayers @param {string} sourceMapId */
function findLayerForSource(inputLayers, sourceMapId) {
  return inputLayers.find((layer) => layer.sourceMapId === sourceMapId && layer.loadable !== false)
    || inputLayers.find((layer) => layer.id === sourceMapId && layer.loadable !== false)
    || inputLayers.find((layer) => layer.id === `${sourceMapId}-vector` && layer.loadable !== false)
    || null;
}

/** @param {Converted} converted @param {Rec} row @param {Rec} map @returns {Rec | null} */
function buildVectorLayer(converted, row, map) {
  const outputDir = converted.outputDirectory.replace(/\\/g, '/');
  const metadataPath = resolve(ROOT, outputDir, 'metadata.json');
  if (!existsSync(metadataPath)) return null;
  /** @type {{ json?: string, bounds?: string, minzoom?: number, maxzoom?: number }} */
  const tileMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const sourceInfo = getSourceInfo(resolve(ROOT, converted.sourceFile.replace(/^\//, '')));
  const parsed = parseTileMetadata(tileMetadata);
  const bounds = parsed.bounds || row.bounds;
  if (!isValidBounds(bounds, row)) return null;
  const fields = parsed.fields || {};
  const labelProperty = chooseProperty([map.labelProperty, 'label_name', 'name', 'NAME', 'Name', 'ENGLISH', 'SETTL_NAME', 'LEA'], fields);
  const labelFallbacks = ['name_en', 'name_ga', 'GAEILGE', 'IRISH', 'COUNTY', 'COUNTYNAME']
    .filter((key) => key !== labelProperty && fields[key]);
  const idProperty = chooseIdProperty(fields, parsed, map, labelProperty);
  const numericProperties = Object.entries(fields)
    .filter(([, type]) => /number|integer|real/i.test(String(type)))
    .map(([key]) => key)
    .slice(0, 16);
  const categoricalValues = parsed.categoricalValues || {};
  const popupProperties = unique([labelProperty, idProperty, ...Object.keys(fields).slice(0, 10)]).filter(Boolean);
  const style = normalizeStyle(row.style || map.style);
  const id = `${row.sourceMapId}-vector`;
  const pmtilesPath = resolve(PMTILES_DIR, `${id}.pmtiles`);
  const pmtiles = existsSync(pmtilesPath) ? {
    url: `/render/pmtiles/generated/${id}.pmtiles`,
    bytes: statSize(pmtilesPath),
    localPath: `render/pmtiles/generated/${id}.pmtiles`
  } : null;
  // SIZE DOES NOT DECIDE THIS ANY MORE. The 95 MB gate dates from when tile assets lived
  // in the repo and GitHub's 100 MB file limit was the binding constraint. PMTiles
  // archives are gitignored and served from R2 over HTTP range requests, which is what
  // the format exists for, so a large archive is not a problem -- but being demoted to
  // 'mvt' is: an mvt layer serves from /render/tiles/generated/..., a path excluded from the
  // Pages deploy, and promotion leaves its tileUrl empty. That is the state
  // tailte-hvd-cadastral-parcels-leasehold has been sitting in, and where the 224 MB
  // tailte-hvd-water-points archive would have landed. switch-pmtiles-to-cdn.mjs
  // keys off the CDN manifest rather than the file size and handles either happily.
  const sourceType = pmtiles ? 'pmtiles' : 'mvt';
  /** @type {Rec} */
  const base = {
    id,
    sourceMapId: row.sourceMapId,
    name: row.name || map.name || row.sourceMapId,
    category: row.category || map.category || 'Maps',
    group: row.group || null,
    date: row.date || map.date || null,
    dateAdded: row.dateAdded || map.dateAdded || null,
    dateEffective: row.dateEffective || map.dateEffective || null,
    provider: row.provider || map.provider || null,
    description: row.description || map.description || '',
    renderer: 'maplibre',
    sourceType,
    geometryType: parsed.geometryType,
    tiles: `/${outputDir}/{z}/{x}/{y}.pbf`,
    tileUrl: sourceType === 'pmtiles' ? /** @type {NonNullable<typeof pmtiles>} */ (pmtiles).url : undefined,
    tilesFallback: sourceType === 'pmtiles' ? `/${outputDir}/{z}/{x}/{y}.pbf` : undefined,
    metadataUrl: `/${outputDir}/metadata.json`,
    sourceLayer: parsed.sourceLayer || converted.sourceLayer,
    promoteId: idProperty || undefined,
    minzoom: Math.max(Number(tileMetadata.minzoom ?? 0), runtimeMinZoom(/** @type {string} */ (row.sourceMapId))),
    maxzoom: Number(tileMetadata.maxzoom ?? 12),
    bounds,
    style,
    references: row.references || map.references || [],
    sourceDownloads: buildSourceDownloads(row, map, converted.sourceFile),
    sourceCredits: row.sourceCredits || creditsFromProvider(row.provider || map.provider),
    keywords: unique([...(map.keywords || []), row.name, row.category, row.group, 'maplibre', 'vector tiles']),
    labelProperty,
    labelPropertyFallbacks: labelFallbacks,
    labelMinZoom: runtimeLabelMinZoom(/** @type {string} */ (row.sourceMapId)),
    labelMaxZoom: null,
    labelStyle: defaultLabelStyle(style.color),
    // Only advertise a feature index that actually exists. Declaring it whenever a
    // labelProperty is present promised 638 indexes the builder had skipped -- it skips
    // layers with no local source file or no label/name property -- so the app would
    // fetch and 404 on every one, and validate-test-app rightly failed them.
    featureIndexUrl: featureIndexUrlIfBuilt(row.sourceMapId, labelProperty),
    sourceFile: converted.sourceFile,
    sourceDatasetLayer: sourceInfo.layerNames[0] || layerNameFromSource(converted.sourceFile),
    idProperty: idProperty || undefined,
    popupProperties,
    numericProperties,
    categoricalProperties: Object.keys(categoricalValues),
    categoricalValues,
    status: 'converted',
    notes: `Generated from ${converted.sourceFile} with GDAL MVT output.`,
    generatedFrom: {
      pipeline: GENERATED_PIPELINE,
      sourceFile: converted.sourceFile,
      bytes: converted.bytes,
      files: converted.files,
      pbfFiles: converted.pbfFiles,
      maxTileBytes: converted.maxTileBytes
    }
  };
  if (pmtiles) {
    base.tilePackage = {
      preferred: sourceType === 'pmtiles',
      localPath: pmtiles.localPath,
      url: pmtiles.url,
      bytes: pmtiles.bytes,
      maxGithubBytes: MAX_GITHUB_BYTES,
      fallback: `/${outputDir}/{z}/{x}/{y}.pbf`
    };
    if (sourceType !== 'pmtiles') {
      base.warning = 'PMTiles archive exceeds Git hosting budget; directory MVT remains preferred.';
    }
  }
  return base;
}

/** @param {Rec} row @param {Rec} map @returns {Rec} */
function buildRasterImageLayer(row, map) {
  const raster = /** @type {{ file: string }} */ (findRasterFile(row));
  const style = normalizeStyle(row.style || map.style);
  return {
    id: `${row.sourceMapId}-image-test`,
    sourceMapId: row.sourceMapId,
    name: row.name || map.name || row.sourceMapId,
    category: row.category || map.category || 'Raster',
    group: row.group || null,
    date: row.date || map.date || null,
    provider: row.provider || map.provider || null,
    description: row.description || map.description || '',
    renderer: 'maplibre',
    sourceType: 'image',
    geometryType: 'raster',
    imageUrl: hostedUrl(raster.file),
    bounds: row.bounds,
    minzoom: 0,
    maxzoom: 16,
    rasterOpacity: Number(map.opacity ?? map.rasterStyle?.opacity ?? 0.78),
    style,
    references: row.references || map.references || [],
    sourceDownloads: buildSourceDownloads(row, map, raster.file),
    sourceCredits: row.sourceCredits || creditsFromProvider(row.provider || map.provider),
    keywords: unique([...(map.keywords || []), row.name, row.category, row.group, 'maplibre', 'raster image']),
    status: 'converted-raster-image',
    notes: `Georeferenced raster image overlay using metadata bounds and hosted image ${hostedUrl(raster.file)}.`,
    generatedFrom: {
      pipeline: RASTER_PIPELINE,
      sourceFile: raster.file
    }
  };
}

/** @param {Rec} row @param {Rec} map @returns {Rec} */
function buildRasterTileLayer(row, map) {
  const raster = /** @type {{ file: string }} */ (findRasterTileTemplate(row));
  const style = normalizeStyle(row.style || map.style);
  const rasterStyle = map.rasterStyle || {};
  return {
    id: `${row.sourceMapId}-raster`,
    sourceMapId: row.sourceMapId,
    name: row.name || map.name || row.sourceMapId,
    category: row.category || map.category || 'Raster',
    group: row.group || null,
    date: row.date || map.date || null,
    provider: row.provider || map.provider || null,
    description: row.description || map.description || '',
    renderer: 'maplibre',
    sourceType: 'raster',
    geometryType: 'raster',
    tiles: hostedUrl(raster.file),
    bounds: row.bounds,
    minzoom: Number(rasterStyle.minZoom ?? 0),
    maxzoom: Number(rasterStyle.maxZoom ?? 20),
    maxNativeZoom: Number(rasterStyle.maxNativeZoom ?? rasterStyle.maxZoom ?? 20),
    tileSize: Number(rasterStyle.tileSize ?? 256),
    rasterOpacity: Number(map.opacity ?? rasterStyle.opacity ?? style.fillOpacity ?? 0.78),
    style,
    references: row.references || map.references || [],
    sourceDownloads: buildSourceDownloads(row, map, raster.file),
    sourceCredits: row.sourceCredits || creditsFromProvider(row.provider || map.provider),
    keywords: unique([...(map.keywords || []), row.name, row.category, row.group, 'maplibre', 'raster tiles']),
    status: 'converted-raster-tiles',
    notes: `Raster XYZ tile layer using metadata bounds and tile template ${hostedUrl(raster.file)}.`,
    generatedFrom: {
      pipeline: RASTER_TILE_PIPELINE,
      sourceFile: raster.file
    }
  };
}

/** @param {Rec} row @param {Rec} map @param {Rec} target @param {string | null | undefined} [aliasTargetId] @returns {Rec} */
function buildAliasLayer(row, map, target, aliasTargetId = row.cloneOf) {
  const cloneTargetId = row.cloneOf || aliasTargetId || null;
  const style = normalizeStyle(row.style || map.style || target.style);
  const references = (row.references || []).length ? row.references : (target.references || []);
  const sourceDownloads = (row.sourceDownloads || []).length ? row.sourceDownloads : (target.sourceDownloads || []);
  const sourceCredits = (row.sourceCredits || []).length
    ? row.sourceCredits
    : (target.sourceCredits || creditsFromProvider(row.provider || map.provider || target.provider));
  return {
    ...target,
    id: `${row.sourceMapId}-alias`,
    sourceMapId: row.sourceMapId,
    name: row.name || map.name || row.sourceMapId,
    category: row.category || target.category || map.category || 'Maps',
    categoryId: row.categoryId || target.categoryId || null,
    group: row.group || target.group || null,
    date: row.date || map.date || target.date || null,
    dateAdded: row.dateAdded || target.dateAdded || null,
    dateEffective: row.dateEffective || target.dateEffective || null,
    provider: row.provider || map.provider || target.provider || null,
    description: row.description || map.description || map.note || target.description || '',
    style,
    labelStyle: {
      ...(target.labelStyle || {}),
      color: style.color || target.labelStyle?.color || target.style?.color
    },
    references,
    sourceDownloads,
    sourceCredits,
    keywords: unique([
      ...(target.keywords || []),
      ...(map.keywords || []),
      row.name,
      row.category,
      row.group,
      row.sourceMapId,
      aliasTargetId,
      'maplibre',
      'clone alias'
    ]),
    status: 'converted-alias',
    conversionStatus: 'convertedAlias',
    aliasOf: aliasTargetId,
    cloneOf: cloneTargetId,
    aliasTargetLayerId: target.id,
    notes: `${row.name || row.sourceMapId} reuses the converted geometry from ${target.name || aliasTargetId}.`,
    generatedFrom: {
      pipeline: ALIAS_PIPELINE,
      sourceMapId: row.sourceMapId,
      cloneOf: cloneTargetId,
      aliasOf: aliasTargetId,
      targetLayerId: target.id
    }
  };
}

/** @param {Rec} layer @returns {Rec} */
function refreshLayerIdentity(layer) {
  layer = refreshLayerCatalogueMetadata(layer);
  if (!layer || RASTER_SOURCE_TYPES.includes(/** @type {string} */ (layer.sourceType))) return layer;
  if (layer.promoteId && layer.idProperty) return layer;
  const metadataPath = localMetadataPath(layer.metadataUrl);
  if (!metadataPath || !existsSync(metadataPath)) return layer;
  const map = /** @type {Rec} */ (mainById.get(layer.sourceMapId) || {});
  const parsed = parseTileMetadata(JSON.parse(readFileSync(metadataPath, 'utf8')));
  const fields = parsed.fields || {};
  const labelProperty = layer.labelProperty || chooseProperty([map.labelProperty, 'label_name', 'name', 'NAME', 'Name', 'ENGLISH', 'SETTL_NAME', 'LEA'], fields);
  const idProperty = chooseIdProperty(fields, parsed, map, labelProperty);
  if (!idProperty) return layer;
  return {
    ...layer,
    promoteId: layer.promoteId || idProperty,
    idProperty: layer.idProperty || idProperty,
    popupProperties: unique([labelProperty, idProperty, ...(layer.popupProperties || [])]).filter(Boolean)
  };
}

/** @param {Rec} layer @returns {Rec} */
function refreshLayerCatalogueMetadata(layer) {
  if (!layer) return layer;
  const map = mainById.get(layer.sourceMapId || layer.id);
  if (!map) return layer;
  const provider = map.provider !== undefined ? map.provider : layer.provider;
  const references = map.references !== undefined ? map.references : layer.references;
  const sourceCredits = map.sourceCredits !== undefined
    ? map.sourceCredits
    : creditsFromProvider(provider || layer.provider);
  return {
    ...layer,
    provider: provider || null,
    references: references || [],
    sourceCredits: sourceCredits || []
  };
}

/** @param {string | undefined} metadataUrl */
function localMetadataPath(metadataUrl) {
  if (!metadataUrl || /^https?:\/\//i.test(metadataUrl)) return null;
  return resolve(ROOT, String(metadataUrl).replace(/^\//, ''));
}

/** @param {{ json?: string, bounds?: string }} metadata */
function parseTileMetadata(metadata) {
  /** @type {{ vector_layers?: Array<{ id?: string, fields?: Record<string, string> }>, tilestats?: { layers?: TilestatsLayer[] } }} */
  let json = {};
  try {
    json = JSON.parse(metadata.json || '{}');
  } catch {
    json = {};
  }
  const vectorLayer = /** @type {{ id?: string, fields?: Record<string, string> }} */ (json.vector_layers?.[0] || {});
  const tilestatsLayer = /** @type {TilestatsLayer} */ (json.tilestats?.layers?.[0] || {});
  return {
    sourceLayer: vectorLayer.id,
    fields: vectorLayer.fields || {},
    geometryType: geometryTypeFromTileStats(tilestatsLayer.geometry),
    bounds: boundsFromMetadata(metadata.bounds),
    uniqueProperties: uniquePropertiesFromTilestats(tilestatsLayer),
    categoricalValues: categoricalValuesFromTilestats(tilestatsLayer)
  };
}

/** @param {Record<string, string>} fields @param {TileInfo} parsed @param {Rec} map @param {string | null | undefined} labelProperty */
function chooseIdProperty(fields, parsed, map, labelProperty) {
  const uniqueProperties = parsed.uniqueProperties || [];
  const explicitCandidates = [
    map.idProperty,
    map.promoteId,
    'id',
    'ID',
    'OBJECTID',
    'OBJECTID_1',
    'ObjectId',
    'objectid',
    'FID',
    'fid',
    'ogc_fid',
    'GUID',
    'GlobalID',
    'Code',
    'CODE',
    'GEOGID',
    'GEOG_ID',
    'ED_ID',
    'LEA_ID',
    'WARD93_ID',
    'SOA_CODE',
    'SA2011',
    'OA_CODE',
    'SMALL_AREA',
    // Last resort: build-test-pmtiles.mjs injects civ_fid (= source FID) into
    // every polygon/line vector tile, so it is always present and unique per
    // feature. Ranked last so a natural id wins, but guarantees no tiled
    // polygon/line layer is left without a promoteId (the split-feature bug).
    'civ_fid'
  ].filter(Boolean);
  const explicit = chooseProperty(explicitCandidates, fields);
  if (explicit) return explicit;

  const uniqueIdLike = uniqueProperties.find((key) => fields[key] && isIdLikeProperty(key));
  if (uniqueIdLike) return uniqueIdLike;

  if (labelProperty && fields[labelProperty] && uniqueProperties.includes(labelProperty)) return labelProperty;

  return uniqueProperties.find((key) => fields[key] && !isWeakIdentityProperty(key)) || null;
}

/** @param {TilestatsLayer} layer */
function uniquePropertiesFromTilestats(layer) {
  const featureCount = Number(layer?.count);
  if (!Number.isFinite(featureCount) || featureCount <= 0) return [];
  return (layer.attributes || [])
    .filter((attribute) => Number(attribute.count) === featureCount)
    .map((attribute) => attribute.attribute)
    .filter(Boolean);
}

/** @param {string} key */
function isIdLikeProperty(key) {
  return /(^|[\s_-])(id|code|ref|reference|fid|guid|objectid|geogid)($|[\s_-])/i.test(String(key))
    || /^(id|code|fid|guid|objectid|geogid)$/i.test(String(key));
}

/** @param {string} key */
function isWeakIdentityProperty(key) {
  return /^(area|shape|length|perimeter|hectares|latitude|longitude|easting|northing|min|max|mean|x_|y_)/i.test(String(key));
}

/** @param {TilestatsLayer} layer */
function categoricalValuesFromTilestats(layer) {
  /** @type {Record<string, unknown[]>} */
  const output = {};
  for (const attribute of layer.attributes || []) {
    if (attribute.type !== 'string' || !Array.isArray(attribute.values)) continue;
    output[attribute.attribute] = attribute.values.slice(0, 32);
  }
  return output;
}

/** @param {string | undefined} value */
function geometryTypeFromTileStats(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('point')) return 'point';
  if (text.includes('line')) return 'line';
  return 'polygon';
}

/** @param {string | undefined} value */
function boundsFromMetadata(value) {
  const parts = String(value || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = /** @type {[number, number, number, number]} */ (parts);
  return [[south, west], [north, east]];
}

/** @param {Style} [style] */
function normalizeStyle(style = {}) {
  return {
    color: style.color || '#4F46E5',
    fillColor: style.fillColor || style.color || '#818CF8',
    fillOpacity: Number(style.fillOpacity ?? 0.18),
    weight: Number(style.weight ?? 1.5)
  };
}

/** @param {string} color */
function defaultLabelStyle(color) {
  return {
    color: color || '#111827',
    hoverColor: '#ff7a1a',
    selectedColor: '#111827',
    haloColor: '#ffffff',
    haloWidth: 1.2,
    haloBlur: 0,
    fontSize: 12,
    fontWeight: 'bold',
    maxWidth: 14,
    lineHeight: 1.25
  };
}

/** @param {Rec} row @param {Rec} map @param {string} sourceFile */
function buildSourceDownloads(row, map, sourceFile) {
  const downloads = [...(row.sourceDownloads || []), ...(map.sourceDownloads || [])];
  downloads.unshift({ label: 'Source file used for /test conversion', file: sourceFile });
  return downloads.filter((item, index, all) => {
    const key = item.file || item.url || item.label;
    return key && all.findIndex((candidate) => (candidate.file || candidate.url || candidate.label) === key) === index;
  });
}

/** @param {Category[]} existing @param {Rec[]} layers */
function mergeCategories(existing, layers) {
  const categories = new Map(existing.map((category) => [category.id || slugify(category.name), category]));
  for (const layer of layers) {
    const known = [...categories.values()].find((category) => category.name === layer.category || category.id === layer.category);
    if (known) continue;
    const mainCategory = [...categoriesById.entries()].find(([, category]) => category.name === layer.category)?.[1];
    const id = mainCategory?.id || slugify(layer.category);
    categories.set(id, {
      id,
      name: mainCategory?.name || layer.category,
      group: mainCategory?.group || layer.group || 'Maps',
      description: mainCategory?.description || ''
    });
  }
  return [...categories.values()];
}

/**
 * The zoom a layer's source starts at. The DfI road surface defect years were held to 10
 * here because their full-record low-zoom tiles were 8-11 MB; that left them blank at
 * every zoom the map opens them at (Phelim's catalogue review, #49). Their archives now
 * carry only their categorical fields below z10 (tile-profiles.mjs), so they start at 0
 * like every other point layer, and only their labels wait for z10 (runtimeLabelMinZoom).
 * The DAERA agricultural critical risk areas and DCC's protected cycle infrastructure were
 * held to 10 the same way, and drew nothing at the zoom they open at; their archives are
 * rebuilt from z0 (tile-profiles.mjs) and they start at 0 too.
 * transport-carriageway-defects-2021 stays at 10: it is hidden as a copy of the 2021 year.
 * @param {string} sourceMapId
 * @returns {number}
 */
function runtimeMinZoom(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id.includes('transport-carriageway-defects')) return 10;
  if (id.includes('habitat-woodland-grouped') || id.includes('habitat-river')) return 8;
  return 0;
}

/**
 * The zoom a layer's labels start at: its source's, except where the label is an
 * identifier on every feature and stays at z10, where it always drew: the DfI road
 * surface defect years (a works reference on each of 94,000-216,000 points) and the
 * protected cycle infrastructure (a segment id such as ID_00398).
 * @param {string} sourceMapId
 * @returns {number}
 */
function runtimeLabelMinZoom(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id.includes('dfi-surface-defects') || id.includes('existing-protected-cycle-infrastructure')) return 10;
  return runtimeMinZoom(sourceMapId);
}

/** @param {Rec} layer */
function isGeneratedLayer(layer) {
  return layer.generatedFrom?.pipeline === GENERATED_PIPELINE
    || layer.generatedFrom?.pipeline === RASTER_PIPELINE
    || layer.generatedFrom?.pipeline === RASTER_TILE_PIPELINE
    || layer.generatedFrom?.pipeline === ALIAS_PIPELINE;
}

/** @param {Rec} row */
function findRasterFile(row) {
  return (row.sourceFiles || []).find((source) => /\.(png|jpe?g|webp)$/i.test(source.file || '')) || null;
}

/** @param {Rec} row */
function findRasterTileTemplate(row) {
  return (row.sourceFiles || []).find((source) => {
    const file = source.file || '';
    return /\{z\}.*\{x\}.*\{y\}/i.test(file) && /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(file);
  }) || null;
}



/** @param {Array<string | null | undefined>} candidates @param {Record<string, string>} fields */
function chooseProperty(candidates, fields) {
  return candidates.find((candidate) => candidate && fields[candidate]) || null;
}

/** @param {string} source */
function layerNameFromSource(source) {
  return basename(source).replace(extname(source), '');
}

/** @param {string} sourcePath @returns {{ layerNames: string[] }} */
function getSourceInfo(sourcePath) {
  const result = spawnSync('ogrinfo', ['-json', '-so', sourcePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) return { layerNames: [] };
  try {
    const payload = JSON.parse(result.stdout);
    return { layerNames: (payload.layers || []).map((/** @type {{ name?: string }} */ layer) => layer.name).filter(Boolean) };
  } catch {
    return { layerNames: [] };
  }
}

/** @param {unknown} provider */
function creditsFromProvider(provider) {
  if (Array.isArray(provider)) return provider.map(String).filter(Boolean);
  return provider ? [String(provider)] : [];
}

/** @param {string} file */
function hostedUrl(file) {
  if (/^https?:\/\//i.test(file)) return file;
  return `${DATA_HOST}/${file.replace(/^\/+/, '').replace(/\\/g, '/')}`;
}

/** @param {string} path */
function statSize(path) {
  try {
    return Number(statSync(path).size || 0);
  } catch {
    return 0;
  }
}

/** @param {string} name @param {number} fallback */
function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/** @param {unknown} value */
function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'maps';
}

/** @param {string | undefined} sourceMapId @param {string | null} labelProperty */
function featureIndexUrlIfBuilt(sourceMapId, labelProperty) {
  if (!labelProperty) return undefined;
  const rel = `/render/metadata/feature-indexes/${sourceMapId}-vector.json`;
  return existsSync(resolve(ROOT, rel.replace(/^\//, ''))) ? rel : undefined;
}
