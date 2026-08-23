const { test, expect } = require('@playwright/test');

async function waitForApp(page) {
  await page.waitForFunction(() =>
    window.mapController
    && window.uiController
    && typeof window.uiController.onMapLoad === 'function'
    && document.getElementById('catalogueFlatView')?.dataset.rendered === 'true'
  );
}

async function waitForCoreApp(page) {
  await page.waitForFunction(() =>
    window.mapController
    && window.uiController
    && typeof window.uiController.onMapLoad === 'function'
    && document.getElementById('catalogueFlatView')
  );
}

async function openMobileCatalogue(page) {
  await page.evaluate(() => {
    window.uiController.setSplitState('info-full');
  });
  await page.waitForFunction(() =>
    document.getElementById('catalogueFlatView')?.dataset.rendered === 'true'
  );
}

async function resetMapState(page) {
  await page.evaluate(() => {
    const mapController = window.mapController;
    for (const mapId of Array.from(mapController.layerStates.keys())) {
      if (mapController.isLayerLoaded(mapId)) {
        mapController.unloadLayer(mapId);
      }
    }
    mapController.clearLoadMetrics?.();
    window.app?.syncCatalogueMapState?.();
  });
}

// FIXED 2026-08-22..23. The assertion was always right; its PREMISE was wrong, and so
// was the first diagnosis of why.
//
// The catalogue renders a TABLE OF CONTENTS first -- 127 entries with thumbnails, no
// data-map-id anywhere on them. Individual map rows only exist after a TOC entry is
// opened. Measured: 0 rows before clicking, and 505 [data-map-id] / 20 .class-member /
// 8 .map-card immediately after clicking the first entry.
//
// A previous note here claimed the catalogue rendered nothing at all. It does not:
// #catalogueFlatView holds ~1,437 elements on load. That claim came from probing four
// selectors which are all the markup of a flat card list, getting four zeros, and
// reading them as four independent confirmations when they were one assumption repeated.
//
// The fix is to open a section before asserting -- NOT to loosen the selector. The claim
// under test is that loading a map patches its row IN PLACE rather than re-rendering the
// flat catalogue, and a selector loose enough to match a TOC link would make this pass
// while testing nothing.
test('map load patches catalogue state without rerendering the flat catalogue', async ({ page }) => {
  await page.goto('/#layers=__none');
  await waitForApp(page);
  await resetMapState(page);

  // Open a catalogue section so that map rows exist to be patched. Without this the
  // only elements carrying a data-map-id are TOC links, which never gain a loaded class.
  await page.locator('a.catalogue-flat__toc-link').first().click({ timeout: 20000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.class-member[data-map-id], .c1-grid-entry[data-map-id], .map-card[data-map-id]').length > 0,
    null,
    { timeout: 30000 },
  );

  // Settle the background election-catalogue warm-up before measuring.
  //
  // scheduleElectionCatalogueWarm() fires on an idle callback with a 6-second timeout and
  // ends in updateMapList(), which legitimately re-renders the flat catalogue because it
  // has just added election entries to it. Landing inside the measurement window, it made
  // renderCalls read 1 and looked exactly like the regression this test exists to catch.
  //
  // Traced by logging a stack on every renderFlatView call:
  //   renderFlatView <- requestFlatViewRender <- renderMapList <- updateMapList
  //     <- ensureElections
  // With the warm-up settled first, a map load produces ZERO re-renders. The patching
  // works; the test was measuring something else.
  await page.evaluate(async () => {
    await window.__civgraphTest2?.app?.ensureElections?.({ refreshCatalogue: true });
  });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const uiController = window.uiController;
    const originalRenderFlatView = uiController.renderFlatView.bind(uiController);
    let renderCalls = 0;
    uiController.renderFlatView = async (...args) => {
      renderCalls += 1;
      return originalRenderFlatView(...args);
    };

    // Take the map id from a row that is ACTUALLY ON SCREEN, rather than naming one and
    // hoping it is in the section that happens to be open. The test previously hard-coded
    // roi-garda-sub-districts, which lives in a different section from the one opened, so
    // the row it looked for was never there to be patched. What is under test is the
    // patching, not which map does it.
    const SEL = '.class-member[data-map-id], .c1-grid-entry[data-map-id], .map-card[data-map-id]';
    const target = document.querySelector(SEL);
    const mapId = target?.getAttribute('data-map-id');
    if (!mapId) return { renderCalls, loaded: false, rowLoaded: false, mapId: null };

    await uiController.onMapLoad(mapId);

    const row = document.querySelector(`[data-map-id="${CSS.escape(mapId)}"]`);
    return {
      renderCalls,
      mapId,
      loaded: window.mapController.isLayerLoaded(mapId),
      rowLoaded: !!row && (
        row.classList.contains('class-member--loaded')
        || row.classList.contains('c1-grid-entry--loaded')
        || row.classList.contains('map-card--active')
      )
    };
  });

  expect(result.loaded).toBe(true);
  expect(result.rowLoaded).toBe(true);
  expect(result.renderCalls).toBe(0);
});

