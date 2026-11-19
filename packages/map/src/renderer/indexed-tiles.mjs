/**
 * Tile pyramids that are not complete to their deepest zoom everywhere, drawn through one map
 * protocol, `civgraph-tiles://`. ireland-terrain-3d's hillshade covers the island to zoom 11 and
 * goes to 16 only over the NI LiDAR basins (stream w19-hillshade, 19 Nov 2026); its DEM covers the
 * island to 15 and goes to 16 only over NI (stream w19-dem-fallback, 19 Nov 2026). Without this,
 * every tile past the complete zooms was a 404: the drape vanished, and the terrain asked for
 * zoom-16 elevation it could not have.
 *
 * Such a layer carries a tile index per pyramid (packages/core/src/tile-index.mjs TILE_INDEX_FIELDS:
 * hillshadeTileIndex, demTileIndex), and that pyramid's source asks the protocol for
 * `civgraph-tiles://<layer id>/<part>/{z}/{x}/{y}`:
 *   - a tile the index holds is fetched;
 *   - any other is cut from its nearest held ancestor and over-zoomed, as MapLibre over-zooms a
 *     source above its maxzoom: an image (the drape) as the square of the ancestor, which
 *     MapLibre stretches; an elevation tile (the DEM) resampled to a full tile on its heights,
 *     never on its colours (packages/core/src/dem-overzoom.mjs);
 *   - one with no ancestor (open sea) is a silent 404.
 * So no tile that does not exist is ever requested, and each pyramid stays one source.
 *
 * The planning is pure (planIndexedTile); loadIndexedTile carries the plan out in the browser.
 */
import { TILE_INDEX_FIELDS, decodeTileIndex, nearestIndexedTile, overzoomSquare } from '../../../core/src/tile-index.mjs';
import { demPackedValues, overzoomDemPixels } from '../../../core/src/dem-overzoom.mjs';

/** @typedef {import('../../../core/src/tile-index.mjs').TileIndex} TileIndex */
/** @typedef {import('../../../core/src/tile-index.mjs').TileZXY} TileZXY */
/** @typedef {import('../../../core/src/tile-index.mjs').TileIndexField['part']} TilePart */
/**
 * @typedef {{ template: string, index: TileIndex, tiles: import('../../../core/src/tile-index.mjs').TileLookup, tileSize: number, elevation: boolean }} TilePyramid
 * @typedef {{ kind: 'fetch', url: string }
 *   | { kind: 'overzoom', url: string, square: { sx: number, sy: number, size: number } }
 *   | { kind: 'none' }} IndexedTilePlan
 */

export const INDEXED_TILES_PROTOCOL = 'civgraph-tiles';

/** "<layer id>/<part>" -> its pyramid, while the layer is on the map (registerTilePyramid). */
/** @type {Map<string, TilePyramid>} */
const pyramids = new Map();

/** @param {string} layerId @param {string} part */
const pyramidKey = (layerId, part) => `${layerId}/${part}`;

/**
 * A pyramid's tile URL template for a layer: the protocol, the layer id, the part, then z/x/y.
 * @param {string} layerId
 * @param {TilePart} part
 */
export function indexedTilesTemplate(layerId, part) {
  return `${INDEXED_TILES_PROTOCOL}://${encodeURIComponent(layerId)}/${part}/{z}/{x}/{y}`;
}

/**
 * The layer id, part and tile of a protocol URL, or null.
 * @param {string} url
 * @returns {{ layerId: string, part: string, tile: TileZXY } | null}
 */
export function parseIndexedTileUrl(url) {
  const m = new RegExp(`^${INDEXED_TILES_PROTOCOL}://([^/]+)/([a-z]+)/(\\d+)/(\\d+)/(\\d+)$`).exec(url);
  if (!m) return null;
  return { layerId: decodeURIComponent(/** @type {string} */ (m[1])), part: /** @type {string} */ (m[2]), tile: [Number(m[3]), Number(m[4]), Number(m[5])] };
}

/**
 * A tile's URL from the layer's z/x/y template.
 * @param {string} template
 * @param {TileZXY} tile
 */
export function fillTileTemplate(template, [z, x, y]) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

/**
 * A pyramid, from its template (absolute) and index.
 * @param {string} template
 * @param {TileIndex} index
 * @param {number} tileSize
 * @param {boolean} elevation  its tiles are DEM tiles
 * @returns {TilePyramid}
 */
export function tilePyramid(template, index, tileSize, elevation) {
  return { template, index, tiles: decodeTileIndex(index), tileSize, elevation };
}

/**
 * How to draw one tile of a pyramid. Pure.
 * @param {TilePyramid | undefined} pyramid
 * @param {TileZXY} tile
 * @returns {IndexedTilePlan}
 */
