const { test, expect } = require('@playwright/test');

// The /render/ time-series picker had never worked. render/index.html mounts
// #timeSeriesPanel, time-series-panel.js renders it and TimeSeriesController swaps a
// loaded layer to another date -- all wired up, all inert, because
// render/metadata/maps-test.json carried `timeSeriesChains: []` while the catalogue
// carried 17 chains and 44 classes. Nothing reported it: the panel's empty state is a
// polite sentence, so "no chains" and "chains broken" looked identical.
//
// Assert the behaviour end to end rather than the metadata, so a chain that is present
// but unusable (wrong id shape, unloadable entry) still fails.
test('/render time-series picker lists a chain and switches the loaded layer', async ({ page }) => {
  await page.goto('/render/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length, null, { timeout: 60000 });

  const result = await page.evaluate(async () => {
    const harness = window.__civgraphTest;
    const layer = (harness.metadataService.layers || []).find((entry) => entry.sourceMapId === 'provinces-1955');
    if (!layer) return { error: 'provinces-1955 has no render layer' };
    await harness.controller.loadLayer(layer);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const select = document.querySelector('#timeSeriesPanel [data-control="time-series-date"]');
    if (!select) return { error: 'no date picker rendered' };
    const dates = [...select.options].map((option) => option.value);
    const target = dates.find((value) => value !== select.value);
    const switched = await harness.timeSeries.switchLayerToDate(layer.id, target);
    return { dates, target, switched, loadedAfter: [...harness.controller.layers.keys()] };
  });

  expect(result.error).toBeUndefined();
  // 2019 is here only because `provinces` was added to the ireland-provinces class on
  // 2026-08-23; before that the modern vintage sat outside its own chain.
  expect(result.dates).toEqual(['1899', '1955', '2019']);
  expect(result.switched).toBe(true);
  // The switch must actually swap the layer, not merely report success.
  expect(result.loadedAfter).toContain('provinces-1899-vector-test');
  expect(result.loadedAfter).not.toContain('provinces-1955-vector-test');
});
