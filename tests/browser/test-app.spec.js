const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function openMapTools(page) {
  await page.locator('#mapControlPanel').evaluate((node) => {
    node.classList.remove('map-control-panel--collapsed');
    node.setAttribute('aria-hidden', 'false');
    document.getElementById('mapControlsToggle')?.setAttribute('aria-expanded', 'true');
  });
}

test('/test shell starts with main navigation and diagnostics', async ({ page }) => {
  await page.goto('/test/');
  await expect(page.getByRole('link', { name: 'Civgraph home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'About', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MapLibre Test', exact: true })).toHaveCount(0);
  await expect(page.locator('#map')).toBeVisible();
  await openMapTools(page);
  await expect(page.locator('#diagnostics')).toContainText('test-020');
  await expect(page.locator('#diagnostics')).toContainText('Production Readiness');
  await expect(page.locator('#diagnostics')).toContainText('CI guardrails');
  await expect(page.locator('#diagnostics')).toContainText('Deployment Discipline');
  await expect(page.locator('#diagnostics')).toContainText('Browser resources');
  const initialCenter = await page.evaluate(() => window.__civgraphTest.controller.map.getCenter().toArray());
  expect(initialCenter[0]).toBeGreaterThan(-11);
  expect(initialCenter[0]).toBeLessThan(-5);
  expect(initialCenter[1]).toBeGreaterThan(51);
  expect(initialCenter[1]).toBeLessThan(56);
});

test('/test catalogue supports grouped detail navigation and shared unconverted entries', async ({ page }) => {
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await expect(page.locator('.catalogue-flat__toc-table .catalogue-flat__toc-row').first()).toBeVisible();
  await expect(page.locator('#categoryPills')).toContainText('All');
  await expect(page.locator('#catalogueFlatView')).toHaveAttribute('data-view', 'compact');
  await expect(page.locator('#catalogueView')).toHaveValue('compact');
  await expect(page.locator('.catalogue-toolbar')).toBeHidden();
  const unconvertedId = await page.evaluate(() => window.__civgraphTest.metadataService.layers.find((layer) => layer.loadable === false || layer.isConverted === false)?.id);
  expect(unconvertedId).toBeTruthy();
  await page.evaluate((id) => window.__civgraphTest.catalogue.showDetail(id), unconvertedId);
  await expect(page.locator('#catalogueDetailView')).toBeVisible();
  await expect(page.locator('#catalogueDetailView')).toContainText('Not yet converted');
  await expect(page.locator('#catalogueDetailView')).toContainText('References');
  await expect(page.locator('#catalogueDetailView')).toContainText('Source files');
  await expect(page).toHaveURL(/catalogue=/);
  await page.locator('#catalogueHistory').click();
  await expect(page.locator('#catalogueHistoryPanel')).toContainText('Catalogue home');
  await page.locator('#catalogueBack').click();
  await expect(page.locator('#catalogueFlatView')).toBeVisible();
});

test('/test loads and renders a real MapLibre vector layer', async ({ page }) => {
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  const result = await page.evaluate(async () => {
    const app = window.__civgraphTest;
    const layer = app.metadataService.getLayer('civil-parishes-vector-test');
    await app.controller.loadLayer(layer);
    await new Promise((resolve) => app.controller.map.once('idle', resolve));
    const renderedLayers = ['civil-parishes-vector-test-fill', 'civil-parishes-vector-test-line', 'civil-parishes-vector-test-label']
      .filter((id) => app.controller.map.getLayer(id));
    return {
      center: app.controller.map.getCenter().toArray(),
      activeLayers: [...app.controller.layers.keys()],
      renderedFeatureCount: app.controller.map.queryRenderedFeatures({ layers: renderedLayers }).length,
      canvas: {
        width: app.controller.map.getCanvas().width,
        height: app.controller.map.getCanvas().height
      }
    };
  });
  expect(result.activeLayers).toContain('civil-parishes-vector-test');
  expect(result.renderedFeatureCount).toBeGreaterThan(0);
  expect(result.canvas.width).toBeGreaterThan(100);
  expect(result.canvas.height).toBeGreaterThan(100);
  expect(result.center[0]).toBeGreaterThan(-11);
  expect(result.center[0]).toBeLessThan(-5);
  expect(result.center[1]).toBeGreaterThan(51);
  expect(result.center[1]).toBeLessThan(56);
});

