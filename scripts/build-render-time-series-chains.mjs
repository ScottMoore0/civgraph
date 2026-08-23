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
 * There was a SECOND mismatch underneath, which would have bitten the moment the first
 * was fixed. Catalogue chains describe membership indirectly:
 *
 *     { id, name, segments: [ { classIds: [...], from?, to? } ] }
 *
 * and TimeSeriesController reads `chain.maps` / `chain.layers` with entries carrying
 * `.id` and `.date`. It also matches against RENDER layer ids
 * ("provinces-1955-vector-test"), not catalogue map ids ("provinces-1955"). So this
 * emits a flattened, render-shaped chain: resolved through classes, filtered to layers
 * that actually exist and can be loaded, carrying both ids.
 *
 * Segment `from`/`to` are honoured. The `wards` chain, for instance, is ni-wards from
 * 1972 and ni-deds to 1971; ignoring the window would pull post-1972 DEDs into a segment
 * that ends in 1971.
 *
 * Placeholders and hidden records are dropped: a chain entry that cannot be loaded is a
 * date the picker offers and then fails to honour.
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

const inWindow = (date, segment) => {
  const value = String(date || '');
  if (!value) return false;
  if (segment.from && value < String(segment.from)) return false;
  if (segment.to && value > String(segment.to)) return false;
  return true;
};

const chains = [];
for (const chain of catalogue.timeSeriesChains || []) {
  const seen = new Set();
  const entries = [];
  for (const segment of chain.segments || []) {
    for (const classId of segment.classIds || []) {
      const klass = classById.get(classId);
      if (!klass) continue;
      for (const mapId of klass.maps || []) {
        const map = mapById.get(mapId);
        if (!map || map.placeholder || map.hidden) continue;
        if (!inWindow(map.date, segment)) continue;
        const layer = layerByMapId.get(mapId);
        if (!layer) continue;
        if (seen.has(layer.id)) continue;
        seen.add(layer.id);
        entries.push({ id: layer.id, mapId, date: String(map.date), name: map.name || mapId });
      }
    }
  }
  if (entries.length < 2) continue;   // a "series" of one is a layer, not a series
  entries.sort((a, b) => a.date.localeCompare(b.date));
  chains.push({ id: chain.id, name: chain.name || chain.id, maps: entries });
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
  console.log(`  ${chain.id.padEnd(22)} ${String(chain.maps.length).padStart(3)} entries  ${chain.maps[0].date} .. ${chain.maps[chain.maps.length - 1].date}`);
}
