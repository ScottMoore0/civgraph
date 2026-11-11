// The map's base map provider chain (packages/map/src/renderer/basemap.mjs): OpenFreeMap first,
// OpenStreetMap's own tiles as the last resort, failover per session (QA 2026-11-11, H8).
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
  ERRORS_AFTER_TILES,
  ERRORS_BEFORE_ANY_TILE,
  FIRST_TILE_TIMEOUT_MS,
  OPENFREEMAP_LIBERTY,
  OSM_STANDARD_TILES,
  createBasemapFailover,
  glyphUrlForAvailableFont,
  isBasemapId,
  namespaceStyle,
  preferredChain,
  resolveBaseMapId
} from '../../packages/map/src/renderer/basemap.mjs';

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
  return {
    style,
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

function manager(map, options = {}) {
  const timers = options.timers || manualTimers();
  return {
    timers,
    basemap: new BasemapManager(map, {
      storage: options.storage ?? memoryStorage(),
      fetchImpl: options.fetchImpl ?? okFetch(LIBERTY_STYLE),
      document: options.document ?? { hidden: false },
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      onChange: options.onChange
    })
  };
}

test('the default chain is OpenFreeMap first and OpenStreetMap tiles last', () => {
  assert.deepEqual(DEFAULT_BASEMAP_CHAIN.map((provider) => provider.id), ['openfreemap-liberty', 'osm-tiles']);
  assert.equal(OPENFREEMAP_LIBERTY.kind, 'style');
  assert.match(OPENFREEMAP_LIBERTY.styleUrl, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.equal(OSM_STANDARD_TILES.tiles[0], 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
});

test('every provider carries the credit its terms require', () => {
  assert.match(OPENFREEMAP_LIBERTY.attribution, /OpenFreeMap/);
  assert.match(OPENFREEMAP_LIBERTY.attribution, /OpenMapTiles/);
  assert.match(OPENFREEMAP_LIBERTY.attribution, /openstreetmap\.org\/copyright/);
  assert.match(OSM_STANDARD_TILES.attribution, /openstreetmap\.org\/copyright/);
  assert.match(OSM_STANDARD_TILES.attribution, /OpenStreetMap<\/a> contributors/);
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
  assert.equal(failover.current().id, 'openfreemap-liberty');
  for (let i = 1; i < ERRORS_BEFORE_ANY_TILE; i += 1) assert.equal(failover.recordError(), false);
  assert.equal(failover.recordError(), true);
  assert.equal(failover.fail().id, 'osm-tiles');
  assert.deepEqual(JSON.parse(storage.getItem(BASEMAP_SESSION_KEY)), ['openfreemap-liberty']);
  // The next page in the same session starts on the fallback.
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage }).current().id, 'osm-tiles');
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
  const storage = memoryStorage({ [BASEMAP_SESSION_KEY]: JSON.stringify(['openfreemap-liberty', 'osm-tiles', 'gone']) });
  const failover = createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage });
  assert.equal(failover.current().id, 'osm-tiles');
  assert.equal(failover.fail(), null);
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage({ [BASEMAP_SESSION_KEY]: '{bad' }) }).current().id, 'openfreemap-liberty');
  assert.equal(createBasemapFailover(DEFAULT_BASEMAP_CHAIN, { storage: null }).current().id, 'openfreemap-liberty');
});

