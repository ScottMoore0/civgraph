/**
 * Tile pyramids that are not complete everywhere (packages/core/src/tile-index.mjs), the protocol
 * that draws them (packages/map/src/renderer/indexed-tiles.mjs) and the DEM over-zoom
 * (packages/core/src/dem-overzoom.mjs). ireland-terrain-3d's hillshade covers the island to zoom 11
 * and the NI LiDAR basins to 16 (w19-hillshade); its DEM covers the island to 15 and NI to 16
 * (w19-dem-fallback). The map must ask only for tiles that exist and over-zoom the rest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '@civgraph/registries/index.mjs';
import { layerRecordErrors } from '@civgraph/registries/layers.mjs';
import {
  TILE_INDEX_FIELDS, decodeTileIndex, encodeTileIndex, nearestIndexedTile, overzoomSquare, tileIndexCounts, tileIndexErrors, tileIndexTiles
} from '@civgraph/core/tile-index.mjs';
import { demHeight, demPackedValues, overzoomDemPixels } from '@civgraph/core/dem-overzoom.mjs';
import { COMPACT_LAYER_FIELDS } from '@civgraph/core/layer-index.js';
import {
  fillTileTemplate, indexedTilesTemplate, parseIndexedTileUrl, planIndexedTile, tilePyramid
} from '@civgraph/map/renderer/indexed-tiles.mjs';
import { hillshadeSource, terrainRenderer, tilePyramidsOf } from '@civgraph/map/renderer/layer-kinds/terrain.mjs';

/** @type {any} */ (globalThis).location ??= { origin: 'https://civgraph.example' };

// A small pyramid: one root at zoom 1, complete to 2 under it; at 3 only under tile 2/1/1.
const SMALL = ['1/0/0.png', '2/0/0.png', '2/1/0.png', '2/0/1.png', '2/1/1.png', '3/2/2.png', '3/3/3.png'];

/** Every tile of the square of zoom-z tiles under (z0, x0, y0), down to zoom z1. @returns {string[]} */
function subtree(/** @type {number} */ z0, /** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ z1) {
  const out = [];
  for (let z = z0; z <= z1; z++) {
    const n = 2 ** (z - z0);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out.push(`${z}/${x0 * n + x}/${y0 * n + y}`);
  }
  return out;
}

/** The zoom-z tile of a place. @param {number} z @param {[number, number]} lngLat @returns {[number, number, number]} */
function tileAt(z, [lng, lat]) {
  const r = (lat * Math.PI) / 180;
  return [z, Math.floor(((lng + 180) / 360) * 2 ** z), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)];
}

test('tile index: encodes breadth-first, one character per listed tile, and decodes back', () => {
  const index = encodeTileIndex(SMALL, { minzoom: 1, maxzoom: 3 });
  // 1/0/0 has all four children (f); of those only 2/1/1 has children: top-left 3/2/2 (1) and bottom-right 3/3/3 (8).
  assert.deepEqual(index, { minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f0009' });
  assert.deepEqual([...tileIndexTiles(index)].sort(), SMALL.map((k) => k.replace('.png', '')).sort());
  assert.deepEqual(tileIndexErrors(index), []);
  // Tiles outside the range are left out; lines that are not tiles are ignored.
  assert.deepEqual(encodeTileIndex([...SMALL, '0/0/0.png', '4/4/4.png', '', 'README'], { minzoom: 1, maxzoom: 3 }), index);
});

test('tile index: a complete subtree is one letter, and nothing of it is listed', () => {
  // Root 1/0/0 complete to 3 (h: two zooms below it); root 1/1/0 complete to 2 only (g); 1/0/1 alone.
  const tiles = [...subtree(1, 0, 0, 3), ...subtree(1, 1, 0, 2), '1/0/1'];
  const index = encodeTileIndex(tiles, { minzoom: 1, maxzoom: 3 });
  assert.deepEqual(index, { minzoom: 1, maxzoom: 3, roots: [[0, 0], [1, 0], [0, 1]], children: 'hg0' });
  assert.deepEqual([...tileIndexTiles(index)].sort(), [...tiles].sort());
  const lookup = decodeTileIndex(index);
  assert.deepEqual([...lookup], [['1/0/0', 2], ['1/1/0', 1], ['1/0/1', 0]]);
  assert.deepEqual(tileIndexCounts(lookup), { 1: 3, 2: 8, 3: 16 });
  // Under a complete subtree a tile is held itself; past its depth, drawn from its deepest zoom.
  assert.deepEqual(nearestIndexedTile(lookup, index, [3, 3, 1]), [3, 3, 1]);
  assert.deepEqual(nearestIndexedTile(lookup, index, [3, 5, 2]), [2, 2, 1], '1/1/0 is complete to 2 only');
  assert.deepEqual(nearestIndexedTile(lookup, index, [5, 13, 9]), [3, 3, 2], 'above maxzoom');
  assert.deepEqual(nearestIndexedTile(lookup, index, [2, 1, 3]), [1, 0, 1]);
  // A first-form index (hex digits only) of the same tiles reads the same.
  const hexOnly = { minzoom: 1, maxzoom: 3, roots: index.roots, children: 'ff0' + 'ffff' + '0000' };
  assert.deepEqual(tileIndexTiles(hexOnly), tileIndexTiles(index));
  // A letter deeper than maxzoom allows is refused.
  assert.match(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'i' }).join(), /past maxzoom 3/);
});

