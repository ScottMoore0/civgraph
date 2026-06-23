#!/usr/bin/env node
/**
 * Build Civgraph metadata and runtime source assets for the Database of
 * British and Irish Hills. Raw Hill Bagging downloads remain local-only under
 * tmp/; this script writes compact source manifests, FGB point layers, map
 * catalogue records, MapLibre runtime records, and spatial-search records.
 */

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(process.cwd());
const DOWNLOAD_ROOT = resolve(ROOT, 'tmp/hill-bagging/downloads');
const DOBIH_DOWNLOAD_ROOT = resolve(DOWNLOAD_ROOT, 'www.hill-bagging.co.uk/dobih-downloads');
const CSV_ZIP_PATH = resolve(DOBIH_DOWNLOAD_ROOT, 'hillcsv.zip');
const CSV_EXTRACT_DIR = resolve(ROOT, 'tmp/dobih/source/hillcsv');
const CSV_PATH = resolve(CSV_EXTRACT_DIR, 'DoBIH_v18_4.csv');
const GENERATED_DIR = resolve(ROOT, 'tmp/dobih/generated');
const VECTOR_INTAKE_DIR = resolve(ROOT, 'test/source-cache/vector-intake');
const SOURCE_MANIFEST_PATH = resolve(ROOT, 'data/database/source-manifests/dobih-v18-4-sources.json');
const MAPS_PATH = resolve(ROOT, 'data/database/maps.json');
const MAPLIBRE_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const PORT_PLAN_PATH = resolve(ROOT, 'test/metadata/main-site-port-plan.json');
const SPATIAL_INDEX_PATH = resolve(ROOT, 'data/database/spatial-index.json');
const EXTERNAL_SOURCES_PATH = resolve(ROOT, 'data/database/external-sources.json');
const FEATURE_INDEX_DIR = resolve(ROOT, 'test/metadata/feature-indexes');

const DATASET_ID = 'dobih-v18-4';
const DATASET_NAME = 'Database of British and Irish Hills v18.4';
const DATASET_VERSION = '18.4';
const DATASET_DATE = '2026-06-22';
const DOBIH_DOWNLOADS_URL = 'https://www.hill-bagging.co.uk/DoBIH/downloads.php';
const DOBIH_ONLINE_URL = 'https://www.hill-bagging.co.uk/';
const DOBIH_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const IA_ITEM_ID = 'civgraph-dobih-v18-4-source-files';
const IA_ITEM_URL = `https://archive.org/details/${IA_ITEM_ID}`;
const IA_DOWNLOAD_BASE = `https://archive.org/download/${IA_ITEM_ID}`;
const CDN_BASE = 'https://data.civgraph.net/data/maps/physical';
const TEST_PM_BASE = 'https://data.civgraph.net/data/maps/test/pmtiles/generated';
const GENERATED_AT = new Date().toISOString();

const CLASSIFICATIONS = [
  { id: 'munros', name: 'Munros', field: 'M', color: '#2563eb', description: 'Scottish Munros in DoBIH v18.4.' },
  { id: 'munro-tops', name: 'Munro Tops', field: 'MT', color: '#60a5fa', description: 'Scottish Munro Tops in DoBIH v18.4.' },
  { id: 'furths', name: 'Furths', field: 'F', color: '#1d4ed8', description: 'Furth mountains in DoBIH v18.4.' },
  { id: 'corbetts', name: 'Corbetts', field: 'C', color: '#7c3aed', description: 'Scottish Corbetts in DoBIH v18.4.' },
  { id: 'grahams', name: 'Grahams', field: 'G', color: '#9333ea', description: 'Scottish Grahams in DoBIH v18.4.' },
  { id: 'donalds', name: 'Donalds', field: 'D', color: '#a855f7', description: 'Scottish Donalds in DoBIH v18.4.' },
  { id: 'donald-tops', name: 'Donald Tops', field: 'DT', color: '#c084fc', description: 'Scottish Donald Tops in DoBIH v18.4.' },
  { id: 'marilyns', name: 'Marilyns', field: 'Ma', color: '#16a34a', description: 'Marilyn hills in DoBIH v18.4.' },
  { id: 'humps', name: 'HuMPs', field: 'Hu', color: '#22c55e', description: 'Hundred Metre Prominence hills in DoBIH v18.4.' },
  { id: 'tumps', name: 'TuMPs', field: 'Tu', color: '#84cc16', description: 'Thirty Metre Prominence hills in DoBIH v18.4.' },
  { id: 'simms', name: 'Simms', field: 'Sim', color: '#0d9488', description: 'Six-hundred Metre mountains in DoBIH v18.4.' },
  { id: 'hewitts', name: 'Hewitts', field: 'Hew', color: '#0284c7', description: 'Hewitt hills in DoBIH v18.4.' },
  { id: 'nuttalls', name: 'Nuttalls', field: 'N', color: '#0ea5e9', description: 'Nuttall hills in DoBIH v18.4.' },
  { id: 'wainwrights', name: 'Wainwrights', field: 'W', color: '#f97316', description: 'Wainwright fells in DoBIH v18.4.' },
  { id: 'birketts', name: 'Birketts', field: 'B', color: '#ea580c', description: 'Birkett fells in DoBIH v18.4.' },
  { id: 'synges', name: 'Synges', field: 'Sy', color: '#d97706', description: 'Synge hills in DoBIH v18.4.' },
  { id: 'fellrangers', name: 'Fellrangers', field: 'Fel', color: '#f59e0b', description: 'Fellranger hills in DoBIH v18.4.' },
  { id: 'arderins', name: 'Arderins', field: 'A', color: '#059669', description: 'Irish Arderin hills in DoBIH v18.4.' },
  { id: 'vandeleur-lynams', name: 'Vandeleur-Lynams', field: 'VL', color: '#10b981', description: 'Irish Vandeleur-Lynam hills in DoBIH v18.4.' },
  { id: 'carns', name: 'Carns', field: 'Ca', color: '#34d399', description: 'Irish Carn hills in DoBIH v18.4.' },
  { id: 'binnions', name: 'Binnions', field: 'Bin', color: '#6ee7b7', description: 'Irish Binnion hills in DoBIH v18.4.' },
  { id: 'county-tops', name: 'County Tops', fields: ['CoH', 'CoU', 'CoA', 'CoL', 'CT'], color: '#dc2626', description: 'County and county-equivalent tops recorded in DoBIH v18.4.' },
  { id: 'significant-islands', name: 'Significant Islands of Britain', field: 'SIB', color: '#0891b2', description: 'Significant Islands of Britain summits in DoBIH v18.4.' }
];

