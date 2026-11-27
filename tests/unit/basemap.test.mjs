// The map's base map provider chain (packages/map/src/renderer/basemap.mjs): since 27 Nov 2026
// (owner) OpenStreetMap's own tiles first, then OpenStreetMap Germany's, OpenFreeMap Bright and
// OpenFreeMap Positron as fallbacks; failover per session (QA 2026-11-11, H8). The failover
// mechanics are tested on the default chain (raster to raster to style) and on a chain that starts
// with a vector style (STYLE_FIRST_CHAIN: style to style to raster), so every kind of switch is covered.
//
//   node --test tests/unit/basemap.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BASEMAP_SESSION_KEY,
  BasemapManager,
  CHOOSABLE_BASE_MAPS,
  DEFAULT_BASE_MAP_ID,
  DEFAULT_BASEMAP_CHAIN,
  DARK_BASEMAP_CHAIN,
  CHOOSABLE_STYLE_BASE_MAPS,
  basemapTone,
  defaultChainFor,
  ERRORS_AFTER_TILES,
  ERRORS_BEFORE_ANY_TILE,
  FIRST_TILE_TIMEOUT_MS,
  OPENFREEMAP_BRIGHT,
  OPENFREEMAP_LIBERTY,
  OPENFREEMAP_POSITRON,
  OPENFREEMAP_DARK,
  OSM_DE_TILES,
  OSM_MUTED_TILES,
  OSM_DARK_TILES,
  OSM_STANDARD_TILES,
  createBasemapFailover,
  glyphUrlForAvailableFont,
  isBasemapId,
  namespaceStyle,
  preferredChain,
  resolveBaseMapId
} from '@civgraph/map/renderer/basemap.mjs';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data
  };
}

/** A MapLibre stand-in: a style of sources and ordered layers, events, glyphs and sprite. */
function fakeMap(appLayers = []) {
  const style = { version: 8, sources: {}, layers: appLayers.map((id) => ({ id, type: 'fill', source: 'app' })), glyphs: undefined, sprite: undefined };
  const handlers = new Map();
  const attributes = new Map();
  const container = { setAttribute: (name, value) => attributes.set(name, String(value)), getAttribute: (name) => attributes.get(name) ?? null };
  return {
    style,
    container,
    getContainer: () => container,
    getStyle: () => style,
    getSource: (id) => style.sources[id],
    getLayer: (id) => style.layers.find((layer) => layer.id === id),
    addSource(id, source) {
      if (style.sources[id]) throw new Error(`source ${id} exists`);
      style.sources[id] = source;
    },
    removeSource(id) { delete style.sources[id]; },
    addLayer(layer, before) {
      if (this.getLayer(layer.id)) throw new Error(`layer ${layer.id} exists`);
      const index = before ? style.layers.findIndex((item) => item.id === before) : -1;
      if (index < 0) style.layers.push(layer); else style.layers.splice(index, 0, layer);
    },
    removeLayer(id) { style.layers = style.layers.filter((layer) => layer.id !== id); },
    setGlyphs(url) { style.glyphs = url || undefined; },
    setSprite(url) { style.sprite = url || undefined; },
    on(type, fn) { handlers.set(type, [...(handlers.get(type) || []), fn]); },
    off(type, fn) { handlers.set(type, (handlers.get(type) || []).filter((item) => item !== fn)); },
    fire(type, event) { for (const fn of handlers.get(type) || []) fn(event); }
  };
}

const LIBERTY_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    ne2_shaded: { type: 'raster', tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'], tileSize: 256 }
  },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'natural_earth', type: 'raster', source: 'ne2_shaded' },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' }
  ]
};

function okFetch(body) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  impl.calls = calls;
  return impl;
}

/** Timers run by hand: fire() runs every pending callback once. */
function manualTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeoutImpl: (fn) => { const id = next++; pending.set(id, fn); return id; },
    clearTimeoutImpl: (id) => pending.delete(id),
    fire() { const fns = [...pending.values()]; pending.clear(); for (const fn of fns) fn(); },
    get size() { return pending.size; }
  };
}

/** A chain that starts with vector styles and ends with raster tiles (the default until 27 Nov 2026). */
const STYLE_FIRST_CHAIN = Object.freeze([OPENFREEMAP_POSITRON, OPENFREEMAP_LIBERTY, OSM_MUTED_TILES]);

function manager(map, options = {}) {
  const timers = options.timers || manualTimers();
  return {
    timers,
    basemap: new BasemapManager(map, {
      ...(options.chain ? { chain: options.chain } : {}),
      storage: options.storage ?? memoryStorage(),
      fetchImpl: options.fetchImpl ?? okFetch(LIBERTY_STYLE),
      document: options.document ?? { hidden: false },
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      onChange: options.onChange
    })
  };
}