test('tile index: refuses a tile without its parent, unless told to drop it, and an index whose characters do not fit its tree', () => {
  assert.throws(() => encodeTileIndex(['1/0/0', '3/0/0'], { minzoom: 1, maxzoom: 3 }), /3\/0\/0 has no parent/);
  assert.deepEqual(encodeTileIndex(['1/0/0', '3/0/0', '4/0/0'], { minzoom: 1, maxzoom: 4 }, { dropOrphans: true }), { minzoom: 1, maxzoom: 4, roots: [[0, 0]], children: '0' });
  assert.match(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f000' }).join(), /ends early/);
  assert.match(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f00090' }).join(), /1 digits too many/);
  assert.ok(tileIndexErrors({ minzoom: 3, maxzoom: 1, roots: [], children: '' }).length);
  assert.ok(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0]], children: 'f' }).length);
  assert.ok(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f0G9' }).length);
  assert.ok(tileIndexErrors(null).length);
});

test('tile index: a tile is drawn from itself, else its nearest held ancestor, else nothing', () => {
  const index = encodeTileIndex(SMALL, { minzoom: 1, maxzoom: 3 });
  const tiles = decodeTileIndex(index);
  assert.deepEqual(nearestIndexedTile(tiles, index, [3, 3, 3]), [3, 3, 3]);
  assert.deepEqual(nearestIndexedTile(tiles, index, [3, 0, 0]), [2, 0, 0]);
  assert.deepEqual(nearestIndexedTile(tiles, index, [5, 13, 13]), [3, 3, 3], 'above maxzoom, from the deepest tile');
  assert.equal(nearestIndexedTile(tiles, index, [3, 8, 8]), null, 'no ancestor held');
  assert.equal(nearestIndexedTile(tiles, index, [0, 0, 0]), null, 'below minzoom');
  // 3/5/2 lies under 2/2/1 and 1/1/0, neither held.
  assert.equal(nearestIndexedTile(tiles, index, [3, 5, 2]), null);
});

test('tile index: the over-zoomed square of an ancestor tile', () => {
  assert.deepEqual(overzoomSquare([12, 3, 2], [11, 1, 1], 256), { sx: 128, sy: 0, size: 128 });
  assert.deepEqual(overzoomSquare([16, 31650, 21250], [11, 989, 664], 256), { sx: 2 * 8, sy: 2 * 8, size: 8 });
  assert.deepEqual(overzoomSquare([11, 989, 664], [11, 989, 664], 256), { sx: 0, sy: 0, size: 256 });
});

