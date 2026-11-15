const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Civgraph Elections (site/apps/elections/, 11 Nov 2026; not public yet). The test server
// answers /_api/elections from the records build and serves /elections/* through the
// _redirects rewrite, as Pages does. Without a records build the record views are skipped. The
// pivot, swing and notional views need the pivot extracts (npm run build:elections-app) and
// DuckDB's WebAssembly, which is over the Pages file limit and so only built locally (npm run
// build:elections-app:vendor); they skip without them. The libraries are self-hosted (11 Nov 2026,
// src/libs/): no page may load anything from a CDN. The map views need the tiles on
// data.civgraph.net and skip when it is unreachable.
const ROOT = path.join(__dirname, '..', '..');
const RECORDS = fs.existsSync(path.join(ROOT, 'tmp', 'records', 'civgraph-records.sqlite'));
const EXTRACTS = fs.existsSync(path.join(ROOT, 'site', 'apps', 'elections', 'extracts', 'index.json'));
const WASM = fs.existsSync(path.join(ROOT, 'src', 'libs', 'duckdb-wasm-1.29.0', 'duckdb-eh.wasm'));
const TILES = 'https://data.civgraph.net/data/parliament/words/meta.json';
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

/**
 * Every host other than this server and data.civgraph.net (the tiles) the page asks for anything:
 * none, since the libraries, DuckDB's WebAssembly and its parquet extension are self-hosted.
 */
