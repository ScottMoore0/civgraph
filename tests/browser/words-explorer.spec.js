const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Words in parliament (apps/words/) reads its shards from data.civgraph.net/data/parliament/words/.
// Here those requests are answered from tests/browser/fixtures/words/ -- a few real terms cut
// from the full tree by scripts/build-words-explorer-fixture.mjs -- or, when WORDS_STATIC_DIR
// names a full copy of the static tree, from that. The .json.gz files are served as stored
// bytes (application/octet-stream), as scripts/publish/r2-upload-manifest.mjs leaves them on R2, so the
// page's own gzip handling is what is tested.
const STATIC = process.env.WORDS_STATIC_DIR || path.join(__dirname, 'fixtures', 'words');
const PREFIX = 'https://data.civgraph.net/data/parliament/words/';
const PAGE = '/apps/words/';

async function routeWords(page, { fail = null } = {}) {
  await page.route('https://data.civgraph.net/**', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(PREFIX)) return route.fulfill({ status: 404, body: 'not mocked' });
    const key = decodeURIComponent(url.slice(PREFIX.length).split('?')[0]);
    if (fail && fail.test(key)) return route.fulfill({ status: 500, body: 'server error' });
    const file = path.join(STATIC, key);
    if (!file.startsWith(STATIC) || !fs.existsSync(file)) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'missing' });
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
      body: fs.readFileSync(file)
    });
  });
}

