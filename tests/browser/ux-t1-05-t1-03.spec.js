const { test, expect } = require('@playwright/test');

/**
 * T1-05 (visible heading, lede, per-view title) and T1-03 (search live region).
 *
 * Both were verified as broken on the live site before the fix: no rendered h1,
 * document.title === 'Civgraph' in every state, and aria-live on the whole result list.
 */
test.use({ serviceWorkers: 'block' });
const { BASE } = require('./helpers/base-url');

test('T1-05 · the page has a visible heading, a lede, and a descriptive title', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(() => {
    const h1s = [...document.querySelectorAll('h1')].filter((h) => h.offsetParent);
    return {
      visibleH1Count: h1s.length,
      h1Text: (h1s[0]?.innerText || '').trim(),
      lede: (document.querySelector('.catalogue-intro__lede')?.innerText || '').trim(),
      title: document.title,
    };
  });
  expect(r.visibleH1Count).toBeGreaterThan(0);
  expect(r.h1Text.length, `h1 text was empty`).toBeGreaterThan(10);
  expect(r.lede.length).toBeGreaterThan(20);
  expect(r.title).not.toBe('Civgraph');
  expect(r.title).toContain('Civgraph');
});

test('T1-05 · the title reflects a loaded layer', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const r = await page.evaluate(async () => {
    const t = window.__civgraphTest2;
    const before = document.title;
    await t.app.loadMap('eds-leinster-1941');
    await new Promise((res) => t.mapController.map.once('idle', res));
    t.app.updateURLState();
    await new Promise((res) => setTimeout(res, 400));
    return { before, after: document.title };
  });
  expect(r.after).not.toBe(r.before);
  expect(r.after).toMatch(/1941/);
});

test('T1-03 · the live region is the summary only, and typing announces once', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__liveUpdates = [];
    const obs = new MutationObserver(() => {
      document.querySelectorAll('[aria-live]').forEach((n) => {
        if (!n.closest('.catalogue-search')) return;
        const t = (n.innerText || '').trim();
        if (t && window.__liveUpdates[window.__liveUpdates.length - 1] !== t) window.__liveUpdates.push(t);
      });
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await page.type('#searchInput', 'Ballymena', { delay: 55 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const section = document.querySelector('section.catalogue-search');
    const summary = document.querySelector('.catalogue-search__summary');
    return {
      sectionHasLive: section ? section.hasAttribute('aria-live') : null,
      summaryLive: summary?.getAttribute('aria-live') || null,
      summaryAtomic: summary?.getAttribute('aria-atomic') || null,
      summaryLen: (summary?.innerText || '').trim().length,
      updates: window.__liveUpdates.length,
    };
  });
  expect(r.sectionHasLive, 'aria-live is still on the whole results section').toBe(false);
  expect(r.summaryLive).toBe('polite');
  expect(r.summaryAtomic).toBe('true');
  // a short summary, not the whole 80-result list
  expect(r.summaryLen).toBeLessThan(120);
  // nine keystrokes must not produce nine announcements
  expect(r.updates, `announcements: ${r.updates}`).toBeLessThanOrEqual(3);
});
