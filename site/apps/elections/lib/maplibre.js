/**
 * Maps for the Elections app: MapLibre GL and PMTiles at the versions the map package pins
 * (packages/map: maplibre-gl 5.24.0, pmtiles 4.5.0), self-hosted from /src/libs/ (../config.js,
 * 11 Nov 2026; jsDelivr before) and loaded only when a map view opens, and the map package's own
 * layers: each layer's record from /_api/layers/<id> (its PMTiles archive on data.civgraph.net,
 * source layer, label property and bounds).
 */
import { MAPLIBRE_VERSION, PMTILES_VERSION, VENDOR } from '../config.js';
import { electionsAppColours } from '../../../pkg/registries/src/browser/colour-palettes.mjs';
import { MAP_LIBRARIES } from '../state-machines.js';

export { MAPLIBRE_VERSION, PMTILES_VERSION };

/**
 * The two libraries as their scripts define them on `window` (UMD globals), typed from the
 * packages the map package pins.
 * @typedef {typeof import('maplibre-gl')} MapLibreGlobal
 * @typedef {typeof import('pmtiles')} PmtilesGlobal
 */

/** The libraries' load (state-machines.js MAP_LIBRARIES): not-loaded, loading, loaded or failed (then tried again). */
const libraries = MAP_LIBRARIES.start();
/** @type {Promise<{ maplibregl: MapLibreGlobal, pmtiles: PmtilesGlobal }> | null} */
let loading = null;

/** @param {string} src */
function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(undefined);
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

