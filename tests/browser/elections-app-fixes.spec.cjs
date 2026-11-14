const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Civgraph Elections, stream el-fixes (14 Nov 2026): ties in multi-member seats, the referendum
// template, reader words for sources and map layers, the announcer, focus after navigation,
// named scroll areas, and no page overflow at 375px. Like elections-app.spec.cjs, it needs the
// records build; the tie cases need its election summaries built with seatsByParty
// (scripts/build/build-test2-election-summaries.mjs, 14 Nov 2026), and the swingometer and pivot
// cases the extracts and DuckDB's WebAssembly.
const ROOT = path.join(__dirname, '..', '..');
const RECORDS = fs.existsSync(path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
const EXTRACTS = fs.existsSync(path.join(ROOT, 'site', 'apps', 'elections', 'extracts', 'index.json'));
const WASM = fs.existsSync(path.join(ROOT, 'src', 'libs', 'duckdb-wasm-1.29.0', 'duckdb-eh.wasm'));
const NI_2022 = 'northern-ireland-assembly-2022-05-05';

/** Whether the records' summaries carry seatsByParty (built after 14 Nov 2026). */
async function summariesHaveSeats(request) {
  const res = await request.get(`/_api/elections?view=summary&key=northern-ireland-assembly__2022-05-05`);
  if (!res.ok()) return false;
  const rows = (await res.json()).results || [];
  return rows.some((r) => r.seatsByParty && typeof r.seatsByParty === 'object');
}

/** The page's horizontal overflow in px (0 when nothing is wider than the viewport). */
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Civgraph Elections: el-fixes', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  test('a five-way tie reads as a tie on the overview, Compare and the map data, never "most seats"', async ({ page, request }) => {
    test.skip(!(await summariesHaveSeats(request)), 'needs the election summaries rebuilt with seatsByParty');
    await page.goto(`/elections/${NI_2022}/`);
    const north = page.locator('table.el-contests tbody tr', { hasText: 'North Antrim' });
    await expect(north.locator('[data-winner]')).toHaveAttribute('data-winner', 'tie');
    await expect(north).toContainText('tied, 1 seat each');
    await expect(north).not.toContainText('most seats');
    await expect(page.locator('table.el-contests tbody tr', { hasText: 'East Antrim' })).toContainText('tied, 2 seats each');
    await page.goto(`/elections/compare/?a=northern-ireland-assembly-2017-03-02&b=${NI_2022}`);
    const row = page.locator('table tbody tr', { hasText: 'North Antrim' });
    await expect(row.locator('td').nth(1)).toContainText('tied, 1 seat each');
    await expect(row.locator('td').nth(1)).not.toContainText('UUP (most seats)');
  });

  test('a referendum has its own template: the proposal, options with shares, the result in words, areas', async ({ page }) => {
    await page.goto('/elections/ireland-referendum-2024-03-08-the-family/');
    await expect(page.locator('h1')).toHaveText('2024 family referendum');
    await expect(page.locator('.el-lead')).toHaveText(/· Referendum$/);
    await expect(page.locator('#el-proposal')).toBeVisible();
    await expect(page.locator('[data-result]')).toHaveText(/^The proposal was rejected: 67\.7% voted No\.$/);
    await expect(page.locator('dl.cg-facts dt', { hasText: /^Seats$/ })).toHaveCount(0);
    await expect(page.locator('dl.cg-facts dt', { hasText: 'Electorate' })).toBeVisible();
    await expect(page.locator('#el-view th', { hasText: /^Party$/ })).toHaveCount(0);
    await expect(page.locator('#el-view th', { hasText: /^Candidates$/ })).toHaveCount(0);
    await expect(page.locator('table.el-ref-options tbody tr')).toHaveCount(2);
    await expect(page.locator('table.el-ref-options tbody tr').first()).toContainText('Yes');
    await expect(page.locator('table.el-ref-areas tbody tr')).toHaveCount(39);
    await expect(page.locator('table.el-ref-areas tbody tr[data-feature]')).toHaveCount(39);
    await expect(page.locator('#el-view')).not.toContainText('No No');
    await page.click('table.el-ref-areas a:text-is("Carlow–Kilkenny")');
    await expect(page.locator('h1')).toHaveText('Carlow–Kilkenny');
    await expect(page.locator('[data-result]')).toContainText('rejected: 70.7% voted No');
    await expect(page.locator('#el-view th', { hasText: /^(Candidate|Party|Seats)$/ })).toHaveCount(0);
    await expect(page.locator('dl.cg-facts')).toContainText('Electorate');
  });

  test('the readers see words, not codes: no layer id on the map, no basis code on sources', async ({ page }) => {
    await page.goto(`/elections/map/?e=${NI_2022}&mode=winner`);
    await expect(page.locator('h1')).toHaveText('Results maps');
    await expect(page.locator('.el-lead')).not.toContainText(/-alias|-vector/);
    await page.goto(`/elections/${NI_2022}/belfast-east/`);
    await expect(page.locator('ol.el-cites li').first()).toBeVisible();
    await expect(page.locator('#el-view')).not.toContainText(/inline-citation|article-citation|stated-coverage|source-url|figures-compared/);
    await expect(page.locator('#el-view')).not.toContainText('covers article');
  });

  test('transfers over 999 keep their thousands separator', async ({ page }) => {
    await page.goto(`/elections/${NI_2022}/north-antrim/`);
    await expect(page.locator('table.el-sheet .el-transfer').first()).toBeVisible();
    const transfers = await page.locator('table.el-sheet .el-transfer').allTextContents();
    const big = transfers.filter((t) => Math.abs(Number(t.replace(/[^\d.]/g, ''))) >= 1000 || /,/.test(t));
    expect(big.length).toBeGreaterThan(0);
    for (const t of big) expect(t).toMatch(/^[+−]\d{1,3}(,\d{3})+(\.\d{2})?$/);
  });

  test('a route change is announced in a line and focus moves to the new h1; the view is not a live region', async ({ page }) => {
    await page.goto(`/elections/${NI_2022}/`);
    await expect(page.locator('#el-view')).not.toHaveAttribute('aria-live', /.+/);
    await expect(page.locator('#el-announcer')).toHaveAttribute('aria-live', 'polite');
    await page.click('table.el-contests a:text-is("Belfast East")');
    await expect(page.locator('h1')).toHaveText('Belfast East');
    await expect(page.locator('#el-announcer')).toHaveText(/^Loaded Belfast East – 2022 Northern Ireland Assembly election\.$/);
    await expect(page.locator('h1')).toBeFocused();
    // A form change re-renders in place and gives focus back to the control.
    await page.goto(`/elections/compare/?a=northern-ireland-assembly-2017-03-02&b=${NI_2022}`);
    await page.focus('#cmp-a');
    await page.selectOption('#cmp-a', 'northern-ireland-assembly-2016-05-05');
    await expect(page).toHaveURL(/a=northern-ireland-assembly-2016-05-05/);
    await expect(page.locator('#cmp-a')).toBeFocused();
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test('no screen overflows the page: home, overview, contest, Compare, referendum', async ({ page }) => {
      for (const url of ['/elections/', `/elections/${NI_2022}/`, `/elections/${NI_2022}/north-antrim/`,
        `/elections/compare/?a=northern-ireland-assembly-2017-03-02&b=${NI_2022}`, '/elections/ireland-referendum-2024-03-08-the-family/']) {
        await page.goto(url);
        await expect(page.locator('h1')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await overflow(page), url).toBeLessThanOrEqual(0);
      }
    });

    test('the count sheet and the transfer diagrams scroll as named, focusable regions with readable labels', async ({ page }) => {
      await page.goto(`/elections/${NI_2022}/north-antrim/`);
      const sheet = page.locator('.el-sheet-wrap');
      await expect(sheet).toHaveAttribute('tabindex', '0');
      await expect(sheet).toHaveAttribute('role', 'region');
      await expect(sheet).toHaveAttribute('aria-label', 'Count sheet');
      const flow = page.locator('details.el-flow-stage figure.cg-chart').first();
      await expect(flow).toHaveAttribute('tabindex', '0');
      await expect(flow).toHaveAttribute('aria-label', /count 2/i);
      const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('svg.el-flow text')].map((t) => {
        const svg = /** @type {SVGSVGElement} */ (t.ownerSVGElement);
        return parseFloat(getComputedStyle(t).fontSize) * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
      })));
      expect(smallest).toBeGreaterThanOrEqual(10.5);
    });
  });

  test.describe('with the extracts and DuckDB', () => {
    test.skip(!EXTRACTS, 'needs the pivot extracts (npm run build:elections-app)');
    test.skip(!WASM, "needs DuckDB's WebAssembly built locally (npm run build:elections-app:vendor)");

    test('the swingometer starts from the seats won (Sinn Féin 27 in 2022, not the model\'s 30)', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto(`/elections/swing/?e=${NI_2022}`);
      await expect(page.locator('#sw-seats table')).toBeVisible({ timeout: 60000 });
      const sf = page.locator('#sw-seats tbody tr', { hasText: 'Sinn Féin' });
      await expect(sf.locator('td').nth(0)).toHaveText('27');
      await expect(sf.locator('td').nth(1)).toHaveText('27');
      await expect(page.locator('#sw-seats thead')).toContainText('Won');
    });

    test('the pivot offers the folded party, with the ballot label as its own dimension', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/elections/pivot/?body=dail-eireann&rows=party_folded&cols=decade&measure=seats');
      await expect(page.locator('#pv-status')).toHaveAttribute('data-state', 'shown', { timeout: 60000 });
      await expect(page.locator('#pv-rows option[value="party_folded"]')).toHaveText('Party');
      await expect(page.locator('#pv-rows option[value="party"]')).toHaveText('Party (ballot label)');
      await expect(page.locator('#pv-notes [data-limit="party"]')).toContainText('under its most used label');
      const labels = await page.locator('table.el-pivot tbody th').allTextContents();
      expect(new Set(labels).size).toBe(labels.length);
    });
  });
});
