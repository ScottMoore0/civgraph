const { test, expect } = require('@playwright/test');
const path = require('node:path');

/**
 * Approximate boundary stretches (boundary audit, 7 Nov 2026). An edition whose metadata carries
 * approximateSegments draws its segment file dotted over its own line and names it in the legend; an
 * edition without the field draws nothing extra.
 *
 * The segment files live on R2 (data/maps/approximate/), so the request is answered here from a small
 * fixture: the test is about the drawing, not about whether the upload has happened.
 */

test.use({ serviceWorkers: 'block' });
test.setTimeout(120000);

const FIXTURE = path.join(__dirname, 'fixtures', 'approximate-segments-sample.geojson');

async function boot(page) {
  await page.route('**/data/maps/approximate/**', (route) => route.fulfill({ path: FIXTURE, contentType: 'application/geo+json' }));
  await page.goto('/maps/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
}

async function open(page, mapId) {
  await page.evaluate(async (id) => { await window.__civgraphTest2.app.loadMap(id); }, mapId);
  return page.evaluate((id) => window.__civgraphTest2.app.mapController.mainToTest.get(id) || id, mapId);
}

const approxState = (page, testId) => page.evaluate((lid) => {
  const map = window.__civgraphTest2.app.mapController.map;
  const source = map.getSource(`${lid}-approx-source`);
  return {
    gap: Boolean(map.getLayer(`${lid}-approx-gap`)),
    line: Boolean(map.getLayer(`${lid}-approx`)),
    dash: map.getLayer(`${lid}-approx`) ? map.getPaintProperty(`${lid}-approx`, 'line-dasharray') : null,
    hasSource: Boolean(source)
  };
}, testId);

test('an edition with approximate stretches draws them dotted and names them in the legend', async ({ page }) => {
  await boot(page);
  const testId = await open(page, 'stormont-1969');
  await expect.poll(() => approxState(page, testId).then((s) => s.line && s.gap && s.hasSource), { timeout: 30000 }).toBe(true);
  const state = await approxState(page, testId);
  expect(state.dash).toBeTruthy();
  await page.waitForFunction((lid) => {
    const map = window.__civgraphTest2.app.mapController.map;
    return map.isSourceLoaded(`${lid}-approx-source`) && map.querySourceFeatures(`${lid}-approx-source`).length > 0;
  }, testId, { timeout: 30000 });
  const legend = page.locator('#test2MapLegend');
  await expect(legend).toContainText('Approximate boundary');
  await expect(legend).toContainText('Some lines on this map are approximate');
});

test('an edition without approximate stretches draws no dotted layer', async ({ page }) => {
  await boot(page);
  const testId = await open(page, 'stormont-1929');
  await page.waitForFunction((lid) => Boolean(window.__civgraphTest2.app.mapController.map.getLayer(`${lid}-line`)), testId, { timeout: 30000 });
  const state = await approxState(page, testId);
  expect(state).toEqual({ gap: false, line: false, dash: null, hasSource: false });
  // A single map with no approximate stretches has no legend at all, so look for the entry itself.
  await expect(page.locator('[data-approximate-legend]')).toHaveCount(0);
});
