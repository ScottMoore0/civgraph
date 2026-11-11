/**
 * Maps for the Elections app: MapLibre GL and PMTiles at the versions the map package pins
 * (packages/map: maplibre-gl 5.24.0, pmtiles 4.5.0), loaded from jsDelivr only when a map view
 * opens, and the map package's own layers: each layer's record from /_api/layers/<id> (its
 * PMTiles archive on data.civgraph.net, source layer, label property and bounds).
 */
export const MAPLIBRE_VERSION = '5.24.0';
export const PMTILES_VERSION = '4.5.0';
const CDN = 'https://cdn.jsdelivr.net/npm';

/** @type {Promise<{ maplibregl: any, pmtiles: any }> | null} */
let loading = null;

/** @param {string} src */
function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(undefined);
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

/** Load MapLibre and PMTiles once; registers the pmtiles:// protocol. */
export function loadMapLibre() {
  if (!loading) {
    loading = (async () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${CDN}/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
      document.head.append(css);
      await Promise.all([script(`${CDN}/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`), script(`${CDN}/pmtiles@${PMTILES_VERSION}/dist/pmtiles.js`)]);
      const w = /** @type {any} */ (window);
      const protocol = new w.pmtiles.Protocol();
      w.maplibregl.addProtocol('pmtiles', protocol.tile);
      return { maplibregl: w.maplibregl, pmtiles: w.pmtiles };
    })().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/** @type {Map<string, Promise<any>>} */
const layers = new Map();

/**
 * A map layer's record (tile archive, source layer, label property, bounds).
 * @param {string} layerId
 * @returns {Promise<{ id: string, tileUrl?: string, cdnUrl?: string, sourceLayer: string, promoteId?: string, labelProperty?: string, bounds?: [[number, number], [number, number]] }>}
 */
export function layerRecord(layerId) {
  if (!layers.has(layerId)) {
    layers.set(layerId, fetch(`/_api/layers/${encodeURIComponent(layerId)}`).then((r) => {
      if (!r.ok) throw new Error(`layer ${layerId}: ${r.status}`);
      return r.json();
    }).then((j) => j.layer || j.item || j));
  }
  return /** @type {Promise<any>} */ (layers.get(layerId));
}

/** The PMTiles URL of a layer record (the CDN copy). */
export function tileUrlOf(/** @type {any} */ rec) {
  const url = rec.cdnUrl || (/^https?:/.test(rec.tileUrl || '') ? rec.tileUrl : null);
  if (!url || !/\.pmtiles$/.test(url)) throw new Error(`layer ${rec.id} has no PMTiles archive`);
  return url;
}

/** MapLibre bounds from a layer record's [[lat, lng], [lat, lng]]. */
export function boundsOf(/** @type {any} */ rec) {
  const b = rec.bounds;
  if (!Array.isArray(b) || b.length !== 2) return [[-10.7, 51.3], [-5.3, 55.5]];
  return [[b[0][1], b[0][0]], [b[1][1], b[1][0]]];
}

/** The text colour of the theme (for outlines and labels). */
const ink = () => getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#222';

/**
 * A map of one layer with its areas filled by a colour per feature label.
 * @param {HTMLElement} container
 * @param {any} rec the layer record
 * @param {{ colours: Map<string, string>, labels?: Map<string, string>, interactive?: boolean, preserve?: boolean }} opts
 *   colours: feature label (upper case) -> colour; labels: feature label -> hover text
 */
export async function areaMap(container, rec, opts) {
  const { maplibregl } = await loadMapLibre();
  const prop = rec.labelProperty || rec.label_property || 'name';
  const fill = ['match', ['upcase', ['to-string', ['get', prop]]]];
  for (const [k, v] of opts.colours) fill.push(k, v);
  fill.push('rgba(0,0,0,0)');
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { areas: { type: 'vector', url: `pmtiles://${tileUrlOf(rec)}`, ...(rec.promoteId ? { promoteId: rec.promoteId } : {}) } },
      layers: [
        { id: 'fill', type: 'fill', source: 'areas', 'source-layer': rec.sourceLayer, paint: { 'fill-color': opts.colours.size ? fill : 'rgba(0,0,0,0)', 'fill-opacity': 0.85 } },
        { id: 'line', type: 'line', source: 'areas', 'source-layer': rec.sourceLayer, paint: { 'line-color': ink(), 'line-width': 0.6, 'line-opacity': 0.6 } },
      ],
    },
    bounds: boundsOf(rec),
    fitBoundsOptions: { padding: 12 },
    interactive: opts.interactive !== false,
    attributionControl: { compact: true, customAttribution: 'Boundaries: Civgraph map layers (sources on each layer)' },
    canvasContextAttributes: { preserveDrawingBuffer: !!opts.preserve },
    preserveDrawingBuffer: !!opts.preserve,
  });
  if (opts.labels && opts.interactive !== false) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mousemove', 'fill', (/** @type {any} */ e) => {
      const f = e.features?.[0];
      if (!f) return;
      const key = String(f.properties?.[prop] ?? '').toUpperCase();
      const text = opts.labels?.get(key) || String(f.properties?.[prop] ?? '');
      popup.setLngLat(e.lngLat).setText(text).addTo(map);
    });
    map.on('mouseleave', 'fill', () => popup.remove());
  }
  return map;
}

/** Resolve when a map has drawn everything it is going to (or after `ms`). */
export function idle(/** @type {any} */ map, ms = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    map.once('idle', () => { clearTimeout(t); resolve(true); });
  });
}
