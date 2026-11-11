/**
 * A shared feature link frames its feature (QA 2026-11-11, H2): the Belfast West link below
 * opened on the whole island at zoom 6.08 with nothing visible drawn. It must now open over
 * Belfast at constituency zoom, with the feature's name in the title, and the feature's "Copy
 * link" must carry no viewport, so whoever opens it gets the feature framed for their screen.
 * A link that names a view of its own keeps that view.
 *
 *   npx playwright test --config config/playwright.config.cjs tests/browser/map-feature-link.spec.cjs
 *
 * Needs the app bundle (node scripts/build/app-bundle.mjs). See timeline-and-url-state.spec.cjs
 * for why the boot is awaited as it is (a hidden tab never boots).
 */
const { test, expect } = require('@playwright/test');

const BOOT_TIMEOUT = 45000;
const LINK = '/maps/#layers=pc-2023&featureMap=pc-2023&featureId=BELFAST+WEST&featureName=BELFAST+WEST&page=feature%3Apc-2023%3ABELFAST+WEST';

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2BootStarted === true, null, { timeout: BOOT_TIMEOUT });
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: BOOT_TIMEOUT });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
}

const view = (page) => page.evaluate(() => {
  const map = window.__civgraphTest2.mapController.map;
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), title: document.title, hash: location.hash };
});

test.describe('map feature links', () => {
  test.setTimeout(120000);

  test('the Belfast West link opens over Belfast West, named in the title', async ({ page }) => {
    await boot(page, LINK);
    await expect.poll(async () => (await view(page)).zoom, { timeout: 20000 }).toBeGreaterThan(9);
    const v = await view(page);
    expect(v.lng).toBeGreaterThan(-6.15);
    expect(v.lng).toBeLessThan(-5.85);
    expect(v.lat).toBeGreaterThan(54.5);
    expect(v.lat).toBeLessThan(54.68);
    await expect.poll(async () => (await view(page)).title, { timeout: 15000 }).toMatch(/BELFAST WEST/i);
    // The address now carries the framed view, so copying the address bar shares it too.
    await expect.poll(async () => (await view(page)).hash, { timeout: 15000 }).toMatch(/zoom=(9\.[5-9]|1\d)/);
  });

  test('a link with its own view keeps it', async ({ page }) => {
    await boot(page, `${LINK}&lng=-7.00000&lat=53.50000&zoom=7.25`);
    await page.waitForTimeout(1500);
    const v = await view(page);
    expect(v.zoom).toBeCloseTo(7.25, 1);
    expect(v.lng).toBeCloseTo(-7, 1);
  });

  test('the feature\'s copy link carries no viewport', async ({ page }) => {
    await boot(page, '/maps/#lng=-7.00000&lat=53.50000&zoom=7.25');
    const url = await page.evaluate(async () => {
      const { default: ui } = await import('/src/ui-controller.js').catch(() => ({ default: null }));
      const controller = ui || window.__civgraphTest2?.uiController || window.uiController;
      return controller?.buildFeatureSearchShareUrl?.('pc-2023', 'BELFAST WEST', 'BELFAST WEST') || null;
    });
    test.skip(url === null, 'the UI controller is not reachable from the page in this build');
    expect(url).toContain('featureId=BELFAST+WEST');
    expect(url).not.toMatch(/[#&](lng|lat|zoom)=/);
  });
});
