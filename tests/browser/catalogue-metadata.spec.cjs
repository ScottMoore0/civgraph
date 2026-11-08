const { test, expect } = require('@playwright/test');

// RESOLVED 2026-08-23. It was neither a grouping regression nor a deliberate
// restructure: the CLASS listed only two of the three layers.
//
// flat-provinces is composed from the `ireland-provinces` class in
// data/database/maps.json, whose `maps` array held provinces-1955 and provinces-1899
// and simply omitted `provinces` (Provinces of Ireland 2019). Category and parentId
// were never the mechanism, which is why inspecting those explained nothing.
//
// The comparable case settles which way it should go: counties-ireland (1977, the modern
// layer) is BOTH featured and a member of ni-counties, alongside five older vintages.
// Provinces was the only category where the modern vintage sat outside its own class,
// and it shares provider ["OSI", "Phelim Birch"] with provinces-1955 -- same lineage,
// split for no recorded reason. Adding it to the class fixed this assertion.
//
// A sweep for the same shape found four more classes with orphaned layers. Ten were
// added; four were left out ON PURPOSE and the reasons are recorded in
// docs/review/CLASS-MEMBERSHIP-SWEEP.md.
test('1955 counties and provinces catalogue metadata is exposed correctly', async ({ page }) => {
  await page.goto('/#layers=__none');

  // Open a catalogue section first. The catalogue renders a table of contents on load --
  // 127 entries, no [data-c1-id] anywhere -- and the c1 cards this test reads only exist
  // once a section is opened. Measured: 0 [data-c1-id] before the click, 8 after, and
  // opening any one entry reveals the whole group including flat-counties and
  // flat-provinces.
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.locator('a.catalogue-flat__toc-link').first().click({ timeout: 20000 });

  await page.waitForFunction(() =>
    window.uiController
    && document.querySelector('[data-c1-id="flat-counties"]')
    && document.querySelector('[data-c1-id="flat-provinces"]')
  , null, { timeout: 30000 });

  const metadata = await page.evaluate(() => {
    const readMember = (cardId, mapId) => {
      const card = document.querySelector(`[data-c1-id="${cardId}"]`);
      const member = card?.querySelector(`.class-member[data-map-id="${mapId}"]`);
      return {
        exists: !!member,
        name: member?.querySelector('.class-member__name')?.textContent?.trim() || '',
        provider: member?.querySelector('.class-member__provider')?.textContent?.trim() || ''
      };
    };

    return {
      counties1955: readMember('flat-counties', 'counties-ireland-1955'),
      provincesCurrent: readMember('flat-provinces', 'provinces'),
      provinces1955: readMember('flat-provinces', 'provinces-1955')
    };
  });

  expect(metadata.counties1955.exists).toBe(true);
  expect(metadata.counties1955.name).toBe('1955');
  // These two assertions caught a real attribution loss, not a stale expectation.
  // counties-ireland-1955 had been reduced to provider ["Phelim Birch"] while its
  // sibling provinces-1955 still carried ["OSI", "Phelim Birch"]. Two records created
  // together with the same dual credit, one of which had lost half of it.
  //
  // Restored rather than relaxed. Attribution has legal weight, and a test that is
  // loosened to match damaged data stops being able to detect the damage.
  expect(metadata.counties1955.provider).toContain('OSI');
  expect(metadata.counties1955.provider).toContain('Phelim Birch');

  expect(metadata.provincesCurrent.exists).toBe(true);
  expect(metadata.provincesCurrent.name).toBe('2019');

  expect(metadata.provinces1955.exists).toBe(true);
  expect(metadata.provinces1955.name).toBe('1955');
  expect(metadata.provinces1955.provider).toContain('OSI');
  expect(metadata.provinces1955.provider).toContain('Phelim Birch');
});