test('the default chain is OpenStreetMap tiles, then OSM Germany, OpenFreeMap Bright and Positron (owner, 27 Nov 2026)', () => {
  assert.deepEqual(DEFAULT_BASEMAP_CHAIN.map((provider) => provider.id), ['osm-tiles', 'osm-de-tiles', 'openfreemap-bright', 'openfreemap-positron']);
  // OpenStreetMap's own map, as the OSMF serves it: the first choice, and not muted.
  assert.equal(DEFAULT_BASEMAP_CHAIN[0], OSM_STANDARD_TILES);
  assert.equal(OSM_STANDARD_TILES.kind, 'raster');
  assert.equal(OSM_STANDARD_TILES.tiles[0], 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(OSM_STANDARD_TILES.paint, undefined, 'the first choice is drawn as OSM draws it, unmuted');
  assert.equal(OSM_DE_TILES.kind, 'raster');
  assert.equal(OSM_DE_TILES.tiles[0], 'https://tile.openstreetmap.de/{z}/{x}/{y}.png');
  assert.equal(OSM_DE_TILES.paint, undefined);
  assert.match(OSM_DE_TILES.terms, /fossgis\.de/);
  for (const provider of [OPENFREEMAP_BRIGHT, OPENFREEMAP_POSITRON, OPENFREEMAP_LIBERTY, OPENFREEMAP_DARK]) {
    assert.equal(provider.kind, 'style');
    assert.match(provider.styleUrl, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
  }
  assert.match(OPENFREEMAP_BRIGHT.styleUrl, /\/bright$/);
  assert.match(OPENFREEMAP_POSITRON.styleUrl, /\/positron$/);
  assert.match(OPENFREEMAP_DARK.styleUrl, /\/dark$/);
  // The muted tiles, the last resort until 27 Nov 2026, are no longer in the default chain.
  assert.equal(OSM_MUTED_TILES.tiles[0], OSM_STANDARD_TILES.tiles[0]);
  assert.ok(OSM_MUTED_TILES.paint['raster-saturation'] < 0, 'the old fallback is muted');
  assert.ok(!DEFAULT_BASEMAP_CHAIN.includes(OSM_MUTED_TILES));
  assert.equal(new Set(DEFAULT_BASEMAP_CHAIN.map((provider) => provider.id)).size, DEFAULT_BASEMAP_CHAIN.length, 'no provider twice');
});

test('the default chain is light in the dark theme too (owner, 27 Nov 2026); the dark chain stays defined', () => {
  assert.deepEqual(DARK_BASEMAP_CHAIN.map((provider) => provider.id), ['openfreemap-dark', 'openfreemap-positron', 'osm-tiles']);
  assert.equal(defaultChainFor('dark'), DEFAULT_BASEMAP_CHAIN, 'a dark base map is never the default');
  assert.equal(defaultChainFor('light'), DEFAULT_BASEMAP_CHAIN);
  assert.equal(defaultChainFor(undefined), DEFAULT_BASEMAP_CHAIN);
  assert.equal(basemapTone(OPENFREEMAP_DARK), 'dark');
  assert.equal(basemapTone(OSM_DARK_TILES), 'dark');
  assert.equal(basemapTone(OPENFREEMAP_POSITRON), 'light');
  assert.equal(basemapTone(OSM_MUTED_TILES), 'light');
  for (const provider of DEFAULT_BASEMAP_CHAIN) assert.equal(basemapTone(provider), 'light', provider.id);
  assert.equal(basemapTone(null), 'light');
});

test('Liberty, Positron and the dark map are choices in Map Settings; ids resolve to the default otherwise', () => {
  assert.deepEqual(Object.keys(CHOOSABLE_STYLE_BASE_MAPS).sort(), ['openfreemap-dark', 'openfreemap-liberty', 'openfreemap-positron']);
  assert.equal(CHOOSABLE_STYLE_BASE_MAPS['openfreemap-liberty'], OPENFREEMAP_LIBERTY);
  assert.equal(CHOOSABLE_STYLE_BASE_MAPS['openfreemap-dark'], OPENFREEMAP_DARK);
  // Positron, the default from 23 to 27 Nov 2026, stays a choice for readers who want the plain background.
  assert.equal(CHOOSABLE_STYLE_BASE_MAPS['openfreemap-positron'], OPENFREEMAP_POSITRON);
  assert.equal(resolveBaseMapId('openfreemap-dark'), 'openfreemap-dark');
  assert.equal(resolveBaseMapId('openfreemap-liberty'), 'openfreemap-liberty');
  assert.equal(resolveBaseMapId('openfreemap-positron'), 'openfreemap-positron');
  assert.equal(resolveBaseMapId('opentopomap'), 'opentopomap');
  // The default chain's own providers are the default, not separate choices.
  for (const id of ['osm-tiles', 'osm-de-tiles', 'openfreemap-bright']) assert.equal(resolveBaseMapId(id), 'osm-standard', id);
  assert.equal(resolveBaseMapId('cartodb-dark'), 'osm-standard');
});

test('every provider carries the credit its terms require', () => {
  assert.match(OPENFREEMAP_LIBERTY.attribution, /OpenFreeMap/);
  assert.match(OPENFREEMAP_LIBERTY.attribution, /OpenMapTiles/);
  assert.match(OPENFREEMAP_LIBERTY.attribution, /openstreetmap\.org\/copyright/);
  assert.equal(OPENFREEMAP_POSITRON.attribution, OPENFREEMAP_LIBERTY.attribution);
  assert.equal(OPENFREEMAP_DARK.attribution, OPENFREEMAP_LIBERTY.attribution);
  assert.equal(OPENFREEMAP_BRIGHT.attribution, OPENFREEMAP_LIBERTY.attribution);
  assert.equal(OSM_MUTED_TILES.attribution, OSM_STANDARD_TILES.attribution);
  assert.match(OSM_STANDARD_TILES.attribution, /openstreetmap\.org\/copyright/);
  assert.match(OSM_STANDARD_TILES.attribution, /OpenStreetMap<\/a> contributors/);
  // OpenStreetMap Germany: the OSM copyright credit, and who serves the tiles.
  assert.match(OSM_DE_TILES.attribution, /openstreetmap\.org\/copyright/);
  assert.match(OSM_DE_TILES.attribution, /OpenStreetMap<\/a> contributors/);
  assert.match(OSM_DE_TILES.attribution, /OpenStreetMap Deutschland/);
  assert.match(OSM_DE_TILES.attribution, /FOSSGIS/);
  // Every provider of the default chain credits OpenStreetMap, with a link to its copyright page.
  for (const provider of DEFAULT_BASEMAP_CHAIN) {
    assert.ok(provider.attribution, provider.id);
    assert.match(provider.attribution, /openstreetmap\.org\/copyright/, provider.id);
    assert.ok(provider.terms, `${provider.id} names its terms`);
  }
});

test('isBasemapId knows the base map ids and the old osm id, and nothing else', () => {
  assert.ok(isBasemapId('basemap-raster'));
  assert.ok(isBasemapId('basemap-openfreemap-liberty-water'));
  assert.ok(isBasemapId('osm'));
  assert.ok(!isBasemapId('pc-2023-vector-fill'));
  assert.ok(!isBasemapId(undefined));
});

test('namespaceStyle prefixes every source and layer and keeps the order', () => {
  const out = namespaceStyle(LIBERTY_STYLE, 'basemap-x-', 'credit');
  assert.deepEqual(Object.keys(out.sources), ['basemap-x-openmaptiles', 'basemap-x-ne2_shaded']);
  assert.deepEqual(out.layers.map((layer) => layer.id), ['basemap-x-background', 'basemap-x-natural_earth', 'basemap-x-water', 'basemap-x-place_city']);
  assert.equal(out.layers[2].source, 'basemap-x-openmaptiles');
  assert.equal(out.layers[0].source, undefined, 'a background layer has no source');
  assert.equal(out.sources['basemap-x-openmaptiles'].attribution, 'credit');
  assert.equal(out.sources['basemap-x-ne2_shaded'].attribution, undefined, 'only vector sources take the credit');
  assert.equal(out.glyphs, LIBERTY_STYLE.glyphs);
  assert.equal(out.sprite, LIBERTY_STYLE.sprite);
  assert.equal(LIBERTY_STYLE.layers[0].id, 'background', 'the input is not changed');
  assert.equal(namespaceStyle(null, 'p-'), null);
  assert.equal(namespaceStyle({ layers: 'x' }, 'p-'), null);
});

test('glyph requests for stacks the server lacks are asked by weight', () => {
  const fonts = OPENFREEMAP_LIBERTY.glyphFonts;
  const base = 'https://tiles.openfreemap.org/fonts/';
  assert.equal(glyphUrlForAvailableFont(`${base}Noto%20Sans%20Regular/0-255.pbf`, fonts), `${base}Noto%20Sans%20Regular/0-255.pbf`);
  assert.equal(glyphUrlForAvailableFont(`${base}Open%20Sans%20Regular,Arial%20Unicode%20MS%20Regular/0-255.pbf`, fonts), `${base}Noto%20Sans%20Regular/0-255.pbf`);
  assert.equal(glyphUrlForAvailableFont(`${base}Open Sans Bold,Arial Unicode MS Bold/256-511.pbf`, fonts), `${base}Noto%20Sans%20Bold/256-511.pbf`);
  assert.equal(glyphUrlForAvailableFont('https://example.org/tile/1/2/3.pbf', fonts), 'https://example.org/tile/1/2/3.pbf');
  assert.equal(glyphUrlForAvailableFont(`${base}Open%20Sans%20Regular/0-255.pbf`, null), `${base}Open%20Sans%20Regular/0-255.pbf`);
});

test('failover gives up a provider after repeated errors with no tile, and remembers it for the session', () => {
  const storage = memoryStorage();
  const failover = createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage });
  assert.equal(failover.current().id, 'osm-tiles');
  for (let i = 1; i < ERRORS_BEFORE_ANY_TILE; i += 1) assert.equal(failover.recordError(), false);
  assert.equal(failover.recordError(), true);
  assert.equal(failover.fail().id, 'osm-de-tiles');
  assert.deepEqual(JSON.parse(storage.getItem(BASEMAP_SESSION_KEY)), ['osm-tiles']);
  // The count starts again for the next provider.
  assert.deepEqual(failover.counts(), { errors: 0, loaded: 0 });
  // The next page in the same session starts on the next provider.
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage }).current().id, 'osm-de-tiles');
});

