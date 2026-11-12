/**
 * The map's base map: which provider draws it, and what happens when that provider fails.
 *
 * Until 11 Nov 2026 every visitor's base map came straight from tile.openstreetmap.org. The
 * OSMF tile policy (https://operations.osmfoundation.org/policies/tiles/) gives no service
 * level, may block "heavy use" without notice, warns that sites seeking donations may lose
 * access "at any point", and forbids hiding the credit "behind toggles" -- which the folded
 * (i) credit did (QA 2026-11-11, H8). A launch spike is exactly when that block would land.
 *
 * The default base map is now a chain, tried in order (DEFAULT_BASEMAP_CHAIN):
 *
 *   1. OpenFreeMap, Liberty style (vector). https://openfreemap.org/ : "no registration, no
 *      user database, no API keys", no limits on map views or requests, commercial use allowed;
 *      the OpenFreeMap, OpenMapTiles and OpenStreetMap credits must be shown.
 *   2. OpenStreetMap's own raster tiles, as the last resort only, with the credit always shown.
 *
 * Providers considered and left out (terms checked 11 Nov 2026, see LANDING notes):
 *   - CARTO basemaps: an API key in every tile URL since 2026 (keyless requests are served with
 *     "API KEY REQUIRED" printed across the tile at HTTP 200, so they cannot even be detected).
 *   - Esri World Imagery / Topo: Esri staff say the raw tile services need an ArcGIS licence.
 *     For the same reason the four Esri base maps were taken out of Map Settings too (owner,
 *     11 Nov 2026); a saved address naming one opens on the default (resolveBaseMapId).
 *   - Stadia Maps: production use needs an account (domain authentication), so the owner's.
 *   - VersaTiles: no published terms for its public server.
 * CARTO's and Stamen's raster base maps, hidden from Map Settings since 26 Aug 2026, were removed
 * from the registry too (owner, 11 Nov 2026), so an address naming one also opens on the default.
 * The other base maps in the Map Settings list (CHOOSABLE_BASE_MAPS) stay as they were: a
 * reader's deliberate choice, without a fallback.
 *
 * Failover is per session: a provider that fails (its style does not load, or its tiles keep
 * failing, or none arrives in time) is skipped for the rest of the tab's session, recorded in
 * sessionStorage, so a reader is not sent back to a dead provider on every page.
 *
 * Everything the base map adds to the style has an id starting `basemap-`, and is inserted
 * below every other layer, so the app's own layers keep their order whatever the base map is.
 */

export const BASEMAP_PREFIX = 'basemap-';
export const BASEMAP_SESSION_KEY = 'civgraph.basemapFailedProviders';

const OSM_COPYRIGHT = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/** @typedef {{ id: string, kind: 'style', label: string, styleUrl: string, attribution: string, glyphFonts: string[], terms: string }} StyleProvider */
/** @typedef {{ id: string, kind: 'raster', label: string, tiles: string[], attribution: string, maxzoom?: number, terms?: string }} RasterProvider */
/** @typedef {StyleProvider | RasterProvider} BasemapProvider */
/** @typedef {import('maplibre-gl').SourceSpecification} SourceSpecification */
/** @typedef {import('maplibre-gl').LayerSpecification} LayerSpecification */

/**
 * A provider's style made ready to sit under the app's layers (namespaceStyle).
 * @typedef {{
 *   sources: Record<string, SourceSpecification>,
 *   layers: LayerSpecification[],
 *   glyphs: string | null,
 *   sprite: import('maplibre-gl').SpriteSpecification | null
 * }} NamespacedStyle
 */

/** A map error or source-data event, the fields read here. @typedef {{ sourceId?: string, tile?: unknown } | null | undefined} MapSourceEventView */
/** Where the failover keeps the providers given up this session (sessionStorage, or a test's stand-in). @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} FailoverStorage */

/** @type {StyleProvider} */
export const OPENFREEMAP_LIBERTY = Object.freeze({
  id: 'openfreemap-liberty',
  kind: 'style',
  label: 'OpenFreeMap',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  // The font stacks the OpenFreeMap glyph server has (its styles use only these).
  glyphFonts: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'],
  terms: 'https://openfreemap.org/'
});

/** @type {RasterProvider} */
export const OSM_STANDARD_TILES = Object.freeze({
  id: 'osm-tiles',
  kind: 'raster',
  label: 'OpenStreetMap',
  tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  attribution: OSM_COPYRIGHT,
  maxzoom: 19,
  terms: 'https://operations.osmfoundation.org/policies/tiles/'
});

