/**
 * The tile index of a hillshade pyramid (packages/core/src/tile-index.mjs) and the hillshade
 * protocol's plan for each tile (packages/map/src/renderer/hillshade-tiles.mjs): w19-hillshade,
 * 19 Nov 2026. ireland-terrain-3d's hillshade covers the island to zoom 11 and the NI LiDAR basins
 * to 16; the map must ask only for tiles that exist and over-zoom the rest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadRegistry } from '@civgraph/registries/index.mjs';
import { layerRecordErrors } from '@civgraph/registries/layers.mjs';
import { decodeTileIndex, encodeTileIndex, nearestIndexedTile, overzoomSquare, tileIndexErrors } from '@civgraph/core/tile-index.mjs';
import { COMPACT_LAYER_FIELDS } from '@civgraph/core/layer-index.js';
import {
  fillTileTemplate, hillshadeProtocolTemplate, hillshadePyramid, parseHillshadeUrl, planHillshadeTile
} from '@civgraph/map/renderer/hillshade-tiles.mjs';
import { hillshadePyramidOf, hillshadeSource } from '@civgraph/map/renderer/layer-kinds/terrain.mjs';

/** @type {any} */ (globalThis).location ??= { origin: 'https://civgraph.example' };

// A small pyramid: one root at zoom 1, complete to 2 under it; at 3 only under tile 2/1/1.
const SMALL = ['1/0/0.png', '2/0/0.png', '2/1/0.png', '2/0/1.png', '2/1/1.png', '3/2/2.png', '3/3/3.png'];

test('tile index: encodes breadth-first, one hex digit of children per tile, and decodes back', () => {
  const index = encodeTileIndex(SMALL, { minzoom: 1, maxzoom: 3 });
  // 1/0/0 has all four children (f); of those only 2/1/1 has children: top-left 3/2/2 (1) and bottom-right 3/3/3 (8).
  assert.deepEqual(index, { minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f0009' });
  assert.deepEqual([...decodeTileIndex(index)].sort(), SMALL.map((k) => k.replace('.png', '')).sort());
  assert.deepEqual(tileIndexErrors(index), []);
  // Tiles outside the range are left out; lines that are not tiles are ignored.
  assert.deepEqual(encodeTileIndex([...SMALL, '0/0/0.png', '4/4/4.png', '', 'README'], { minzoom: 1, maxzoom: 3 }), index);
});

test('tile index: refuses a tile without its parent, and an index whose digits do not fit its tree', () => {
  assert.throws(() => encodeTileIndex(['1/0/0', '3/0/0'], { minzoom: 1, maxzoom: 3 }), /3\/0\/0 has no parent/);
  assert.match(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f000' }).join(), /ends early/);
  assert.match(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'f00090' }).join(), /1 digits too many/);
  assert.ok(tileIndexErrors({ minzoom: 3, maxzoom: 1, roots: [], children: '' }).length);
  assert.ok(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0]], children: 'f' }).length);
  assert.ok(tileIndexErrors({ minzoom: 1, maxzoom: 3, roots: [[0, 0]], children: 'xyz' }).length);
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

test('hillshade protocol: URLs and the plan for each tile', () => {
  assert.equal(hillshadeProtocolTemplate('ireland-terrain-3d'), 'civgraph-hs://ireland-terrain-3d/{z}/{x}/{y}');
  assert.deepEqual(parseHillshadeUrl('civgraph-hs://ireland-terrain-3d/12/1975/1323'), { layerId: 'ireland-terrain-3d', tile: [12, 1975, 1323] });
  assert.deepEqual(parseHillshadeUrl('civgraph-hs://a%20b/1/2/3'), { layerId: 'a b', tile: [1, 2, 3] });
  assert.equal(parseHillshadeUrl('https://x/1/2/3'), null);
  assert.equal(fillTileTemplate('https://d/hs/{z}/{x}/{y}.png?v=1', [3, 4, 5]), 'https://d/hs/3/4/5.png?v=1');
  const pyramid = hillshadePyramid('https://d/hs/{z}/{x}/{y}.png?v=1', encodeTileIndex(SMALL, { minzoom: 1, maxzoom: 3 }), 256);
  assert.deepEqual(planHillshadeTile(pyramid, [3, 2, 2]), { kind: 'fetch', url: 'https://d/hs/3/2/2.png?v=1' });
  assert.deepEqual(planHillshadeTile(pyramid, [3, 1, 0]), { kind: 'overzoom', url: 'https://d/hs/2/0/0.png?v=1', square: { sx: 128, sy: 0, size: 128 } });
  assert.deepEqual(planHillshadeTile(pyramid, [3, 7, 0]), { kind: 'none' });
  assert.deepEqual(planHillshadeTile(undefined, [3, 2, 2]), { kind: 'none' }, 'a layer no longer on the map');
});

