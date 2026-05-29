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
  await page.waitForFunction(() => document.querySelectorAll('#catalogueFlatView table tr').length > 10);
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

test('/test2 boots centred on Ireland when URL has no viewport state', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  const camera = await page.evaluate(() => {
    const center = window.__civgraphTest2.mapController.map.getCenter();
    return {
      lng: center.lng,
      lat: center.lat,
      zoom: window.__civgraphTest2.mapController.map.getZoom()
    };
  });
  expect(camera.lng).toBeGreaterThan(-12);
  expect(camera.lng).toBeLessThan(-4);
  expect(camera.lat).toBeGreaterThan(50);
  expect(camera.lat).toBeLessThan(56);
  expect(camera.zoom).toBeGreaterThan(4);
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
  expect(new URL(page.url()).pathname).toBe('/test2/');
});

test('/test2 supports catalogue detail, unsupported notices, and URL restore', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.locator('#searchInput').fill('civil parishes');
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalogueFlatView')).toContainText('Civil Parishes');
  await page.evaluate(async () => window.__civgraphTest2.app.loadMap('civil-parishes-by-province'));
  await expect(page).toHaveURL(/layers=civil-parishes-by-province/);
  expect(new URL(page.url()).pathname).toBe('/test2/');
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

test('/test2 hash-only shell links and legacy hash writers preserve the test2 path', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);

  await page.locator('a[href="#flat-section-maps"]').first().click();
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#flat-section-maps$/);

  await page.evaluate(() => history.replaceState(null, '', '#manual-hash-state'));
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#manual-hash-state$/);

  await page.evaluate(() => history.pushState(null, '', '#manual-push-state'));
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#manual-push-state$/);
});

test('/test2 MapLibre controls handle opacity, labels, feature details, and active layers', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await loadCivilParishes(page);
  await expect(page.locator('.maplibre-dom-label:not([hidden])').first()).toBeVisible();
  const labelState = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.maplibre-dom-label:not([hidden])')];
    return {
      count: labels.length,
      uniqueFeatureIds: new Set(labels.map((label) => `${label.dataset.layerId}:${label.dataset.featureId}`)).size,
      nativeLabelOpacity: window.__civgraphTest2.mapController.map.getPaintProperty('civil-parishes-vector-test-label', 'text-opacity')
    };
  });
  expect(labelState.count).toBeGreaterThan(0);
  expect(labelState.uniqueFeatureIds).toBe(labelState.count);
  expect(labelState.nativeLabelOpacity).toBe(0);

  const firstLabel = page.locator('.maplibre-dom-label:not([hidden])').first();
  const firstLabelText = await firstLabel.textContent();
  await firstLabel.hover();
  await expect(firstLabel).toHaveClass(/map-label--hover/);
  const hoverState = await firstLabel.evaluate((label) => {
    const app = window.__civgraphTest2;
    const id = label.dataset.featureId;
    const labelStyle = getComputedStyle(label.querySelector('div'));
    return {
      color: labelStyle.color,
      decoration: labelStyle.textDecorationLine,
      textShadow: labelStyle.textShadow,
      fillColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-hover', 'fill-color'),
      strokeColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-hover-line', 'line-color'),
      featureHover: app.mapController.map.getFeatureState({
        source: 'civil-parishes-vector-test-source',
        sourceLayer: app.metadataService.getLayer('civil-parishes-vector-test').sourceLayer,
        id
      }).hover === true
    };
  });
  expect(hoverState.color).toBe('rgb(255, 122, 26)');
  expect(hoverState.decoration).toContain('underline');
  expect(hoverState.textShadow).toContain('rgb(255, 255, 255)');
  expect(hoverState.textShadow).not.toContain('255, 122, 26');
  expect(hoverState.fillColor).toBe('#FDBA74');
  expect(hoverState.strokeColor).toBe('#FF7A1A');
  expect(hoverState.featureHover).toBe(true);

  await firstLabel.click();
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(firstLabel).toHaveClass(/map-label--selected/);
  await expect(page.locator('#featureInfoContent')).toContainText(/Civil Parishes|Parish|Name/i);
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
  await expect(page.locator('#featureInfoContent .feature-info__primary-name').first()).toContainText(firstLabelText.trim());
  const selectedStyle = await firstLabel.evaluate((label) => {
    const app = window.__civgraphTest2;
    const id = label.dataset.featureId;
    const labelStyle = getComputedStyle(label.querySelector('div'));
    return {
      labelColor: labelStyle.color,
      labelDecoration: labelStyle.textDecorationLine,
      fillColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected-fill', 'fill-color'),
      fillOpacity: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected-fill', 'fill-opacity'),
      strokeColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected', 'line-color'),
      strokeWidth: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected', 'line-width'),
      featureSelected: app.mapController.map.getFeatureState({
        source: 'civil-parishes-vector-test-source',
        sourceLayer: app.metadataService.getLayer('civil-parishes-vector-test').sourceLayer,
        id
      }).selected === true
    };
  });
  expect(selectedStyle.labelColor).toBe('rgb(255, 122, 26)');
  expect(selectedStyle.labelDecoration).toContain('underline');
  expect(selectedStyle.fillColor).toBe('#FDBA74');
  expect(selectedStyle.fillOpacity).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], 0.42, 0]);
  expect(selectedStyle.strokeColor).toBe('#FF7A1A');
  expect(selectedStyle.strokeWidth).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], 3, 0]);
  expect(selectedStyle.featureSelected).toBe(true);
  const featureCardPosition = await page.evaluate(() => {
    const mapPane = document.querySelector('.pane--map').getBoundingClientRect();
    const card = document.getElementById('featureInfo').getBoundingClientRect();
    return {
      topDelta: card.top - mapPane.top,
      rightDelta: mapPane.right - card.right
    };
  });
  expect(featureCardPosition.topDelta).toBeGreaterThanOrEqual(0);
  expect(featureCardPosition.topDelta).toBeLessThan(40);
  expect(featureCardPosition.rightDelta).toBeGreaterThanOrEqual(0);
  expect(featureCardPosition.rightDelta).toBeLessThan(40);

  const target = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const feature = map.queryRenderedFeatures({
      layers: ['civil-parishes-vector-test-fill'].filter((id) => map.getLayer(id))
    })[0];
    const coords = [];
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coords.push([value[0], value[1]]);
        return;
      }
      value.forEach(walk);
    };
    walk(feature?.geometry?.coordinates);
    const lng = coords.reduce((sum, coord) => sum + coord[0], 0) / coords.length;
    const lat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
    const point = map.project([lng, lat]);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await page.locator('#featureInfoClose').click();
  await expect(page.locator('#featureInfo')).toBeHidden();
  await page.mouse.dblclick(target.x, target.y);
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');

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
      labelsVisibility: map.getLayoutProperty('civil-parishes-vector-test-label', 'visibility'),
      domLabelsHidden: [...document.querySelectorAll('.maplibre-dom-label')].every((label) => label.hidden)
    };
  });
  expect(Number(paints.lineOpacity)).toBeCloseTo(0.65, 1);
  expect(Number(paints.fillOpacity)).toBeCloseTo(0.35, 1);
  expect(paints.labelsVisibility).toBe('none');
  expect(paints.domLabelsHidden).toBe(true);

  await page.locator('#featureInfoClose').click();
  await expect(page.locator('#featureInfo')).toBeHidden();
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
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
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
