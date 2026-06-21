import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SPATIAL_INDEX = path.join(ROOT, 'data/database/spatial-index.json');
const MAPS_PATH = path.join(ROOT, 'data/database/maps.json');
const OUT_DIR = path.join(ROOT, 'data/database/feature-thumbnails');
const MANIFEST_PATH = path.join(OUT_DIR, '_manifest.json');
const RENDERED_ROOT = path.join(ROOT, 'assets/thumbnails/features');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Unable to read ${path.relative(ROOT, filePath)}: ${error.message}`);
  }
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function safePathSegment(id) {
  return String(id || 'unknown')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function normaliseColour(value, fallback = '#3388ff') {
  const colour = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(colour)) return colour;
  if (/^rgba?\([^)]+\)$/.test(colour)) return colour;
  return fallback;
}

function mapColour(map) {
  return normaliseColour(
    map?.style?.fillColor || map?.style?.color || map?.color || map?.stroke || map?.lineColor,
    '#3388ff'
  );
}

function renderedIdsForMap(mapId) {
  const dir = path.join(RENDERED_ROOT, safePathSegment(mapId));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.webp$/i.test(name))
    .map((name) => name.replace(/\.webp$/i, ''))
    .sort((a, b) => a.localeCompare(b));
}

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === content) return false;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

const spatial = readJson(SPATIAL_INDEX);
const mapsDb = readJson(MAPS_PATH, { maps: [] });
const mapById = new Map((mapsDb.maps || []).map((map) => [String(map.id), map]));
const featureCounts = new Map();
for (const feature of spatial.features || []) {
  const mapId = String(feature.mapId || '');
  if (!mapId) continue;
  featureCounts.set(mapId, (featureCounts.get(mapId) || 0) + 1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const entry of fs.readdirSync(OUT_DIR)) {
  if (entry !== '_manifest.json' && entry.endsWith('.json')) {
    fs.unlinkSync(path.join(OUT_DIR, entry));
  }
}

const maps = {};
let totalRenderedAssetCount = 0;
for (const mapId of Array.from(featureCounts.keys()).sort((a, b) => a.localeCompare(b))) {
  const map = mapById.get(mapId) || { id: mapId, name: mapId };
  const renderedAssetIds = renderedIdsForMap(mapId);
  totalRenderedAssetCount += renderedAssetIds.length;
  maps[mapId] = {
    name: map.name || mapId,
    colour: mapColour(map),
    featureCount: featureCounts.get(mapId),
    renderedAssetBasePath: `assets/thumbnails/features/${safePathSegment(mapId)}/`,
    renderedAssetCount: renderedAssetIds.length,
    renderedAssetIds,
    fallback: 'bbox-locator'
  };
}

const manifest = {
  schemaVersion: 1,
  source: 'data/database/spatial-index.json',
  sourceVersion: spatial.version || null,
  sourceGenerated: spatial.generated || null,
  strategy: 'manifest-backed-feature-thumbnails',
  thumbnailIdAlgorithm: 'fnv1a32(mapId|featureName|bbox8)',
  fallback: 'bbox-locator',
  note: 'Search uses rendered feature thumbnail URLs only when listed in this manifest. Otherwise it falls back to deterministic bbox locator SVGs, avoiding missing-thumbnail request churn and map-layer loads during typing.',
  totalFeatureRecords: Array.from(featureCounts.values()).reduce((sum, count) => sum + count, 0),
  totalMaps: Object.keys(maps).length,
  totalRenderedAssetCount,
  maps
};

const changed = writeIfChanged(MANIFEST_PATH, stableJson(manifest));
console.log(JSON.stringify({
  manifest: path.relative(ROOT, MANIFEST_PATH),
  totalMaps: manifest.totalMaps,
  totalFeatureRecords: manifest.totalFeatureRecords,
  totalRenderedAssetCount,
  changed
}, null, 2));
