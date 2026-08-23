#!/usr/bin/env node
/**
 * Populate `timeSeriesChains` in the render metadata from the catalogue.
 *
 * WHY THE /render/ TIME-SERIES PANEL HAS NEVER WORKED
 *
 * render/index.html:182 mounts #timeSeriesPanel, render/src/time-series-panel.js renders
 * it, and TimeSeriesController.switchLayerToDate() swaps a loaded layer to another date
 * in its chain. All of it is wired up. None of it has ever done anything, because
 * render/metadata/maps-test.json carried `timeSeriesChains: []` while the catalogue
 * carried 17 chains and 44 classes. Measured 2026-08-23 at /render/ with
 * provinces-1955 loaded: the panel read "No converted time-series chains."
 *
 * A SECOND mismatch sat underneath, which would have bitten the moment the first was
 * fixed. TimeSeriesController reads `chain.maps` with entries carrying `.id` and `.date`,
 * and matches against RENDER layer ids ("provinces-1955-vector-test"), not catalogue map
 * ids ("provinces-1955"). And the catalogue describes membership FOUR different ways:
 *
 *   segments: [{ classIds, from?, to? }]      5  wards, deas, local-govt, counties,
 *                                                provinces
 *   classIds: [...]                           9  settlements, referendums, eu-parliament,
 *                                                ttwa, the census series, roi-*
 *   maps: [...]                               2  osni-50k-transport, osni-ortho-coverage
 *   parallel + columns: [{ classIds, name }]  1  parliamentary
 *
 * The first version of this script handled ONLY `segments`, so it emitted 5 of 17 chains
 * and left the other 12 exactly as dead as they had been. All four shapes are handled
 * now: 18 chains, 173 entries.
 *
 * Segment `from`/`to` are honoured. The `wards` chain is ni-wards from 1972 and ni-deds
 * to 1971; ignoring the window would pull post-1972 wards into a segment ending in 1971.
 *
 * A `parallel` chain emits ONE CHAIN PER COLUMN rather than one merged list. Its three
 * columns -- UK Parliament, Dail Eireann, Devolved NI -- are separate series displayed
 * side by side. Merging them would let the picker "switch" a Westminster constituency map
 * to a Dail one at a nearby date, which is not a continuation of anything.
 *
 * `parliamentary` also declares a chain-level `predecessor` (pre-1921-pcs, to
 * 1920-12-31). It is deliberately NOT attached to any column, and is reported instead. It
 * precedes the UK Parliament and Dail series equally, and the Devolved NI series arguably
 * not at all; the data says which CLASSES it covers but not which COLUMNS it belongs to.
 * Attaching it to one would be a guess, and to all three would assert that pre-partition
 * Westminster seats precede the NI Assembly.
 *
 * Placeholders, hidden records and UNDATED maps are dropped: a chain entry that cannot be
 * loaded is a date the picker offers and then fails to honour, and an undated one would
 * render an <option value> of literally "undefined".
 *
 * Runs inside `npm run build`, so it cannot drift. --check fails instead of writing.
 *
 *   node scripts/build-render-time-series-chains.mjs
 *   node scripts/build-render-time-series-chains.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const CHECK = process.argv.includes('--check');

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));

const mapById = new Map((catalogue.maps || []).map((m) => [m.id, m]));
const classById = new Map((catalogue.classes || []).map((c) => [c.id, c]));

// A catalogue map id -> the render layer that draws it.
const layerByMapId = new Map();
for (const layer of render.layers || []) {
  if (!layer.sourceMapId) continue;
  if (!layerByMapId.has(layer.sourceMapId)) layerByMapId.set(layer.sourceMapId, layer);
}

// Strip diacritics BEFORE slugging, or "Dail Eireann" (spelt properly) becomes
// "d-il-eireann" -- a stable id, but one that reads as a bug every time anyone sees it.
const slug = (value) => String(value)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const inWindow = (date, window) => {
  const value = String(date || '');
  if (!value) return false;
  if (window.from && value < String(window.from)) return false;
  if (window.to && value > String(window.to)) return false;
  return true;
};

/** Resolve one map id to a render-shaped entry, or null if it cannot be offered. */
function toEntry(mapId, seen) {
  const map = mapById.get(mapId);
  // Placeholders and hidden records are dropped: a chain entry that cannot be loaded is
  // a date the picker offers and then fails to honour.
  if (!map || map.placeholder || map.hidden) return null;
  // An UNDATED map cannot go in a date picker -- its <option value> would literally be
  // "undefined". osni-50k-transport is two undated layers (transport labels and points),
  // which is a pair of related layers rather than a series, so it drops out entirely and
  // correctly.
  if (!map.date) return null;
  const layer = layerByMapId.get(mapId);
  if (!layer || seen.has(layer.id)) return null;
  seen.add(layer.id);
  return { id: layer.id, mapId, date: String(map.date), name: map.name || mapId };
}

