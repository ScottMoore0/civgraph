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

const ROOT = resolve(process.cwd());
const MAIN_PATH = resolve(ROOT, 'data/database/maps.json');
const PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/vector-conversion-report.json');
const TEST_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const PMTILES_DIR = resolve(ROOT, 'test/pmtiles/generated');
const MAX_GITHUB_BYTES = 95 * 1024 * 1024;
const DATA_HOST = 'https://data.civgraph.net';
const INCLUDE_RASTERS = !process.argv.includes('--no-rasters');
const RASTER_LIMIT = readNumberArg('--raster-limit', Infinity);
const GENERATED_PIPELINE = 'build-test-vector-batch';
const RASTER_PIPELINE = 'promote-test-raster-image';

const main = JSON.parse(readFileSync(MAIN_PATH, 'utf8'));
const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
const test = JSON.parse(readFileSync(TEST_PATH, 'utf8'));
const verifiedConversions = [...(report.skippedExisting || []), ...(report.converted || [])];
const verifiedSourceIds = new Set(verifiedConversions.map((row) => row.sourceMapId));

const mainById = new Map((main.maps || []).map((map) => [map.id, map]));
for (const map of main.maps || []) {
  for (const variant of map.variants || []) {
    mainById.set(variant.id, { ...map, ...variant, parentId: map.id, parentName: map.name });
  }
}
const categoriesById = new Map((main.categories || []).map((category) => [category.id, category]));
const rowsById = new Map((plan.rows || []).map((row) => [row.sourceMapId, row]));

const baseLayers = (test.layers || []).filter((layer) => !isGeneratedLayer(layer) || !verifiedSourceIds.has(layer.sourceMapId));
const promotedVectorLayers = [];
const promotedRasterLayers = [];

const verifiedBySourceId = new Map(verifiedConversions.map((row) => [row.sourceMapId, row]));
for (const converted of verifiedBySourceId.values()) {
  const row = rowsById.get(converted.sourceMapId);
  if (!row) continue;
  const map = mainById.get(converted.sourceMapId) || {};
  const layer = buildVectorLayer(converted, row, map);
  if (layer) promotedVectorLayers.push(layer);
}

if (INCLUDE_RASTERS) {
  const rasterRows = (plan.rows || [])
    .filter((row) => isValidBounds(row.bounds, row))
    .filter((row) => findRasterFile(row))
    .slice(0, RASTER_LIMIT);
  for (const row of rasterRows) {
    const map = mainById.get(row.sourceMapId) || {};
    promotedRasterLayers.push(buildRasterImageLayer(row, map));
  }
}

const layers = [...baseLayers, ...promotedVectorLayers, ...promotedRasterLayers];
const categories = mergeCategories(test.categories || [], layers);
const next = {
  ...test,
  categories,
  layers
};

writeFileSync(TEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
syncPortPlan(promotedVectorLayers);
console.log(`Promoted ${promotedVectorLayers.length} vector layer(s).`);
console.log(`Promoted ${promotedRasterLayers.length} raster image layer(s).`);
console.log(`Wrote ${TEST_PATH.replace(`${ROOT}\\`, '')}`);

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
      conversionStatus: 'converted',
      recommendedTarget: row.recommendedTarget || 'mvt-or-pmtiles',
      testLayerId: layer.id,
      bounds: layer.bounds || row.bounds
    };
  });
  writeFileSync(PLAN_PATH, `${JSON.stringify({ ...plan, totals: summarizeRows(rows), rows }, null, 2)}\n`);
}

function convertedCompositeChildIds(row, directSourceIds) {
  if (row.conversionStatus === 'converted') return [];
  const map = mainById.get(row.sourceMapId);
  if (!map) return [];
  const candidates = [
    ...(Array.isArray(map.compositeSources) ? map.compositeSources : []),
    ...(!map.isGroup && Array.isArray(map.variants) ? map.variants.map((variant) => variant.id) : [])
  ].filter(Boolean);
  const uniqueCandidates = unique(candidates);
  if (!uniqueCandidates.length) return [];
  return uniqueCandidates.every((id) => directSourceIds.has(id)) ? uniqueCandidates : [];
}