test('/test supports keyboard shortcuts and accessibility smoke flow', async ({ page }) => {
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  const accessibilityScanResults = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(accessibilityScanResults.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await expect(page.locator('#diagnostics')).toContainText('Accessibility Smoke');
  await expect(page.locator('#diagnostics')).toContainText('Axe-style checks');
  await expect(page.locator('#diagnostics')).toContainText('Screen-reader pass');
  await page.keyboard.press('/');
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.keyboard.type('garda');
  await expect(page).toHaveURL(/q=garda/);
  await page.keyboard.press('Escape');
  await page.locator('#map').click();
  await page.keyboard.press('c');
  await expect(page.locator('body')).toHaveClass(/test-sidebar-open/);
  await page.locator('#map').click();
  await page.keyboard.press('s');
  await expect(page.locator('#mapControlPanel')).not.toHaveClass(/map-control-panel--collapsed/);
  await expect(page.locator('#sourceFilter')).toBeFocused();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('d');
  await expect(page.locator('#mapControlPanel')).not.toHaveClass(/map-control-panel--collapsed/);
  await expect(page.locator('#diagnosticsSeverity')).toBeFocused();
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('?');
  await expect(page.locator('#toast')).toContainText('Shortcuts');
});

test('/test handles clipboard failures and preference import/export/reset', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('blocked clipboard'); } }
    });
  });
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await openMapTools(page);
  await page.locator('#copyDiagnostics').click();
  await expect(page.locator('#toast')).toContainText('Diagnostics copy failed');
  await page.locator('#preferencesExport').click();
  await expect(page.locator('#preferencesPayload')).toHaveValue(/"schemaVersion"/);
  await expect(page.locator('#preferencesStatus')).toContainText('Clipboard copy failed');
  await page.locator('#preferencesPayload').fill(JSON.stringify({
    values: {
      theme: 'dark',
      'civgraph.test.catalogue.preferences': JSON.stringify({ viewMode: 'table', sortMode: 'name' })
    }
  }));
  await page.locator('#preferencesImport').click();
  await expect(page.locator('#preferencesStatus')).toContainText('Imported');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await page.locator('#preferencesProfileName').fill('Browser profile');
  await page.locator('#preferencesSaveProfile').click();
  await expect(page.locator('#preferencesStatus')).toContainText('Saved preference profile');
  await page.locator('#preferencesProfileSelect').selectOption('Browser profile');
  await page.locator('#preferencesApplyProfile').click();
  await expect(page.locator('#preferencesStatus')).toContainText('Applied profile');
  await page.locator('#preferencesResetShell').click();
  await expect(page.locator('#preferencesStatus')).toContainText('shell preference');
  await page.locator('#preferencesResetCatalogue').click();
  await expect(page.locator('#preferencesStatus')).toContainText('catalogue preference');
  await page.locator('#preferencesResetLayers').click();
  await expect(page.locator('#preferencesStatus')).toContainText('layer/style preference');
  await page.locator('#preferencesReset').click();
  await expect(page.locator('#preferencesStatus')).toContainText('Reset');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe(null);
});

test('/test restores collapsed panels from URL and honours reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/test/#panelsCollapsed=catalogue%7Csources&sidebar=1');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await expect(page.locator('[data-panel="sources"]')).toHaveClass(/test-panel--collapsed/);
  const duration = await page.locator('#testSidebar').evaluate((node) => getComputedStyle(node).transitionDuration);
  const durationsMs = duration.split(',').map((value) => {
    const trimmed = value.trim();
    return trimmed.endsWith('ms') ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
  });
  expect(durationsMs.every((value) => Number.isFinite(value) && value <= 1)).toBeTruthy();
});

test('/test support modal and theme toggle match main shell behaviour', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/test/');
  await page.locator('#supportBtn').click();
  await expect(page.locator('#supportModal')).toBeVisible();
  await expect(page.locator('#supportModal')).toContainText('Support Civgraph');
  await page.keyboard.press('Escape');
  await expect(page.locator('#supportModal')).toBeHidden();
  await page.locator('#themeToggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#themeToggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('/test catalogue URL restores detail, search, filters, and sidebar state', async ({ page }) => {
  await page.goto('/test/#catalogue=port-east-west-bann&q=bann&category=Regional+Divides&provider=OSNI%2C+Scott+Moore&sidebar=1&catView=table&catSort=provider&sourceQ=garda&diagSeverity=warn&panel=sources');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await openMapTools(page);
  await expect(page.locator('body')).toHaveClass(/test-sidebar-open/);
  await expect(page.locator('#searchInput')).toHaveValue('bann');
  await expect(page.locator('#catalogueView')).toHaveValue('table');
  await expect(page.locator('#catalogueSort')).toHaveValue('provider');
  await expect(page.locator('#sourceFilter')).toHaveValue('garda');
  await expect(page.locator('#diagnosticsSeverity')).toHaveValue('warn');
  await page.locator('#diagnosticsType').selectOption('large-tile');
  await expect(page).toHaveURL(/diagType=large-tile/);
  await page.locator('#diagnosticsClearHistory').click();
  await expect(page.locator('#toast')).toContainText('Diagnostics history cleared');
  await expect(page.locator('#catalogueDetailView')).toContainText('East and West of the Bann');
  await expect(page.locator('#categoryPills')).toContainText('Regional Divides');
});