test('failover tolerates scattered errors once tiles are loading', () => {
  const failover = createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage() });
  failover.current();
  for (let i = 0; i < 40; i += 1) failover.recordLoad();
  for (let i = 0; i < ERRORS_AFTER_TILES + 5; i += 1) assert.equal(failover.recordError(), false, 'errors fewer than loads');
  const bad = createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage() });
  bad.current();
  bad.recordLoad();
  let gaveUp = false;
  for (let i = 0; i < ERRORS_AFTER_TILES; i += 1) gaveUp = bad.recordError();
  assert.equal(gaveUp, true);
});

test('the last provider is never given up, and unknown or broken session values are ignored', () => {
  const storage = memoryStorage({ [BASEMAP_SESSION_KEY]: JSON.stringify(['osm-tiles', 'osm-de-tiles', 'openfreemap-bright', 'openfreemap-positron', 'gone']) });
  const failover = createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage });
  assert.equal(failover.current().id, 'openfreemap-positron');
  assert.equal(failover.fail(), null);
  assert.equal(failover.current().id, 'openfreemap-positron');
  // The same on a chain that ends with raster tiles.
  const styleFirst = createBasemapFailover(STYLE_FIRST_CHAIN, { storage: memoryStorage({ [BASEMAP_SESSION_KEY]: JSON.stringify(['openfreemap-positron', 'openfreemap-liberty', 'osm-tiles']) }) });
  assert.equal(styleFirst.current().id, 'osm-tiles');
  assert.equal(styleFirst.fail(), null);
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage({ [BASEMAP_SESSION_KEY]: '{bad' }) }).current().id, 'osm-tiles');
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: null }).current().id, 'osm-tiles');
});

