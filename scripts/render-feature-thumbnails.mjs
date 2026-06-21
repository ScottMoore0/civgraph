#!/usr/bin/env node
/**
 * Render per-feature thumbnails from local map geometry.
 *
 * The browser computes thumbnail IDs from mapId, feature name, and the search
 * bbox. This script mirrors that ID algorithm, reads each map's FlatGeobuf
 * geometry, and writes image files into a local output root. The output root is
 * intentionally outside the deployable Pages tree by default; upload/sync those
 * assets to R2/CDN, then provide the public base path to the manifest builder.
 *
 * Examples:
 *   node scripts/render-feature-thumbnails.mjs --map counties-ireland --limit 3
 *   node scripts/render-feature-thumbnails.mjs --all --output D:/civgraph-feature-thumbnails
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';

const ROOT = process.cwd();
const MAPS_PATH = path.join(ROOT, 'data/database/maps.json');
const SPATIAL_INDEX_PATH = path.join(ROOT, 'data/database/spatial-index.json');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'tmp/feature-thumbnails-rendered');
const WIDTH = 128;
const HEIGHT = 128;
const PADDING = 9;
const BLANK_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function parseArgs(argv) {
  const args = {
    mapIds: [],
    all: false,
    force: false,
    limit: Infinity,
    output: process.env.FEATURE_THUMBNAIL_RENDERED_ROOT || DEFAULT_OUTPUT_ROOT,
    format: process.env.FEATURE_THUMBNAIL_FORMAT || 'png',
    registry: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') args.all = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--map' || arg === '--maps') {
      const value = argv[++index] || '';
      args.mapIds.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg.startsWith('--map=')) {
      args.mapIds.push(...arg.slice('--map='.length).split(',').map((item) => item.trim()).filter(Boolean));
    } else if (arg === '--limit') {
      args.limit = Math.max(0, Number(argv[++index] || 0));
    } else if (arg.startsWith('--limit=')) {
      args.limit = Math.max(0, Number(arg.slice('--limit='.length) || 0));
    } else if (arg === '--output') {
      args.output = argv[++index] || args.output;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length) || args.output;
    } else if (arg === '--format') {
      args.format = argv[++index] || args.format;
    } else if (arg.startsWith('--format=')) {
      args.format = arg.slice('--format='.length) || args.format;
    } else if (arg === '--registry') {
      args.registry = argv[++index] || null;
    } else if (arg.startsWith('--registry=')) {
      args.registry = arg.slice('--registry='.length) || null;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  args.output = path.resolve(ROOT, args.output);
  args.registry = args.registry ? path.resolve(ROOT, args.registry) : path.join(args.output, '_rendered-assets-registry.json');
  args.format = normaliseExtension(args.format, 'png');
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/render-feature-thumbnails.mjs [--map id[,id]] [--all] [--limit n] [--output dir] [--format png|webp] [--force]\n\nRendered assets are local/CDN artifacts and are not meant to be committed to Pages.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function safePathSegment(id) {
  return String(id || 'unknown')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

function bboxKey(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return '';
  return bbox.map((value) => Number.isFinite(Number(value)) ? Number(value).toFixed(8) : '').join(',');
}

function thumbnailHash(value) {
  let hash = 0x811c9dc5;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function thumbnailIdFor(mapId, featureName, bbox) {
  const safeMapId = safePathSegment(mapId || 'feature') || 'feature';
  const hash = thumbnailHash(String(mapId || '') + '|' + String(featureName || '') + '|' + bboxKey(bbox));
  return `feature-${safeMapId}-${hash}`;
}

function normaliseExtension(value, fallback = 'png') {
  const extension = String(value || '').trim().replace(/^\./, '').toLowerCase();
  if (extension === 'webp' || extension === 'png') return extension;
  return fallback;
}

function canvasCanEncodeWebp() {
  try {
    const canvas = createCanvas(2, 2);
    const buffer = canvas.toBuffer('image/webp');
    return Buffer.isBuffer(buffer) && buffer.length > 0;
  } catch {
    return false;
  }
}

function outputMime(format) {
  if (format === 'webp' && canvasCanEncodeWebp()) return 'image/webp';
  return 'image/png';
}

function outputExtension(format) {
  return outputMime(format) === 'image/webp' ? 'webp' : 'png';
}

function normaliseName(value) {
  return String(value || '').trim();
}

function matchKey(value) {
  return normaliseName(value).toLocaleLowerCase('en-IE');
}

function normaliseColour(value, fallback = '#3388ff') {
  const colour = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colour)) return colour;
  if (/^#[0-9a-fA-F]{3}$/.test(colour)) {
    return '#' + colour.slice(1).split('').map((char) => char + char).join('');
  }
  return fallback;
}

function hexToRgba(hex, alpha) {
  const colour = normaliseColour(hex, '#3388ff').replace('#', '');
  const r = Number.parseInt(colour.slice(0, 2), 16);
  const g = Number.parseInt(colour.slice(2, 4), 16);
  const b = Number.parseInt(colour.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mapColour(map) {
  return normaliseColour(map?.style?.fillColor || map?.style?.color || map?.color || map?.stroke || map?.lineColor, '#3388ff');
}

function localiseFgbPath(sourcePath) {
  if (!sourcePath) return null;
  const value = String(sourcePath);
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname !== 'data.civgraph.net') return null;
      return path.join(ROOT, decodeURIComponent(url.pathname.replace(/^\/+/, '')));
    } catch {
      return null;
    }
  }
  return path.isAbsolute(value) ? value : path.join(ROOT, value.replace(/^\/+/, ''));
}

function resolveSourceFile(map, mapById) {
  let sourcePath = map?.files?.fgb;
  if (!sourcePath && map?.cloneOf) {
    const sourceMap = mapById.get(String(map.cloneOf));
    sourcePath = sourceMap?.files?.fgb;
  }
  const candidates = [];
  const localPath = localiseFgbPath(sourcePath);
  if (localPath) {
    candidates.push({ path: localPath, quality: 'full' });
    candidates.push({ path: localPath.replace(/\.fgb$/i, '-lod1.fgb'), quality: 'lod1' });
    candidates.push({ path: localPath.replace(/\.fgb$/i, '-lod0.fgb'), quality: 'lod0' });
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).size > 200) return candidate;
  }
  return null;
}

function computeBbox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of collectCoords(geometry)) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return [minX, minY, maxX, maxY];
}

function collectCoords(geometry) {
  const coords = [];
  function walk(value) {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      coords.push([value[0], value[1]]);
      return;
    }
    for (const child of value) walk(child);
  }
  if (geometry?.coordinates) walk(geometry.coordinates);
  return coords;
}

function collectPaths(geometry) {
  const paths = [];
  const type = geometry?.type;
  const coordinates = geometry?.coordinates;
  if (!coordinates) return paths;
  if (type === 'Polygon') {
    for (const ring of coordinates) paths.push({ points: ring, close: true });
  } else if (type === 'MultiPolygon') {
    for (const polygon of coordinates) for (const ring of polygon) paths.push({ points: ring, close: true });
  } else if (type === 'LineString') {
    paths.push({ points: coordinates, close: false });
  } else if (type === 'MultiLineString') {
    for (const line of coordinates) paths.push({ points: line, close: false });
  } else if (type === 'Point') {
    paths.push({ point: coordinates });
  } else if (type === 'MultiPoint') {
    for (const point of coordinates) paths.push({ point });
  }
  return paths;
}

function expandedBbox(bbox) {
  if (!bbox) return null;
  let [minX, minY, maxX, maxY] = bbox;
  let width = maxX - minX;
  let height = maxY - minY;
  const span = Math.max(width, height, 0.00001);
  if (width <= 0) {
    minX -= span / 2;
    maxX += span / 2;
    width = maxX - minX;
  }
  if (height <= 0) {
    minY -= span / 2;
    maxY += span / 2;
    height = maxY - minY;
  }
  const padX = width * 0.04;
  const padY = height * 0.04;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

function renderFeatureThumbnail(geometry, colour) {
  const bbox = expandedBbox(computeBbox(geometry));
  if (!bbox) return BLANK_GIF;
  const [minX, minY, maxX, maxY] = bbox;
  const geoW = maxX - minX;
  const geoH = maxY - minY;
  const drawW = WIDTH - PADDING * 2;
  const drawH = HEIGHT - PADDING * 2;
  const scale = Math.min(drawW / geoW, drawH / geoH);
  const offX = PADDING + (drawW - geoW * scale) / 2;
  const offY = PADDING + (drawH - geoH * scale) / 2;
  const project = (lon, lat) => [offX + (lon - minX) * scale, offY + (maxY - lat) * scale];

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.strokeStyle = '#d9e2ec';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1);

  const paths = collectPaths(geometry);
  const stroke = normaliseColour(colour, '#3388ff');
  ctx.fillStyle = hexToRgba(stroke, 0.24);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = geometry?.type?.includes('Line') ? 2.4 : 1.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const item of paths) {
    if (item.point) {
      const [x, y] = project(item.point[0], item.point[1]);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      continue;
    }
    if (!Array.isArray(item.points) || item.points.length === 0) continue;
    ctx.beginPath();
    item.points.forEach((point, index) => {
      const [x, y] = project(point[0], point[1]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (item.close) {
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
  }
  return canvas;
}

function encodeCanvas(canvas, mime) {
  if (Buffer.isBuffer(canvas)) return canvas;
  const buffer = canvas.toBuffer(mime);
  if (Buffer.isBuffer(buffer) && buffer.length > 0) return buffer;
  return canvas.toBuffer('image/png');
}

function buildSpatialLookup(spatial) {
  const byMap = new Map();
  for (const feature of spatial.features || []) {
    const mapId = String(feature.mapId || '');
    const name = normaliseName(feature.name || '');
    if (!mapId || !name) continue;
    if (!byMap.has(mapId)) byMap.set(mapId, new Map());
    const mapLookup = byMap.get(mapId);
    const key = matchKey(name);
    if (!mapLookup.has(key)) mapLookup.set(key, []);
    mapLookup.get(key).push(feature);
  }
  return byMap;
}

function resolveSpatialFeature(spatialLookup, mapId, name) {
  const entries = spatialLookup.get(mapId)?.get(matchKey(name));
  return entries?.[0] || null;
}

function featureNameFromProperties(map, properties) {
  const keys = [map.labelProperty, ...(Array.isArray(map.labelPropertyFallbacks) ? map.labelPropertyFallbacks : [])].filter(Boolean);
  for (const key of keys) {
    const value = normaliseName(properties?.[key]);
    if (value) return value;
  }
  return '';
}

function applyLabelCleanup(map, name) {
  if (map.labelCleanup === 'stripTrailingBracketNumber') return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return name;
}

async function renderMap(map, context) {
  const { mapById, spatialLookup, outputRoot, mime, extension, force, limitState } = context;
  const source = resolveSourceFile(map, mapById);
  const result = {
    mapId: map.id,
    name: map.name || map.id,
    source: source ? path.relative(ROOT, source.path).replace(/\\/g, '/') : null,
    sourceQuality: source?.quality || null,
    generated: 0,
    existing: 0,
    skipped: 0,
    unmatched: 0,
    errors: []
  };
  if (!source) {
    result.errors.push('No local FlatGeobuf source found.');
    return result;
  }
  if (!map.labelProperty && !Array.isArray(map.labelPropertyFallbacks)) {
    result.errors.push('No labelProperty configured.');
    return result;
  }

  const mapOutputDir = path.join(outputRoot, safePathSegment(map.id));
  fs.mkdirSync(mapOutputDir, { recursive: true });
  const colour = mapColour(map);
  const seenNames = new Set();
  const buffer = new Uint8Array(fs.readFileSync(source.path));

  for await (const feature of deserialize(buffer)) {
    if (limitState.remaining <= 0) break;
    let featureName = applyLabelCleanup(map, featureNameFromProperties(map, feature.properties || {}));
    featureName = normaliseName(featureName);
    if (!featureName || !feature.geometry) {
      result.skipped += 1;
      continue;
    }
    const duplicateKey = matchKey(featureName);
    if (seenNames.has(duplicateKey)) {
      result.skipped += 1;
      continue;
    }
    seenNames.add(duplicateKey);
    const spatialFeature = resolveSpatialFeature(spatialLookup, map.id, featureName);
    if (!spatialFeature) result.unmatched += 1;
    const bbox = spatialFeature?.bbox || computeBbox(feature.geometry);
    const thumbnailId = thumbnailIdFor(map.id, featureName, bbox);
    const outPath = path.join(mapOutputDir, `${thumbnailId}.${extension}`);
    if (!force && fs.existsSync(outPath)) {
      result.existing += 1;
      limitState.remaining -= 1;
      continue;
    }
    const canvas = renderFeatureThumbnail(feature.geometry, colour);
    fs.writeFileSync(outPath, encodeCanvas(canvas, mime));
    result.generated += 1;
    limitState.remaining -= 1;
  }
  return result;
}

function selectMaps(args, maps) {
  const mapById = new Map(maps.map((map) => [String(map.id), map]));
  if (args.mapIds.length) {
    return args.mapIds.map((id) => mapById.get(id)).filter(Boolean);
  }
  if (args.all) return maps.filter((map) => map.files?.fgb || map.cloneOf);
  throw new Error('Refusing to render every feature implicitly. Pass --map <id> for targeted rendering or --all for the full corpus.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const mime = outputMime(args.format);
  const extension = outputExtension(args.format);
  const mapsDb = readJson(MAPS_PATH);
  const spatial = readJson(SPATIAL_INDEX_PATH);
  const maps = mapsDb.maps || [];
  const mapById = new Map(maps.map((map) => [String(map.id), map]));
  const selectedMaps = selectMaps(args, maps);
  fs.mkdirSync(args.output, { recursive: true });
  const context = {
    mapById,
    spatialLookup: buildSpatialLookup(spatial),
    outputRoot: args.output,
    mime,
    extension,
    force: args.force,
    limitState: { remaining: Number.isFinite(args.limit) ? args.limit : Infinity }
  };
  const report = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    outputRoot: path.relative(ROOT, args.output).replace(/\\/g, '/') || '.',
    imageFormat: extension,
    imageMime: mime,
    requestedMaps: args.mapIds,
    all: args.all,
    limit: Number.isFinite(args.limit) ? args.limit : null,
    maps: [],
    totals: { generated: 0, existing: 0, skipped: 0, unmatched: 0, errors: 0 }
  };

  for (const map of selectedMaps) {
    if (context.limitState.remaining <= 0) break;
    const result = await renderMap(map, context);
    report.maps.push(result);
    report.totals.generated += result.generated;
    report.totals.existing += result.existing;
    report.totals.skipped += result.skipped;
    report.totals.unmatched += result.unmatched;
    report.totals.errors += result.errors.length;
    console.log(`${map.id}: generated=${result.generated} existing=${result.existing} skipped=${result.skipped} unmatched=${result.unmatched}${result.errors.length ? ` errors=${result.errors.join('; ')}` : ''}`);
  }

  const registry = {
    schemaVersion: 1,
    generated: report.generated,
    publicBase: process.env.FEATURE_THUMBNAIL_PUBLIC_BASE || 'https://data.civgraph.net/data/thumbnails/features',
    extension,
    maps: {}
  };
  for (const mapResult of report.maps) {
    const dir = path.join(args.output, safePathSegment(mapResult.mapId));
    if (!fs.existsSync(dir)) continue;
    const ids = fs.readdirSync(dir)
      .filter((name) => name.endsWith(`.${extension}`))
      .map((name) => name.slice(0, -1 * (`.${extension}`).length))
      .sort((a, b) => a.localeCompare(b));
    if (!ids.length) continue;
    registry.maps[mapResult.mapId] = {
      renderedAssetIds: ids,
      renderedAssetExtension: extension
    };
  }

  writeJson(path.join(args.output, '_render-report.json'), report);
  writeJson(args.registry, registry);
  console.log(JSON.stringify({
    outputRoot: report.outputRoot,
    imageFormat: extension,
    report: path.relative(ROOT, path.join(args.output, '_render-report.json')).replace(/\\/g, '/'),
    registry: path.relative(ROOT, args.registry).replace(/\\/g, '/'),
    totals: report.totals
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