test('/test restores URL layer and style state', async ({ page }) => {
  await page.goto('/test/#layers=roi-garda-regions-vector-test&style=roi-garda-regions-vector-test:categorical&styleAttr=roi-garda-regions-vector-test:REGION&lng=-8.05&lat=53.4&z=6');
  await page.waitForFunction(() => window.__civgraphTest?.controller?.layers?.has('roi-garda-regions-vector-test'));
  await openMapTools(page);
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
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/');
  const menu = page.locator('#mobileMenuBtn');
  await expect(menu).toBeVisible();
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mobileMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#mobileMenu')).toBeHidden();
  await page.locator('#mobileSupportBtn').click();
  await expect(page.locator('#supportModal')).toBeVisible();
  await page.keyboard.press('Escape');
  const toggle = page.locator('#sidebarToggle');
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/test-sidebar-open/);
});

test('/test source panel and feature details expose copy/context controls', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { window.__copiedText = value; } }
    });
  });
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await page.evaluate(async () => {
    const app = window.__civgraphTest;
    const layer = app.metadataService.getLayer('roi-garda-regions-vector-test');
    await app.controller.loadLayer(layer);
    app.controller.selectFeatureById(layer.id, 'browser-test-feature', {
      id: 'browser-test-feature',
      REGION: 'Eastern',
      source_file: 'browser-test-source.fgb',
      objectid: 42,
      area: 123.456
    });
  });
  await openMapTools(page);
  await expect(page.locator('#sourcePanel')).toContainText('Garda Regions');
  await expect(page.locator('#sourcePanel [data-copy-link]').first()).toBeVisible();
  await page.locator('#sourcePanel [data-copy-link]').first().click();
  await expect.poll(() => page.evaluate(() => window.__copiedText)).not.toBe('');
  await expect(page.locator('#sourcePanel')).toContainText('References');
  await expect(page.locator('#featureDetails')).toContainText('Eastern');
  await expect(page.locator('#featureDetails')).toContainText('Source context');
  await expect(page.locator('#featureDetails')).toContainText('Technical fields');
  await expect(page.locator('#featureDetails [data-copy-feature]')).toBeVisible();
  await expect(page.locator('#featureDetails [data-copy-layer]')).toBeVisible();
});

test('/test active layer controls include MapLibre layer actions', async ({ page }) => {
  await page.goto('/test/#layers=roi-garda-regions-vector-test');
  await page.waitForFunction(() => window.__civgraphTest?.controller?.layers?.has('roi-garda-regions-vector-test'));
  await openMapTools(page);
  await expect(page.locator('#activeLayers')).toContainText('Garda Regions');
  await expect(page.locator('#activeLayers [data-action="layer-fit"]')).toBeVisible();
  await expect(page.locator('#activeLayers [data-action="layer-up"]')).toBeVisible();
  await expect(page.locator('#activeLayers [data-action="layer-down"]')).toBeVisible();
  await expect(page.locator('#activeLayers [data-action="layer-copy"]')).toBeVisible();
  await expect(page.locator('#activeLayers [data-action="layer-drag"]')).toBeVisible();
  await expect(page.locator('#activeLayers [data-action="layer-unload"]')).toBeVisible();
});

test('/test persists layer order and supports mobile landscape sidebar', async ({ page }) => {
  await page.goto('/test/#layers=roi-garda-regions-vector-test,roi-garda-divisions-vector-test');
  await page.waitForFunction(() => window.__civgraphTest?.controller?.layers?.size === 2);
  await openMapTools(page);
  await page.locator('#activeLayers [data-action="layer-down"]').first().click();
  const savedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem('civgraph:test:layer-order') || '[]'));
  expect(savedOrder.length).toBe(2);
  await page.setViewportSize({ width: 740, height: 390 });
  await page.locator('#mobileMenuBtn').click();
  await page.locator('#sidebarToggle').click();
  await expect(page.locator('body')).toHaveClass(/test-sidebar-open/);
  const box = await page.locator('#testSidebar').boundingBox();
  expect(box.width).toBeLessThanOrEqual(440);
});

test('/test reports service-worker cache status and device defaults', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length);
  await openMapTools(page);
  await expect(page.locator('#diagnostics')).toContainText('Service Worker Cache');
  await page.locator('body').evaluate((body) => body.classList.add('test-sidebar-open'));
  await page.locator('#preferencesDeviceDefaults').click();
  await expect(page.locator('#preferencesStatus')).toContainText('mobile defaults');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('civgraph.test.catalogue.preferences'))).toContain('"viewMode":"compact"');
});
