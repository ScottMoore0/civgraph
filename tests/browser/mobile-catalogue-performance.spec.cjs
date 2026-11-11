const { test, expect } = require('@playwright/test');

// The catalogue in #catalogueFlatView is the rebuilt one (src/catalogue/, in production at /maps
// since 2026-10-12): it marks the container rendered="next" once drawn. These specs waited for
// "true", the flat catalogue's mark, which the rebuilt one never sets, so five of them timed out
// (QA 11 Nov 2026). The claims under test are unchanged; the markup they read is the rebuilt
// catalogue's: shelves (.cn-shelf, closed on first open) of rows ([data-cn-series]) whose maps
// are chips ([data-cn-toggle]) and whose thumbnails wait in img[data-cn-src] until scrolled near.
const RENDERED = 'next';

async function waitForApp(page) {
  await page.waitForFunction((rendered) =>
    window.mapController
    && window.uiController
    && typeof window.uiController.onMapLoad === 'function'
    && document.getElementById('catalogueFlatView')?.dataset.rendered === rendered
  , RENDERED);
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
  await page.waitForFunction((rendered) =>
    document.getElementById('catalogueFlatView')?.dataset.rendered === rendered
  , RENDERED);
}

/** Opens the first shelf of the current tab, so its rows (and their thumbnails) are on screen. */
async function openFirstShelf(page) {
  const toggle = page.locator('#catalogueFlatView .cn-shelf__toggle').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
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

// The claim under test: loading a map patches its row IN PLACE (the chip turns on) rather
// than re-rendering the catalogue. History: the flat catalogue opened on a table of contents, so
// a section had to be opened first for rows to exist (fixed 2026-08-22..23); the rebuilt one
// draws every row in its shelves, closed, and its first shelf is opened here so the chip patched
// is one a reader sees. A selector loose enough to match something that never changes would make
// this pass while testing nothing, so the chip must be the same element before and after.
test('map load patches catalogue state without rerendering the flat catalogue', async ({ page }) => {
  await page.goto('/maps/#layers=__none');
  await waitForApp(page);
  await resetMapState(page);
  await openFirstShelf(page);

  // Settle the background election-catalogue warm-up before measuring: it ends in
  // updateMapList(), which legitimately redraws the catalogue because it has just added the
  // elections to it. Landing inside the measurement window it looked exactly like the
  // regression this test exists to catch (traced 2026-08-22). Bounded, so this evaluate always
  // settles: under full-suite load the election catalogue's fetch can be slow.
  await page.evaluate(async () => {
    const app = window.__civgraphTest2?.app;
    if (!app?.ensureElections) return;
    await Promise.race([
      Promise.resolve(app.ensureElections({ refreshCatalogue: true })).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 20000))
    ]);
  });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const uiController = window.uiController;
    const catalogue = uiController._catalogueNext;
    let renderCalls = 0;
    const originalRenderFlatView = uiController.renderFlatView.bind(uiController);
    uiController.renderFlatView = async (...args) => { renderCalls += 1; return originalRenderFlatView(...args); };
    for (const name of ['render', 'draw', 'refreshResults']) {
      const original = catalogue[name].bind(catalogue);
      catalogue[name] = (...args) => { renderCalls += 1; return original(...args); };
    }

    // A chip ON SCREEN, in the shelf just opened: what is under test is the patching, not
    // which map does it.
    const chip = [...document.querySelectorAll('#catalogueFlatView [data-cn-toggle]')]
      .find((el) => el.getClientRects().length > 0 && el.getAttribute('aria-pressed') === 'false');
    const mapId = chip?.dataset.cnToggle;
    if (!mapId) return { renderCalls, loaded: false, rowLoaded: false, sameElement: false, mapId: null };

    await uiController.onMapLoad(mapId);

    const after = document.querySelector(`#catalogueFlatView [data-cn-toggle="${CSS.escape(mapId)}"]`);
    return {
      renderCalls,
      mapId,
      loaded: window.mapController.isLayerLoaded(mapId),
      rowLoaded: after?.getAttribute('aria-pressed') === 'true' && Boolean(after.closest('.cn-row--on')),
      sameElement: after === chip
    };
  });

  expect(result.mapId).toBeTruthy();
  expect(result.loaded).toBe(true);
  expect(result.rowLoaded).toBe(true);
  expect(result.sameElement).toBe(true);
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

  await page.goto('/maps/#layers=__none');
  await waitForApp(page);

  const catalogueThumb = await page.evaluate(async () => {
    await window.uiController.ensureThumbnailManifest();
    const missing = window.uiController.renderThumbnailZone(
      'definitely-not-a-real-thumbnail-id',
      'class-member__thumbnail',
      '28px'
    );
    // The rebuilt catalogue draws its row thumbnails itself (CatalogueNext.thumb).
    const rowThumb = window.uiController._catalogueNext.thumb('definitely-not-a-real-thumbnail-id');
    const host = document.createElement('div');
    host.innerHTML = missing + rowThumb;
    document.body.appendChild(host);
    window.uiController.hydrateLazyThumbnails(host);
    window.uiController._catalogueNext.observeThumbs(host);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const images = host.querySelectorAll('img').length;
    host.remove();
    return { images, fallback: rowThumb.includes('catalogue-flat__toc-thumb--fallback') };
  });

  // A map with no thumbnail gets the fallback block, not an image of a file that is not there.
  expect(catalogueThumb).toEqual({ images: 0, fallback: true });
  expect(missingThumbnailResponses).toEqual([]);
});