test('DEM over-zoom: resamples heights, not colours, and keeps the encoding exact', () => {
  /** A Terrarium pixel of height h. @param {number} h */
  const terrarium = (h) => { const v = Math.round((h + 32768) * 256); return [v >> 16, (v >> 8) & 255, v & 255, 255]; };
  // A 2x2 tile: 255 m and 256 m on the top row (R and G both change between them), 0 and 1000 m below.
  const rgba = [...terrarium(255), ...terrarium(256), ...terrarium(0), ...terrarium(1000)];
  const packed = demPackedValues(rgba);
  assert.deepEqual([...packed].map((v) => v / 256 - 32768), [255, 256, 0, 1000]);
  // The whole tile, resampled to itself: unchanged.
  assert.deepEqual([...overzoomDemPixels(packed, 2, { sx: 0, sy: 0, size: 2 }, 2)], rgba);
  // The top-left quarter (one pixel) to a 2x2 tile. As MapLibre's terrain shader reads a DEM,
  // pixel i of the out tile lies at i/2 of an ancestor pixel: 0 on pixel 0, 0.5 between 0 and 1.
  const out = overzoomDemPixels(packed, 2, { sx: 0, sy: 0, size: 1 }, 2);
  const heights = [];
  for (let p = 0; p < out.length; p += 4) {
    assert.equal(out[p + 3], 255, 'opaque');
    heights.push(demHeight(Number(out[p]), Number(out[p + 1]), Number(out[p + 2]), 'terrarium'));
  }
  assert.deepEqual(heights, [255, 255.5, 127.5, (255 + 256 + 0 + 1000) / 4]);
  // Every height lies between its neighbours: none of the ~128 m or ~384 m a colour blend gives.
  for (const h of heights) assert.ok(h >= 0 && h <= 1000);
  assert.ok(heights.slice(0, 2).every((h) => h >= 255 && h <= 256), 'between 255 and 256 m');
  // One zoom down, every 2nd pixel of the child is its ancestor's pixel exactly, and the others
  // lie on the bilinear surface between them: the surface MapLibre drew from the ancestor itself.
  const size = 8;
  const random = Array.from({ length: size * size }, (_, i) => terrarium(((i * 7919) % 1500) - 20 + (i % 3) / 4)).flat();
  const parent = demPackedValues(random);
  for (const [sx, sy] of [[0, 0], [4, 0], [0, 4], [4, 4]]) {
    const child = demPackedValues(overzoomDemPixels(parent, size, { sx, sy, size: 4 }, size));
    for (let j = 0; j < size; j += 2) for (let i = 0; i < size; i += 2) {
      assert.equal(child[j * size + i], parent[(sy + j / 2) * size + sx + i / 2], `child ${sx},${sy} pixel ${i},${j}`);
    }
    const mid = (/** @type {number} */ a, /** @type {number} */ b) => Math.round((Number(parent[a]) + Number(parent[b])) / 2);
    assert.equal(child[1], mid(sy * size + sx, sy * size + sx + 1), 'between two ancestor pixels');
  }
  // Mapbox terrain-RGB is affine in the same 24 bits: the same resample serves it.
  assert.equal(demHeight(1, 134, 160, 'mapbox'), 0);
});

test('indexed-tiles protocol: URLs and the plan for each tile', () => {
  assert.equal(indexedTilesTemplate('ireland-terrain-3d', 'hs'), 'civgraph-tiles://ireland-terrain-3d/hs/{z}/{x}/{y}');
  assert.equal(indexedTilesTemplate('ireland-terrain-3d', 'dem'), 'civgraph-tiles://ireland-terrain-3d/dem/{z}/{x}/{y}');
  assert.deepEqual(parseIndexedTileUrl('civgraph-tiles://ireland-terrain-3d/dem/12/1975/1323'), { layerId: 'ireland-terrain-3d', part: 'dem', tile: [12, 1975, 1323] });
  assert.deepEqual(parseIndexedTileUrl('civgraph-tiles://a%20b/hs/1/2/3'), { layerId: 'a b', part: 'hs', tile: [1, 2, 3] });
  assert.equal(parseIndexedTileUrl('https://x/1/2/3'), null);
  assert.equal(parseIndexedTileUrl('civgraph-tiles://x/1/2/3'), null, 'no part');
  assert.equal(fillTileTemplate('https://d/hs/{z}/{x}/{y}.png?v=1', [3, 4, 5]), 'https://d/hs/3/4/5.png?v=1');
  const pyramid = tilePyramid('https://d/hs/{z}/{x}/{y}.png?v=1', encodeTileIndex(SMALL, { minzoom: 1, maxzoom: 3 }), 256, false);
  assert.deepEqual(planIndexedTile(pyramid, [3, 2, 2]), { kind: 'fetch', url: 'https://d/hs/3/2/2.png?v=1' });
  assert.deepEqual(planIndexedTile(pyramid, [3, 1, 0]), { kind: 'overzoom', url: 'https://d/hs/2/0/0.png?v=1', square: { sx: 128, sy: 0, size: 128 } });
  assert.deepEqual(planIndexedTile(pyramid, [3, 7, 0]), { kind: 'none' });
  assert.deepEqual(planIndexedTile(undefined, [3, 2, 2]), { kind: 'none' }, 'a layer no longer on the map');
});

