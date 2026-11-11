const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Civgraph Elections (site/apps/elections/, 11 Nov 2026; not public yet). The test server
// answers /_api/elections from the records build and serves /elections/* through the
// _redirects rewrite, as Pages does. Without a records build the record views are skipped. The
// pivot, swing and notional views need the pivot extracts (scripts/build/elections-app/data.mjs
// --extracts) and DuckDB from jsDelivr; the map views need MapLibre from jsDelivr and the
// tiles on data.civgraph.net: those tests skip when the network or the extracts are missing.
const ROOT = path.join(__dirname, '..', '..');
const RECORDS = fs.existsSync(path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
const EXTRACTS = fs.existsSync(path.join(ROOT, 'site', 'apps', 'elections', 'extracts', 'index.json'));
const SHOTS = process.env.ELECTIONS_SHOTS || '';
const BUDGET = 1.5 * 1024 * 1024;

async function online(request, url) {
  try { return (await request.get(url, { timeout: 8000 })).ok(); } catch { return false; }
}

/** Bytes a first view moves, as production would serve them: text compressed (Cloudflare gzips it), the rest as is. */
function trackBytes(page) {
  const sizes = [];
  page.on('response', async (res) => {
    try {
      const body = await res.body();
      const type = res.headers()['content-type'] || '';
      sizes.push(/text|javascript|json|css|svg|html/.test(type) ? zlib.gzipSync(body).length : body.length);
    } catch { /* redirects and aborted requests have no body */ }
  });
  return () => sizes.reduce((s, n) => s + n, 0);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('Civgraph Elections', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  test('home: not indexed, lists elections and bodies, search finds an election, under the budget', async ({ page }) => {
    const bytes = trackBytes(page);
    await page.goto('/elections/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('h1')).toHaveText('Civgraph Elections');
    await expect(page.locator('.el-cards li').first()).toBeVisible();
    await page.fill('#el-q', '2022 assembly');
    await expect(page.locator('#el-results a', { hasText: '2022 Northern Ireland Assembly election' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(bytes()).toBeLessThan(BUDGET);
    await shot(page, '01-home');
  });

  test('the app is not linked from the site: /apps/ and the home page do not mention it', async ({ page }) => {
    for (const url of ['/apps/', '/']) {
      await page.goto(url);
      await expect(page.locator('a[href^="/elections"], a[href^="/apps/elections"]')).toHaveCount(0);
    }
  });

  test('election overview: arc, parties with change, contests, under the budget', async ({ page }) => {
    const bytes = trackBytes(page);
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await expect(page.locator('h1')).toHaveText('2022 Northern Ireland Assembly election');
    await expect(page.locator('svg.el-arc circle')).toHaveCount(90);
    const sf = page.locator('table.el-parties tbody tr', { hasText: 'Sinn Féin' });
    await expect(sf.locator('td').first()).toHaveText('27');
    await expect(page.locator('table.el-parties thead')).toContainText('± pts');
    await expect(page.locator('table.el-contests tbody tr')).toHaveCount(18);
    await page.waitForLoadState('networkidle');
    expect(bytes()).toBeLessThan(BUDGET);
    await shot(page, '02-election-overview');
    await page.click('table.el-contests a:text-is("Belfast East")');
    await expect(page).toHaveURL(/\/elections\/northern-ireland-assembly-2022-05-05\/belfast-east\/$/);
    await expect(page.locator('h1')).toHaveText('Belfast East');
  });

  test('contest: full count sheet, transfers, quota, sources with what they cover', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
    await expect(page.locator('h2#el-result')).toHaveText('Count sheet');
    await expect(page.locator('table.el-sheet thead th', { hasText: /^Count \d+$/ })).toHaveCount(11);
    await expect(page.locator('table.el-sheet tbody tr.cg-elected')).toHaveCount(5);
    await expect(page.locator('details.el-flow-stage').first()).toContainText('surplus of Naomi Long');
    await expect(page.locator('#el-quota')).toBeVisible();
    await expect(page.locator('ol.el-cites li').first()).toContainText('covers');
    await expect(page.locator('ol.el-cites .el-check').first()).toBeVisible();
    await shot(page, '03-contest-stv');
  });

  test('unopposed returns read "Returned unopposed", never 0 votes or 0.00%', async ({ page }) => {
    await page.goto('/elections/house-of-commons-of-the-united-kingdom-1803-06-09/');
    await expect(page.locator('table.el-contests')).toContainText('Returned unopposed');
    await expect(page.locator('#el-view')).not.toContainText('0.00%');
    await expect(page.locator('#el-view')).not.toContainText('Valid votes');
    await page.goto('/elections/house-of-commons-of-the-united-kingdom-1803-06-09/dungannon/');
    await expect(page.locator('table.el-sheet')).toContainText('Returned unopposed');
    await expect(page.locator('#el-view')).not.toContainText('0.00%');
    await expect(page.locator('ol.el-cites li')).not.toHaveCount(0);
    await shot(page, '04-contest-unopposed');
  });

  test('an unknown election is a "Not found" page', async ({ page }) => {
    await page.goto('/elections/no-such-election-1900-01-01/');
    await expect(page.locator('h1')).toHaveText('Not found');
  });

  test('compare: two elections side by side with contest-by-contest changes', async ({ page }) => {
    await page.goto('/elections/compare/?a=northern-ireland-assembly-2017-03-02&b=northern-ireland-assembly-2022-05-05');
    await expect(page.locator('svg.el-arc')).toHaveCount(2);
    await expect(page.locator('#el-view')).toContainText('18 contests have the same name');
    await shot(page, '07-compare');
  });

  test.describe('with the extracts and DuckDB', () => {
    test.skip(!EXTRACTS, 'needs the pivot extracts (scripts/build/elections-app/data.mjs --extracts)');
    test.beforeEach(async ({ request }) => {
      test.skip(!(await online(request, 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/package.json')), 'jsDelivr is unreachable');
    });

    test('pivot: party by year of seats, URL state, CSV download', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/elections/pivot/?body=northern-ireland-assembly&rows=party&cols=year&measure=seats');
      await expect(page.locator('#pv-status')).toContainText('rows ×', { timeout: 60000 });
      const dup = page.locator('table.el-pivot tbody tr', { hasText: 'DUP' }).first();
      await expect(dup.locator('td').last()).not.toHaveText('');
      await page.selectOption('#pv-measure', 'share');
      await expect(page).toHaveURL(/measure=share/);
      await expect(page.locator('table.el-pivot caption')).toContainText('Share of the votes');
      const download = page.waitForEvent('download');
      await page.click('#pv-csv');
      expect((await download).suggestedFilename()).toMatch(/\.csv$/);
      await shot(page, '05-pivot');
    });

    test('swingometer: moving a party changes the projected seats', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/elections/swing/?e=northern-ireland-assembly-2022-05-05&d.Alliance=8');
      await expect(page.locator('#sw-seats table')).toBeVisible({ timeout: 60000 });
      await expect(page.locator('.el-estimate')).toContainText('estimates');
      const alliance = page.locator('#sw-seats tbody tr', { hasText: 'Alliance' });
      await expect(alliance.locator('td').nth(2)).toHaveText(/^\+\d+$/);
      await shot(page, '08-swing');
    });

    test('notional results: every figure labelled an estimate, projection hook works', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/elections/notional/?e=northern-ireland-assembly-2022-05-05');
      await expect(page.locator('.el-estimate')).toContainText('Estimates', { timeout: 60000 });
      await expect(page.locator('#el-view')).toContainText('Belfast South and Mid Down');
      await page.fill('input[data-target="Alliance"]', '25');
      await expect(page.locator('[data-proj="Alliance"]')).toHaveText(/\d+ \(/);
      if (await online(page.request, 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/package.json')) {
        await expect(page.locator('#nt-map')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
      }
      await shot(page, '09-notional');
    });
  });

  test('maps: winner choropleth on the map package layer', async ({ page, request }) => {
    test.skip(!(await online(request, 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/package.json')), 'jsDelivr is unreachable');
    test.setTimeout(90000);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
    await expect(page.locator('#mp-map canvas')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#mp-legend .cg-party')).not.toHaveCount(0);
    await expect(page.locator('#mp-status')).toContainText('18 of 18 contests drawn', { timeout: 60000 });
    await shot(page, '06-map');
  });

  test('widget prototype renders an election card', async ({ page }) => {
    await page.goto('/apps/elections/embed/?e=northern-ireland-assembly-2022-05-05');
    await expect(page.locator('#w h1')).toHaveText('2022 Northern Ireland Assembly election');
    await expect(page.locator('#w svg circle')).toHaveCount(90);
    await shot(page, '10-widget');
  });
});
