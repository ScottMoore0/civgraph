const { test, expect } = require('@playwright/test');

// The base map provider chain (packages/map/src/renderer/basemap.mjs; QA 2026-11-11, H8): OpenFreeMap
// first, OpenStreetMap's own tiles only as the last resort, and the credits always shown in full.
// The providers' hosts are answered here, so the spec needs no network and never loads their tiles.

const OFM = 'tiles.openfreemap.org';
const OSM = 'tile.openstreetmap.org';
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// The suite's storage names the raster base map (config/playwright.config.cjs); these tests
// exercise the default chain, so they take that preference away first.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('civgraph.basemap'); } catch { /* blocked */ } });
});

async function openMap(page) {
  await page.goto('/maps/');
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.renderer?.basemap?.active, null, { timeout: 60000 });
}

async function basemapState(page) {
  return page.evaluate(() => {
    const basemap = window.__civgraphTest2.mapController.renderer.basemap;
    const map = window.__civgraphTest2.mapController.map;
    const attrib = document.querySelector('#map .maplibregl-ctrl-attrib');
    return {
      active: basemap.active?.id,
      firstLayer: map.getStyle().layers[0]?.id,
      compact: attrib?.classList.contains('maplibregl-compact') || false,
      open: attrib?.hasAttribute('open') ?? true,
      credit: document.querySelector('#map .maplibregl-ctrl-attrib-inner')?.textContent || '',
      creditVisible: (() => { const r = attrib?.getBoundingClientRect(); return Boolean(r && r.width > 40 && r.height > 8); })()
    };
  });
}

test('the default base map comes from OpenFreeMap, with its credit shown in full', async ({ page }) => {
  // A style with a background and one raster source stands in for OpenFreeMap's.
  await page.route((url) => url.hostname === OFM, (route) => (route.request().url().endsWith('.png')
    ? route.fulfill({ contentType: 'image/png', body: PNG_1X1 })
    : route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: { shade: { type: 'raster', tiles: [`https://${OFM}/shade/{z}/{x}/{y}.png`], tileSize: 256, attribution: 'OpenFreeMap stand-in credit' } },
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }, { id: 'shade', type: 'raster', source: 'shade' }]
      })
    })));
  let osmRequests = 0;
  await page.route((url) => url.hostname === OSM, (route) => { osmRequests += 1; return route.fulfill({ contentType: 'image/png', body: PNG_1X1 }); });
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).firstLayer).toBe('basemap-openfreemap-liberty-background');
  const state = await basemapState(page);
  expect(state.active).toBe('openfreemap-liberty');
  expect(state.compact, 'the credit is never folded behind (i)').toBe(false);
  expect(state.creditVisible).toBe(true);
  expect(state.credit).toContain('OpenFreeMap stand-in credit');
  expect(osmRequests, 'OpenStreetMap tile server is not asked while OpenFreeMap answers').toBe(0);
});

test('when OpenFreeMap fails the map falls back to OpenStreetMap tiles, credited in full', async ({ page }) => {
  await page.route((url) => url.hostname === OFM, (route) => route.abort());
  await page.route((url) => url.hostname === OSM, (route) => route.fulfill({ contentType: 'image/png', body: PNG_1X1 }));
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  const state = await basemapState(page);
  expect(state.firstLayer).toBe('basemap-raster');
  expect(state.credit).toContain('OpenStreetMap');
  expect(state.compact).toBe(false);
  expect(state.creditVisible).toBe(true);
  // The rest of the session starts on the fallback rather than retrying the dead provider.
  expect(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders'))).toContain('openfreemap-liberty');
});

test('the credit does not run under the Map Settings button on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route((url) => url.hostname === OFM, (route) => route.abort());
  await page.route((url) => url.hostname === OSM, (route) => route.fulfill({ contentType: 'image/png', body: PNG_1X1 }));
  await openMap(page);
  await expect.poll(async () => (await basemapState(page)).active).toBe('osm-tiles');
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('#map .maplibregl-ctrl-attrib')?.getBoundingClientRect();
    const b = document.querySelector('#map .map-controls')?.getBoundingClientRect();
    if (!a || !b || !b.width) return false;
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  expect(overlap).toBe(false);
});

test('?basemap=osm-tiles starts from OpenStreetMap tiles, without asking OpenFreeMap', async ({ page }) => {
  let ofm = 0;
  await page.route((url) => url.hostname === OFM, (route) => { ofm += 1; return route.abort(); });
  await page.route((url) => url.hostname === OSM, (route) => route.fulfill({ contentType: 'image/png', body: PNG_1X1 }));
  await page.goto('/maps/?basemap=osm-tiles');
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.renderer?.basemap?.active, null, { timeout: 60000 });
  expect((await basemapState(page)).active).toBe('osm-tiles');
  expect(ofm).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem('civgraph.basemapFailedProviders'))).toBeNull();
});
