/**
 * Moving between views leaves no duplicate listeners on document or window
 * (docs/ARCHITECTURE-RULES.md R8, check C7; rf8-frontend, 12 Nov 2026).
 *
 * An init script counts the listeners live on document and window, as the browser holds them:
 * a listener added twice is one, removeEventListener and an aborted { signal } take it away.
 * Each page is opened, taken through its views and back, and the count on returning to a view
 * must be the count the first visit left; dispose() (the owners' lifecycle signals) must take
 * the page's own listeners away.
 *
 *   npx playwright test --config config/playwright.config.cjs tests/browser/listener-lifecycle.spec.cjs
 */
const { test, expect } = require('@playwright/test');

function countListeners() {
  const live = new Map([[document, new Set()], [window, new Set()]]);
  const ids = new WeakMap();
  let next = 0;
  const key = (type, listener, options) => {
    if (!ids.has(listener)) ids.set(listener, ++next);
    const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
    return `${type}|${ids.get(listener)}|${capture}`;
  };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const set = live.get(this);
    const signal = options && typeof options === 'object' ? options.signal : null;
    if (set && listener && !(signal && signal.aborted)) {
      const k = key(type, listener, options);
      set.add(k);
      if (signal) signal.addEventListener('abort', () => set.delete(k), { once: true });
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const set = live.get(this);
    if (set && listener) set.delete(key(type, listener, options));
    return remove.call(this, type, listener, options);
  };
  window.__liveListeners = () => ({ document: live.get(document).size, window: live.get(window).size });
}

let pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(countListeners);
});
test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const live = (page) => page.evaluate(() => window.__liveListeners());

test('Browse: going between its views and back adds no listener to document or window', async ({ page }) => {
  await page.route('**/data/browse/index.json', (route) => route.fulfill(json({ counts: { parties: 2 }, groups: [] })));
  await page.route('**/_api/parties', (route) => route.fulfill(json({ items: [{ id: 'alpha', slug: 'alpha', title: 'Alpha Party' }] })));
  await page.route('**/_api/auth/status', (route) => route.fulfill(json({ auth: { authenticated: false, allowed: false } })));
  await page.route('**/_api/contributions/whoami', (route) => route.fulfill(json({ auth: { authenticated: false, allowed: false } })));

  await page.goto('/browse/#/parties');
  await expect(page.getByText('Alpha Party')).toBeVisible();
  const first = await live(page);
  expect(first.window).toBeGreaterThan(0);

  for (let round = 0; round < 3; round += 1) {
    await page.evaluate(() => { location.hash = '#/'; });
    await expect(page.getByText('Alpha Party')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/parties?labels=1'; });
    await expect(page).toHaveURL(/labels=1/);
    await page.goBack();
    await page.goForward();
    await page.evaluate(() => { location.hash = '#/parties'; });
    await expect(page.getByText('Alpha Party')).toBeVisible();
    expect(await live(page), `after round ${round + 1}`).toEqual(first);
  }
});

test('the map: opening maps and going back adds no listener, and dispose() takes the app listeners away', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/maps/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length
    && typeof window.uiController?.showCatalogueDetailView === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const ids = await page.evaluate(() => window.__civgraphTest2.metadataService.layers.slice(0, 3).map((layer) => layer.id));
  const visit = async () => {
    for (const id of ids) {
      await page.evaluate((mapId) => window.uiController.showCatalogueDetailView(mapId), id);
      await page.waitForTimeout(300);
      await page.evaluate(() => window.uiController.showCatalogueListView(true));
      await page.waitForTimeout(300);
    }
    await page.goBack();
    await page.waitForTimeout(300);
    await page.goForward();
    await page.waitForTimeout(300);
  };
  // The first visit settles what start-up registers for a moment (the map's load listeners).
  await visit();
  const settled = await live(page);
  expect(settled.document).toBeGreaterThan(0);
  for (let round = 0; round < 2; round += 1) {
    await visit();
    expect(await live(page), `after round ${round + 1}`).toEqual(settled);
  }

  // The owners' lifecycle signals: the app (and its map controller) and the catalogue's controller.
  await page.evaluate(() => {
    window.__civgraphTest2.app.dispose();
    window.uiController.dispose();
  });
  const after = await live(page);
  expect(after.document).toBeLessThan(settled.document);
  expect(after.window).toBeLessThan(settled.window);
});