test('the default base map is OpenStreetMap\'s own tiles, unmuted, below the app layers, with no style fetched', async () => {
  const map = fakeMap(['pc-2023-fill', 'pc-2023-line']);
  const changes = [];
  const fetchImpl = okFetch(LIBERTY_STYLE);
  const { basemap, timers } = manager(map, { fetchImpl, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'pc-2023-fill', 'pc-2023-line'], 'the app layers stay on top');
  assert.deepEqual(Object.keys(map.style.sources), ['basemap-raster']);
  const source = map.style.sources['basemap-raster'];
  assert.deepEqual(source.tiles, OSM_STANDARD_TILES.tiles);
  assert.equal(source.attribution, OSM_STANDARD_TILES.attribution);
  assert.equal(source.maxzoom, OSM_STANDARD_TILES.maxzoom);
  assert.equal(map.style.layers[0].paint, undefined, 'drawn as OpenStreetMap draws it');
  assert.deepEqual(fetchImpl.calls, [], 'no style is fetched for a raster base map');
  assert.equal(map.style.glyphs, undefined);
  assert.deepEqual(changes, ['osm-tiles:default']);
  assert.equal(basemap.mode, 'chain');
  assert.equal(map.container.getAttribute('data-basemap'), 'osm-tiles');
  assert.equal(map.container.getAttribute('data-basemap-tone'), 'light');
  assert.equal(basemap.tone, 'light');
  assert.equal(timers.size, 1, 'the first tile is waited for');
  // Asked again, nothing is redrawn.
  await basemap.useDefault();
  assert.equal(changes.length, 1);
});

