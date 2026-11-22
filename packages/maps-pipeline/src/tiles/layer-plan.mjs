#!/usr/bin/env node
/**
 * Build a deterministic migration inventory from the main Leaflet/static
 * catalogue to the isolated /test MapLibre/vector-tile catalogue.
 *
 * This is intentionally a plan artifact, not a blind converter: most main-site
 * entries still need tile generation before they should become live /test
 * layers.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const MAIN_METADATA_PATH = 'data/database/maps.json';
const TEST_METADATA_PATH = 'render/metadata/maps-test.json';
const OUTPUT_PATH = 'render/metadata/main-site-port-plan.json';
const MANUAL_ALIAS_TARGETS = new Map([
  // The main catalogue still exposes the older NI-only civil-parishes variant.
  // /test2 intentionally loads the unified civil-parishes PMTiles layer for
  // this catalogue route, matching the post-Leaflet performance strategy.
  ['civil-parishes', 'civil-parishes-by-province']
]);

/** @typedef {{ color?: string, fillColor?: string, fillOpacity?: number, weight?: number }} Style */
/**
 * A catalogue entry of maps.json (or one of its variants, merged over it), as far as the plan reads it.
 * @typedef {{ id: string, name?: string, label?: string, cloneOf?: string, parentId?: string, parentName?: string | undefined,
 *   category?: string, group?: string, date?: string, dateAdded?: string, dateEffective?: string,
 *   provider?: string | string[], description?: string, note?: string, style?: Style, references?: unknown,
 *   sourceDownloads?: unknown, osniDownloads?: unknown, variants?: MainMap[], placeholder?: boolean, hidden?: boolean,
 *   compositeSources?: string[], files?: Record<string, unknown>, downloads?: Record<string, unknown>,
 *   tileUrl?: string, isGroup?: boolean, bounds?: unknown }} MainMap
 */
/** @typedef {{ id: string, sourceMapId?: string, aliasOf?: string, aliasTargetLayerId?: string, bounds?: unknown }} TestLayer */
/** @typedef {{ kind: string, file: string }} SourceFile */
/** @type {{ maps?: MainMap[], categories?: Array<{ id: string, name?: string, group?: string }> }} */
const main = JSON.parse(readFileSync(MAIN_METADATA_PATH, 'utf8'));
/** @type {{ layers?: TestLayer[] }} */
const test = JSON.parse(readFileSync(TEST_METADATA_PATH, 'utf8'));
const convertedBySource = new Map((test.layers || []).map((layer) => [layer.sourceMapId || layer.id, layer]));
const convertedById = new Map((test.layers || []).map((layer) => [layer.id, layer]));
const convertedSourceIds = new Set((test.layers || [])
  .flatMap((layer) => [layer.sourceMapId, layer.id])
  .filter(Boolean));
const categories = new Map((main.categories || []).map((category) => [category.id, category]));
/** @type {Array<ReturnType<typeof buildRow>>} */
const rows = [];

for (const map of main.maps || []) {
  rows.push(buildRow(map, null));
  for (const variant of map.variants || []) {
    rows.push(buildRow({ ...map, ...variant, parentId: map.id, parentName: map.name }, map));
  }
}

const totals = summarizeRows(rows);

const payload = {
  schemaVersion: 1,
  source: MAIN_METADATA_PATH,
  testMetadata: TEST_METADATA_PATH,
  totals,
  rows
};

