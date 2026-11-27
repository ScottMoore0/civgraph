const { test, expect } = require('@playwright/test');

// The base map provider chain (packages/map/src/renderer/basemap.mjs; QA 2026-11-11, H8). Since
// 27 Nov 2026 (owner): OpenStreetMap's own tiles first, in the dark theme too; then OpenStreetMap
// Germany's tiles (FOSSGIS), OpenFreeMap Bright and OpenFreeMap Positron as fallbacks; the credits
// always shown in full. Liberty, Positron and Dark are choices in Map Settings.
// The providers' hosts are answered here, so the spec needs no network and never loads their tiles.

const OFM = 'tiles.openfreemap.org';
const OSM = 'tile.openstreetmap.org';
const OSM_DE = 'tile.openstreetmap.de';
// The service worker fetches OpenStreetMap's tiles itself (site/sw.js isTileUrl), and a page's
// routes do not see a service worker's requests: blocked here, so the stand-ins answer every tile.
test.use({ serviceWorkers: 'block' });

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// The suite's storage names the raster base map (config/playwright.config.cjs); these tests
// exercise the default chain, so they take that preference away first.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('civgraph.basemap'); } catch { /* blocked */ } });
});

async function openMap(page, path = '/maps/') {
  await page.goto(path);
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.renderer?.basemap?.active, null, { timeout: 60000 });
}

async function basemapState(page) {
  return page.evaluate(() => {
    const basemap = window.__civgraphTest2.mapController.renderer.basemap;
    const map = window.__civgraphTest2.mapController.map;
    const attrib = document.querySelector('#map .maplibregl-ctrl-attrib');
    return {
      active: basemap.active?.id,
      mode: basemap.mode,
      firstLayer: map.getStyle().layers[0]?.id,
      rasterTiles: map.getSource('basemap-raster')?.tiles || null,
      dataBasemap: document.getElementById('map')?.getAttribute('data-basemap'),
      compact: attrib?.classList.contains('maplibregl-compact') || false,
      open: attrib?.hasAttribute('open') ?? true,
      credit: document.querySelector('#map .maplibregl-ctrl-attrib-inner')?.textContent || '',
      creditVisible: (() => { const r = attrib?.getBoundingClientRect(); return Boolean(r && r.width > 40 && r.height > 8); })()
    };
  });
}

/**
 * Stand-ins for the raster tile hosts, counting the requests each gets. `fail` lists the hosts
 * that refuse (aborted requests, as when a server blocks or is down).
 */
async function standInTiles(page, { fail = [] } = {}) {
  const requests = { [OSM]: 0, [OSM_DE]: 0 };
  for (const host of [OSM, OSM_DE]) {
    await page.route((url) => url.hostname === host, (route) => {
      requests[host] += 1;
      return fail.includes(host) ? route.abort() : route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    });
  }
  return requests;
}

/**
 * A stand-in for every OpenFreeMap style: a background, one raster source and one vector source
 * (empty tiles), so the provider's own credit goes on the vector source as it does for the real
 * styles. Counts the requests; `fail` aborts them all instead.
 */
async function standInStyles(page, { fail = false } = {}) {
  const requests = { count: 0 };
  await page.route((url) => url.hostname === OFM, (route) => {
    requests.count += 1;
    if (fail) return route.abort();
    const url = route.request().url();
    if (url.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    if (url.endsWith('.pbf')) return route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {
          shade: { type: 'raster', tiles: [`https://${OFM}/shade/{z}/{x}/{y}.png`], tileSize: 256 },
          openmaptiles: { type: 'vector', tiles: [`https://${OFM}/planet/{z}/{x}/{y}.pbf`], maxzoom: 14 }
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
          { id: 'shade', type: 'raster', source: 'shade' },
          { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' }
        ]
      })
    });
  });
  return requests;
}

