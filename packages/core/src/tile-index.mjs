/**
 * A compact list of the tiles a z/x/y pyramid holds, so a map asks only for tiles that exist and
 * draws a missing one from the nearest tile above it, over-zoomed. Two pyramids use it (19 Nov
 * 2026): the ireland-terrain-3d hillshade, complete island-wide to zoom 11 and to 16 only over the
 * NI LiDAR basins (stream w19-hillshade), and its DEM, complete to 15 and to 16 only over NI
 * (stream w19-dem-fallback).
 *
 * The index is a quadtree read breadth-first. `roots` are the tiles at `minzoom`; then, for every
 * tile below `maxzoom` in the order the tree is read (roots in their order, then each tile's
 * listed children in the order top-left, top-right, bottom-left, bottom-right), one character:
 *   - a hex digit says which of its four children exist (1 top-left, 2 top-right, 4 bottom-left,
 *     8 bottom-right); those children are listed further on;
 *   - a letter g-z says the tile's subtree is complete for 1-20 more zooms and holds nothing
 *     deeper (g: all four children, no grandchildren; h: all children and grandchildren; ...).
 *     Nothing of that subtree is listed further on, so a pyramid complete over most of its area
 *     (the DEM: 613,421 tiles) costs characters only along the edges of what it holds.
 * Every tile but a root has its parent in the pyramid (a tile pyramid built downwards is always so).
 * An index of hex digits only (the first form, w19-hillshade) reads the same.
 *
 * Pure and dependency-free: the map app reads it (packages/map/src/renderer/indexed-tiles.mjs),
 * the layer registry checks it (packages/registries/src/layers.mjs), and the OSNI ingest writes it
 * (scripts/ingest/osni/terrain-tile-index.mjs).
 *
 * @typedef {{ minzoom: number, maxzoom: number, roots: Array<[number, number]>, children: string }} TileIndex
 * @typedef {[number, number, number]} TileZXY  zoom, column, row
 * @typedef {Map<string, number>} TileLookup  each tile the index lists ("z/x/y") -> how many zooms
 *   below it are complete and not listed (0 for a hex-digit tile or one at maxzoom)
 */

/** @param {number} z @param {number} x @param {number} y */
const key = (z, x, y) => `${z}/${x}/${y}`;

/** The children of tile (x, y), in index order. @param {number} x @param {number} y @returns {Array<[number, number]>} */
const childrenOf = (x, y) => [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]];

/**
 * The layer fields that hold a tile index: the field, the field holding the z/x/y template of the
 * pyramid it lists, the map protocol's name for that pyramid (indexed-tiles.mjs), and whether its
 * tiles are elevations (a DEM, over-zoomed by resampling its heights: dem-overzoom.mjs) or an image.
 * @typedef {{ field: 'hillshadeTileIndex' | 'demTileIndex', template: 'hillshadeTiles' | 'tiles', part: 'hs' | 'dem', elevation: boolean }} TileIndexField
 * @type {ReadonlyArray<TileIndexField>}
 */
export const TILE_INDEX_FIELDS = Object.freeze([
  Object.freeze({ field: 'hillshadeTileIndex', template: 'hillshadeTiles', part: 'hs', elevation: false }),
  Object.freeze({ field: 'demTileIndex', template: 'tiles', part: 'dem', elevation: true })
]);

/** The deepest complete subtree one letter states (g-z). */
export const MAX_COMPLETE_DEPTH = 20;
const LETTER_BASE = 'g'.charCodeAt(0) - 1;
/** The characters of an index's `children`. */
export const TILE_INDEX_CHARS = /^[0-9a-z]*$/;

/**
 * The index of a set of tiles between minzoom and maxzoom (tiles outside are left out).
 * @param {Iterable<string>} tiles  "z/x/y" keys (a trailing extension such as .png is allowed)
 * @param {{ minzoom: number, maxzoom: number }} range
 * @param {{ dropOrphans?: boolean }} [options]  a tile without its parent throws, unless
 *   dropOrphans leaves it and its subtree out (the DEM's top row holds 3 such tiles: open sea
 *   off Gigha, outside the island, whose parents were never written)
 * @returns {TileIndex}
 */
