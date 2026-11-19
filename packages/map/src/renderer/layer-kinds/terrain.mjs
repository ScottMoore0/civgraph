/**
 * The renderer for 3D terrain (raster-dem): terrain-RGB tiles the controller makes the map's
 * terrain, with a baked hillshade draped over it (map-controller.js addTerrainLayer).
 */
import { absoluteTileTemplate, tileSourceRange } from '../utils.js';
import { indexedTilesTemplate, tilePyramid } from '../indexed-tiles.mjs';
import { TILE_INDEX_FIELDS } from '../../../../core/src/tile-index.mjs';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */
/** @typedef {import('./types.mjs').RenderLayer} RenderLayer */
/** @typedef {import('../indexed-tiles.mjs').TilePart} TilePart */
/** @typedef {import('../indexed-tiles.mjs').TilePyramid} TilePyramid */

/**
 * The tile URL template a pyramid of a terrain layer is asked for: through the indexed-tiles
 * protocol when the layer carries that pyramid's tile index (it is not complete to its deepest
 * zoom everywhere), else the layer's own template, absolute.
 * @param {RenderLayer} layer
 * @param {TilePart} part
 * @param {string} template
 */
function pyramidTemplate(layer, part, template) {
  const field = TILE_INDEX_FIELDS.find((f) => f.part === part);
  return field && layer[field.field] ? indexedTilesTemplate(layer.id, part) : absoluteTileTemplate(template);
}

/** @type {LayerRenderer} */
export const terrainRenderer = Object.freeze({
  kind: 'raster-dem',
  source(layer) {
    if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster-dem tiles URL template');
    return {
      type: 'raster-dem',
      tiles: [pyramidTemplate(layer, 'dem', /** @type {string} */ (layer.tiles || layer.tileUrl))],
      tileSize: layer.tileSize || 256,
      encoding: layer.demEncoding || 'terrarium',
      ...tileSourceRange(layer.minzoom, layer.maxzoom, layer.bounds)
    };
  },
  draw: (host, layer, ids) => host.addTerrainLayer(layer, ids)
});

/**
 * The raster source of a terrain layer's hillshade drape, or null when it has none. Its zooms are
 * the hillshade's own, else the layer's; a zoom or bounds the layer does not give is left out.
 * A layer with a hillshadeTileIndex (a pyramid complete only to a lower zoom in places) is drawn
 * through the indexed-tiles protocol (indexed-tiles.mjs), which asks only for the tiles the index
 * holds and over-zooms the rest from their nearest ancestor.
 * @param {RenderLayer} layer
 * @returns {import('maplibre-gl').RasterSourceSpecification | null}
 */
export function hillshadeSource(layer) {
  if (!layer.hillshadeTiles) return null;
  return {
    type: 'raster',
    tiles: [pyramidTemplate(layer, 'hs', layer.hillshadeTiles)],
    tileSize: layer.tileSize || 256,
    ...tileSourceRange(layer.hillshadeMinzoom ?? layer.minzoom, layer.hillshadeMaxzoom ?? layer.maxzoom, layer.bounds)
  };
}

/**
 * The pyramids the indexed-tiles protocol draws a terrain layer's tiles from: one for each tile
 * index it carries (the DEM's demTileIndex, the drape's hillshadeTileIndex) whose template it has.
 * A pyramid without an index is fetched straight from its template and is not listed.
 * @param {RenderLayer} layer
 * @returns {Array<[TilePart, TilePyramid]>}
 */
export function tilePyramidsOf(layer) {
  /** @type {Array<[TilePart, TilePyramid]>} */
  const out = [];
  for (const { field, template, part, elevation } of TILE_INDEX_FIELDS) {
    const index = layer[field];
    const tiles = layer[template];
    if (index && tiles) out.push([part, tilePyramid(absoluteTileTemplate(tiles), index, layer.tileSize || 256, elevation)]);
  }
  return out;
}