test('the default base map is OpenStreetMap\'s own tiles, with the OSM credit in full, and OpenFreeMap is not asked', async ({ page }) => {
  const tiles = await standInTiles(page);
  const ofm = await standInStyles(page);
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).firstLayer).toBe('basemap-raster');
  const state = await basemapState(page);
  expect(state.active).toBe('osm-tiles');
  expect(state.mode).toBe('chain');
  expect(state.dataBasemap).toBe('osm-tiles');
  expect(state.rasterTiles).toEqual([`https://${OSM}/{z}/{x}/{y}.png`]);
  expect(state.compact, 'the credit is never folded behind (i)').toBe(false);
  expect(state.creditVisible).toBe(true);
  expect(state.credit).toContain('OpenStreetMap contributors');
  await expect.poll(() => tiles[OSM], 'OpenStreetMap\'s tile server draws the map').toBeGreaterThan(0);
  expect(ofm.count, 'OpenFreeMap is not asked while OpenStreetMap answers').toBe(0);
  expect(tiles[OSM_DE], 'OpenStreetMap Germany is not asked while OpenStreetMap answers').toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders'))).toBeNull();
});

test('when OpenStreetMap\'s tiles fail the map falls back to OpenStreetMap Germany, credited in full', async ({ page }) => {
  const tiles = await standInTiles(page, { fail: [OSM] });
  const ofm = await standInStyles(page);
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-de-tiles');
  const state = await basemapState(page);
  expect(state.firstLayer).toBe('basemap-raster');
  expect(state.rasterTiles).toEqual([`https://${OSM_DE}/{z}/{x}/{y}.png`]);
  expect(state.credit).toContain('OpenStreetMap contributors');
  expect(state.credit).toContain('OpenStreetMap Deutschland');
  expect(state.credit).toContain('FOSSGIS');
  expect(state.compact).toBe(false);
  expect(state.creditVisible).toBe(true);
  await expect.poll(() => tiles[OSM_DE]).toBeGreaterThan(0);
  expect(ofm.count, 'OpenFreeMap is not asked while OpenStreetMap Germany answers').toBe(0);
  // The rest of the session starts on the fallback rather than retrying the dead provider.
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders')))).toEqual(['osm-tiles']);
});

test('when both OpenStreetMap tile servers fail the map falls back to OpenFreeMap Bright, credited in full', async ({ page }) => {
  await standInTiles(page, { fail: [OSM, OSM_DE] });
  const ofm = await standInStyles(page);
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active, { timeout: 30000 }).toBe('openfreemap-bright');
  await expect.poll(async () => (await basemapState(page)).firstLayer).toBe('basemap-openfreemap-bright-background');
  const state = await basemapState(page);
  expect(state.rasterTiles, 'no raster base map left behind').toBeNull();
  expect(state.dataBasemap).toBe('openfreemap-bright');
  await expect.poll(async () => (await basemapState(page)).credit).toContain('OpenFreeMap');
  const credit = (await basemapState(page)).credit;
  expect(credit).toContain('OpenMapTiles');
  expect(credit).toContain('OpenStreetMap');
  expect(state.compact).toBe(false);
  expect(state.creditVisible).toBe(true);
  expect(ofm.count).toBeGreaterThan(0);
  expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders')))).toEqual(['osm-tiles', 'osm-de-tiles']);
});

test('in the dark theme the default base map stays the light OpenStreetMap map; the dark map is a choice in Map Settings', async ({ page }) => {
  // Owner, 27 Nov 2026: a dark base map is never the default, even in the dark theme.
  await page.emulateMedia({ colorScheme: 'dark' });
  await standInTiles(page);
  await standInStyles(page);
  await openMap(page);
  const tone = () => page.evaluate(() => document.getElementById('map')?.getAttribute('data-basemap-tone'));
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  await expect.poll(tone).toBe('light');
  // A theme change leaves the base map as it is.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.dispatchEvent(new CustomEvent('civgraph:themechange')); });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.dispatchEvent(new CustomEvent('civgraph:themechange')); });
  await page.waitForTimeout(300);
  expect((await basemapState(page)).active).toBe('osm-tiles');
  expect((await basemapState(page)).firstLayer).toBe('basemap-raster');
  // Chosen in Map Settings: OpenFreeMap Dark, and labels take dark halos.
  await page.locator('#baseMapSelect').selectOption('openfreemap-dark', { force: true });
  await expect.poll(async () => (await basemapState(page)).active).toBe('openfreemap-dark');
  await expect.poll(tone).toBe('dark');
});