/** @type {{ layers: any[] }} */
const index = JSON.parse(readFileSync(path.join(REPO_ROOT, 'render/metadata/maps-test.json'), 'utf8'));
const indexed = index.layers.filter((layer) => layer.hillshadeTileIndex);

test('hillshade index: the island terrain layers carry one; it decodes and matches the pyramid found on 19 Nov 2026', () => {
  assert.deepEqual(indexed.map((layer) => layer.id).sort(), ['ireland-terrain-3d', 'ireland-terrain-3d-grey']);
  assert.ok(COMPACT_LAYER_FIELDS.includes('hillshadeTileIndex'), 'the map app startup index carries it');
  for (const layer of indexed) {
    const tileIndex = layer.hillshadeTileIndex;
    assert.deepEqual(tileIndexErrors(tileIndex), [], layer.id);
    assert.equal(tileIndex.minzoom, layer.hillshadeMinzoom, layer.id);
    assert.equal(tileIndex.maxzoom, layer.hillshadeMaxzoom, layer.id);
    const tiles = decodeTileIndex(tileIndex);
    /** @type {Record<number, number>} */
    const perZoom = {};
    for (const k of tiles) perZoom[Number(k.split('/')[0])] = (perZoom[Number(k.split('/')[0])] || 0) + 1;
    assert.deepEqual(perZoom, { 5: 2, 6: 6, 7: 10, 8: 27, 9: 75, 10: 242, 11: 839, 12: 200, 13: 497, 14: 1355, 15: 4158, 16: 14055 }, layer.id);
    const tilesTo16 = [...tiles].filter((k) => k.startsWith('16/'));
    for (const k of tilesTo16) {
      const [, x, y] = k.split('/').map(Number);
      // Every zoom-16 tile lies in Northern Ireland (the LiDAR basins), 54.0-55.3 N, 7.7-5.5 W.
      const lng = (x / 2 ** 16) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** 16))) * 180) / Math.PI;
      assert.ok(lng > -7.7 && lng < -5.5 && lat > 54.0 && lat < 55.3, `${k} in NI`);
    }
    // Dublin, Cork, Galway: island tiles to 11 only; a basin (Maghera) to 16.
    for (const [name, [lng, lat], want] of /** @type {Array<[string, [number, number], number]>} */ ([
      ['Dublin', [-6.2603, 53.3498], 11], ['Cork', [-8.4756, 51.8985], 11], ['Galway', [-9.0568, 53.2707], 11], ['Maghera', [-6.6727, 54.8446], 16]
    ])) {
      const x = Math.floor(((lng + 180) / 360) * 2 ** 16);
      const r = (lat * Math.PI) / 180;
      const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 16);
      assert.equal(nearestIndexedTile(tiles, tileIndex, [16, x, y])?.[0], want, `${layer.id}: ${name} drawn from zoom ${want}`);
    }
  }
});

test('hillshade index: the drape of an indexed layer goes through the protocol; every other terrain layer is unchanged', () => {
  const terrain = index.layers.filter((layer) => layer.hillshadeTiles);
  assert.equal(terrain.length, 94);
  for (const layer of terrain) {
    const source = /** @type {import('maplibre-gl').RasterSourceSpecification} */ (hillshadeSource(layer));
    if (layer.hillshadeTileIndex) {
      assert.deepEqual(source.tiles, [hillshadeProtocolTemplate(layer.id)], layer.id);
      const pyramid = hillshadePyramidOf(layer);
      assert.ok(pyramid && pyramid.template === layer.hillshadeTiles && pyramid.tileSize === 256, layer.id);
    } else {
      assert.deepEqual(source.tiles, [layer.hillshadeTiles], `${layer.id}: fetched straight from its template, as before`);
      assert.equal(hillshadePyramidOf(layer), null, layer.id);
    }
    assert.equal(source.minzoom, layer.hillshadeMinzoom, layer.id);
    assert.equal(source.maxzoom, layer.hillshadeMaxzoom, layer.id);
  }
});

test('hillshade index: the layer registry refuses a malformed one', () => {
  const registry = loadRegistry('layers');
  const layer = structuredClone(indexed[0]);
  assert.deepEqual(layerRecordErrors(registry, layer), []);
  layer.hillshadeTileIndex = { minzoom: 5, maxzoom: 16, roots: 'x', children: 'f' };
  assert.match(layerRecordErrors(registry, layer).join(), /hillshadeTileIndex is/);
  const noDrape = structuredClone(indexed[0]);
  delete noDrape.hillshadeTiles;
  assert.ok(layerRecordErrors(registry, noDrape).some((e) => /hillshadeTileIndex is/.test(e)));
});
