const { test, expect } = require('@playwright/test');

/**
 * Verify the UX-plan items implemented on 2026-08-04 against the live site.
 *
 * Each assertion is the plan's own acceptance criterion, measured rather than eyeballed.
 * The service worker is blocked so nothing is served from its runtime cache.
 */
test.use({ serviceWorkers: 'block' });
const { BASE } = require('./helpers/base-url');

/**
 * Open a maps section so the catalogue's load buttons exist.
 *
 * The catalogue opens on a TABLE OF CONTENTS -- section headings and decade buttons, no
 * cards. T1-01/T1-02 below probed the bare homepage for a load button, found none, and
 * skipped ITSELF, so the only keyboard-and-announcement coverage in the suite had never
 * run once. Measured 2026-08-23: clicking one maps section yields 61 load buttons, 20 of
 * them visible.
 *
 * Navigate the product rather than loosening the assertions -- the claim under test is
 * about focus and announcements during a real activation, and a presence check would
 * stay green while testing nothing.
 */
async function openMapsSection(page) {
  const section = page.locator('#catalogueFlatView .catalogue-flat__toc-map-btn').first();
  await section.click({ timeout: 30000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.load-btn[data-map-id], .c1-load-btn[data-map-id]')]
      .some((button) => button.offsetParent),
    null,
    { timeout: 30000 },
  );
}

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

/**
 * T2-08 is deliberately NOT implemented, and this records why.
 *
 * The plan asked for the combobox/listbox pattern on the search field. But
 * renderAutocomplete() is defined and never called -- every reference in
 * ui-controller.js is hideAutocomplete() -- so the dropdown is dead code and the field
 * renders its results inline into the page instead. Measured on the live site across
 * plain, postcode, coordinate and place-name queries: the list stays hidden every time.
 *
 * Applying role="combobox" with aria-controls therefore advertises a popup that never
 * appears, which is worse for a screen-reader user than the plain field: it promises an
 * interaction that does not exist. The correct pattern for "type and results appear
 * below" is a search input plus a live region announcing the count, which T1-03 already
 * implemented. Revisit only if the dropdown is brought back.
 */
test('T2-08 · the search field does not advertise a popup it never shows', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  const state = await page.evaluate(() => {
    const i = document.getElementById('searchInput');
    return { role: i.getAttribute('role'), controls: i.getAttribute('aria-controls'), label: i.getAttribute('aria-label') };
  });
  expect(state.role).toBeNull();
  expect(state.controls).toBeNull();
  expect(state.label).toBeTruthy();
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

test('T1-01 + T1-02 · a keyboard-driven load keeps focus and is announced', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await openMapsSection(page);

  const result = await page.evaluate(async () => {
    // The real selector, from ui-controller.loadButtonSelector().
    const btn = [...document.querySelectorAll('.load-btn[data-map-id], .c1-load-btn[data-map-id]')]
      .find((b) => b.offsetParent);
    if (!btn) return { skipped: 'no load button found' };
    const announcer = document.getElementById('announcer');
    const seen = [];
    const obs = new MutationObserver(() => {
      const t = (announcer.textContent || '').trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    });
    if (announcer) obs.observe(announcer, { childList: true, characterData: true, subtree: true });

    btn.focus();                       // simulate the keyboard path
    const focusedBefore = document.activeElement === btn;
    btn.click();
    await new Promise((r) => setTimeout(r, 12000));
    obs.disconnect();
    const active = document.activeElement;
    return {
      focusedBefore,
      announcements: seen,
      focusAfterIsLoadButton: !!(active && active.matches?.('.load-btn[data-map-id], .c1-load-btn[data-map-id]')),
      focusAfterTag: active ? active.tagName : 'none',
    };
  });

  // Deliberately NOT test.skip() any more. Skipping on a missing button is what let this
  // test sit green and unrun; if openMapsSection stops producing one, that is a finding
  // about the catalogue and it should fail loudly.
  expect(result.skipped, `no load button after opening a maps section: ${result.skipped}`).toBeUndefined();
  expect(result.focusedBefore).toBe(true);
  // T1-02: a start and an outcome, not silence
  expect(result.announcements.length, `announcements: ${JSON.stringify(result.announcements)}`).toBeGreaterThanOrEqual(2);
  expect(result.announcements.some((a) => /^Loading /.test(a))).toBe(true);
  expect(result.announcements.some((a) => / loaded$| failed to load$/.test(a))).toBe(true);
  // T1-01: focus is on a load button, not dumped to <body>
  expect(result.focusAfterTag, `focus went to ${result.focusAfterTag}`).not.toBe('BODY');
  expect(result.focusAfterIsLoadButton).toBe(true);
});
