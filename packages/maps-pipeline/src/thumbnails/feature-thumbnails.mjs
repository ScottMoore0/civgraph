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
 *   node packages/maps-pipeline/src/thumbnails/feature-thumbnails.mjs --map counties-ireland --limit 3
 *   node packages/maps-pipeline/src/thumbnails/feature-thumbnails.mjs --all --output D:/civgraph-feature-thumbnails
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import { SITE } from '../../../config/src/node.mjs';

const ROOT = process.cwd();
const MAPS_PATH = path.join(ROOT, 'data/database/maps.json');
const SPATIAL_INDEX_PATH = path.join(ROOT, 'data/database/spatial-index.json');
const DEFAULT_OUTPUT_ROOT = path.join(ROOT, 'tmp/feature-thumbnails-rendered');
const WIDTH = 128;
const HEIGHT = 128;
const PADDING = 9;
const BLANK_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

/**
 * @typedef {import('geojson').Geometry} Geometry
 * @typedef {import('geojson').Position} Position
 * @typedef {number[]} Bbox   [minX, minY, maxX, maxY]
 * @typedef {import('canvas').Canvas} Canvas
 *
 * The command line.
 * @typedef {object} Args
 * @property {string[]} mapIds
 * @property {boolean} all
 * @property {boolean} force
 * @property {number} limit
 * @property {string} output      absolute
 * @property {string} format      'png' or 'webp'
 * @property {string} registry    absolute
 * @property {boolean} [help]
 *
 * One map of maps.json, as far as this reads it.
 * @typedef {object} MapRecord
 * @property {string} id
 * @property {string} [name]
 * @property {{ fgb?: string }} [files]
 * @property {string} [cloneOf]
 * @property {string} [labelProperty]
 * @property {string[]} [labelPropertyFallbacks]
 * @property {string} [labelCleanup]
 * @property {{ fillColor?: string, color?: string }} [style]
 * @property {string} [color]
 * @property {string} [stroke]
 * @property {string} [lineColor]
 *
 * One feature of spatial-index.json, as far as this reads it (the rest is kept as it is).
 * @typedef {{ mapId?: string, name?: string, bbox?: Bbox }} SpatialFeature
 * @typedef {SpatialFeature & { __thumbnailSpatialKey: string }} SpatialEntry
 * @typedef {Map<string, Map<string, SpatialEntry[]>>} SpatialLookup   map id -> name key -> features
 *
 * A path to draw: a ring or line, or a point.
 * @typedef {{ points?: Position[], close?: boolean, point?: Position }} DrawPath
 *
 * @typedef {'image/png' | 'image/webp'} OutputMime
 * node-canvas's typings list only the MIME types it documents. webp is asked for anyway: an
 * encoder without it throws (canvasCanEncodeWebp) or returns nothing (encodeCanvas).
 * @typedef {{ toBuffer(mimeType: string): Buffer }} Encoder
 *
 * @typedef {object} MapResult   one map's line of the render report
 * @property {string} mapId
 * @property {string} name
 * @property {string | null} source
 * @property {string | null} sourceQuality
 * @property {number} targetFeatureCount
 * @property {number} generated
 * @property {number} existing
 * @property {number} skipped
 * @property {number} unmatched
 * @property {string[]} errors
 *
 * @typedef {object} RenderContext
 * @property {Map<string, MapRecord>} mapById
 * @property {SpatialLookup} spatialLookup
 * @property {string} outputRoot
 * @property {OutputMime} mime
 * @property {string} extension
 * @property {boolean} force
 * @property {{ remaining: number }} limitState
 */

/**
 * @param {string[]} argv
 * @returns {Args}
 */
function parseArgs(argv) {
  /** @type {Omit<Args, 'registry'> & { registry: string | null }} */
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
  const registry = args.registry ? path.resolve(ROOT, args.registry) : path.join(args.output, '_rendered-assets-registry.json');
  args.format = normaliseExtension(args.format, 'png');
  return Object.assign(args, { registry });
}

function printHelp() {
  console.log(`Usage: node packages/maps-pipeline/src/thumbnails/feature-thumbnails.mjs [--map id[,id]] [--all] [--limit n] [--output dir] [--format png|webp] [--force]\n\nRendered assets are local/CDN artifacts and are not meant to be committed to Pages.`);
}