test('a chain that starts with a style draws it from the provider style, below the app layers already on the map', async () => {
  const map = fakeMap(['pc-2023-fill', 'pc-2023-line']);
  const changes = [];
  const { basemap } = manager(map, { chain: STYLE_FIRST_CHAIN, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  const ids = map.style.layers.map((layer) => layer.id);
  assert.deepEqual(ids.slice(-2), ['pc-2023-fill', 'pc-2023-line'], 'the app layers stay on top');
  assert.equal(ids[0], 'basemap-openfreemap-positron-background');
  assert.equal(ids.length, 6);
  assert.equal(map.style.glyphs, LIBERTY_STYLE.glyphs);
  assert.equal(map.style.sprite, LIBERTY_STYLE.sprite);
  assert.match(map.style.sources['basemap-openfreemap-positron-openmaptiles'].attribution, /OpenFreeMap/);
  assert.deepEqual(changes, ['openfreemap-positron:default']);
  assert.equal(map.container.getAttribute('data-basemap'), 'openfreemap-positron');
  assert.equal(map.container.getAttribute('data-basemap-tone'), 'light');
  assert.equal(basemap.tone, 'light');
  // Asked again, nothing is redrawn.
  await basemap.useDefault();
  assert.equal(changes.length, 1);
  assert.deepEqual(basemap.transformRequest('https://tiles.openfreemap.org/fonts/Open%20Sans%20Bold/0-255.pbf', 'Glyphs'), { url: 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf' });
  assert.equal(basemap.transformRequest('https://x/y.pbf', 'Tile'), undefined);
});

test('styles that do not load fall back to the next style, then to raster tiles (style to style to raster)', async () => {
  const map = fakeMap(['app-layer']);
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const storage = memoryStorage();
  const changes = [];
  const { basemap } = manager(map, { chain: STYLE_FIRST_CHAIN, fetchImpl, storage, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, ['osm-tiles:failover:style']);
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.equal(map.style.sources['basemap-raster'].tiles[0], OSM_STANDARD_TILES.tiles[0]);
  assert.match(map.style.sources['basemap-raster'].attribution, /OpenStreetMap/);
  assert.deepEqual(map.style.layers[0].paint, { ...OSM_MUTED_TILES.paint });
  assert.equal(map.style.glyphs, undefined, 'no glyph server for a raster base map');
  assert.deepEqual(JSON.parse(storage.getItem(BASEMAP_SESSION_KEY)), ['openfreemap-positron', 'openfreemap-liberty']);
});

test('tile errors on a style base map switch provider and take every base map layer and source off', async () => {
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map, { chain: STYLE_FIRST_CHAIN });
  await basemap.useDefault();
  // Errors on the app's own sources are none of the base map's business.
  for (let i = 0; i < 10; i += 1) map.fire('error', { sourceId: 'app' });
  assert.equal(basemap.active.id, 'openfreemap-positron');
  for (let i = 0; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-positron-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'openfreemap-liberty');
  for (let i = 0; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-liberty-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.deepEqual(Object.keys(map.style.sources), ['basemap-raster']);
  assert.equal(map.style.glyphs, undefined);
  assert.equal(map.style.sprite, undefined);
});

test('OpenStreetMap tiles failing fall back to OSM Germany, then OpenFreeMap Bright, then Positron (raster to raster to style)', async () => {
  const map = fakeMap(['app-layer']);
  const storage = memoryStorage();
  const changes = [];
  const fetchImpl = okFetch(LIBERTY_STYLE);
  const { basemap } = manager(map, { fetchImpl, storage, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  // Errors on the app's own sources are none of the base map's business.
  for (let i = 0; i < 10; i += 1) map.fire('error', { sourceId: 'app', tile: {} });
  assert.equal(basemap.active.id, 'osm-tiles');
  for (let i = 0; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-raster', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  // Raster to raster: OpenStreetMap Germany's tiles in the same place, with their own credit.
  assert.equal(basemap.active.id, 'osm-de-tiles');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.deepEqual(Object.keys(map.style.sources), ['basemap-raster']);
  assert.deepEqual(map.style.sources['basemap-raster'].tiles, OSM_DE_TILES.tiles);
  assert.match(map.style.sources['basemap-raster'].attribution, /FOSSGIS/);
  assert.equal(map.style.layers[0].paint, undefined);
  assert.equal(map.container.getAttribute('data-basemap'), 'osm-de-tiles');
  assert.deepEqual(fetchImpl.calls, []);
  // One error fewer than the limit, after the switch: the count started again for the new provider.
  for (let i = 1; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-raster', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'osm-de-tiles');
  map.fire('error', { sourceId: 'basemap-raster', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  // Raster to style: OpenFreeMap Bright, and no raster layer or source left behind.
  assert.equal(basemap.active.id, 'openfreemap-bright');
  assert.deepEqual(fetchImpl.calls, [OPENFREEMAP_BRIGHT.styleUrl]);
  assert.equal(map.style.layers[0].id, 'basemap-openfreemap-bright-background');
  assert.equal(map.style.layers.at(-1).id, 'app-layer');
  assert.equal(map.getLayer('basemap-raster'), undefined);
  assert.equal(map.getSource('basemap-raster'), undefined);
  assert.equal(map.style.glyphs, LIBERTY_STYLE.glyphs);
  assert.match(map.style.sources['basemap-openfreemap-bright-openmaptiles'].attribution, /OpenFreeMap/);
  // Style to style: Positron, the last, which is never given up.
  for (let i = 0; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-bright-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'openfreemap-positron');
  assert.equal(map.style.layers.filter((layer) => layer.id.startsWith('basemap-openfreemap-bright')).length, 0);
  for (let i = 0; i < 50; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-positron-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'openfreemap-positron');
  assert.deepEqual(changes, ['osm-tiles:default', 'osm-de-tiles:failover:tiles', 'openfreemap-bright:failover:tiles', 'openfreemap-positron:failover:tiles']);
  assert.deepEqual(JSON.parse(storage.getItem(BASEMAP_SESSION_KEY)), ['osm-tiles', 'osm-de-tiles', 'openfreemap-bright']);
});

test('when OpenFreeMap Bright\'s style does not load, the fallback goes on to Positron', async () => {
  const map = fakeMap(['app-layer']);
  const fetchImpl = async (url) => (url === OPENFREEMAP_BRIGHT.styleUrl
    ? { ok: false, status: 503, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => structuredClone(LIBERTY_STYLE) });
  const storage = memoryStorage({ [BASEMAP_SESSION_KEY]: JSON.stringify(['osm-tiles', 'osm-de-tiles']) });
  const changes = [];
  const { basemap } = manager(map, { fetchImpl, storage, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, ['openfreemap-positron:failover:style']);
  assert.equal(map.style.layers[0].id, 'basemap-openfreemap-positron-background');
});

// The timer, on the default chain's raster tiles and on a chain's vector style.
const TIMER_CASES = [
  { name: 'raster tiles', chain: DEFAULT_BASEMAP_CHAIN, first: 'osm-tiles', next: 'osm-de-tiles', source: 'basemap-raster' },
  { name: 'a vector style', chain: STYLE_FIRST_CHAIN, first: 'openfreemap-positron', next: 'openfreemap-liberty', source: 'basemap-openfreemap-positron-openmaptiles' }
];

for (const { name, chain, first, next } of TIMER_CASES) {
  test(`a provider (${name}) with no tile in time is given up, but not while the page is hidden`, async () => {
    const map = fakeMap();
    const doc = { hidden: true };
    const timers = manualTimers();
    const { basemap } = manager(map, { chain, document: doc, timers });
    await basemap.useDefault();
    timers.fire();
    assert.equal(basemap.active.id, first, 'hidden: the wait starts again');
    assert.equal(timers.size, 1);
    doc.hidden = false;
    timers.fire();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(basemap.active.id, next);
    assert.ok(FIRST_TILE_TIMEOUT_MS >= 5000);
  });
}

for (const { name, chain, first, source } of TIMER_CASES) {
  test(`a provider (${name}) whose tiles arrive keeps its place when the timer fires`, async () => {
    const map = fakeMap();
    const timers = manualTimers();
    const { basemap } = manager(map, { chain, timers });
    await basemap.useDefault();
    map.fire('sourcedata', { sourceId: source, tile: {} });
    timers.fire();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(basemap.active.id, first);
  });
}

test('a base map the reader chose is drawn as it is, with no failover, and the default comes back on request', async () => {
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map);
  await basemap.useDefault();
  await basemap.useRaster({ id: 'usgs-topo', tiles: ['https://example.org/{z}/{y}/{x}'], attribution: 'USGS' });
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  for (let i = 0; i < 50; i += 1) map.fire('error', { sourceId: 'basemap-raster', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'usgs-topo');
  assert.equal(basemap.mode, 'fixed');
  await basemap.useDefault();
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(map.style.sources['basemap-raster'].tiles, OSM_STANDARD_TILES.tiles, 'the chosen tiles are replaced, not kept');
  assert.equal(map.style.sources['basemap-raster'].attribution, OSM_STANDARD_TILES.attribution);
  assert.equal(map.style.layers.at(-1).id, 'app-layer');
  // Liberty, chosen in Map Settings, is drawn from its style with no failover.
  await basemap.useStyle(OPENFREEMAP_LIBERTY);
  assert.equal(basemap.active.id, 'openfreemap-liberty');
  assert.equal(map.style.layers[0].id, 'basemap-openfreemap-liberty-background');
  for (let i = 0; i < 50; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-liberty-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'openfreemap-liberty');
  assert.equal(map.getSource('basemap-raster'), undefined);
  // Positron, chosen in Map Settings, likewise.
  await basemap.useStyle(CHOOSABLE_STYLE_BASE_MAPS['openfreemap-positron']);
  assert.equal(basemap.active.id, 'openfreemap-positron');
  assert.equal(map.style.layers[0].id, 'basemap-openfreemap-positron-background');
  assert.equal(map.style.layers.filter((layer) => layer.id.startsWith('basemap-openfreemap-liberty')).length, 0);
  for (let i = 0; i < 50; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-positron-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'openfreemap-positron');
  // And back to the default: OpenStreetMap's tiles, the style taken off.
  await basemap.useDefault();
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.equal(map.style.glyphs, undefined);
  assert.equal(map.style.sprite, undefined);
});

test('the dark theme keeps the light default; OpenFreeMap Dark is drawn only when chosen, with a dark tone', async () => {
  const map = fakeMap(['app-layer']);
  const tones = [];
  const { basemap } = manager(map, { onChange: () => tones.push(basemap.tone) });
  await basemap.useThemeDefault('dark');
  assert.equal(basemap.active.id, 'osm-tiles', 'a dark base map is never the default (owner, 27 Nov 2026)');
  assert.equal(basemap.tone, 'light');
  assert.equal(map.container.getAttribute('data-basemap-tone'), 'light');
  await basemap.useStyle(OPENFREEMAP_DARK);
  assert.equal(basemap.active.id, 'openfreemap-dark');
  assert.equal(basemap.tone, 'dark');
  assert.equal(map.container.getAttribute('data-basemap-tone'), 'dark');
  assert.equal(map.style.layers[0].id, 'basemap-openfreemap-dark-background');
  await basemap.useThemeDefault('light');
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  // A theme change on the default changes nothing.
  await basemap.useThemeDefault('dark');
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(tones, ['light', 'dark', 'light']);
  assert.equal(map.style.layers.filter((layer) => layer.id.startsWith('basemap-openfreemap-dark')).length, 0, 'the dark map is taken off');
});

test('a chain given to the manager is kept whatever the theme', async () => {
  const map = fakeMap();
  const timers = manualTimers();
  const basemap = new BasemapManager(map, { chain: [OSM_STANDARD_TILES], storage: memoryStorage(), document: { hidden: false },
    setTimeoutImpl: timers.setTimeoutImpl, clearTimeoutImpl: timers.clearTimeoutImpl });
  await basemap.useThemeDefault('dark');
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.equal(basemap.tone, 'light');
});

test('a choice made while the default style is still loading wins', async () => {
  const map = fakeMap(['app-layer']);
  let release;
  const fetchImpl = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => structuredClone(LIBERTY_STYLE) }); });
  const { basemap } = manager(map, { chain: STYLE_FIRST_CHAIN, fetchImpl });
  const pending = basemap.useDefault();
  await basemap.useRaster({ id: 'opentopomap', tiles: ['https://example.org/{z}/{x}/{y}.png'], attribution: 'OpenTopoMap' });
  release();
  await pending;
  assert.equal(basemap.active.id, 'opentopomap');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
});

test('the old inline osm layer is taken off too, so an old style never shows two base maps', async () => {
  const map = fakeMap(['app-layer']);
  map.style.sources.osm = { type: 'raster', tiles: ['x'] };
  map.style.layers.unshift({ id: 'osm', type: 'raster', source: 'osm' });
  const { basemap } = manager(map);
  await basemap.useDefault();
  assert.equal(map.getLayer('osm'), undefined);
  assert.equal(map.getSource('osm'), undefined);
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer'], 'one base map');
});

test('a named provider starts the chain (?basemap= first, then localStorage civgraph.basemap)', () => {
  const ids = (chain) => chain.map((provider) => provider.id);
  const all = ['osm-tiles', 'osm-de-tiles', 'openfreemap-bright', 'openfreemap-positron'];
  // osm-tiles is the default chain's first provider: naming it skips nothing.
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=osm-tiles' })), all);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage({ 'civgraph.basemap': 'osm-tiles' }) })), all);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=osm-de-tiles' })), ['osm-de-tiles', 'openfreemap-bright', 'openfreemap-positron']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage({ 'civgraph.basemap': 'openfreemap-bright' }) })), ['openfreemap-bright', 'openfreemap-positron']);
  // The address wins over the stored preference.
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=openfreemap-positron', storage: memoryStorage({ 'civgraph.basemap': 'osm-de-tiles' }) })), ['openfreemap-positron']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=nonsense' })), all);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, {})), all);
  // On a chain that ends with it, naming osm-tiles skips the styles before it.
  assert.deepEqual(ids(preferredChain(STYLE_FIRST_CHAIN, { search: '?basemap=osm-tiles' })), ['osm-tiles']);
  assert.deepEqual(ids(preferredChain(STYLE_FIRST_CHAIN, { search: '?basemap=openfreemap-liberty', storage: memoryStorage({ 'civgraph.basemap': 'osm-tiles' }) })), ['openfreemap-liberty', 'osm-tiles']);
  assert.deepEqual(ids(preferredChain(DARK_BASEMAP_CHAIN, { search: '?basemap=osm-tiles' })), ['osm-tiles']);
});