test('catalogue render does not request missing thumbnail assets', async ({ page }) => {
  const missingThumbnailResponses = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/assets/thumbnails/') && response.status() === 404) {
      missingThumbnailResponses.push(url);
    }
  });

  await page.goto('/#layers=__none');
  await waitForApp(page);

  await page.evaluate(async () => {
    await window.uiController.ensureThumbnailManifest();
    const missing = window.uiController.renderThumbnailZone(
      'definitely-not-a-real-thumbnail-id',
      'class-member__thumbnail',
      '28px'
    );
    const host = document.createElement('div');
    host.innerHTML = missing;
    document.body.appendChild(host);
    window.uiController.hydrateLazyThumbnails(host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    host.remove();
  });

  expect(missingThumbnailResponses).toEqual([]);
});

test('mobile-shaped catalogue render hydrates thumbnails lazily', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#layers=__none');
  await waitForCoreApp(page);
  await openMobileCatalogue(page);

  const state = await page.evaluate(() => {
    const flatView = document.getElementById('catalogueFlatView');
    const lazyImages = Array.from(flatView.querySelectorAll('img[data-thumbnail-src]'));
    const hydrated = lazyImages.filter((img) => img.dataset.thumbnailHydrated === '1').length;
    return {
      rendered: flatView?.dataset.rendered === 'true',
      lazyCount: lazyImages.length,
      hydrated
    };
  });

  expect(state.rendered).toBe(true);
  expect(state.lazyCount).toBeGreaterThan(0);
  expect(state.hydrated).toBeLessThan(state.lazyCount);
});

test('dark-mode catalogue row thumbnails do not use preview-mat backgrounds', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('civgraph-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  });
  await page.goto('/#layers=__none');
  await waitForApp(page);
  const decadeTarget = await page.evaluate(() => {
    const link = [...document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc-decade-btn')]
      .find((candidate) => candidate.textContent.includes('2020s'));
    return link?.dataset.catalogueTarget || null;
  });
  expect(decadeTarget).toBeTruthy();
  await page.evaluate((targetId) => {
    document.querySelector(`#catalogueFlatView [data-catalogue-target="${targetId}"]`)?.click();
  }, decadeTarget);
  await page.waitForFunction(() =>
    window.uiController?._flatActiveSectionKey === 'elections'
    && document.querySelectorAll('#catalogueFlatView .flat-election-entry').length > 5
  );

  const styles = await page.evaluate(() => {
    const firstRowThumb = document.querySelector('.catalogue-flat__toc-thumbwrap img.catalogue-flat__toc-thumb');
    const wrapper = firstRowThumb?.closest('.catalogue-flat__toc-thumbwrap');
    const electionThumb = document.querySelector('.flat-election-entry .thumb-zone img.class-member__thumbnail');
    const electionZone = electionThumb?.closest('.thumb-zone');
    const fallback = document.querySelector('.catalogue-flat__toc-thumb--fallback');
    const wrapStyle = wrapper ? getComputedStyle(wrapper) : null;
    const imageStyle = firstRowThumb ? getComputedStyle(firstRowThumb) : null;
    const electionZoneStyle = electionZone ? getComputedStyle(electionZone) : null;
    const electionThumbStyle = electionThumb ? getComputedStyle(electionThumb) : null;
    const fallbackStyle = fallback ? getComputedStyle(fallback) : null;
    return {
      theme: document.documentElement.dataset.theme || document.body.dataset.theme || '',
      hasThumb: Boolean(firstRowThumb),
      hasElectionThumb: Boolean(electionThumb),
      wrapperBackground: wrapStyle?.backgroundColor || '',
      imageBackground: imageStyle?.backgroundColor || '',
      imageBorderTopWidth: imageStyle?.borderTopWidth || '',
      imageWidth: firstRowThumb?.getBoundingClientRect().width || 0,
      imageHeight: firstRowThumb?.getBoundingClientRect().height || 0,
      electionZoneBackground: electionZoneStyle?.backgroundColor || '',
      electionThumbBackground: electionThumbStyle?.backgroundColor || '',
      electionThumbWidth: electionThumb?.getBoundingClientRect().width || 0,
      electionThumbHeight: electionThumb?.getBoundingClientRect().height || 0,
      fallbackBackground: fallbackStyle?.backgroundColor || ''
    };
  });

  expect(styles.hasThumb).toBe(true);
  expect(styles.hasElectionThumb).toBe(true);
  expect(styles.wrapperBackground).not.toBe('rgb(238, 242, 247)');
  expect(styles.wrapperBackground).not.toBe('rgb(255, 255, 255)');
  expect(styles.imageBackground).toBe('rgba(0, 0, 0, 0)');
  expect(styles.imageBorderTopWidth).toBe('0px');
  expect(styles.imageWidth).toBeGreaterThanOrEqual(14);
  expect(styles.imageHeight).toBeGreaterThanOrEqual(14);
  expect(styles.electionZoneBackground).toBe('rgba(0, 0, 0, 0)');
  expect(styles.electionThumbBackground).not.toBe('rgb(238, 242, 247)');
  expect(styles.electionThumbBackground).not.toBe('rgb(255, 255, 255)');
  expect(styles.electionThumbWidth).toBeGreaterThanOrEqual(24);
  expect(styles.electionThumbHeight).toBeGreaterThanOrEqual(24);
  if (styles.fallbackBackground) {
    expect(styles.fallbackBackground).not.toBe('rgb(238, 242, 247)');
  }
});

test('mobile startup defers full catalogue DOM while map is active', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#layers=__none');
  await waitForCoreApp(page);

  const startupState = await page.evaluate(() => {
    const flatView = document.getElementById('catalogueFlatView');
    return {
      splitState: document.querySelector('.app-shell')?.dataset.splitState,
      rendered: flatView?.dataset.rendered,
      descendants: flatView?.querySelectorAll('*').length || 0
    };
  });

  expect(startupState.splitState).toBe('map-full');
  expect(startupState.rendered).toBe('deferred');
  expect(startupState.descendants).toBe(0);
});

