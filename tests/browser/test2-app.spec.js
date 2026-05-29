const { test, expect } = require('@playwright/test');

test('/test2 boots the production shell with the MapLibre adapter', async ({ page }) => {
  await page.goto('/test2/');
  await expect(page.getByRole('link', { name: 'Civgraph' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('body.app-shell')).toBeVisible();
  await expect(page.locator('.app-main .pane--info')).toBeVisible();
  await expect(page.locator('.app-main .pane--map')).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#catalogueFlatView')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const state = await page.evaluate(() => ({
    hasMapLibre: Boolean(window.__civgraphTest2.mapController.map),
    layerCount: window.__civgraphTest2.metadataService.layers.length,
    rows: document.querySelectorAll('#catalogueFlatView table tr').length,
    hasLeaflet: Boolean(window.L)
  }));
  expect(state.hasMapLibre).toBe(true);
  expect(state.layerCount).toBeGreaterThan(10);
  expect(state.rows).toBeGreaterThan(10);
  expect(state.hasLeaflet).toBe(false);
});

test('/test2 loads a converted layer through the main catalogue map callback', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const result = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const layer = window.__civgraphTest2.metadataService.getLayer('civil-parishes-vector-test');
    if (layer?.tilesFallback) {
      layer.sourceType = 'mvt';
      layer.tiles = layer.tilesFallback;
    }
    await app.loadMap('civil-parishes-by-province');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
    const renderedLayers = [
      'civil-parishes-vector-test-fill',
      'civil-parishes-vector-test-line',
      'civil-parishes-vector-test-label'
    ].filter((id) => window.__civgraphTest2.mapController.map.getLayer(id));
    return {
      loaded: app.mapController.isLayerLoaded('civil-parishes-by-province'),
      visible: app.mapController.isLayerVisible('civil-parishes-by-province'),
      features: window.__civgraphTest2.mapController.map.queryRenderedFeatures({ layers: renderedLayers }).length,
      canvasWidth: window.__civgraphTest2.mapController.map.getCanvas().width
    };
  });
  expect(result.loaded).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.features).toBeGreaterThan(0);
  expect(result.canvasWidth).toBeGreaterThan(100);
});
