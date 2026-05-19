const { test, expect } = require('@playwright/test');

async function resetMapState(page) {
  await page.waitForFunction(() =>
    window.mapController
    && window.mapController.map
    && window.uiController
    && typeof window.uiController.onMapLoad === 'function'
  );
  await page.evaluate(() => {
    const mapController = window.mapController;
    for (const mapId of Array.from(mapController.layerStates.keys())) {
      if (mapController.isLayerLoaded(mapId)) {
        mapController.unloadLayer(mapId);
      }
    }
    mapController.clearLoadMetrics();
  });
}

test('eds-ulster-1911 uses an LOD source at low zoom', async ({ page }) => {
  await page.goto('/');

  await resetMapState(page);

  const loaded = await page.evaluate(async () => {
    const mapController = window.mapController;
    mapController.map.setView([54.6, -7.3], 6);
    mapController.clearLoadMetrics();
    await window.uiController.onMapLoad('eds-ulster-1911');

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (mapController.isLayerLoaded('eds-ulster-1911')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      loaded: mapController.isLayerLoaded('eds-ulster-1911'),
      metrics: mapController.getLoadMetrics()
    };
  });

  expect(loaded.loaded).toBe(true);
  const lodSelected = loaded.metrics.find((entry) =>
    entry.type === 'lod-source-selected' && entry.mapId === 'eds-ulster-1911'
  );
  expect(lodSelected).toBeTruthy();
  expect(lodSelected.source).toMatch(/UlsterElectoralDivisions1911-lod[01]\.fgb$/);
  expect(Number(lodSelected.lodLevel)).toBeLessThan(2);

  const vectorLoaded = loaded.metrics.find((entry) =>
    entry.type === 'vector-layer-loaded' && entry.mapId === 'eds-ulster-1911'
  );
  expect(vectorLoaded).toBeTruthy();
});

