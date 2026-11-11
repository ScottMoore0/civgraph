const { test, expect } = require('@playwright/test');

/**
 * The map-app fixes from the UI/UX review of 2026-10-30 (docs/review/UX-REVIEW-2026-10-30.md),
 * driven through the real app: search by body, failures that say so, the phone flow, keyboard
 * and screen-reader gaps, browser history, the legend and the timeline's year labels.
 *
 * Layer tiles and election results come from R2 and the elections API, so these need the
 * network, as the rest of the app suite does; failures are simulated by routing requests to an
 * error, not by trusting the real host to fail.
 */

test.use({ serviceWorkers: 'block' });

async function boot(page, hash = '') {
  await page.goto(`/maps/${hash}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  const intro = page.locator('.catalogue-intro__close');
  // On a phone the catalogue (and its intro) is behind the map until it is opened.
  if (await intro.isVisible().catch(() => false)) await intro.click({ timeout: 3000 }).catch(() => {});
}

async function search(page, query) {
  await page.fill('#searchInput', query);
  await page.waitForFunction((q) => document.querySelector('#catalogueFlatView')?.innerText.includes(`“${q}”`), query, { timeout: 15000 });
  // People, parties and sources arrive a moment later than the elections.
  await page.waitForFunction(() => !document.querySelector('[data-cn-extras] .cn-summary'), null, { timeout: 15000 }).catch(() => {});
}

async function openElectionFromSearch(page, query) {
  await search(page, query);
  await page.locator('.cn-summary--elections button').click();
  await page.locator('[data-cn-election-toggle]').first().click();
  await page.waitForFunction(() => window.__civgraphTest2.app.elections?.activeBundle, null, { timeout: 60000 });
}

test.describe('map search finds elections by the names of their bodies', () => {
  test('Westminster 2019 and NI local 2023 find their election, and say so on the Maps tab', async ({ page }) => {
    await boot(page);
    for (const [query, title] of [
      ['Westminster 2019', '2019 UK general election in Northern Ireland'],
      ['NI local 2023', '2023 Northern Ireland local elections'],
      ['Belfast City Council 2023', '2023 Northern Ireland local elections'],
    ]) {
      await search(page, query);
      await expect(page.locator('.cn-summary--elections button')).toContainText('1 election');
      await page.locator('.cn-summary--elections button').click();
      await expect(page.locator('.cn-erow__title')).toHaveText([title]);
      await page.locator('[data-cn-tab="boundaries"]').first().click();
    }
  });

  test('Dáil 2020 lists the election before any party, and general election 2020 lists no parties', async ({ page }) => {
    await boot(page);
    await search(page, 'Dáil 2020');
    await page.locator('.cn-summary--elections button').click();
    const order = await page.evaluate(() => {
      const results = document.querySelector('#catalogueFlatView');
      const election = results.querySelector('.cn-erow');
      const extras = results.querySelector('[data-cn-extras]');
      return { election: Boolean(election), electionFirst: Boolean(election && extras && (election.compareDocumentPosition(extras) & Node.DOCUMENT_POSITION_FOLLOWING)) };
    });
    expect(order).toEqual({ election: true, electionFirst: true });
    await expect(page.locator('.cn-erow__title').first()).toHaveText('2020 Irish general election');

    await search(page, 'general election 2020');
    // Every non-year word must match a party's own words: no party is called "general election".
    await expect(page.locator('#cn-people-h')).toHaveCount(0);
  });
});

test.describe('failures are visible, revert the button and offer Retry', () => {
  test('a layer whose data cannot be fetched goes back to Add, says so, and Retry loads it', async ({ page }) => {
    await boot(page);
    await page.route('**/*.pmtiles*', (route) => route.abort('internetdisconnected'));
    await page.locator('[data-cn-shelf]').first().click().catch(() => {});
    const add = page.locator('.cn-add[aria-pressed="false"]:not([data-cn-election-toggle]):visible').first();
    await add.click();
    const notice = page.locator('#test2Status');
    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText('could not be loaded');
    await expect(notice.locator('.map-error__retry')).toBeVisible();
    expect(await page.evaluate(() => window.__civgraphTest2.app.getLoadedLayerIds())).toEqual([]);
    await expect(page.locator('.cn-add[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('#announcer')).toContainText('could not be loaded');

    await page.unroute('**/*.pmtiles*');
    await notice.locator('.map-error__retry').click();
    await page.waitForFunction(() => window.__civgraphTest2.app.getLoadedLayerIds().length === 1, null, { timeout: 60000 });
    await expect(page.locator('#announcer')).toContainText('loaded');
    await expect(notice).toBeHidden();
  });

  test('a link to a layer or election that does not exist says what was left out', async ({ page }) => {
    await boot(page, '#layers=does-not-exist-layer,election-no-such-body-2020-01-01');
    const notice = page.locator('#test2Status');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('does-not-exist-layer');
    await expect(notice).toContainText('election-no-such-body-2020-01-01');
    await notice.locator('.map-error__close').click();
    await expect(notice).toBeHidden();
  });

  test('an election whose results cannot be fetched says so, with Retry, and leaves no loading panel', async ({ page }) => {
    await boot(page);
    await page.route('**/_api/elections**', (route) => route.fulfill({ status: 503, body: 'down' }));
    // The static bundles the app falls back to (the election list itself is elections-test2.json).
    await page.route('**/render/metadata/elections-test2/**', (route) => route.abort('failed'));
    await search(page, 'Westminster 2019');
    await page.locator('.cn-summary--elections button').click();
    await page.locator('[data-cn-election-toggle]').first().click();
    const notice = page.locator('#test2Status');
    await expect(notice).toContainText('could not be loaded', { timeout: 30000 });
    await expect(notice.locator('.map-error__retry')).toBeVisible();
    await expect(page.locator('#electionResultsPane.election-results-pane--open')).toHaveCount(0);
    await expect(page.locator('[data-cn-election-toggle][aria-pressed="true"]')).toHaveCount(0);
  });
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('one catalogue toggle; a first-visit hint, once; Open shows the map, the header button goes back', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#mobileToggle')).toBeHidden();
    await expect(page.locator('#mobilePaneToggle')).toBeVisible();
    const peek = page.locator('#mobileCataloguePeek');
    await expect(peek).toContainText('Choose a map or an election');
    await peek.locator('.mobile-catalogue-peek__open').click();
    expect(await page.evaluate(() => window.uiController.currentStateId)).toBe('info-full');
    expect(await page.evaluate(() => localStorage.getItem('civgraph.mapHintSeen'))).toBe('1');
    await page.locator('.catalogue-intro__close').click({ timeout: 3000 }).catch(() => {});

    await openElectionFromSearch(page, 'Westminster 2019');
    await expect.poll(() => page.evaluate(() => window.uiController.currentStateId)).toBe('map-full');
    // No "<map> is on the map" note (owner, 1 Nov 2026); the header button goes back.
    await expect(peek).toBeHidden();
    await page.locator('#mobilePaneToggle').click();
    await expect.poll(() => page.evaluate(() => window.uiController.currentStateId)).toBe('info-full');

    await page.reload();
    await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
    await page.evaluate(() => window.__civgraphTest2.restorePromise);
    await page.evaluate(() => window.uiController.setSplitState('map-full'));
    await expect(page.locator('#mobileCataloguePeek')).toBeHidden();
  });
});

test.describe('keyboard and screen readers', () => {
  test('settings and active layers take focus in and give it back', async ({ page }) => {
    await boot(page);
    for (const [toggle, panel] of [['#mapControlsToggle', '#mapControlPanel'], ['#activeLayersToggle', '#activeLayers']]) {
      await page.locator(toggle).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate((p) => Boolean(document.activeElement?.closest(p)), panel)).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => page.evaluate(() => `#${document.activeElement?.id}`)).toBe(toggle);
    }
  });

  test('the catalogue split handle is focusable and resizes with the arrow keys', async ({ page }) => {
    await boot(page);
    const handle = page.locator('#splitDrag');
    await handle.focus();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('splitDrag');
    await expect(handle).toHaveAttribute('aria-valuemin', '20');
    await expect(handle).toHaveAttribute('aria-valuemax', '75');
    const before = Number(await handle.getAttribute('aria-valuenow'));
    const width = () => page.evaluate(() => document.querySelector('.pane--info').getBoundingClientRect().width);
    const w0 = await width();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(width).toBeGreaterThan(w0 + 50);
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await page.keyboard.press('Enter');
  });

  test('an open election: resizer values, a labelled seat overlay, a loaded announcement and a legend that names FF and SF', async ({ page }) => {
    await boot(page);
    await openElectionFromSearch(page, 'Dáil 2020');
    await expect(page.locator('#announcer')).toHaveText('2020 Irish general election loaded');
    const resizer = page.locator('[data-election-pane-resize]');
    for (const attr of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) await expect(resizer).toHaveAttribute(attr, /^\d+$/);
    await expect(page.locator('#test2-election-seat-overlay')).toHaveAttribute('role', 'group');
    const legend = page.locator('#test2MapLegend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Fianna Fáil (FF)');
    await expect(legend).toContainText('Sinn Féin (SF)');
    await expect(legend).toContainText('One dot per seat');
  });
});

