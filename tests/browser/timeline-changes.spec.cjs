const { test, expect } = require('@playwright/test');

/**
 * Boundary changes on the timeline slider (reviewer report, Phelim, 2026-11-01).
 *
 * He loaded Counties of Ireland 1927 and 1955 and dragged the slider: the colours stayed the
 * same, small changes were impossible to see, and nothing was highlighted. Only Play mode drew
 * an overlay, and for Counties that overlay covered the whole island.
 *
 * Every step of the slider now draws what changed at the edition selected, since the edition
 * directly before it, whichever way the slider moved (data/timeline-changes/,
 * scripts/build/timeline-changes.py; Phelim Birch, 27 Nov 2026), a "Highlight" switch turns that
 * off and is remembered, and the "N changes" button beside the date lists the changes with a
 * zoom-to for each, and a "Changes since" menu for an earlier edition.
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

    // Back from 1955 to 1927: 1927's own changes, since 1922 (Phelim Birch, 27 Nov 2026), drawn.
    await stepTo(page, i1927);
    let state = await changes(page);
    expect(state.view?.kind).toBe('changes');
    expect(state.view.fromMapId).toBe('counties-ireland-1922');
    expect(state.view.toMapId).toBe('counties-ireland-1927');
    expect(state.view.drawn).toBe(true);
    expect(state.map?.renamed).toBeGreaterThan(0);

    // Forward again: the changes 1927 -> 1955, drawn, and few -- not the whole island.
    await stepTo(page, i1955);
    state = await changes(page);
    expect(state.view.fromMapId).toBe('counties-ireland-1927');
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
    await expect(panel).toContainText(/Portstewart divided into Portstewart Rural and Portstewart Urban/i);
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

  // Phelim, 20 Nov 2026: the heading names only when the changes took effect (the later
  // edition's date), the zoom button draws the app's zoom-to frame, and renames are listed.
  test('the heading names the later date; the zoom button is the zoom-to frame', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'counties-ireland-1955');
    const i1927 = await indexOf(page, 'counties-ireland-1927');
    await stepTo(page, i1927);
    await stepTo(page, i1927 + 1);

    const button = page.locator('#timelineChanges');
    // The tooltip keeps the "since" context: both editions.
    await expect(button).toHaveAttribute('title', /^25 Oct 1927 to 01 Apr 1955: /);
    await button.click();
    const panel = page.locator('#timelineChangesPanel');
    await expect(panel.locator('.timeline-changes-panel__title')).toHaveText('Changes, 01 Apr 1955');
    const zoom = panel.locator('.timeline-changes-panel__zoom').first();
    await expect(zoom.locator('svg.timeline-changes-panel__zoom-icon path')).toHaveCount(4);
    await expect(zoom.locator('circle')).toHaveCount(0);
    expect(await zoom.locator('path').first().getAttribute('d')).toBe('M8 3H5a2 2 0 0 0-2 2v3');

    // Back from 1955 to 1927: 1927's own changes, which took effect then.
    await stepTo(page, i1927);
    await expect(panel.locator('.timeline-changes-panel__title')).toHaveText('Changes, 25 Oct 1927');
  });

  test('a rename is listed as its own kind, counted, keyed and outlined on the map', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'counties-ireland');
    const i1957 = await indexOf(page, 'counties-ireland-1957');
    const iNow = await indexOf(page, 'counties-ireland');
    expect(iNow).toBe(i1957 + 1);
    await stepTo(page, i1957);
    await stepTo(page, iNow);

    const state = await changes(page);
    expect(state.view.changes.some((change) => change.type === 'renamed')).toBe(true);
    expect(state.map?.renamed).toBeGreaterThan(0);
    await page.locator('#timelineChanges').click();
    const panel = page.locator('#timelineChangesPanel');
    await expect(panel).toContainText('Laoighis renamed Laois');
    await expect(panel.locator('.timeline-changes-panel__type--renamed')).toHaveText(/Renamed/i);
    await expect(panel.locator('.timeline-changes-panel__summary')).toContainText(/\(1 rename\)/);
    await expect(panel.locator('.timeline-changes-panel__swatch--renamed')).toHaveCount(1);
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

/**
 * Phelim Birch, 27 Nov 2026: "Loading a map/selecting a map on the timeline should always load its
 * changes from the map that directly precedes it chronologically", with a "Changes since" menu at
 * the panel's top right for editions further back, in place of clicking one edition on the timeline
 * and then another. Before, a step described the pair the slider had just crossed: going back
 * listed the step undone (often "No changes" although the selected edition had changes of its own),
 * a pair not compared hid the button, and the first edition showed nothing.
 */