// The Esri base maps were removed on 11 Nov 2026 (Esri's raw tile services need an ArcGIS licence).
const ESRI_IDS = ['esri-satellite', 'esri-world-topo', 'esri-natgeo', 'esri-ocean'];

test('no Esri base map is choosable, and none is credited or fetched from an Esri host', () => {
  for (const id of ESRI_IDS) assert.equal(Object.hasOwn(CHOOSABLE_BASE_MAPS, id), false, id);
  const everything = JSON.stringify({ CHOOSABLE_BASE_MAPS, CHOOSABLE_STYLE_BASE_MAPS, DEFAULT_BASEMAP_CHAIN, DARK_BASEMAP_CHAIN });
  assert.doesNotMatch(everything, /arcgisonline|esri/i);
});

test('a saved Esri base map falls back to the default chain', async () => {
  for (const id of ESRI_IDS) assert.equal(resolveBaseMapId(id), DEFAULT_BASE_MAP_ID, id);
  for (const id of [undefined, null, '', 'nonsense', 'constructor', '__proto__', 'toString']) assert.equal(resolveBaseMapId(id), DEFAULT_BASE_MAP_ID, String(id));
  // The base maps still offered keep their id.
  for (const id of ['osm-standard', 'osm-humanitarian', 'opentopomap', 'usgs-topo']) assert.equal(resolveBaseMapId(id), id);
  // And the default it resolves to is the chain, from its first provider.
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map);
  await basemap.useDefault();
  assert.equal(basemap.mode, 'chain');
  assert.equal(basemap.active.id, DEFAULT_BASEMAP_CHAIN[0].id);
});

