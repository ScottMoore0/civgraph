#!/usr/bin/env node
/**
 * Replace hand-entered catalogue bounds with the render record's computed ones.
 *
 * WHY THE RENDER VALUE WINS
 *
 * 61 of the 371 baselined parity findings are bounds that differ by more than the
 * check's 1e-6 tolerance -- by up to 0.6 degrees, roughly 66 km. They are not rounding.
 *
 * The catalogue values are round-number approximations entered by hand and copied
 * between records: [[51.4,-10.75],[55.5,-5.4]] appears on 25 different maps,
 * [[54,-8.3],[55.5,-5.3]] on 14, [[53.99,-8.19],[55.33,-5.32]] on 10. They describe
 * "roughly Ireland" and "roughly Northern Ireland", not the layer.
 *
 * The render value is computed from the actual geometry at conversion time. For
 * roi-small-areas-2022 the catalogue says the layer spans to -10.75 and the geometry
 * says -10.663. The geometry is not an opinion.
 *
 * WHAT THIS AFFECTS: bounds drive the initial fit when a layer is opened. A too-wide
 * approximation means the map opens zoomed further out than the data warrants -- small
 * on every layer, and it is why 25 different layers all frame identically.
 *
 * Only adopts where the render bounds are structurally valid, and only where the
 * difference exceeds the tolerance the parity check already applies. --check reports
 * without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isValidBounds } from './lib/layer-bounds.mjs';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const TOLERANCE = 1e-6;
const CHECK = process.argv.includes('--check');

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));

const renderById = new Map();
for (const layer of render.layers || []) {
  renderById.set(layer.sourceMapId || String(layer.id || '').replace(/-vector-test$/, ''), layer);
}

const flat = (b) => JSON.stringify(b).match(/-?\d+\.?\d*/g)?.map(Number) || [];
const adopted = [];

for (const map of catalogue.maps || []) {
  if (!map.bounds) continue;
  const layer = renderById.get(map.id);
  if (!layer?.bounds || !isValidBounds(layer.bounds, layer)) continue;
  const a = flat(map.bounds);
  const b = flat(layer.bounds);
  if (a.length !== b.length || !a.length) continue;
  const delta = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  if (delta <= TOLERANCE) continue;
  adopted.push({ id: map.id, delta: Number(delta.toFixed(6)) });
  if (!CHECK) map.bounds = JSON.parse(JSON.stringify(layer.bounds));
}

if (CHECK) {
  console.log(`${adopted.length} catalogue bound(s) differ from the computed render value by more than ${TOLERANCE}.`);
  process.exit(0);
}

writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`Adopted ${adopted.length} computed bound(s) into ${CATALOGUE}.`);
for (const a of adopted.slice(0, 8)) console.log(`  ${a.id} (was off by ${a.delta}°)`);
if (adopted.length > 8) console.log(`  ... and ${adopted.length - 8} more`);
