#!/usr/bin/env node
/**
 * Validate that chunked maps have deterministic full-map fit bounds.
 *
 * A chunked map is safe if it has explicit metadata bounds, or if its local
 * chunk index contains a full bbox / valid chunk bboxes that the controller
 * can use as a fallback. The script deliberately does not fetch network URLs.
 *
 * Usage:
 *   node scripts/validate-chunked-map-bounds.mjs
 *   node scripts/validate-chunked-map-bounds.mjs --fix
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.cwd());
const MAPS_PATH = resolve(ROOT, 'data/database/maps.json');
const URL_PREFIXES = [
  'https://data.civgraph.net/',
  'https://civgraph.net/'
];

const IRELAND_BBOX_LIMITS = {
  west: -12.5,
  south: 49.0,
  east: -4.0,
  north: 57.0
};

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidBbox(value) {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [west, south, east, north] = value.map(asFiniteNumber);
  if ([west, south, east, north].some((number) => number === null)) return false;
  if (!(west < east && south < north)) return false;
  if (west < IRELAND_BBOX_LIMITS.west || east > IRELAND_BBOX_LIMITS.east) return false;
  if (south < IRELAND_BBOX_LIMITS.south || north > IRELAND_BBOX_LIMITS.north) return false;
  return true;
}

function isValidBounds(value) {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [southWest, northEast] = value;
  if (!Array.isArray(southWest) || !Array.isArray(northEast)) return false;
  if (southWest.length !== 2 || northEast.length !== 2) return false;
  const [south, west] = southWest.map(asFiniteNumber);
  const [north, east] = northEast.map(asFiniteNumber);
  if ([west, south, east, north].some((number) => number === null)) return false;
  return isValidBbox([west, south, east, north]);
}

function bboxToBounds(bbox) {
  return [
    [roundCoord(bbox[1]), roundCoord(bbox[0])],
    [roundCoord(bbox[3]), roundCoord(bbox[2])]
  ];
}

function roundCoord(value) {
  return Number(Number(value).toFixed(8));
}

function localizeMapPath(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || pathOrUrl.length === 0) return null;
  let path = pathOrUrl.replaceAll('\\', '/');
  for (const prefix of URL_PREFIXES) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  path = path.replace(/^\/+/, '');
  return path || null;
}

function chunkIndexPathFor(entry) {
  const fgbPath = localizeMapPath(entry?.files?.fgb);
  if (!fgbPath) return null;
  const directory = dirname(fgbPath).replaceAll('\\', '/');
  return `${directory}/${entry.id}-chunks.json`;
}

function unionBboxes(bboxes) {
  return bboxes.reduce((bbox, values) => {
    if (!bbox) return [...values];
    return [
      Math.min(bbox[0], values[0]),
      Math.min(bbox[1], values[1]),
      Math.max(bbox[2], values[2]),
      Math.max(bbox[3], values[3])
    ];
  }, null);
}

function chunkIndexBbox(chunkIndex) {
  if (isValidBbox(chunkIndex?.bbox)) {
    return chunkIndex.bbox.map(roundCoord);
  }

  const chunkBboxes = Array.isArray(chunkIndex?.chunks)
    ? chunkIndex.chunks
        .map((chunk) => Array.isArray(chunk?.bbox) ? chunk.bbox.map(asFiniteNumber) : null)
        .filter((bbox) => bbox && bbox.every((number) => number !== null) && isValidBbox(bbox))
    : [];

  const union = unionBboxes(chunkBboxes);
  return union && isValidBbox(union) ? union.map(roundCoord) : null;
}

function loadChunkIndex(entry) {
  const relativePath = chunkIndexPathFor(entry);
  if (!relativePath) {
    return { status: 'missing-path', relativePath: null, bbox: null };
  }

  const absolutePath = resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    return { status: 'missing-file', relativePath, bbox: null };
  }

  try {
    const json = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const bbox = chunkIndexBbox(json);
    return {
      status: bbox ? 'ok' : 'invalid-bbox',
      relativePath,
      bbox,
      chunks: Array.isArray(json?.chunks) ? json.chunks.length : 0
    };
  } catch (err) {
    return { status: 'parse-error', relativePath, bbox: null, error: err.message };
  }
}

function collectLoadableMaps(db) {
  const maps = Array.isArray(db?.maps) ? db.maps : [];
  const entries = [];

  for (const map of maps) {
    entries.push({
      entry: map,
      source: map,
      isVariant: false,
      parentId: null
    });

    for (const variant of Array.isArray(map?.variants) ? map.variants : []) {
      entries.push({
        entry: {
          ...map,
          ...variant,
          parentId: map.id,
          style: variant.style || map.style,
          labelProperty: variant.labelProperty || map.labelProperty,
          priorityProperty: variant.priorityProperty || map.priorityProperty,
          name: variant.label || variant.id,
          variants: undefined,
          members: undefined,
          isGroup: false
        },
        source: variant,
        isVariant: true,
        parentId: map.id
      });
    }
  }

  return entries;
}

export function validateChunkedMapBounds(options = {}) {
  const fix = !!options.fix;
  const db = JSON.parse(readFileSync(MAPS_PATH, 'utf8'));
  const entries = collectLoadableMaps(db);
  const errors = [];
  const warnings = [];
  const fixed = [];
  const stats = {
    loadableEntries: entries.length,
    chunkedEntries: 0,
    explicitBounds: 0,
    chunkIndexFallback: 0,
    fixed: 0
  };

  for (const record of entries) {
    const { entry, source, parentId } = record;
    if (!(entry?.chunked || entry?.chunkOnly)) continue;
    stats.chunkedEntries += 1;

    if (entry.isGroup && !entry.files?.fgb) {
      continue;
    }

    const hasBounds = isValidBounds(entry.bounds);
    if (entry.bounds && !hasBounds) {
      errors.push(`${entry.id}: invalid bounds shape or out-of-range coordinates`);
      continue;
    }

    if (hasBounds) {
      stats.explicitBounds += 1;
      continue;
    }

    const index = loadChunkIndex(entry);
    if (index.bbox) {
      stats.chunkIndexFallback += 1;
      warnings.push(`${entry.id}: no explicit bounds; using local chunk index fallback (${index.relativePath})`);
      if (fix) {
        source.bounds = bboxToBounds(index.bbox);
        fixed.push(`${entry.id}${parentId ? ` (variant of ${parentId})` : ''}`);
      }
      continue;
    }

    errors.push(`${entry.id}: no valid bounds and no usable local chunk index (${index.status}${index.relativePath ? `: ${index.relativePath}` : ''})`);
  }

  if (fix && fixed.length > 0) {
    writeFileSync(MAPS_PATH, `${JSON.stringify(db, null, 2)}\n`);
    stats.fixed = fixed.length;
  }

  return { stats, errors, warnings, fixed };
}

function main() {
  const fix = process.argv.includes('--fix');
  const result = validateChunkedMapBounds({ fix });
  const { stats, errors, warnings, fixed } = result;

  console.log('Chunked Map Bounds Validation');
  console.log(`- loadable entries: ${stats.loadableEntries}`);
  console.log(`- chunked entries: ${stats.chunkedEntries}`);
  console.log(`- explicit bounds: ${stats.explicitBounds}`);
  console.log(`- chunk-index fallbacks: ${stats.chunkIndexFallback}`);
  if (fix) console.log(`- fixed: ${stats.fixed}`);

  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings.slice(0, 100)) console.log(`- ${warning}`);
    if (warnings.length > 100) console.log(`- ... and ${warnings.length - 100} more`);
  }

  if (fixed.length) {
    console.log('\nAdded bounds:');
    for (const item of fixed.slice(0, 100)) console.log(`- ${item}`);
    if (fixed.length > 100) console.log(`- ... and ${fixed.length - 100} more`);
  }

  if (errors.length) {
    console.log('\nErrors:');
    for (const error of errors.slice(0, 200)) console.log(`- ${error}`);
    if (errors.length > 200) console.log(`- ... and ${errors.length - 200} more`);
    process.exit(1);
  }

  console.log('\nPASS: chunked map entries have explicit bounds or a local chunk-index fallback.');
}

if (isMainModule()) {
  main();
}