test('every base map Map Settings offers is the default or a choosable one, and none is Esri', () => {
  for (const page of ['site/maps/index.html', 'site/maps/classic/index.html']) {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    const select = /<select id="baseMapSelect"[\s\S]*?<\/select>/.exec(html)?.[0] || '';
    const values = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(values.includes(DEFAULT_BASE_MAP_ID), page);
    for (const value of values) assert.equal(resolveBaseMapId(value), value, `${page}: ${value}`);
    // Every vector base map a reader can choose is offered; Positron, the plain background, under Minimal.
    for (const id of Object.keys(CHOOSABLE_STYLE_BASE_MAPS)) assert.ok(values.includes(id), `${page}: ${id}`);
    const minimal = /<optgroup label="Minimal">[\s\S]*?<\/optgroup>/.exec(select)?.[0] || '';
    assert.match(minimal, /<option value="openfreemap-positron">Quiet grey map \(OpenFreeMap Positron\)<\/option>/, page);
    assert.doesNotMatch(select.replace(/<!--[\s\S]*?-->/g, ''), /esri/i, page);
  }
});

// CARTO's and Stamen's base maps left Map Settings on 26 Aug 2026 (CARTO prints "API KEY REQUIRED"
// across every keyless tile at HTTP 200; Stamen's host returns 503) but an address naming one still
// drew it, until they were removed from the registry on 11 Nov 2026.
const CARTO_STAMEN_IDS = ['cartodb-positron', 'cartodb-dark', 'cartodb-dark-nolabels', 'cartodb-voyager', 'stamen-terrain'];

