const { test, expect } = require('@playwright/test');

test('timeline stays visible when switching to a placeholder-only date', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    await app.loadMap('stormont-1920');
  });

  const slider = page.locator('#timelineSlider');
  await expect(slider).toBeVisible();

  const result = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const timeSliderController = (await import('/js/time-slider-controller.js')).default;
    const beforeIds = app.getLoadedLayerIds().sort();

    const placeholderIndex = timeSliderController.dates.findIndex((ts) => {
      const d = new Date(ts);
      return d.getUTCFullYear() === 1969;
    });

    if (placeholderIndex < 0) {
      return { error: 'PLACEHOLDER_DATE_NOT_FOUND' };
    }

    timeSliderController.slider.value = String(timeSliderController.dates[placeholderIndex]);
    timeSliderController.handleSliderInput();
    const afterInputIds = app.getLoadedLayerIds().sort();
    timeSliderController.handleSliderCommit();
    await new Promise((resolve) => setTimeout(resolve, 250));

    return {
      placeholderIndex,
      label: document.getElementById('timelineLabel')?.textContent || '',
      sliderHidden: document.getElementById('timelineSlider')?.classList.contains('hidden') || false,
      beforeIds,
      afterInputIds,
      loadedIds: app.getLoadedLayerIds().sort()
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.label).toContain('1969');
  expect(result.afterInputIds).toEqual(result.beforeIds);
  expect(result.loadedIds).not.toContain('stormont-1920');
  await expect(slider).toBeVisible();
  expect(result.sliderHidden).toBe(false);
});
