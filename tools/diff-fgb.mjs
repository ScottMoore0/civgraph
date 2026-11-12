#!/usr/bin/env node
/**
 * Compare two FlatGeobuf layers feature by feature, keyed on a name attribute.
 *
 * Written to answer a specific question on 2026-08-16: a contributor submitted
 * corrected boundary layers saying the published ones "accidentally had the
 * pre-1915 Antrim/Derry boundary". Accepting that on trust means republishing
 * five layers on an unverified claim; the alternative is measuring which
 * features actually moved.
 *
 * Reports, per feature: whether it exists in both, whether its geometry changed,
 * and by how much. Vertex count and bounding box catch a boundary being
 * redrawn; area catches territory moving between neighbours even when the
 * vertex count happens to match.
 *
 * Usage:
 *   node tools/diff-fgb.mjs <a.fgb> <b.fgb> [--key COUNTYNAME]
 */
import { readFileSync } from 'node:fs';
import { geojson } from 'flatgeobuf';

/** @typedef {import('geojson').Position} Position */
/** @typedef {{ vertices: number, area: number, bounds: number[] }} Summary */
const [fileA, fileB] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const keyArg = process.argv[process.argv.indexOf('--key') + 1];
const KEY = process.argv.includes('--key') ? keyArg : null;

if (!fileA || !fileB) {
  console.error('Usage: node tools/diff-fgb.mjs <a.fgb> <b.fgb> [--key COLUMN]');
  process.exit(1);
}

/**
 * @param {import('geojson').GeoJsonProperties} properties
 * @param {string | null | undefined} explicit
 * @returns {string | undefined}
 */
function pickKey(properties, explicit) {
  if (explicit) return explicit;
  const keys = Object.keys(properties || {});
  return keys.find((k) => /^countyname$/i.test(k))
    || keys.find((k) => /name/i.test(k))
    || keys[0];
}

/**
 * Ring area by the shoelace formula, in square degrees -- comparative only.
 * @param {Position[]} ring
 */
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return Math.abs(sum / 2);
}

/**
 * @param {import('geojson').Geometry | null | undefined} geometry
 * @returns {Summary}
 */
function summarise(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  let vertices = 0;
  let area = 0;

  const walkRing = (/** @type {Position[]} */ ring) => {
    vertices += ring.length;
    area += ringArea(ring);
    for (const [x, y] of ring) {
      if (x < bounds[0]) bounds[0] = x;
      if (y < bounds[1]) bounds[1] = y;
      if (x > bounds[2]) bounds[2] = x;
      if (y > bounds[3]) bounds[3] = y;
    }
  };

  if (geometry?.type === 'Polygon') (geometry.coordinates || []).forEach(walkRing);
  else if (geometry?.type === 'MultiPolygon') (geometry.coordinates || []).forEach((poly) => poly.forEach(walkRing));

  return { vertices, area, bounds };
}

/** @param {string} file */
async function load(file) {
  const bytes = new Uint8Array(readFileSync(file));
  /** @type {Map<string, Summary>} */
  const out = new Map();
  /** @type {string | null | undefined} */
  let keyName = null;
  for await (const feature of geojson.deserialize(bytes)) {
    keyName = keyName || pickKey(feature.properties, KEY);
    // String(): with no key name, the lookup was always of 'null' or 'undefined', as before.
    const name = String(feature.properties?.[String(keyName)] ?? `(unnamed ${out.size})`);
    out.set(name, summarise(feature.geometry));
  }
  return { features: out, keyName };
}

const a = await load(fileA);
const b = await load(fileB);

console.log(`A: ${fileA}  (${a.features.size} features, key ${a.keyName})`);
console.log(`B: ${fileB}  (${b.features.size} features, key ${b.keyName})\n`);

const names = [...new Set([...a.features.keys(), ...b.features.keys()])].sort();
const changed = [];
const onlyA = [];
const onlyB = [];

for (const name of names) {
  const left = a.features.get(name);
  const right = b.features.get(name);
  if (!right) { onlyA.push(name); continue; }
  if (!left) { onlyB.push(name); continue; }

  const vertexDelta = right.vertices - left.vertices;
  // Relative, because counties differ in size by orders of magnitude and an
  // absolute threshold would either miss Louth or flag Cork for rounding.
  const areaDelta = left.area ? (right.area - left.area) / left.area : 0;
  const boundsMoved = left.bounds.some((v, i) => Math.abs(v - right.bounds[i]) > 1e-9);
  if (vertexDelta !== 0 || Math.abs(areaDelta) > 1e-9 || boundsMoved) {
    changed.push({ name, vertexDelta, areaDelta, boundsMoved });
  }
}

if (onlyA.length) console.log(`Only in A (${onlyA.length}): ${onlyA.join(', ')}`);
if (onlyB.length) console.log(`Only in B (${onlyB.length}): ${onlyB.join(', ')}`);

if (!changed.length) {
  console.log('No geometric differences: every shared feature is identical.');
} else {
  console.log(`Changed features (${changed.length} of ${names.length}):`);
  for (const c of changed.sort((x, y) => Math.abs(y.areaDelta) - Math.abs(x.areaDelta))) {
    const pct = (c.areaDelta * 100).toFixed(4);
    console.log(`  ${c.name.padEnd(32)} vertices ${c.vertexDelta >= 0 ? '+' : ''}${c.vertexDelta}`.padEnd(58)
      + ` area ${c.areaDelta >= 0 ? '+' : ''}${pct}%${c.boundsMoved ? '  bbox moved' : ''}`);
  }
}
