const { test, expect } = require('@playwright/test');

/**
 * T1-01 (focus restoration) and T1-02 (load announcements), verified by driving the real
 * catalogue rather than by reading the source.
 *
 * Both were implemented and then went unverified, because the obvious probe finds nothing:
 * the default homepage view contains zero .load-btn[data-map-id] elements. They render only
 * after a category chip is opened, so a test that loads the page and looks for a load button
 * measures an empty set and passes vacuously. Opening a chip first is the whole trick, and
 * the reason this is a committed spec instead of a one-off script.
 *
 * What each assertion is worth:
 *   T1-01 -- a load rebuilds the catalogue markup, discarding the focused node. Before the
 *            fix, document.activeElement was <body> afterwards, dropping a keyboard user at
 *            the top of a ~198-stop tab order. So the test focuses the button, activates it
 *            by keyboard, and requires focus to come back to a button for the SAME map id
 *            (the node itself is expected to have been replaced).
 *   T1-02 -- the aria-live region was byte-identical before, during and after a load. The
 *            test records every value #announcer takes via MutationObserver and requires
 *            both a start and a completion message. announce() blanks the region and fills
 *            it on the next frame, so polling textContent would miss messages; only an
 *            observer sees the sequence.
 *
 * Runs against production, because the catalogue reads data/database/maps.json and the
 * layer tiles come from R2 -- there is no meaningful local equivalent.
 */

// The service worker intercepts same-origin fetches and Playwright cannot route
// SW-initiated requests, so it has to be blocked or the run is not observing the network
// it thinks it is.
test.use({ serviceWorkers: 'block' });

const BASE = process.env.PARITY_BASE_URL || 'https://civgraph.net';

test('T1-01/T1-02: a keyboard-driven layer load announces itself and keeps focus', async ({ page }) => {
  test.setTimeout(240000);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // Guard the premise: if load buttons ever start rendering by default, the navigation
  // step below becomes dead code and this test should say so rather than quietly pass.
  const initialButtons = await page.locator('.load-btn[data-map-id]').count();
  expect(initialButtons, 'premise: the default view renders no load buttons').toBe(0);

  await page.getByText('Historic Geographies').first().click();
  await page.waitForFunction(
    () => document.querySelectorAll('.load-btn[data-map-id]').length > 0,
    null,
    { timeout: 30000 }
  );

  // Start recording announcements BEFORE the load. announce() sets textContent to '' and
  // fills it on the next animation frame, so each message is two mutations; polling would
  // race and see only the blank.
  await page.evaluate(() => {
    window.__annos = [];
    const el = document.getElementById('announcer');
    if (!el) return;
    new MutationObserver(() => {
      const text = (el.textContent || '').trim();
      if (text && window.__annos[window.__annos.length - 1] !== text) window.__annos.push(text);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  // Prefer a coarse layer: this asserts on focus and announcements, not on tile volume,
  // and a townlands layer would spend the timeout downloading.
  const mapId = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.load-btn[data-map-id]')].map((b) => b.dataset.mapId);
    const cheap = ids.find((id) => /^counties-|^provinces-/.test(id));
    return cheap || ids[0];
  });
  expect(mapId, 'a load button to drive').toBeTruthy();

  const selector = `.load-btn[data-map-id="${mapId}"]`;

  // Focus it as a keyboard user would, and confirm the premise of T1-01: focus starts on
  // the button. Without this the later assertion could pass on a load that never moved it.
  await page.evaluate((sel) => document.querySelector(sel)?.focus(), selector);
  expect(await page.evaluate((sel) => document.activeElement?.matches(sel) || false, selector))
    .toBe(true);

  await page.keyboard.press('Enter');

  // Wait for the completion announcement rather than a fixed sleep: the whole point is
  // that a completion message exists.
  await page.waitForFunction(
    () => (window.__annos || []).some((t) => /loaded|failed to load/i.test(t)),
    null,
    { timeout: 120000 }
  );

  const annos = await page.evaluate(() => window.__annos || []);

  // T1-02: both halves of the load must be spoken.
  expect(annos.some((t) => /^Loading /i.test(t)), `a start message in ${JSON.stringify(annos)}`)
    .toBe(true);
  expect(annos.some((t) => / loaded$/i.test(t)), `a completion message in ${JSON.stringify(annos)}`)
    .toBe(true);
  // The layer must actually have loaded -- a "failed to load" announcement is a correct
  // announcement of a broken load, and would satisfy a looser assertion.
  expect(annos.some((t) => /failed to load/i.test(t)), 'no failure announcement').toBe(false);

  // The announcements must name the layer, not its id.
  const label = await page.evaluate((id) => {
    const btn = document.querySelector(`.load-btn[data-map-id="${id}"]`);
    return btn?.closest('[data-map-id]')?.textContent?.trim() || '';
  }, mapId);
  if (label) {
    const word = label.split(/\s+/).find((w) => w.length > 4);
    if (word) expect(annos.join(' | ')).toContain(word);
  }

  // T1-01: focus is back on a button for the same map. The node is expected to be a
  // different object -- the re-render replaced it -- so identity is not asserted, only
  // that the focused element is this map's load button.
  const focus = await page.evaluate((id) => {
    const active = document.activeElement;
    return {
      tag: active?.tagName || null,
      isLoadBtn: Boolean(active?.classList?.contains('load-btn')),
      mapId: active?.dataset?.mapId || null,
      isBody: active === document.body,
    };
  }, mapId);

  expect(focus.isBody, 'focus must not have fallen back to <body>').toBe(false);
  expect(focus.isLoadBtn).toBe(true);
  expect(focus.mapId).toBe(mapId);

  expect(consoleErrors).toEqual([]);
});
