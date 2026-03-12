const { test, expect } = require('@playwright/test');

test('non-election latest committed date wins when an older swap resolves later', async ({ page }) => {
  await page.goto('/');

  const setup = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const mapController = (await import('/js/map-controller.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    timeSliderController._debugApplySnapshots = [];
    timeSliderController._dateChangeHistory = [];
    const originalApplyDateChange = timeSliderController.applyDateChange.bind(timeSliderController);
    timeSliderController.applyDateChange = async function patchedApplyDateChange() {
      const snapshot = {
        currentIndex: this.currentIndex,
        targetTimestamp: this.dates[this.currentIndex],
        activeChainIds: (this.activeChains || []).map((chain) => chain.id),
        preservedChainIds: (this._preservedTimelineChains || []).map((chain) => chain.id),
        loadedIdsBefore: app.getLoadedLayerIds().sort()
      };
      const result = await originalApplyDateChange();
      snapshot.loadedIdsAfter = app.getLoadedLayerIds().sort();
      snapshot.metrics = this._lastDateChangeMetrics;
      this._debugApplySnapshots.push(snapshot);
      return result;
    };

    for (const mapId of app.getLoadedLayerIds()) {
      mapController.unloadLayer(mapId);
    }
    await app.loadMap('lgd-2012');
    await app.loadMap('wards-1972');

    const beforeIds = app.getLoadedLayerIds().sort();
    const timelineChains = timeSliderController._getTimelineChainsForDateChange(beforeIds);
    const firstIndex = timeSliderController.dates.findIndex(
      (timestamp) => new Date(timestamp).toISOString().slice(0, 10) === '1984-01-01'
    );
    const secondIndex = timeSliderController.dates.findIndex(
      (timestamp) => new Date(timestamp).toISOString().slice(0, 10) === '1993-01-01'
    );
    const firstPlan = firstIndex >= 0
      ? timeSliderController._buildDateChangePlan(beforeIds, timelineChains, timeSliderController.dates[firstIndex])
      : null;
    const secondPlan = secondIndex >= 0
      ? timeSliderController._buildDateChangePlan(beforeIds, timelineChains, timeSliderController.dates[secondIndex])
      : null;

    if (!firstPlan || !secondPlan || firstPlan.loadIds.length < 2 || secondPlan.loadIds.length < 2) {
      return {
        error: 'NOT_ENOUGH_MULTI_LAYER_TARGET_DATES',
        beforeIds,
        firstIndex,
        secondIndex,
        firstPlan,
        secondPlan
      };
    }

    const delayedId = firstPlan.loadIds[0];
    if (!delayedId) {
      return { error: 'NO_DELAY_TARGET_ID' };
    }

    const originalLoadLayer = mapController.loadLayer.bind(mapController);
    let delayApplied = false;
    mapController.loadLayer = async function patchedLoadLayer(mapConfig, show = true, options = {}) {
      if (mapConfig?.id === delayedId && !delayApplied) {
        delayApplied = true;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return originalLoadLayer(mapConfig, show, options);
    };

    return {
      beforeIds,
      firstIndex,
      secondIndex,
      expectedIds: [...secondPlan.resultingLoadedIds].sort(),
      delayedId
    };
  });

  expect(setup.error).toBeUndefined();

  await page.evaluate(async ({ firstIndex, secondIndex }) => {
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;

    timeSliderController.slider.value = String(timeSliderController.dates[firstIndex]);
    timeSliderController.handleSliderInput();
    timeSliderController.handleSliderCommit();

    timeSliderController.slider.value = String(timeSliderController.dates[secondIndex]);
    timeSliderController.handleSliderInput();
    timeSliderController.handleSliderCommit();
  }, { firstIndex: setup.firstIndex, secondIndex: setup.secondIndex });

  const raceSettled = await page.evaluate(async (expectedIds) => {
    const app = (await import('/js/app.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    const targetJson = JSON.stringify([...expectedIds].sort());
    const deadline = Date.now() + 10000;

    while (Date.now() < deadline) {
      const loadedIds = app.getLoadedLayerIds().sort();
      const metrics = timeSliderController._lastDateChangeMetrics;
      const history = timeSliderController._dateChangeHistory || [];
      const sawWinningApply = history.some((entry) => entry?.requestToken === 2 && entry?.applied === true && entry?.stale === false);
      const sawStaleApply = history.some((entry) => entry?.requestToken === 1 && entry?.applied === false && entry?.stale === true);
      if (
        JSON.stringify(loadedIds) === targetJson
        && metrics
        && metrics.applied === true
        && metrics.stale === false
        && sawWinningApply
        && sawStaleApply
      ) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return false;
  }, setup.expectedIds);

  expect(raceSettled).toBe(true);

  const result = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    const loadedIds = app.getLoadedLayerIds().sort();
    return {
      loadedIds,
      uniqueIds: [...new Set(loadedIds)].sort(),
      metrics: timeSliderController._lastDateChangeMetrics,
      staleMetrics: timeSliderController._lastStaleDateChangeMetrics,
      history: timeSliderController._dateChangeHistory || [],
      activeChainIds: (timeSliderController.activeChains || []).map((chain) => chain.id),
      preservedChainIds: (timeSliderController._preservedTimelineChains || []).map((chain) => chain.id),
      debugApplySnapshots: timeSliderController._debugApplySnapshots || []
    };
  });
  expect(result.loadedIds).toEqual(setup.expectedIds);
  expect(result.uniqueIds).toEqual(setup.expectedIds);
  expect(result.metrics.applied).toBe(true);
  expect(result.metrics.stale).toBe(false);
  expect(result.history.some((entry) => entry.requestToken === 2 && entry.applied === true && entry.stale === false)).toBe(true);
  expect(result.history.some((entry) => entry.requestToken === 1 && entry.applied === false && entry.stale === true)).toBe(true);
});
