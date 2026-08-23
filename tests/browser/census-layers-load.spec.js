const { test, expect } = require('@playwright/test');

// UX triage T2-05: "census layers load, or are marked".
//
// All 14 layers in the `census` category are unflagged -- none carries `hidden` or
// `placeholder` -- so the catalogue promises every one of them works. Nothing had ever
// checked that promise, and the triage could not settle it by reading: an unmarked layer
// that silently fails to load looks exactly like an unmarked layer that works.
//
// Loads each one for real and asserts the layer reaches the map. A layer that cannot load
// should be MARKED in the catalogue, not left looking available -- that is the item's own
// wording, and either outcome is a pass for the catalogue as long as the two agree.
const CENSUS_LAYERS = [
  'ttwa-2011', 'ttwa-2007', 'sdz-2021', 'dz-2021', 'soa-2011', 'sa-2011', 'oa-2001',
  'nra', 'nuts-2-all-ireland', 'nuts-2-roi', 'nuts-3', 'census-grid-2021',
  'av-referendum-2011', 'wards-2001',
];

test('every unflagged census layer actually loads', async ({ page }) => {
  test.setTimeout(300000);
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length, null, { timeout: 60000 });

  const results = await page.evaluate(async (ids) => {
    const app = window.__civgraphTest2.app;
    const out = [];
    for (const id of ids) {
      try {
        await app.loadMap(id);
        // isMapLoaded is style membership -- true once the layer is added. That is the
        // right assertion here: the item asks whether the layer LOADS, not whether tiles
        // for the current viewport happen to be non-empty.
        out.push({ id, loaded: app.isMapLoaded(id), error: null });
        await app.unloadMap?.(id);
      } catch (error) {
        out.push({ id, loaded: false, error: String(error && error.message || error) });
      }
    }
    return out;
  }, CENSUS_LAYERS);

  const failed = results.filter((row) => !row.loaded);
  expect(failed, `census layers that did not load: ${JSON.stringify(failed, null, 2)}`).toEqual([]);
  expect(results).toHaveLength(CENSUS_LAYERS.length);
});
