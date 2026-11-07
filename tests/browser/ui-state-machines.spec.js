/**
 * Behaviour of the UI state machines in Browse and the PRONI Search app
 * (browse/state-machines.js, apps/proni-search/state-machines.js, assets/ui/state/machine.js).
 *
 * Written against the code before the machines were made explicit and run unchanged after,
 * so it pins what a reader sees through each machine's states:
 *   Browse  - the parties list's ballot-paper labels toggle (light) and the contributor form:
 *             closed -> map submission -> closed, and a submission idle -> submitting ->
 *             sent | failed, with the submit button disabled only while submitting;
 *   PRONI   - the view (search / record / eCatalogue guide), the A-Z scope, a card's sub-records
 *             (collapsed -> loading -> expanded | collapsed on failure -> collapsed), and a
 *             card's description (preview -> loading -> full).
 * The data and the API answers are stubbed with page.route, so no records build is needed. Any
 * uncaught page error (a refused transition throws) fails the test.
 *
 *   npx playwright test tests/browser/ui-state-machines.spec.js
 */
const { test, expect } = require('@playwright/test');

// A move a machine's table refuses throws; any page error fails the test.
let pageErrors = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubBrowse(page, { allowed = false } = {}) {
  await page.route('**/data/browse/index.json', (route) => route.fulfill(json({ counts: { parties: 2 }, groups: [] })));
  await page.route('**/_api/parties', (route) => route.fulfill(json({
    items: [
      { id: 'alpha', slug: 'alpha', title: 'Alpha Party' },
      { id: 'bravo-label', slug: 'bravo-label', title: 'Bravo Ballot Label', ballotLabel: true },
    ],
  })));
  const auth = allowed
    ? { authenticated: true, allowed: true, email: 'contributor', logoutUrl: '/logout' }
    : { authenticated: false, allowed: false };
  await page.route('**/_api/auth/status', (route) => route.fulfill(json({ auth })));
  await page.route('**/_api/contributions/whoami', (route) => route.fulfill(json({ auth })));
}

test.describe('Browse', () => {
  test('ballot-paper labels toggle on and off, and the address follows', async ({ page }) => {
    await stubBrowse(page);
    await page.goto('/browse/#/parties');
    const button = page.locator('[data-ballot-labels]');
    await expect(button).toHaveText('Show ballot-paper labels');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Alpha Party')).toBeVisible();
    await expect(page.getByText('Bravo Ballot Label')).toHaveCount(0);

    await button.click();
    await expect(page.locator('[data-ballot-labels]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Bravo Ballot Label')).toBeVisible();
    await expect(page).toHaveURL(/labels=1/);

    await page.locator('[data-ballot-labels]').click();
    await expect(page.locator('[data-ballot-labels]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Bravo Ballot Label')).toHaveCount(0);
    await expect(page).not.toHaveURL(/labels=1/);
  });

  test('a ballot-labels address opens with the labels shown', async ({ page }) => {
    await stubBrowse(page);
    await page.goto('/browse/#/parties?labels=1');
    await expect(page.locator('[data-ballot-labels]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Bravo Ballot Label')).toBeVisible();
  });

  for (const outcome of ['sent', 'failed']) {
    test(`contributor map submission: closed -> open -> submitting -> ${outcome} -> closed`, async ({ page }) => {
      await stubBrowse(page, { allowed: true });
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route('**/_api/contributions/submit', async (route) => {
        await held;
        await route.fulfill(outcome === 'sent'
          ? json({ ok: true, submission: { id: 'sub-1' } })
          : json({ ok: false, error: 'Rejected by the stub' }, 422));
      });
      await page.goto('/browse/');
      const modal = page.locator('#contributorModal');
      await expect(modal).toHaveClass(/hidden/);

      await page.locator('[data-contributor-action="submit-map"]').click();
      await expect(modal).not.toHaveClass(/hidden/);
      await page.locator('#contributorForm input[name="title"]').fill('A map');
      await page.locator('#contributorForm textarea[name="summary"]').fill('Why');

      const submit = page.locator('#contributorForm button[type="submit"]');
      const status = page.locator('#contributorForm .contributor-form__status');
      await submit.click();
      await expect(status).toHaveText('Submitting...');
      await expect(status).toHaveAttribute('class', 'contributor-form__status');
      await expect(submit).toBeDisabled();

      release();
      if (outcome === 'sent') {
        await expect(status).toHaveAttribute('class', 'contributor-form__status contributor-form__status--success');
        await expect(status).toContainText('Submitted for review: sub-1.');
      } else {
        await expect(status).toHaveAttribute('class', 'contributor-form__status contributor-form__status--error');
        await expect(status).toHaveText('Rejected by the stub');
      }
      await expect(submit).toBeEnabled();

      await page.locator('#contributorForm [data-contributor-close]').click();
      await expect(modal).toHaveClass(/hidden/);
    });
  }
});

const PRONI_RESULTS = [
  { ref: 'D1', title: 'Alpha papers', level: 'Fonds', hasChildren: true, description: 'A short preview', descTruncated: true },
  { ref: 'D2', title: 'Bravo papers', level: 'Fonds', hasChildren: true },
];