export function planIndexedTile(pyramid, tile) {
  if (!pyramid) return { kind: 'none' };
  const from = nearestIndexedTile(pyramid.tiles, pyramid.index, tile);
  if (!from) return { kind: 'none' };
  const url = fillTileTemplate(pyramid.template, from);
  if (from[0] === tile[0]) return { kind: 'fetch', url };
  return { kind: 'overzoom', url, square: overzoomSquare(tile, from, pyramid.tileSize) };
}

/**
 * Puts a layer's pyramid where the protocol reads it.
 * @param {string} layerId
 * @param {TilePart} part
 * @param {TilePyramid} pyramid
 */
export function registerTilePyramid(layerId, part, pyramid) {
  pyramids.set(pyramidKey(layerId, part), pyramid);
}

/** Drops every pyramid of a layer. @param {string} layerId */
export function unregisterTilePyramids(layerId) {
  for (const { part } of TILE_INDEX_FIELDS) pyramids.delete(pyramidKey(layerId, part));
}

/** @param {string} layerId @param {TilePart} part */
export function hasTilePyramid(layerId, part) {
  return pyramids.has(pyramidKey(layerId, part));
}

/** Ancestor tiles, by URL: the few a view over-zooms from, each cut many times. */
const ANCESTOR_CACHE = 48;
/** @type {Map<string, Promise<Blob>>} */
const imageAncestors = new Map();
/** @type {Map<string, Promise<{ width: number, packed: Uint32Array }>>} */
const demAncestors = new Map();

/**
 * The cached promise of url in cache, else load()'s, kept most recent last and bounded.
 * @template T
 * @param {Map<string, Promise<T>>} cache
 * @param {string} url
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
function cachedAncestor(cache, url, load) {
  const cached = cache.get(url);
  if (cached) {
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }
  const loading = load();
  loading.catch(() => cache.delete(url));
  cache.set(url, loading);
  while (cache.size > ANCESTOR_CACHE) cache.delete(/** @type {string} */ (cache.keys().next().value));
  return loading;
}

/** @param {string} url @param {AbortSignal} [signal] */
async function fetchTile(url, signal) {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw Object.assign(new Error(`tile ${res.status}`), { status: res.status });
  return res;
}

/**
 * An ancestor DEM tile's packed heights. Decoded without colour conversion or premultiplied
 * alpha, so its bytes are the file's (the tiles are opaque RGB PNGs).
 * @param {string} url
 */
async function loadDemAncestor(url) {
  const bitmap = await createImageBitmap(await (await fetchTile(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const { width, height } = bitmap;
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const context = /** @type {OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null} */ (canvas.getContext('2d', { willReadFrequently: true }));
  if (!context) throw new Error('no 2d canvas to read a DEM tile');
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width, packed: demPackedValues(context.getImageData(0, 0, width, height).data) };
}

/** A 404 MapLibre passes over in silence (TileManager._loadTile). */
const notThere = () => Object.assign(new Error('no tile here'), { status: 404 });

/**
 * The `civgraph-tiles://` protocol's loader (maplibregl.addProtocol).
 * @type {import('maplibre-gl').AddProtocolAction}
 */
export async function loadIndexedTile(params, abortController) {
  const parsed = parseIndexedTileUrl(params.url);
  if (!parsed) throw notThere();
  const pyramid = pyramids.get(pyramidKey(parsed.layerId, parsed.part));
  const plan = planIndexedTile(pyramid, parsed.tile);
  if (!pyramid || plan.kind === 'none') throw notThere();
  if (plan.kind === 'fetch') {
    return { data: await (await fetchTile(plan.url, abortController.signal)).arrayBuffer() };
  }
  // An ancestor is shared by every tile cut from it, so no one tile's abort cancels it.
  if (pyramid.elevation) {
    const { width, packed } = await cachedAncestor(demAncestors, plan.url, () => loadDemAncestor(plan.url));
    if (abortController.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const pixels = overzoomDemPixels(packed, width, plan.square, width);
    return { data: await createImageBitmap(new ImageData(pixels, width, width), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) };
  }
  const blob = await cachedAncestor(imageAncestors, plan.url, async () => (await fetchTile(plan.url)).blob());
  if (abortController.signal.aborted) throw new DOMException('aborted', 'AbortError');
  // MapLibre stretches a raster tile's image over the tile, smoothing it as it over-zooms its own.
  const { sx, sy, size } = plan.square;
  const side = Math.max(1, Math.floor(size));
  return { data: await createImageBitmap(blob, Math.floor(sx), Math.floor(sy), side, side) };
}