function summarizeRows(rows) {
  const directConverted = rows.filter((row) => row.conversionStatus === 'converted').length;
  const compositeConverted = rows.filter((row) => row.conversionStatus === 'convertedComposite').length;
  return {
    total: rows.length,
    converted: directConverted + compositeConverted,
    convertedDirect: directConverted,
    convertedComposite: compositeConverted,
    needsVectorTileConversion: rows.filter((row) => row.conversionStatus === 'needsVectorTileConversion').length,
    metadataOnly: rows.filter((row) => row.conversionStatus === 'metadataOnly').length
  };
}

function buildVectorLayer(converted, row, map) {
  const outputDir = converted.outputDirectory.replace(/\\/g, '/');
  const metadataPath = resolve(ROOT, outputDir, 'metadata.json');
  if (!existsSync(metadataPath)) return null;
  const tileMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const sourceInfo = getSourceInfo(resolve(ROOT, converted.sourceFile.replace(/^\//, '')));
  const parsed = parseTileMetadata(tileMetadata);
  const bounds = parsed.bounds || row.bounds;
  if (!isValidBounds(bounds, row)) return null;
  const fields = parsed.fields || {};
  const labelProperty = chooseProperty([map.labelProperty, 'label_name', 'name', 'NAME', 'Name', 'ENGLISH', 'SETTL_NAME', 'LEA'], fields);
  const labelFallbacks = ['name_en', 'name_ga', 'GAEILGE', 'IRISH', 'COUNTY', 'COUNTYNAME']
    .filter((key) => key !== labelProperty && fields[key]);
  const idProperty = chooseProperty(['id', 'ID', 'OBJECTID', 'OBJECTID_1', 'FID', 'fid', 'ED_ID', 'GUID', 'SMALL_AREA'], fields);
  const numericProperties = Object.entries(fields)
    .filter(([, type]) => /number|integer|real/i.test(String(type)))
    .map(([key]) => key)
    .slice(0, 16);
  const categoricalValues = parsed.categoricalValues || {};
  const popupProperties = unique([labelProperty, idProperty, ...Object.keys(fields).slice(0, 10)]).filter(Boolean);
  const style = normalizeStyle(row.style || map.style);
  const id = `${row.sourceMapId}-vector-test`;
  const pmtilesPath = resolve(PMTILES_DIR, `${id}.pmtiles`);
  const pmtiles = existsSync(pmtilesPath) ? {
    url: `/test/pmtiles/generated/${id}.pmtiles`,
    bytes: statSize(pmtilesPath),
    localPath: `test/pmtiles/generated/${id}.pmtiles`
  } : null;
  const sourceType = pmtiles && pmtiles.bytes < MAX_GITHUB_BYTES ? 'pmtiles' : 'mvt';
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
    tileUrl: sourceType === 'pmtiles' ? pmtiles.url : undefined,
    tilesFallback: sourceType === 'pmtiles' ? `/${outputDir}/{z}/{x}/{y}.pbf` : undefined,
    metadataUrl: `/${outputDir}/metadata.json`,
    sourceLayer: parsed.sourceLayer || converted.sourceLayer,
    promoteId: idProperty || undefined,
    minzoom: Math.max(Number(tileMetadata.minzoom ?? 0), runtimeMinZoom(row.sourceMapId)),
    maxzoom: Number(tileMetadata.maxzoom ?? 12),
    bounds,
    style,
    references: row.references || map.references || [],
    sourceDownloads: buildSourceDownloads(row, map, converted.sourceFile),
    sourceCredits: row.sourceCredits || creditsFromProvider(row.provider || map.provider),
    keywords: unique([...(map.keywords || []), row.name, row.category, row.group, 'maplibre', 'vector tiles']),
    labelProperty,
    labelPropertyFallbacks: labelFallbacks,
    labelMinZoom: runtimeMinZoom(row.sourceMapId),
    labelMaxZoom: null,
    labelStyle: defaultLabelStyle(style.color),
    featureIndexUrl: labelProperty ? `/test/metadata/feature-indexes/${row.sourceMapId}-vector-test.json` : undefined,
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

function buildRasterImageLayer(row, map) {
  const raster = findRasterFile(row);
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

function parseTileMetadata(metadata) {
  let json = {};
  try {
    json = JSON.parse(metadata.json || '{}');
  } catch {
    json = {};
  }
  const vectorLayer = json.vector_layers?.[0] || {};
  const tilestatsLayer = json.tilestats?.layers?.[0] || {};
  return {
    sourceLayer: vectorLayer.id,
    fields: vectorLayer.fields || {},
    geometryType: geometryTypeFromTileStats(tilestatsLayer.geometry),
    bounds: boundsFromMetadata(metadata.bounds),
    categoricalValues: categoricalValuesFromTilestats(tilestatsLayer)
  };
}

function categoricalValuesFromTilestats(layer) {
  const output = {};
  for (const attribute of layer.attributes || []) {
    if (attribute.type !== 'string' || !Array.isArray(attribute.values)) continue;
    output[attribute.attribute] = attribute.values.slice(0, 32);
  }
  return output;
}

function geometryTypeFromTileStats(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('point')) return 'point';
  if (text.includes('line')) return 'line';
  return 'polygon';
}

function boundsFromMetadata(value) {
  const parts = String(value || '').split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = parts;
  return [[south, west], [north, east]];
}

function normalizeStyle(style = {}) {
  return {
    color: style.color || '#4F46E5',
    fillColor: style.fillColor || style.color || '#818CF8',
    fillOpacity: Number(style.fillOpacity ?? 0.18),
    weight: Number(style.weight ?? 1.5)
  };
}

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

function buildSourceDownloads(row, map, sourceFile) {
  const downloads = [...(row.sourceDownloads || []), ...(map.sourceDownloads || [])];
  downloads.unshift({ label: 'Source file used for /test conversion', file: sourceFile });
  return downloads.filter((item, index, all) => {
    const key = item.file || item.url || item.label;
    return key && all.findIndex((candidate) => (candidate.file || candidate.url || candidate.label) === key) === index;
  });
}

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

function runtimeMinZoom(sourceMapId) {
  const id = String(sourceMapId || '').toLowerCase();
  if (id.includes('dfi-surface-defects')
    || id.includes('transport-carriageway-defects')
    || id.includes('agricultural-critical-risk')
    || id.includes('existing-protected-cycle-infrastructure')) {
    return 10;
  }
  if (id.includes('habitat-woodland-grouped') || id.includes('habitat-river')) return 8;
  return 0;
}

function isGeneratedLayer(layer) {
  return layer.generatedFrom?.pipeline === GENERATED_PIPELINE || layer.generatedFrom?.pipeline === RASTER_PIPELINE;
}

function findRasterFile(row) {
  return (row.sourceFiles || []).find((source) => /\.(png|jpe?g|webp)$/i.test(source.file || '')) || null;
}

function isValidBounds(bounds, row = null) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return false;
  const [[south, west], [north, east]] = bounds;
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) return false;
  const nearNullIsland = Math.max(Math.abs(south), Math.abs(west), Math.abs(north), Math.abs(east)) < 1;
  if (nearNullIsland) return false;
  if (row?.sourceMapId === 'britain-ireland-seas') {
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

function chooseProperty(candidates, fields) {
  return candidates.find((candidate) => candidate && fields[candidate]) || null;
}

function layerNameFromSource(source) {
  return basename(source).replace(extname(source), '');
}

function getSourceInfo(sourcePath) {
  const result = spawnSync('ogrinfo', ['-json', '-so', sourcePath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) return { layerNames: [] };
  try {
    const payload = JSON.parse(result.stdout);
    return { layerNames: (payload.layers || []).map((layer) => layer.name).filter(Boolean) };
  } catch {
    return { layerNames: [] };
  }
}

function creditsFromProvider(provider) {
  if (Array.isArray(provider)) return provider.map(String).filter(Boolean);
  return provider ? [String(provider)] : [];
}

function hostedUrl(file) {
  if (/^https?:\/\//i.test(file)) return file;
  return `${DATA_HOST}/${file.replace(/^\/+/, '').replace(/\\/g, '/')}`;
}

function statSize(path) {
  try {
    return Number(statSync(path).size || 0);
  } catch {
    return 0;
  }
}

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'maps';
}
