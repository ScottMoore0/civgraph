const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Layout shift on the pages the launch QA measured above the 0.1 "good" line (QA 2026-11-11, M16):
// Census Explorer 0.59, Words in parliament 0.36, a PRONI record 0.35, Maps 0.27. Each is loaded
// the slow way that produced the shift (late stylesheet, late API answer) and must stay under 0.1.

const ROOT = path.join(__dirname, '..', '..');

async function trackShifts(page) {
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cls = (page) => page.evaluate(() => window.__cls);

test.use({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' });

test('Census Explorer: the counts line and the loading panel hold their space', async ({ page }) => {
  await trackShifts(page);
  await page.goto('/pages/census-explorer.html');
  await page.waitForFunction(() => document.querySelectorAll('#statLine li').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  expect(await cls(page)).toBeLessThan(0.1);
  await expect(page.locator('#loadNotice')).toBeHidden();
});

test('Words in parliament: the chamber chips and examples hold their space', async ({ page }) => {
  await trackShifts(page);
  await page.goto('/apps/words/');
  await page.waitForFunction(() => document.querySelectorAll('#bodyChips .chip').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  expect(await cls(page)).toBeLessThan(0.1);
});

test('Maps: the shared stylesheet arriving late moves nothing', async ({ page }) => {
  await trackShifts(page);
  await page.route((url) => url.pathname === '/build/main.css', async (route) => { await delay(800); await route.continue(); });
  await page.goto('/maps/');
  await page.waitForFunction(() => window.__civgraphTest2?.runtimeReadyAt && document.querySelector('.cn-tab'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  expect(await cls(page)).toBeLessThan(0.1);
});

test('PRONI record: the footer is not drawn in view and then pushed out', async ({ page }) => {
  await trackShifts(page);
  // The /proni/<ref> shell is served by a Function in production (functions/_proni-shell.js);
  // here the same HTML is answered for the address, and the record API answers late.
  const shell = fs.readFileSync(path.join(ROOT, 'site', 'apps', 'proni-search', 'index.html'));
  await page.route((url) => url.pathname.startsWith('/proni/'), (route) => route.fulfill({ contentType: 'text/html', body: shell }));
  await page.route((url) => url.pathname.startsWith('/_api/proni/node'), async (route) => {
    await delay(700);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ item: { ref: 'LA/7/1/CA/1/3', slug: 'la-7-1-ca-1-3', title: 'Register of Members', level: 'Item', dates: '1898-1900', description: 'A register. '.repeat(60), access: 'Open', hasChildren: false, fond: 'LA/7' }, ancestors: [], children: [] })
    });
  });
  await page.goto('/proni/LA/7/1/CA/1/3');
  await expect(page.locator('#viewRecord')).toContainText('Register of Members', { timeout: 30000 });
  await page.waitForTimeout(500);
  expect(await cls(page)).toBeLessThan(0.1);
  // Going home in the app shows the search again: the first-paint hold is gone.
  await page.evaluate(() => { history.pushState(null, '', '/proni'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('#viewSearch')).toBeVisible();
});