test('no CARTO or Stamen base map is choosable, and none is credited or fetched from their hosts', () => {
  for (const id of CARTO_STAMEN_IDS) assert.equal(Object.hasOwn(CHOOSABLE_BASE_MAPS, id), false, id);
  const everything = JSON.stringify({ CHOOSABLE_BASE_MAPS, DEFAULT_BASEMAP_CHAIN });
  assert.doesNotMatch(everything, /cartocdn|carto\.com|CARTO|stamen/i);
  // What is left: the default plus the three Map Settings offers.
  assert.deepEqual(Object.keys(CHOOSABLE_BASE_MAPS).sort(), ['opentopomap', 'osm-humanitarian', 'usgs-topo']);
});

test('a saved CARTO or Stamen base map falls back to the default chain', async () => {
  for (const id of CARTO_STAMEN_IDS) {
    assert.equal(resolveBaseMapId(id), DEFAULT_BASE_MAP_ID, id);
    assert.equal(resolveBaseMapId(` ${id} `), DEFAULT_BASE_MAP_ID, `${id} with spaces`);
  }
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map);
  await basemap.useDefault();
  assert.equal(basemap.mode, 'chain');
  assert.equal(basemap.active.id, DEFAULT_BASEMAP_CHAIN[0].id);
});

test('Map Settings offers no CARTO or Stamen base map', () => {
  for (const page of ['site/maps/index.html', 'site/maps/classic/index.html']) {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    const select = /<select id="baseMapSelect"[\s\S]*?<\/select>/.exec(html)?.[0] || '';
    assert.doesNotMatch(select.replace(/<!--[\s\S]*?-->/g, ''), /carto|stamen/i, page);
  }
});