test('mobile-shaped catalogue render hydrates thumbnails lazily', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maps/#layers=__none');
  await waitForCoreApp(page);
  await openMobileCatalogue(page);
  await page.waitForTimeout(500);

  const thumbs = () => page.evaluate(() => {
    const flatView = document.getElementById('catalogueFlatView');
    const rowImages = Array.from(flatView.querySelectorAll('img.catalogue-flat__toc-thumb'));
    return {
      rendered: flatView?.dataset.rendered,
      lazyCount: rowImages.length,
      hydrated: rowImages.filter((img) => !img.hasAttribute('data-cn-src')).length
    };
  });

  // On first open the shelves are closed: no row thumbnail has been fetched.
  const first = await thumbs();
  expect(first.rendered).toBe('next');
  expect(first.lazyCount).toBeGreaterThan(0);
  expect(first.hydrated).toBe(0);

  // Opening a shelf fetches the thumbnails near the screen, not all of them.
  await openFirstShelf(page);
  await expect.poll(async () => (await thumbs()).hydrated).toBeGreaterThan(0);
  const opened = await thumbs();
  expect(opened.hydrated).toBeLessThan(opened.lazyCount);
});

test('dark-mode catalogue row thumbnails do not use preview-mat backgrounds', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('civgraph-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  });
  await page.goto('/maps/#layers=__none');
  await waitForApp(page);

  const thumbStyle = (rowSelector) => page.evaluate((selector) => {
    const image = [...document.querySelectorAll(`#catalogueFlatView ${selector} img.catalogue-flat__toc-thumb`)]
      .find((img) => img.getClientRects().length > 0);
    const wrapper = image?.closest('.catalogue-flat__toc-thumbwrap');
    const zone = wrapper?.parentElement;
    const fallback = [...document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc-thumb--fallback')]
      .find((el) => el.getClientRects().length > 0);
    return {
      theme: document.documentElement.dataset.theme || document.body.dataset.theme || '',
      hasThumb: Boolean(image),
      wrapperBackground: wrapper ? getComputedStyle(wrapper).backgroundColor : '',
      zoneBackground: zone ? getComputedStyle(zone).backgroundColor : '',
      imageBackground: image ? getComputedStyle(image).backgroundColor : '',
      imageBorderTopWidth: image ? getComputedStyle(image).borderTopWidth : '',
      imageWidth: image?.getBoundingClientRect().width || 0,
      imageHeight: image?.getBoundingClientRect().height || 0,
      fallbackBackground: fallback ? getComputedStyle(fallback).backgroundColor : ''
    };
  }, rowSelector);

  const MATS = ['rgb(238, 242, 247)', 'rgb(255, 255, 255)'];
  const expectNoMat = (styles) => {
    expect(styles.theme).toBe('dark');
    expect(styles.hasThumb).toBe(true);
    expect(MATS).not.toContain(styles.wrapperBackground);
    expect(MATS).not.toContain(styles.zoneBackground);
    expect(styles.imageBackground).toBe('rgba(0, 0, 0, 0)');
    expect(styles.imageBorderTopWidth).toBe('0px');
    // Election thumbnails were at least 24px in the flat catalogue; the rebuilt rows keep that.
    expect(styles.imageWidth).toBeGreaterThanOrEqual(24);
    expect(styles.imageHeight).toBeGreaterThanOrEqual(24);
    if (styles.fallbackBackground) expect(MATS).not.toContain(styles.fallbackBackground);
  };

  // A map row.
  await openFirstShelf(page);
  expectNoMat(await thumbStyle('.cn-row__thumb'));

  // An election row.
  await page.locator('#catalogueFlatView [data-cn-tab="elections"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#catalogueFlatView .cn-erow').length > 5);
  await openFirstShelf(page);
  expectNoMat(await thumbStyle('.cn-erow__thumb'));
});

