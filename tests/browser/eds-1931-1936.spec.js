const { test, expect } = require('@playwright/test');

/**
 * The 1931 and 1936 ED composites must be reachable and must render their OWN geometry.
 *
 * Reported broken on 2026-08-04: 1936 loaded the 1941 map and 1931 was absent entirely,
 * because maps-test-index.json was stale and eds-roi-1931 was in no catalogue card. The
 * distinguishing assertion is the sourceLayer -- if 1936 renders eds_leinster_1941 then
 * it is serving the wrong year again.
 */
test.use({ serviceWorkers: 'block' });
const { BASE } = require('./helpers/base-url');

for (const [year, expectLayer] of [['1931', 'eds_leinster_1931'], ['1936', 'eds_leinster_1936']]) {
  test(`eds-roi-${year} is present and renders its own Leinster geometry`, async ({ page }) => {
    test.setTimeout(180000);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    const r = await page.evaluate(async (y) => {
      const t = window.__civgraphTest2;
      const aliasId = `eds-roi-${y}-leinster-alias-test`;
      const alias = t.metadataService.getLayer(aliasId);
      if (!alias) return { error: `${aliasId} not in the live index` };
      await t.app.loadMap(alias.sourceMapId);
      await new Promise((res) => t.mapController.map.once('idle', res));
      const sources = t.mapController.map.getStyle().sources;
      const key = Object.keys(sources).find((k) => k.includes(alias.sourceMapId) || k.includes(aliasId));
      const feats = key ? t.mapController.map.querySourceFeatures(key, { sourceLayer: alias.sourceLayer }) : [];
      return {
        aliasSourceLayer: alias.sourceLayer,
        aliasTarget: alias.aliasTargetLayerId,
        renderedFeatures: feats.length,
        sample: feats[0]?.properties?.ENGLISH || null,
      };
    }, year);

    expect(r.error, r.error).toBeUndefined();
    // the crux: it must be this year's Leinster layer, not 1941's
    expect(r.aliasSourceLayer).toBe(expectLayer);
    expect(r.aliasTarget).toBe(`eds-leinster-${year}-vector-test`);
    expect(r.renderedFeatures, 'rendered no features').toBeGreaterThan(0);
  });
}

/**
 * Reachability. Layer ids are not rendered as text, so the earlier version of this test
 * -- searching document.body.innerHTML for the id -- was meaningless: it reported both
 * years absent even when 1936 worked. What actually determines reachability is whether
 * the shipped catalogue card lists the id, and whether the alias layer resolves.
 */
test('both years are reachable: listed in the card and resolvable as layers', async ({ page }) => {
  test.setTimeout(150000);
  const bundleHasBoth = await (async () => {
    const entry = await page.request.get(`${BASE}/app/build/app.bundle.js`);
    const chunk = (await entry.text()).match(/chunks\/app-[A-Z0-9]+\.js/)?.[0];
    if (!chunk) return null;
    const body = await (await page.request.get(`${BASE}/app/build/${chunk}`)).text();
    return { has1931: body.includes('eds-roi-1931'), has1936: body.includes('eds-roi-1936') };
  })();
  expect(bundleHasBoth, 'could not locate the app chunk').not.toBeNull();
  expect(bundleHasBoth.has1931, 'eds-roi-1931 is not in the shipped catalogue card').toBe(true);
  expect(bundleHasBoth.has1936).toBe(true);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // metadataService attaches slightly after app; wait for the thing actually used.
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService, null, { timeout: 60000 });
  const resolvable = await page.evaluate(() => ({
    a1931: !!window.__civgraphTest2.metadataService.getLayer('eds-roi-1931-leinster-alias-test'),
    a1936: !!window.__civgraphTest2.metadataService.getLayer('eds-roi-1936-leinster-alias-test'),
    l1931: !!window.__civgraphTest2.metadataService.getLayer('eds-leinster-1931-vector-test'),
    l1936: !!window.__civgraphTest2.metadataService.getLayer('eds-leinster-1936-vector-test'),
  }));
  for (const [k, v] of Object.entries(resolvable)) expect(v, `${k} did not resolve`).toBe(true);
});