/** @type {{ layers: any[] }} */
const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'render/metadata/maps-test.json'), 'utf8'));
const PLACES = /** @type {Array<[string, [number, number]]>} */ ([
  ['Dublin', [-6.2603, 53.3498]], ['Cork', [-8.4756, 51.8985]], ['Galway', [-9.0568, 53.2707]],
  ['Carrauntoohil', [-9.7426, 52.0004]], ['Maghera', [-6.6727, 54.8446]], ['Slieve Donard', [-5.9209, 54.1803]]
]);

test('tile indexes: the island terrain layers carry both; they decode and match the pyramids found on 19 Nov 2026', () => {
  for (const { field } of TILE_INDEX_FIELDS) assert.ok(COMPACT_LAYER_FIELDS.includes(field), `the map app startup index carries ${field}`);
  for (const { field } of TILE_INDEX_FIELDS) {
    assert.deepEqual(index.layers.filter((layer) => layer[field]).map((layer) => layer.id).sort(), ['ireland-terrain-3d', 'ireland-terrain-3d-grey'], field);
  }
  for (const layer of index.layers.filter((l) => l.demTileIndex)) {
    const hs = layer.hillshadeTileIndex;
    const dem = layer.demTileIndex;
    assert.deepEqual(tileIndexErrors(hs), [], layer.id);
    assert.deepEqual(tileIndexErrors(dem), [], layer.id);
    assert.deepEqual([hs.minzoom, hs.maxzoom], [layer.hillshadeMinzoom, layer.hillshadeMaxzoom], layer.id);
    assert.deepEqual([dem.minzoom, dem.maxzoom], [layer.minzoom, layer.maxzoom], layer.id);
    const hsTiles = decodeTileIndex(hs);
    const demTiles = decodeTileIndex(dem);
    assert.deepEqual(tileIndexCounts(hsTiles), { 5: 2, 6: 6, 7: 10, 8: 27, 9: 75, 10: 242, 11: 839, 12: 200, 13: 497, 14: 1355, 15: 4158, 16: 14055 }, layer.id);
    // The R2 listing less the three top-row tiles without a parent (one at 14, two at 15).
    assert.deepEqual(tileIndexCounts(demTiles), { 5: 2, 6: 6, 7: 12, 8: 35, 9: 117, 10: 450, 11: 1715, 12: 5742, 13: 22686, 14: 90120, 15: 358613, 16: 133920 }, layer.id);
    assert.ok(dem.children.length < 8000 && hs.children.length < 8000, `${layer.id}: small enough for the startup index`);
    // Every zoom-16 tile of either lies in Northern Ireland, 54.0-55.3 N, 8.2-5.4 W.
    for (const lookup of [hsTiles, demTiles]) {
      for (const [k, depth] of lookup) {
        const [z, x, y] = k.split('/').map(Number);
        if (Number(z) + depth < 16) continue;
        const scale = 2 ** (16 - Number(z));
        const lng = ((Number(x) * scale) / 2 ** 16) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * Number(y) * scale) / 2 ** 16))) * 180) / Math.PI;
        assert.ok(lng > -8.2 && lng < -5.4 && lat > 54.0 && lat < 55.3, `${k} in NI`);
      }
    }
    // [drape, DEM]: the drape is deep only along the basins' river corridors, so not on Slieve Donard.
    const want = /** @type {Record<string, [number, number]>} */ ({
      Dublin: [11, 15], Cork: [11, 15], Galway: [11, 15], Carrauntoohil: [11, 15], Maghera: [16, 16], 'Slieve Donard': [12, 16]
    });
    for (const [name, lngLat] of PLACES) {
      const at = tileAt(17, lngLat);
      assert.equal(nearestIndexedTile(hsTiles, hs, at)?.[0], want[name]?.[0], `${layer.id}: ${name} drape drawn from zoom ${want[name]?.[0]}`);
      assert.equal(nearestIndexedTile(demTiles, dem, at)?.[0], want[name]?.[1], `${layer.id}: ${name} DEM drawn from zoom ${want[name]?.[1]}`);
      for (let z = 5; z <= 15; z++) assert.equal(nearestIndexedTile(demTiles, dem, tileAt(z, lngLat))?.[0], z, `${name} DEM held at ${z}`);
    }
  }
});

