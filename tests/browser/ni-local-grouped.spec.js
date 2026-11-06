const { test, expect } = require('@playwright/test');

/**
 * The pre-1973 Northern Ireland local elections, one entry a year (app/src/ni-local-view.js):
 * the level, votes/seats and aldermen toggles, the hatching of areas whose results are missing
 * or incomplete, the address, the old addresses of single council rounds, and the pane at phone
 * width. See tests/elections/ni-local-grouped.test.mjs for the data behind it.
 */

const BOOT_TIMEOUT = 45000;
const YEAR_BODY = 'Northern Ireland local elections';

async function bootApp(page, hash = '') {
  await page.goto(`/maps/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2BootStarted === true, null, { timeout: BOOT_TIMEOUT });
  await page.waitForFunction(() => typeof window.__civgraphTest2?.whenIdle === 'function', null, { timeout: BOOT_TIMEOUT });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.evaluate(async () => {
    window.__civgraphTest2.elections = await window.__civgraphTest2.app.ensureElections();
  });
}

async function openYear(page, year, options = {}) {
  await page.evaluate(async ({ body, year: y, options: o }) => {
    const elections = window.__civgraphTest2.elections;
    const entry = elections.findEntry(body, String(y));
    await elections.loadNiLocalGroup(entry, o);
  }, { body: YEAR_BODY, year, options });
  await expect(page.locator('#electionPaneTitle')).toHaveText(`${year} Northern Ireland local elections`);
}

function viewState(page) {
  return page.evaluate(() => {
    const elections = window.__civgraphTest2.elections;
    const view = elections.niLocal;
    const map = window.__civgraphTest2.app.mapController.map;
    const sourceMapId = view?.sourceMapId();
    const testId = window.__civgraphTest2.app.mapController.mainToTest?.get(sourceMapId) || sourceMapId;
    const hatch = map.getLayer(`${testId}-election-hatch`) ? map.getFilter(`${testId}-election-hatch`) : null;
    return {
      active: Boolean(view?.active),
      key: elections.activeEntry?.key,
      level: view?.level,
      show: view?.show,
      members: view?.members,
      sourceMapId,
      hatch: hatch ? JSON.stringify(hatch) : null,
      hash: decodeURIComponent(location.hash)
    };
  });
}

test('the year list replaces the pre-1973 council rounds', async ({ page }) => {
  await bootApp(page);
  const cards = await page.evaluate(() => {
    const cardsList = window.__civgraphTest2.elections.buildCatalogueCards();
    return {
      groups: cardsList.filter((c) => c.niLocalGroup).map((c) => c.key),
      councilRounds: cardsList.filter((c) => /(council|commissioners)$/.test(String(c.bodySlug || '').replace(/-aldermen$/, '')) && String(c.date) < '1973').length,
      later: cardsList.filter((c) => c.bodyGroup === 'local-government').length
    };
  });
  expect(cards.groups).toContain('ni-local__1946');
  expect(cards.groups).toContain('ni-local__1924');
  // Before 1921 the island's year, "Irish local elections".
  expect(cards.groups).toContain('ireland-local__1911');
  expect(cards.groups).not.toContain('ni-local__1911');
  expect(cards.councilRounds).toBe(0);
  expect(cards.later).toBeGreaterThan(0);
});

test('level, votes or seats, and aldermen toggles redraw the map and keep the address', async ({ page }) => {
  test.setTimeout(120000);
  await bootApp(page);
  await openYear(page, 1946, { level: 'districts', show: 'seats', members: 'councillors' });
  let state = await viewState(page);
  expect(state.active).toBe(true);
  expect(state.key).toBe('ni-local__1946');
  expect(state.level).toBe('districts');
  expect(state.hash).toContain('electionLevel=districts');
  expect(state.hash).toContain('electionShow=seats');

  await page.locator('[data-ni-level="ded"]').click();
  await expect(page.locator('[data-ni-level="ded"]')).toHaveAttribute('aria-pressed', 'true');
  state = await viewState(page);
  expect(state.level).toBe('ded');
  expect(state.sourceMapId).toMatch(/^ded-/);
  expect(state.hash).toContain('electionLevel=ded');

  await page.locator('[data-ni-show="votes"]').click();
  await expect(page.locator('[data-ni-show="votes"]')).toHaveAttribute('aria-pressed', 'true');
  state = await viewState(page);
  expect(state.show).toBe('votes');
  expect(state.hash).toContain('electionShow=votes');

  // 1946 had aldermanic polls (Belfast): the toggle is there and switches the results.
  const aldermen = page.locator('[data-ni-members="aldermen"]');
  await expect(aldermen).toBeVisible();
  await aldermen.click();
  state = await viewState(page);
  expect(state.members).toBe('aldermen');
  expect(state.hash).toContain('electionMembers=aldermen');
  await page.locator('[data-ni-members="councillors"]').click();
  state = await viewState(page);
  expect(state.members).toBe('councillors');
  expect(state.hash).not.toContain('electionMembers');

  // Keyboard: the buttons are reachable and Enter presses them.
  await page.locator('[data-ni-level="counties"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-ni-level="counties"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a level with no results that year is greyed out with the reason', async ({ page }) => {
  await bootApp(page);
  // 1934: borough and town polls only, no county councils, and no aldermanic polls.
  await openYear(page, 1934);
  const ced = page.locator('[data-ni-level="ced"]');
  await expect(ced).toHaveAttribute('aria-disabled', 'true');
  expect(await ced.getAttribute('title')).toMatch(/1934/);
  await ced.click({ force: true });
  expect((await viewState(page)).level).not.toBe('ced');
  // No aldermanic polls in 1934: no Members toggle.
  await expect(page.locator('[data-ni-members]')).toHaveCount(0);
});

test('areas whose results are missing or incomplete are hatched, and the legend says so', async ({ page }) => {
  await bootApp(page);
  await openYear(page, 1946, { level: 'districts', show: 'seats', members: 'councillors' });
  const expected = await page.evaluate(async () => {
    const data = await (await fetch('/render/metadata/ni-local/1946.json')).json();
    return data.levels.districts.features.councillors.filter((f) => f.hatch).map((f) => f.k);
  });
  expect(expected.length).toBeGreaterThan(0);
  const state = await viewState(page);
  expect(state.hatch).not.toBeNull();
  for (const key of expected.slice(0, 5)) expect(state.hatch).toContain(JSON.stringify(key));
  const legend = await page.evaluate(() => window.__civgraphTest2.elections.legendModel());
  expect(legend.keyNotes.some((note) => note.kind === 'hatch' && /not available or incomplete/.test(note.text))).toBe(true);
  // The pane opens a hatched area with its reason.
  await page.evaluate((key) => {
    const view = window.__civgraphTest2.elections.niLocal;
    view.renderArea(view.itemByKey(key));
  }, expected[0]);
  await expect(page.locator('.ni-local-hatch-note')).toBeVisible();
});

test('the address restores the year, level, mode and members; old round addresses still open the round', async ({ page }) => {
  test.setTimeout(120000);
  await bootApp(page, `#electionBody=${encodeURIComponent(YEAR_BODY)}&electionDate=1946&electionLevel=ded&electionShow=votes&electionMembers=aldermen`);
  await page.waitForFunction(() => window.__civgraphTest2.elections?.niLocal?.active === true, null, { timeout: 60000 });
  const state = await viewState(page);
  expect(state.key).toBe('ni-local__1946');
  expect(state.level).toBe('ded');
  expect(state.show).toBe('votes');
  expect(state.members).toBe('aldermen');

  const round = await page.evaluate(async () => {
    const data = await (await fetch('/render/metadata/ni-local/1946.json')).json();
    return data.rounds.find((r) => r.bodySlug === 'belfast-county-borough-council');
  });
  await bootApp(page, `#electionBody=${encodeURIComponent(round.body)}&electionDate=${round.date}`);
  await page.waitForFunction((key) => window.__civgraphTest2.elections?.activeEntry?.key === key, round.key, { timeout: 60000 });
  expect(await page.evaluate(() => Boolean(window.__civgraphTest2.elections.niLocal?.active))).toBe(false);
});

