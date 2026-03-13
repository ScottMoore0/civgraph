const { test, expect } = require('@playwright/test');

async function resetMapState(page) {
  await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const mapController = (await import('/js/map-controller.js')).default;
    for (const mapId of app.getLoadedLayerIds()) {
      mapController.unloadLayer(mapId);
    }
    mapController.clearLoadMetrics();
  });
}

test('eds-ulster-1911 uses an LOD source at low zoom', async ({ page }) => {
  await page.goto('/');

  await resetMapState(page);

  const loaded = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const mapController = (await import('/js/map-controller.js')).default;
    mapController.map.setView([54.6, -7.3], 6);
    mapController.clearLoadMetrics();
    await app.loadMap('eds-ulster-1911');

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (app.getLoadedLayerIds().includes('eds-ulster-1911')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      loadedIds: app.getLoadedLayerIds(),
      metrics: mapController.getLoadMetrics()
    };
  });

  expect(loaded.loadedIds).toContain('eds-ulster-1911');
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
    const app = (await import('/js/app.js')).default;
    const mapController = (await import('/js/map-controller.js')).default;
    mapController.map.setView([54.7, -6.8], 7);
    mapController.clearLoadMetrics();
    await app.loadMap('oa-2001');

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (app.getLoadedLayerIds().includes('oa-2001')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      loadedIds: app.getLoadedLayerIds(),
      metrics: mapController.getLoadMetrics()
    };
  });

  expect(beforeZoom.loadedIds).toContain('oa-2001');
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
    const mapController = (await import('/js/map-controller.js')).default;
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
