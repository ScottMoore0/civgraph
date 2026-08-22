#!/usr/bin/env node
/**
 * Give each layer a labelProperty that actually exists in its own tiles.
 *
 * WHAT WAS WRONG
 *
 * 36 of the baselined parity findings are labelProperty divergences. They split two ways:
 *
 *   31  catalogue sets one, render record has null  -> the layer draws no labels
 *    5  the two name different attributes           -> one of them is wrong
 *
 * Checked against the actual tiles, the render record is the wrong one in the cases that
 * could be verified. hed-listed-buildings carries `civ_fid, HB_ref, Address` and its
 * render record labels by `OWNER`, which is not in the tile at all -- so the layer has a
 * labelProperty set, produces no labels, and looks like a rendering bug rather than a
 * metadata one. Six layers share that exact `Address -> OWNER` divergence.
 *
 * WHY THIS VERIFIES INSTEAD OF COPYING
 *
 * labelProperty is not a display string: it adds a symbol layer that draws text from
 * that attribute. Copying the catalogue value blindly would swap one wrong name for
 * another whenever the catalogue is the stale side, and the failure is invisible --
 * MapLibre renders nothing for a missing attribute rather than complaining.
 *
 * So the tile is the authority. A value is only adopted if the attribute is present in
 * the layer's own local archive. Layers with no local archive are reported and skipped,
 * because the honest answer there is "cannot tell", not "probably fine".
 *
 *   node scripts/sync-label-properties.mjs --check
 *   node scripts/sync-label-properties.mjs --write
 */
import { readFileSync, writeFileSync, existsSync, openSync, readSync } from 'node:fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const CATALOGUE = 'data/database/maps.json';
const RENDER = 'render/metadata/maps-test.json';
const WRITE = process.argv.includes('--write');

class FileSource {
  constructor(path) { this.path = path; this.fd = openSync(path, 'r'); }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) };
  }
}

/** Union of attribute names across every tile at a modest zoom. */
async function tileAttributes(archivePath) {
  const pm = new PMTiles(new FileSource(archivePath));
  const header = await pm.getHeader();
  const z = Math.min(header.maxZoom, Math.max(header.minZoom, 5));
  const n = 2 ** z;
  const keys = new Set();
  let found = false;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const tile = await pm.getZxy(z, x, y).catch(() => null);
      if (!tile) continue;
      found = true;
      const vt = new VectorTile(new Pbf(Buffer.from(tile.data)));
      for (const name of Object.keys(vt.layers)) {
        for (const key of vt.layers[name]._keys || []) keys.add(key);
      }
    }
  }
  return found ? keys : null;
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
const render = JSON.parse(readFileSync(RENDER, 'utf8'));
const catalogueById = new Map((catalogue.maps || []).map((m) => [m.id, m]));

const adopted = [];
const rejected = [];
const unverifiable = [];

for (const layer of render.layers || []) {
  if (layer.sourceType !== 'pmtiles') continue;
  const mapId = layer.sourceMapId || String(layer.id || '').replace(/-vector-test$/, '');
  const map = catalogueById.get(mapId);
  const wanted = map?.labelProperty;
  if (!wanted || wanted === layer.labelProperty) continue;

  const archive = `render/pmtiles/generated/${layer.id}.pmtiles`;
  if (!existsSync(archive)) { unverifiable.push(`${layer.id}: no local archive`); continue; }
  let attrs;
  try { attrs = await tileAttributes(archive); } catch { attrs = null; }
  if (!attrs) { unverifiable.push(`${layer.id}: archive has no readable tiles`); continue; }

  if (attrs.has(wanted)) {
    adopted.push(`${layer.id}: ${layer.labelProperty ?? 'null'} -> ${wanted}`);
    if (WRITE) layer.labelProperty = wanted;
  } else {
    rejected.push(`${layer.id}: catalogue says "${wanted}", not present in the tiles`);
  }
}

console.log(`Adopted ${adopted.length}. Rejected ${rejected.length}. Unverifiable ${unverifiable.length}.`);
for (const a of adopted.slice(0, 12)) console.log(`  + ${a}`);
for (const r of rejected.slice(0, 8)) console.log(`  - ${r}`);
for (const u of unverifiable.slice(0, 6)) console.log(`  ? ${u}`);

if (WRITE && adopted.length) {
  writeFileSync(RENDER, `${JSON.stringify(render, null, 2)}\n`);
  console.log(`\nWrote ${RENDER}.`);
}