test.describe('changes since the preceding edition, and the "Changes since" menu', () => {
  test.setTimeout(120000);

  const panel = (page) => page.locator('#timelineChangesPanel');
  const openPanel = async (page) => {
    if (!(await panel(page).isVisible())) await page.locator('#timelineChanges').click();
    await expect(panel(page)).toBeVisible();
  };

  test('going back lists the selected edition\'s own changes, not the step just undone', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    // Electoral wards: 1924-06-01 -> 1924-06-20 has 2 changes; 1924-06-20 -> 1925-04-01 has none.
    await openSeries(page, 'ded-1925-04-01');
    const i1925 = await indexOf(page, 'ded-1925-04-01');
    const i1924 = await indexOf(page, 'ded-1924-06-20');
    expect(i1924).toBe(i1925 - 1);
    await stepTo(page, i1924);
    let state = await changes(page);
    expect(state.view.fromMapId).toBe('ded-1924-06-01');
    expect(state.view.toMapId).toBe('ded-1924-06-20');
    expect(state.view.kind).toBe('changes');
    expect(state.view.count).toBe(2);
    await expect(page.locator('#timelineChanges')).toHaveText('2 changes');
    // The Previous button, as a reader steps: still the selected edition's own pair.
    await page.locator('#timelinePrev').click();
    await page.waitForFunction((id) => window.__civgraphTest2.timeline.getChanges().view?.toMapId === id, 'ded-1924-06-01', { timeout: 30000 });
    state = await changes(page);
    expect(state.view.fromMapId).toBe('ded-1924-04-01');
    // Forward again: 1925-04-01's own pair, which has none.
    await stepTo(page, i1925);
    state = await changes(page);
    expect(state.view.fromMapId).toBe('ded-1924-06-20');
    expect(state.view.kind).toBe('none');
    await expect(page.locator('#timelineChanges')).toHaveText('No changes');
  });

  test('a map opened from the catalogue is described since the edition before it', async ({ page }) => {
    await bootApp(page);
    await openSeries(page, 'counties-ireland-1955');
    await page.waitForFunction(() => window.__civgraphTest2.timeline.getChanges().view?.toMapId === 'counties-ireland-1955', null, { timeout: 30000 });
    const state = await changes(page);
    expect(state.view.fromMapId).toBe('counties-ireland-1927');
    expect(state.view.since.selected).toBe('counties-ireland-1927');
    await expect(page.locator('#timelineChanges')).toHaveText('2 changes');
  });

  test('the first edition says there is nothing earlier to compare', async ({ page }) => {
    await bootApp(page);
    await openSeries(page, 'counties-ireland-1922');
    await stepTo(page, 0);
    expect(await indexOf(page, 'counties-ireland-1915')).toBe(0);
    const state = await changes(page);
    expect(state.view.kind).toBe('first');
    expect(state.view.toMapId).toBe('counties-ireland-1915');
    expect(state.map).toBeNull();
    const button = page.locator('#timelineChanges');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('First edition');
    await openPanel(page);
    await expect(panel(page).locator('.timeline-changes-panel__title')).toHaveText('First edition');
    await expect(panel(page)).toContainText('The first edition of this series: there is nothing earlier to compare it with.');
    await expect(panel(page).locator('select')).toHaveCount(0);
  });

  test('a pair not compared says so, and the button stays', async ({ page }) => {
    await bootApp(page);
    // Dáil constituencies: no geometry is held for 1947 -> 1959. The button used to vanish.
    await openSeries(page, 'dail-1959');
    const i1959 = await indexOf(page, 'dail-1959');
    const i1947 = await indexOf(page, 'dail-1947');
    expect(i1947).toBe(i1959 - 1);
    await stepTo(page, i1959 + 1);
    await stepTo(page, i1959);
    expect((await changes(page)).view.kind).toBe('unavailable');
    await expect(page.locator('#timelineChanges')).toHaveText('Not compared');
  });

  test('the menu lists the earlier editions and lists every step since the one chosen', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { try { localStorage.removeItem('civgraph:timelineHighlightChanges'); } catch {} });
    await openSeries(page, 'counties-ireland');
    const iNow = await indexOf(page, 'counties-ireland');
    await stepTo(page, iNow - 1);
    await stepTo(page, iNow);
    await openPanel(page);
    const select = panel(page).locator('#timelineChangesSince');
    await expect(select).toBeVisible();
    // Labelled, newest first, the preceding edition chosen.
    await expect(page.getByLabel('Changes since')).toHaveCount(1);
    const options = await select.locator('option').evaluateAll((list) => list.map((o) => [o.value, o.textContent, o.selected]));
    expect(options.map((o) => o[0])).toEqual(['counties-ireland-1957', 'counties-ireland-1955', 'counties-ireland-1927', 'counties-ireland-1922', 'counties-ireland-1915']);
    expect(options[0][1]).toMatch(/\(previous edition\)$/);
    expect(options[0][2]).toBe(true);
    await expect(panel(page).locator('.timeline-changes-panel__group')).toHaveCount(0);

    // Since 1927: three steps, each under its date, oldest first, all drawn.
    await select.selectOption('counties-ireland-1927');
    await expect(panel(page).locator('.timeline-changes-panel__overall')).toHaveText('Changes since 25 Oct 1927: 3 steps, 5 changes, 336 ha in all.');
    const groups = panel(page).locator('.timeline-changes-panel__group');
    await expect(groups).toHaveCount(3);
    await expect(groups.locator('.timeline-changes-panel__group-title')).toHaveText(['01 Apr 1955', '01 Nov 1957', /\d{4}/]);
    await expect(groups.nth(2)).toContainText('Laoighis renamed Laois');
    await expect(panel(page).locator('.timeline-changes-panel__title')).toHaveText(/^Changes, 01 Apr 1955 to /);
    let state = await changes(page);
    expect(state.view.fromMapId).toBe('counties-ireland-1927');
    expect(state.view.steps).toBe(3);
    expect(state.view.count).toBe(5);
    expect(new Set(state.view.changes.map((c) => c.group))).toEqual(new Set([0, 1, 2]));
    expect(state.map?.markers).toBe(5);
    await expect(page.locator('#timelineChanges')).toHaveText('5 changes');
    // A zoom button in a group still finds its change.
    const before = await page.evaluate(() => window.__civgraphTest2.mapController.map.getZoom());
    await groups.nth(1).locator('.timeline-changes-panel__zoom').first().click();
    await page.waitForFunction((z) => Math.abs(window.__civgraphTest2.mapController.map.getZoom() - z) > 1, before, { timeout: 10000 });

    // By keyboard: the menu keeps focus when the list is written afresh.
    await openPanel(page);
    await panel(page).locator('#timelineChangesSince').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => window.__civgraphTest2.timeline.getChanges().view?.fromMapId === 'counties-ireland-1922', null, { timeout: 10000 });
    await expect(panel(page).locator('#timelineChangesSince')).toBeFocused();
    await expect(panel(page).locator('.timeline-changes-panel__group')).toHaveCount(4);

    // Another edition selected: back to the edition directly before it.
    await stepTo(page, iNow - 1);
    state = await changes(page);
    expect(state.view.toMapId).toBe('counties-ireland-1957');
    expect(state.view.fromMapId).toBe('counties-ireland-1955');
    expect(state.view.since.selected).toBe('counties-ireland-1955');
    expect(state.view.steps).toBe(1);
  });

  test('an address with two editions on together lists the later one since the earlier', async ({ page }) => {
    // Before the menu, two editions were compared by switching both on; such an address keeps both.
    await page.goto('/maps/#layers=counties-ireland-1927,counties-ireland', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: BOOT_TIMEOUT });
    await page.evaluate(() => window.__civgraphTest2.restorePromise);
    await page.waitForFunction(() => {
      const view = window.__civgraphTest2?.timeline?.getChanges?.().view;
      return view?.toMapId === 'counties-ireland' && view?.fromMapId === 'counties-ireland-1927';
    }, null, { timeout: 45000 });
    const state = await changes(page);
    expect(state.view.since.selected).toBe('counties-ireland-1927');
    expect(state.view.steps).toBe(3);
    await openPanel(page);
    await expect(panel(page).locator('#timelineChangesSince')).toHaveValue('counties-ireland-1927');
    await expect(panel(page).locator('.timeline-changes-panel__overall')).toHaveText(/^Changes since 25 Oct 1927: 3 steps/);
  });

  test('the panel and its menu fit a 375px phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await bootApp(page);
    await openSeries(page, 'counties-ireland');
    const iNow = await indexOf(page, 'counties-ireland');
    await stepTo(page, iNow - 1);
    await stepTo(page, iNow);
    await openPanel(page);
    await panel(page).locator('#timelineChangesSince').selectOption('counties-ireland-1927');
    await expect(panel(page).locator('.timeline-changes-panel__group')).toHaveCount(3);
    const layout = await page.evaluate(() => {
      const box = (el) => el?.getBoundingClientRect();
      const host = document.getElementById('timelineChangesPanel');
      return {
        width: window.innerWidth,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        panelOverflow: host.scrollWidth - host.clientWidth,
        panel: box(host),
        select: box(document.getElementById('timelineChangesSince')),
        close: box(host.querySelector('.timeline-changes-panel__close'))
      };
    });
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.panelOverflow).toBeLessThanOrEqual(1);
    for (const rect of [layout.select, layout.close]) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.left).toBeGreaterThanOrEqual(layout.panel.left);
      expect(rect.right).toBeLessThanOrEqual(layout.panel.right);
    }
    // The menu and the close button share the top row, at the right.
    expect(Math.abs(layout.select.top - layout.close.top)).toBeLessThan(12);
    expect(layout.close.right).toBeGreaterThan(layout.panel.right - 24);
  });
});
