#!/usr/bin/env node
/**
 * Sets `hillshadeTileIndex` on the island terrain layers (ireland-terrain-3d and its grey twin):
 * the list of the tiles their hillshade pyramid holds (packages/core/src/tile-index.mjs), so the
 * map asks only for those and over-zooms the rest (packages/map/src/renderer/hillshade-tiles.mjs).
 *
 *   node scripts/ingest/osni/hillshade-index.mjs --keys <file> [--layer <id> ...] [--write]
 *   node scripts/ingest/osni/hillshade-index.mjs --from-r2 [--layer <id> ...] [--write]
 *
 * --keys reads the pyramid's tiles from a file, one `z/x/y.png` a line (paths under hs/);
 * --from-r2 lists the layer's hs/ prefix on R2 (read only; .env.local holds the keys). Without
 * --write it prints what it found; with it it sets the field on each layer in
 * render/metadata/maps-test.json. Then run `npm run build:test2:metadata`.
 *
 * Re-run it after the pyramid changes (a new LiDAR block, the island-terrain step of this plugin):
 * a tile the index does not hold is never fetched.
 *
 * Found 19 Nov 2026 (w19-hillshade): 21,466 tiles; zooms 5-11 hold every land tile of the island
 * (the tiles they lack are open sea); 12-16 only the NI River Basin LiDAR, 14,055 tiles at 16.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeTileIndex } from '@civgraph/core/tile-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const META = path.join(ROOT, 'render/metadata/maps-test.json');
const DEFAULT_LAYERS = ['ireland-terrain-3d', 'ireland-terrain-3d-grey'];

/**
 * The R2 key prefix of a hillshade template on the data CDN, e.g. data/maps/physical/x/hs/.
 * @param {string} template
 */
export function hillshadePrefix(template) {
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

/** @param {string[]} argv */
async function main(argv) {
  const arg = (/** @type {string} */ name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const keysFile = arg('--keys');
  if (!keysFile && !argv.includes('--from-r2')) throw new Error('give --keys <file> or --from-r2');
  const ids = argv.flatMap((a, i) => (a === '--layer' && argv[i + 1] ? [/** @type {string} */ (argv[i + 1])] : []));
  const text = readFileSync(META, 'utf8');
  const meta = JSON.parse(text);
  /** @type {Map<string, string[]>} */
  const listed = new Map();
  for (const id of ids.length ? ids : DEFAULT_LAYERS) {
    const layer = meta.layers.find((/** @type {{ id: string }} */ l) => l.id === id);
    if (!layer?.hillshadeTiles) throw new Error(`no terrain layer ${id} with hillshadeTiles in render/metadata/maps-test.json`);
    const prefix = hillshadePrefix(layer.hillshadeTiles);
    if (!listed.has(prefix)) listed.set(prefix, keysFile ? readFileSync(keysFile, 'utf8').split(/\r?\n/) : await listR2(prefix));
    const keys = /** @type {string[]} */ (listed.get(prefix));
    const index = encodeTileIndex(keys, { minzoom: layer.hillshadeMinzoom ?? layer.minzoom, maxzoom: layer.hillshadeMaxzoom ?? layer.maxzoom });
    const perZoom = new Map();
    for (const k of keys) { const z = Number(k.split('/')[0]); if (Number.isInteger(z) && k) perZoom.set(z, (perZoom.get(z) || 0) + 1); }
    console.log(`${id}: ${keys.filter(Boolean).length} tiles under ${prefix} (${[...perZoom].sort((a, b) => a[0] - b[0]).map(([z, n]) => `z${z} ${n}`).join(', ')}); index ${index.children.length} digits`);
    layer.hillshadeTileIndex = index;
  }
  if (argv.includes('--write')) {
    writeFileSync(META, `${JSON.stringify(meta, null, 2)}${text.endsWith('\n') ? '\n' : ''}`);
    console.log('wrote render/metadata/maps-test.json; now run npm run build:test2:metadata');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`FAIL: ${error.message}`); process.exit(1); });
}
