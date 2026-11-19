/**
 * The hillshade drape of a terrain layer whose pyramid is not complete to its deepest zoom
 * (19 Nov 2026, stream w19-hillshade). ireland-terrain-3d's hillshade covers the island to zoom 11
 * and goes to 16 only over the NI LiDAR basins; above 11 elsewhere every tile was a 404 and the
 * relief shading vanished. Such a layer carries `hillshadeTileIndex` (packages/core/src/tile-index.mjs),
 * and its drape is drawn through the `civgraph-hs://` protocol: a tile the index holds is fetched;
 * any other is cut from its nearest held ancestor and over-zoomed, as MapLibre over-zooms a
 * source above its maxzoom; one with no ancestor (open sea) is a silent 404. So no tile that does
 * not exist is ever requested, and the drape stays one source and one style layer, drawn once
 * (two half-transparent drapes over each other would show darker).
 *
 * The planning is pure (planHillshadeTile); loadHillshadeTile carries the plan out in the browser.
 */
import { decodeTileIndex, nearestIndexedTile, overzoomSquare } from '../../../core/src/tile-index.mjs';

/** @typedef {import('../../../core/src/tile-index.mjs').TileIndex} TileIndex */
/** @typedef {import('../../../core/src/tile-index.mjs').TileZXY} TileZXY */
/**
 * @typedef {{ template: string, index: TileIndex, tiles: Set<string>, tileSize: number }} HillshadePyramid
 * @typedef {{ kind: 'fetch', url: string }
 *   | { kind: 'overzoom', url: string, square: { sx: number, sy: number, size: number } }
 *   | { kind: 'none' }} HillshadeTilePlan
 */

export const HILLSHADE_PROTOCOL = 'civgraph-hs';

/** layer id -> its pyramid, while the layer is on the map (registerHillshadePyramid). */
/** @type {Map<string, HillshadePyramid>} */
const pyramids = new Map();

/**
 * The drape's tile URL template for a layer: the protocol, the layer id, then z/x/y.
 * @param {string} layerId
 */
export function hillshadeProtocolTemplate(layerId) {
  return `${HILLSHADE_PROTOCOL}://${encodeURIComponent(layerId)}/{z}/{x}/{y}`;
}

/**
 * The layer id and tile of a protocol URL, or null.
 * @param {string} url
 * @returns {{ layerId: string, tile: TileZXY } | null}
 */
export function parseHillshadeUrl(url) {
  const m = new RegExp(`^${HILLSHADE_PROTOCOL}://([^/]+)/(\\d+)/(\\d+)/(\\d+)$`).exec(url);
  if (!m) return null;
  return { layerId: decodeURIComponent(/** @type {string} */ (m[1])), tile: [Number(m[2]), Number(m[3]), Number(m[4])] };
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
 * The pyramid of a layer, from its hillshade template (absolute) and index.
 * @param {string} template
 * @param {TileIndex} index
 * @param {number} tileSize
 * @returns {HillshadePyramid}
 */
export function hillshadePyramid(template, index, tileSize) {
  return { template, index, tiles: decodeTileIndex(index), tileSize };
}

/**
 * How to draw one tile of a pyramid. Pure.
 * @param {HillshadePyramid | undefined} pyramid
 * @param {TileZXY} tile
 * @returns {HillshadeTilePlan}
 */
export function planHillshadeTile(pyramid, tile) {
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
 * @param {HillshadePyramid} pyramid
 */
export function registerHillshadePyramid(layerId, pyramid) {
  pyramids.set(layerId, pyramid);
}

/** @param {string} layerId */
export function unregisterHillshadePyramid(layerId) {
  pyramids.delete(layerId);
}

/** @param {string} layerId */
export function hasHillshadePyramid(layerId) {
  return pyramids.has(layerId);
}

/** Ancestor images, by URL: the few a view over-zooms from, each cut many times. */
/** @type {Map<string, Promise<Blob>>} */
const ancestors = new Map();
const ANCESTOR_CACHE = 48;

/** @param {string} url @returns {Promise<Blob>} */
function ancestorImage(url) {
  const cached = ancestors.get(url);
  if (cached) {
    ancestors.delete(url);
    ancestors.set(url, cached);
    return cached;
  }
  // Shared by every tile cut from it, so no one tile's abort cancels it.
  const loading = fetch(url).then((res) => {
    if (!res.ok) throw Object.assign(new Error(`hillshade tile ${res.status}`), { status: res.status });
    return res.blob();
  });
  loading.catch(() => ancestors.delete(url));
  ancestors.set(url, loading);
  while (ancestors.size > ANCESTOR_CACHE) ancestors.delete(/** @type {string} */ (ancestors.keys().next().value));
  return loading;
}

/** A 404 MapLibre passes over in silence (TileManager._loadTile). */
const notThere = () => Object.assign(new Error('no hillshade tile here'), { status: 404 });

/**
 * The `civgraph-hs://` protocol's loader (maplibregl.addProtocol).
 * @type {import('maplibre-gl').AddProtocolAction}
 */
export async function loadHillshadeTile(params, abortController) {
  const parsed = parseHillshadeUrl(params.url);
  if (!parsed) throw notThere();
  const plan = planHillshadeTile(pyramids.get(parsed.layerId), parsed.tile);
  if (plan.kind === 'none') throw notThere();
  if (plan.kind === 'fetch') {
    const res = await fetch(plan.url, { signal: abortController.signal });
    if (!res.ok) throw Object.assign(new Error(`hillshade tile ${res.status}`), { status: res.status });
    return { data: await res.arrayBuffer() };
  }
  const blob = await ancestorImage(plan.url);
  if (abortController.signal.aborted) throw new DOMException('aborted', 'AbortError');
  // MapLibre stretches a raster tile's image over the tile, smoothing it as it over-zooms its own.
  const { sx, sy, size } = plan.square;
  const side = Math.max(1, Math.floor(size));
  return { data: await createImageBitmap(blob, Math.floor(sx), Math.floor(sy), side, side) };
}
