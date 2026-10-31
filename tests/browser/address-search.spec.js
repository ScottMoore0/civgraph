const { test, expect } = require('@playwright/test');

/**
 * Address search in the map's search box (src/catalogue/geocoder.js), with every outside service
 * mocked: Photon as you type, postcodes.io for BT postcodes, and Nominatim only on Enter, once,
 * after Photon has turned us away. Nominatim's usage policy forbids autocomplete, so the last
 * test types a whole address a key at a time and requires no Nominatim request at all.
 */

test.use({ serviceWorkers: 'block' });

const PHOTON = /photon\.komoot\.io\/api/;
const NOMINATIM = /nominatim\.openstreetmap\.org/;
const POSTCODES = /api\.postcodes\.io/;

const photonBody = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-5.9301, 54.5964] }, properties: { name: 'Belfast City Hall', street: 'Donegall Square North', city: 'Belfast', county: 'County Antrim', postcode: 'BT1 5GS' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-5.9312, 54.5958] }, properties: { street: 'Donegall Square South', city: 'Belfast' } },
  ],
};

async function boot(page) {
  await page.goto('/maps/');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  const intro = page.locator('.catalogue-intro__close');
  if (await intro.isVisible().catch(() => false)) await intro.click({ timeout: 3000 }).catch(() => {});
}

/** Record the outside requests a test makes; Photon and postcodes.io answer as given. */
async function mockServices(page, { photon = () => ({ status: 200, json: photonBody }), postcodes = null } = {}) {
  const calls = { photon: [], nominatim: [], postcodes: [] };
  await page.route(PHOTON, async (route) => {
    calls.photon.push(route.request().url());
    const { status, json } = photon(route.request().url());
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json || {}) });
  });
  await page.route(NOMINATIM, async (route) => {
    calls.nominatim.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { name: 'Royal Avenue', display_name: 'Royal Avenue, Cathedral Quarter, Belfast, County Antrim, Northern Ireland', lat: '54.6008', lon: '-5.9306' },
    ]) });
  });
  await page.route(POSTCODES, async (route) => {
    calls.postcodes.push(route.request().url());
    const body = postcodes ? postcodes(route.request().url()) : null;
    await route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body || { status: 404, error: 'Postcode not found' }) });
  });
  return calls;
}

test('typing an address suggests places from Photon, limited to Ireland, and choosing one flies there with a marker', async ({ page }) => {
  const calls = await mockServices(page);
  await boot(page);
  await page.fill('#searchInput', 'Donegall Square');
  const block = page.locator('.cn-block--addresses');
  await expect(block).toBeVisible({ timeout: 15000 });
  await expect(block.locator('.cn-address__name')).toHaveText(['Belfast City Hall', 'Donegall Square South']);
  await expect(block.locator('.cn-address-credit')).toContainText('OpenStreetMap contributors');
  await expect(block.locator('.cn-address-credit')).toContainText('Photon');

  const url = new URL(calls.photon.at(-1));
  expect(url.searchParams.get('q')).toBe('Donegall Square');
  expect(url.searchParams.get('lang')).toBe('en');
  expect(url.searchParams.get('bbox')).toBe('-10.7,51.3,-5.3,55.5');
  expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(8);
  expect(url.toString()).not.toMatch(/%40|@/);

  await block.locator('.cn-address').first().click();
  await page.waitForFunction(() => Boolean(window.__civgraphTest2.mapController.addressMarker));
  await expect.poll(() => page.evaluate(() => {
    const c = window.__civgraphTest2.mapController.map.getCenter();
    return Math.abs(c.lng + 5.9301) < 0.01 && Math.abs(c.lat - 54.5964) < 0.01;
  }), { timeout: 15000 }).toBe(true);
  expect(calls.nominatim).toEqual([]);
});

test('a BT postcode is looked up at postcodes.io, whole or by its outward code', async ({ page }) => {
  const calls = await mockServices(page, {
    postcodes: (url) => (url.includes('/postcodes/')
      ? { status: 200, result: { postcode: 'BT7 1NN', latitude: 54.5843, longitude: -5.9346, admin_district: 'Belfast', admin_ward: 'Botanic' } }
      : { status: 200, result: { outcode: 'BT7', latitude: 54.578, longitude: -5.925, admin_district: ['Belfast'] } }),
  });
  await boot(page);
  await page.fill('#searchInput', 'BT7 1NN');
  const block = page.locator('.cn-block--addresses');
  await expect(block.locator('.cn-address__name')).toHaveText(['BT7 1NN'], { timeout: 15000 });
  await expect(block.locator('.cn-address-credit')).toContainText('postcodes.io');
  expect(calls.postcodes.at(-1)).toMatch(/\/postcodes\/BT7%201NN$/);

  await page.fill('#searchInput', 'BT7');
  await expect(block.locator('.cn-address__name')).toHaveText(['BT7 postcode district'], { timeout: 15000 });
  expect(calls.postcodes.at(-1)).toMatch(/\/outcodes\/BT7$/);
  expect(calls.nominatim).toEqual([]);
});

test('a 429 from Photon pauses suggestions: the box says press Enter, and Enter makes one Nominatim search', async ({ page }) => {
  const calls = await mockServices(page, { photon: () => ({ status: 429, json: { message: 'Too many requests' } }) });
  await boot(page);
  await page.fill('#searchInput', 'Royal Avenue');
  await expect(page.locator('.cn-address-note')).toContainText('press Enter', { timeout: 15000 });
  expect(await page.evaluate(() => Number(sessionStorage.getItem('civgraph.addressSuggestionsPausedUntil')) > Date.now())).toBe(true);

  // Further typing asks neither service.
  const photonBefore = calls.photon.length;
  await page.locator('#searchInput').pressSequentially(' Belfast', { delay: 60 });
  await page.waitForTimeout(800);
  expect(calls.photon.length).toBe(photonBefore);
  expect(calls.nominatim).toEqual([]);

  await page.locator('#searchInput').press('Enter');
  const block = page.locator('.cn-block--addresses');
  await expect(block.locator('.cn-address__name')).toHaveText(['Royal Avenue'], { timeout: 15000 });
  await expect(block.locator('.cn-address-credit')).toContainText('Nominatim');
  expect(calls.nominatim.length).toBe(1);
  const url = new URL(calls.nominatim[0]);
  expect(url.searchParams.get('q')).toBe('Royal Avenue Belfast');
  expect(url.searchParams.get('format')).toBe('jsonv2');
  expect(url.searchParams.get('countrycodes')).toBe('gb,ie');
  expect(url.searchParams.get('viewbox')).toBe('-10.7,55.5,-5.3,51.3');
  expect(url.searchParams.get('bounded')).toBe('1');
  expect(url.searchParams.get('limit')).toBe('6');
  expect(url.toString()).not.toMatch(/%40|@|email/i);
});

test('typing never sends a request to Nominatim', async ({ page }) => {
  const calls = await mockServices(page);
  await boot(page);
  await page.locator('#searchInput').pressSequentially('12 Botanic Avenue Belfast', { delay: 90 });
  await expect(page.locator('.cn-block--addresses')).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
  expect(calls.photon.length).toBeGreaterThan(0);
  // The box's debounce collapses a key-by-key address into a few requests, not one per key.
  expect(calls.photon.length).toBeLessThan(12);
  expect(calls.nominatim).toEqual([]);
});