/** Collect entries from a list of classIds, optionally restricted to a date window. */
function fromClassIds(classIds, window, seen, entries) {
  for (const classId of classIds || []) {
    const klass = classById.get(classId);
    if (!klass) continue;
    for (const mapId of klass.maps || []) {
      const map = mapById.get(mapId);
      if (!map) continue;
      if (window && !inWindow(map.date, window)) continue;
      const entry = toEntry(mapId, seen);
      if (entry) entries.push(entry);
    }
  }
}

const chains = [];
const notes = [];

function emit(id, name, entries) {
  if (entries.length < 2) return;   // a "series" of one is a layer, not a series
  entries.sort((a, b) => a.date.localeCompare(b.date));
  chains.push({ id, name, maps: entries });
}

for (const chain of catalogue.timeSeriesChains || []) {
  const name = chain.name || chain.id;

  // Shape 4: parallel columns -> ONE CHAIN PER COLUMN. See the header for why these are
  // not merged, and why `predecessor` is reported rather than attached to a column.
  if (chain.parallel && Array.isArray(chain.columns)) {
    chain.columns.forEach((column, index) => {
      const seen = new Set();
      const entries = [];
      fromClassIds(column.classIds, null, seen, entries);
      const columnName = column.name || `${name} ${index + 1}`;
      emit(`${chain.id}:${slug(columnName)}`, columnName, entries);
    });
    if (chain.predecessor) {
      notes.push(`${chain.id}: predecessor (${(chain.predecessor.classIds || []).join(', ')}) not attached to any column -- the data does not say which column it precedes.`);
    }
    continue;
  }

  const seen = new Set();
  const entries = [];
  // Shape 1: segments, each with its own date window.
  for (const segment of chain.segments || []) fromClassIds(segment.classIds, segment, seen, entries);
  // Shape 2: classIds declared flat on the chain.
  fromClassIds(chain.classIds, null, seen, entries);
  // Shape 3: map ids listed directly, with no class indirection.
  for (const mapId of chain.maps || []) {
    const entry = toEntry(mapId, seen);
    if (entry) entries.push(entry);
  }
  emit(chain.id, name, entries);
}

const serialise = (value) => JSON.stringify(value);
if (CHECK) {
  if (serialise(render.timeSeriesChains || []) !== serialise(chains)) {
    console.error('FAIL: render/metadata/maps-test.json timeSeriesChains is stale.');
    console.error(`  recorded: ${(render.timeSeriesChains || []).length} chain(s); derived: ${chains.length}`);
    console.error('  The /render/ time-series picker reads this. Empty or stale means the');
    console.error('  panel silently offers nothing, which is how it sat unnoticed.');
    console.error('  Fix: node scripts/build-render-time-series-chains.mjs');
    process.exit(1);
  }
  console.log(`PASS: ${chains.length} render time-series chain(s) match the catalogue.`);
  process.exit(0);
}

render.timeSeriesChains = chains;
writeFileSync(RENDER, `${JSON.stringify(render, null, 2)}\n`);
const total = chains.reduce((sum, c) => sum + c.maps.length, 0);
console.log(`Wrote ${chains.length} chain(s), ${total} entr(ies), into ${RENDER}.`);
for (const chain of chains) {
  console.log(`  ${chain.id.padEnd(30)} ${String(chain.maps.length).padStart(3)} entries  ${chain.maps[0].date} .. ${chain.maps[chain.maps.length - 1].date}`);
}
// Anything the catalogue declares and this deliberately does NOT emit is reported, so a
// judgement call does not read as an omission.
for (const note of notes) console.log(`  NOTE ${note}`);
