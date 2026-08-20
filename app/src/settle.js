/**
 * "Has this map finished drawing?" — and, when it has not, why we stopped asking.
 *
 * Extracted from Test2MapLibreMainAdapter.waitUntilSettled so it can be tested without
 * a browser. The adapter imports maplibre-gl, which cannot load under node, and the
 * behaviour that matters here is pure event bookkeeping over a small map interface.
 * A copy in the test would be a copy that can drift; this is the same code both run.
 *
 * WHY THE OUTCOME IS RETURNED (T0-05)
 *
 * This used to resolve undefined on both paths. With nothing to distinguish them, the
 * catalogue fell back to isLayerLoaded() -- style membership, which is true the instant
 * the layer is added and stays true whether or not one tile ever arrives. So a stalled
 * load announced "loaded" to a user looking at an empty map. A false success is worse
 * than no message, because it stops the user retrying.
 */

/** The map is drawn and quiet. */
export const SETTLE_SETTLED = 'settled';
/** The deadline passed first. The layer may be blank; do not claim it loaded. */
export const SETTLE_TIMEOUT = 'timeout';
/** There was no map to watch. Deliberately not success: "could not tell" is its own state. */
export const SETTLE_UNAVAILABLE = 'unavailable';

/**
 * Resolve once the map is idle with its tiles loaded, or at `timeoutMs`, whichever first.
 *
 * A single 'idle' is not enough: MapLibre reports idle whenever it is not moving and has
 * no outstanding tiles, so the tick right after addLayer -- before any tile request has
 * been issued -- qualifies. Hence idle AND areTilesLoaded(), waiting through further
 * idles until both hold.
 */
export function waitForMapSettle(map, { timeoutMs = 20000 } = {}) {
  if (!map || typeof map.on !== 'function' || typeof map.off !== 'function') {
    return Promise.resolve(SETTLE_UNAVAILABLE);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('idle', onIdle);
      resolve(outcome);
    };
    const onIdle = () => {
      // areTilesLoaded is absent on some stubs; treat that as "cannot tell, accept".
      if (typeof map.areTilesLoaded !== 'function' || map.areTilesLoaded()) finish(SETTLE_SETTLED);
    };
    const timer = setTimeout(() => finish(SETTLE_TIMEOUT), timeoutMs);
    map.on('idle', onIdle);
  });
}