/** The default base map, in the order tried. */
export const DEFAULT_BASEMAP_CHAIN = Object.freeze([OPENFREEMAP_LIBERTY, OSM_STANDARD_TILES]);

/**
 * The id of the default base map (the chain above) in Map Settings, addresses (#base=) and
 * settings. Kept from when it named OpenStreetMap's own tiles, because saved addresses name it.
 */
export const DEFAULT_BASE_MAP_ID = 'osm-standard';

const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The raster base maps a reader can choose instead of the default, by id: tiles and credit (each
 * credits its own provider), as the Map Settings list (site/maps/index.html #baseMapSelect) offers
 * them. Removed altogether, so that an address naming one opens on the default (resolveBaseMapId):
 *   - the four Esri base maps (11 Nov 2026): Esri's raw tile services need an ArcGIS licence;
 *   - the four CARTO base maps (cartodb-positron, -dark, -dark-nolabels, -voyager) and Stamen
 *     Terrain (11 Nov 2026). Map Settings stopped offering them on 26 Aug 2026 (CARTO prints
 *     "API KEY REQUIRED" across every keyless tile at HTTP 200; Stamen's host returns 503), but
 *     until now an address naming one still drew it.
 * @type {Readonly<Record<string, { tiles: string[], attribution: string }>>}
 */
export const CHOOSABLE_BASE_MAPS = Object.freeze({
  'osm-humanitarian': {
    tiles: ['https://tile-{a-c}.openstreetmap.fr/hot/{z}/{x}/{y}.png'],
    attribution: `${OSM_CREDIT}, style by Humanitarian OpenStreetMap Team, hosted by OpenStreetMap France`
  },
  'opentopomap': {
    tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: `Map data: ${OSM_CREDIT}, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`
  },
  'usgs-topo': {
    tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles courtesy of the <a href="https://www.usgs.gov/">U.S. Geological Survey</a>'
  }
});

/**
 * The base map to use for an id from Map Settings, an address or a saved setting: the id itself
 * when it is the default or a choosable base map, else the default. So an address saved with a
 * base map since removed (the Esri, CARTO and Stamen ids) opens on the default chain, shows the
 * default in Map Settings and drops the id from the address.
 * @param {unknown} id
 * @returns {string}
 */
export function resolveBaseMapId(id) {
  const value = typeof id === 'string' ? id.trim() : '';
  return value && Object.prototype.hasOwnProperty.call(CHOOSABLE_BASE_MAPS, value) ? value : DEFAULT_BASE_MAP_ID;
}

/** Errors on a provider's tiles, with none loaded, before it is given up. */
export const ERRORS_BEFORE_ANY_TILE = 4;
/** Errors once tiles have loaded: give up when this many fail and they outnumber the loads. */
export const ERRORS_AFTER_TILES = 16;
/** Milliseconds a provider has (while the page is visible) to deliver its style and a first tile. */
export const FIRST_TILE_TIMEOUT_MS = 10000;
/** Milliseconds the style document may take. */
export const STYLE_FETCH_TIMEOUT_MS = 6000;

/** Where a reader (or a test suite) can name the provider to start from. */
export const BASEMAP_PREFERENCE_KEY = 'civgraph.basemap';

/**
 * The chain from the provider named by ?basemap=<id> or localStorage civgraph.basemap, when it
 * is one of the chain's: the providers before it are skipped (for this page, not the session).
 * The browser suite names osm-tiles: drawn by software GL in a headless browser, the vector base
 * map costs seconds a test, and the suite tests the app, not the base map (basemap.spec.cjs does).
 * @param {readonly BasemapProvider[]} chain
 * @param {{ search?: string, storage?: { getItem(key: string): string | null } | null }} [where]
 * @returns {readonly BasemapProvider[]}
 */
export function preferredChain(chain, { search = '', storage = null } = {}) {
  let wanted = null;
  try { wanted = new URLSearchParams(search).get('basemap'); } catch { /* no address */ }
  if (!wanted) {
    try { wanted = storage?.getItem(BASEMAP_PREFERENCE_KEY) || null; } catch { /* blocked */ }
  }
  const index = wanted ? chain.findIndex((provider) => provider.id === wanted) : -1;
  return index > 0 ? chain.slice(index) : chain;
}

/**
 * Is this a base map layer's or source's id?
 * @param {unknown} id
 * @returns {id is string}
 */
export function isBasemapId(id) {
  return typeof id === 'string' && (id.startsWith(BASEMAP_PREFIX) || id === 'osm');
}

/**
 * A provider's style, with every source and layer id prefixed so it can sit under the app's
 * layers in one style. Returns null for a document that is not a style.
 * @param {import('maplibre-gl').StyleSpecification | null | undefined} style a MapLibre style document, as fetched
 * @param {string} prefix
 * @param {string} [attribution] credit set on every vector source (the provider's TileJSON may replace it)
 * @returns {NamespacedStyle | null}
 */
export function namespaceStyle(style, prefix, attribution = '') {
  if (!style || typeof style !== 'object' || !Array.isArray(style.layers) || !style.sources) return null;
  /** @type {Record<string, SourceSpecification>} */
  const sources = {};
  for (const [id, source] of Object.entries(style.sources)) {
    /** @type {SourceSpecification & { attribution?: string }} */
    const copy = { ...source };
    if (attribution && copy.type === 'vector' && !copy.attribution) copy.attribution = attribution;
    sources[prefix + id] = copy;
  }
  const layers = style.layers.map((layer) => {
    /** @type {LayerSpecification & { source?: string }} */
    const copy = { ...layer, id: prefix + layer.id };
    // Every layer but a background one draws from a source.
    if (/** @type {{ source?: string }} */ (layer).source) copy.source = prefix + /** @type {{ source?: string }} */ (layer).source;
    return copy;
  });
  return { sources, layers, glyphs: style.glyphs || null, sprite: style.sprite || null };
}

/**
 * A glyph URL for a font stack the provider's server has. The app's own label layers ask for
 * "Open Sans" stacks, which the OpenFreeMap glyph server does not have: unanswered, MapLibre
 * logs a 404 and a warning per glyph range and draws them locally. Asked by weight instead,
 * they come from the same server as the base map's labels.
 * @param {string} url a request URL from MapLibre's transformRequest
 * @param {string[]} fonts the stacks the server has
 */
export function glyphUrlForAvailableFont(url, fonts) {
  if (!url || !fonts?.length) return url;
  const match = /\/fonts\/([^/]+)\/(\d+-\d+\.pbf)(\?.*)?$/.exec(url);
  if (!match) return url;
  const stack = decodeURIComponent(match[1]).split(',').map((font) => font.trim());
  if (stack.some((font) => fonts.includes(font))) return url;
  const wanted = stack.join(' ');
  const pick = (/bold/i.test(wanted) && fonts.find((font) => /bold/i.test(font)))
    || (/italic/i.test(wanted) && fonts.find((font) => /italic/i.test(font)))
    || fonts.find((font) => /regular/i.test(font))
    || fonts[0];
  return url.slice(0, match.index) + `/fonts/${encodeURIComponent(pick)}/${match[2]}${match[3] || ''}`;
}

/**
 * Which provider of a chain to use, and when to move on: the decisions only, no map. One per
 * map; `failed` is shared with the session store.
 * @param {readonly BasemapProvider[]} chain
 * @param {{ storage?: FailoverStorage | null }} [options]
 */
export function createBasemapFailover(chain, { storage = null } = {}) {
  const ids = chain.map((provider) => provider.id);
  const failed = new Set(readFailed(storage).filter((id) => ids.includes(id)));
  let errors = 0;
  let loaded = 0;
  /** @type {string | null} */
  let currentId = null;

  function persist() {
    try { storage?.setItem(BASEMAP_SESSION_KEY, JSON.stringify([...failed])); } catch { /* private mode */ }
  }

  return {
    /**
     * The provider to use now: the first in the chain not failed this session (the last always).
     * @returns {BasemapProvider}
     */
    current() {
      const provider = chain.find((item) => !failed.has(item.id)) || chain[chain.length - 1];
      if (provider.id !== currentId) {
        currentId = provider.id;
        errors = 0;
        loaded = 0;
      }
      return provider;
    },
    /** A tile arrived. */
    recordLoad() {
      loaded += 1;
    },
    /** A tile failed. True when the provider should now be given up. */
    recordError() {
      errors += 1;
      if (loaded === 0) return errors >= ERRORS_BEFORE_ANY_TILE;
      return errors >= ERRORS_AFTER_TILES && errors > loaded;
    },
    hasLoaded() {
      return loaded > 0;
    },
    /**
     * Give up the current provider; returns the next one, or null when it was the last.
     * @returns {BasemapProvider | null}
     */
    fail() {
      const provider = this.current();
      if (provider === chain[chain.length - 1]) return null;
      failed.add(provider.id);
      persist();
      return this.current();
    },
    failedIds() {
      return [...failed];
    },
    counts() {
      return { errors, loaded };
    }
  };
}

/**
 * @param {{ getItem(key: string): string | null } | null | undefined} storage
 * @returns {string[]}
 */
function readFailed(storage) {
  try {
    const value = JSON.parse(storage?.getItem(BASEMAP_SESSION_KEY) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Puts a base map on a MapLibre map and keeps it there: the default chain with failover, or one
 * raster base map the reader chose. Needs a map whose style has loaded.
 */
export class BasemapManager {
  /**
   * @param {import('maplibre-gl').Map} map a MapLibre map
   * @param {{ chain?: BasemapProvider[], storage?: Storage | null, fetchImpl?: typeof fetch,
   *   document?: Document | null, setTimeoutImpl?: typeof setTimeout, clearTimeoutImpl?: typeof clearTimeout,
   *   onChange?: (provider: BasemapProvider, reason: string) => void }} [options]
   */
  constructor(map, options = {}) {
    this.map = map;
    /** @type {readonly BasemapProvider[]} */
    this.chain = options.chain || preferredChain(DEFAULT_BASEMAP_CHAIN, {
      search: typeof location !== 'undefined' ? location.search : '',
      storage: safeLocalStorage()
    });
    this.fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
    this.document = options.document === undefined ? (typeof document !== 'undefined' ? document : null) : options.document;
    this.setTimeoutImpl = options.setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = options.clearTimeoutImpl || ((id) => clearTimeout(id));
    this.onChange = options.onChange || null;
    this.failover = createBasemapFailover(this.chain, { storage: options.storage === undefined ? safeSessionStorage() : options.storage });
    /** @type {'chain' | 'fixed' | null} */
    this.mode = null; // 'chain' or 'fixed'
    /** @type {BasemapProvider | null} */
    this.active = null; // the provider drawn now
    /** @type {string[] | null} */
    this.glyphFonts = null;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this.timer = 0;
    this.generation = 0;
    /** @type {Map<string, Promise<import('maplibre-gl').StyleSpecification>>} */
    this.styleCache = new Map();
    /** @param {MapSourceEventView} event */
    this.onError = (event) => this.handleError(event);
    /** @param {MapSourceEventView} event */
    this.onData = (event) => this.handleData(event);
    map.on('error', this.onError);
    map.on('sourcedata', this.onData);
  }

  /**
   * The default base map: the chain, from the first provider not failed this session.
   * @returns {Promise<BasemapProvider | null>}
   */
  useDefault() {
    const provider = this.failover.current();
    if (this.mode === 'chain' && this.active === provider) return Promise.resolve(provider);
    this.mode = 'chain';
    return this.apply(provider, 'default');
  }

  /**
   * One raster base map the reader chose; no failover.
   * @param {Omit<RasterProvider, 'kind'>} provider
   * @returns {Promise<BasemapProvider | null>}
   */
  useRaster(provider) {
    this.mode = 'fixed';
    return this.apply({ kind: 'raster', ...provider }, 'chosen');
  }

  /**
   * Request rewriting for MapLibre (transformRequest): glyphs from the provider's server.
   * @param {string} url
   * @param {string | undefined} resourceType
   * @returns {{ url: string } | undefined}
   */
  transformRequest(url, resourceType) {
    if (resourceType === 'Glyphs' && this.glyphFonts) return { url: glyphUrlForAvailableFont(url, this.glyphFonts) };
    return undefined;
  }

  /**
   * Draws a provider; resolves to the provider drawn in the end (a failover's, or null if none is left).
   * @param {BasemapProvider} provider
   * @param {string} reason
   * @returns {Promise<BasemapProvider | null>}
   */
  async apply(provider, reason) {
    const generation = ++this.generation;
    this.clearTimer();
    this.remove();
    this.active = provider;
    if (provider.kind === 'style') {
      this.armTimer(generation);
      let style = null;
      try {
        style = await this.loadStyle(provider);
      } catch {
        style = null;
      }
      if (generation !== this.generation) return provider;
      const namespaced = namespaceStyle(style, `${BASEMAP_PREFIX}${provider.id}-`, provider.attribution);
      if (!namespaced) return this.giveUp(generation, 'style');
      this.addStyle(namespaced, provider);
      // A style with no tiled source has nothing to wait for.
      if (!Object.keys(namespaced.sources).length) this.clearTimer();
    } else {
      this.addRaster(provider);
      if (this.mode === 'chain') this.armTimer(generation);
    }
    this.onChange?.(provider, reason);
    return provider;
  }

  /**
   * @param {StyleProvider} provider
   * @returns {Promise<import('maplibre-gl').StyleSpecification | undefined>}
   */
  async loadStyle(provider) {
    if (!this.styleCache.has(provider.styleUrl)) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = this.setTimeoutImpl(() => controller?.abort(), STYLE_FETCH_TIMEOUT_MS);
      const request = this.fetchImpl(provider.styleUrl, { signal: controller?.signal, credentials: 'omit' })
        .then((response) => {
          if (!response.ok) throw new Error(`base map style ${response.status}`);
          return response.json();
        })
        .finally(() => this.clearTimeoutImpl(timer));
      this.styleCache.set(provider.styleUrl, request);
      request.catch(() => this.styleCache.delete(provider.styleUrl));
    }
    return this.styleCache.get(provider.styleUrl);
  }

  /** The first layer that is not the base map's: everything of the base map goes below it. */
  firstAppLayerId() {
    const layers = this.map.getStyle()?.layers || [];
    return layers.find((layer) => !isBasemapId(layer.id))?.id;
  }

  /**
   * @param {NamespacedStyle} namespaced
   * @param {StyleProvider} provider
   */
  addStyle(namespaced, provider) {
    const map = this.map;
    this.glyphFonts = provider.glyphFonts || null;
    if (namespaced.glyphs) map.setGlyphs(namespaced.glyphs);
    // setSprite takes any sprite specification (a URL or a list of named ones) at run time; MapLibre declares a URL.
    if (namespaced.sprite) map.setSprite(/** @type {string} */ (namespaced.sprite));
    for (const [id, source] of Object.entries(namespaced.sources)) {
      if (!map.getSource(id)) map.addSource(id, source);
    }
    const before = this.firstAppLayerId();
    for (const layer of namespaced.layers) {
      if (!map.getLayer(layer.id)) map.addLayer(layer, before);
    }
  }

  /** @param {RasterProvider} provider */
  addRaster(provider) {
    const map = this.map;
    const id = `${BASEMAP_PREFIX}raster`;
    map.addSource(id, {
      type: 'raster',
      tiles: provider.tiles,
      tileSize: 256,
      attribution: provider.attribution,
      ...(provider.maxzoom ? { maxzoom: provider.maxzoom } : {})
    });
    map.addLayer({ id, type: 'raster', source: id }, this.firstAppLayerId());
  }

  /** Takes every base map layer and source off the map (and the base map's glyphs and sprite). */
  remove() {
    const map = this.map;
    const style = map.getStyle?.();
    if (!style) return;
    for (const layer of [...(style.layers || [])].reverse()) {
      if (isBasemapId(layer.id) && map.getLayer(layer.id)) map.removeLayer(layer.id);
    }
    for (const id of Object.keys(style.sources || {})) {
      if (isBasemapId(id) && map.getSource(id)) map.removeSource(id);
    }
    if (this.glyphFonts) {
      this.glyphFonts = null;
      if (style.glyphs) map.setGlyphs(null);
      if (style.sprite) map.setSprite(null);
    }
  }

  /** @param {MapSourceEventView} event */
  handleError(event) {
    if (this.mode !== 'chain' || !isBasemapId(event?.sourceId) || !this.map.getSource(event.sourceId)) return;
    if (this.failover.recordError()) this.giveUp(this.generation, 'tiles');
  }

  /** @param {MapSourceEventView} event */
  handleData(event) {
    if (this.mode !== 'chain' || !isBasemapId(event?.sourceId) || !event.tile) return;
    this.failover.recordLoad();
  }

  /** @param {number} generation */
  armTimer(generation) {
    this.clearTimer();
    this.timer = this.setTimeoutImpl(() => {
      this.timer = 0;
      if (generation !== this.generation || this.failover.hasLoaded()) return;
      // A hidden tab draws no frames, so asks for no tiles: wait until it is shown.
      if (this.document?.hidden) { this.armTimer(generation); return; }
      this.giveUp(generation, 'timeout');
    }, FIRST_TILE_TIMEOUT_MS);
  }

  clearTimer() {
    if (this.timer) this.clearTimeoutImpl(this.timer);
    this.timer = 0;
  }

  /**
   * @param {number} generation
   * @param {string} reason
   * @returns {BasemapProvider | null | Promise<BasemapProvider | null>}
   */
  giveUp(generation, reason) {

    if (generation !== this.generation || this.mode !== 'chain') return this.active;
    const next = this.failover.fail();
    if (!next) {
      this.clearTimer();
      return this.active;
    }
    return this.apply(next, `failover:${reason}`);
  }

  destroy() {
    this.clearTimer();
    this.map.off?.('error', this.onError);
    this.map.off?.('sourcedata', this.onData);
  }
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function safeSessionStorage() {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}
