const { test, expect } = require('@playwright/test');

// The homepage on a phone (QA 2026-11-11, M1 and M2): the two primary actions above the fold of a
// 375x812 screen, the lede and the figures readable from the first paint (never faded in from 0 or
// counted up from 0), and the Apps card naming the three apps that are live.

test.use({ viewport: { width: 375, height: 812 } });

test('both primary actions are above the fold on a 375x812 phone', async ({ page }) => {
  await page.goto('/');
  const box = await page.locator('.hero .cta-row').boundingBox();
  expect(box).toBeTruthy();
  expect(box.y + box.height, 'the buttons end inside the first screen').toBeLessThanOrEqual(812);
  const graphic = await page.locator('.hero__graphic').boundingBox();
  expect(graphic.y, 'the network graphic comes after the buttons').toBeGreaterThan(box.y);
});

test('the lede and the figures are shown from the first paint, not animated in from nothing', async ({ page }) => {
  await page.goto('/');
  // Read straight away, before any animation could finish.
  const state = await page.evaluate(() => ({
    lede: getComputedStyle(document.querySelector('.hero .lede')).visibility,
    ledeOpacity: Number(getComputedStyle(document.querySelector('.hero .lede')).opacity),
    figures: [...document.querySelectorAll('.stat__n[data-count]')].map((el) => [el.textContent, Number(el.dataset.count).toLocaleString('en-GB')])
  }));
  expect(state.lede).toBe('visible');
  expect(state.ledeOpacity).toBe(1);
  expect(state.figures.length).toBeGreaterThan(3);
  for (const [shown, final] of state.figures) expect(shown).toBe(final);
});

test('the Apps card names the three live apps', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.card', { has: page.locator('h3', { hasText: 'Apps' }) });
  await expect(card).not.toContainText('intended');
  for (const href of ['/proni', '/pages/census-explorer.html', '/apps/words/']) {
    await expect(card.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
});
