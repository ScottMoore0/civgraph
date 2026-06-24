#!/usr/bin/env node
/**
 * Register generated Irish hill-domain polygon layers with Civgraph metadata.
 *
 * Run after scripts/build_irish_hill_domain_assets.py.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const REPORT_PATH = resolve(ROOT, 'tmp/dobih/domain-polygons/irish-hill-domain-build-report.json');
const MAPS_PATH = resolve(ROOT, 'data/database/maps.json');
const MAPLIBRE_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const MAPLIBRE_INDEX_PATH = resolve(ROOT, 'test/metadata/maps-test-index.json');
const PORT_PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const SPATIAL_INDEX_PATH = resolve(ROOT, 'data/database/spatial-index.json');
const FEATURE_INDEX_DIR = resolve(ROOT, 'test/metadata/feature-indexes');
const LAYER_DETAILS_DIR = resolve(ROOT, 'test/metadata/layer-details-test2');
const DUPLICATE_FEATURE_IDS_DIR = resolve(ROOT, 'test/metadata/duplicate-feature-ids');
const CDN_RANGE_REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-range-report.json');

const DATASET_DATE = '2026-06-24';
const CATEGORY_ID = 'hills-and-mountains';
const CATEGORY_NAME = 'Hills and Mountains';
const GROUP_NAME = 'Physical Geography';
const FLAT_SUBHEADING = 'Environment, Water and Geology';
const PARENT_MAP_ID = 'dobih-v18-4';
const IRELAND_CLASS_ID = 'dobih-ireland-hills-and-mountains';
const TEST_PM_BASE = 'https://data.civgraph.net/data/maps/test/pmtiles/generated';
const PHYSICAL_CDN_BASE = 'https://data.civgraph.net/data/maps/physical';
const DOBIH_DOWNLOADS_URL = 'https://www.hill-bagging.co.uk/DoBIH/downloads.php';
const DOBIH_ONLINE_URL = 'https://www.hill-bagging.co.uk/';
const DOBIH_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const COPERNICUS_DEM_URL = 'https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model';
const GENERATED_AT = new Date().toISOString();

const LAYERS = [
  {
    id: 'irish-hill-summit-domains',
    name: 'Irish Hill Summit Domains',
    color: '#0ea5e9',
    fillOpacity: 0.18,
    description: 'Modelled land-clipped nearest-summit domain polygons for Irish hills and mountains in DoBIH v18.4.',
    method: 'Nearest-summit land-clipped Voronoi polygon',
    caveat: 'These are modelled summit domains, not official hill or mountain boundaries.'
  },
  {
    id: 'irish-hill-prominence-domains',
    name: 'Irish Hill Prominence Domains',
    color: '#f97316',
    fillOpacity: 0.22,
    description: 'Modelled DEM-informed prominence-weighted domain polygons for Irish hills and mountains in DoBIH v18.4.',
    method: 'DEM-informed prominence-weighted raster partition',
    caveat: 'These are modelled prominence-weighted domains, not official hill or mountain boundaries.'
  }
];

main();

function main() {
  if (!existsSync(REPORT_PATH)) {
    throw new Error(`Missing domain build report at ${relative(REPORT_PATH)}. Run python scripts/build_irish_hill_domain_assets.py first.`);
  }
  mkdirSync(FEATURE_INDEX_DIR, { recursive: true });
  mkdirSync(LAYER_DETAILS_DIR, { recursive: true });
  mkdirSync(DUPLICATE_FEATURE_IDS_DIR, { recursive: true });
  const report = readJson(REPORT_PATH);
  const outputs = new Map((report.outputs || []).map((output) => [output.id, output]));
  for (const layer of LAYERS) {
    if (!outputs.has(layer.id)) throw new Error(`Build report is missing ${layer.id}`);
  }

  updateMapsDatabase(outputs, report);
  updateMapLibreMetadata(outputs, report);
  updateMapLibreIndex();
  updatePortPlan(outputs, report);
  updateSpatialIndex(outputs);
  copyFeatureIndexes(outputs);
  console.log(JSON.stringify({
    status: 'ok',
    layers: LAYERS.map((layer) => ({
      id: layer.id,
      featureCount: outputs.get(layer.id).feature_count,
      bounds: outputs.get(layer.id).bounds
    }))
  }, null, 2));
}

function updateMapsDatabase(outputs, report) {
  const data = readJson(MAPS_PATH);
  data.maps = data.maps || [];
  data.classes = data.classes || [];
  data.categories = data.categories || [];

  upsert(data.categories, {
    id: CATEGORY_ID,
    name: CATEGORY_NAME,
    group: GROUP_NAME,
    description: 'Hill and mountain summit datasets, lists, classifications, and modelled domains.'
  });

  const existingById = new Map(data.maps.map((map) => [map.id, map]));
  data.maps = data.maps.filter((map) => !LAYERS.some((layer) => layer.id === map.id));
  for (const layer of LAYERS) {
    const output = outputs.get(layer.id);
    const existing = existingById.get(layer.id) || {};
    data.maps.push(compactObject({
      ...existing,
      id: layer.id,
      name: layer.name,
      slug: layer.id,
      category: CATEGORY_ID,
      provider: ['Database of British and Irish Hills', 'Hill Bagging', 'Copernicus DEM'],
      description: layer.description,
      date: DATASET_DATE,
      files: {
        fgb: `${PHYSICAL_CDN_BASE}/${layer.id}.fgb`
      },
      style: styleFor(layer),
      labelProperty: 'Name',
      idProperty: 'DomainId',
      keywords: unique([
        'DoBIH',
        'Database of British and Irish Hills',
        'Hill Bagging',
        'Copernicus DEM',
        'summits',
        'hills',
        'mountains',
        'domain polygons',
        'prominence',
        'summit domains',
        'Ireland',
        CATEGORY_NAME,
        FLAT_SUBHEADING,
        layer.name
      ]),
      featured: false,
      useLOD: false,
      featureCount: output.feature_count,
      featureTypeLabel: 'hill domains',
      parentId: PARENT_MAP_ID,
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging', 'Copernicus DEM'],
      license: 'Derived model; source DoBIH data CC BY 4.0',
      licenseUrl: DOBIH_LICENSE_URL,
      references: references(layer),
      sourceDownloads: sourceDownloads(layer, output),
      generationNotes: {
        method: layer.method,
        caveat: layer.caveat,
        report: relative(REPORT_PATH),
        generatedAt: report.generatedAt
      }
    }));
  }
  const irelandClass = data.classes.find((item) => item.id === IRELAND_CLASS_ID);
  if (irelandClass) {
    irelandClass.maps = unique([
      ...(irelandClass.maps || []),
      ...LAYERS.map((layer) => layer.id)
    ]);
  }
  writeJson(MAPS_PATH, data);
}

function updateMapLibreMetadata(outputs, report) {
  const metadata = readJson(MAPLIBRE_PATH);
  metadata.layers = metadata.layers || [];
  metadata.categories = metadata.categories || [];
  upsert(metadata.categories, {
    id: CATEGORY_ID,
    name: CATEGORY_NAME,
    group: GROUP_NAME,
    description: 'Hill and mountain summit datasets, lists, classifications, and modelled domains.'
  });
  const rangeReport = existsSync(CDN_RANGE_REPORT_PATH) ? readJson(CDN_RANGE_REPORT_PATH) : null;
  const rangeVerifiedByLayer = new Map((rangeReport?.results || [])
    .filter((item) => item?.ok && item.layerId)
    .map((item) => [item.layerId, item]));

  metadata.layers = metadata.layers.filter((layer) => !LAYERS.some((item) => layer.sourceMapId === item.id || layer.id === `${item.id}-vector-test`));
  for (const layer of LAYERS) {
    const output = outputs.get(layer.id);
    const layerId = `${layer.id}-vector-test`;
    const sourceLayer = sourceLayerName(layer.id);
    const rangeVerified = rangeVerifiedByLayer.get(layerId);
    metadata.layers.push(compactObject({
      id: layerId,
      sourceMapId: layer.id,
      parentId: PARENT_MAP_ID,
      name: layer.name,
      category: CATEGORY_NAME,
      group: GROUP_NAME,
      date: DATASET_DATE,
      provider: ['Database of British and Irish Hills', 'Hill Bagging', 'Copernicus DEM'],
      description: layer.description,
      renderer: 'maplibre',
      sourceType: 'pmtiles',
      geometryType: 'polygon',
      tiles: `/test/tiles/generated/${layer.id}/{z}/{x}/{y}.pbf`,
      metadataUrl: `/test/tiles/generated/${layer.id}/metadata.json`,
      sourceLayer,
      promoteId: 'DomainId',
      minzoom: 0,
      maxzoom: 14,
      bounds: output.bounds,
      style: styleFor(layer),
      references: references(layer),
      sourceDownloads: [
        { label: 'Source file used for MapLibre conversion', file: output.intake_path },
        ...sourceDownloads(layer, output).map((item) => ({ label: item.label, url: item.file || item.url, bytes: item.bytes }))
      ],
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging', 'Copernicus DEM'],
      keywords: unique([
        'DoBIH',
        'Hill Bagging',
        'Copernicus DEM',
        'summits',
        'hills',
        'mountains',
        'domain polygons',
        'prominence',
        'Ireland',
        CATEGORY_NAME,
        FLAT_SUBHEADING,
        layer.name,
        GROUP_NAME,
        'maplibre',
        'vector tiles'
      ]),
      labelProperty: 'Name',
      labelPropertyFallbacks: ['ClassificationNames', 'County', 'DomainType'],
      labelMinZoom: 9,
      labelMaxZoom: null,
      labelStyle: {
        color: layer.color,
        hoverColor: '#ff7a1a',
        selectedColor: '#111827',
        haloColor: '#ffffff',
        haloWidth: 1.2,
        haloBlur: 0,
        fontSize: 12,
        fontWeight: 'bold',
        maxWidth: 14,
        lineHeight: 1.25
      },
      featureIndexUrl: `/test/metadata/feature-indexes/${layerId}.json`,
      sourceFile: output.intake_path,
      sourceDatasetLayer: sourceLayer,
      idProperty: 'DomainId',
      popupProperties: [
        'DomainType',
        'DomainMethod',
        'Number',
        'Name',
        'ClassificationNames',
        'Metres',
        'Feet',
        'Drop',
        'Col height',
        'Col grid ref',
        'Grid ref',
        'County',
        'CountryName',
        'Region',
        'Area',
        'Island',
        'Feature',
        'Observations',
        'Survey',
        'Revision',
        'HillBagging',
        'Streetmap',
        'GoogleMaps'
      ],
      numericProperties: ['Number', 'Metres', 'Feet', 'Drop', 'Col height', 'Latitude', 'Longitude'],
      categoricalProperties: ['DomainType', 'DomainMethod', 'ClassificationNames', 'CountryName', 'County', 'Region', 'Area', 'Island', 'Feature'],
      status: 'converted',
      notes: `${layer.description} ${layer.caveat}`,
      generatedFrom: {
        pipeline: 'build_irish_hill_domain_assets.py',
        sourceFile: output.intake_path,
        bytes: output.bytes,
        featureCount: output.feature_count,
        method: layer.method,
        generatedAt: report.generatedAt || GENERATED_AT
      },
      tileUrl: `${TEST_PM_BASE}/${layerId}.pmtiles`,
      tilesFallback: `/test/tiles/generated/${layer.id}/{z}/{x}/{y}.pbf`,
      tilePackage: {
        preferred: true,
        localPath: `test/pmtiles/generated/${layerId}.pmtiles`,
        url: `/test/pmtiles/generated/${layerId}.pmtiles`,
        fallback: `/test/tiles/generated/${layer.id}/{z}/{x}/{y}.pbf`,
        serving: 'cdn',
        cdnUrl: `${TEST_PM_BASE}/${layerId}.pmtiles`,
        r2Key: `data/maps/test/pmtiles/generated/${layerId}.pmtiles`,
        localUrl: `/test/pmtiles/generated/${layerId}.pmtiles`,
        byteRangeVerifiedAt: rangeVerified ? rangeReport.generatedAt : undefined
      }
    }));
  }
  writeJson(MAPLIBRE_PATH, metadata);
  const generatedLayers = metadata.layers.filter((item) => LAYERS.some((layer) => item.id === `${layer.id}-vector-test`));
  writeLayerSidecars(generatedLayers);
}

function updateMapLibreIndex() {
  const index = readJson(MAPLIBRE_INDEX_PATH);
  const metadata = readJson(MAPLIBRE_PATH);
  const generatedLayers = metadata.layers.filter((item) => LAYERS.some((layer) => item.id === `${layer.id}-vector-test`));
  index.categories = index.categories || [];
  index.layers = index.layers || [];
  upsert(index.categories, {
    id: CATEGORY_ID,
    name: CATEGORY_NAME,
    group: GROUP_NAME,
    description: 'Hill and mountain summit datasets, lists, classifications, and modelled domains.'
  });
  index.layers = index.layers.filter((item) => !LAYERS.some((layer) => item.id === `${layer.id}-vector-test` || item.sourceMapId === layer.id));
  for (const layer of generatedLayers) {
    index.layers.push(compactObject({
      ...layer,
      detailUrl: `/test/metadata/layer-details-test2/${layer.id}.json`,
      duplicateFeatureIdsUrl: `/test/metadata/duplicate-feature-ids/${layer.id}.json`,
      duplicateFeatureIdCount: 0,
      featureIdMode: 'unique'
    }));
  }
  index.detailLayerCount = index.layers.length;
  writeJson(MAPLIBRE_INDEX_PATH, index);
}

function writeLayerSidecars(layers) {
  for (const layer of layers) {
    writeJson(resolve(LAYER_DETAILS_DIR, `${layer.id}.json`), layer);
    writeJson(resolve(DUPLICATE_FEATURE_IDS_DIR, `${layer.id}.json`), {
      layerId: layer.id,
      sourceMapId: layer.sourceMapId,
      featureIndexUrl: layer.featureIndexUrl,
      featureCount: layer.generatedFrom?.featureCount || 0,
      featureIdMode: 'unique',
      duplicateFeatureIds: []
    });
  }
}

function updatePortPlan(outputs, report) {
  const plan = readJson(PORT_PLAN_PATH);
  plan.rows = plan.rows || [];
  plan.rows = plan.rows.filter((row) => !LAYERS.some((layer) => row.sourceMapId === layer.id || row.testLayerId === `${layer.id}-vector-test`));
  for (const layer of LAYERS) {
    const output = outputs.get(layer.id);
    plan.rows.push(compactObject({
      sourceMapId: layer.id,
      cloneOf: null,
      parentId: PARENT_MAP_ID,
      name: layer.name,
      category: CATEGORY_NAME,
      categoryId: CATEGORY_ID,
      group: GROUP_NAME,
      date: DATASET_DATE,
      dateAdded: DATASET_DATE,
      dateEffective: DATASET_DATE,
      provider: ['Database of British and Irish Hills', 'Hill Bagging', 'Copernicus DEM'],
      description: layer.description,
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging', 'Copernicus DEM'],
      conversionStatus: 'converted',
      recommendedTarget: 'pmtiles',
      testLayerId: `${layer.id}-vector-test`,
      aliasTargetLayerId: null,
      bounds: output.bounds,
      style: styleFor(layer),
      sourceFiles: [{ kind: 'fgb', file: output.intake_path }],
      references: references(layer),
      sourceDownloads: sourceDownloads(layer, output),
      variants: 0,
      unsupportedReason: null,
      caveat: layer.caveat,
      generatedFrom: {
        pipeline: 'build_irish_hill_domain_assets.py',
        report: relative(REPORT_PATH),
        generatedAt: report.generatedAt
      }
    }));
  }
  writeJson(PORT_PLAN_PATH, plan);
}

function updateSpatialIndex(outputs) {
  const spatial = readJson(SPATIAL_INDEX_PATH);
  spatial.maps = spatial.maps || [];
  spatial.maps = spatial.maps.filter((item) => !LAYERS.some((layer) => layer.id === item.id));
  for (const layer of LAYERS) {
    const output = outputs.get(layer.id);
    spatial.maps.push({
      id: layer.id,
      name: layer.name,
      file: output.intake_path,
      category: 'physical-geography',
      featureCount: output.feature_count,
      bounds: output.bounds
    });
  }
  writeJson(SPATIAL_INDEX_PATH, spatial);
}

function copyFeatureIndexes(outputs) {
  for (const layer of LAYERS) {
    const output = outputs.get(layer.id);
    const target = resolve(FEATURE_INDEX_DIR, `${layer.id}-vector-test.json`);
    copyFileSync(resolve(ROOT, output.feature_index_path), target);
  }
}

function references(layer) {
  return [
    { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, note: 'Source download page for DoBIH v18.4 and companion files.' },
    { label: 'Hill Bagging', url: DOBIH_ONLINE_URL, note: 'Online version of the Database of British and Irish Hills.' },
    { label: 'Copernicus Digital Elevation Model', url: COPERNICUS_DEM_URL, note: 'DEM source used for the prominence-domain model.' },
    { label: 'Creative Commons Attribution 4.0 International', url: DOBIH_LICENSE_URL, note: 'Licence recorded for DoBIH data exports.' },
    { label: `${layer.name} generation caveat`, note: layer.caveat }
  ];
}

function sourceDownloads(layer, output) {
  return [
    {
      label: `${layer.name} FlatGeobuf`,
      file: `${PHYSICAL_CDN_BASE}/${layer.id}.fgb`,
      bytes: output.bytes
    },
    {
      label: 'Domain build report',
      file: relative(REPORT_PATH)
    }
  ];
}

function styleFor(layer) {
  return {
    color: layer.color,
    fillColor: layer.color,
    fillOpacity: layer.fillOpacity,
    weight: 1,
    opacity: 0.85
  };
}

function sourceLayerName(id) {
  return String(id).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  const pretty = resolve(path) !== SPATIAL_INDEX_PATH;
  writeFileSync(path, `${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`);
}

function upsert(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = { ...items[index], ...item };
  else items.push(item);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, compactObject(item)])
    .filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function relative(path) {
  return resolve(path).replace(`${ROOT}\\`, '').replaceAll('\\', '/');
}
