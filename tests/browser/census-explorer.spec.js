const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// The Census Explorer reads everything from data.civgraph.net, whose CORS policy admits only
// https://civgraph.net. Here those requests are answered from the local copies the bundle
// builder writes (data/census/, gitignored), the CSO PxStat mirror when present, and
// otherwise passed through to the bucket. Without the local bundle the suite is skipped:
// it needs `node scripts/ingest/census/build-census-explorer-bundle.mjs` to have been run.
const ROOT = path.join(__dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'data/census/explorer-bundle.json');
const PXSTAT = process.env.CSO_PXSTAT_DIR || 'D:/cso-pxstat';
const CACHE = process.env.CENSUS_EXPLORER_CACHE || 'E:/civgraph-census-explorer/r2cache';
const UA = 'civgraph-research (+https://civgraph.net)';
const PAGE = '/pages/census-explorer.html';

function localFor(key) {
  const candidates = [path.join(ROOT, key)];
  if (key.startsWith('data/cso-pxstat/')) candidates.push(path.join(PXSTAT, key.slice('data/cso-pxstat/'.length)));
  if (key.startsWith('data/census/')) candidates.push(path.join(CACHE, key.slice('data/census/'.length)));
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

async function routeData(page) {
  await page.route('https://data.civgraph.net/**', async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\//, ''));
    const headers = { 'access-control-allow-origin': '*' };
    const local = localFor(key);
    if (local) {
      const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.gz') ? 'application/gzip' : 'text/plain';
      return route.fulfill({ status: 200, headers: { ...headers, 'content-type': type }, body: fs.readFileSync(local) });
    }
    const res = await route.fetch({ headers: { 'user-agent': UA } });
    return route.fulfill({ response: res, headers: { ...res.headers(), ...headers } });
  });
}

