#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync } from 'fs';
import { dirname, basename, join, relative } from 'path';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { deserialize, serialize } from 'flatgeobuf/lib/mjs/geojson.js';
import simplify from '@turf/simplify';

const TARGETS = [
  'data/maps/baronies-parishes/Counties_Ireland_1922.fgb',
  'data/maps/baronies-parishes/Counties_Ireland_1927.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1930.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1931.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1941.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1942.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1944.fgb',
  'data/maps/local-government/ROI_Local_Authorities_1950.fgb'
];

const LODS = [
  { suffix: '-lod0.fgb', tolerance: 0.005 },
  { suffix: '-lod1.fgb', tolerance: 0.0005 }
];

function cloneFeature(feature) {
  return {
    type: feature.type,
    properties: { ...(feature.properties || {}) },
    geometry: feature.geometry ? JSON.parse(JSON.stringify(feature.geometry)) : null
  };
}

function isValidGeometry(geom) {
  if (!geom || !geom.type) return false;
  if (geom.type === 'Point') return Array.isArray(geom.coordinates) && geom.coordinates.length >= 2;
  if (geom.type === 'LineString') return Array.isArray(geom.coordinates) && geom.coordinates.length >= 2;
  if (geom.type === 'Polygon') return Array.isArray(geom.coordinates) && geom.coordinates[0]?.length >= 4;
  if (geom.type === 'MultiPolygon') return Array.isArray(geom.coordinates) && geom.coordinates.length > 0;
  if (geom.type === 'MultiLineString') return Array.isArray(geom.coordinates) && geom.coordinates.length > 0;
  if (geom.type === 'MultiPoint') return Array.isArray(geom.coordinates) && geom.coordinates.length > 0;
  return true;
}

async function readFeatures(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const features = [];
  for await (const feature of deserialize(bytes)) {
    features.push(feature);
  }
  return features;
}

function simplifyFeatures(features, tolerance) {
  return features.map((feature) => {
    const clone = cloneFeature(feature);
    if (clone.geometry?.type && clone.geometry.type !== 'Point') {
      try {
        simplify(clone, { tolerance, highQuality: false, mutate: true });
      } catch {
        return cloneFeature(feature);
      }
    }
    return isValidGeometry(clone.geometry) ? clone : cloneFeature(feature);
  });
}

function writeFgb(path, features) {
  const bytes = serialize({ type: 'FeatureCollection', features });
  writeFileSync(path, Buffer.from(bytes));
}

function compress(path) {
  const body = readFileSync(path);
  writeFileSync(`${path}.gz`, gzipSync(body, { level: 6 }));
  writeFileSync(`${path}.br`, brotliCompressSync(body, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
  }));
}

for (const target of TARGETS) {
  const originalSize = statSync(target).size;
  const features = await readFeatures(target);
  console.log(`${target}: ${features.length} features, ${(originalSize / 1048576).toFixed(1)} MB`);

  for (const lod of LODS) {
    const parsed = `${join(dirname(target), basename(target, '.fgb'))}${lod.suffix}`;
    const simplified = simplifyFeatures(features, lod.tolerance);
    writeFgb(parsed, simplified);
    const lodSize = statSync(parsed).size;
    const reduction = ((1 - lodSize / originalSize) * 100).toFixed(1);
    console.log(`  ${relative('.', parsed)}: ${(lodSize / 1048576).toFixed(2)} MB, ${reduction}% reduction`);
  }

  compress(target);
  for (const lod of LODS) {
    compress(`${join(dirname(target), basename(target, '.fgb'))}${lod.suffix}`);
  }
}
