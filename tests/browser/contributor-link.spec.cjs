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
