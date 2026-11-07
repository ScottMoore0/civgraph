const { test, expect } = require('@playwright/test');

/**
 * Boundary changes on the timeline slider (reviewer report, Phelim, 2026-11-01).
 *
 * He loaded Counties of Ireland 1927 and 1955 and dragged the slider: the colours stayed the
 * same, small changes were impossible to see, and nothing was highlighted. Only Play mode drew
 * an overlay, and for Counties that overlay covered the whole island.
 *
 * Every step of the slider now draws what changed between the edition that was shown and the
 * one now shown (data/timeline-changes/, scripts/build/timeline-changes.py), a "Highlight"
 * switch turns that off and is remembered, and the "N changes" button beside the date lists
 * the changes with a zoom-to for each.
 *
 * Steps go through window.__civgraphTest2.timeline.setIndex, the same applyIndex the slider's
 * change event and the previous/next buttons call, because it returns the promise that
 * settles once the swap (and the highlight) is done.
 */

const BOOT_TIMEOUT = 45000;

async function bootApp(page) {
  await page.goto('/maps/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2BootStarted === true, null, { timeout: BOOT_TIMEOUT });
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: BOOT_TIMEOUT });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
}

/** Open `mapId` and wait until the slider offers its series. */
async function openSeries(page, mapId) {
  await page.evaluate(async (id) => { await window.__civgraphTest2.app.loadMap(id); }, mapId);
  await page.waitForFunction(() => (window.__civgraphTest2?.timeline?.getItems()?.length || 0) >= 2, null, { timeout: 30000 });
}

async function indexOf(page, mapId) {
  return page.evaluate((id) => window.__civgraphTest2.timeline.getItems().findIndex((item) => item.mapId === id), mapId);
}

async function stepTo(page, index) {
  await page.evaluate(async (i) => {
    await window.__civgraphTest2.timeline.setIndex(i);
  }, index);
}

const changes = (page) => page.evaluate(() => window.__civgraphTest2.timeline.getChanges());

test.describe('boundary changes on the timeline', () => {
  test.setTimeout(120000);

  test('stepping the slider highlights the changes, forwards and backwards', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'counties-ireland-1955');
    const i1927 = await indexOf(page, 'counties-ireland-1927');
    const i1955 = await indexOf(page, 'counties-ireland-1955');
    expect(i1927).toBeGreaterThanOrEqual(0);
    expect(i1955).toBe(i1927 + 1);

    // Back from 1955 to 1927: the same pair, reversed.
    await stepTo(page, i1927);
    let state = await changes(page);
    expect(state.view?.kind).toBe('changes');
    expect(state.view.reversed).toBe(true);
    expect(state.map?.markers).toBeGreaterThan(0);

    // Forward again: the changes 1927 -> 1955, drawn, and few -- not the whole island.
    await stepTo(page, i1955);
    state = await changes(page);
    expect(state.view.reversed).toBe(false);
    expect(state.view.toMapId).toBe('counties-ireland-1955');
    expect(state.view.count).toBeGreaterThan(0);
    expect(state.view.count).toBeLessThan(20);
    expect(state.map?.areas).toBeGreaterThan(0);
    await expect(page.locator('#timelineChanges')).toHaveText(/\d+ changes?/);
  });

  test('the Highlight switch hides the highlight and is remembered', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'counties-ireland-1955');
    const i1927 = await indexOf(page, 'counties-ireland-1927');
    await stepTo(page, i1927);
    expect((await changes(page)).map).not.toBeNull();

    const toggle = page.locator('#timelineHighlight');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect((await changes(page)).map).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('civgraph:timelineHighlightChanges'))).toBe('0');

    // Still off after another step, and after a reload.
    await stepTo(page, i1927 + 1);
    expect((await changes(page)).map).toBeNull();
    await bootApp(page);
    await openSeries(page, 'counties-ireland-1955');
    await expect(page.locator('#timelineHighlight')).toHaveAttribute('aria-checked', 'false');

    await page.locator('#timelineHighlight').click();
    await stepTo(page, i1927);
    expect((await changes(page)).map).not.toBeNull();
  });

  test('the changes button lists the changes and zooms to one', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'eds-1916-01-26');
    const i1916 = await indexOf(page, 'eds-1916-01-26');
    expect(i1916).toBeGreaterThan(0);
    await stepTo(page, i1916 - 1);
    await stepTo(page, i1916);

    const button = page.locator('#timelineChanges');
    await expect(button).toBeVisible();
    await button.click();
    const panel = page.locator('#timelineChangesPanel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Portstewart Urban formed from Portstewart/i);
    const zoomButtons = panel.locator('[data-change-key]');
    expect(await zoomButtons.count()).toBeGreaterThan(0);

    const before = await page.evaluate(() => window.__civgraphTest2.mapController.map.getZoom());
    await zoomButtons.first().click();
    await page.waitForFunction((z) => Math.abs(window.__civgraphTest2.mapController.map.getZoom() - z) > 1, before, { timeout: 10000 });
    const center = await page.evaluate(() => window.__civgraphTest2.mapController.map.getCenter().toArray());
    // Portstewart, Co. Londonderry.
    expect(center[0]).toBeGreaterThan(-6.9);
    expect(center[0]).toBeLessThan(-6.5);
    expect(center[1]).toBeGreaterThan(55.05);
    expect(center[1]).toBeLessThan(55.3);
  });

  test('the timeline row still fits a 375px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await bootApp(page);
    await openSeries(page, 'counties-ireland-1955');
    const i1927 = await indexOf(page, 'counties-ireland-1927');
    await stepTo(page, i1927);
    const layout = await page.evaluate(() => {
      const slider = document.getElementById('timelineSlider');
      const box = (el) => el?.getBoundingClientRect();
      return {
        overflow: slider.scrollWidth - slider.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        button: box(document.getElementById('timelineChanges')),
        toggle: box(document.getElementById('timelineHighlight')),
        width: window.innerWidth
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    for (const rect of [layout.button, layout.toggle]) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(layout.width);
    }
  });
});