test('the default base map is drawn from the provider style, below the app layers already on the map', async () => {
  const map = fakeMap(['pc-2023-fill', 'pc-2023-line']);
  const changes = [];
  const { basemap } = manager(map, { onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  const ids = map.style.layers.map((layer) => layer.id);
  assert.deepEqual(ids.slice(-2), ['pc-2023-fill', 'pc-2023-line'], 'the app layers stay on top');
  assert.equal(ids[0], 'basemap-openfreemap-liberty-background');
  assert.equal(ids.length, 6);
  assert.equal(map.style.glyphs, LIBERTY_STYLE.glyphs);
  assert.equal(map.style.sprite, LIBERTY_STYLE.sprite);
  assert.match(map.style.sources['basemap-openfreemap-liberty-openmaptiles'].attribution, /OpenFreeMap/);
  assert.deepEqual(changes, ['openfreemap-liberty:default']);
  // Asked again, nothing is redrawn.
  await basemap.useDefault();
  assert.equal(changes.length, 1);
  assert.deepEqual(basemap.transformRequest('https://tiles.openfreemap.org/fonts/Open%20Sans%20Bold/0-255.pbf', 'Glyphs'), { url: 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf' });
  assert.equal(basemap.transformRequest('https://x/y.pbf', 'Tile'), undefined);
});

test('a style that does not load falls straight back to OpenStreetMap tiles', async () => {
  const map = fakeMap(['app-layer']);
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const storage = memoryStorage();
  const changes = [];
  const { basemap } = manager(map, { fetchImpl, storage, onChange: (provider, reason) => changes.push(`${provider.id}:${reason}`) });
  await basemap.useDefault();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(changes, ['osm-tiles:failover:style']);
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.equal(map.style.sources['basemap-raster'].tiles[0], OSM_STANDARD_TILES.tiles[0]);
  assert.match(map.style.sources['basemap-raster'].attribution, /OpenStreetMap/);
  assert.equal(map.style.glyphs, undefined, 'no glyph server for a raster base map');
  assert.deepEqual(JSON.parse(storage.getItem(BASEMAP_SESSION_KEY)), ['openfreemap-liberty']);
});

test('tile errors on the base map switch provider and take every base map layer and source off', async () => {
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map);
  await basemap.useDefault();
  // Errors on the app's own sources are none of the base map's business.
  for (let i = 0; i < 10; i += 1) map.fire('error', { sourceId: 'app' });
  assert.equal(basemap.active.id, 'openfreemap-liberty');
  for (let i = 0; i < ERRORS_BEFORE_ANY_TILE; i += 1) map.fire('error', { sourceId: 'basemap-openfreemap-liberty-openmaptiles', tile: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  assert.deepEqual(Object.keys(map.style.sources), ['basemap-raster']);
  assert.equal(map.style.glyphs, undefined);
  assert.equal(map.style.sprite, undefined);
});

test('a provider with no tile in time is given up, but not while the page is hidden', async () => {
  const map = fakeMap();
  const doc = { hidden: true };
  const timers = manualTimers();
  const { basemap } = manager(map, { document: doc, timers });
  await basemap.useDefault();
  timers.fire();
  assert.equal(basemap.active.id, 'openfreemap-liberty', 'hidden: the wait starts again');
  assert.equal(timers.size, 1);
  doc.hidden = false;
  timers.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(basemap.active.id, 'osm-tiles');
  assert.ok(FIRST_TILE_TIMEOUT_MS >= 5000);
});

test('a provider whose tiles arrive keeps its place when the timer fires', async () => {
  const map = fakeMap();
  const timers = manualTimers();
  const { basemap } = manager(map, { timers });
  await basemap.useDefault();
  map.fire('sourcedata', { sourceId: 'basemap-openfreemap-liberty-openmaptiles', tile: {} });
  timers.fire();
  assert.equal(basemap.active.id, 'openfreemap-liberty');
});

test('a base map the reader chose is drawn as it is, with no failover, and the default comes back on request', async () => {
  const map = fakeMap(['app-layer']);
  const { basemap } = manager(map);
  await basemap.useDefault();
  await basemap.useRaster({ id: 'usgs-topo', tiles: ['https://example.org/{z}/{y}/{x}'], attribution: 'USGS' });
  assert.deepEqual(map.style.layers.map((layer) => layer.id), ['basemap-raster', 'app-layer']);
  for (let i = 0; i < 50; i += 1) map.fire('error', { sourceId: 'basemap-raster', tile: {} });
  assert.equal(basemap.active.id, 'usgs-topo');
  await basemap.useDefault();
  assert.equal(basemap.active.id, 'openfreemap-liberty');
  assert.equal(map.style.layers.at(-1).id, 'app-layer');
});

test('a choice made while the default style is still loading wins', async () => {
  const map = fakeMap(['app-layer']);
  let release;
  const fetchImpl = () => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => structuredClone(LIBERTY_STYLE) }); });
  const { basemap } = manager(map, { fetchImpl });
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
});

test('a named provider starts the chain (?basemap= first, then localStorage civgraph.basemap)', () => {
  const ids = (chain) => chain.map((provider) => provider.id);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=osm-tiles' })), ['osm-tiles']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { storage: memoryStorage({ 'civgraph.basemap': 'osm-tiles' }) })), ['osm-tiles']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=openfreemap-liberty', storage: memoryStorage({ 'civgraph.basemap': 'osm-tiles' }) })), ['openfreemap-liberty', 'osm-tiles']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, { search: '?basemap=nonsense' })), ['openfreemap-liberty', 'osm-tiles']);
  assert.deepEqual(ids(preferredChain(DEFAULT_BASEMAP_CHAIN, {})), ['openfreemap-liberty', 'osm-tiles']);
});

// The Esri base maps were removed on 11 Nov 2026 (Esri's raw tile services need an ArcGIS licence).
const ESRI_IDS = ['esri-satellite', 'esri-world-topo', 'esri-natgeo', 'esri-ocean'];

test('no Esri base map is choosable, and none is credited or fetched from an Esri host', () => {
  for (const id of ESRI_IDS) assert.equal(Object.hasOwn(CHOOSABLE_BASE_MAPS, id), false, id);
  const everything = JSON.stringify({ CHOOSABLE_BASE_MAPS, DEFAULT_BASEMAP_CHAIN });
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
