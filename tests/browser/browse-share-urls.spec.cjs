/**
 * Browse addresses that share well (QA 2026-11-11, H1): a record opened inside Browse shows its
 * own page's path (/browse/parties/alpha) in the address bar, the path the server renders with the
 * record's title and link-preview tags, rather than /browse/#/parties/alpha, whose fragment never
 * reaches the server. Old hash addresses still open the record and are rewritten to the path;
 * Back returns to the list; lists stay in the hash.
 *
 *   npx playwright test --config config/playwright.config.cjs tests/browser/browse-share-urls.spec.cjs
 */
const { test, expect } = require('@playwright/test');

let pageErrors = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ALPHA = { id: 'alpha', slug: 'alpha', title: 'Alpha Party' };

async function stubBrowse(page) {
  await page.route('**/data/browse/index.json', (route) => route.fulfill(json({ counts: { parties: 2 }, groups: [] })));
  await page.route((url) => url.pathname === '/_api/parties', (route) => {
    const slug = new URL(route.request().url()).searchParams.get('slug');
    return route.fulfill(json(slug
      ? { item: ALPHA }
      : { items: [ALPHA, { id: 'bravo', slug: 'bravo', title: 'Bravo Party' }] }));
  });
  const auth = { authenticated: false, allowed: false };
  await page.route('**/_api/auth/status', (route) => route.fulfill(json({ auth })));
  await page.route('**/_api/contributions/whoami', (route) => route.fulfill(json({ auth })));
}

test.describe('Browse share addresses', () => {
  test('a record link is the record\'s page, and opening it shows that path', async ({ page }) => {
    await stubBrowse(page);
    await page.goto('/browse/#/parties');
    const link = page.locator('a[data-browse-link]', { hasText: 'Alpha Party' }).first();
    await expect(link).toHaveAttribute('href', '/browse/parties/alpha');
    await link.click();
    await expect(page).toHaveURL(/\/browse\/parties\/alpha$/);
    await expect(page.locator('#browseHero h1')).toHaveText('Alpha Party');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://civgraph.net/browse/parties/alpha');

    // Back is the list again, still in the hash.
    await page.goBack();
    await expect(page).toHaveURL(/\/browse\/#\/parties$/);
    await expect(page.locator('a[data-browse-link]', { hasText: 'Bravo Party' }).first()).toBeVisible();
    // And Forward the record.
    await page.goForward();
    await expect(page).toHaveURL(/\/browse\/parties\/alpha$/);
    await expect(page.locator('#browseHero h1')).toHaveText('Alpha Party');
  });

  test('an old #/ record address opens the record and becomes its path, with no extra history entry', async ({ page }) => {
    await stubBrowse(page);
    await page.goto('/browse/');
    await page.goto('/browse/#/parties/alpha');
    await expect(page).toHaveURL(/\/browse\/parties\/alpha$/);
    await expect(page.locator('#browseHero h1')).toHaveText('Alpha Party');
    const length = await page.evaluate(() => history.length);
    expect(length).toBeLessThanOrEqual(3);
  });

  // A retired election slug (packages/core/src/election-slug-aliases.js): browse.js keeps no copy of
  // the list. It asks the API for the old slug as for any record, fetch follows the 301 the API
  // answers with (tests/functions/election-slug-aliases.test.mjs), and browse.js shows the record
  // at its own address. page.route sees only the first request of a redirect, so the stub answers
  // the old slug as the followed 301 does: with the current record.
  test('an old #/ election address follows the API 301 and becomes the current record path', async ({ page }) => {
    const OLD = 'castlederg-rural-district-council-1936-06-03-clue';
    const NOW = 'castlederg-rural-district-council-1936-06-03-clare';
    const asked = [];
    await stubBrowse(page);
    await page.route((url) => url.pathname === '/_api/elections', (route) => {
      const url = new URL(route.request().url());
      const slug = url.searchParams.get('slug');
      if (url.searchParams.get('view') !== 'record') return route.fulfill(json({ error: 'not found' }, 404));
      asked.push(slug);
      if (slug === OLD || slug === NOW) return route.fulfill(json({ item: { slug: NOW, title: 'Clare', constituency: 'Clare', date: '1936-06-03' }, parent: { slug: 'castlederg-rural-district-council-1936-06-03' } }));
      return route.fulfill(json({ error: 'not found', slug }, 404));
    });
    await page.goto('/browse/');
    await page.goto(`/browse/#/elections/${OLD}`);
    await expect(page).toHaveURL(new RegExp(`/browse/elections/${NOW}$`));
    await expect(page.locator('#browseHero h1')).toContainText('Clare');
    // One request: the old slug, answered with the current record; the address changes in place.
    expect(asked).toEqual([OLD]);
    const length = await page.evaluate(() => history.length);
    expect(length).toBeLessThanOrEqual(3);
  });

  test('lists keep their address in the hash', async ({ page }) => {
    await stubBrowse(page);
    await page.goto('/browse/');
    await page.evaluate(() => { location.hash = '#/parties?q=alpha'; });
    await expect(page).toHaveURL(/\/browse\/#\/parties\?q=alpha$/);
  });
});
