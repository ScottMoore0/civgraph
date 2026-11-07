import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SPATIAL_INDEX = path.join(ROOT, 'data/database/spatial-index.json');
const MAPS_PATH = path.join(ROOT, 'data/database/maps.json');
const OUT_DIR = path.join(ROOT, 'data/database/feature-thumbnails');
const MANIFEST_PATH = path.join(OUT_DIR, '_manifest.json');
const DEFAULT_RENDERED_ROOT = path.join(ROOT, 'assets/thumbnails/features');
const RENDERED_ROOT = path.resolve(ROOT, process.env.FEATURE_THUMBNAIL_RENDERED_ROOT || DEFAULT_RENDERED_ROOT);
const PUBLIC_BASE = normalisePublicBase(process.env.FEATURE_THUMBNAIL_PUBLIC_BASE || 'assets/thumbnails/features');
const RENDERED_REGISTRY_PATH = process.env.FEATURE_THUMBNAIL_RENDERED_REGISTRY
  ? path.resolve(ROOT, process.env.FEATURE_THUMBNAIL_RENDERED_REGISTRY)
  : path.join(OUT_DIR, 'rendered-assets.json');
const SUPPORTED_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg', 'avif']);

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

function normalisePublicBase(value) {
  const base = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  return base || 'assets/thumbnails/features';
}

function normaliseExtension(value, fallback = 'webp') {
  const extension = String(value || '').trim().replace(/^\./, '').toLowerCase();
  return SUPPORTED_EXTENSIONS.has(extension) ? extension : fallback;
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

function groupAssetsByExtension(entries) {
  const ids = [];
  const extensionsById = {};
  const counts = new Map();
  for (const entry of entries) {
    ids.push(entry.id);
    const ext = normaliseExtension(entry.extension);
    extensionsById[entry.id] = ext;
    counts.set(ext, (counts.get(ext) || 0) + 1);
  }
  ids.sort((a, b) => a.localeCompare(b));
  const dominantExtension = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'webp';
  const needsPerIdExtensions = Object.values(extensionsById).some((ext) => ext !== dominantExtension);
  return {
    renderedAssetIds: ids,
    renderedAssetExtension: dominantExtension,
    renderedAssetExtensionsById: needsPerIdExtensions ? extensionsById : undefined
  };
}

function renderedAssetsForMapFromLocal(mapId) {
  const dir = path.join(RENDERED_ROOT, safePathSegment(mapId));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const entries = fs.readdirSync(dir)
    .map((name) => {
      const match = name.match(/^(.+)\.([a-z0-9]+)$/i);
      if (!match) return null;
      const extension = normaliseExtension(match[2], '');
      if (!extension) return null;
      return { id: match[1], extension };
    })
    .filter(Boolean);
  if (!entries.length) return null;
  return {
    renderedAssetBasePath: `${PUBLIC_BASE}/${safePathSegment(mapId)}/`,
    ...groupAssetsByExtension(entries)
  };
}

function readRenderedRegistry() {
  if (!fs.existsSync(RENDERED_REGISTRY_PATH)) return { maps: {} };
  const registry = readJson(RENDERED_REGISTRY_PATH, { maps: {} });
  if (!registry || typeof registry !== 'object') return { maps: {} };
  if (!registry.maps || typeof registry.maps !== 'object') registry.maps = {};
  return registry;
}

function renderedAssetsForMapFromRegistry(registry, mapId) {
  const entry = registry.maps?.[mapId];
  if (!entry || typeof entry !== 'object') return null;
  const ids = Array.isArray(entry.renderedAssetIds) ? entry.renderedAssetIds.map(String).filter(Boolean) : [];
  if (!ids.length) return null;
  const base = entry.renderedAssetBasePath
    || `${normalisePublicBase(entry.publicBase || registry.publicBase || PUBLIC_BASE)}/${safePathSegment(mapId)}/`;
  const extension = normaliseExtension(entry.renderedAssetExtension || entry.extension || registry.renderedAssetExtension || registry.extension, 'webp');
  const extensionsById = entry.renderedAssetExtensionsById && typeof entry.renderedAssetExtensionsById === 'object'
    ? Object.fromEntries(Object.entries(entry.renderedAssetExtensionsById).map(([id, ext]) => [id, normaliseExtension(ext, extension)]))
    : undefined;
  return {
    renderedAssetBasePath: base,
    renderedAssetIds: ids.sort((a, b) => a.localeCompare(b)),
    renderedAssetExtension: extension,
    renderedAssetExtensionsById: extensionsById
  };
}

function renderedAssetsForMap(registry, mapId) {
  return renderedAssetsForMapFromRegistry(registry, mapId) || renderedAssetsForMapFromLocal(mapId) || {
    renderedAssetBasePath: `${PUBLIC_BASE}/${safePathSegment(mapId)}/`,
    renderedAssetIds: [],
    renderedAssetExtension: 'webp'
  };
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
const registry = readRenderedRegistry();
const mapById = new Map((mapsDb.maps || []).map((map) => [String(map.id), map]));
const featureCounts = new Map();
for (const feature of spatial.features || []) {
  const mapId = String(feature.mapId || '');
  if (!mapId) continue;
  featureCounts.set(mapId, (featureCounts.get(mapId) || 0) + 1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const maps = {};
let totalRenderedAssetCount = 0;
for (const mapId of Array.from(featureCounts.keys()).sort((a, b) => a.localeCompare(b))) {
  const map = mapById.get(mapId) || { id: mapId, name: mapId };
  const rendered = renderedAssetsForMap(registry, mapId);
  totalRenderedAssetCount += rendered.renderedAssetIds.length;
  maps[mapId] = {
    name: map.name || mapId,
    colour: mapColour(map),
    featureCount: featureCounts.get(mapId),
    renderedAssetBasePath: rendered.renderedAssetBasePath,
    renderedAssetCount: rendered.renderedAssetIds.length,
    renderedAssetExtension: rendered.renderedAssetExtension || 'webp',
    ...(rendered.renderedAssetExtensionsById ? { renderedAssetExtensionsById: rendered.renderedAssetExtensionsById } : {}),
    renderedAssetIds: rendered.renderedAssetIds,
    fallback: 'bbox-locator'
  };
}

const manifest = {
  schemaVersion: 2,
  source: 'data/database/spatial-index.json',
  sourceVersion: spatial.version || null,
  sourceGenerated: spatial.generated || null,
  strategy: 'manifest-backed-feature-thumbnails',
  thumbnailIdAlgorithm: 'fnv1a32(mapId|featureName|bbox8)',
  fallback: 'bbox-locator',
  renderedAssetRoot: path.relative(ROOT, RENDERED_ROOT).replace(/\\/g, '/') || '.',
  renderedAssetPublicBase: PUBLIC_BASE,
  renderedAssetRegistry: fs.existsSync(RENDERED_REGISTRY_PATH) ? path.relative(ROOT, RENDERED_REGISTRY_PATH).replace(/\\/g, '/') : null,
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
  renderedAssetRoot: manifest.renderedAssetRoot,
  renderedAssetPublicBase: manifest.renderedAssetPublicBase,
  changed
}, null, 2));
