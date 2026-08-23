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

// The generator first shipped handling only the `segments` shape, so it emitted 5 of 17
// chains and the other 12 stayed as dead as before -- a fix that looked complete and
// covered under a third of the catalogue. Assert the SHAPES are all resolved, because
// that is the thing that silently regressed once already.
test('/render time-series chains cover all four catalogue shapes', async ({ page }) => {
  await page.goto('/render/');
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length, null, { timeout: 60000 });

  const chains = await page.evaluate(() =>
    (window.__civgraphTest.metadataService.metadata?.timeSeriesChains || [])
      .map((chain) => ({ id: chain.id, count: (chain.maps || []).length })));

  const byId = new Map(chains.map((chain) => [chain.id, chain.count]));
  const atLeast = (id, n) => {
    expect(byId.has(id), `chain ${id} is missing`).toBe(true);
    expect(byId.get(id), `chain ${id} has too few entries`).toBeGreaterThanOrEqual(n);
  };

  atLeast('provinces', 3);              // segments
  atLeast('settlements', 2);            // flat classIds
  atLeast('osni-ortho-coverage', 10);   // maps listed directly
  // parallel: one chain PER COLUMN, never merged into a single date list -- switching a
  // Westminster constituency map to a Dail one is not a continuation.
  atLeast('parliamentary:uk-parliament', 5);
  atLeast('parliamentary:dail-eireann', 5);
  atLeast('parliamentary:devolved-ni', 5);
  expect(byId.has('parliamentary'), 'parallel chain must not be emitted merged').toBe(false);

  // Undated maps cannot go in a date picker: their <option value> would be "undefined".
  const undated = await page.evaluate(() =>
    (window.__civgraphTest.metadataService.metadata?.timeSeriesChains || [])
      .flatMap((chain) => (chain.maps || []).filter((entry) => !entry.date || entry.date === 'undefined')
        .map((entry) => `${chain.id}/${entry.id}`)));
  expect(undated).toEqual([]);

  expect(chains.length).toBeGreaterThanOrEqual(18);
});
