const { test, expect } = require('@playwright/test');

/**
 * Browse record pages render from the records APIs (data design phase 2, stage F).
 *
 * Opens fixed records of every phase-2 type in the Browse app, waits for the record to render
 * and checks the panel has its content, that no request went to the retired graph files, and
 * that the page logged no errors. Needs Pages Functions and a local D1: run it against
 * `npm run dev:records` (wrangler pages dev on port 8788 with the records loaded by
 * `npm run records:deploy -- --local`):
 *
 *   PARITY_BASE_URL=http://127.0.0.1:8788 npx playwright test --config config/playwright.config.cjs tests/browser/browse-records.spec.cjs
 */
const { BASE } = require('./helpers/base-url.cjs');

const RECORDS = [
  ['persons', 'ian-paisley-48601', /Paisley/],
  ['persons', '104292', /Parker|Chichester/],
  ['parties', 'uup', /Ulster Unionist/],
  ['parties', 'administrator-alliance', /Alliance/],
  ['elections', 'northern-ireland-assembly-2022-05-05', /Northern Ireland Assembly/],
  ['elections', 'northern-ireland-assembly-2022-05-05-belfast-east', /Belfast East/],
  ['elections', 'northern-ireland-forum-for-political-dialogue-1996-05-30-regional-list', /Regional|Forum/],
  ['elections', 'dail-eireann-2024-11-29-cork-north-central', /Cork North/],
  ['sources', 'election-source-house-of-commons-of-the-united-kingdom-1878-12-18', /1878|Commons/],
  ['register-interests', 'ni-register-record-000eb0d4af017f1a', /interest/i],
];

for (const [type, slug, expected] of RECORDS) {
  test(`${type}/${slug} renders from the APIs`, async ({ page }) => {
    const errors = [];
    const retired = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('request', (r) => { if (/\/data\/graph\/|election-contest-parents|\/votes\/(persons|divisions)\//.test(r.url())) retired.push(r.url()); });
    await page.goto(`${BASE}/browse/#/${type}/${encodeURIComponent(slug)}`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('#browseResults');
    await expect(panel).not.toHaveText(/Loading|could not be loaded|not found/i, { timeout: 30_000 });
    await expect(page.locator('main')).toContainText(expected, { timeout: 30_000 });
    expect(retired, 'no request to the retired graph or shard files').toEqual([]);
    expect(errors).toEqual([]);
  });
}

// A presidential election's page shows its results by area (view=areas): one row a constituency,
// a column a candidate, and every count of each area folded beneath.
test('elections/ireland-president-2011-10-27 shows its results by constituency', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/browse/#/elections/ireland-president-2011-10-27`, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('.browse-area-results');
  await expect(panel.locator('h2')).toHaveText('Results by constituency', { timeout: 30_000 });
  await expect(panel.locator('table').first().locator('tbody tr')).toHaveCount(43);
  await expect(panel.locator('table').first().locator('thead th')).toHaveCount(1 + 7 + 2);
  await expect(panel.locator('details.browse-area-counts')).toHaveCount(43);
  await expect(panel).toContainText('Michael D Higgins');
  expect(errors).toEqual([]);
});