test('Liberty, the detailed street map, can be chosen in Map Settings', async ({ page }) => {
  await standInTiles(page);
  await standInStyles(page);
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  await page.locator('#baseMapSelect').selectOption('openfreemap-liberty', { force: true });
  await expect.poll(async () => (await basemapState(page)).active).toBe('openfreemap-liberty');
  expect((await basemapState(page)).firstLayer).toBe('basemap-openfreemap-liberty-background');
});

test('Positron, the quiet grey map, can be chosen in Map Settings, and the default comes back', async ({ page }) => {
  await standInTiles(page);
  await standInStyles(page);
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  const option = page.locator('#baseMapSelect optgroup[label="Minimal"] option[value="openfreemap-positron"]');
  await expect(option).toHaveText('Quiet grey map (OpenFreeMap Positron)');
  await page.locator('#baseMapSelect').selectOption('openfreemap-positron', { force: true });
  await expect.poll(async () => (await basemapState(page)).active).toBe('openfreemap-positron');
  let state = await basemapState(page);
  expect(state.mode, 'a chosen base map, not the chain').toBe('fixed');
  expect(state.firstLayer).toBe('basemap-openfreemap-positron-background');
  expect(state.rasterTiles).toBeNull();
  await page.locator('#baseMapSelect').selectOption('osm-standard', { force: true });
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  state = await basemapState(page);
  expect(state.mode).toBe('chain');
  expect(state.firstLayer).toBe('basemap-raster');
});

// The credit, on the default and on the fallback with the longest raster credit.
for (const [name, fail, active] of [['OpenStreetMap', [], 'osm-tiles'], ['OpenStreetMap Germany', [OSM], 'osm-de-tiles']]) {
  test(`the credit does not run under the Map Settings button on a phone (${name})`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await standInTiles(page, { fail });
    await standInStyles(page, { fail: true });
    await openMap(page);
    await expect.poll(async () => (await basemapState(page)).active).toBe(active);
    const overlap = await page.evaluate(() => {
      const a = document.querySelector('#map .maplibregl-ctrl-attrib')?.getBoundingClientRect();
      const b = document.querySelector('#map .map-controls')?.getBoundingClientRect();
      if (!a || !b || !b.width) return false;
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    expect(overlap).toBe(false);
  });
}

test('?basemap=osm-tiles starts from OpenStreetMap tiles, without asking OpenFreeMap', async ({ page }) => {
  const tiles = await standInTiles(page);
  const ofm = await standInStyles(page, { fail: true });
  await openMap(page, '/maps/?basemap=osm-tiles');
  expect((await basemapState(page)).active).toBe('osm-tiles');
  expect(ofm.count).toBe(0);
  expect(tiles[OSM_DE]).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders'))).toBeNull();
});

test('?basemap=openfreemap-bright starts from OpenFreeMap Bright, without asking OpenStreetMap\'s tile servers', async ({ page }) => {
  const tiles = await standInTiles(page);
  await standInStyles(page);
  await openMap(page, '/maps/?basemap=openfreemap-bright');
  await expect.poll(async () => (await basemapState(page)).firstLayer).toBe('basemap-openfreemap-bright-background');
  expect((await basemapState(page)).active).toBe('openfreemap-bright');
  expect(tiles[OSM]).toBe(0);
  expect(tiles[OSM_DE]).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders')), 'skipped for the page, not given up').toBeNull();
});

test('an address saved with an Esri base map opens on the default chain', async ({ page }) => {
  // The four Esri base maps were removed on 11 Nov 2026 (their raw tile services need an ArcGIS
  // licence). A bookmark or shared link from before still names one in #base=.
  let esri = 0;
  await page.route((url) => /(^|\.)arcgisonline\.com$/.test(url.hostname), (route) => { esri += 1; return route.abort(); });
  await standInStyles(page, { fail: true });
  await standInTiles(page);
  await page.goto('/maps/#base=esri-satellite');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.renderer?.basemap?.active, null, { timeout: 60000 });
  // The chain, from its first provider: OpenStreetMap's tiles.
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  const state = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    app.updateURLState();
    return {
      baseMapId: app.baseMapId,
      mode: app.mapController.renderer.basemap.mode,
      hash: location.hash,
      userChoice: localStorage.getItem('basemapUserChoice'),
      options: [...document.querySelectorAll('#baseMapSelect option')].map((option) => option.value)
    };
  });
  expect(state.baseMapId).toBe('osm-standard');
  expect(state.mode).toBe('chain');
  await expect(page.locator('#baseMapSelect')).toHaveValue('osm-standard');
  expect(state.hash).not.toContain('base=');
  expect(state.userChoice, 'a removed base map is not recorded as the reader\'s choice').toBeNull();
  expect(state.options.filter((value) => /esri/i.test(value))).toEqual([]);
  expect((await basemapState(page)).credit).not.toMatch(/Esri/);
  expect(esri).toBe(0);
});

