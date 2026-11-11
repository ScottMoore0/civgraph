const { test, expect } = require('@playwright/test');

// Browse's contributor sign-in (site/browse/browse.js renderContributorPanel; QA 2026-11-11, M14):
// not offered to every visitor, whom it sent to a Cloudflare Access sign-in they cannot use, but
// on an address carrying ?contribute and from then on in that browser.

test('a public visitor is not offered the contributor sign-in', async ({ page }) => {
  await page.goto('/browse/');
  await page.waitForFunction(() => document.getElementById('contributorPanel')?.hidden === true, null, { timeout: 30000 });
  await expect(page.locator('[data-contributor-login]')).toHaveCount(0);
});

test('?contribute offers it, and the browser remembers', async ({ page }) => {
  await page.goto('/browse/?contribute');
  const login = page.locator('[data-contributor-login]');
  await expect(login).toBeVisible({ timeout: 30000 });
  await expect(login).toHaveAttribute('href', /^\/_api\/contributions\/login\?return=/);
  await page.goto('/browse/');
  await expect(page.locator('[data-contributor-login]')).toBeVisible({ timeout: 30000 });
});

// The map catalogue's row menu (src/catalogue/index.js openSeriesMenu) offered "Suggest an edit
// (contributor sign-in)" to every visitor. It follows the same rule, with the same remembered
// flag (src/catalogue/edit.js contributorLinkWanted).
async function catalogueMenuItems(page, address) {
  await page.goto(address);
  await page.waitForFunction(() => document.getElementById('catalogueFlatView')?.dataset.rendered === 'next', null, { timeout: 60000 });
  const shelf = page.locator('#catalogueFlatView .cn-shelf__toggle').first();
  // The catalogue remembers an open shelf between visits.
  if (await shelf.getAttribute('aria-expanded') !== 'true') await shelf.click();
  await expect(shelf).toHaveAttribute('aria-expanded', 'true');
  const menuButton = page.locator('#catalogueFlatView .cn-shelf__body:not([hidden]) [data-cn-menu]').first();
  await menuButton.click();
  const items = page.locator('.cn-menu [role="menuitem"]');
  await expect(items.first()).toBeVisible();
  const labels = await items.allTextContents();
  await page.keyboard.press('Escape');
  return labels.map((label) => label.trim());
}

test('the map catalogue does not offer a public visitor the contributor sign-in', async ({ page }) => {
  const labels = await catalogueMenuItems(page, '/maps/#layers=__none');
  expect(labels).toContain('Copy link');
  expect(labels.filter((label) => /Suggest an edit/.test(label))).toEqual([]);
});

test('?contribute offers it in the map catalogue, and the browser remembers', async ({ page }) => {
  expect(await catalogueMenuItems(page, '/maps/?contribute#layers=__none')).toContain('Suggest an edit (contributor sign-in)');
  expect(await catalogueMenuItems(page, '/maps/#layers=__none')).toContain('Suggest an edit (contributor sign-in)');
});

test('Browse and the map catalogue share the remembered choice', async ({ page }) => {
  await page.goto('/browse/?contribute');
  await expect(page.locator('[data-contributor-login]')).toBeVisible({ timeout: 30000 });
  expect(await catalogueMenuItems(page, '/maps/#layers=__none')).toContain('Suggest an edit (contributor sign-in)');
});
