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
const TEST_METADATA_PATH = 'test/metadata/maps-test.json';
const OUTPUT_PATH = 'test/metadata/main-site-port-plan.json';

const main = JSON.parse(readFileSync(MAIN_METADATA_PATH, 'utf8'));
const test = JSON.parse(readFileSync(TEST_METADATA_PATH, 'utf8'));
const convertedBySource = new Map((test.layers || []).map((layer) => [layer.sourceMapId || layer.id, layer]));
const convertedById = new Map((test.layers || []).map((layer) => [layer.id, layer]));
const categories = new Map((main.categories || []).map((category) => [category.id, category]));
const rows = [];

for (const map of main.maps || []) {
  rows.push(buildRow(map, null));
  for (const variant of map.variants || []) {
    rows.push(buildRow({ ...map, ...variant, parentId: map.id, parentName: map.name }, map));
  }
}

const totals = rows.reduce((acc, row) => {
  acc.total += 1;
  acc[row.conversionStatus] = (acc[row.conversionStatus] || 0) + 1;
  return acc;
}, { total: 0 });

const payload = {
  schemaVersion: 1,
  source: MAIN_METADATA_PATH,
  testMetadata: TEST_METADATA_PATH,
  totals,
  rows
};

mkdirSync('test/metadata', { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Rows: ${rows.length}`);
console.log(`Converted: ${totals.converted || 0}`);
console.log(`Needs vector tiles: ${totals.needsVectorTileConversion || 0}`);
console.log(`Needs raster strategy: ${totals.needsRasterStrategy || 0}`);
console.log(`Metadata only: ${totals.metadataOnly || 0}`);

function buildRow(map, parent) {
  const converted = convertedBySource.get(map.id) || convertedById.get(map.id);
  const category = categories.get(map.category) || {};
  const sourceFiles = collectSourceFiles(map);
  const conversionStatus = converted
    ? 'converted'
    : classifyConversionStatus(map, sourceFiles);

  return {
    sourceMapId: map.id,
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
    recommendedTarget: recommendedTarget(map, sourceFiles),
    testLayerId: converted?.id || null,
    bounds: map.bounds || parent?.bounds || null,
    style: summarizeStyle(map.style || parent?.style),
    sourceFiles,
    references: summarizeLinks(map.references || parent?.references),
    sourceDownloads: summarizeLinks(map.sourceDownloads || parent?.sourceDownloads || map.osniDownloads || parent?.osniDownloads),
    variants: Array.isArray(map.variants) ? map.variants.length : 0,
    unsupportedReason: converted ? null : unsupportedReason(map, sourceFiles)
  };
}

function collectSourceFiles(map) {
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

function classifyConversionStatus(map, sourceFiles) {
  if (map.isGroup && !sourceFiles.length) return 'metadataOnly';
  if (sourceFiles.some((entry) => /\.(png|jpe?g|webp|tif|tiff)$/i.test(entry.file))) return 'needsRasterStrategy';
  if (sourceFiles.some((entry) => /\.(fgb|geojson|json|shp|gpkg)$/i.test(entry.file))) return 'needsVectorTileConversion';
  if (map.tileUrl || sourceFiles.some((entry) => isTileTemplate(entry.file) || /\/tiles?\//i.test(entry.file))) return 'needsMapLibreSourceMapping';
  return 'metadataOnly';
}

function recommendedTarget(map, sourceFiles) {
  if (map.tileUrl || sourceFiles.some((entry) => isTileTemplate(entry.file) || /\/tiles?\//i.test(entry.file))) return 'maplibre-raster-or-vector-source';
  if (sourceFiles.some((entry) => /\.(fgb|geojson|json|shp|gpkg)$/i.test(entry.file))) return 'mvt-or-pmtiles';
  if (sourceFiles.some((entry) => /\.(png|jpe?g|webp|tif|tiff)$/i.test(entry.file))) return 'maplibre-raster-or-image-source';
  return 'catalogue-metadata';
}

function unsupportedReason(map, sourceFiles) {
  if (map.isGroup && !sourceFiles.length) return 'group entry needs child/variant conversion';
  if (!sourceFiles.length && !map.tileUrl) return 'no direct source file recorded';
  return null;
}

function isTileTemplate(file) {
  return /\{z\}.*\{x\}.*\{y\}/i.test(String(file || ''));
}

function summarizeStyle(style) {
  if (!style) return null;
  return {
    color: style.color || null,
    fillColor: style.fillColor || null,
    fillOpacity: style.fillOpacity ?? null,
    weight: style.weight ?? null
  };
}

function summarizeLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map((link) => ({
    label: link.label || link.title || link.name || null,
    url: link.url || link.file || null
  }));
}

function summarizeCredits(map, parent) {
  const credits = [];
  for (const value of [map.provider, parent?.provider]) {
    if (Array.isArray(value)) credits.push(...value);
    else if (value) credits.push(value);
  }
  return [...new Set(credits.map((value) => String(value)).filter(Boolean))];
}