test('mobile startup defers full catalogue DOM while map is active', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maps/#layers=__none');
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
  await page.goto('/maps/#layers=__none');
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

// "Bounded first open", decided against the rebuilt catalogue (QA 11 Nov 2026). The flat
// catalogue's version expected a bounded set of map cards plus a "show full catalogue" control,
// which the TOC-first flat catalogue had already stopped drawing (the test was marked
// test.fail(), and then timed out waiting for the flat catalogue's render mark, which a
// test.fail() does not accept). The rebuilt catalogue bounds its first open differently: every
// shelf is closed, so no row is on screen and no row thumbnail is fetched until a reader opens
// one; the Maps tab is drawn, not the elections or the books; and the pane stays under the
// 10,000-element ceiling the old assertion set. That is what is asserted.
test('mobile catalogue first open renders a bounded subset', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/maps/#layers=__none');
  await waitForCoreApp(page);
  await openMobileCatalogue(page);

  const state = await page.evaluate(() => {
    const flatView = document.getElementById('catalogueFlatView');
    const on = (el) => el.getClientRects().length > 0;
    const rows = [...flatView.querySelectorAll('[data-cn-series]')];
    const thumbs = [...flatView.querySelectorAll('img.catalogue-flat__toc-thumb')];
    return {
      rendered: flatView?.dataset.rendered,
      shelves: flatView.querySelectorAll('.cn-shelf__toggle').length,
      openShelves: flatView.querySelectorAll('.cn-shelf__toggle[aria-expanded="true"]').length,
      rows: rows.length,
      rowsOnScreen: rows.filter(on).length,
      thumbsFetched: thumbs.filter((img) => !img.hasAttribute('data-cn-src')).length,
      electionRows: flatView.querySelectorAll('.cn-erow').length,
      bookCards: flatView.querySelectorAll('.book-card').length,
      descendants: flatView.querySelectorAll('*').length
    };
  });

  expect(state.rendered).toBe('next');
  expect(state.shelves).toBeGreaterThan(0);
  expect(state.openShelves).toBe(0);
  expect(state.rows).toBeGreaterThan(0);
  expect(state.rowsOnScreen).toBe(0);
  expect(state.thumbsFetched).toBe(0);
  expect(state.electionRows).toBe(0);
  expect(state.bookCards).toBe(0);
  expect(state.descendants).toBeLessThan(10000);
});
