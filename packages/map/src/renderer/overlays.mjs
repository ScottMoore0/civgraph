/**
 * The raster overlays a map can draw over its layers (Test2MapLibreMainAdapter.showOverlay),
 * each { tiles, attribution, maxzoom } and credited to its own provider.
 *
 * None is offered now. The three the map carried were removed on 11 Nov 2026 (owner, batch 4):
 *   - 'voyager-labels', CARTO's "Voyager Labels": CARTO needs an API key in every tile URL
 *     since 2026, and serves keyless requests with "API KEY REQUIRED" printed across the tile.
 *   - 'merit-catchments' and 'merit-rivers', MERIT-Basins unit catchments and river reaches:
 *     Esri-hosted copies on tiles.arcgis.com whose services are gone (404, "Requested Service
 *     not available"), of data published under CC BY-NC-SA 4.0 (reachhydro.org).
 * Their Map Settings checkboxes went with them. They were never part of the address or of
 * anything saved, so an old link cannot name them; asking for one (overlayConfig) gives null
 * and showOverlay draws nothing, as for any id not listed here.
 */

/** @typedef {{ tiles: string[], attribution: string, maxzoom?: number }} RasterOverlay */

/** @type {Readonly<Record<string, RasterOverlay>>} */
export const RASTER_OVERLAYS = Object.freeze({});

/** The overlay ids removed on 11 Nov 2026, kept so tests can hold them out. */
export const REMOVED_OVERLAY_IDS = Object.freeze(['voyager-labels', 'merit-catchments', 'merit-rivers']);

/**
 * The overlay an id names, or null when it names none (a removed overlay included).
 * @param {unknown} id
 * @returns {RasterOverlay | null}
 */
export function overlayConfig(id) {
  const key = String(id ?? '');
  return Object.prototype.hasOwnProperty.call(RASTER_OVERLAYS, key) ? RASTER_OVERLAYS[key] : null;
}
