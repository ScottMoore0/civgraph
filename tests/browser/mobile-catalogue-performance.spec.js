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

test('map load patches catalogue state without rerendering the flat catalogue', async ({ page }) => {
  await page.goto('/#layers=__none');
  await waitForApp(page);
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

    const row = document.querySelector(
      '.class-member[data-map-id="roi-garda-sub-districts"], .c1-grid-entry[data-map-id="roi-garda-sub-districts"], .map-card[data-map-id="roi-garda-sub-districts"]'
    );
    return {
      renderCalls,
      loaded: window.mapController.isLayerLoaded('roi-garda-sub-districts'),
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

test('mobile catalogue first open renders a bounded subset', async ({ page }) => {
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
