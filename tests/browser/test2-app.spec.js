const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function loadCivilParishes(page) {
  return page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const layer = window.__civgraphTest2.metadataService.getLayer('civil-parishes-vector-test');
    if (layer?.tilesFallback) {
      layer.sourceType = 'mvt';
      layer.tiles = layer.tilesFallback;
    }
    await app.loadMap('civil-parishes-by-province');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
    return true;
  });
}

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
  await loadCivilParishes(page);
  const result = await page.evaluate(async () => {
    const renderedLayers = [
      'civil-parishes-vector-test-fill',
      'civil-parishes-vector-test-line',
      'civil-parishes-vector-test-label'
    ].filter((id) => window.__civgraphTest2.mapController.map.getLayer(id));
    return {
      loaded: window.__civgraphTest2.app.mapController.isLayerLoaded('civil-parishes-by-province'),
      visible: window.__civgraphTest2.app.mapController.isLayerVisible('civil-parishes-by-province'),
      features: window.__civgraphTest2.mapController.map.queryRenderedFeatures({ layers: renderedLayers }).length,
      canvasWidth: window.__civgraphTest2.mapController.map.getCanvas().width
    };
  });
  expect(result.loaded).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.features).toBeGreaterThan(0);
  expect(result.canvasWidth).toBeGreaterThan(100);
});

test('/test2 supports catalogue detail, unsupported notices, and URL restore', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.locator('#searchInput').fill('civil parishes');
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalogueFlatView')).toContainText('Civil Parishes');
  await page.evaluate(async () => window.__civgraphTest2.app.loadMap('civil-parishes-by-province'));
  await expect(page).toHaveURL(/layers=civil-parishes-by-province/);
  await page.reload();
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.isLayerLoaded('civil-parishes-by-province'));
  await expect(page.locator('#catalogueFlatView')).toContainText('Civil Parishes');

  const message = await page.evaluate(async () => {
    const layer = window.__civgraphTest2.metadataService.layers.find((item) => item.loadable === false && item.sourceMapId);
    try {
      await window.__civgraphTest2.app.loadMap(layer.sourceMapId);
      return '';
    } catch (error) {
      window.__civgraphTest2.app.showMapError(error);
      return error.message;
    }
  });
  expect(message).toMatch(/not converted|not yet converted/i);
  await expect(page.locator('#test2Status')).toContainText(/converted/i);
});

test('/test2 MapLibre controls handle opacity, labels, feature details, and active layers', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await loadCivilParishes(page);
  await page.locator('#mapControlsToggle').click();
  await expect(page.locator('#mapControlPanel')).toHaveClass(/map-control-panel--expanded/);
  await page.locator('#transparencySlider').fill('35');
  await page.locator('#fillTransparencySlider').fill('65');
  await page.locator('#labelsToggle').uncheck();
  const paints = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    return {
      lineOpacity: map.getPaintProperty('civil-parishes-vector-test-line', 'line-opacity'),
      fillOpacity: map.getPaintProperty('civil-parishes-vector-test-fill', 'fill-opacity'),
      labelsVisibility: map.getLayoutProperty('civil-parishes-vector-test-label', 'visibility')
    };
  });
  expect(Number(paints.lineOpacity)).toBeCloseTo(0.65, 1);
  expect(Number(paints.fillOpacity)).toBeCloseTo(0.35, 1);
  expect(paints.labelsVisibility).toBe('none');

  await page.locator('#activeLayersToggle').click();
  await expect(page.locator('#activeLayers')).toBeVisible();
  await expect(page.locator('#activeLayersList')).toContainText('Civil Parishes');

  const selected = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const feature = map.queryRenderedFeatures({
      layers: ['civil-parishes-vector-test-fill', 'civil-parishes-vector-test-line'].filter((id) => map.getLayer(id))
    })[0];
    const id = feature?.id ?? feature?.properties?.id;
    if (id === undefined || id === null) return false;
    return window.__civgraphTest2.mapController.renderer.selectFeatureById(
      'civil-parishes-vector-test',
      id,
      feature.properties
    );
  });
  expect(selected).toBe(true);
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).toContainText(/Civil Parishes|Parish|Name/i);
});

test('/test2 mobile shell, support modal, theme toggle, and accessibility smoke pass', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  await page.locator('#mobileSupportBtn').click();
  await expect(page.locator('#supportModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#supportModal')).toBeHidden();
  await page.evaluate(() => document.getElementById('themeToggle')?.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('/test2 does not register the production service worker', async ({ page }) => {
  await page.addInitScript(() => {
    window.__registeredServiceWorkers = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async (url) => {
          window.__registeredServiceWorkers.push(url);
          return {};
        }
      }
    });
  });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await expect.poll(() => page.evaluate(() => window.__registeredServiceWorkers)).toEqual([]);
});