mkdirSync('render/metadata', { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Rows: ${rows.length}`);
console.log(`Converted: ${totals.converted || 0}`);
console.log(`- direct: ${totals.convertedDirect || 0}`);
console.log(`- composite: ${totals.convertedComposite || 0}`);
console.log(`- alias: ${totals.convertedAlias || 0}`);
console.log(`Needs vector tiles: ${totals.needsVectorTileConversion || 0}`);
console.log(`Needs raster strategy: ${totals.needsRasterStrategy || 0}`);
console.log(`Metadata only: ${totals.metadataOnly || 0}`);

/** @param {MainMap} map @param {MainMap | null} parent */
function buildRow(map, parent) {
  const converted = convertedBySource.get(map.id) || convertedById.get(map.id);
  const cloneTarget = map.cloneOf ? (convertedBySource.get(map.cloneOf) || convertedById.get(map.cloneOf)) : null;
  const manualAliasTargetId = MANUAL_ALIAS_TARGETS.get(map.id) || null;
  const manualAliasTarget = manualAliasTargetId
    ? (convertedBySource.get(manualAliasTargetId) || convertedById.get(manualAliasTargetId))
    : null;
  const compositeChildIds = !parent ? convertedCompositeChildIds(map) : [];
  const category = categories.get(/** @type {string} */ (map.category)) || /** @type {{ name?: string, group?: string }} */ ({});
  const sourceFiles = collectSourceFiles(map);
  const conversionStatus = converted
    ? (converted.aliasOf ? 'convertedAlias' : 'converted')
    : (cloneTarget || manualAliasTarget)
      ? 'convertedAlias'
      : compositeChildIds.length
        ? 'convertedComposite'
    : classifyConversionStatus(map, sourceFiles);

  return {
    sourceMapId: map.id,
    cloneOf: map.cloneOf || null,
    parentId: map.parentId || parent?.id || null,
    name: map.name || map.label || map.id,
    category: category.name || map.category || null,
    categoryId: map.category || null,
    group: category.group || map.group || null,
    date: map.date || null,
    dateAdded: map.dateAdded || parent?.dateAdded || null,
    dateEffective: map.dateEffective || parent?.dateEffective || null,
    provider: map.provider || parent?.provider || null,
    description: map.description || map.note || parent?.description || parent?.note || null,
    sourceCredits: summarizeCredits(map, parent),
    conversionStatus,
    recommendedTarget: converted || cloneTarget || manualAliasTarget
      ? (converted?.aliasOf || cloneTarget || manualAliasTarget ? 'maplibre-clone-alias' : recommendedTarget(map, sourceFiles))
      : compositeChildIds.length
        ? 'composite-vector-tiles'
        : recommendedTarget(map, sourceFiles),
    testLayerId: converted?.id
      || (cloneTarget || manualAliasTarget ? `${map.id}-alias` : null)
      || (compositeChildIds.length ? `composite:${compositeChildIds.join(',')}` : null),
    aliasTargetLayerId: converted?.aliasTargetLayerId || cloneTarget?.id || manualAliasTarget?.id || null,
    bounds: map.bounds || parent?.bounds || converted?.bounds || cloneTarget?.bounds || manualAliasTarget?.bounds || null,
    style: summarizeStyle(map.style || parent?.style),
    sourceFiles,
    references: summarizeLinks(map.references || parent?.references),
    sourceDownloads: summarizeLinks(map.sourceDownloads || parent?.sourceDownloads || map.osniDownloads || parent?.osniDownloads),
    variants: Array.isArray(map.variants) ? map.variants.length : 0,
    unsupportedReason: converted || cloneTarget || manualAliasTarget || compositeChildIds.length ? null : unsupportedReason(map, sourceFiles)
  };
}

/** @param {MainMap} map @returns {string[]} */
function convertedCompositeChildIds(map) {
  const candidates = [
    ...(Array.isArray(map.compositeSources) ? map.compositeSources : []),
    ...(Array.isArray(map.variants)
      ? map.variants.filter((variant) => !variant.placeholder).map((variant) => variant.id)
      : [])
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  if (!uniqueCandidates.length) return [];
  return uniqueCandidates.every((id) => convertedSourceIds.has(id)) ? uniqueCandidates : [];
}

/** @param {Array<{ conversionStatus: string }>} inputRows */
function summarizeRows(inputRows) {
  const directConverted = inputRows.filter((row) => row.conversionStatus === 'converted').length;
  const compositeConverted = inputRows.filter((row) => row.conversionStatus === 'convertedComposite').length;
  const aliasConverted = inputRows.filter((row) => row.conversionStatus === 'convertedAlias').length;
  return {
    total: inputRows.length,
    converted: directConverted + compositeConverted + aliasConverted,
    convertedDirect: directConverted,
    convertedComposite: compositeConverted,
    convertedAlias: aliasConverted,
    needsVectorTileConversion: inputRows.filter((row) => row.conversionStatus === 'needsVectorTileConversion').length,
    needsRasterStrategy: inputRows.filter((row) => row.conversionStatus === 'needsRasterStrategy').length,
    metadataOnly: inputRows.filter((row) => row.conversionStatus === 'metadataOnly').length,
    needsMapLibreSourceMapping: inputRows.filter((row) => row.conversionStatus === 'needsMapLibreSourceMapping').length
  };
}

/** @param {MainMap} map */
function collectSourceFiles(map) {
  /** @type {SourceFile[]} */
  const files = [];
  for (const [kind, value] of Object.entries(map.files || {})) {
    if (typeof value === 'string') files.push({ kind, file: value });
  }
  for (const [kind, value] of Object.entries(map.downloads || {})) {
    if (typeof value === 'string') files.push({ kind, file: value });
  }
  if (map.tileUrl) files.push({ kind: 'tileUrl', file: map.tileUrl });
  return files;
}

/**
 * A row's conversion status: derived from the catalogue entry, never moved between (R7: a derived kind).
 * @typedef {'converted' | 'convertedAlias' | 'convertedComposite' | 'needsVectorTileConversion' | 'needsRasterStrategy'
 *   | 'needsMapLibreSourceMapping' | 'metadataOnly'} ConversionStatus
 */
/** @param {MainMap} map @param {SourceFile[]} sourceFiles @returns {ConversionStatus} */
function classifyConversionStatus(map, sourceFiles) {
  if (map.isGroup && !sourceFiles.length) return 'metadataOnly';
  // A map the site does not draw (to be added, or hidden with its layer withheld) waits for no tiles.
  if (map.placeholder || map.hidden) return 'metadataOnly';
  if (sourceFiles.some((entry) => /\.(png|jpe?g|webp|tif|tiff)$/i.test(entry.file))) return 'needsRasterStrategy';
  if (sourceFiles.some((entry) => /\.(fgb|geojson|json|shp|gpkg)$/i.test(entry.file))) return 'needsVectorTileConversion';
  if (map.tileUrl || sourceFiles.some((entry) => isTileTemplate(entry.file) || /\/tiles?\//i.test(entry.file))) return 'needsMapLibreSourceMapping';
  return 'metadataOnly';
}

/** @param {MainMap} map @param {SourceFile[]} sourceFiles */
function recommendedTarget(map, sourceFiles) {
  if (map.tileUrl || sourceFiles.some((entry) => isTileTemplate(entry.file) || /\/tiles?\//i.test(entry.file))) return 'maplibre-raster-or-vector-source';
  if (sourceFiles.some((entry) => /\.(fgb|geojson|json|shp|gpkg)$/i.test(entry.file))) return 'mvt-or-pmtiles';
  if (sourceFiles.some((entry) => /\.(png|jpe?g|webp|tif|tiff)$/i.test(entry.file))) return 'maplibre-raster-or-image-source';
  return 'catalogue-metadata';
}

/** @param {MainMap} map @param {SourceFile[]} sourceFiles */
function unsupportedReason(map, sourceFiles) {
  if (map.isGroup && !sourceFiles.length) return 'group entry needs child/variant conversion';
  if (!sourceFiles.length && !map.tileUrl) return 'no direct source file recorded';
  return null;
}

/** @param {string} file */
function isTileTemplate(file) {
  return /\{z\}.*\{x\}.*\{y\}/i.test(String(file || ''));
}

/** @param {Style | undefined} style */
function summarizeStyle(style) {
  if (!style) return null;
  return {
    color: style.color || null,
    fillColor: style.fillColor || null,
    fillOpacity: style.fillOpacity ?? null,
    weight: style.weight ?? null
  };
}

/** @param {unknown} links @returns {Array<{ label: string | null, url: string | null }>} */
function summarizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map((link) => ({
    label: link.label || link.title || link.name || null,
    url: link.url || link.file || null
  }));
}

/** @param {MainMap} map @param {MainMap | null} parent */
function summarizeCredits(map, parent) {
  /** @type {string[]} */
  const credits = [];
  for (const value of [map.provider, parent?.provider]) {
    if (Array.isArray(value)) credits.push(...value);
    else if (value) credits.push(value);
  }
  return [...new Set(credits.map((value) => String(value)).filter(Boolean))];
}
