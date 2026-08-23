const { test, expect } = require('@playwright/test');

// UX triage T1-08: "accessible names for three chrome controls".
//
// The triage could not close this because the original audit's probe output was gone, so
// nobody could say WHICH three controls were meant. `src/ui-controller.js` had 10
// aria-labels by then and there was no way to attribute them.
//
// Re-measuring settles it without needing the original list: instead of checking three
// named controls, check that NO visible interactive control lacks an accessible name.
// Measured 2026-08-23: zero, on the default view and with the panels open. Whatever the
// three were, they have names now.
//
// Kept as a test rather than reported as a result, because "we fixed the three" decays
// the moment someone adds a fourth icon-only button.

async function unnamedControls(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select')) {
      if (!el.offsetParent) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const name = (el.getAttribute('aria-label') || '').trim()
        || (el.getAttribute('title') || '').trim()
        || (el.textContent || '').trim()
        || (el.getAttribute('alt') || '').trim()
        || (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '')
        || (el.getAttribute('aria-labelledby') ? 'labelledby' : '');
      if (!name) {
        out.push([el.tagName, el.id || '(no id)', String(el.className || '').slice(0, 60)].join(' '));
      }
    }
    return out;
  });
}

test('every visible control has an accessible name', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const onLoad = await unnamedControls(page);
  expect(onLoad, `unnamed controls on the default view:\n${onLoad.join('\n')}`).toEqual([]);

  // Icon-only buttons cluster in the panels, which is exactly where an unnamed control
  // is most likely and least visible, so open them before the second sweep.
  await page.locator('#activeLayersToggle').click({ timeout: 20000 }).catch(() => {});
  await page.locator('#mapControlsToggle').click({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const withPanels = await unnamedControls(page);
  expect(withPanels, `unnamed controls with panels open:\n${withPanels.join('\n')}`).toEqual([]);
});
