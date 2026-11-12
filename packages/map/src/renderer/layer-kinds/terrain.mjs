/**
 * The renderer for 3D terrain (raster-dem): terrain-RGB tiles the controller makes the map's
 * terrain, with a baked hillshade draped over it (map-controller.js addTerrainLayer).
 */
import { absoluteTileTemplate, boundsToFlatBbox } from '../utils.js';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */

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
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      bounds: boundsToFlatBbox(layer.bounds)
    };
  },
  draw: (host, layer, ids) => host.addTerrainLayer(layer, ids)
});
