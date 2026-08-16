#!/usr/bin/env node
/**
 * Report the structure of FlatGeobuf files: feature count, geometry types,
 * attribute schema and extent.
 *
 * Written while reviewing the first real contributor submissions on 2026-08-16.
 * Five corrected Local Authorities layers arrived as Drive links, and the only
 * things visible without opening them were filename and byte count -- enough to
 * notice one differs, nothing like enough to say why.
 *
 * Features are streamed rather than collected: flatgeobuf's deserialize returns
 * an async generator, so a 7.6 MB file never has to exist in memory as GeoJSON.
 *
 * Usage:
 *   node scripts/inspect-fgb.mjs <file|directory> [...]
 *   node scripts/inspect-fgb.mjs data/quarantine/submissions --samples 3
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { geojson } from 'flatgeobuf';

const args = process.argv.slice(2);
const sampleCount = Number(args[args.indexOf('--samples') + 1]) || 2;
const targets = args.filter((a) => !a.startsWith('--') && a !== String(sampleCount));

function collect(target) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    return readdirSync(target)
      .filter((f) => f.toLowerCase().endsWith('.fgb'))
      .sort()
      .map((f) => path.join(target, f));
  }
  return [target];
}

/** The attribute most likely to be the human-readable name of a boundary. */
function pickLabel(properties) {
  const keys = Object.keys(properties || {});
  const preferred = keys.find((k) => /^(name|label|title)$/i.test(k))
    || keys.find((k) => /name/i.test(k))
    || keys[0];
  return preferred ? { key: preferred, value: properties[preferred] } : null;
}

function extendBounds(bounds, coords) {
  if (typeof coords[0] === 'number') {
    const [x, y] = coords;
    if (x < bounds[0]) bounds[0] = x;
    if (y < bounds[1]) bounds[1] = y;
    if (x > bounds[2]) bounds[2] = x;
    if (y > bounds[3]) bounds[3] = y;
    return;
  }
  for (const part of coords) extendBounds(bounds, part);
}

const files = targets.flatMap(collect);
if (!files.length) {
  console.error('Usage: node scripts/inspect-fgb.mjs <file|directory> [...] [--samples N]');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const size = statSync(file).size;
  console.log(`\n${path.basename(file)}  (${(size / 1048576).toFixed(1)} MB)`);
  try {
    const bytes = new Uint8Array(readFileSync(file));
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const propertyKeys = new Set();
    const geometryTypes = new Map();
    const samples = [];
    let count = 0;

    for await (const feature of geojson.deserialize(bytes)) {
      count += 1;
      for (const key of Object.keys(feature.properties || {})) propertyKeys.add(key);
      const type = feature.geometry?.type || 'none';
      geometryTypes.set(type, (geometryTypes.get(type) || 0) + 1);
      if (feature.geometry?.coordinates) extendBounds(bounds, feature.geometry.coordinates);
      if (samples.length < sampleCount) {
        const label = pickLabel(feature.properties);
        if (label) samples.push(`${label.key}=${JSON.stringify(label.value)}`);
      }
    }

    console.log(`  features : ${count}`);
    console.log(`  geometry : ${[...geometryTypes].map(([t, n]) => `${t} x${n}`).join(', ')}`);
    console.log(`  columns  : ${[...propertyKeys].join(', ') || '(none)'}`);
    if (Number.isFinite(bounds[0])) {
      console.log(`  extent   : ${bounds.map((n) => n.toFixed(3)).join(', ')}`);
    }
    if (samples.length) console.log(`  sample   : ${samples.join(' | ')}`);
  } catch (error) {
    failures += 1;
    console.log(`  UNREADABLE: ${String(error.message).slice(0, 160)}`);
  }
}

console.log('');
if (failures) {
  console.error(`${failures} of ${files.length} file(s) could not be read as FlatGeobuf.`);
  process.exit(1);
}
