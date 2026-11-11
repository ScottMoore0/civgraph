const { test, expect } = require('@playwright/test');

// The 1955 counties and provinces in the catalogue: each in its own row (series), named by its
// year, and credited to the right provider.
//
// History. RESOLVED 2026-08-23: flat-provinces had omitted `provinces` (2019) from its class.
// A sweep for the same shape found four more classes with orphaned layers
// (docs/review/CLASS-MEMBERSHIP-SWEEP.md). The spec then read the old flat catalogue's class
// cards (.catalogue-flat__toc-link, [data-c1-id]), which the rebuilt catalogue (src/catalogue/,
// in production at /maps since 2026-10-12) does not draw, so it timed out waiting for them.
//
// What changed with the rebuild, deliberately (5407bcd421, Phelim Birch's third review,
// 2026-10-10): OSI is credited as Tailte Éireann; the 1955 counties are credited to Phelim
// Birch and the 1955 provinces to Tailte Éireann. And `provinces` (2019) is hidden: "the 2019
// provinces map is the 1955 map (no change since 1955)" (catalogue.source.json `hidden`).
//
// The credits are still checked exactly, against data/database/maps.json, the record of each
// map's provider: attribution has legal weight, and a row that loses half a credit must fail.
test('1955 counties and provinces catalogue metadata is exposed correctly', async ({ page }) => {
  await page.goto('/maps/#layers=__none');
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelector('[data-cn-series="counties-counties"]')
    && document.querySelector('[data-cn-series="counties-provinces"]'), null, { timeout: 30000 });

  const seen = await page.evaluate(async () => {
    const chip = (seriesId, mapId) => {
      const el = document.querySelector(`[data-cn-series="${seriesId}"] [data-cn-toggle="${mapId}"]`);
      return { exists: !!el, label: el?.querySelector('.cn-chip__label')?.textContent?.trim() || '', title: el?.getAttribute('title') || '' };
    };
    const maps = await fetch('/data/database/maps.json').then((r) => r.json());
    const provider = (id) => (maps.maps || []).find((m) => m.id === id)?.provider || null;
    return {
      counties1955: chip('counties-counties', 'counties-ireland-1955'),
      provinces1955: chip('counties-provinces', 'provinces-1955'),
      provincesCurrent: document.querySelectorAll('[data-cn-toggle="provinces"]').length,
      recorded: { counties1955: provider('counties-ireland-1955'), provinces1955: provider('provinces-1955') }
    };
  });

  // The record of each credit is what the owner's review set.
  expect(seen.recorded.counties1955).toEqual(['Phelim Birch']);
  expect(seen.recorded.provinces1955).toEqual(['Tailte Éireann']);

  expect(seen.counties1955.exists).toBe(true);
  expect(seen.counties1955.label).toBe('1955');
  // The chip's hover is "date · provider(s) · count": the whole credit, unshortened.
  expect(seen.counties1955.title).toContain('1955');
  expect(seen.counties1955.title.split(' · ')[1]).toBe(seen.recorded.counties1955.join(', '));

  expect(seen.provinces1955.exists).toBe(true);
  expect(seen.provinces1955.label).toBe('1955');
  expect(seen.provinces1955.title).toContain('1955');
  expect(seen.provinces1955.title.split(' · ')[1]).toBe(seen.recorded.provinces1955.join(', '));

  // The 2019 provinces map is hidden as a copy of the 1955 one, so the catalogue offers no chip for it.
  expect(seen.provincesCurrent).toBe(0);
});
