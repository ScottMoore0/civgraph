/**
 * Renderers for the flat raster layer types: raster tiles at z/x/y, and one georeferenced image.
 * Both are drawn as a single raster style layer, with no features to pick.
 */
import { absoluteTileTemplate, boundsToFlatBbox, boundsToImageCoordinates } from '../utils.js';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */
/** @typedef {import('./types.mjs').LayerHost} LayerHost */
/** @typedef {import('./types.mjs').RenderLayer} RenderLayer */
/** @typedef {import('./types.mjs').LayerIds} LayerIds */

/**
 * @param {LayerHost} host
 * @param {RenderLayer} layer
 * @param {LayerIds} ids
 */
function drawRaster(host, layer, ids) {
  host.addRasterLayer(layer, ids);
  return { layerIds: [], sourceIds: [] };
}

/** @type {LayerRenderer} */
export const rasterRenderer = Object.freeze({
  kind: 'raster',
  source(layer) {
    if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster tiles URL template');
    return {
      type: 'raster',
      tiles: [absoluteTileTemplate(/** @type {string} */ (layer.tiles || layer.tileUrl))],
      tileSize: layer.tileSize || 256,
      minzoom: layer.minzoom,
      maxzoom: layer.maxzoom,
      bounds: boundsToFlatBbox(layer.bounds)
    };
  },
  draw: drawRaster
});

/** @type {LayerRenderer} */
export const imageRenderer = Object.freeze({
  kind: 'image',
  source(layer) {
    const coordinates = boundsToImageCoordinates(layer.bounds);
    if (!coordinates) throw new Error('missing image bounds');
    if (!layer.imageUrl && !layer.url) throw new Error('missing image URL');
    return {
      type: 'image',
      url: layer.imageUrl || layer.url,
      coordinates
    };
  },
  draw: drawRaster
});