function thirdParty(page) {
  const hosts = new Set();
  // The test server's own host, from the config's baseURL (a run on another port is still local).
  const own = new URL(test.info().project.use.baseURL || 'http://127.0.0.1:5050').host;
  page.on('request', (req) => {
    const { protocol, host } = new URL(req.url());
    if (/^https?:$/.test(protocol) && host !== own && host !== 'data.civgraph.net') hosts.add(host);
  });
  return () => [...hosts];
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
    await expect(page.locator('.el-count-labels li').nth(1)).toContainText("distribution of Naomi Long's surplus");
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

  // EL2 (owner, 13 Nov 2026): each limit of the data is noted where it applies, never as a
  // blanket disclaimer. Newcastle UDC 1967: polled, nine candidates for nine seats (the paper
  // named only the elected); Warrenpoint West Ward 1967: four candidates without a vote figure.
  test('data limits: a contest without its losers says so on the contest and in the election list', async ({ page }) => {
    await page.goto('/elections/newcastle-urban-district-council-1967-05-17/newcastle/');
    await expect(page.locator('#el-view [data-limit="losers"]')).toContainText('losing candidates');
    await expect(page.locator('dl.cg-facts')).not.toContainText('Majority');
    await shot(page, '11-contest-losers-missing');
    await page.goto('/elections/newcastle-urban-district-council-1967-05-17/');
    await expect(page.locator('table.el-contests [data-limit="losers"]')).toHaveCount(1);
    await expect(page.locator('[data-limit="election-losers"]')).toContainText('in 1 contest,');
    await page.goto('/elections/warrenpoint-urban-district-council-1967-05-17/west-ward/');
    await expect(page.locator('[data-limit="votes"]')).toHaveText('4 candidates have no vote figure in the sources Civgraph holds.');
    await expect(page.locator('table.el-sheet')).toContainText('not recorded');
    await expect(page.locator('[data-limit="losers"]')).toHaveCount(0);
  });

  test('data limits: a complete contest and its election carry no data note', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
    await expect(page.locator('h2#el-result')).toHaveText('Count sheet');
    await expect(page.locator('#el-view [data-limit]')).toHaveCount(0);
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await expect(page.locator('table.el-contests')).toBeVisible();
    await expect(page.locator('#el-view [data-limit]')).toHaveCount(0);
    // The party-leaders note was dropped (owner, 14 Nov 2026).
    await expect(page.locator('#el-view')).not.toContainText('Party leaders are not recorded');
  });

  test('an unknown election is a "Not found" page', async ({ page }) => {
    await page.goto('/elections/no-such-election-1900-01-01/');
    await expect(page.locator('h1')).toHaveText('Not found');
  });

  test('a body page lists the elections the registry also lists under it, naming the body they are filed under', async ({ page }) => {
    // groups.alsoListed (data/registries/election-bodies.json): the 1918 election, filed under the Dáil.
    await page.goto('/elections/body/house-of-commons-of-the-united-kingdom/');
    await expect(page.locator('h1')).toHaveText('House of Commons of the United Kingdom');
    const also = page.locator('.el-list li', { has: page.locator('a[href="/elections/dail-eireann-1918-12-14/"]') });
    await expect(also).toHaveCount(1);
    await expect(also.locator('.el-muted')).toContainText('Dáil Éireann');
    // On its own body's page it is listed as before, without a body name.
    await page.goto('/elections/body/dail-eireann/');
    await expect(page.locator('.el-list li', { has: page.locator('a[href="/elections/dail-eireann-1918-12-14/"]') }).locator('.el-muted')).not.toContainText('Dáil Éireann');
  });

  test('compare: two elections side by side with contest-by-contest changes', async ({ page }) => {
    await page.goto('/elections/compare/?a=northern-ireland-assembly-2017-03-02&b=northern-ireland-assembly-2022-05-05');
    await expect(page.locator('svg.el-arc')).toHaveCount(2);
    await expect(page.locator('#el-view')).toContainText('18 contests have the same name');
    await shot(page, '07-compare');
  });

  test.describe('with the extracts and DuckDB', () => {
    test.skip(!EXTRACTS, 'needs the pivot extracts (npm run build:elections-app)');
    test.skip(!WASM, "needs DuckDB's WebAssembly built locally (npm run build:elections-app:vendor)");

    test('pivot: party by year of seats, URL state, CSV download', async ({ page }) => {
      test.setTimeout(90000);
      const others = thirdParty(page);
      await page.goto('/elections/pivot/?body=northern-ireland-assembly&rows=party&cols=year&measure=seats');
      await expect(page.locator('#pv-status')).toContainText('rows ×', { timeout: 60000 });
      const dup = page.locator('table.el-pivot tbody tr', { hasText: 'DUP' }).first();
      await expect(dup.locator('td').last()).not.toHaveText('');
      await page.selectOption('#pv-measure', 'share');
      await expect(page).toHaveURL(/measure=share/);
      await expect(page.locator('table.el-pivot caption')).toContainText('Share of the votes');
      // EL2: the notes follow the table: party by year has the party note, and no gender note.
      await expect(page.locator('#pv-notes [data-limit="party"]')).toBeVisible();
      await expect(page.locator('#pv-notes [data-limit="gender"]')).toHaveCount(0);
      const download = page.waitForEvent('download');
      await page.click('#pv-csv');
      expect((await download).suggestedFilename()).toMatch(/\.csv$/);
      expect(others()).toEqual([]);
      await shot(page, '05-pivot');
    });

    test('pivot: gender and derived incumbency carry their own notes, with the counts of the table', async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/elections/pivot/?body=dail-eireann&rows=gender&cols=none&measure=candidates');
      await expect(page.locator('#pv-status')).toHaveAttribute('data-state', 'shown', { timeout: 60000 });
      await expect(page.locator('#pv-notes [data-limit="gender"]')).toContainText(/Gender is recorded for [\d,]+ of the [\d,]+ candidacies in this table\./);
      await expect(page.locator('#pv-notes [data-limit="gender"]')).toContainText('never inferred');
      await page.selectOption('#pv-rows', 'incumbent');
      await expect(page.locator('#pv-notes [data-limit="incumbency"]')).toContainText('worked out, not taken from a source', { timeout: 60000 });
      await expect(page.locator('#pv-notes [data-limit="gender"]')).toHaveCount(0);
      await shot(page, '12-pivot-notes');
    });

    test('swingometer: moving a party changes the projected seats', async ({ page }) => {
      test.setTimeout(90000);
      const others = thirdParty(page);
      await page.goto('/elections/swing/?e=northern-ireland-assembly-2022-05-05&d.Alliance=8');
      await expect(page.locator('#sw-seats table')).toBeVisible({ timeout: 60000 });
      await expect(page.locator('.el-estimate')).toContainText('estimates');
      // EL2: the transfers caveat sits with the seat estimate, not in the notice above.
      await expect(page.locator('#sw-chart figcaption [data-limit="transfers"]')).toContainText('transfers');
      await expect(page.locator('.el-estimate')).not.toContainText('transfers');
      const alliance = page.locator('#sw-seats tbody tr', { hasText: 'Alliance' });
      await expect(alliance.locator('td').nth(2)).toHaveText(/^\+\d+$/);
      expect(others()).toEqual([]);
      await shot(page, '08-swing');
    });

    test('notional results: every figure labelled an estimate, projection hook works', async ({ page }) => {
      test.setTimeout(90000);
      const others = thirdParty(page);
      await page.goto('/elections/notional/?e=northern-ireland-assembly-2022-05-05');
      await expect(page.locator('.el-estimate')).toContainText('Estimates', { timeout: 60000 });
      await expect(page.locator('#el-view')).toContainText('Belfast South and Mid Down');
      await page.fill('input[data-target="Alliance"]', '25');
      await expect(page.locator('[data-proj="Alliance"]')).toHaveText(/\d+ \(/);
      if (await online(page.request, TILES)) {
        await expect(page.locator('#nt-map')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
      }
      expect(others()).toEqual([]);
      await shot(page, '09-notional');
    });
  });

  test('maps: winner choropleth on the map package layer', async ({ page, request }) => {
    test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
    test.setTimeout(90000);
    const others = thirdParty(page);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
    await expect(page.locator('#mp-map canvas')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#mp-legend .cg-legend__item')).not.toHaveCount(0);
    await expect(page.locator('#mp-status')).toContainText('18 of 18 contests drawn', { timeout: 60000 });
    expect(others()).toEqual([]);
    await expect(page.locator('script[src*="cdn.jsdelivr.net"], link[href*="cdn.jsdelivr.net"]')).toHaveCount(0);
    await shot(page, '06-map');
  });

  // The map's modes, key and close-contests filter (el-maps, 14 Nov 2026; lib/map-modes.js).
  test('maps: a tie is drawn and keyed as a tie, every mode draws with its key, the mode is in the URL', async ({ page, request }) => {
    test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
    test.setTimeout(180000);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
    await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
    // East Antrim 2022: DUP 2, Alliance 2. Never "Alliance most seats".
    await expect(page.locator('#mp-legend')).toContainText('Tie: Alliance, DUP');
    await expect(page.locator('#mp-table tr', { hasText: 'East Antrim' })).toContainText('Tie: Alliance, DUP, 2 seats each');
    for (const mode of ['margin', 'spoilt', 'topper', 'turnout']) {
      await page.selectOption('#mp-mode', mode);
      await expect(page).toHaveURL(new RegExp(`mode=${mode}`));
      await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
      await expect(page.locator('#mp-legend .cg-legend__item')).not.toHaveCount(0);
      await expect(page.locator('#mp-mode')).toBeFocused();
    }
    await expect(page.locator('#mp-table')).toContainText('Turnout 69.5%');
  });

  test('maps: the close-contests filter keeps its contests in a sortable list, all in the URL', async ({ page, request }) => {
    test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
    test.setTimeout(120000);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=margin');
    await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
    await page.fill('#mp-under', '500');
    await page.press('#mp-under', 'Enter');
    await expect(page).toHaveURL(/under=500/);
    await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
    await expect(page.locator('#mp-legend')).toContainText('Not a close contest');
    const rows = page.locator('#mp-close tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Foyle');
    await expect(page.locator('#mp-close th[aria-sort="ascending"]')).toContainText('Margin (votes)');
    // Sorting writes the URL and leaves the map as it is.
    await page.click('#mp-close button[data-sort="name"]');
    await expect(page).toHaveURL(/sort=name/);
    await expect(rows.first()).toContainText('Foyle');
    await page.click('#mp-close button[data-sort="name"]');
    await expect(page).toHaveURL(/sort=-name/);
    await expect(rows.first()).toContainText('Upper Bann');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('#mp-close tbody tr').first()).toContainText('Upper Bann', { timeout: 60000 });
  });

  test('maps: a swing across a boundary change says so, and draws the share', async ({ page, request }) => {
    test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
    test.setTimeout(120000);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=swing&party=DUP&vs=northern-ireland-assembly-2003-11-26');
    await expect(page.locator('.cg-notice--warning')).toContainText('was fought on other boundaries');
    await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
    await expect(page.locator('#mp-legend')).toContainText("DUP's share");
  });

  test('maps: fits a phone, its list scrolls in its own box', async ({ page, request }) => {
    test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
    test.setTimeout(120000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=margin&under=2&unit=pct');
    await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  // The view lifecycle (11 Nov 2026 arch audit P1, site/apps/elections/lib/lifecycle.js): leaving a
  // view removes its listeners and its maps, however often it is visited.
  test.describe('view lifecycle', () => {
    /** The listeners of one type on #el-view, the root every view shares (Chrome DevTools Protocol). */
    async function rootListeners(page, type) {
      const client = await page.context().newCDPSession(page);
      const { result } = await client.send('Runtime.evaluate', { expression: 'document.getElementById("el-view")' });
      const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      await client.detach();
      return listeners.filter((l) => l.type === type).length;
    }

    test('three visits to the swingometer and the notional view leave one input listener on the root', async ({ page }) => {
      test.skip(!EXTRACTS || !WASM, 'needs the pivot extracts and DuckDB');
      test.setTimeout(180000);
      await page.goto('/elections/swing/?e=northern-ireland-assembly-2022-05-05');
      await expect(page.locator('#sw-seats table')).toBeVisible({ timeout: 60000 });
      for (let i = 0; i < 3; i += 1) {
        await page.click('.cg-tabs__bar a[data-tab="home"]');
        await expect(page.locator('#el-view')).toHaveAttribute('data-route', 'rendered');
        expect(await rootListeners(page, 'input')).toBe(0);
        await page.click('.cg-tabs__bar a[data-tab="swing"]');
        await expect(page.locator('#sw-seats table')).toBeVisible({ timeout: 60000 });
        expect(await rootListeners(page, 'input')).toBe(1);
      }
      // One slider move writes the URL once (a leaked listener would write it again).
      await page.evaluate(() => {
        const original = history.replaceState.bind(history);
        window.__replaced = 0;
        history.replaceState = (...args) => { window.__replaced += 1; return original(...args); };
      });
      await page.locator('input[type=range]').first().evaluate((el) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(await page.evaluate(() => window.__replaced)).toBe(1);
      await page.click('.cg-tabs__bar a[data-tab="notional"]');
      await expect(page.locator('h1')).toHaveText('Notional results', { timeout: 60000 });
      await expect(page.locator('#el-view')).toHaveAttribute('data-route', 'rendered', { timeout: 60000 });
      expect(await rootListeners(page, 'input')).toBe(1);
    });

    test('changing the map three times and leaving it removes every map it made', async ({ page, request }) => {
      test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
      test.setTimeout(180000);
      await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
      await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
      // Count the maps made and removed from here on (the one on screen was made before).
      await page.evaluate(() => {
        const { maplibregl } = window;
        const Map = maplibregl.Map;
        const remove = Map.prototype.remove;
        window.__made = 0;
        window.__removed = 0;
        Map.prototype.remove = function counted() { window.__removed += 1; return remove.call(this); };
        maplibregl.Map = class extends Map { constructor(options) { super(options); window.__made += 1; } };
      });
      for (const mode of ['turnout', 'winner', 'turnout']) {
        await page.selectOption('#mp-mode', mode);
        await expect(page).toHaveURL(new RegExp(`mode=${mode}`));
        await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
        await expect(page.locator('canvas')).toHaveCount(1);
      }
      const counts = await page.evaluate(() => ({ made: window.__made, removed: window.__removed }));
      expect(counts).toEqual({ made: 3, removed: 3 });
      await page.click('.cg-tabs__bar a[data-tab="home"]');
      await expect(page.locator('#el-view')).toHaveAttribute('data-route', 'rendered');
      expect(await page.evaluate(() => window.__removed)).toBe(4);
      await expect(page.locator('canvas')).toHaveCount(0);
    });

    test('small multiples: a second click while drawing draws nothing twice', async ({ page, request }) => {
      test.skip(!(await online(request, TILES)), 'data.civgraph.net (the tiles) is unreachable');
      test.setTimeout(240000);
      await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
      await expect(page.locator('#mp-status')).toHaveAttribute('data-state', 'drawn', { timeout: 60000 });
      const n = Number((await page.locator('#mp-sm-go').textContent()).match(/\d+/)[0]);
      await page.locator('#mp-sm-go').evaluate((button) => { button.click(); button.click(); });
      await expect(page.locator('#mp-sm-go')).toBeDisabled();
      await expect(page.locator('#mp-sm-out')).toHaveAttribute('data-state', 'done', { timeout: 200000 });
      await expect(page.locator('#mp-sm-out figure')).toHaveCount(n);
      await expect(page.locator('#mp-sm-go')).toBeEnabled();
      expect(await page.evaluate(() => document.body.querySelectorAll(':scope > div[style*="-9999px"]').length)).toBe(0);
    });

    test('pivot: two quick changes show the table of the second, never of the first', async ({ page }) => {
      test.skip(!EXTRACTS || !WASM, 'needs the pivot extracts and DuckDB');
      test.setTimeout(90000);
      await page.goto('/elections/pivot/?body=northern-ireland-assembly&rows=party&cols=year&measure=seats');
      await expect(page.locator('#pv-status')).toHaveAttribute('data-state', 'shown', { timeout: 60000 });
      await page.locator('#pv-measure').evaluate((select) => {
        for (const value of ['votes', 'share']) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      await expect(page).toHaveURL(/measure=share/);
      await expect(page.locator('#pv-status')).toHaveAttribute('data-state', 'shown', { timeout: 60000 });
      await expect(page.locator('table.el-pivot caption')).toContainText('Share of the votes');
      await expect(page.locator('table.el-pivot tbody td').first()).toHaveText(/^\d+\.\d$|^$/);
    });
  });

  test('widget prototype renders an election card', async ({ page }) => {
    await page.goto('/apps/elections/embed/?e=northern-ireland-assembly-2022-05-05');
    await expect(page.locator('#w h1')).toHaveText('2022 Northern Ireland Assembly election');
    await expect(page.locator('#w svg circle')).toHaveCount(90);
    await shot(page, '10-widget');
  });
});

// Stream el-tables (14 Nov 2026): every chart has its data as a table and a CSV made in the
// browser (lib/chart-data.js); every worked-out figure carries a short note linking to its
// section of the methods page (lib/methods.js); a contest whose sources carry a checked day shows
// it beside its figures (lib/checked.js).
test.describe('Civgraph Elections: chart data, methods, checked dates', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  /** The CSV a data control links, decoded. */
  async function csvOf(control) {
    const href = await control.locator('.el-chart-data__csv a').getAttribute('href');
    return decodeURIComponent(href.slice(href.indexOf(',') + 1)).replace(/^\uFEFF/, '');
  }

  test('election overview: each chart opens its data as a table, with the same figures and a CSV', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    const seats = page.locator('#data-seats');
    await expect(seats.locator('summary')).toHaveText("View this chart's data as a table");
    await expect(seats.locator('table')).toBeHidden();
    // Keyboard: the control is reachable and opens with Enter.
    await seats.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(seats.locator('table caption')).toHaveText('Seats won by party');
    const sf = seats.locator('tbody tr', { hasText: 'Sinn Féin' });
    await expect(sf.locator('th[scope="row"]')).toHaveText('Sinn Féin');
    await expect(sf.locator('td')).toHaveText('27');
    // The table's seats add up to the arc's circles.
    const total = await seats.locator('tbody td').evaluateAll((tds) => tds.reduce((s, td) => s + Number(td.textContent.replace(/,/g, '')), 0));
    expect(total).toBe(await page.locator('svg.el-arc circle').count());
    await expect(seats.locator('.el-chart-data__csv a')).toHaveAttribute('download', 'northern-ireland-assembly-2022-05-05-seats.csv');
    const csv = await csvOf(seats);
    expect(csv.split('\r\n')[0]).toBe('Party,Seats');
    expect(csv).toContain('Sinn Féin,27\r\n');
    const shares = page.locator('#data-shares');
    await shares.locator('summary').click();
    await expect(shares.locator('thead th')).toHaveText(['Party', 'Share (%)']);
    expect((await csvOf(shares)).split('\r\n').length).toBe(await shares.locator('tbody tr').count() + 2);
    // Worked-out figures: the shares, the median turnout and the change carry their notes.
    await expect(page.locator('figure a.el-method-link[href="/elections/methods/#shares"]')).toBeVisible();
    await expect(page.locator('dl.cg-facts a.el-method-link[href="/elections/methods/#turnout"]')).toBeVisible();
    await expect(page.locator('[data-method="change"]')).toContainText("Change is against this body's previous general election.");
    await expect(page.locator('[data-method="party-labels"]')).toBeVisible();
    await shot(page, '12-chart-data');
  });

  test('a method link opens its section of the methods page', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await page.click('[data-method="change"] a');
    await expect(page).toHaveURL(/\/elections\/methods\/#change$/);
    await expect(page.locator('h1')).toHaveText('How the figures are worked out');
    await expect(page.locator('h2#change')).toBeFocused();
    await expect(page.locator('.cg-tabs__bar a[data-tab="methods"]')).toHaveAttribute('aria-current', 'page');
    // Every section is listed and has its heading.
    const toc = await page.locator('.el-methods-toc a').count();
    expect(toc).toBeGreaterThan(10);
    await expect(page.locator('.el-method-section h2')).toHaveCount(toc);
    await expect(page.locator('h2#swingometer + p')).toContainText('uniform swing');
  });

  test('contest: the quota chart and every count\'s transfers have their data; a checked day stands beside the figures', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/belfast-east/');
    await expect(page.locator('#data-quota summary')).toBeVisible();
    await page.locator('#data-quota summary').click();
    await expect(page.locator('#data-quota thead th')).toHaveText(['Candidate', 'Votes', 'Quotas']);
    await expect(page.locator('#data-quota tbody tr')).toHaveCount(await page.locator('svg.el-hbars rect').count());
    // Every transfer of the count, behind the whole-count flow (el-stv).
    await page.locator('#data-transfers summary').click();
    await expect(page.locator('#data-transfers caption')).toHaveText('Every transfer of the count');
    // Belfast North 2019: compared with EONI's own results page (the latest checked day of its sources).
    await page.goto('/elections/house-of-commons-of-the-united-kingdom-2019-12-12/belfast-north/');
    const fact = page.locator('dl.cg-facts dd[data-checked]');
    await expect(fact).toHaveAttribute('data-checked', '2026-11-11');
    await expect(fact.locator('time')).toHaveText('11 Nov 2026');
    await expect(page.locator('dl.cg-facts dt', { hasText: 'Data checked' })).toBeVisible();
    await expect(page.locator('ol.el-cites .el-compared').first()).toContainText('Compared on');
  });

  test('maps: the figures on the map are a table and a CSV, drawn before the map (and without it)', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=winner');
    const control = page.locator('#data-map');
    await expect(control.locator('summary')).toBeVisible({ timeout: 60000 });
    await control.locator('summary').click();
    await expect(control.locator('thead th')).toHaveText(['Area', 'Party with most seats']);
    await expect(control.locator('tbody tr')).toHaveCount(18);
    expect((await csvOf(control)).split('\r\n')[0]).toBe('Area,Party with most seats');
    await page.goto('/elections/map/?e=northern-ireland-assembly-2022-05-05&mode=turnout');
    await expect(page.locator('#mp-table [data-method="turnout"] a')).toHaveAttribute('href', '/elections/methods/#turnout', { timeout: 60000 });
  });

  test('phone width: the data tables and the methods page fit the screen', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await page.goto('/elections/northern-ireland-assembly-2022-05-05/');
    await expect(page.locator('details.el-chart-data summary')).toHaveCount(2);
    for (const summary of await page.locator('details.el-chart-data summary').all()) await summary.click();
    await expect(page.locator('details.el-chart-data[open]')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.goto('/elections/methods/');
    await expect(page.locator('h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await context.close();
  });
});

// el-places (14 Nov 2026): search over places, people and parties; area pages; the person page;
// the contest arrows; party chips linked to Browse.
test.describe('Civgraph Elections: places, people and parties', () => {
  test.skip(!RECORDS, 'needs the records build (npm run records:build)');

  test('search finds a place, a person and a party, accents and case folded, and keeps the query in the address', async ({ page }) => {
    await page.goto('/elections/');
    await page.fill('#el-q', 'Strangford');
    await expect(page.locator('#el-results-places + ul a').first()).toHaveText('Strangford');
    await page.fill('#el-q', 'naomi long');
    await expect(page.locator('#el-results-people + ul a').first()).toHaveText('Naomi Long');
    await expect(page).toHaveURL(/\?q=naomi%20long$/);
    await page.fill('#el-q', 'SINN FEIN');
    await expect(page.locator('#el-results-parties + ul a').first()).toHaveAttribute('href', '/browse/parties/sinn-fein');
    await page.goto('/elections/?q=strangford');
    await expect(page.locator('#el-q')).toHaveValue('strangford');
    await expect(page.locator('#el-results-places + ul a').first()).toHaveAttribute('href', '/elections/area/strangford/');
  });

  test('area page: a section per body, a trend chart, members, verdicts and boundary maps; fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/elections/area/strangford/');
    await expect(page.locator('h1')).toHaveText('Strangford');
    await expect(page.locator('.cg-notice').first()).toContainText('gathered here by their name');
    const commons = page.locator('section.el-series', { hasText: 'House of Commons of the United Kingdom' });
    await expect(commons.locator('.el-trend svg[role="img"]')).toBeVisible();
    await expect(commons.locator('table.el-area-contests tbody tr').first()).toContainText('DUP win, on new boundaries');
    await expect(commons.locator('table.el-members')).toContainText('Jim Shannon');
    await expect(commons.locator('a[href="/maps/#layers=pc-2023-vector"]')).toHaveCount(1);
    await expect(page.locator('section.el-series', { hasText: 'East Down Rural District Council' })).toContainText('No boundary map is held');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.click('.el-area-bodies a:text-is("Northern Ireland Assembly")');
    await expect(page).toHaveURL(/\/elections\/area\/strangford\/\?body=northern-ireland-assembly$/);
    await expect(page.locator('.el-crumbs')).toContainText('Northern Ireland Assembly');
    await expect(page.locator('table.el-members thead th')).toHaveCount(7);
    await shot(page, '20-area');
  });

  test('contest page: arrows to the contests before and after under the same name, people and party links', async ({ page }) => {
    await page.goto('/elections/northern-ireland-assembly-2017-03-02/strangford/');
    const nav = page.locator('nav.el-contest-nav');
    await expect(nav.locator('a[rel="prev"]')).toHaveAttribute('href', '/elections/northern-ireland-assembly-2016-05-05/strangford/');
    await expect(nav.locator('a[rel="next"]')).toHaveAttribute('href', '/elections/northern-ireland-assembly-2022-05-05/strangford/');
    await expect(page.locator('a.el-party-link[href="/browse/parties/dup"]').first()).toBeVisible();
    await page.click('table.el-sheet a:text-is("Michelle McIlveen")');
    await expect(page).toHaveURL(/\/elections\/person\/michelle-mcilveen-[\w-]+\/$/);
    await expect(page.locator('h1')).toHaveText('Michelle McIlveen');
  });

  test('person page: every candidacy across bodies, relatives, same-name people, the Browse record', async ({ page }) => {
    await page.goto('/elections/person/naomi-long-51102/');
    await expect(page.locator('h1')).toHaveText('Naomi Long');
    await expect(page.locator('table.el-career tbody tr')).toHaveCount(14);
    await expect(page.locator('table.el-career')).toContainText('European');
    await expect(page.locator('a[href="/browse/persons/naomi-long-51102"]')).toHaveCount(1);
    await page.goto('/elections/person/neil-t-blaney-100149/');
    await expect(page.locator('#el-relatives + ul')).toContainText('father');
    await page.goto('/elections/person/frank-aiken-105416/');
    await expect(page.locator('#el-namesakes ~ ul li')).not.toHaveCount(0);
    await shot(page, '21-person');
  });
});
