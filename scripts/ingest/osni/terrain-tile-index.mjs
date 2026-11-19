#!/usr/bin/env node
/**
 * Sets the tile indexes of the island terrain layers (ireland-terrain-3d and its grey twin): for
 * each pyramid (packages/core/src/tile-index.mjs TILE_INDEX_FIELDS), the list of the tiles it holds,
 * so the map asks only for those and over-zooms the rest (packages/map/src/renderer/indexed-tiles.mjs).
 *   - hillshadeTileIndex: the drape, hillshadeTiles (hs/), zooms hillshadeMinzoom-hillshadeMaxzoom;
 *   - demTileIndex: the elevation, tiles (dem/), zooms minzoom-maxzoom.
 *
 *   node scripts/ingest/osni/terrain-tile-index.mjs --from-r2 [--part hs|dem ...] [--layer <id> ...] [--write]
 *   node scripts/ingest/osni/terrain-tile-index.mjs --keys <file> --part hs|dem [--layer <id> ...] [--write]
 *
 * --from-r2 lists each pyramid's prefix on R2 (read only; .env.local holds the keys); --keys reads
 * one pyramid's tiles from a file, one `z/x/y.png` a line (paths under its prefix), so it takes one
 * --part. Without --part both pyramids are indexed. Without --write it prints what it found; with
 * it it sets the fields on each layer in render/metadata/maps-test.json. Then run
 * `npm run build:test2:metadata`.
 *
 * Re-run it after a pyramid changes (a new LiDAR block, the island-terrain step of this plugin):
 * a tile an index does not hold is never fetched. A tile whose parent the pyramid lacks is left
 * out and named (it could never be reached from above).
 *
 * Found 19 Nov 2026:
 *   - hs/ (w19-hillshade): 21,466 tiles; zooms 5-11 hold every land tile of the island (the tiles
 *     they lack are open sea); 12-16 only the NI River Basin LiDAR, 14,055 tiles at 16.
 *   - dem/ (w19-dem-fallback): 613,421 tiles; zooms 5-12 the whole bounds, 13-15 all but the top
 *     row(s) at 55.7 N (open sea), 16 only a rectangle over NI (133,920 tiles). Three tiles of the
 *     top row have no parent (open sea off Gigha, 0-9 m) and are left out.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_INDEX_FIELDS, decodeTileIndex, encodeTileIndex, tileIndexCounts } from '@civgraph/core/tile-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const META = path.join(ROOT, 'render/metadata/maps-test.json');
const DEFAULT_LAYERS = ['ireland-terrain-3d', 'ireland-terrain-3d-grey'];

/**
 * The R2 key prefix of a tile template on the data CDN, e.g. data/maps/physical/x/hs/.
 * @param {string} template
 */
export function tilePrefix(template) {
  const m = /^https?:\/\/[^/]+\/(.+\/)\{z\}\/\{x\}\/\{y\}\.\w+/.exec(template);
  if (!m || !m[1]) throw new Error(`not a z/x/y template on the data CDN: ${template}`);
  return m[1];
}

/**
 * The tiles under a prefix on R2, as paths below it.
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
async function listR2(prefix) {
  const { r2Credentials, s3ClientOptions } = await import('../../publish/r2-env.mjs');
  const { openS3BlobStore } = await import('@civgraph/storage/s3.mjs');
  const creds = r2Credentials();
  const store = await openS3BlobStore({ bucket: creds.bucket, clientOptions: s3ClientOptions(creds, { maxAttempts: 5 }) });
  /** @type {string[]} */
  const keys = [];
  /** @type {string | null} */
  let cursor = null;
  do {
    const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const entry of page.entries) keys.push(entry.key.slice(prefix.length));
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

/** @param {Record<number, number>} counts */
const perZoomText = (counts) => Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0])).map(([z, n]) => `z${z} ${n}`).join(', ');

/** @param {string[]} argv */
async function main(argv) {
  const arg = (/** @type {string} */ name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const values = (/** @type {string} */ name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [/** @type {string} */ (argv[i + 1])] : []));
  const keysFile = arg('--keys');
  if (!keysFile && !argv.includes('--from-r2')) throw new Error('give --from-r2, or --keys <file> with one --part');
  const parts = values('--part');
  for (const part of parts) if (!TILE_INDEX_FIELDS.some((f) => f.part === part)) throw new Error(`--part is one of ${TILE_INDEX_FIELDS.map((f) => f.part).join(', ')}`);
  if (keysFile && parts.length !== 1) throw new Error('--keys lists one pyramid: give one --part');
  const fields = TILE_INDEX_FIELDS.filter((f) => !parts.length || parts.includes(f.part));
  const ids = values('--layer');
  const text = readFileSync(META, 'utf8');
  const meta = JSON.parse(text);
  /** @type {Map<string, string[]>} */
  const listed = new Map();
  for (const id of ids.length ? ids : DEFAULT_LAYERS) {
    const layer = meta.layers.find((/** @type {{ id: string }} */ l) => l.id === id);
    if (!layer || layer.sourceType !== 'raster-dem') throw new Error(`no terrain layer ${id} in render/metadata/maps-test.json`);
    for (const { field, template, part } of fields) {
      if (typeof layer[template] !== 'string') throw new Error(`${id} has no ${template}`);
      const prefix = tilePrefix(layer[template]);
      if (!listed.has(prefix)) listed.set(prefix, keysFile ? readFileSync(keysFile, 'utf8').split(/\r?\n/) : await listR2(prefix));
      const keys = /** @type {string[]} */ (listed.get(prefix)).filter(Boolean);
      const range = part === 'hs'
        ? { minzoom: layer.hillshadeMinzoom ?? layer.minzoom, maxzoom: layer.hillshadeMaxzoom ?? layer.maxzoom }
        : { minzoom: layer.minzoom, maxzoom: layer.maxzoom };
      const index = encodeTileIndex(keys, range, { dropOrphans: true });
      const lookup = decodeTileIndex(index);
      const held = tileIndexCounts(lookup);
      /** @type {Record<number, number>} */
      const found = {};
      for (const k of keys) { const z = Number(k.split('/')[0]); if (z >= range.minzoom && z <= range.maxzoom) found[z] = (found[z] || 0) + 1; }
      console.log(`${id} ${field}: ${keys.length} tiles under ${prefix} (${perZoomText(found)}); index ${index.children.length} characters, ${lookup.size} tiles listed`);
      const lost = Object.keys(found).filter((z) => found[Number(z)] !== held[Number(z)]);
      if (lost.length) console.log(`  left out (no parent tile): ${lost.map((z) => `z${z} ${Number(found[Number(z)]) - Number(held[Number(z)] || 0)}`).join(', ')}`);
      layer[field] = index;
    }
  }
  if (argv.includes('--write')) {
    writeFileSync(META, `${JSON.stringify(meta, null, 2)}${text.endsWith('\n') ? '\n' : ''}`);
    console.log('wrote render/metadata/maps-test.json; now run npm run build:test2:metadata');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`FAIL: ${error.message}`); process.exit(1); });
}
