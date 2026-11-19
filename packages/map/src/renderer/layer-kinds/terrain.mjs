/**
 * The renderer for 3D terrain (raster-dem): terrain-RGB tiles the controller makes the map's
 * terrain, with a baked hillshade draped over it (map-controller.js addTerrainLayer).
 */
import { absoluteTileTemplate, tileSourceRange } from '../utils.js';

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
 * @param {RenderLayer} layer
 * @returns {import('maplibre-gl').RasterSourceSpecification | null}
 */
export function hillshadeSource(layer) {
  if (!layer.hillshadeTiles) return null;
  return {
    type: 'raster',
    tiles: [absoluteTileTemplate(layer.hillshadeTiles)],
    tileSize: layer.tileSize || 256,
    ...tileSourceRange(layer.hillshadeMinzoom ?? layer.minzoom, layer.hillshadeMaxzoom ?? layer.maxzoom, layer.bounds)
  };
}
