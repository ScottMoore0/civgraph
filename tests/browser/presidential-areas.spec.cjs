const { test, expect } = require('@playwright/test');

// A presidential election's results by area (data/registries/election-bodies.json areaResults,
// built by build-test2-election-manifest.mjs buildAreaResultsGeographyModes): the Constituency
// geography draws the 2011 election on the 2009 Dáil constituencies, one result an area, while the
// national geography stays the one contest it was. And the 2024 Limerick mayoral election draws on
// Limerick City and County.

async function boot(page) {
  await page.goto('/maps/');
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.evaluate(async () => {
    window.__civgraphTest2.elections = await window.__civgraphTest2.app.ensureElections();
  });
}

test('2011 presidential election: Ireland and Constituency geographies', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await page.evaluate(() => window.__civgraphTest2.elections.loadElection('President of Ireland', '2011-10-27'));
  const options = await page.$$eval('#test2ElectionGeography option', (opts) => opts.map((o) => `${o.value}:${o.textContent.trim()}`));
  expect(options).toEqual(['results:Ireland', 'areas:Constituency']);

  const national = await page.evaluate(() => {
    const e = window.__civgraphTest2.elections;
    return { src: e.getActiveElectionStyleSourceMapId(), rows: e.currentResults().length, areas: e.isAreaResultsGeographyMode() };
  });
  expect(national).toEqual({ src: 'roi-1938', rows: 1, areas: false });

  const areas = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('areas');
    const rows = e.currentResults();
    const clare = e.findResultByKey('Clare');
    const legend = e.legendModel();
    return {
      src: e.getActiveElectionStyleSourceMapId(),
      areas: e.isAreaResultsGeographyMode(),
      rows: rows.length,
      matched: rows.filter((r) => r.matched).length,
      tableRows: document.querySelectorAll('.test2-election-turnout table tbody tr').length,
      clare: clare && { leader: clare.leadingName, counts: clare.countNumbers, elected: clare.candidates.filter((c) => c.elected).length, person: clare.candidates.some((c) => c.personId) },
      legendNames: legend.items.map((i) => i.name).sort(),
      overlays: e.shouldRenderElectionOverlays()
    };
  });
  expect(areas.src).toBe('dail-2009');
  expect(areas.areas).toBe(true);
  expect(areas.rows).toBe(43);
  expect(areas.matched).toBe(43);
  expect(areas.tableRows).toBe(43);
  expect(areas.clare).toEqual({ leader: 'Michael D Higgins', counts: [1, 2, 3, 4], elected: 0, person: false });
  expect(areas.legendNames).toContain('Michael D Higgins');
  expect(areas.overlays).toBe(false);

  // An area opens as a contest, with its counts.
  const detail = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    e.renderPanel(e.findResultByKey('Clare'), 'counts');
    return document.getElementById('electionPaneTitle')?.textContent.trim();
  });
  expect(detail).toBe('Clare');

  const back = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('results');
    return { src: e.getActiveElectionStyleSourceMapId(), rows: e.currentResults().length };
  });
  expect(back).toEqual({ src: 'roi-1938', rows: 1 });
});

test('1945 presidential election: counties and county boroughs on the 1944 local authorities', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await page.evaluate(() => window.__civgraphTest2.elections.loadElection('President of Ireland', '1945-06-16'));
  const state = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('areas');
    const rows = e.currentResults();
    return { label: e.activeGeographyMode().label, src: e.getActiveElectionStyleSourceMapId(), rows: rows.length, matched: rows.filter((r) => r.matched).length };
  });
  // 31 counties and county boroughs, and the Limerick second count reported for two of them.
  expect(state).toEqual({ label: 'County and county borough', src: 'local-authorities-1944', rows: 32, matched: 31 });
});

test('2024 Limerick mayoral election draws on Limerick City and County', async ({ page }) => {
  test.setTimeout(120000);
  await boot(page);
  await page.evaluate(() => window.__civgraphTest2.elections.loadElection('Mayor of Limerick', '2024-06-07'));
  const state = await page.evaluate(() => {
    const e = window.__civgraphTest2.elections;
    const [result] = e.currentResults();
    return {
      src: e.getActiveElectionStyleSourceMapId(),
      rows: e.currentResults().length,
      matched: result.matched,
      feature: result.featureName,
      winner: result.winnerName,
      counts: result.countNumbers.length,
      candidates: result.candidates.length
    };
  });
  expect(state).toEqual({ src: 'local-authorities-2024', rows: 1, matched: true, feature: 'LIMERICK CITY AND COUNTY COUNCIL', winner: 'John Moran', counts: 12, candidates: 15 });
});
