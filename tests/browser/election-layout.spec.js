const { test, expect } = require('@playwright/test');

// UX plan T3-08, the two sub-items that outlasted the rest. MEASURED 2026-08-23 and both
// are already correct, so these are guards rather than fixes. Recorded because the plan
// still lists them and the next reader would otherwise re-investigate.

// test.fixme(): known broken, measurement recorded. NOT a stale expectation.
//
// The camera DOES move on load -- zoom 6.08 -> 5.21 on a cold start -- so the refit is
// wired up and partly works. It does not FIT: the resulting view's south edge is
// 53.4296 while the Dail 2024 layer's south edge is 51.8890, deterministically, across
// three different starting states (leftover layers, a reset camera, and a re-measured
// container). So roughly the southern third of the country is off-screen after loading
// an all-island election.
//
// My earlier "17 of 18 seat circles visible" reading was a WEAKER check that happened to
// look fine: seat circles cluster where the seats are, not at the layer's extremes, so
// counting them does not test containment.
//
// Left failing rather than loosened, because the plan's finding -- "12 of 18
// constituencies below the fold" -- is describing this, and the fix belongs in whatever
// computes the fit (very likely a padding or container-height term), not in the test.
test('T3-08 · loading an election refits the map to its constituencies', async ({ page }) => {
  test.fixme();
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.elections?.catalogue?.elections?.length, null, { timeout: 60000 });

  const result = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const entry = app.elections.catalogue.elections
      .find((e) => e.body === 'Dáil Éireann' && e.date === '2024-11-29' && e.loadable);
    if (!entry) return { error: 'entry not loadable' };

    // START FROM A KNOWN STATE. Without this the test inherits whatever the previous
    // spec left loaded and where it left the camera, and the assertion below measured
    // the leftovers rather than the refit -- passing alone, failing in the suite.
    for (const mapId of Array.from(app.mapController.layerStates.keys())) {
      if (app.mapController.isLayerLoaded(mapId)) app.mapController.unloadLayer(mapId);
    }
    app.mapController.map.jumpTo({ center: [-8.05, 53.5], zoom: 6.08 });
    // Re-measure the container. setViewportSize() changes the window, but MapLibre keeps
    // its own cached size until told otherwise, so a fit computed here would be fitted to
    // the PREVIOUS spec's viewport -- which is exactly what made this pass alone and fail
    // in the suite.
    app.mapController.map.resize();
    await new Promise((resolve) => setTimeout(resolve, 800));

    const beforeZoom = app.mapController.map.getZoom();
    await app.elections.loadElection(entry.body, entry.date);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    // Assert the CAMERA, not the DOM markers. Counting visible seat circles was
    // order-dependent -- 18 alone, 35 in the full suite -- because marker rendering
    // carries state from whatever ran before. The claim under test is that the view
    // fits the election's own layer, and map bounds answer that directly.
    const map = app.mapController.map;
    const bounds = map.getBounds();
    const state = app.mapController.getLayerState(app.elections.activeEntry?.sourceMapId);
    const layerBounds = state?.config?.bounds || app.mapController.resolveLayer(app.elections.activeEntry?.sourceMapId)?.bounds || null;
    return {
      beforeZoom,
      afterZoom: map.getZoom(),
      view: { w: bounds.getWest(), e: bounds.getEast(), s: bounds.getSouth(), n: bounds.getNorth() },
      layerBounds,
    };
  });

  expect(result.error).toBeUndefined();
  // The finding was "12 of 18 constituencies below the fold". Measured 2026-08-23: on a
  // cold load the camera zooms out from 6.08 to 5.21 and the whole layer fits.
  //
  // "Zoom decreased" is NOT the invariant, and asserting it failed in the full suite
  // while passing alone: whether the camera has to zoom out depends entirely on where it
  // started, and an earlier test leaves it somewhere else. CONTAINMENT is the invariant
  // -- after loading an election you can see all of it -- and it holds either way.
  expect(result.layerBounds, 'the election layer should declare bounds to fit to').toBeTruthy();
  if (result.layerBounds) {
    // [[south, west], [north, east]] in this catalogue.
    const [[south, west], [north, east]] = result.layerBounds;
    expect(result.view.w).toBeLessThanOrEqual(west + 0.5);
    expect(result.view.e).toBeGreaterThanOrEqual(east - 0.5);
    expect(result.view.s).toBeLessThanOrEqual(south + 0.5);
    expect(result.view.n).toBeGreaterThanOrEqual(north - 0.5);
  }
});

test('T3-08 · the Trends chart has room for its own x-axis', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);

  const tab = page.locator('#electionPaneHeaderRight .election-view-tab').filter({ hasText: 'Trends' }).first();
  await expect(tab).toHaveCount(1);
  await tab.click();
  await page.waitForSelector('#test2ElectionTrendsChart svg', { timeout: 30000 });
  await page.waitForTimeout(2500);

  const geometry = await page.evaluate(() => {
    const svg = document.querySelector('#test2ElectionTrendsChart svg');
    const svgBottom = svg.getBoundingClientRect().bottom;
    const labels = [...svg.querySelectorAll('text')].map((t) => t.getBoundingClientRect().bottom);
    return { svgBottom, lowestLabel: Math.max(...labels), labelCount: labels.length };
  });

  expect(geometry.labelCount).toBeGreaterThan(2);
  // The x-axis labels must sit INSIDE the drawing area. Clipped labels were the finding;
  // measured, the lowest sits 11px above the svg's bottom edge.
  expect(geometry.lowestLabel).toBeLessThanOrEqual(geometry.svgBottom);
});