test.describe('Words in parliament', () => {
  test.skip(!fs.existsSync(path.join(STATIC, 'meta.json')), 'needs the words fixture (scripts/build-words-explorer-fixture.mjs)');

  test('charts two terms, lists speakers with Browse links and compares parties', async ({ page }) => {
    await routeWords(page);
    await page.goto(PAGE + '?q=housing,partition');
    await expect(page.locator('#status')).toContainText('housing');
    const panel = page.locator('#panels figure').first();
    await expect(panel.locator('svg path.ln').first()).toBeVisible();
    await expect(panel.locator('.legend li')).toHaveText(['housing', 'partition']);
    await expect(page.locator('#q')).toHaveValue('housing, partition');
    // Speakers: the top rows link to Browse person pages by Civgraph id.
    const rows = page.locator('#speakers tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(page.locator('#speakers a[href^="/browse/#/persons/"]').first()).toBeVisible();
    // Party comparison for the Dáil: Fianna Fáil is there, folded and linked to its party record.
    await expect(page.locator('#parties a[href="/browse/#/parties/fianna-fail"]')).toBeVisible();
    // The term picker moves both tables to the second term.
    await page.selectOption('#focus', { label: 'partition' });
    await expect(page).toHaveURL(/[?&]t=1/);
    await expect(page.locator('#parties .hint')).toContainText('partition');
  });

  test('splits by chamber and by party, and keeps the view in the URL', async ({ page }) => {
    await routeWords(page);
    await page.goto(PAGE + '?q=housing');
    await expect(page.locator('#panels svg')).toHaveCount(1);
    await page.selectOption('#split', 'body');
    await expect(page).toHaveURL(/split=body/);
    await expect(page.locator('#panels .legend li')).toHaveText(['Dáil', 'Seanad', 'Commons', 'NI Assembly', 'Lords']);
    await page.selectOption('#split', 'party');
    await expect(page.locator('#pbField')).toBeVisible();
    await expect(page.locator('#panels .legend')).toContainText('Fianna Fáil');
    await page.selectOption('#pb', 'nia');
    await expect(page.locator('#panels .legend')).toContainText('Democratic Unionist Party');
    // One DUP line, not two: "DUP" and "Democratic Unionist Party" are one party record.
    await expect(page.locator('#panels .legend li', { hasText: /^DUP$/ })).toHaveCount(0);
    await page.uncheck('#b-commons');
    await page.selectOption('#sm', '2');
    await page.fill('#from', '1990');
    await page.locator('#from').press('Enter');
    await expect(page).toHaveURL(/b=dail,seanad,nia,lords/);
    await expect(page).toHaveURL(/sm=2/);
    await expect(page).toHaveURL(/from=1990/);
    await page.reload();
    await expect(page.locator('#split')).toHaveValue('party');
    await expect(page.locator('#pb')).toHaveValue('nia');
    await expect(page.locator('#b-commons')).not.toBeChecked();
    await expect(page.locator('#sm')).toHaveValue('2');
    await expect(page.locator('#from')).toHaveValue('1990');
    await expect(page.locator('#panels .legend')).toContainText('Democratic Unionist Party');
  });

  test('reads a year with the keyboard and downloads the plotted series as CSV', async ({ page }) => {
    await routeWords(page);
    await page.goto(PAGE + '?q=housing&split=body');
    const plot = page.locator('#panels .plot').first();
    await expect(plot.locator('svg')).toBeVisible();
    await plot.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#panels .live').first()).toContainText('2025: Dáil');
    await expect(plot.locator('.tip')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#csvBtn')]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('term,language,lines,series,year,uses,words,per_million,per_million_smoothed,smoothing_years');
    expect(lines.some((l) => /^housing,en,body,Dáil,2020,\d+,\d+,/.test(l))).toBe(true);
  });

  test('Irish counts are a separate toggle', async ({ page }) => {
    await routeWords(page);
    await page.goto(PAGE);
    await expect(page.locator('#empty')).toBeVisible();
    await page.getByRole('button', { name: 'gaeilge (in Irish)' }).click();
    await expect(page).toHaveURL(/lang=ga/);
    await expect(page.locator('input[name="lang"][value="ga"]')).toBeChecked();
    await expect(page.locator('#status')).toContainText('(in Irish)');
    await expect(page.locator('#panels svg path.ln').first()).toBeVisible();
    // The same word in the English counts is a different lookup, not the Irish one.
    await page.check('input[name="lang"][value="en"]', { force: true });
    await expect(page).not.toHaveURL(/lang=ga/);
  });

  test('says why a term is missing, and offers a retry when loading fails', async ({ page }) => {
    await routeWords(page, { fail: /^terms\/en\/2\// });
    await page.goto(PAGE + '?q=housing,zzqxv,a+long+phrase+here,home+rule');
    const warn = page.locator('#notices .notice.warn');
    await expect(warn).toContainText('“zzqxv”');
    await expect(warn).toContainText('only single words and two-word phrases');
    await expect(page.locator('#notices .notice.err')).toContainText('home rule');
    await expect(page.locator('#notices .notice.err button')).toHaveText('Try again');
    // The term that did load is still charted.
    await expect(page.locator('#panels .legend, #panels svg').first()).toBeVisible();
  });

  test('suggests terms as you type', async ({ page }) => {
    await routeWords(page);
    await page.goto(PAGE);
    await page.locator('#q').pressSequentially('hous');
    const option = page.locator('#suggest [role="option"]', { hasText: 'housing' }).first();
    await expect(option).toBeVisible();
    await expect(page.locator('#q')).toHaveAttribute('aria-expanded', 'true');
    // The first option is the most used term with that prefix; arrow keys move through them.
    const first = await page.locator('#suggest [role="option"]').first().locator('span').first().textContent();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#q')).toHaveAttribute('aria-activedescendant', 'sug-0');
    await page.keyboard.press('Enter');
    await expect(page.locator('#q')).toHaveValue(first);
    await page.locator('#q').fill('partition, housin');
    await page.locator('#q').press('g');
    await page.locator('#suggest [role="option"]', { hasText: 'housing' }).first().click();
    await expect(page.locator('#q')).toHaveValue('partition, housing');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/q=partition,housing/);
  });

  test('fits a phone screen', async ({ page }) => {
    await routeWords(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(PAGE + '?q=housing,partition');
    await expect(page.locator('#panels svg')).toBeVisible();
    await expect(page.locator('#speakers tbody tr').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const theme of ['light', 'dark']) {
    test(`no serious accessibility failures (${theme})`, async ({ page }) => {
      const AxeBuilder = require('@axe-core/playwright').default;
      await routeWords(page);
      await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* */ } }, theme);
      for (const q of ['', '?q=housing,partition&split=party']) {
        await page.goto(PAGE + q);
        if (q) await expect(page.locator('#speakers tbody tr').first()).toBeVisible();
        else await expect(page.locator('#empty')).toBeVisible();
        const res = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
        const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
        expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
      }
    });
  }
});