/** @param {string} filePath @returns {unknown} */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** @param {string} filePath @param {unknown} value */
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** @param {unknown} id */
function safePathSegment(id) {
  return String(id || 'unknown')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

/** @param {unknown} bbox */
function bboxKey(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return '';
  return bbox.map((value) => Number.isFinite(Number(value)) ? Number(value).toFixed(8) : '').join(',');
}

/** @param {unknown} value */
function thumbnailHash(value) {
  let hash = 0x811c9dc5;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** @param {string} mapId @param {string} featureName @param {Bbox | null | undefined} bbox */
function thumbnailIdFor(mapId, featureName, bbox) {
  const safeMapId = safePathSegment(mapId || 'feature') || 'feature';
  const hash = thumbnailHash(String(mapId || '') + '|' + String(featureName || '') + '|' + bboxKey(bbox));
  return `feature-${safeMapId}-${hash}`;
}

/** @param {unknown} value @param {string} [fallback] */
function normaliseExtension(value, fallback = 'png') {
  const extension = String(value || '').trim().replace(/^\./, '').toLowerCase();
  if (extension === 'webp' || extension === 'png') return extension;
  return fallback;
}

function canvasCanEncodeWebp() {
  try {
    /** @type {Encoder} */
    const canvas = createCanvas(2, 2);
    const buffer = canvas.toBuffer('image/webp');
    return Buffer.isBuffer(buffer) && buffer.length > 0;
  } catch {
    return false;
  }
}

/** @param {string} format @returns {OutputMime} */
function outputMime(format) {
  if (format === 'webp' && canvasCanEncodeWebp()) return 'image/webp';
  return 'image/png';
}

/** @param {string} format */
function outputExtension(format) {
  return outputMime(format) === 'image/webp' ? 'webp' : 'png';
}

/** @param {unknown} value */
function normaliseName(value) {
  return String(value || '').trim();
}

/** @param {unknown} value */
function matchKey(value) {
  return normaliseName(value).toLocaleLowerCase('en-IE');
}

/** @param {unknown} value @param {string} [fallback] */
function normaliseColour(value, fallback = '#3388ff') {
  const colour = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colour)) return colour;
  if (/^#[0-9a-fA-F]{3}$/.test(colour)) {
    return '#' + colour.slice(1).split('').map((char) => char + char).join('');
  }
  return fallback;
}

/** @param {string} hex @param {number} alpha */
function hexToRgba(hex, alpha) {
  const colour = normaliseColour(hex, '#3388ff').replace('#', '');
  const r = Number.parseInt(colour.slice(0, 2), 16);
  const g = Number.parseInt(colour.slice(2, 4), 16);
  const b = Number.parseInt(colour.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** @param {MapRecord} map */
function mapColour(map) {
  return normaliseColour(map?.style?.fillColor || map?.style?.color || map?.color || map?.stroke || map?.lineColor, '#3388ff');
}

/** @param {string | undefined} sourcePath @returns {string | null} */
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

/**
 * @param {MapRecord} map
 * @param {Map<string, MapRecord>} mapById
 * @returns {{ path: string, quality: string } | null}
 */
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

/** @param {Geometry} geometry @returns {Bbox | null} */
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

/** @param {Geometry | null | undefined} geometry @returns {[number, number][]} */
function collectCoords(geometry) {
  /** @type {[number, number][]} */
  const coords = [];
  /** @param {unknown} value */
  function walk(value) {
    if (!Array.isArray(value)) return;
    /** @type {unknown[]} */
    const items = value;
    const x = items[0];
    const y = items[1];
    if (typeof x === 'number' && typeof y === 'number') {
      coords.push([x, y]);
      return;
    }
    for (const child of items) walk(child);
  }
  if (geometry && 'coordinates' in geometry && geometry.coordinates) walk(geometry.coordinates);
  return coords;
}

/** @param {Geometry | null | undefined} geometry @returns {DrawPath[]} */
function collectPaths(geometry) {
  /** @type {DrawPath[]} */
  const paths = [];
  if (!geometry || !('coordinates' in geometry) || !geometry.coordinates) return paths;
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) paths.push({ points: ring, close: true });
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) for (const ring of polygon) paths.push({ points: ring, close: true });
  } else if (geometry.type === 'LineString') {
    paths.push({ points: geometry.coordinates, close: false });
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) paths.push({ points: line, close: false });
  } else if (geometry.type === 'Point') {
    paths.push({ point: geometry.coordinates });
  } else if (geometry.type === 'MultiPoint') {
    for (const point of geometry.coordinates) paths.push({ point });
  }
  return paths;
}

