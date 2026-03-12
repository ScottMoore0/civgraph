const { test, expect } = require('@playwright/test');

  test('malformed shared hash still restores requested map layers', async ({ page }) => {
  await page.goto('/#layers%20=%20dublin-electoral-counties-1985&&zoom=12&lat=53.3460&lng=-6.2766&base=osm-standard%20');

  const restoredMalformed = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (app.getLoadedLayerIds().includes('dublin-electoral-counties-1985')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });

  expect(restoredMalformed).toBe(true);

  const result = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    return {
      hash: window.location.hash,
      loadedIds: app.getLoadedLayerIds().sort()
    };
  });

  expect(result.loadedIds).toContain('dublin-electoral-counties-1985');
});

test('copyMapUrl generates a clean deep link that restores the chosen map', async ({ page }) => {
  await page.goto('/');

  const copiedUrl = await page.evaluate(async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          copied = value;
        }
      }
    });

    const uiController = (await import('/js/ui-controller.js')).default;
    uiController.copyMapUrl('dublin-electoral-counties-1985', null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return copied;
  });

  expect(copiedUrl).toContain('#layers=dublin-electoral-counties-1985');
  expect(copiedUrl).not.toContain('layers%20=%20');
  expect(copiedUrl).not.toContain('layers = ');
  expect(copiedUrl).not.toMatch(/\s$/);

  await page.goto(copiedUrl);

  const restoredClean = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (app.getLoadedLayerIds().includes('dublin-electoral-counties-1985')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  });

  expect(restoredClean).toBe(true);

  const restored = await page.evaluate(async () => {
    const app = (await import('/js/app.js')).default;
    return app.getLoadedLayerIds().sort();
  });

  expect(restored).toContain('dublin-electoral-counties-1985');
});
