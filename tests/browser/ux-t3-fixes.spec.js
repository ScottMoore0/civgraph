const { test, expect } = require('@playwright/test');

// Guards for the UX-plan T3 items fixed on 2026-08-23. Each asserts the BEHAVIOUR the
// item described, not the presence of the code that implements it.

test('T3-01 · the map count is formatted and internal codes are gone', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2500);

  const text = await page.locator('#catalogueFlatView').textContent();
  // Four figures unseparated read as a typo. This was the only unformatted number.
  expect(text).toMatch(/1,0\d\d maps/);
  expect(text).not.toMatch(/\b1\d{3} maps/);

  // Bracketed internal codes leaked into the UI as literal text.
  const body = await page.locator('body').textContent();
  for (const code of ['[all]', '[com]', '[his]', '[gov]', '[svc]', '[geo]', '[built]', '[NI]', '[IE]', '[UK]', '[EU]']) {
    expect(body, `internal code ${code} is visible`).not.toContain(code);
  }
  // The facet groups PROVIDERS BY JURISDICTION -- its values are Northern Ireland,
  // Ireland, United Kingdom, European Union -- so "Filter by Provider" named it wrongly.
  expect(body).not.toContain('Filter by Provider');
  // The only Americanism, and the accent that was missing from Dail Eireann.
  expect(body).not.toContain('Organizations');
  expect(body).not.toContain('Dáil Eireann');
});

test('T3-06 · the support modal traps focus, inerts the background, and restores focus', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const opener = page.locator('#supportBtn');
  if (!(await opener.count()) || !(await opener.isVisible())) test.skip(true, 'support button not present on this viewport');

  await opener.click();
  await expect(page.locator('#supportModal')).not.toHaveClass(/hidden/);

  const state = await page.evaluate(() => {
    const modal = document.getElementById('supportModal');
    return {
      focusInside: modal.contains(document.activeElement),
      // aria-modal="true" PROMISES the background is inert. Before this fix nothing
      // implemented that, so the promise was simply false.
      backgroundInert: [...document.body.children]
        .filter((el) => el !== modal)
        .every((el) => el.getAttribute('aria-hidden') === 'true'),
    };
  });
  expect(state.focusInside, 'focus should move into the dialog on open').toBe(true);
  expect(state.backgroundInert, 'background should be aria-hidden while the modal is open').toBe(true);

  // Tab must wrap inside the dialog rather than walking out into the page behind.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.getElementById('supportModal').contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#supportModal')).toHaveClass(/hidden/);

  const after = await page.evaluate(() => ({
    restored: document.activeElement?.id || document.activeElement?.tagName,
    backgroundRestored: [...document.body.children]
      .filter((el) => el.id !== 'supportModal')
      .every((el) => !el.hasAttribute('aria-hidden')),
  }));
  expect(after.restored, 'focus should return to the opener, not <body>').toBe('supportBtn');
  expect(after.backgroundRestored).toBe(true);
});

test('T3-07 · a hidden layer looks hidden, and reorder works from the keyboard', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length, null, { timeout: 60000 });

  await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    await app.loadMap('provinces-1955');
    await app.loadMap('counties-ireland-1955');
    app.updateActiveLayers();
  });
  // The Active Layers panel must be OPEN for its rows to exist -- the same thing that
  // made an earlier drag test look like a broken feature.
  await page.locator('#activeLayersToggle').click({ timeout: 20000 }).catch(() => {});
  await page.waitForSelector('#activeLayersList .active-layer-item[data-map-id]', { timeout: 30000 });

  // Opacity inputs had a <label> beside them with no `for`, so it named nothing and each
  // control reached a screen reader as an unlabelled edit box.
  const unnamedInputs = await page.evaluate(() =>
    [...document.querySelectorAll('#activeLayersList input[type="range"], #activeLayersList input[type="number"]')]
      .filter((el) => !el.getAttribute('aria-label'))
      .length);
  expect(unnamedInputs).toBe(0);

  // Hidden and visible rows were identical apart from a `title` nobody sees.
  const before = await page.evaluate(() => {
    const row = document.querySelector('#activeLayersList .active-layer-item[data-map-id]');
    return { id: row.dataset.mapId, badge: !!row.querySelector('.active-layer-item__hidden-badge') };
  });
  expect(before.badge).toBe(false);
  await page.locator(`#activeLayersList .active-layer-item[data-map-id="${before.id}"] .visibility-btn`).click();
  await expect(page.locator(`#activeLayersList .active-layer-item[data-map-id="${before.id}"] .active-layer-item__hidden-badge`)).toHaveCount(1);
  await expect(page.locator(`#activeLayersList .active-layer-item[data-map-id="${before.id}"] .visibility-btn`)).toHaveAttribute('aria-pressed', 'true');

  // WCAG 2.1.1: reordering was reachable only by dragging a 16px handle.
  const order = () => page.evaluate(() =>
    [...document.querySelectorAll('#activeLayersList .active-layer-item[data-map-id]')].map((r) => r.dataset.mapId));
  const start = await order();
  await page.locator(`#activeLayersList .active-layer-item[data-map-id="${start[0]}"] .active-layer-item__drag`).focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(600);
  const moved = await order();
  expect(moved[0]).toBe(start[1]);
  expect(moved[1]).toBe(start[0]);
});

test('T3-08 · duplicate election column names are disambiguated for assistive tech', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForSelector('#electionPaneContent th[data-leaf-col-idx]');

  // The header text carries a sort glyph, so it reads "+/-<glyph>" rather than "+/-".
  const headers = await page.evaluate(() =>
    [...document.querySelectorAll('#electionPaneContent th[data-leaf-col-idx]')]
      .map((th) => ({ text: th.textContent.trim(), name: th.getAttribute('aria-label'), scope: th.getAttribute('scope') })));

  // The visible text is still the compact "+/-" -- the two-row header disambiguates it
  // for a sighted reader and the design is unchanged.
  expect(headers.filter((h) => h.text.startsWith('+/-')).length).toBeGreaterThan(1);
  // The ANNOUNCED name must be unique: four columns reading "+/-" told a screen-reader
  // user nothing about which was seats and which was votes.
  // Only the LEAF columns are group-qualified; # and Party are already unique and are
  // rendered by a different path, so assert on the ones this fix covers.
  const leaves = headers.filter((h) => h.name);
  expect(leaves.length).toBeGreaterThanOrEqual(10);
  expect(new Set(leaves.map((h) => h.name)).size).toBe(leaves.length);
  expect(leaves.every((h) => h.scope === 'col')).toBe(true);
});
