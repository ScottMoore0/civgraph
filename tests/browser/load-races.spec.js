// The two load races the state-machine catalogue rated high (MA-03, MA-06), fixed 7 Nov 2026 with
// the owner's approval. Each test starts a load and, before it finishes, does what used to break
// it: before the fix the election reopened, a second load of one layer threw "source already
// exists", and a layer removed while loading appeared anyway.
const { test, expect } = require('@playwright/test');

async function openApp(page) {
  await page.goto('/maps/');
  await page.waitForFunction(() => window.__civgraphTest2?.elections?.catalogue?.elections?.length, null, { timeout: 60000 });
  return page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    for (const mapId of Array.from(app.mapController.layerStates.keys())) {
      if (app.mapController.isLayerLoaded(mapId)) app.mapController.unloadLayer(mapId);
    }
    const entry = app.elections.catalogue.elections.find((e) => e.body === 'Dáil Éireann' && e.date === '2024-11-29' && e.loadable);
    return entry ? { body: entry.body, date: entry.date, sourceMapId: entry.sourceMapId } : null;
  });
}

test('MA-06: two loads of one layer at once load it once, without an error', async ({ page }) => {
  test.setTimeout(120000);
  const entry = await openApp(page);
  expect(entry).toBeTruthy();
  const result = await page.evaluate(async (id) => {
    const controller = window.__civgraphTest2.app.mapController;
    const outcomes = await Promise.allSettled([controller.loadLayer(id, { fit: false }), controller.loadLayer(id, { fit: false })]);
    return { outcomes: outcomes.map((o) => o.status + (o.reason ? `: ${o.reason.message}` : '')), loaded: controller.isLayerLoaded(id) };
  }, entry.sourceMapId);
  expect(result.outcomes).toEqual(['fulfilled', 'fulfilled']);
  expect(result.loaded).toBe(true);
});

test('MA-06: a layer taken off while it loads stays off', async ({ page }) => {
  test.setTimeout(120000);
  const entry = await openApp(page);
  const result = await page.evaluate(async (id) => {
    const controller = window.__civgraphTest2.app.mapController;
    const load = controller.loadLayer(id, { fit: false });
    controller.unloadLayer(id);
    await load;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { loaded: controller.isLayerLoaded(id), onMap: Boolean(controller.renderer.layers.has(controller.mainToTest.get(id) || id)) };
  }, entry.sourceMapId);
  expect(result).toEqual({ loaded: false, onMap: false });
});

test('MA-03: closing an election while it loads keeps it closed', async ({ page }) => {
  test.setTimeout(120000);
  const entry = await openApp(page);
  const result = await page.evaluate(async ({ body, date, sourceMapId }) => {
    const app = window.__civgraphTest2.app;
    const load = app.elections.loadElection(body, date);
    app.elections.unloadElection();
    await load.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { active: Boolean(app.elections.activeEntry), state: app.elections.loadRun?.state() ?? null, layer: app.mapController.isLayerLoaded(sourceMapId) };
  }, entry);
  expect(result).toEqual({ active: false, state: 'closed', layer: false });
});

test('MA-03: stepping Back to an entry without the election cancels its load', async ({ page }) => {
  test.setTimeout(120000);
  const entry = await openApp(page);
  const result = await page.evaluate(async ({ body, date }) => {
    const app = window.__civgraphTest2.app;
    const load = app.elections.loadElection(body, date);
    // What a step Back does first: take off what the earlier entry did not have.
    app.removeStateNotIn(new URLSearchParams(''));
    await load.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return { active: Boolean(app.elections.activeEntry), state: app.elections.loadRun?.state() ?? null };
  }, entry);
  expect(result).toEqual({ active: false, state: 'closed' });
});

test('MA-03: an election opened without interruption still opens', async ({ page }) => {
  test.setTimeout(120000);
  const entry = await openApp(page);
  const result = await page.evaluate(async ({ body, date }) => {
    const app = window.__civgraphTest2.app;
    await app.elections.loadElection(body, date);
    return { active: app.elections.activeEntry?.date || null, state: app.elections.loadRun?.state() ?? null };
  }, entry);
  expect(result).toEqual({ active: entry.date, state: 'open' });
});
