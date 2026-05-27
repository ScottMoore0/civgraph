const { test, expect } = require('@playwright/test');

test('/test shell starts with main navigation and diagnostics', async ({ page }) => {
  await page.goto('/test/');
  await expect(page.getByRole('link', { name: 'Civgraph home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MapLibre Test' })).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#diagnostics')).toContainText('test-012');
});

test('/test restores URL layer and style state', async ({ page }) => {
  await page.goto('/test/#layers=roi-garda-regions-vector-test&style=roi-garda-regions-vector-test:categorical&styleAttr=roi-garda-regions-vector-test:REGION&lng=-8.05&lat=53.4&z=6');
  await page.waitForFunction(() => window.__civgraphTest?.controller?.layers?.has('roi-garda-regions-vector-test'));
  await expect(page.locator('#activeLayers')).toContainText('Garda Regions');
  await expect(page.locator('#activeLayers')).toContainText('REGION categories');
  await expect(page.locator('#sourcePanel')).toContainText('Garda Regions');
});

test('/test shows PMTiles fallback warning when archive fetch fails', async ({ page }) => {
  await page.route('https://data.civgraph.net/data/maps/test/pmtiles/generated/civil-parishes-vector-test.pmtiles', (route) => route.abort());
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await page.evaluate(async () => {
    const app = window.__civgraphTest;
    await app.controller.loadLayer(app.metadataService.getLayer('civil-parishes-vector-test'));
  });
  await expect(page.locator('#fallbackAlerts')).toContainText('PMTiles failed', { timeout: 12000 });
});

test('/test mobile catalogue toggle is keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/');
  const toggle = page.locator('#sidebarToggle');
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/test-sidebar-open/);
});