test.describe('Census Explorer', () => {
  test.skip(!fs.existsSync(BUNDLE), 'needs the locally built explorer bundle');

  test.beforeEach(async ({ page }) => { await routeData(page); });

  test('religion and Irish resolve for every census, with the corrected codes and links', async ({ page }) => {
    await page.goto(PAGE);
    const religion = page.locator('tr.concept-row', { hasText: 'Religion (current)' });
    await expect(religion).toBeVisible();
    for (const code of ['KS07a', 'KS07b', 'KS211NI', 'KS212NI', 'MS-B19', 'MS-B23']) {
      await expect(religion.getByText(code, { exact: true })).toBeVisible();
    }
    await expect(religion.getByText('Not asked')).toHaveCount(0);
    const irish = page.locator('tr.concept-row', { hasText: 'Knowledge of Irish' });
    await expect(irish.getByText('KS24', { exact: true })).toBeVisible();
    await expect(irish.getByText('KS22', { exact: true })).toHaveCount(0);
    await religion.getByRole('button', { name: /Religion \(current\)/ }).click();
    const detail = page.locator('#concept-religion');
    await expect(detail).toBeVisible();
    await expect(detail.locator('a[href*="2011-and-earlier-censuses/2001-census"]').first()).toBeVisible();
    await expect(detail.locator('a[href*="statistics/census/2001-census"]')).toHaveCount(0);
    // Earlier censuses link to Civgraph's own NI reports, not the CSO mirror.
    await expect(detail.locator('a[href$="census-1926-part-1.md"]')).toBeVisible();
    await expect(detail.locator('strong', { hasText: '1991' })).toBeVisible();
  });

  test('tabs follow the ARIA pattern and are kept in the address', async ({ page }) => {
    await page.goto(PAGE);
    const first = page.getByRole('tab', { name: 'Topics across censuses (NI)' });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const second = page.getByRole('tab', { name: 'NI tables' });
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(second).toBeFocused();
    await expect(page.locator('#panel-tables')).toBeVisible();
    await expect(page).toHaveURL(/#.*tab=tables/);
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Compare over time' })).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(second).toHaveAttribute('aria-selected', 'true');
  });

  test('NI table list has real titles, topics, paging and a working filter', async ({ page }) => {
    await page.goto(`${PAGE}#tab=tables&y=2001&q=KS07a`);
    const card = page.locator('#tablesCards .card').first();
    await expect(card).toContainText('Religion');
    await page.goto(`${PAGE}#tab=tables&y=2001`);
    await expect(page.locator('#tablesCount')).toContainText(/387 of/);
    await expect(page.locator('#tablesCards .card')).toHaveCount(48);
    await page.getByRole('button', { name: 'Next →' }).first().click();
    await expect(page).toHaveURL(/p=2/);
    await page.goto(`${PAGE}#tab=tables&top=religion`);
    await expect(page.locator('#tablesCount')).toContainText(/^\d+ of/);
    const n = parseInt((await page.locator('#tablesCount').textContent()).replace(/,/g, ''), 10);
    expect(n).toBeGreaterThan(50);
  });

  test('ROI list holds census cubes only, finds religion by dimension, and pages', async ({ page }) => {
    await page.goto(`${PAGE}#tab=roi&rq=religion`);
    await expect(page.locator('#roiCount')).toContainText(/of 4,\d{3} census tables/);
    const n = parseInt((await page.locator('#roiCount').textContent()).replace(/,/g, ''), 10);
    expect(n).toBeGreaterThan(100);
    await expect(page.locator('#rq')).toHaveValue('religion');
    await expect(page.locator('#roiCards')).not.toContainText('Enterprises using ICT');
    await page.goto(`${PAGE}#tab=roi&rq=EY001`);
    await expect(page.locator('#roiCards .card').first()).toContainText('1841–2016');
  });

  test('a ROI table shows figures, a chart, a CSV download and a CC BY citation', async ({ page }) => {
    await page.goto(`${PAGE}#tab=roi&open=roi:EY001`);
    const viewer = page.locator('#viewer');
    await expect(viewer.locator('table.data tbody tr').first()).toBeVisible({ timeout: 15000 });
    await expect(viewer.locator('.cite')).toContainText('CC BY 4.0');
    await expect(viewer.locator('.cite')).toContainText('EY001');
    await expect(viewer.locator('.chart svg')).toBeVisible();
    await expect(viewer.getByRole('link', { name: /Boundaries on the map/ })).toHaveAttribute('href', /\/maps\/#layers=/);
    const [download] = await Promise.all([page.waitForEvent('download'), viewer.getByRole('button', { name: 'Download this view (CSV)' }).click()]);
    expect(download.suggestedFilename()).toBe('EY001-view.csv');
  });

  test('an NI 2011 table opens from Civgraph\'s copy with an OGL citation', async ({ page }) => {
    await page.goto(`${PAGE}#tab=tables&open=ni:2011:KS211NI`);
    const viewer = page.locator('#viewer');
    await expect(viewer.locator('table.data tbody tr').first()).toBeVisible({ timeout: 15000 });
    await expect(viewer).toContainText('Catholic');
    await expect(viewer.locator('.cite')).toContainText('Open Government Licence v3.0');
  });

  test('compare: NI totals and the 26-district frame mark estimates', async ({ page }) => {
    await page.goto(`${PAGE}#tab=compare&cmp=ni&cind=population`);
    await expect(page.locator('#cmpBody svg')).toBeVisible();
    await expect(page.locator('#cmpBody')).toContainText('1,256,561');
    await page.goto(`${PAGE}#tab=compare&cmp=lgd26&cind=catholic_bg`);
    await expect(page.locator('#cmpBody td.est').first()).toBeVisible();
  });

  test('phone width: no sideways page scroll, topics stack', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(PAGE);
    await expect(page.locator('tr.concept-row').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const display = await page.locator('tr.concept-row td').first().evaluate((n) => getComputedStyle(n).display);
    expect(display).toBe('block');
  });

  for (const theme of ['light', 'dark']) {
    test(`no serious contrast failures (${theme})`, async ({ page }) => {
      const AxeBuilder = require('@axe-core/playwright').default;
      await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* */ } }, theme);
      for (const hash of ['', '#tab=roi', '#tab=tables']) {
        await page.goto(PAGE + hash);
        await expect(page.locator('.card:visible, tr.concept-row:visible').first()).toBeVisible({ timeout: 15000 });
        const res = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
        const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
        expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
