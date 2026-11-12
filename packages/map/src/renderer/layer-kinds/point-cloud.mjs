/**
 * The renderer for 3D Tiles point clouds: a MapLibre custom layer that owns its own WebGL draw
 * (map-controller.js addPointCloudLayer, which lazy-loads the point-cloud modules on first use).
 * It has no MapLibre source or style layers, so no `source` or `draw`.
 */

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */

/** @type {LayerRenderer} */
export const pointCloudRenderer = Object.freeze({
  kind: 'point-cloud',
  customLayer: true
});
