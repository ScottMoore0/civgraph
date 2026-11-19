/**
 * The renderer for 3D terrain (raster-dem): terrain-RGB tiles the controller makes the map's
 * terrain, with a baked hillshade draped over it (map-controller.js addTerrainLayer).
 */
import { absoluteTileTemplate, tileSourceRange } from '../utils.js';
import { hillshadePyramid, hillshadeProtocolTemplate } from '../hillshade-tiles.mjs';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */
/** @typedef {import('./types.mjs').RenderLayer} RenderLayer */

/** @type {LayerRenderer} */
export const terrainRenderer = Object.freeze({
  kind: 'raster-dem',
  source(layer) {
    if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster-dem tiles URL template');
    return {
      type: 'raster-dem',
      tiles: [absoluteTileTemplate(/** @type {string} */ (layer.tiles || layer.tileUrl))],
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
 * through the hillshade protocol (hillshade-tiles.mjs), which asks only for the tiles the index
 * holds and over-zooms the rest from their nearest ancestor.
 * @param {RenderLayer} layer
 * @returns {import('maplibre-gl').RasterSourceSpecification | null}
 */
export function hillshadeSource(layer) {
  if (!layer.hillshadeTiles) return null;
  return {
    type: 'raster',
    tiles: [layer.hillshadeTileIndex ? hillshadeProtocolTemplate(layer.id) : absoluteTileTemplate(layer.hillshadeTiles)],
    tileSize: layer.tileSize || 256,
    ...tileSourceRange(layer.hillshadeMinzoom ?? layer.minzoom, layer.hillshadeMaxzoom ?? layer.maxzoom, layer.bounds)
  };
}

/**
 * The pyramid the hillshade protocol draws a layer's drape from, or null when the layer has no
 * hillshadeTileIndex (its drape is fetched straight from hillshadeTiles).
 * @param {RenderLayer} layer
 * @returns {import('../hillshade-tiles.mjs').HillshadePyramid | null}
 */
export function hillshadePyramidOf(layer) {
  if (!layer.hillshadeTiles || !layer.hillshadeTileIndex) return null;
  return hillshadePyramid(absoluteTileTemplate(layer.hillshadeTiles), layer.hillshadeTileIndex, layer.tileSize || 256);
}