export function encodeTileIndex(tiles, { minzoom, maxzoom }, { dropOrphans = false } = {}) {
  /** @type {Array<Set<string>>} the held tiles of each zoom, as "x/y" */
  const byZoom = [];
  for (let z = 0; z <= maxzoom; z++) byZoom.push(new Set());
  for (const raw of tiles) {
    const m = /^(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/.exec(String(raw).trim());
    if (!m) continue;
    const z = Number(m[1]);
    if (z >= minzoom && z <= maxzoom) /** @type {Set<string>} */ (byZoom[z]).add(`${m[2]}/${m[3]}`);
  }
  const held = (/** @type {number} */ z, /** @type {number} */ x, /** @type {number} */ y) => /** @type {Set<string>} */ (byZoom[z]).has(`${x}/${y}`);
  for (let z = minzoom + 1; z <= maxzoom; z++) {
    for (const xy of /** @type {Set<string>} */ (byZoom[z])) {
      const [x, y] = xy.split('/').map(Number);
      if (held(z - 1, Math.floor(Number(x) / 2), Math.floor(Number(y) / 2))) continue;
      if (!dropOrphans) throw new Error(`tile ${z}/${xy} has no parent tile in the pyramid`);
      /** @type {Set<string>} */ (byZoom[z]).delete(xy);
    }
  }
  // How many zooms below each tile are complete with nothing deeper, or -1 (bottom-up).
  /** @type {Array<Map<string, number>>} */
  const complete = byZoom.map(() => new Map());
  for (let z = maxzoom; z >= minzoom; z--) {
    for (const xy of /** @type {Set<string>} */ (byZoom[z])) {
      const [x, y] = xy.split('/').map(Number);
      let depth = 0;
      if (z < maxzoom) {
        const below = childrenOf(Number(x), Number(y)).map(([cx, cy]) => (held(z + 1, cx, cy) ? /** @type {number} */ (complete[z + 1]?.get(`${cx}/${cy}`)) : null));
        if (below.every((d) => d === null)) depth = 0;
        else if (below.every((d) => d !== null && d >= 0 && d === below[0])) depth = Number(below[0]) + 1;
        else depth = -1;
      }
      /** @type {Map<string, number>} */ (complete[z]).set(xy, depth);
    }
  }
  /** @type {Array<[number, number]>} */
  const roots = [...(/** @type {Set<string>} */ (byZoom[minzoom]))]
    .map((xy) => /** @type {[number, number]} */ (xy.split('/').map(Number)))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let children = '';
  /** @type {Array<[number, number]>} */
  let level = roots;
  for (let z = minzoom; z < maxzoom; z++) {
    /** @type {Array<[number, number]>} */
    const next = [];
    for (const [x, y] of level) {
      const depth = /** @type {number} */ (complete[z]?.get(`${x}/${y}`));
      if (depth >= 1 && depth <= MAX_COMPLETE_DEPTH) {
        children += String.fromCharCode(LETTER_BASE + depth);
        continue;
      }
      let digit = 0;
      childrenOf(x, y).forEach(([cx, cy], i) => {
        if (held(z + 1, cx, cy)) { digit |= 1 << i; next.push([cx, cy]); }
      });
      children += digit.toString(16);
    }
    level = next;
  }
  return { minzoom, maxzoom, roots, children };
}

/**
 * Why an index cannot be read, or [] when it can.
 * @param {unknown} index
 * @returns {string[]}
 */
export function tileIndexErrors(index) {
  const i = /** @type {Partial<TileIndex> | null} */ (index && typeof index === 'object' ? index : null);
  if (!i) return ['a tile index is an object'];
  /** @type {string[]} */
  const errors = [];
  const zoom = (/** @type {unknown} */ v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= 24;
  if (!zoom(i.minzoom) || !zoom(i.maxzoom) || /** @type {number} */ (i.minzoom) > /** @type {number} */ (i.maxzoom)) errors.push('minzoom and maxzoom are zooms 0-24, minzoom first');
  if (!Array.isArray(i.roots) || !i.roots.every((r) => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n >= 0))) errors.push('roots is a list of [x, y] tiles');
  if (typeof i.children !== 'string' || !TILE_INDEX_CHARS.test(i.children)) errors.push('children is a string of hex digits and letters g-z');
  if (errors.length) return errors;
  try {
    decodeTileIndex(/** @type {TileIndex} */ (i));
  } catch (error) {
    errors.push(/** @type {Error} */ (error).message);
  }
  return errors;
}

/**
 * The tiles an index lists, each with the depth of complete subtree below it that it stands for.
 * Throws when its characters do not match its tree.
 * @param {TileIndex} index
 * @returns {TileLookup}
 */
export function decodeTileIndex({ minzoom, maxzoom, roots, children }) {
  /** @type {TileLookup} */
  const tiles = new Map();
  let at = 0;
  /** @type {Array<[number, number]>} */
  let level = roots;
  for (const [x, y] of roots) tiles.set(key(minzoom, x, y), 0);
  for (let z = minzoom; z < maxzoom; z++) {
    /** @type {Array<[number, number]>} */
    const next = [];
    for (const [x, y] of level) {
      if (at >= children.length) throw new Error(`tile index ends early, at zoom ${z}`);
      const char = children.charAt(at++);
      if (char >= 'g' && char <= 'z') {
        const depth = char.charCodeAt(0) - LETTER_BASE;
        if (z + depth > maxzoom) throw new Error(`tile ${key(z, x, y)} is complete for ${depth} zooms, past maxzoom ${maxzoom}`);
        tiles.set(key(z, x, y), depth);
        continue;
      }
      const digit = parseInt(char, 16);
      if (Number.isNaN(digit)) throw new Error(`tile index character ${char} is not a hex digit or a letter g-z`);
      childrenOf(x, y).forEach(([cx, cy], i) => {
        if (digit & (1 << i)) { tiles.set(key(z + 1, cx, cy), 0); next.push([cx, cy]); }
      });
    }
    level = next;
  }
  if (at !== children.length) throw new Error(`tile index has ${children.length - at} digits too many`);
  return tiles;
}

/**
 * How many tiles an index holds at each zoom, without listing them (a DEM holds 600,000).
 * @param {TileLookup} lookup
 * @returns {Record<number, number>}
 */
export function tileIndexCounts(lookup) {
  /** @type {Record<number, number>} */
  const counts = {};
  for (const [k, depth] of lookup) {
    const z = Number(k.slice(0, k.indexOf('/')));
    for (let d = 0; d <= depth; d++) counts[z + d] = (counts[z + d] || 0) + 4 ** d;
  }
  return counts;
}

/**
 * Every tile an index holds, as "z/x/y" keys. For tests and small pyramids: it lists them all.
 * @param {TileIndex} index
 * @returns {Set<string>}
 */
export function tileIndexTiles(index) {
  /** @type {Set<string>} */
  const tiles = new Set();
  for (const [k, depth] of decodeTileIndex(index)) {
    const [z, x, y] = k.split('/').map(Number);
    for (let d = 0; d <= depth; d++) {
      const n = 2 ** d;
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) tiles.add(key(Number(z) + d, Number(x) * n + dx, Number(y) * n + dy));
    }
  }
  return tiles;
}