const CORE_SOURCE_FILES = new Set([
  'hillcsv.zip',
  'hillxlsx.zip',
  'hillxls.zip',
  'hillmdb.zip',
  'Hills.gpi'
]);

const COMPANION_TABLES = new Set([
  'munrotab_v8.0.1.csv',
  'munrotab_v8.0.1.xlsx',
  'corbettab_v4.csv',
  'corbettab_v4.xls',
  'donaldtab_v3.csv',
  'donaldtab_v3.xlsx',
  'GPStest.csv'
]);

function main() {
  ensureSourceCsv();
  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(VECTOR_INTAKE_DIR, { recursive: true });
  mkdirSync(dirname(SOURCE_MANIFEST_PATH), { recursive: true });
  mkdirSync(FEATURE_INDEX_DIR, { recursive: true });

  const sourceInventory = buildSourceInventory();
  writeJson(SOURCE_MANIFEST_PATH, buildSourceManifest(sourceInventory));

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const header = rows.shift() || [];
  const rawRecords = rows
    .filter((row) => row.some((value) => String(value || '').trim()))
    .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
  const records = rawRecords.map(normalizeDobihRecord).filter(Boolean);

  const datasets = [
    {
      id: DATASET_ID,
      name: DATASET_NAME,
      color: '#166534',
      description: 'Complete Database of British and Irish Hills v18.4 point dataset.',
      records
    },
    ...CLASSIFICATIONS.map((classification) => ({
      id: `${DATASET_ID}-${classification.id}`,
      name: `${classification.name} (${DATASET_VERSION})`,
      color: classification.color,
      description: classification.description,
      classification,
      records: records.filter((record) => hasClassification(record.original, classification))
    })).filter((dataset) => dataset.records.length)
  ];

  const datasetSummaries = [];
  for (const dataset of datasets) {
    const geojsonPath = resolve(GENERATED_DIR, `${dataset.id}.geojson`);
    const fgbPath = resolve(VECTOR_INTAKE_DIR, `${dataset.id}.fgb`);
    const layerName = sourceLayerName(dataset.id);
    writeJson(geojsonPath, {
      type: 'FeatureCollection',
      name: layerName,
      features: dataset.records.map((record) => ({
        type: 'Feature',
        id: record.id,
        properties: record.properties,
        geometry: {
          type: 'Point',
          coordinates: [record.longitude, record.latitude]
        }
      }))
    });
    convertGeoJsonToFgb(geojsonPath, fgbPath, layerName);
    datasetSummaries.push({
      ...dataset,
      layerName,
      featureCount: dataset.records.length,
      bounds: computeBounds(dataset.records),
      geojsonPath,
      fgbPath,
      fgbBytes: statSync(fgbPath).size
    });
  }

  updateMapsJson(datasetSummaries, sourceInventory);
  updateMapLibreMetadata(datasetSummaries, sourceInventory);
  updateMainSitePortPlan(datasetSummaries, sourceInventory);
  updateSpatialIndex(datasetSummaries);
  updateFeatureIndexes(datasetSummaries);
  updateExternalSources(sourceInventory, datasetSummaries);

  writeJson(resolve(GENERATED_DIR, 'dobih-build-report.json'), {
    generatedAt: GENERATED_AT,
    sourceCsv: relativePath(CSV_PATH),
    totalRecords: records.length,
    datasets: datasetSummaries.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      featureCount: dataset.featureCount,
      fgb: relativePath(dataset.fgbPath),
      fgbBytes: dataset.fgbBytes,
      bounds: dataset.bounds
    })),
    sourceFiles: sourceInventory.length
  });

  console.log(`DoBIH source records: ${records.length}`);
  console.log(`Generated ${datasetSummaries.length} FGB layer(s).`);
  for (const dataset of datasetSummaries) {
    console.log(`- ${dataset.id}: ${dataset.featureCount} point(s), ${dataset.fgbBytes} bytes`);
  }
}

