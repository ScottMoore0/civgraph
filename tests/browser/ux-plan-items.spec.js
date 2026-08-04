const { test, expect } = require('@playwright/test');

/**
 * Verify the UX-plan items implemented on 2026-08-04 against the live site.
 *
 * Each assertion is the plan's own acceptance criterion, measured rather than eyeballed.
 * The service worker is blocked so nothing is served from its runtime cache.
 */
test.use({ serviceWorkers: 'block' });
const BASE = process.env.PARITY_BASE_URL || 'https://civgraph.net';

test('T3-03 · no visible target under 24px except the focus-reveal skip links', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const bad = await page.evaluate(() => [...document.querySelectorAll('button, a, [role="button"]')]
    .filter((el) => {
      if (!el.offsetParent) return false;
      if (el.classList.contains('visually-hidden')) return false; // sized up on focus
      // MapLibre's attribution links are inline text inside a sentence
      // ("(c) MapLibre (c) OpenStreetMap"), which is the SC 2.5.8 inline exception, and
      // they are third-party markup we must not restyle -- attribution is a licence
      // condition. Excluded deliberately, not overlooked.
      if (el.closest('.maplibregl-ctrl-attrib, .maplibregl-ctrl-attrib-inner')) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.width < 24 || b.height < 24);
    })
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`));
  expect(bad, `undersized: ${JSON.stringify(bad.slice(0, 8))}`).toEqual([]);
});

test('T2-08 · search exposes combobox semantics and tracks the active option', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  const before = await page.evaluate(() => {
    const i = document.getElementById('searchInput');
    return { role: i.getAttribute('role'), expanded: i.getAttribute('aria-expanded'), controls: i.getAttribute('aria-controls') };
  });
  expect(before.role).toBe('combobox');
  expect(before.expanded).toBe('false');
  expect(before.controls).toBe('searchAutocomplete');

  await page.fill('#searchInput', 'Ballymena');
  await page.waitForTimeout(1200);
  await page.press('#searchInput', 'ArrowDown');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const i = document.getElementById('searchInput');
    const list = document.getElementById('searchAutocomplete');
    const opts = [...list.querySelectorAll('.search-autocomplete__item')];
    const active = i.getAttribute('aria-activedescendant');
    return {
      expanded: i.getAttribute('aria-expanded'),
      listRole: list.getAttribute('role'),
      optionCount: opts.length,
      allOptions: opts.every((o) => o.getAttribute('role') === 'option'),
      active,
      activeMatchesSelected: !!active && document.getElementById(active)?.classList.contains('search-autocomplete__item--selected'),
    };
  });
  expect(after.listRole).toBe('listbox');
  expect(after.optionCount).toBeGreaterThan(0);
  expect(after.allOptions).toBe(true);
  expect(after.expanded).toBe('true');
  expect(after.activeMatchesSelected).toBe(true);
});

test('T1-09 · Escape closes the map control panel', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(async () => {
    const toggle = document.getElementById('mapControlsToggle');
    if (!toggle) return { skipped: 'no mapControlsToggle' };
    toggle.click();
    await new Promise((r) => setTimeout(r, 500));
    const opened = toggle.getAttribute('aria-expanded') === 'true';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return { opened, closed: toggle.getAttribute('aria-expanded') !== 'true' };
  });
  expect(result.skipped, `skipped: ${result.skipped}`).toBeUndefined();
  expect(result.opened).toBe(true);
  expect(result.closed).toBe(true);
});
