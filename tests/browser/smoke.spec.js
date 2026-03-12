const { test, expect } = require('@playwright/test');

test('homepage shell loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: /support us/i })).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
});