async function stubProni(page, { nodeFails = false } = {}) {
  await page.route('**/_api/proni/search?**', (route) => route.fulfill(json({ results: PRONI_RESULTS })));
  await page.route('**/_api/proni/count?**', (route) => route.fulfill(json({ count: PRONI_RESULTS.length })));
  await page.route('**/_api/proni/node?ref=**', async (route) => {
    const ref = new URL(route.request().url()).searchParams.get('ref');
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (nodeFails && ref === 'D2') return route.fulfill({ status: 500, contentType: 'text/plain', body: 'down' });
    return route.fulfill(json({
      item: { ref, title: `${ref} title`, description: `${ref} full description` },
      children: [{ ref: `${ref}/1`, title: `${ref} child one` }],
      nav: {},
    }));
  });
  await page.route('**/_api/proni/node', (route) => route.fulfill(json({ roots: [], count: 0 })));
}

test.describe('PRONI Search', () => {
  test('sub-records: collapsed -> loading -> expanded -> collapsed', async ({ page }) => {
    await stubProni(page);
    await page.goto('/apps/proni-search/');
    await page.locator('#q').fill('papers');
    const card = page.locator('.ps-card[data-ref="D1"]');
    await expect(card).toBeVisible();
    const expand = card.locator(':scope > .ps-card__sticky [data-expand]');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');

    await expand.click();
    await expect(expand.locator('.ps-expand__label')).toHaveText('Loading…');
    await expect(expand).toBeDisabled();
    await expect(card.locator(':scope > .ps-children')).toBeVisible();
    await expect(card.getByText('D1 child one')).toBeVisible();
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await expect(expand.locator('.ps-expand__label')).toHaveText('Collapse');
    await expect(card).toHaveClass(/is-expanded/);
    await expect(expand).toBeEnabled();

    await expand.click();
    await expect(card.locator(':scope > .ps-children')).toBeHidden();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand.locator('.ps-expand__label')).toHaveText('Expand');
    await expect(card).not.toHaveClass(/is-expanded/);
  });

  test('sub-records that fail to load leave the card collapsed', async ({ page }) => {
    await stubProni(page, { nodeFails: true });
    await page.goto('/apps/proni-search/');
    await page.locator('#q').fill('papers');
    const card = page.locator('.ps-card[data-ref="D2"]');
    const expand = card.locator(':scope > .ps-card__sticky [data-expand]');
    await expand.click();
    await expect(expand.locator('.ps-expand__label')).toHaveText('Expand');
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toBeEnabled();
    await expect(card).not.toHaveClass(/is-expanded/);
    await expect(card.locator(':scope > .ps-children')).toBeHidden();
  });

  test('description: preview -> loading -> full', async ({ page }) => {
    await stubProni(page);
    await page.goto('/apps/proni-search/');
    await page.locator('#q').fill('papers');
    const card = page.locator('.ps-card[data-ref="D1"]');
    const more = card.locator('[data-more]');
    await expect(card.locator('.ps-card__desc')).toHaveText('A short preview…');
    await more.click();
    await expect(more).toHaveText('Show full record');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.ps-card__desc')).toHaveText('D1 full description');
    await expect(card).toHaveClass(/is-expanded/);
    // Once full, the button opens the whole record.
    await more.click();
    await expect(page.locator('#modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).toBeHidden();
  });

  test('A-Z scope: a letter, the same letter again, All on, then a letter', async ({ page }) => {
    await stubProni(page);
    await page.goto('/apps/proni-search/');
    const a = page.locator('.ps-az__btn[data-letter="A"]');
    const all = page.locator('.ps-az__clear');
    await a.click();
    await expect(a).toHaveClass(/is-active/);
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await a.click();
    await expect(a).not.toHaveClass(/is-active/);
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveClass(/is-active/);
    await page.locator('.ps-az__btn[data-letter="B"]').click();
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.ps-az__btn[data-letter="B"]')).toHaveClass(/is-active/);
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.ps-az__btn.is-active')).toHaveCount(0);
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  test('views: search -> record -> search -> eCatalogue guide', async ({ page }) => {
    await stubProni(page);
    await page.goto('/apps/proni-search/');
    await page.locator('#q').fill('papers');
    await page.locator('.ps-card[data-ref="D1"] .ps-card__title').click();
    await expect(page.locator('#viewRecord')).toBeVisible();
    await expect(page.locator('#viewSearch')).toBeHidden();
    await expect(page).toHaveTitle('D1 - Independent PRONI Search');

    await page.goBack();
    await expect(page.locator('#viewSearch')).toBeVisible();
    await expect(page.locator('#viewRecord')).toBeHidden();
    await expect(page).toHaveTitle('Independent PRONI Search');

    await page.locator('.ps-card[data-ref="D1"] [data-ecat]').first().click();
    await expect(page.locator('#viewEcat')).toBeVisible();
    await expect(page.locator('#viewSearch')).toBeHidden();
    await expect(page.locator('#viewRecord')).toBeHidden();
  });
});