test('tile indexes: an indexed layer asks the protocol; every other terrain layer is unchanged', () => {
  const terrain = index.layers.filter((layer) => layer.sourceType === 'raster-dem');
  assert.equal(terrain.length, 94);
  for (const layer of terrain) {
    const dem = /** @type {import('maplibre-gl').RasterDEMSourceSpecification} */ (terrainRenderer.source?.(layer, { openPmtilesArchive: () => {} }));
    const source = /** @type {import('maplibre-gl').RasterSourceSpecification} */ (hillshadeSource(layer));
    const pyramids = new Map(tilePyramidsOf(layer));
    if (layer.demTileIndex) {
      assert.deepEqual(dem.tiles, [indexedTilesTemplate(layer.id, 'dem')], layer.id);
      const pyramid = pyramids.get('dem');
      assert.ok(pyramid && pyramid.template === layer.tiles && pyramid.tileSize === 256 && pyramid.elevation, layer.id);
    } else {
      assert.deepEqual(dem.tiles, [layer.tiles || layer.tileUrl], `${layer.id}: DEM fetched straight from its template, as before`);
      assert.ok(!pyramids.has('dem'), layer.id);
    }
    if (layer.hillshadeTileIndex) {
      assert.deepEqual(source.tiles, [indexedTilesTemplate(layer.id, 'hs')], layer.id);
      const pyramid = pyramids.get('hs');
      assert.ok(pyramid && pyramid.template === layer.hillshadeTiles && pyramid.tileSize === 256 && !pyramid.elevation, layer.id);
    } else if (source) {
      assert.deepEqual(source.tiles, [layer.hillshadeTiles], `${layer.id}: drape fetched straight from its template, as before`);
      assert.ok(!pyramids.has('hs'), layer.id);
    }
    assert.equal(dem.encoding, 'terrarium', `${layer.id}: Terrarium, which dem-overzoom.mjs resamples`);
    assert.equal(dem.maxzoom, layer.maxzoom, layer.id);
    if (source) {
      assert.equal(source.minzoom, layer.hillshadeMinzoom, layer.id);
      assert.equal(source.maxzoom, layer.hillshadeMaxzoom, layer.id);
    }
  }
});

test('tile indexes: the layer registry refuses a malformed one', () => {
  const registry = loadRegistry('layers');
  const layer = structuredClone(index.layers.find((l) => l.demTileIndex));
  assert.deepEqual(layerRecordErrors(registry, layer), []);
  for (const field of ['hillshadeTileIndex', 'demTileIndex']) {
    const broken = structuredClone(layer);
    broken[field] = { minzoom: 5, maxzoom: 16, roots: 'x', children: 'f' };
    assert.match(layerRecordErrors(registry, broken).join(), new RegExp(`${field} is`));
    const short = structuredClone(layer);
    short[field] = { ...short[field], children: short[field].children.slice(0, -1) };
    assert.match(layerRecordErrors(registry, short).join(), /ends early/, `${field}: its tree is decoded`);
  }
  const noDrape = structuredClone(layer);
  delete noDrape.hillshadeTiles;
  assert.ok(layerRecordErrors(registry, noDrape).some((e) => /hillshadeTileIndex is .*no hillshadeTiles/.test(e)));
});
