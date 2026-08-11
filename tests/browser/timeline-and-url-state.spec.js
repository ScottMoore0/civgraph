const { test, expect } = require('@playwright/test');

/**
 * Coverage for the three behaviours that had none: timeline races, share-URL
 * restoration, and slider behaviour.
 *
 * WHY THESE THREE
 *
 * They share a property that makes them uniquely bug-prone and uniquely
 * untested: all are asynchronous, all mutate shared state, and all fail in ways
 * that leave the page looking fine. A timeline race ends with the map showing a
 * year the slider does not, and nothing throws. A broken share URL silently
 * drops to defaults, and the user simply sees the wrong place.
 *
 * READ THIS BEFORE DEBUGGING A FAILURE HERE
 *
 * app/src/boot.js starts the runtime inside a double requestAnimationFrame, and
 * Chrome does not fire requestAnimationFrame in a hidden or backgrounded tab.
 * A run where the browser window is not foregrounded will show no map, no
 * canvas, no catalogue fetches and no __civgraphTest2 — a completely convincing
 * dead site that is in fact healthy. This cost three debugging attempts on
 * 2026-08-11; see docs/src-orphan-runtime-check.md.
 *
 * Every test therefore waits on __civgraphTest2BootStarted FIRST and reports
 * that specific cause if it never arrives, rather than failing later on a
 * missing selector that says nothing about why.
 */

const BOOT_TIMEOUT = 45000;

/** Load the app and wait for the runtime, failing with the real reason. */
async function bootApp(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const booted = await page
    .waitForFunction(() => window.__civgraphTest2BootStarted === true, null, { timeout: BOOT_TIMEOUT })
    .then(() => true)
    .catch(() => false);

  if (!booted) {
    const diag = await page.evaluate(() => ({
      visibility: document.visibilityState,
      bundlePresent: !!document.querySelector('script[src*="app.bundle"]'),
      mapError: document.querySelector('.map-error')?.textContent || null,
    }));
    throw new Error(
      `Runtime never started. visibilityState=${diag.visibility}, ` +
      `bundle=${diag.bundlePresent}, mapError=${diag.mapError}. ` +
      'If visibilityState is "hidden", boot.js is blocked on requestAnimationFrame ' +
      'and the browser needs to be foregrounded — this is not an app fault.',
    );
  }

  // Wait for `whenIdle`, NOT for `app`. The surface is populated in stages:
  // `app` appears at the top of init(), long before the map exists, so waiting
  // on it returns a half-built runtime and every later call fails with a
  // confusing "not a function". `whenIdle` is attached in the same literal as
  // mapController, so it is the first honest signal that the runtime is usable.
  await page.waitForFunction(
    () => typeof window.__civgraphTest2?.whenIdle === 'function',
    null,
    { timeout: BOOT_TIMEOUT },
  );
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  return page;
}

test.describe('timeline, share URLs and the slider', () => {
  test('the runtime exposes the surface these tests depend on', async ({ page }) => {
    await bootApp(page);
    const surface = await page.evaluate(() => Object.keys(window.__civgraphTest2 || {}));
    expect(surface).toEqual(expect.arrayContaining(['app', 'mapController', 'metadataService', 'whenIdle', 'urlState']));
  });

  test('share-URL state round-trips through a reload', async ({ page }) => {
    await bootApp(page);

    // Move somewhere unambiguous, let the app write its own hash, then reload
    // and require the same position back. Asserting on the app's own serialised
    // hash rather than a hand-written one means the test cannot pass by
    // accident against a format that has changed.
    await page.evaluate(async () => {
      const map = window.__civgraphTest2.mapController?.map;
      map?.jumpTo({ center: [-6.2603, 53.3498], zoom: 9 });
      await window.__civgraphTest2.whenIdle();
    });
    await page.waitForFunction(() => /lng=/.test(window.location.hash), null, { timeout: 15000 });

    const before = await page.evaluate(() => window.location.hash);
    expect(before).toMatch(/lng=/);

    await page.goto(`/${before}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__civgraphTest2BootStarted === true, null, { timeout: BOOT_TIMEOUT });
    await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: BOOT_TIMEOUT });
    await page.evaluate(() => window.__civgraphTest2.restorePromise);

    const restored = await page.evaluate(() => {
      const map = window.__civgraphTest2.mapController?.map;
      const c = map?.getCenter?.();
      return { lng: c?.lng, lat: c?.lat, zoom: map?.getZoom?.() };
    });

    // Tolerances, not equality: the hash is written rounded, so demanding exact
    // equality would be testing the rounding rather than the restoration.
    expect(Math.abs(restored.lng - (-6.2603))).toBeLessThan(0.05);
    expect(Math.abs(restored.lat - 53.3498)).toBeLessThan(0.05);
    expect(Math.abs(restored.zoom - 9)).toBeLessThan(0.6);
  });

  test('the slider clamps out-of-range indices instead of throwing', async ({ page }) => {
    await bootApp(page);

    const timeline = await page.evaluate(() => {
      const t = window.__civgraphTest2.timeline;
      return t ? { present: true, items: t.getItems().length } : { present: false, items: 0 };
    });
    test.skip(!timeline.present || timeline.items < 2, 'no timeline active on the default view');

    const result = await page.evaluate(async () => {
      const t = window.__civgraphTest2.timeline;
      const count = t.getItems().length;
      await t.setIndex(-5);
      const low = t.getIndex();
      await t.setIndex(count + 50);
      const high = t.getIndex();
      return { count, low, high };
    });

    expect(result.low).toBe(0);
    expect(result.high).toBe(result.count - 1);
  });

  test('rapid timeline changes settle on the last requested year, not the last to finish', async ({ page }) => {
    await bootApp(page);

    const timeline = await page.evaluate(() => {
      const t = window.__civgraphTest2.timeline;
      return t ? { present: true, items: t.getItems().length } : { present: false, items: 0 };
    });
    test.skip(!timeline.present || timeline.items < 3, 'needs at least three timeline steps');

    // The race: fire several changes without awaiting, so multiple layer loads
    // are in flight together. The failure mode is a slower earlier request
    // resolving last and overwriting the newest state, which leaves the map
    // showing one year while the slider reads another.
    const outcome = await page.evaluate(async () => {
      const t = window.__civgraphTest2.timeline;
      const last = t.getItems().length - 1;
      const pending = [t.setIndex(0), t.setIndex(Math.floor(last / 2)), t.setIndex(last)];
      await Promise.allSettled(pending);
      await window.__civgraphTest2.whenIdle();
      return { requested: last, sliderIndex: t.getIndex(), internalIndex: t.currentIndex() };
    });

    expect(outcome.sliderIndex).toBe(outcome.requested);
    expect(outcome.internalIndex).toBe(outcome.requested);
  });
});
