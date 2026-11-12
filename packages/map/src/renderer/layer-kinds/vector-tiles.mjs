/**
 * Renderers for the vector-tile layer types: a PMTiles archive, and the z/x/y.pbf tiles the app
 * falls back to. Both are drawn as fills and lines with hover, selection and labels.
 */
import { absoluteTileTemplate, boundsToFlatBbox } from '../utils.js';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */
/** @typedef {import('./types.mjs').LayerHost} LayerHost */
/** @typedef {import('./types.mjs').RenderLayer} RenderLayer */
/** @typedef {import('./types.mjs').LayerIds} LayerIds */

/**
 * Fills and lines, the invisible interaction layers, and the dotted approximate stretches.
 * @param {LayerHost} host
 * @param {RenderLayer} layer
 * @param {LayerIds} ids
 */
function drawGeometry(host, layer, ids) {
  host.addGeometryLayers(layer, ids);
  const overlays = host.addInteractionOverlayLayers(layer);
  const approximate = host.addApproximateSegmentLayers(layer);
  return {
    layerIds: [...overlays.layerIds, ...approximate.layerIds],
    sourceIds: [...overlays.sourceIds, ...approximate.sourceIds]
  };
}

/** @type {LayerRenderer} */
export const pmtilesRenderer = Object.freeze({
  kind: 'pmtiles',
  source(layer, ctx) {
    if (!layer.tileUrl) throw new Error('missing PMTiles URL');
    ctx.openPmtilesArchive(layer.tileUrl);
    return { type: 'vector', url: `pmtiles://${layer.tileUrl}`, minzoom: layer.minzoom, maxzoom: layer.maxzoom, promoteId: layer.promoteId };
  },
  draw: drawGeometry,
  interactive: true,
  archiveFallback: true
});

/** @type {LayerRenderer} */
export const mvtRenderer = Object.freeze({
  kind: 'mvt',
  source(layer) {
    if (!layer.tiles) throw new Error('missing vector tile URL template');
    return { type: 'vector', tiles: [absoluteTileTemplate(layer.tiles)], minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds), promoteId: layer.promoteId };
  },
  draw: drawGeometry,
  interactive: true
});