/** @param {Bbox | null} bbox @returns {Bbox | null} */
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

/**
 * @param {Geometry} geometry
 * @param {string} colour
 * @returns {Canvas | Buffer}   the blank GIF when the geometry has no extent
 */
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
  const project = (/** @type {number} */ lon, /** @type {number} */ lat) => [offX + (lon - minX) * scale, offY + (maxY - lat) * scale];

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

/** @param {Canvas | Buffer} canvas @param {OutputMime} mime @returns {Buffer} */
function encodeCanvas(canvas, mime) {
  if (Buffer.isBuffer(canvas)) return canvas;
  /** @type {Encoder} */
  const encoder = canvas;
  const buffer = encoder.toBuffer(mime);
  if (Buffer.isBuffer(buffer) && buffer.length > 0) return buffer;
  return canvas.toBuffer('image/png');
}

/** @param {{ features?: SpatialFeature[] }} spatial @returns {SpatialLookup} */
function buildSpatialLookup(spatial) {
  /** @type {SpatialLookup} */
  const byMap = new Map();
  let index = 0;
  for (const feature of spatial.features || []) {
    const mapId = String(feature.mapId || '');
    const name = normaliseName(feature.name || '');
    if (!mapId || !name) continue;
    let mapLookup = byMap.get(mapId);
    if (!mapLookup) byMap.set(mapId, mapLookup = new Map());
    const key = matchKey(name);
    let entries = mapLookup.get(key);
    if (!entries) mapLookup.set(key, entries = []);
    entries.push({
      ...feature,
      __thumbnailSpatialKey: `${mapId}|${key}|${bboxKey(feature.bbox)}|${index}`
    });
    index += 1;
  }
  return byMap;
}

/** @param {SpatialLookup} spatialLookup @param {string} mapId */
function spatialFeatureCount(spatialLookup, mapId) {
  let count = 0;
  const lookup = spatialLookup.get(mapId);
  if (!lookup) return count;
  for (const entries of lookup.values()) count += entries.length;
  return count;
}

/** @param {Bbox | null | undefined} bbox */
function bboxAreaValue(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return 0;
  return Math.max(0, Number(bbox[2]) - Number(bbox[0])) * Math.max(0, Number(bbox[3]) - Number(bbox[1]));
}

/** @param {Bbox | null | undefined} a @param {Bbox | null | undefined} b */
function bboxIntersectionArea(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const minX = Math.max(Number(a[0]), Number(b[0]));
  const minY = Math.max(Number(a[1]), Number(b[1]));
  const maxX = Math.min(Number(a[2]), Number(b[2]));
  const maxY = Math.min(Number(a[3]), Number(b[3]));
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

/** @param {Bbox | null | undefined} a @param {Bbox | null | undefined} b */
function bboxCenterDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Number.POSITIVE_INFINITY;
  const ax = (Number(a[0]) + Number(a[2])) / 2;
  const ay = (Number(a[1]) + Number(a[3])) / 2;
  const bx = (Number(b[0]) + Number(b[2])) / 2;
  const by = (Number(b[1]) + Number(b[3])) / 2;
  return Math.hypot(ax - bx, ay - by);
}

/** @param {SpatialFeature} spatialFeature @param {Bbox | null} sourceBbox */
function spatialMatchScore(spatialFeature, sourceBbox) {
  const targetBbox = spatialFeature?.bbox;
  const intersection = bboxIntersectionArea(targetBbox, sourceBbox);
  const union = bboxAreaValue(targetBbox) + bboxAreaValue(sourceBbox) - intersection;
  const iou = union > 0 ? intersection / union : 0;
  return {
    iou,
    distance: bboxCenterDistance(targetBbox, sourceBbox)
  };
}

/**
 * The best unclaimed spatial-index feature of this name for a source feature, by bbox overlap
 * then centre distance; it is claimed.
 * @param {SpatialLookup} spatialLookup
 * @param {Set<string>} claimedSpatialIds
 * @param {string} mapId
 * @param {string} name
 * @param {Bbox | null} sourceBbox
 * @returns {SpatialEntry | null}
 */
function resolveSpatialFeature(spatialLookup, claimedSpatialIds, mapId, name, sourceBbox) {
  const entries = spatialLookup.get(mapId)?.get(matchKey(name)) || [];
  const candidates = entries.filter((entry) => !claimedSpatialIds.has(entry.__thumbnailSpatialKey));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const scoreA = spatialMatchScore(a, sourceBbox);
    const scoreB = spatialMatchScore(b, sourceBbox);
    if (scoreB.iou !== scoreA.iou) return scoreB.iou - scoreA.iou;
    return scoreA.distance - scoreB.distance;
  });
  const selected = candidates[0];
  claimedSpatialIds.add(selected.__thumbnailSpatialKey);
  return selected;
}

