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

/**
 * Bring a time-series layer onto the map so the slider exists.
 *
 * The default view has no timeline, so tests that skip without one give no
 * coverage at all — and the race test is the one that matters most. wards-2012
 * belongs to the `wards` chain (classes ni-wards and ni-deds), which spans the
 * 1972 local-government reorganisation and so has plenty of steps.
 *
 * Loading through app.loadMap is deliberate: it is the same path the catalogue
 * UI uses, so the timeline arrives the way it does for a real user rather than
 * by poking internal state into a shape the app never produces.
 */
async function activateTimeline(page, mapId = 'wards-2012') {
  await page.evaluate(async (id) => {
    await window.__civgraphTest2.app.loadMap(id);
  }, mapId);

  const ready = await page
    .waitForFunction(
      () => {
        const t = window.__civgraphTest2?.timeline;
        return !!t && t.getItems().length >= 2;
      },
      null,
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);

  return ready;
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

    const ready = await activateTimeline(page);
    expect(ready, 'a time-series layer must produce a slider with at least two steps').toBe(true);

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

  // KNOWN FAILURE, recorded rather than deleted or weakened.
  //
  // This found a real bug on the day it was written: requesting indices 0, 2
  // and 5 in quick succession settles on 0. The slider and the map agree, so
  // nothing looks wrong — they agree on a year the user already scrolled past.
  //
  // The cause is NOT applyIndex, which sets the slider synchronously in the
  // right order. It is the timeline REBUILD (app.js, the block ending in
  // setTimelineRangeIndex around line 1977): when a layer finishes loading, the
  // timeline is rebuilt and the index is re-derived from whichever layer is now
  // active. Whichever load finishes last therefore wins, regardless of what was
  // requested last.
  //
  // THREE ATTEMPTS SO FAR, ALL REVERTED. What each one established:
  //
  //  1. A generation token on applyIndex alone. No effect: the rebuild path
  //     never goes through applyIndex, so nothing consults the token.
  //
  //  2. Record the requested TIMESTAMP (not index -- the rebuild re-derives
  //     position from timestamps, and an index is only meaningful against the
  //     item list of the moment), have refreshTimelineFromActiveLayers prefer it
  //     over getCurrentTimelineTimestamp, and clear it when the latest request
  //     finishes. Still settled on 0. Clearing on completion is wrong: the
  //     slower earlier requests are still in flight, and each triggers its own
  //     rebuild when it lands, which then falls back to "whatever is on the map".
  //
  //  3. As (2), but hold the claim until a rebuild arrives whose item list no
  //     longer contains the requested timestamp. Moved the result from 0 to 2 --
  //     better, still wrong. An INTERMEDIATE rebuild, running while a load is in
  //     flight, produces an item list that does not contain the requested
  //     timestamp (the list is derived from a reference map that is mid-swap),
  //     so the claim is released early and the next landing load wins.
  //
  // So the remaining problem is narrow and specific: distinguishing "this
  // rebuild has genuinely moved to a different chain" from "this rebuild is a
  // transient mid-swap view of the same chain". Attempt 4 should probably not
  // key on the item list at all -- more likely on the in-flight load count, or
  // by having the swap itself carry the request identity so a stale completion
  // can be dropped before it ever reaches the rebuild.
  //
  // test.fail() means: run it, expect red. If someone fixes the rebuild, this
  // turns "expected to fail but passed" and they will be told to remove this
  // annotation — which is the whole point of recording it this way instead of
  // skipping, deleting, or loosening the assertion until it passes.
  test('rapid timeline changes settle on the last requested year, not the last to finish', async ({ page }) => {
    // Scoped to THIS test. Called at describe level it marks every test in the
    // file expected-to-fail, which turns three passing tests red.
    test.fail();
    await bootApp(page);

    const ready = await activateTimeline(page);
    expect(ready, 'a time-series layer must produce a slider').toBe(true);
    const steps = await page.evaluate(() => window.__civgraphTest2.timeline.getItems().length);
    expect(steps, 'the race test needs at least three steps to be meaningful').toBeGreaterThanOrEqual(3);

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