/** Load MapLibre and PMTiles once; registers the pmtiles:// protocol. */
export function loadMapLibre() {
  if (!loading) {
    libraries.to('loading');
    loading = (async () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${VENDOR.maplibre}maplibre-gl.css`;
      document.head.append(css);
      await Promise.all([script(`${VENDOR.maplibre}maplibre-gl.js`), script(`${VENDOR.pmtiles}pmtiles.js`)]);
      const w = /** @type {Window & { maplibregl: MapLibreGlobal, pmtiles: PmtilesGlobal }} */ (/** @type {unknown} */ (window));
      const protocol = new w.pmtiles.Protocol();
      w.maplibregl.addProtocol('pmtiles', protocol.tile);
      libraries.to('loaded');
      return { maplibregl: w.maplibregl, pmtiles: w.pmtiles };
    })().catch((err) => { libraries.to('failed'); loading = null; throw err; });
  }
  return loading;
}

/**
 * A map layer's record (/_api/layers/<id>): its tile archive, source layer, label property and bounds.
 * @typedef {{ id: string, tileUrl?: string, cdnUrl?: string, sourceLayer: string, promoteId?: string, labelProperty?: string, label_property?: string,
 *   bounds?: [[number, number], [number, number]] }} LayerRecord
 */

/** @type {Map<string, Promise<LayerRecord>>} */
const layers = new Map();

/**
 * A map layer's record (tile archive, source layer, label property, bounds).
 * @param {string} layerId
 * @returns {Promise<LayerRecord>}
 */
export function layerRecord(layerId) {
  if (!layers.has(layerId)) {
    layers.set(layerId, fetch(`/_api/layers/${encodeURIComponent(layerId)}`).then((r) => {
      if (!r.ok) throw new Error(`layer ${layerId}: ${r.status}`);
      return r.json();
    }).then((j) => j.layer || j.item || j));
  }
  return /** @type {Promise<LayerRecord>} */ (layers.get(layerId));
}

/** The PMTiles URL of a layer record (the CDN copy). */
export function tileUrlOf(/** @type {LayerRecord} */ rec) {
  const url = rec.cdnUrl || (/^https?:/.test(rec.tileUrl || '') ? rec.tileUrl : null);
  if (!url || !/\.pmtiles$/.test(url)) throw new Error(`layer ${rec.id} has no PMTiles archive`);
  return url;
}

/**
 * MapLibre bounds from a layer record's [[lat, lng], [lat, lng]].
 * @param {LayerRecord} rec
 * @returns {[[number, number], [number, number]]} [[west, south], [east, north]]
 */
export function boundsOf(rec) {
  const b = rec.bounds;
  if (!Array.isArray(b) || b.length !== 2) return [[-10.7, 51.3], [-5.3, 55.5]];
  return [[b[0][1], b[0][0]], [b[1][1], b[1][0]]];
}

/** The text colour of the theme (for outlines and labels). */
const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || electionsAppColours.mapInk;

/**
 * A map of one layer with its areas filled by a colour per feature label.
 *
 * Its lifetime is the caller's: with `signal` (a view's ctx.signal) the map is remove()d when the
 * signal aborts, which frees its WebGL context and observers; a signal already aborted when
 * MapLibre has loaded makes no map at all (null). Without a signal the caller removes it.
 * @param {HTMLElement} container
 * @param {LayerRecord} rec the layer record
 * @param {{ colours: Map<string, string>, labels?: Map<string, string>, interactive?: boolean, preserve?: boolean, signal?: AbortSignal }} opts
 *   colours: feature label (upper case) -> colour; labels: feature label -> hover text
 * @returns {Promise<import('maplibre-gl').Map | null>} the map, or null when the signal aborted first
 */
export async function areaMap(container, rec, opts) {
  const { maplibregl } = await loadMapLibre();
  if (opts.signal?.aborted) return null;
  const prop = rec.labelProperty || rec.label_property || 'name';
  const fill = ['match', ['upcase', ['to-string', ['get', prop]]]];
  for (const [k, v] of opts.colours) fill.push(k, v);
  fill.push(electionsAppColours.noFill);
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { areas: { type: 'vector', url: `pmtiles://${tileUrlOf(rec)}`, ...(rec.promoteId ? { promoteId: rec.promoteId } : {}) } },
      layers: [
        { id: 'fill', type: 'fill', source: 'areas', 'source-layer': rec.sourceLayer, paint: { 'fill-color': opts.colours.size ? /** @type {import('maplibre-gl').ExpressionSpecification} */ (/** @type {unknown} */ (fill)) : electionsAppColours.noFill, 'fill-opacity': 0.85 } },
        { id: 'line', type: 'line', source: 'areas', 'source-layer': rec.sourceLayer, paint: { 'line-color': ink(), 'line-width': 0.6, 'line-opacity': 0.6 } },
      ],
    },
    bounds: boundsOf(rec),
    fitBoundsOptions: { padding: 12 },
    interactive: opts.interactive !== false,
    attributionControl: { compact: true, customAttribution: 'Boundaries: Civgraph map layers (sources on each layer)' },
    canvasContextAttributes: { preserveDrawingBuffer: !!opts.preserve },
  });
  if (opts.labels && opts.interactive !== false) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mousemove', 'fill', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const key = String(f.properties?.[prop] ?? '').toUpperCase();
      const text = opts.labels?.get(key) || String(f.properties?.[prop] ?? '');
      popup.setLngLat(e.lngLat).setText(text).addTo(map);
    });
    map.on('mouseleave', 'fill', () => popup.remove());
  }
  opts.signal?.addEventListener('abort', () => map.remove(), { once: true });
  return map;
}

/**
 * Resolve when a map has drawn everything it is going to (true), or false after `ms`, when the
 * signal aborts or when there is no map.
 * @param {import('maplibre-gl').Map | null | undefined} map
 * @param {number} [ms]
 * @param {AbortSignal} [signal]
 * @returns {Promise<boolean>}
 */
export function idle(map, ms = 15000, signal) {
  if (!map || signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (/** @type {boolean} */ value) => { clearTimeout(t); signal?.removeEventListener('abort', aborted); resolve(value); };
    const aborted = () => done(false);
    const t = setTimeout(() => done(false), ms);
    signal?.addEventListener('abort', aborted, { once: true });
    map.once('idle', () => done(true));
  });
}