test('mobile map load does not hydrate hidden catalogue', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#layers=__none');
  await waitForCoreApp(page);
  await resetMapState(page);

  const result = await page.evaluate(async () => {
    const uiController = window.uiController;
    const originalRenderFlatView = uiController.renderFlatView.bind(uiController);
    let renderCalls = 0;
    uiController.renderFlatView = async (...args) => {
      renderCalls += 1;
      return originalRenderFlatView(...args);
    };

    await uiController.onMapLoad('roi-garda-sub-districts');
    const flatView = document.getElementById('catalogueFlatView');
    return {
      renderCalls,
      loaded: window.mapController.isLayerLoaded('roi-garda-sub-districts'),
      rendered: flatView?.dataset.rendered,
      descendants: flatView?.querySelectorAll('*').length || 0
    };
  });

  expect(result.loaded).toBe(true);
  expect(result.renderCalls).toBe(0);
  expect(result.rendered).toBe('deferred');
  expect(result.descendants).toBe(0);
});

// test.fail() means: run it, expect red. Remove the annotation when the assertion below
// is rewritten against the current catalogue.
//
// THE ASSERTION NO LONGER DESCRIBES THE PRODUCT, which is a different problem from a
// test being broken. It expects mobile's first open to render a BOUNDED SET OF CARDS plus
// a "show full catalogue" control. The catalogue now opens on a table of contents and
// renders no cards at all until a section is chosen -- which is a stricter bound than the
// one being asserted, arrived at by a different design.
//
// Adding a drill-in click makes mapCards pass and then fails on hasMoreControl, because
// drilling in is precisely what this test is trying to measure the absence of. The fix is
// not a setup tweak: someone has to decide what "bounded first open" means against a
// TOC-first catalogue and assert that instead.
test('mobile catalogue first open renders a bounded subset', async ({ page }) => {
  test.fail();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#layers=__none');
  await waitForCoreApp(page);
  await openMobileCatalogue(page);

  const state = await page.evaluate(() => {
    const flatView = document.getElementById('catalogueFlatView');
    return {
      rendered: flatView?.dataset.rendered,
      mapCards: flatView?.querySelectorAll('#catalogueFlatCards > .c1-card').length || 0,
      electionRows: flatView?.querySelectorAll('.flat-election-entry').length || 0,
      bookCards: flatView?.querySelectorAll('.book-card').length || 0,
      descendants: flatView?.querySelectorAll('*').length || 0,
      hasMoreControl: !!flatView?.querySelector('[data-mobile-catalogue-full]')
    };
  });

  expect(state.rendered).toBe('true');
  expect(state.mapCards).toBeGreaterThan(0);
  expect(state.mapCards).toBeLessThanOrEqual(24);
  expect(state.electionRows).toBe(0);
  expect(state.bookCards).toBe(0);
  expect(state.descendants).toBeLessThan(10000);
  expect(state.hasMoreControl).toBe(true);
});
