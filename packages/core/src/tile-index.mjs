/**
 * A compact list of the tiles a z/x/y pyramid holds, so a map asks only for tiles that exist and
 * draws a missing one from the nearest tile above it, over-zoomed (19 Nov 2026, stream
 * w19-hillshade: the ireland-terrain-3d hillshade is complete island-wide to zoom 11 and goes to
 * 16 only over the NI LiDAR basins).
 *
 * The index is a quadtree read breadth-first. `roots` are the tiles at `minzoom`; then, for every
 * tile below `maxzoom` in the order the tree is read (roots in their order, then each tile's
 * children in the order top-left, top-right, bottom-left, bottom-right), one hex digit says which
 * of its four children exist: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right. Every tile
 * but a root has its parent in the pyramid (a tile pyramid built downwards is always so).
 *
 * Pure and dependency-free: the map app reads it (packages/map/src/renderer/hillshade-tiles.mjs),
 * the layer registry checks it (packages/registries/src/layers.mjs), and the OSNI ingest writes it
 * (scripts/ingest/osni/hillshade-index.mjs).
 *
 * @typedef {{ minzoom: number, maxzoom: number, roots: Array<[number, number]>, children: string }} TileIndex
 * @typedef {[number, number, number]} TileZXY  zoom, column, row
 */

/** @param {number} z @param {number} x @param {number} y */
const key = (z, x, y) => `${z}/${x}/${y}`;

/** The children of tile (x, y), in index order. @param {number} x @param {number} y @returns {Array<[number, number]>} */
const childrenOf = (x, y) => [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]];

/**
 * The index of a set of tiles between minzoom and maxzoom (tiles outside are left out).
 * @param {Iterable<string>} tiles  "z/x/y" keys (a trailing extension such as .png is allowed)
 * @param {{ minzoom: number, maxzoom: number }} range
 * @returns {TileIndex}
 */
export function encodeTileIndex(tiles, { minzoom, maxzoom }) {
  /** @type {Set<string>} */
  const held = new Set();
  for (const raw of tiles) {
    const m = /^(\d+)\/(\d+)\/(\d+)(?:\.\w+)?$/.exec(String(raw).trim());
    if (!m) continue;
    const z = Number(m[1]);
    if (z >= minzoom && z <= maxzoom) held.add(key(z, Number(m[2]), Number(m[3])));
  }
  for (const k of held) {
    const [z, x, y] = k.split('/').map(Number);
    if (z === undefined || x === undefined || y === undefined) continue;
    if (z > minzoom && !held.has(key(z - 1, Math.floor(x / 2), Math.floor(y / 2)))) {
      throw new Error(`tile ${k} has no parent tile in the pyramid`);
    }
  }
  /** @type {Array<[number, number]>} */
  const roots = [...held]
    .map((k) => k.split('/').map(Number))
    .filter(([z]) => z === minzoom)
    .map(([, x, y]) => /** @type {[number, number]} */ ([Number(x), Number(y)]))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  let children = '';
  /** @type {Array<[number, number]>} */
  let level = roots;
  for (let z = minzoom; z < maxzoom; z++) {
    /** @type {Array<[number, number]>} */
    const next = [];
    for (const [x, y] of level) {
      let digit = 0;
      childrenOf(x, y).forEach(([cx, cy], i) => {
        if (held.has(key(z + 1, cx, cy))) { digit |= 1 << i; next.push([cx, cy]); }
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
  if (typeof i.children !== 'string' || !/^[0-9a-f]*$/.test(i.children)) errors.push('children is a string of hex digits');
  if (errors.length) return errors;
  try {
    decodeTileIndex(/** @type {TileIndex} */ (i));
  } catch (error) {
    errors.push(/** @type {Error} */ (error).message);
  }
  return errors;
}

/**
 * The tiles an index holds, as "z/x/y" keys. Throws when its digits do not match its tree.
 * @param {TileIndex} index
 * @returns {Set<string>}
 */
export function decodeTileIndex({ minzoom, maxzoom, roots, children }) {
  /** @type {Set<string>} */
  const tiles = new Set();
  let at = 0;
  /** @type {Array<[number, number]>} */
  let level = roots;
  for (const [x, y] of roots) tiles.add(key(minzoom, x, y));
  for (let z = minzoom; z < maxzoom; z++) {
    /** @type {Array<[number, number]>} */
    const next = [];
    for (const [x, y] of level) {
      if (at >= children.length) throw new Error(`tile index ends early, at zoom ${z}`);
      const digit = parseInt(children.charAt(at++), 16);
      childrenOf(x, y).forEach(([cx, cy], i) => {
        if (digit & (1 << i)) { tiles.add(key(z + 1, cx, cy)); next.push([cx, cy]); }
      });
    }
    level = next;
  }
  if (at !== children.length) throw new Error(`tile index has ${children.length - at} digits too many`);
  return tiles;
}

/**
 * The tile to draw tile (z, x, y) from: itself when the index holds it, else its nearest
 * ancestor the index holds (over-zoomed), else null (nothing there, as at sea).
 * Above the index's maxzoom a tile is drawn from its maxzoom ancestor, as MapLibre over-zooms.
 * @param {Set<string>} tiles  decodeTileIndex's set
 * @param {{ minzoom: number }} index
 * @param {TileZXY} tile
 * @returns {TileZXY | null}
 */
export function nearestIndexedTile(tiles, { minzoom }, [z, x, y]) {
  for (let az = z, ax = x, ay = y; az >= minzoom; az--, ax = Math.floor(ax / 2), ay = Math.floor(ay / 2)) {
    if (tiles.has(key(az, ax, ay))) return [az, ax, ay];
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