/**
 * The tile to draw tile (z, x, y) from: itself when the index holds it, else its nearest
 * ancestor the index holds (over-zoomed), else null (nothing there, as at sea).
 * Above the index's maxzoom a tile is drawn from its maxzoom ancestor, as MapLibre over-zooms.
 * The first listed tile on the way up decides: a listed tile's held children are listed too,
 * and a complete subtree's are not.
 * @param {TileLookup} tiles  decodeTileIndex's lookup
 * @param {{ minzoom: number }} index
 * @param {TileZXY} tile
 * @returns {TileZXY | null}
 */
export function nearestIndexedTile(tiles, { minzoom }, [z, x, y]) {
  for (let az = z, ax = x, ay = y; az >= minzoom; az--, ax = Math.floor(ax / 2), ay = Math.floor(ay / 2)) {
    const depth = tiles.get(key(az, ax, ay));
    if (depth === undefined) continue;
    const hz = Math.min(z, az + depth);
    const scale = 2 ** (z - hz);
    return [hz, Math.floor(x / scale), Math.floor(y / scale)];
  }
  return null;
}

/**
 * The square of an ancestor tile's image that covers a descendant tile, in the ancestor's pixels.
 * @param {TileZXY} tile
 * @param {TileZXY} ancestor
 * @param {number} tileSize  the ancestor image's width and height
 * @returns {{ sx: number, sy: number, size: number }}
 */
export function overzoomSquare([z, x, y], [az, ax, ay], tileSize) {
  const scale = 2 ** (z - az);
  const size = tileSize / scale;
  return { sx: (x - ax * scale) * size, sy: (y - ay * scale) * size, size };
}
