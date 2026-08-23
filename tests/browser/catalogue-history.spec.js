const { test, expect } = require('@playwright/test');

// UX plan T3-09 (#168). #catalogueHistory is a VISIBLE button titled "History" whose
// entire body was a console.log, so it had never done anything a user could see. The
// entries already existed and back/forward already worked; only the list was missing.
test('the History button lists visited entries and navigates to one', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length, null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const button = page.locator('#catalogueHistory');
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');

  // Build some history by opening a map's detail view.
  await page.evaluate(() => {
    const controller = window.uiController;
    controller.showCatalogueDetailView('provinces-1955');
    controller.showCatalogueListView(true);
  });
  await page.waitForTimeout(800);

  await button.click();
  const popup = page.locator('#catalogueHistoryPopup');
  await expect(popup).toHaveCount(1);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const items = popup.locator('.catalogue-history-popup__item');
  await expect(items.first()).toBeVisible();

  // Escape closes it and returns focus to the button rather than dropping it to <body>.
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('catalogueHistory');

  // Choosing an entry navigates to it and closes the popup.
  await button.click();
  const count = await popup.locator('.catalogue-history-popup__item').count();
  expect(count).toBeGreaterThan(0);
  await popup.locator('.catalogue-history-popup__item').last().click();
  await expect(popup).toHaveCount(0);
});
