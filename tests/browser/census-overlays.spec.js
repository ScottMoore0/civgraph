const { test, expect } = require('@playwright/test');

// The 80 census statistic overlays (data/database/data-entries.json) on the MapLibre map.
//
// They were listed as "To be added" and a link to one threw "not converted for the MapLibre
// route yet" (census explorer review, 2026-11-01). Each is now its geography's tiles shaded
// by a CSV joined on a real code (src/census-overlay.mjs). These check the three things a
// reader sees: the overlay opens by link, the legend gives its classes, and clicking an area
// gives its figure.

async function openByLink(page, id) {
  await page.goto(`/maps/#layers=${id}`);
  await page.waitForFunction(
    (layerId) => window.__civgraphTest2?.mapController?.layerStates?.get(layerId)?.censusOverlay,
    id,
    { timeout: 90000 }
  );
}

test.describe('census statistic overlays', () => {
  test.setTimeout(180000);

  test('a statistic opens by link, with its classes in the legend and its source', async ({ page }) => {
    const id = 'data-2021-religion-catholic-ward';
    await openByLink(page, id);
    const state = await page.evaluate((layerId) => {
      const st = window.__civgraphTest2.mapController.layerStates.get(layerId);
      return { rows: st.censusOverlay.rows.length, matched: st.censusOverlay.joined.byTileValue.size, classes: st.censusOverlay.classes.length };
    }, id);
    expect(state.rows).toBe(462);
    expect(state.matched).toBe(462);
    expect(state.classes).toBe(10);

    const legend = page.locator(`[data-census-legend="${id}"]`);
    await expect(legend).toHaveCount(1);
    await page.evaluate(() => { const d = document.querySelector('#test2MapLegend details'); if (d) d.open = true; });
    await expect(legend.locator('.test2-map-legend__list--classes li')).toHaveCount(10);
    await expect(legend).toContainText('Under 10%');
    await expect(legend).toContainText('90% and over');
    await expect(legend).toContainText('MS-B19');
    await expect(legend).toContainText('OGL v3.0');
  });

  test('clicking an area shows its value and the total it is a share of', async ({ page }) => {
    const id = 'data-2021-religion-catholic-lgd';
    await openByLink(page, id);
    const mc = 'window.__civgraphTest2.mapController';
    // Mid Ulster, well inland: the middle of the map is then a district, not Lough Neagh.
    await page.evaluate(() => window.__civgraphTest2.mapController.map.jumpTo({ center: [-6.85, 54.62], zoom: 9 }));
    await page.evaluate(`${mc}.waitUntilSettled({ timeoutMs: 30000 })`);
    const box = await page.locator('#map').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const details = page.locator('#featureInfoContent [data-census-statistic]');
    await expect(details).toHaveCount(1, { timeout: 15000 });
    await expect(details.locator('[data-census-value]')).toHaveText(/^\d+(\.\d+)?%$/);
    await expect(details.locator('[data-census-denominator]')).toContainText(/of [\d,]+ usual residents/);
    await expect(page.locator('#featureInfoContent')).toContainText('OGL v3.0');
  });

  test('every geography joins: one statistic each, all their rows matched to tiles', async ({ page }) => {
    // One statistic per boundary layer the 80 are drawn on, including the 1972 wards, whose
    // tiles carry no code the CSV has and are joined through a crosswalk to civ_fid.
    const ids = [
      'data-2021-population-lgd', 'data-2021-population-dea', 'data-2021-no-car-ward',
      'data-2021-level-4-plus-settlement', 'data-2021-population-sdz', 'data-2021-population-dz',
      'nimdm-2017-mdm-decile-sa', 'data-population-change-1971-1981-ward1972'
    ];
    await page.goto('/maps/');
    await page.waitForFunction(() => window.__civgraphTest2?.app && window.__civgraphTest2?.metadataService?.layers?.length, null, { timeout: 90000 });
    const results = await page.evaluate(async (list) => {
      const app = window.__civgraphTest2.app;
      const mc = app.mapController;
      const out = [];
      for (const id of list) {
        try {
          await app.loadMap(id);
          await mc.waitUntilSettled({ timeoutMs: 25000 }).catch(() => {});
          const st = mc.layerStates.get(id);
          const fillId = `${mc.mainToTest.get(id)}-fill`;
          const key = st.censusOverlay.joined.tileKey;
          const drawn = mc.map.queryRenderedFeatures({ layers: [fillId] })
            .filter((f) => st.censusOverlay.joined.byTileValue.has(String(f.properties[key]))).length;
          out.push({ id, unmatched: st.censusOverlay.joined.unmatched.length, matched: st.censusOverlay.joined.byTileValue.size, drawn });
          await app.unloadMap(id);
        } catch (error) {
          out.push({ id, error: String(error?.message || error) });
        }
      }
      return out;
    }, ids);
    for (const r of results) {
      expect(r.error, `${r.id}: ${r.error}`).toBeUndefined();
      expect(r.unmatched, r.id).toBe(0);
      expect(r.matched, r.id).toBeGreaterThan(0);
      expect(r.drawn, `${r.id} drew no shaded area`).toBeGreaterThan(0);
    }
  });

  test('the catalogue offers a statistic to add, not "To be added"', async ({ page }) => {
    await page.goto('/maps/');
    await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 90000 });
    const status = await page.evaluate(async () => {
      const doc = await fetch('/data/catalogue/catalogue.json').then((r) => r.json());
      const entries = await fetch('/data/database/data-entries.json').then((r) => r.json());
      return entries.dataEntries.map((e) => doc.maps[e.id]?.status || 'missing');
    });
    expect(status).toHaveLength(87);
    expect(status.filter((s) => s !== 'ready')).toEqual([]);
  });
});