test.describe('browser history and the timeline', () => {
  test('Back closes the election just opened and stays in the app; History lists the steps', async ({ page }) => {
    await boot(page);
    await openElectionFromSearch(page, 'Westminster 2019');
    await page.waitForFunction(() => /electionBody=/.test(location.hash));
    await page.locator('#catalogueHistory').click();
    await expect(page.locator('#catalogueHistoryPopup')).toContainText('Opened 2019 UK general election in Northern Ireland');
    await page.keyboard.press('Escape');
    await page.goBack();
    await expect.poll(() => page.evaluate(() => Boolean(window.__civgraphTest2.app.elections?.activeEntry))).toBe(false);
    expect(new URL(page.url()).pathname).toBe('/maps/');
    await page.goForward();
    await expect.poll(() => page.evaluate(() => window.__civgraphTest2.app.elections?.activeEntry?.date), { timeout: 60000 }).toBe('2019-12-12');
  });

  test('each timeline year label stands at a stop of that year, and they do not overlap', async ({ page }) => {
    await boot(page);
    await openElectionFromSearch(page, 'Westminster 2019');
    await page.waitForFunction(() => document.querySelectorAll('.timeline-year').length > 2);
    const check = await page.evaluate(() => {
      const app = window.__civgraphTest2.app;
      const items = app.getTimelineAnimationItems();
      const count = items.length;
      const shown = [...document.querySelectorAll('.timeline-year')].filter((label) => label.dataset.hidden !== 'true');
      const wrong = shown.filter((label) => {
        const index = Math.round(Number(label.style.getPropertyValue('--p')) * (count - 1));
        return String(app.timelineItemYear(items[index])) !== label.textContent;
      }).map((label) => label.textContent);
      const boxes = shown.map((label) => label.getBoundingClientRect()).sort((a, b) => a.left - b.left);
      const overlaps = boxes.some((box, i) => i > 0 && box.left < boxes[i - 1].right);
      return { shown: shown.length, wrong, overlaps };
    });
    expect(check.wrong).toEqual([]);
    expect(check.overlaps).toBe(false);
    expect(check.shown).toBeGreaterThanOrEqual(6);
  });
});