// CARTO's and Stamen's base maps left Map Settings on 26 Aug 2026, but until 11 Nov 2026 an address
// naming one still drew it (CARTO's keyless tiles carry "API KEY REQUIRED" at HTTP 200; Stamen's
// host returns 503). Now they open on the default chain, exactly as the Esri ids do.
for (const id of ['cartodb-positron', 'cartodb-dark', 'cartodb-dark-nolabels', 'cartodb-voyager', 'stamen-terrain']) {
  test(`an address saved with ${id} opens on the default chain`, async ({ page }) => {
    let removedHost = 0;
    await page.route((url) => /(^|\.)(cartocdn\.com|carto\.com)$/.test(url.hostname) && !/voyager_only_labels/.test(url.pathname)
      || /stamen/.test(url.hostname), (route) => { removedHost += 1; return route.abort(); });
    await standInStyles(page, { fail: true });
    await standInTiles(page);
    await page.goto(`/maps/#base=${id}`);
    await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
    await page.evaluate(() => window.__civgraphTest2.restorePromise);
    await page.waitForFunction(() => window.__civgraphTest2?.mapController?.renderer?.basemap?.active, null, { timeout: 60000 });
    // The chain, from its first provider: OpenStreetMap's tiles.
    await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
    const state = await page.evaluate(() => {
      const app = window.__civgraphTest2.app;
      app.updateURLState();
      return {
        baseMapId: app.baseMapId,
        mode: app.mapController.renderer.basemap.mode,
        hash: location.hash,
        userChoice: localStorage.getItem('basemapUserChoice'),
        options: [...document.querySelectorAll('#baseMapSelect option')].map((option) => option.value)
      };
    });
    expect(state.baseMapId).toBe('osm-standard');
    expect(state.mode).toBe('chain');
    await expect(page.locator('#baseMapSelect')).toHaveValue('osm-standard');
    expect(state.hash).not.toContain('base=');
    expect(state.userChoice, 'a removed base map is not recorded as the reader\'s choice').toBeNull();
    expect(state.options.filter((value) => /carto|stamen/i.test(value))).toEqual([]);
    expect((await basemapState(page)).credit).not.toMatch(/CARTO|Stamen/);
    expect(removedHost).toBe(0);
  });
}