/** @param {MapRecord} map @param {import('geojson').GeoJsonProperties} properties */
function featureNameFromProperties(map, properties) {
  const keys = [map.labelProperty, ...(Array.isArray(map.labelPropertyFallbacks) ? map.labelPropertyFallbacks : [])]
    .filter(/** @param {string | undefined} key @returns {key is string} */ (key) => Boolean(key));
  for (const key of keys) {
    const value = normaliseName(properties?.[key]);
    if (value) return value;
  }
  return '';
}

/** @param {MapRecord} map @param {string} name */
function applyLabelCleanup(map, name) {
  if (map.labelCleanup === 'stripTrailingBracketNumber') return name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return name;
}

/**
 * @param {MapRecord} map
 * @param {RenderContext} context
 * @returns {Promise<MapResult>}
 */
async function renderMap(map, context) {
  const { mapById, spatialLookup, outputRoot, mime, extension, force, limitState } = context;
  const source = resolveSourceFile(map, mapById);
  const targetFeatureCount = spatialFeatureCount(spatialLookup, map.id);
  /** @type {MapResult} */
  const result = {
    mapId: map.id,
    name: map.name || map.id,
    source: source ? path.relative(ROOT, source.path).replace(/\\/g, '/') : null,
    sourceQuality: source?.quality || null,
    targetFeatureCount,
    generated: 0,
    existing: 0,
    skipped: 0,
    unmatched: 0,
    errors: []
  };
  if (!targetFeatureCount) {
    result.errors.push('No searchable spatial-index features found.');
    return result;
  }
  if (!source) {
    result.unmatched = targetFeatureCount;
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
  /** @type {Set<string>} */
  const claimedSpatialIds = new Set();
  const buffer = new Uint8Array(fs.readFileSync(source.path));

  for await (const feature of deserialize(buffer)) {
    if (limitState.remaining <= 0) break;
    let featureName = applyLabelCleanup(map, featureNameFromProperties(map, feature.properties || {}));
    featureName = normaliseName(featureName);
    if (!featureName || !feature.geometry) {
      result.skipped += 1;
      continue;
    }
    const sourceBbox = computeBbox(feature.geometry);
    const spatialFeature = resolveSpatialFeature(spatialLookup, claimedSpatialIds, map.id, featureName, sourceBbox);
    if (!spatialFeature) {
      result.skipped += 1;
      continue;
    }
    const bbox = spatialFeature.bbox || sourceBbox;
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
  result.unmatched = Math.max(0, targetFeatureCount - claimedSpatialIds.size);
  return result;
}

/**
 * @param {Args} args
 * @param {MapRecord[]} maps
 * @param {SpatialLookup} spatialLookup
 * @returns {MapRecord[]}
 */
function selectMaps(args, maps, spatialLookup) {
  const mapById = new Map(maps.map((map) => [String(map.id), map]));
  if (args.mapIds.length) {
    return args.mapIds.map((id) => mapById.get(id)).filter((map) => map !== undefined);
  }
  if (args.all) {
    return maps.filter((map) => (map.files?.fgb || map.cloneOf) && spatialFeatureCount(spatialLookup, map.id) > 0);
  }
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
  const mapsDb = /** @type {{ maps?: MapRecord[] }} */ (readJson(MAPS_PATH));
  const spatial = /** @type {{ features?: SpatialFeature[] }} */ (readJson(SPATIAL_INDEX_PATH));
  const maps = mapsDb.maps || [];
  const mapById = new Map(maps.map((map) => [String(map.id), map]));
  const spatialLookup = buildSpatialLookup(spatial);
  const selectedMaps = selectMaps(args, maps, spatialLookup);
  fs.mkdirSync(args.output, { recursive: true });
  /** @type {RenderContext} */
  const context = {
    mapById,
    spatialLookup,
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
    /** @type {MapResult[]} */
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
    publicBase: process.env.FEATURE_THUMBNAIL_PUBLIC_BASE || `${SITE.dataOrigin}/data/thumbnails/features`,
    extension,
    /** @type {Record<string, { renderedAssetIds: string[], renderedAssetExtension: string }>} */
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

main().catch((/** @type {Error} */ error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
