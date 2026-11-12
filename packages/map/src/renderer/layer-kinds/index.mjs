/**
 * The layer-type code registry (REG-5): each layer type (a layer record's sourceType, from
 * data/registries/layer-types.json) and the renderer module that draws it. The data registry says
 * what a type is (its fields, tile format and behaviour flags) and names its module (`drawnBy`);
 * this registry is that module's code. The map controller resolves every layer through
 * layerRenderer(), and the map-tile checks take the drawable types from the data registry's
 * `drawnBy`; tests/unit/map-layer-kinds.test.mjs holds the two together.
 *
 * A new layer type is a module here that exports its renderer, one line in RENDERERS, and its
 * entry in the data registry.
 */
import { pmtilesRenderer, mvtRenderer } from './vector-tiles.mjs';
import { rasterRenderer, imageRenderer } from './raster.mjs';
import { terrainRenderer } from './terrain.mjs';
import { pointCloudRenderer } from './point-cloud.mjs';

/** @typedef {import('./types.mjs').LayerRenderer} LayerRenderer */

/** Every renderer, with the module (under packages/map/src/renderer/layer-kinds/) it lives in. */
export const RENDERERS = Object.freeze(/** @type {Array<[LayerRenderer, string]>} */ ([
  [pmtilesRenderer, 'vector-tiles.mjs'],
  [mvtRenderer, 'vector-tiles.mjs'],
  [rasterRenderer, 'raster.mjs'],
  [imageRenderer, 'raster.mjs'],
  [terrainRenderer, 'terrain.mjs'],
  [pointCloudRenderer, 'point-cloud.mjs']
]));

/** @type {Map<string, LayerRenderer>} */
const BY_KIND = new Map();
for (const [renderer] of RENDERERS) {
  if (BY_KIND.has(renderer.kind)) throw new Error(`layer-kinds: ${renderer.kind} is registered twice`);
  BY_KIND.set(renderer.kind, renderer);
}

/**
 * The renderer of a layer type, or null when no module draws it (an unconverted entry, or an
 * unknown sourceType).
 * @param {unknown} kind  a layer record's sourceType
 * @returns {LayerRenderer | null}
 */
export function layerRenderer(kind) {
  return BY_KIND.get(String(kind)) || null;
}

/** The layer types a renderer draws, sorted. */
export function renderedLayerKinds() {
  return [...BY_KIND.keys()].sort();
}