test('a pre-1921 year is the island\'s "Irish local elections", and its earlier address still opens it', async ({ page }) => {
  test.setTimeout(120000);
  await bootApp(page, `#electionBody=${encodeURIComponent(YEAR_BODY)}&electionDate=1911&electionLevel=districts`);
  await page.waitForFunction(() => window.__civgraphTest2.elections?.niLocal?.active === true, null, { timeout: 60000 });
  const state = await viewState(page);
  expect(state.key).toBe('ireland-local__1911');
  await expect(page.locator('#electionPaneTitle')).toHaveText('1911 Irish local elections');
  expect(state.hash.replace(/\+/g, ' ')).toContain('electionBody=Irish local elections');
  // The timeline runs on from the island's years into Northern Ireland's.
  const stops = await page.evaluate(() => {
    const elections = window.__civgraphTest2.elections;
    return elections.catalogue.elections.filter((e) => e.niLocalGroup).map((e) => e.key);
  });
  expect(stops).toContain('ireland-local__1911');
  expect(stops).toContain('ni-local__1924');
  await page.evaluate(async () => {
    const elections = window.__civgraphTest2.elections;
    await elections.loadElection('Northern Ireland local elections', '1924', { keepView: true });
  });
  expect((await viewState(page)).key).toBe('ni-local__1924');
});

test('at phone width the view menu folds and nothing overflows', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 375, height: 812 });
  await bootApp(page);
  await openYear(page, 1946, { level: 'districts', show: 'seats', members: 'councillors' });
  const view = page.locator('.ni-local-view');
  await expect(view).not.toHaveAttribute('open', '');
  await view.locator('summary').click();
  await expect(view).toHaveAttribute('open', '');
  const overflow = await page.evaluate(() => {
    const pane = document.getElementById('electionPaneContent');
    const wide = [...document.querySelectorAll('.ni-local-controls *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length;
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      controls: wide,
      pane: pane ? pane.scrollWidth - pane.clientWidth : 0
    };
  });
  expect(overflow.doc).toBeLessThanOrEqual(0);
  expect(overflow.controls).toBe(0);
  expect(overflow.pane).toBeLessThanOrEqual(1);
});
