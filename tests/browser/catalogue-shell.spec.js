const { test, expect } = require('@playwright/test');

// The catalogue pane's sticky shell: basemap, blurb placement, and dark-mode legibility.
// All three regressed together and none had a test.

test('the basemap is OpenStreetMap in both themes', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  expect(await page.evaluate(() => window.__civgraphTest2.app.baseMapId)).toBe('osm-standard');

  // Dark mode used to switch to cartodb-dark (T1-06). CARTO now requires an API key and
  // serves tiles with "API KEY REQUIRED" printed across them at HTTP 200 -- so nothing
  // could detect the failure and the map simply rendered the watermark.
  await page.locator('#themeToggle').click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(await page.evaluate(() => window.__civgraphTest2.app.baseMapId)).toBe('osm-standard');
});

test('no basemap option points at a source that needs a key or is gone', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#baseMapSelect', { state: 'attached', timeout: 60000 });
  const values = await page.evaluate(() =>
    [...document.querySelectorAll('#baseMapSelect option')].map((o) => o.value));
  expect(values.length).toBeGreaterThan(3);
  // CARTO watermarks every tile without a key; Stamen's host returns 503.
  for (const value of values) {
    expect(value, `${value} is a dead or keyed basemap`).not.toMatch(/^cartodb-|^stamen-/);
  }
});

test('the blurb sits on its own row above the search bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const box = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width };
    };
    return { intro: rect('.catalogue-intro'), search: rect('.search-input'), nav: rect('#catalogueNav') };
  });

  expect(box.intro).toBeTruthy();
  expect(box.search).toBeTruthy();
  // The shell is a two-column grid and has three children. Without an explicit span the
  // intro took column 1 and the search box sat BESIDE it in column 2, pushing the nav
  // buttons on to a row of their own -- which is how this broke when the blurb was added.
  expect(box.intro.bottom, 'the blurb must end above the search bar').toBeLessThanOrEqual(box.search.top);
  expect(box.intro.left, 'the blurb must start at the pane edge, not beside the search').toBeLessThanOrEqual(box.search.left);
  // Search and nav share the row below.
  expect(Math.abs(box.search.top - box.nav.top)).toBeLessThan(40);
});

test('the blurb is legible in dark mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.locator('#themeToggle').click();
  await page.waitForTimeout(1500);

  const contrast = await page.evaluate(() => {
    const parse = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const channel = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratio = (fg, bg) => {
      const [a, b] = [lum(parse(fg)), lum(parse(bg))].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    };
    // The shell's own background is translucent, so measure against the pane behind it.
    const bg = getComputedStyle(document.querySelector('.pane--info')).backgroundColor;
    return {
      heading: ratio(getComputedStyle(document.querySelector('.catalogue-intro__heading')).color, bg),
      lede: ratio(getComputedStyle(document.querySelector('.catalogue-intro__lede')).color, bg),
    };
  });

  // --color-primary is #1a365d and is NOT overridden in dark mode, so the heading used to
  // render dark navy on a #0f1419 panel: present, and effectively unreadable. WCAG AA for
  // normal text is 4.5:1.
  expect(contrast.heading).toBeGreaterThan(4.5);
  expect(contrast.lede).toBeGreaterThan(4.5);
});
