const { test, expect } = require('@playwright/test');

test('non-election slider previews on drag and applies on commit', async ({ page }) => {
  await page.goto('/');

  const initial = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const mapController = (await import('/js/map-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    for (const mapId of app.getLoadedLayerIds()) {
      mapController.unloadLayer(mapId);
    }
    await app.loadMap('lgd-2012');
    await app.loadMap('wards-1972');
    timeSliderController._debugLayersChangedCount = 0;
    timeSliderController.onLayersChanged = () => {
      timeSliderController._debugLayersChangedCount += 1;
    };

    const beforeIds = app.getLoadedLayerIds().sort();
    const timelineChains = timeSliderController._getTimelineChainsForDateChange(beforeIds);
    const currentIndex = timeSliderController.currentIndex;

    const targetIndex = timeSliderController.dates.findIndex(
      (timestamp) => new Date(timestamp).toISOString().slice(0, 10) === '1984-01-01'
    );
    const plan = targetIndex >= 0
      ? timeSliderController._buildDateChangePlan(
          beforeIds,
          timelineChains,
          timeSliderController.dates[targetIndex]
        )
      : null;
    const expectedIds = plan ? [...plan.resultingLoadedIds].sort() : [];

    if (targetIndex < 0 || expectedIds.length === 0) {
      return {
        error: 'NO_REAL_TARGET_DATE_FOUND',
        beforeIds,
        timelineChains: timelineChains.map((chain) => chain.id),
        currentIndex,
        targetIndex,
        plan
      };
    }

    const targetTimestamp = timeSliderController.dates[targetIndex];
    timeSliderController.slider.value = String(targetTimestamp);
    timeSliderController.handleSliderInput();

    return {
      beforeIds,
      afterInputIds: app.getLoadedLayerIds().sort(),
      currentIndexBefore: currentIndex,
      currentIndexAfterInput: timeSliderController.currentIndex,
      previewIndex: timeSliderController._previewIndex,
      labelAfterInput: document.getElementById('timelineLabel')?.textContent || '',
      targetIndex,
      expectedIds
    };
  });

  expect(initial.error).toBeUndefined();
  expect(initial.afterInputIds).toEqual(initial.beforeIds);
  expect(initial.currentIndexAfterInput).toBe(initial.currentIndexBefore);
  expect(initial.previewIndex).toBe(initial.targetIndex);

  await page.evaluate(async () => {
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    timeSliderController.handleSliderCommit();
  });

  const committedSettled = await page.evaluate(async (expectedIds) => {
    const app = (await import('/js/app.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    const targetJson = JSON.stringify([...expectedIds].sort());
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      const actualIds = app.getLoadedLayerIds().sort();
      const metrics = timeSliderController._lastDateChangeMetrics;
      if (
        JSON.stringify(actualIds) === targetJson
        && timeSliderController._previewIndex === null
        && metrics
        && metrics.applied === true
        && metrics.stale === false
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  }, initial.expectedIds);

  expect(committedSettled).toBe(true);

  const committed = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    return {
      loadedIds: app.getLoadedLayerIds().sort(),
      currentIndex: timeSliderController.currentIndex,
      previewIndex: timeSliderController._previewIndex,
      labelAfterCommit: document.getElementById('timelineLabel')?.textContent || '',
      layersChangedCount: timeSliderController._debugLayersChangedCount || 0,
      metrics: timeSliderController._lastDateChangeMetrics
    };
  });
  expect(committed.loadedIds).toEqual(initial.expectedIds);
  expect(committed.currentIndex).not.toBe(initial.currentIndexBefore);
  expect(committed.previewIndex).toBe(null);
  expect(committed.labelAfterCommit).not.toBe('');
  expect(committed.layersChangedCount).toBe(1);
  expect(committed.metrics.applied).toBe(true);
  expect(committed.metrics.stale).toBe(false);
});
