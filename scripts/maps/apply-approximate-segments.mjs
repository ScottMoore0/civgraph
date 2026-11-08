#!/usr/bin/env node
/**
 * Apply a boundary-audit patch of approximate stretches to the catalogue.
 *
 *   node scripts/maps/apply-approximate-segments.mjs <patch.json> [--check]
 *
 * The patch ({edition id: {approximateSegments: {url, count, totalKm, note}}}) comes from the audit
 * folder (build_patch.py), which measures each reconstructed edition's lines against the source lines
 * and writes one segment file per published FGB. Editions in the patch get the field; editions not in
 * it lose any old one, so a re-run after a geometry change leaves no stale note. maps.json is written
 * in its own format (JSON.stringify, two spaces), so the diff is only the changed fields.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [patchPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CHECK = process.argv.includes('--check');
if (!patchPath) {
  console.error('usage: node scripts/maps/apply-approximate-segments.mjs <patch.json> [--check]');
  process.exit(2);
}
const FILE = 'data/database/maps.json';
/** @type {import('../../packages/types/index.js').MapCatalogue} */
const doc = JSON.parse(readFileSync(FILE, 'utf8'));
/** @type {Record<string, { approximateSegments?: unknown }>} map id -> its approximateSegments */
const patch = JSON.parse(readFileSync(patchPath, 'utf8'));
const byId = new Map(doc.maps.map((m) => [m.id, m]));
const unknown = Object.keys(patch).filter((id) => !byId.has(id));
if (unknown.length) {
  console.error(`FAIL: the patch names editions not in maps.json: ${unknown.join(', ')}`);
  process.exit(1);
}
let set = 0;
let removed = 0;
for (const map of doc.maps) {
  const wanted = patch[map.id]?.approximateSegments;
  if (wanted) {
    if (JSON.stringify(map.approximateSegments) !== JSON.stringify(wanted)) {
      map.approximateSegments = wanted;
      set += 1;
    }
  } else if (map.approximateSegments) {
    delete map.approximateSegments;
    removed += 1;
  }
}
if (CHECK) {
  if (set || removed) {
    console.error(`FAIL: ${set} edition(s) to set and ${removed} to clear.`);
    process.exit(1);
  }
  console.log('PASS: maps.json matches the patch.');
  process.exit(0);
}
writeFileSync(FILE, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`approximateSegments set on ${set} edition(s), cleared on ${removed}.`);