test('oa-2001 uses chunk index, bounded concurrency, and zoom variants', async ({ page }) => {
  await page.goto('/');

  await resetMapState(page);

  const beforeZoom = await page.evaluate(async () => {
    const mapController = window.mapController;
    const mapsData = await (await fetch('/data/database/maps.json')).json();
    const findMapConfig = (maps, mapId) => {
      for (const map of maps || []) {
        if (map.id === mapId) return map;
        const foundVariant = findMapConfig(map.variants, mapId);
        if (foundVariant) return foundVariant;
        const foundMember = findMapConfig(map.members, mapId);
        if (foundMember) return foundMember;
      }
      return null;
    };
    const mapConfig = findMapConfig(mapsData.maps, 'oa-2001');
    if (!mapConfig) throw new Error('Missing oa-2001 map config');

    mapController.map.setView([54.7, -6.8], 7);
    mapController.clearLoadMetrics();
    await mapController.loadLayer(mapConfig, true);

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (mapController.isLayerLoaded('oa-2001')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      loaded: mapController.isLayerLoaded('oa-2001'),
      metrics: mapController.getLoadMetrics()
    };
  });

  expect(beforeZoom.loaded).toBe(true);
  const chunkIndex = beforeZoom.metrics.find((entry) =>
    entry.type === 'chunk-index-loaded' && entry.mapId === 'oa-2001'
  );
  expect(chunkIndex).toBeTruthy();

  const initialChunkLoad = beforeZoom.metrics.find((entry) =>
    entry.type === 'chunked-layer-loaded' && entry.mapId === 'oa-2001'
  );
  expect(initialChunkLoad).toBeTruthy();
  expect(initialChunkLoad.concurrency).toBe(4);

  const z7Chunk = beforeZoom.metrics.find((entry) =>
    entry.type === 'chunk-file-loaded'
    && entry.mapId === 'oa-2001'
    && /_z7\.fgb$/i.test(entry.source)
  );
  expect(z7Chunk).toBeTruthy();

  const afterZoom = await page.evaluate(async () => {
    const mapController = window.mapController;
    mapController.clearLoadMetrics();
    mapController.map.setZoom(10);

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const metrics = mapController.getLoadMetrics();
      if (metrics.some((entry) => entry.type === 'chunked-viewport-reload' && entry.mapId === 'oa-2001')) {
        return metrics;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return mapController.getLoadMetrics();
  });

  const reloadMetric = afterZoom.find((entry) =>
    entry.type === 'chunked-viewport-reload'
    && entry.mapId === 'oa-2001'
    && entry.reason === 'zoom-band-changed'
  );
  expect(reloadMetric).toBeTruthy();
  expect(reloadMetric.concurrency).toBe(4);

  const z10Chunk = afterZoom.find((entry) =>
    entry.type === 'chunk-file-loaded'
    && entry.mapId === 'oa-2001'
    && /_z10\.fgb$/i.test(entry.source)
  );
  expect(z10Chunk).toBeTruthy();
});

test('representative non-chunked maps use LOD sources at low zoom', async ({ page }) => {
  await page.goto('/');

  const cases = [
    { mapId: 'lgd-2012', center: [54.7, -6.8], zoom: 6 },
    { mapId: 'pc-2023', center: [54.7, -6.8], zoom: 6 },
    { mapId: 'river-basin-districts', center: [53.4, -7.8], zoom: 6 },
    { mapId: 'dail-2023', center: [53.4, -7.8], zoom: 6 }
  ];

  for (const testCase of cases) {
    await resetMapState(page);
    const loaded = await page.evaluate(async ({ mapId, center, zoom }) => {
      const mapController = window.mapController;
      mapController.map.setView(center, zoom);
      mapController.clearLoadMetrics();
      await window.uiController.onMapLoad(mapId);

      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (mapController.isLayerLoaded(mapId)) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return {
        loaded: mapController.isLayerLoaded(mapId),
        metrics: mapController.getLoadMetrics()
      };
    }, testCase);

    expect(loaded.loaded).toBe(true);
    const lodSelected = loaded.metrics.find((entry) =>
      entry.type === 'lod-source-selected' && entry.mapId === testCase.mapId
    );
    expect(lodSelected).toBeTruthy();
    expect(Number(lodSelected.lodLevel)).toBeLessThan(2);

    const vectorLoaded = loaded.metrics.find((entry) =>
      entry.type === 'vector-layer-loaded' && entry.mapId === testCase.mapId
    );
    expect(vectorLoaded).toBeTruthy();
  }
});

test('largest local LOD-only map uses low-zoom LOD and avoids the raw FGB', async ({ page }) => {
  const fgbRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/data/maps/local-government/ROI_Garda_Sub_Districts')) {
      fgbRequests.push(url);
    }
  });

  await page.goto('/');

  await resetMapState(page);

  const loaded = await page.evaluate(async () => {
    const mapController = window.mapController;
    mapController.map.setView([53.4, -7.8], 6);
    mapController.clearLoadMetrics();
    await window.uiController.onMapLoad('roi-garda-sub-districts');

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (mapController.isLayerLoaded('roi-garda-sub-districts')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      loaded: mapController.isLayerLoaded('roi-garda-sub-districts'),
      metrics: mapController.getLoadMetrics()
    };
  });

  expect(loaded.loaded).toBe(true);

  const lodSelected = loaded.metrics.find((entry) =>
    entry.type === 'lod-source-selected' && entry.mapId === 'roi-garda-sub-districts'
  );
  expect(lodSelected).toBeTruthy();
  expect(lodSelected.source).toMatch(/ROI_Garda_Sub_Districts-lod[01]\.fgb$/);
  expect(Number(lodSelected.lodLevel)).toBeLessThan(2);

  const vectorLoaded = loaded.metrics.find((entry) =>
    entry.type === 'vector-layer-loaded' && entry.mapId === 'roi-garda-sub-districts'
  );
  expect(vectorLoaded).toBeTruthy();
  expect(vectorLoaded.source).toMatch(/ROI_Garda_Sub_Districts-lod[01]\.fgb$/);

  expect(fgbRequests.some((url) => /\/ROI_Garda_Sub_Districts-lod[01]\.fgb$/i.test(new URL(url).pathname))).toBe(true);
  expect(fgbRequests.some((url) => new URL(url).pathname.endsWith('/ROI_Garda_Sub_Districts.fgb'))).toBe(false);
});