function ensureSourceCsv() {
  if (existsSync(CSV_PATH)) return;
  if (!existsSync(CSV_ZIP_PATH)) {
    throw new Error(`Missing DoBIH CSV zip: ${relativePath(CSV_ZIP_PATH)}`);
  }
  mkdirSync(CSV_EXTRACT_DIR, { recursive: true });
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath ${quotePwsh(CSV_ZIP_PATH)} -DestinationPath ${quotePwsh(CSV_EXTRACT_DIR)} -Force`
  ], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Could not extract ${relativePath(CSV_ZIP_PATH)}: ${result.stderr || result.stdout}`);
  }
}

function buildSourceInventory() {
  if (!existsSync(DOWNLOAD_ROOT)) return [];
  const files = walkFiles(DOWNLOAD_ROOT)
    .filter((file) => !file.includes(`${sep}images${sep}`) || /\.(jpe?g|png|webp)$/i.test(file))
    .map((file) => {
      const rel = relative(DOWNLOAD_ROOT, file).replace(/\\/g, '/');
      const name = basename(file);
      const isHillBagging = rel.startsWith('www.hill-bagging.co.uk/');
      const url = sourceUrlFromRelative(rel);
      const type = classifySourceFile(name, rel);
      const archiveUrl = isHillBagging ? archiveUrlFromRelative(rel) : null;
      return {
        id: `dobih-source:${slugify(rel)}`,
        name,
        path: relativePath(file),
        url,
        provider: isHillBagging ? 'Hill Bagging / Database of British and Irish Hills' : providerFromRelative(rel),
        category: type.category,
        role: type.role,
        format: formatFromExtension(file),
        extension: extname(file).replace(/^\./, '').toLowerCase(),
        bytes: statSync(file).size,
        sha256: sha256(file),
        license: isCoreDobihData(name) ? 'CC BY 4.0' : type.license,
        licenseUrl: isCoreDobihData(name) ? DOBIH_LICENSE_URL : type.licenseUrl,
        archiveStatus: isHillBagging ? 'mirrored-internet-archive' : 'external-reference-not-mirrored',
        archiveItem: isHillBagging ? IA_ITEM_ID : null,
        archiveUrl
      };
    });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function buildSourceManifest(items) {
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  return {
    schemaVersion: 1,
    id: DATASET_ID,
    title: DATASET_NAME,
    generatedAt: GENERATED_AT,
    sourceProvider: 'Database of British and Irish Hills / Hill Bagging',
    sourceUrl: DOBIH_DOWNLOADS_URL,
    onlineUrl: DOBIH_ONLINE_URL,
    archiveItem: IA_ITEM_ID,
    archiveUrl: IA_ITEM_URL,
    license: {
      label: 'Creative Commons Attribution 4.0 International',
      url: DOBIH_LICENSE_URL,
      appliesTo: 'DoBIH database files and exported hill lists where explicitly published as DoBIH data. Companion documents are recorded individually and should retain their own attribution/licence notes.'
    },
    localDownloadRoot: relativePath(DOWNLOAD_ROOT),
    totals: {
      files: items.length,
      bytes: totalBytes
    },
    files: items
  };
}

function normalizeDobihRecord(record) {
  const latitude = Number(record.Latitude);
  const longitude = Number(record.Longitude);
  const number = clean(record.Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !number) return null;
  const classes = classificationCodes(record);
  const properties = {
    Number: number,
    Name: clean(record.Name),
    'Parent (SMC)': clean(record['Parent (SMC)']),
    'Parent name (SMC)': clean(record['Parent name (SMC)']),
    Section: clean(record.Section),
    Region: clean(record.Region),
    Area: clean(record.Area),
    Island: clean(record.Island),
    'Topo Section': clean(record['Topo Section']),
    County: clean(record.County),
    Classification: clean(record.Classification),
    ClassificationNames: classes.map((item) => item.name).join('; '),
    'Map 1:50k': clean(record['Map 1:50k']),
    'Map 1:25k': clean(record['Map 1:25k']),
    Metres: numberOrNull(record.Metres),
    Feet: numberOrNull(record.Feet),
    'Grid ref': clean(record['Grid ref']),
    'Grid ref 10': clean(record['Grid ref 10']),
    Drop: numberOrNull(record.Drop),
    'Col grid ref': clean(record['Col grid ref']),
    'Col height': numberOrNull(record['Col height']),
    Feature: clean(record.Feature),
    Observations: clean(record.Observations),
    Survey: clean(record.Survey),
    Climbed: clean(record.Climbed),
    Country: countryLabel(record.Country),
    CountryCode: clean(record.Country),
    'County Top': clean(record['County Top']),
    Revision: clean(record.Revision),
    Comments: clean(record.Comments),
    Streetmap: clean(record['Streetmap/MountainViews']),
    GoogleMaps: clean(record['Google Maps']),
    HillBagging: clean(record['Hill-bagging']),
    Xcoord: numberOrNull(record.Xcoord),
    Ycoord: numberOrNull(record.Ycoord),
    Latitude: latitude,
    Longitude: longitude,
    GridrefXY: clean(record.GridrefXY),
    ParentMa: clean(record['Parent (Ma)']),
    ParentMaName: clean(record['Parent name (Ma)']),
    MountainViewsNumber: clean(record.MVNumber),
    ListCodes: classes.map((item) => item.code).join(','),
    HillListCount: classes.length,
    IsCountyTop: hasAnyField(record, ['CoH', 'CoU', 'CoA', 'CoL', 'CT']) ? 1 : 0
  };
  return {
    id: number,
    latitude,
    longitude,
    original: record,
    properties: compactObject(properties)
  };
}

function classificationCodes(record) {
  const explicit = clean(record.Classification).split(',').map((item) => item.trim()).filter(Boolean);
  const fromFlags = CLASSIFICATION_NAME_ORDER
    .filter((item) => clean(record[item.code]) === '1')
    .map((item) => item.code);
  const codes = [...new Set([...explicit, ...fromFlags])];
  return codes.map((code) => ({ code, name: CLASSIFICATION_LABELS[code] || code }));
}

const CLASSIFICATION_NAME_ORDER = [
  'Ma', 'Hu', 'Tu', 'Sim', 'M', 'MT', 'F', 'C', 'G', 'D', 'DT', 'Hew', 'N', 'Dew', 'DDew',
  'HF', 'W', 'WO', 'B', 'E', 'HHB', 'Sy', 'Fel', 'CoH', 'CoU', 'CoA', 'CoL', 'SIB', 'Mur',
  'CT', 'GT', 'BL', 'Bg', 'Y', 'Cm', 'T100', 'Dil', 'VL', 'A', 'Ca', 'Bin', 'O', 'Un'
].map((code) => ({ code }));

const CLASSIFICATION_LABELS = {
  Ma: 'Marilyn',
  Hu: 'HuMP',
  Tu: 'TuMP',
  Sim: 'Simm',
  M: 'Munro',
  MT: 'Munro Top',
  F: 'Furth',
  C: 'Corbett',
  G: 'Graham',
  D: 'Donald',
  DT: 'Donald Top',
  Hew: 'Hewitt',
  N: 'Nuttall',
  Dew: 'Dewey',
  DDew: 'Donald Dewey',
  HF: 'Highland Five',
  W: 'Wainwright',
  WO: 'Wainwright Outlying Fell',
  B: 'Birkett',
  E: 'Ethel',
  HHB: 'Hill Bagging hill',
  Sy: 'Synge',
  Fel: 'Fellranger',
  CoH: 'County Top - historic',
  CoU: 'County Top - current county/unitary authority',
  CoA: 'County Top - administrative',
  CoL: 'County Top - London Borough',
  SIB: 'Significant Island of Britain',
  Mur: 'Murdo',
  CT: 'Corbett Top',
  GT: 'Graham Top',
  BL: 'Buxton & Lewis',
  Bg: 'Bridge',
  Y: 'Yeaman',
  Cm: 'Clem',
  T100: 'Trail 100',
  Dil: 'Dillon',
  VL: 'Vandeleur-Lynam',
  A: 'Arderin',
  Ca: 'Carn',
  Bin: 'Binnion',
  O: 'Other list',
  Un: 'Unclassified'
};

function hasClassification(record, classification) {
  if (classification.fields) return hasAnyField(record, classification.fields);
  return clean(record[classification.field]) === '1';
}

function hasAnyField(record, fields) {
  return fields.some((field) => clean(record[field]) === '1');
}

function convertGeoJsonToFgb(geojsonPath, fgbPath, layerName) {
  rmSync(fgbPath, { force: true });
  const result = spawnSync('ogr2ogr', [
    '-f', 'FlatGeobuf',
    fgbPath,
    geojsonPath,
    '-nln', layerName,
    '-lco', 'SPATIAL_INDEX=YES'
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`ogr2ogr failed for ${relativePath(geojsonPath)}: ${result.stderr || result.stdout}`);
  }
}

function updateMapsJson(datasets, sourceInventory) {
  const mapsData = readJson(MAPS_PATH);
  mapsData.categories = mapsData.categories || [];
  mapsData.classes = mapsData.classes || [];
  mapsData.c1s = mapsData.c1s || [];
  mapsData.maps = mapsData.maps || [];

  upsert(mapsData.classes, {
    id: 'dobih-hill-classifications',
    name: 'Hill Classifications',
    scope: 'British and Irish Isles',
    category: 'physical-geography',
    maps: datasets.map((dataset) => dataset.id)
  });

  upsert(mapsData.c1s, {
    id: 'hill-classifications-c1',
    name: 'Hill Classifications',
    category: 'physical-geography',
    layout: 'mixed',
    sections: [
      {
        classId: 'dobih-hill-classifications',
        width: 'full'
      }
    ]
  });

  const sourceDownloads = sourceInventory
    .filter((item) => isCoreDobihData(item.name) || COMPANION_TABLES.has(item.name))
    .map((item) => ({
      label: `${item.format} - ${item.name}`,
      file: item.url,
      hash: item.sha256,
      bytes: item.bytes
    }));
  const references = [
    { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, note: 'Source download page for DoBIH v18.4 and companion files.' },
    { label: 'Hill Bagging', url: DOBIH_ONLINE_URL, note: 'Online version of the Database of British and Irish Hills.' },
    { label: 'Creative Commons Attribution 4.0 International', url: DOBIH_LICENSE_URL, note: 'Licence recorded for DoBIH data exports.' }
  ];

  mapsData.maps = mapsData.maps.filter((map) => !String(map.id || '').startsWith(DATASET_ID));
  for (const dataset of datasets) {
    const isParent = dataset.id === DATASET_ID;
    mapsData.maps.push(compactObject({
      id: dataset.id,
      name: isParent ? 'Database of British and Irish Hills' : dataset.name,
      slug: dataset.id,
      category: 'physical-geography',
      provider: ['Database of British and Irish Hills', 'Hill Bagging'],
      description: isParent
        ? 'Point dataset of summits in Britain, Ireland and nearby islands from the Database of British and Irish Hills v18.4.'
        : dataset.description,
      date: DATASET_DATE,
      files: {
        fgb: `${CDN_BASE}/${dataset.id}.fgb`
      },
      style: {
        color: dataset.color,
        fillColor: dataset.color,
        fillOpacity: 0.9,
        weight: 1,
        radius: isParent ? 4 : 5
      },
      labelProperty: 'Name',
      idProperty: 'Number',
      keywords: unique([
        'DoBIH',
        'Database of British and Irish Hills',
        'Hill Bagging',
        'summits',
        'hills',
        'mountains',
        'Britain',
        'Ireland',
        'point data',
        dataset.classification?.name
      ].filter(Boolean)),
      featured: isParent,
      useLOD: false,
      featureCount: dataset.featureCount,
      featureTypeLabel: 'summits',
      parentId: isParent ? null : DATASET_ID,
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging'],
      license: 'CC BY 4.0',
      licenseUrl: DOBIH_LICENSE_URL,
      references,
      sourceDownloads,
      sourceManifest: relativePath(SOURCE_MANIFEST_PATH)
    }));
  }
  writeJson(MAPS_PATH, mapsData);
}

function updateMapLibreMetadata(datasets, sourceInventory) {
  const metadata = readJson(MAPLIBRE_PATH);
  metadata.layers = metadata.layers || [];
  metadata.layers = metadata.layers.filter((layer) => !String(layer.sourceMapId || layer.id || '').startsWith(DATASET_ID));
  const references = [
    { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, note: 'Source download page for DoBIH v18.4 and companion files.' },
    { label: 'Creative Commons Attribution 4.0 International', url: DOBIH_LICENSE_URL, note: 'Licence recorded for DoBIH data exports.' }
  ];
  const sourceDownloads = sourceInventory
    .filter((item) => isCoreDobihData(item.name))
    .map((item) => ({ label: item.name, url: item.url, bytes: item.bytes, sha256: item.sha256 }));

  for (const dataset of datasets) {
    const layerId = `${dataset.id}-vector-test`;
    metadata.layers.push(compactObject({
      id: layerId,
      sourceMapId: dataset.id,
      name: dataset.id === DATASET_ID ? 'Database of British and Irish Hills' : dataset.name,
      category: 'Physical Geography',
      group: 'Physical Geography',
      date: DATASET_DATE,
      provider: ['Database of British and Irish Hills', 'Hill Bagging'],
      description: dataset.description,
      renderer: 'maplibre',
      sourceType: 'pmtiles',
      geometryType: 'point',
      tiles: `/test/tiles/generated/${dataset.id}/{z}/{x}/{y}.pbf`,
      metadataUrl: `/test/tiles/generated/${dataset.id}/metadata.json`,
      sourceLayer: dataset.layerName,
      promoteId: 'Number',
      minzoom: 0,
      maxzoom: 14,
      bounds: dataset.bounds,
      style: {
        color: dataset.color,
        fillColor: dataset.color,
        fillOpacity: 0.9,
        weight: 1,
        radius: dataset.id === DATASET_ID ? 4 : 5
      },
      references,
      sourceDownloads: [
        { label: 'Source file used for MapLibre conversion', file: relativePath(dataset.fgbPath) },
        ...sourceDownloads
      ],
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging'],
      keywords: unique([
        'DoBIH',
        'Hill Bagging',
        'summits',
        'hills',
        'mountains',
        dataset.name,
        dataset.classification?.name,
        'Physical Geography',
        'maplibre',
        'vector tiles'
      ].filter(Boolean)),
      labelProperty: 'Name',
      labelPropertyFallbacks: ['ClassificationNames', 'County'],
      labelMinZoom: 8,
      labelMaxZoom: null,
      labelStyle: {
        color: dataset.color,
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
      sourceFile: relativePath(dataset.fgbPath),
      sourceDatasetLayer: dataset.layerName,
      idProperty: 'Number',
      popupProperties: [
        'Number',
        'Name',
        'ClassificationNames',
        'Metres',
        'Feet',
        'Drop',
        'Grid ref',
        'County',
        'Country',
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
      numericProperties: ['Number', 'Metres', 'Feet', 'Drop', 'Col height', 'Latitude', 'Longitude', 'HillListCount'],
      categoricalProperties: ['ClassificationNames', 'Country', 'CountryCode', 'County', 'Region', 'Area', 'Island', 'Feature'],
      categoricalValues: {
        Country: [...new Set(dataset.records.map((record) => record.properties.Country).filter(Boolean))].sort().slice(0, 40),
        ClassificationNames: [...new Set(dataset.records.flatMap((record) => String(record.properties.ClassificationNames || '').split('; ').filter(Boolean)))].sort().slice(0, 80)
      },
      status: 'converted',
      notes: `Generated from ${relativePath(dataset.fgbPath)} from DoBIH v18.4.`,
      generatedFrom: {
        pipeline: 'build-dobih-assets',
        sourceFile: relativePath(dataset.fgbPath),
        bytes: dataset.fgbBytes,
        featureCount: dataset.featureCount,
        generatedAt: GENERATED_AT
      },
      tileUrl: `${TEST_PM_BASE}/${layerId}.pmtiles`,
      tilesFallback: `/test/tiles/generated/${dataset.id}/{z}/{x}/{y}.pbf`,
      tilePackage: {
        preferred: true,
        localPath: `test/pmtiles/generated/${layerId}.pmtiles`,
        url: `/test/pmtiles/generated/${layerId}.pmtiles`,
        fallback: `/test/tiles/generated/${dataset.id}/{z}/{x}/{y}.pbf`,
        serving: 'cdn',
        cdnUrl: `${TEST_PM_BASE}/${layerId}.pmtiles`,
        r2Key: `data/maps/test/pmtiles/generated/${layerId}.pmtiles`
      }
    }));
  }
  writeJson(MAPLIBRE_PATH, metadata);
}

function updateMainSitePortPlan(datasets, sourceInventory) {
  const plan = readJson(PORT_PLAN_PATH);
  plan.rows = plan.rows || [];
  plan.rows = plan.rows.filter((row) => {
    const sourceMapId = String(row.sourceMapId || '');
    const testLayerId = String(row.testLayerId || '');
    return !sourceMapId.startsWith(DATASET_ID) && !testLayerId.startsWith(DATASET_ID);
  });

  const references = [
    { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, note: 'Source download page for DoBIH v18.4 and companion files.' },
    { label: 'Hill Bagging', url: DOBIH_ONLINE_URL, note: 'Online version of the Database of British and Irish Hills.' },
    { label: 'Internet Archive source mirror', url: IA_ITEM_URL, note: 'Mirrored raw source files for Civgraph provenance and durable downloads.' },
    { label: 'Creative Commons Attribution 4.0 International', url: DOBIH_LICENSE_URL, note: 'Licence recorded for DoBIH data exports.' }
  ];
  const sourceDownloads = sourceInventory
    .filter((item) => isCoreDobihData(item.name) || COMPANION_TABLES.has(item.name))
    .map((item) => compactObject({
      label: `${item.format} - ${item.name}`,
      url: item.url,
      archiveUrl: item.archiveUrl,
      bytes: item.bytes,
      sha256: item.sha256
    }));

  for (const dataset of datasets) {
    const isParent = dataset.id === DATASET_ID;
    plan.rows.push(compactObject({
      sourceMapId: dataset.id,
      cloneOf: null,
      parentId: isParent ? null : DATASET_ID,
      name: isParent ? 'Database of British and Irish Hills' : dataset.name,
      category: 'Physical Geography',
      categoryId: 'physical-geography',
      group: 'Physical Geography',
      date: DATASET_DATE,
      dateAdded: DATASET_DATE,
      dateEffective: DATASET_DATE,
      provider: ['Database of British and Irish Hills', 'Hill Bagging'],
      description: isParent
        ? 'Point dataset of summits in Britain, Ireland and nearby islands from the Database of British and Irish Hills v18.4.'
        : dataset.description,
      sourceCredits: ['Database of British and Irish Hills editors', 'Hill Bagging'],
      conversionStatus: 'converted',
      recommendedTarget: 'pmtiles',
      testLayerId: `${dataset.id}-vector-test`,
      aliasTargetLayerId: null,
      bounds: dataset.bounds,
      style: {
        color: dataset.color,
        fillColor: dataset.color,
        fillOpacity: 0.9,
        weight: 1,
        radius: isParent ? 4 : 5
      },
      sourceFiles: [{ kind: 'fgb', file: relativePath(dataset.fgbPath) }],
      references,
      sourceDownloads,
      variants: 0,
      unsupportedReason: null
    }));
  }

  plan.rows.sort((a, b) => {
    const aDobih = String(a.sourceMapId || '').startsWith(DATASET_ID) ? 1 : 0;
    const bDobih = String(b.sourceMapId || '').startsWith(DATASET_ID) ? 1 : 0;
    if (aDobih !== bDobih) return aDobih - bDobih;
    return String(a.name || a.sourceMapId).localeCompare(String(b.name || b.sourceMapId));
  });
  plan.generatedAt = GENERATED_AT;
  writeJson(PORT_PLAN_PATH, plan);
}

function updateSpatialIndex(datasets) {
  const spatial = readJson(SPATIAL_INDEX_PATH);
  spatial.maps = (spatial.maps || []).filter((map) => !String(map.id || '').startsWith(DATASET_ID));
  spatial.features = (spatial.features || []).filter((feature) => !String(feature.mapId || '').startsWith(DATASET_ID));
  for (const dataset of datasets) {
    spatial.maps.push({
      id: dataset.id,
      name: dataset.id === DATASET_ID ? 'Database of British and Irish Hills' : dataset.name,
      file: relativePath(dataset.fgbPath),
      category: 'physical-geography',
      featureCount: dataset.featureCount,
      bounds: dataset.bounds
    });
  }
  // DoBIH has 21k+ summits and classification children repeat many of them.
  // Keep global search lean for Pages; detailed summit search uses the
  // generated per-layer feature indexes in test/metadata/feature-indexes/.
  spatial.maps.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  spatial.features.sort((a, b) => `${a.mapId}:${a.name}`.localeCompare(`${b.mapId}:${b.name}`));
  spatial.generated = GENERATED_AT;
  writeJson(SPATIAL_INDEX_PATH, spatial);
}

function updateFeatureIndexes(datasets) {
  for (const dataset of datasets) {
    const layerId = `${dataset.id}-vector-test`;
    const indexPath = resolve(FEATURE_INDEX_DIR, `${layerId}.json`);
    writeJson(indexPath, {
      layerId,
      itemLimit: Math.max(25000, dataset.records.length),
      totalItems: dataset.records.length,
      truncated: false,
      items: dataset.records.map((record) => ({
        id: record.id,
        name: record.properties.Name || `Hill ${record.id}`,
        aliases: unique([
          record.properties.Name,
          record.properties.ClassificationNames,
          record.properties.County,
          record.properties.Country,
          record.properties['Grid ref'],
          record.properties.GridrefXY
        ].filter(Boolean)),
        center: [Number(record.longitude.toFixed(6)), Number(record.latitude.toFixed(6))]
      }))
    });
  }
}

function updateExternalSources(sourceInventory, datasets) {
  const external = readJson(EXTERNAL_SOURCES_PATH);
  external.schemaVersion = external.schemaVersion || 1;
  external.sources = (external.sources || []).filter((item) => !String(item.id || '').startsWith('external:dobih-v18-4'));

  const coreFiles = sourceInventory.filter((item) => isCoreDobihData(item.name));
  const companionTables = sourceInventory.filter((item) => COMPANION_TABLES.has(item.name));
  const documents = sourceInventory.filter((item) => item.category === 'document' || item.category === 'image' || item.category === 'external-reference');
  const parentDataset = datasets.find((dataset) => dataset.id === DATASET_ID);
  external.sources.push({
    id: 'external:dobih-v18-4:dataset',
    type: 'dataset-source',
    title: 'Database of British and Irish Hills v18.4',
    subtitle: `${parentDataset?.featureCount || 0} summit records / Hill Bagging`,
    category: 'Hill and mountain datasets',
    date: DATASET_DATE,
    provider: ['Database of British and Irish Hills', 'Hill Bagging'],
    description: 'Source record for the DoBIH v18.4 downloadable database used to create Civgraph point layers and hill-list child entries.',
    url: DOBIH_DOWNLOADS_URL,
    references: [
      { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, source: 'Hill Bagging', role: 'source-download-page' },
      { label: 'Hill Bagging', url: DOBIH_ONLINE_URL, source: 'Hill Bagging', role: 'online-database' },
      { label: 'Internet Archive source mirror', url: IA_ITEM_URL, source: 'Internet Archive', role: 'source-mirror' },
      { label: 'Creative Commons Attribution 4.0 International', url: DOBIH_LICENSE_URL, source: 'Creative Commons', role: 'license' }
    ],
    downloads: coreFiles.map(sourceItemToDownload),
    keywords: ['DoBIH', 'Hill Bagging', 'summits', 'mountains', 'hills', 'CC BY 4.0'],
    sourceItems: coreFiles.map(sourceItemToSourceItem),
    license: 'CC BY 4.0',
    publicationStatus: 'metadata-in-repo; raw-source-mirrored-internet-archive'
  });

  for (const item of companionTables) {
    external.sources.push({
      id: `external:dobih-v18-4:table:${slugify(item.name)}`,
      type: 'table-source',
      title: titleFromFile(item.name),
      subtitle: `${item.format} / Hill Bagging companion table`,
      category: 'Hill and mountain tables',
      date: DATASET_DATE,
      provider: ['Database of British and Irish Hills', 'Hill Bagging'],
      description: `Companion table downloaded from Hill Bagging alongside DoBIH v18.4: ${item.name}.`,
      url: item.url,
      references: [
        { label: 'Hill Bagging - DoBIH downloads', url: DOBIH_DOWNLOADS_URL, source: 'Hill Bagging', role: 'source-download-page' },
        { label: 'Internet Archive source mirror', url: item.archiveUrl || IA_ITEM_URL, source: 'Internet Archive', role: 'source-mirror' }
      ],
      downloads: [sourceItemToDownload(item)],
      keywords: ['DoBIH', 'Hill Bagging', 'hill table', item.name],
      sourceItems: [sourceItemToSourceItem(item)],
      license: item.license || 'CC BY 4.0',
      publicationStatus: 'metadata-in-repo; raw-source-mirrored-internet-archive'
    });
  }

  for (const item of documents) {
    external.sources.push({
      id: `external:dobih-v18-4:document:${slugify(item.path)}`,
      type: item.category === 'image' ? 'image-source' : 'document-source',
      title: titleFromFile(item.name),
      subtitle: `${item.format} / ${item.provider}`,
      category: item.category === 'image' ? 'Hill and mountain source images' : 'Hill and mountain documents',
      date: DATASET_DATE,
      provider: [item.provider],
      description: `Source document or supporting file collected from Hill Bagging/DoBIH scrape: ${item.name}.`,
      url: item.url,
      references: [
        { label: item.name, url: item.url, source: item.provider, role: 'source-file' }
      ],
      downloads: [sourceItemToDownload(item)],
      keywords: ['DoBIH', 'Hill Bagging', 'source document', item.name],
      sourceItems: [sourceItemToSourceItem(item)],
      license: item.license || null,
      publicationStatus: item.archiveUrl
        ? 'metadata-in-repo; raw-source-mirrored-internet-archive'
        : 'metadata-in-repo; external-reference-live-link-only'
    });
  }
  writeJson(EXTERNAL_SOURCES_PATH, external);
}

function sourceItemToDownload(item) {
  return compactObject({
    label: `${item.format} - ${item.name}`,
    url: item.url,
    type: item.format,
    bytes: item.bytes,
    sha256: item.sha256,
    archiveStatus: item.archiveStatus,
    archiveItem: item.archiveItem,
    archiveUrl: item.archiveUrl
  });
}

function sourceItemToSourceItem(item) {
  return compactObject({
    id: item.id,
    title: item.name,
    url: item.url,
    localPath: item.path,
    role: item.role,
    format: item.format,
    bytes: item.bytes,
    sha256: item.sha256,
    license: item.license,
    licenseUrl: item.licenseUrl,
    archiveStatus: item.archiveStatus,
    archiveItem: item.archiveItem,
    archiveUrl: item.archiveUrl
  });
}

function computeBounds(records) {
  if (!records.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const record of records) {
    minLng = Math.min(minLng, record.longitude);
    minLat = Math.min(minLat, record.latitude);
    maxLng = Math.max(maxLng, record.longitude);
    maxLat = Math.max(maxLat, record.latitude);
  }
  return [
    [Number(minLat.toFixed(7)), Number(minLng.toFixed(7))],
    [Number(maxLat.toFixed(7)), Number(maxLng.toFixed(7))]
  ];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = resolve(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    if (entry.isFile()) out.push(full);
  }
  return out;
}

function sourceUrlFromRelative(rel) {
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.startsWith('www.hill-bagging.co.uk/')) {
    return `https://${normalized.split('/').map(encodeUrlSegment).join('/')}`;
  }
  if (normalized.startsWith('external/')) {
    return `https://${normalized.replace(/^external\//, '').split('/').map(encodeUrlSegment).join('/')}`;
  }
  return normalized;
}

function archiveUrlFromRelative(rel) {
  return `${IA_DOWNLOAD_BASE}/${rel.split('/').map(encodeUrlSegment).join('/')}`;
}

function providerFromRelative(rel) {
  if (rel.includes('historiccountiestrust.co.uk')) return 'Historic Counties Trust';
  if (rel.includes('ordnancesurvey.co.uk')) return 'Ordnance Survey';
  if (rel.includes('rhb.org.uk')) return 'Relative Hills of Britain';
  return 'External source';
}

function classifySourceFile(name, rel) {
  const extension = extname(name).toLowerCase();
  if (CORE_SOURCE_FILES.has(name)) {
    return { category: 'core-data', role: 'primary-data-export', license: 'CC BY 4.0', licenseUrl: DOBIH_LICENSE_URL };
  }
  if (COMPANION_TABLES.has(name)) {
    return { category: 'companion-table', role: 'companion-table', license: 'CC BY 4.0', licenseUrl: DOBIH_LICENSE_URL };
  }
  if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
    return { category: 'image', role: 'supporting-image', license: null, licenseUrl: null };
  }
  if (rel.startsWith('external/')) {
    return { category: 'external-reference', role: 'external-reference-document', license: null, licenseUrl: null };
  }
  if (extension === '.pdf' || extension === '.pptx' || extension === '.xls' || extension === '.xlsx') {
    return { category: 'document', role: 'supporting-document', license: null, licenseUrl: null };
  }
  return { category: 'supporting-file', role: 'supporting-file', license: null, licenseUrl: null };
}

function isCoreDobihData(name) {
  return CORE_SOURCE_FILES.has(name) || COMPANION_TABLES.has(name);
}

function formatFromExtension(file) {
  const extension = extname(file).replace(/^\./, '').toUpperCase();
  if (extension === 'ZIP') return 'ZIP';
  if (extension === 'CSV') return 'CSV';
  if (extension === 'XLSX') return 'XLSX';
  if (extension === 'XLS') return 'XLS';
  if (extension === 'MDB') return 'MDB';
  if (extension === 'GPI') return 'Garmin POI';
  if (extension === 'PDF') return 'PDF';
  if (extension === 'PPTX') return 'PowerPoint';
  if (extension === 'JPG' || extension === 'JPEG') return 'JPEG';
  return extension || 'File';
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function sourceLayerName(id) {
  return id.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function countryLabel(code) {
  const key = clean(code);
  return {
    S: 'Scotland',
    E: 'England',
    W: 'Wales',
    I: 'Ireland',
    M: 'Isle of Man',
    C: 'Channel Islands'
  }[key] || key;
}

function updateFileById(records, record, key = 'id') {
  const index = records.findIndex((item) => String(item?.[key]) === String(record[key]));
  if (index >= 0) records[index] = record;
  else records.push(record);
}

function upsert(records, record) {
  updateFileById(records, record, 'id');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
    return true;
  }));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value)).filter(Boolean))];
}

function clean(value) {
  return String(value ?? '').trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function titleFromFile(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .replace(/\bDobih\b/g, 'DoBIH')
    .replace(/\bGps\b/g, 'GPS')
    .replace(/\bLidar\b/g, 'LIDAR');
}

function encodeUrlSegment(segment) {
  return encodeURIComponent(segment).replace(/%2F/g, '/').replace(/%20/g, '%20');
}

function quotePwsh(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function relativePath(file) {
  return relative(ROOT, file).replace(/\\/g, '/');
}

main();
