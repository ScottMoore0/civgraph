#!/usr/bin/env node
/**
 * Give every composite layer an explicit bounds, derived from its members.
 *
 * WHY. A catalogue entry that composes other layers -- members[] and no files of its own
 * -- has nothing to derive an extent from at render time. Layers that own a file get
 * their extent from the tile metadata; a composite has no file, so if it does not declare
 * bounds it has none, and the catalogue card silently omits it.
 *
 * That is what hid the Ward/DED composites for 1941-1944. They were visible, correctly
 * categorised, correctly named, members populated, provinces converted and serving from
 * the CDN -- and absent from the Electoral Divisions card, while 1946 and 1950 sat right
 * beside them. The only difference between eds-roi-1941 and eds-roi-1946 was that one
 * carried bounds and the other did not. Seven ED entries lacked it and exactly those
 * seven were missing; all thirteen that had it appeared.
 *
 * Bounds are computed as the union of the members' extents taken from the tile index,
 * rather than copied from a sibling, so the value describes the layer rather than
 * assuming every composite covers the same ground -- the GSNI geology composites are
 * Northern Ireland only, the ED composites are all-Ireland.
 *
 * Idempotent; only fills absent bounds and never overwrites a declared one.
 *
 * Usage: node scripts/backfill-composite-bounds.mjs [--check]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeArtefactJson } from './lib/safe-artefact-write.mjs';

const ROOT = resolve(process.cwd());
const CATALOGUE = resolve(ROOT, 'data/database/maps.json');
const INDEX = resolve(ROOT, 'test/metadata/maps-test-index.json');
const CHECK_ONLY = process.argv.includes('--check');

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const indexLayers = JSON.parse(readFileSync(INDEX, 'utf8')).layers || [];

const boundsById = new Map();
for (const l of indexLayers) {
  if (!Array.isArray(l?.bounds) || l.bounds.length !== 2) continue;
  if (l.id) boundsById.set(l.id, l.bounds);
  if (l.sourceMapId) boundsById.set(l.sourceMapId, l.bounds);
}

const isComposite = (m) => Array.isArray(m.members) && m.members.length
  && !Object.keys(m.files || {}).length;

const filled = [];
const unresolved = [];

for (const m of catalogue.maps || []) {
  if (m.hidden || m.bounds || !isComposite(m)) continue;
  const extents = m.members.map((id) => boundsById.get(id)).filter(Boolean);
  if (!extents.length) { unresolved.push(m.id); continue; }
  let [[s, w], [n, e]] = extents[0];
  for (const [[s2, w2], [n2, e2]] of extents.slice(1)) {
    s = Math.min(s, s2); w = Math.min(w, w2);
    n = Math.max(n, n2); e = Math.max(e, e2);
  }
  const bounds = [[round(s), round(w)], [round(n), round(e)]];
  filled.push({ id: m.id, bounds, from: extents.length, of: m.members.length });
  if (!CHECK_ONLY) m.bounds = bounds;
}

function round(v) { return Math.round(v * 1e6) / 1e6; }

console.log(`Composites needing bounds: ${filled.length + unresolved.length}`);
for (const f of filled) {
  console.log(`   ${f.id.padEnd(38)} ${JSON.stringify(f.bounds)}  (from ${f.from}/${f.of} members)`);
}
for (const id of unresolved) {
  console.error(`   ${id.padEnd(38)} NO MEMBER BOUNDS AVAILABLE -- cannot derive`);
}

if (CHECK_ONLY) {
  console.log('\n--check: nothing written');
  process.exit(filled.length || unresolved.length ? 1 : 0);
}

if (filled.length) {
  writeArtefactJson(CATALOGUE, catalogue, {
    collection: 'maps', idKey: 'id', label: 'data/database/maps.json'
  });
  console.log(`\nFilled ${filled.length}; wrote ${CATALOGUE}`);
} else {
  console.log('\nNothing to fill.');
}
process.exit(unresolved.length ? 1 : 0);
