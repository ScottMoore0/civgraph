const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Civgraph Elections, el-context (14 Nov 2026): the area in the census on a contest page, "same
// votes, other systems" on an election page, and embeds (off by default; a local preview shows the
// panel). The record views need the records build, as in elections-app.spec.cjs.
const ROOT = path.join(__dirname, '..', '..');
const RECORDS = fs.existsSync(path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));

/** No sideways scroll at the current width. */
async function fitsWidth(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test.describe('Civgraph Elections: context, other systems, embeds', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  test('a contest shows its area in the census, ranked, cited, with similar areas linked to their contests', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
    const box = page.locator('[data-el-census]');
    await expect(box).toHaveAttribute('data-state', 'shown');
    await expect(box.locator('h2')).toHaveText('The area in the census');
    await expect(box.locator('.el-lead')).toHaveText('Census 2011, ranked among the 18 constituencies of 2008.');
    await expect(box.locator('table.el-census-table tbody tr')).toHaveCount(7);
    await expect(box.locator('table.el-census-table tbody tr').first()).toContainText('92,221');
    await expect(box.locator('abbr', { hasText: 'KS402NI' }).first()).toBeVisible();
    await expect(box.locator('ol.el-list li')).toHaveCount(5);
    await expect(box.locator('ol.el-list a').first()).toHaveAttribute('href', /^\/elections\/northern-ireland-assembly-2022-05-05\/[a-z-]+\/$/);
    await expect(box).toContainText('Open Government Licence v3.0');
    // Embeds are off: no panel.
    await expect(page.locator('[data-el-embed]')).toHaveCount(0);
  });

  test('a council contest gets the census nearest its date; the 2023 constituencies are not yet held', async ({ page }) => {
    await page.goto('/elections/local-government-local-government-districts-2011-05-05/');
    await page.locator('table.el-contests a').first().click();
    const box = page.locator('[data-el-census]');
    await expect(box).toHaveAttribute('data-state', 'shown');
    await expect(box.locator('.el-lead')).toHaveText(/^Census 2011, ranked among the 101 District Electoral Areas of 1993\.$/);
    await expect(box).toContainText('Also held for these boundaries: census 2001.');
    await page.goto('/elections/house-of-commons-of-the-united-kingdom-2024-07-04/belfast-east/');
    await expect(page.locator('[data-el-census]')).toHaveAttribute('data-state', 'not-held');
    await expect(page.locator('[data-el-census]')).toContainText('Not yet held');
  });

  test('same votes, other systems: closed until opened, then every system shares out the 90 seats', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    const panel = page.locator('[data-el-systems]');
    await expect(page.locator('#el-systems')).toHaveText('Same votes, other systems');
    await expect(page.locator('.el-systems .cg-notice')).toContainText('Illustrative arithmetic, not a prediction');
    await expect(panel).toHaveAttribute('data-state', 'idle');
    await panel.locator('summary').click();
    await expect(panel).toHaveAttribute('data-state', 'shown', { timeout: 30000 });
    const foot = panel.locator('table.el-systems-table tfoot td.num');
    // Votes, then one total a system: actual, D'Hondt, Sainte-Laguë, pure PR.
    await expect(foot).toHaveCount(5);
    for (const i of [1, 2, 3, 4]) await expect(foot.nth(i)).toHaveText('90');
    await expect(panel.locator('table.el-systems-table thead')).toContainText("D'Hondt, by constituency");
    await expect(panel.locator('svg.el-seatbar')).toHaveCount(4);
    await panel.locator('details.el-systems-method summary').click();
    await expect(panel.locator('details.el-systems-method')).toContainText('no tactical voting');
  });

  test('first past the post: the other systems share out all 18 seats as one area', async ({ page }) => {
    await page.goto('/elections/house-of-commons-of-the-united-kingdom-2019-12-12/');
    const panel = page.locator('[data-el-systems]');
    await panel.locator('summary').click();
    await expect(panel).toHaveAttribute('data-state', 'shown', { timeout: 30000 });
    await expect(panel.locator('table.el-systems-table thead')).toContainText("D'Hondt, all seats as one area");
    await expect(panel.locator('table.el-systems-table thead')).not.toContainText('First past the post');
  });

  test('the widget: a contest card with its outcome, a link back and the licences', async ({ page }) => {
    await page.goto('/apps/elections/embed/?e=northern-ireland-assembly-2022-05-05&c=belfast-east');
    const w = page.locator('#w');
    await expect(w).toHaveAttribute('data-state', 'shown');
    await expect(w.locator('h1 a')).toHaveText('Belfast East');
    await expect(w.locator('h1 a')).toHaveAttribute('href', /\/elections\/northern-ireland-assembly-2022-05-05\/belfast-east\/$/);
    await expect(w.locator('tbody tr')).not.toHaveCount(0);
    await expect(w.locator('tbody')).toContainText('Elected');
    await expect(w.locator('footer')).toContainText('CC BY 4.0');
    await expect(w.locator('footer')).toContainText('Civgraph Elections');
  });

  test('embeds: a local preview shows the panel with the snippet; it fits a phone', async ({ page }) => {
    await page.goto('/elections/');
    await page.evaluate(() => localStorage.setItem('civgraph.electionsEmbedPreview', '1'));
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
    const panel = page.locator('[data-el-embed]');
    await panel.locator('summary').click();
    await expect(panel.locator('textarea')).toHaveValue(/^<iframe src="https:\/\/civgraph\.net\/apps\/elections\/embed\/\?e=northern-ireland-assembly-2022-05-05&amp;c=belfast-east"/);
    await expect(panel.locator('iframe')).toHaveAttribute('src', /\/apps\/elections\/embed\/\?e=northern-ireland-assembly-2022-05-05&c=belfast-east$/);
    await expect(page.locator('[data-el-census]')).toHaveAttribute('data-state', 'shown');
    expect(await fitsWidth(page)).toBe(true);
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await page.locator('[data-el-systems] summary').click();
    await expect(page.locator('[data-el-systems]')).toHaveAttribute('data-state', 'shown', { timeout: 30000 });
    expect(await fitsWidth(page)).toBe(true);
    await page.evaluate(() => localStorage.removeItem('civgraph.electionsEmbedPreview'));
  });
});