test.describe('row menus', () => {
  // A row's menu closed on any scroll. The pane also scrolls by itself, when what a search found
  // besides maps arrives above the rows and the browser keeps the rows where they were; that
  // closed the Download menu a reader had just opened (map-svg-export, flaky under load). The
  // menu now follows its button while the button is on screen, and closes once it is not.
  test('a row menu stays with its button when the pane scrolls, and closes when the button goes', async ({ page }) => {
    await boot(page);
    const shelf = page.locator('#catalogueFlatView .cn-shelf__toggle').first();
    if (await shelf.getAttribute('aria-expanded') !== 'true') await shelf.click();
    const button = page.locator('#catalogueFlatView .cn-shelf__body:not([hidden]) [data-cn-menu]').nth(2);
    await button.click();
    const menu = page.locator('.cn-menu');
    await expect(menu).toBeVisible();
    const gap = () => page.evaluate(() => {
      const anchor = document.querySelector('[data-cn-menu][aria-expanded="true"]');
      const m = document.querySelector('.cn-menu');
      if (!anchor || !m) return null;
      const a = anchor.getBoundingClientRect();
      const r = m.getBoundingClientRect();
      return Math.min(Math.abs(r.top - a.bottom), Math.abs(a.top - r.bottom));
    });
    expect(await gap()).toBeLessThanOrEqual(6);
    // The menu listens for scrolls from the next task on (menu.js openMenu).
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // Content arrives above the rows and the pane scrolls 40px, as scroll anchoring does.
    const scrolled = await page.evaluate(() => {
      const catalogue = window.uiController._catalogueNext;
      const scroller = catalogue.scroller || catalogue.findScroller();
      const before = scroller.scrollTop;
      scroller.scrollTop += 40;
      return scroller.scrollTop - before;
    });
    expect(scrolled).toBeGreaterThan(0);
    await expect(menu).toBeVisible();
    await expect.poll(gap).toBeLessThanOrEqual(6);
    // Scrolled until the button is off screen: the menu goes.
    await page.evaluate(() => {
      const catalogue = window.uiController._catalogueNext;
      const scroller = catalogue.scroller || catalogue.findScroller();
      // Room to scroll the button away whatever is open (only the first shelf is).
      const room = document.createElement('div');
      room.style.height = '3000px';
      scroller.appendChild(room);
      scroller.scrollTop += 2000;
    });
    await expect(menu).toHaveCount(0);
  });
});
