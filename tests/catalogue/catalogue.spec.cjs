// The rebuilt catalogue in the browser, against the local test site (tools/test-site/), which
// switches it on. C01-C23 are the capability checklist (CAPABILITIES.md): every capability of the
// current pane, kept or deliberately replaced. N01-N07 cover what is new.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogue/catalogue.json'), 'utf8'));
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/database/books.json'), 'utf8')).books || [];
const LGD = 'local-government-local-government-districts';
const lgd = catalogue.series.find((s) => s.id === LGD);
const LGD_NEWEST = lgd.members[0].id;

const ofKind = (kind) => catalogue.series.filter((s) => s.kind === kind);
const SECTION_TABS = [['boundaries', 'Boundary', 'Boundaries'], ['places', 'Places', 'Places & routes'], ['statistics', 'Statistics', 'Statistics'], ['historic', 'Historic', 'Historic Maps']];
const mapsOf = (kind) => ofKind(kind).reduce((n, s) => n + s.members.length + (s.local?.length || 0), 0);
const pane = (page) => page.locator('#catalogueFlatView [data-cn-root]');
const row = (page, id) => pane(page).locator(`[data-cn-series="${id}"]`);
const menuItem = (page, text) => page.locator('.cn-menu [role="menuitem"]', { hasText: text });
const route = (page) => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('cat'));
const loaded = (page) => page.evaluate(() => window.__civgraphTest2.app.getLoadedLayerIds());

// Shelves start closed; most tests work inside them, so they start with every shelf open
// (as a reader who had opened them this session) unless a test asks for the default.
const ELECTION_SHELVES = ['dail', 'westminster', 'ni-devolved', 'ni-local', 'irish-local', 'european', 'referendum', 'presidential'];
const SHELF_IDS = [...catalogue.shelves.map((s) => s.id), 'environment', ...ELECTION_SHELVES.map((g) => `e-${g}`)];
const generals = catalogue.elections.filter((e) => e.kind !== 'by-election');
async function open(page, hash = '', { shelves = 'open' } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (shelves === 'open') {
    await page.addInitScript((ids) => {
      const KEY = 'civgraph.catalogueNext.v2';
      if (!sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, JSON.stringify({ opened: ids }));
    }, SHELF_IDS);
  }
  await page.goto(`/maps/${hash ? `#${hash}` : ''}`);
  await expect(pane(page).locator('[data-cn-results]')).toBeVisible({ timeout: 45000 });
  await page.waitForFunction(() => window.__civgraphTest2?.app?.mapController?.map?.loaded?.(), null, { timeout: 30000 }).catch(() => {});
  return errors;
}

async function search(page, q) {
  await page.fill('#searchInput', q);
  await expect.poll(() => page.evaluate(() => window.uiController._catalogueNext?.query || '')).toBe(q);
  await page.waitForTimeout(300);
}

/* ------------------------------------------------------------------ the checklist */

test('C01 every series is listed, with thumbnail, years and jurisdiction', async ({ page }) => {
  const errors = await open(page);
  // Each series in the section of what it draws; together the sections hold every one.
  for (const [id, kind] of SECTION_TABS) {
    await pane(page).locator(`[data-cn-tab="${id}"]`).click();
    await expect(pane(page).locator('.cn-row')).toHaveCount(ofKind(kind).length);
  }
  expect(SECTION_TABS.reduce((n, [, kind]) => n + ofKind(kind).length, 0)).toBe(catalogue.series.length);
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  await expect(row(page, LGD).locator('.catalogue-flat__toc-thumbwrap')).toHaveCount(1);
  await expect(row(page, LGD).locator('.cn-row__meta')).toContainText('NI');
  await expect(row(page, LGD).locator('.cn-row__meta')).toContainText('1972–2022');
  expect(errors).toEqual([]);
});

test('C02 one click adds a map from the list, and a second removes it', async ({ page }) => {
  await open(page);
  const chip = row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`);
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await expect.poll(() => loaded(page)).toContain(LGD_NEWEST);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.click();
  await expect.poll(() => loaded(page)).not.toContain(LGD_NEWEST);
  const single = pane(page).locator('.cn-row__end .cn-add[data-cn-toggle]').first();
  const id = await single.getAttribute('data-cn-toggle');
  await single.click();
  await expect.poll(() => loaded(page)).toContain(id);
  await expect(single).toHaveAttribute('aria-pressed', 'true');
});

test('C03 a loaded map can be hidden and shown from its row', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`).click();
  await expect.poll(() => loaded(page)).toContain(LGD_NEWEST);
  await row(page, LGD).locator('[data-cn-menu]').click();
  await menuItem(page, 'Hide').click();
  await expect.poll(() => page.evaluate((id) => window.uiController.onCheckMapVisible(id), LGD_NEWEST)).toBe(false);
  await row(page, LGD).locator('[data-cn-menu]').click();
  await menuItem(page, 'Show').click();
  await expect.poll(() => page.evaluate((id) => window.uiController.onCheckMapVisible(id), LGD_NEWEST)).toBe(true);
});

test('C04 a map\'s shareable link can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await row(page, LGD).locator('[data-cn-menu]').click();
  await menuItem(page, 'Copy link').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`layers=${LGD_NEWEST}`);
});

test('C05 C06 FlatGeobuf, the provider\'s files and the original GeoJSON are offered for download', async ({ page }) => {
  await open(page);
  const found = await page.evaluate(() => {
    const ui = window.uiController;
    const n = ui._catalogueNext;
    for (const s of n.data.series) {
      const t = n.menuTarget(s);
      const full = n.full(t.id);
      const src = full ? ui.getSourceDownloads(full) : [];
      if (src.length >= 2) return { series: s.id, labels: src.slice(0, 3).map((d) => d.label) };
    }
    return null;
  });
  expect(found).not.toBeNull();
  const r = row(page, found.series);
  await r.scrollIntoViewIfNeeded();
  await r.locator('[data-cn-menu]').click();
  for (const label of found.labels) await expect(menuItem(page, label).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await row(page, LGD).locator('[data-cn-menu]').click();
  await expect(menuItem(page, 'FlatGeobuf')).toBeVisible();
});

test('C07 other versions of an edition and a map\'s parts are reachable', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await row(page, LGD).locator('.cn-tick[aria-label="1993"]').click();
  const versions = row(page, LGD).locator('.cn-sub', { hasText: 'Versions' });
  await expect(versions).toContainText('OSNI 1:50,000');
  // Each version has its own Add, Details and Download.
  await expect(versions.locator('[data-cn-act="details"]')).toHaveCount(await versions.locator('.cn-vlist__item').count());
  const town = row(page, 'townlands-townlands');
  await town.scrollIntoViewIfNeeded();
  await town.locator('[data-cn-expand]').click();
  await expect(town.locator('.cn-sub', { hasText: 'Parts' })).toContainText('Republic of Ireland');
  await expect(town.locator('.cn-sub', { hasText: 'By county' })).toContainText('Antrim');
});

test('N12 Townlands is one all-island map, like Civil Parishes; its parts and county maps wait in the opened row', async ({ page }) => {
  await open(page);
  const town = row(page, 'townlands-townlands');
  await expect(town.locator('.cn-row__end [data-cn-toggle="all-ireland-townlands"]')).toHaveCount(1);
  await expect(town.locator('.cn-chips [data-cn-toggle]')).toHaveCount(0);
  await expect(pane(page).locator('[data-cn-toggle="ni-townlands-1844"]')).toHaveCount(0);
  await town.locator('[data-cn-expand]').click();
  const panel = town.locator('.cn-panel');
  await expect(panel).toContainText('Northern Ireland');
  await expect(panel).toContainText('Republic of Ireland');
  await expect(panel).toContainText('By county · 32');
  await expect(panel).not.toContainText('1844');
  await panel.locator('[data-cn-more-parts$=":counties"]').click();
  await expect(town.locator('.cn-panel [data-cn-toggle="tyrone-townlands"]')).toHaveCount(1);
  await town.locator('.cn-panel [data-cn-toggle="cork-townlands"]').click();
  await expect.poll(() => loaded(page)).toEqual(expect.arrayContaining([expect.stringContaining('cork-townlands')]));
});

test('N13 council maps (one council\'s copy of a national map) wait in the opened row, beside the county maps', async ({ page }) => {
  await open(page);
  const town = row(page, 'townlands-townlands');
  const local = catalogue.series.find((s) => s.id === 'townlands-townlands').local;
  await expect(pane(page).locator('[data-cn-local]')).toHaveCount(0);
  await expect(town.locator('.cn-row__credit')).toContainText(`${local.length} council maps`);
  await expect(town.locator(`[data-cn-toggle="${local[0].id}"]`)).toHaveCount(0);
  await town.locator('[data-cn-expand]').click();
  const council = town.locator('.cn-sub', { hasText: 'Council maps' });
  for (const m of local) await expect(council.locator(`[data-cn-toggle="${m.id}"]`)).toHaveCount(1);
  await council.locator(`[data-cn-toggle="${local[0].id}"]`).click();
  await expect.poll(() => loaded(page)).toEqual(expect.arrayContaining([expect.stringContaining(local[0].id)]));
  // A row with one national map (Westmeath's municipal districts beside it) lists it too.
  await row(page, 'local-government-municipal-districts').locator('[data-cn-expand]').click();
  await expect(row(page, 'local-government-municipal-districts').locator('.cn-sub', { hasText: 'Council maps' })).toContainText('Westmeath');
  // Every row with several maps credits all their providers.
  await expect(row(page, 'counties-counties').locator('.cn-row__credit')).toContainText('Phelim Birch');
});

test('C08 a map\'s details page opens', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await row(page, LGD).locator('[data-cn-act="details"]').click();
  await expect(page.locator('#catalogueDetailView')).toBeVisible();
  await expect(page.locator('#catalogueDetailView')).toContainText('2022');
});

test('C09 provider and feature count are shown', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  // The opened row leaves out the title, authors and geometry (user, 2026-10-05).
  await expect(row(page, LGD).locator('.cn-facts')).not.toContainText('Local Government Boundary Commission');
  await expect(row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`)).toHaveAttribute('title', /Local Government Boundary Commission/);
  await expect(row(page, 'census-census-grid').locator('.cn-row__credit')).toContainText(/\d,\d{3} /);
});

test('C10 each map shows the colour it is drawn in', async ({ page }) => {
  await open(page);
  const colour = catalogue.maps[LGD_NEWEST].color;
  expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  await expect(row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`)).toHaveAttribute('style', new RegExp(`--c:${colour}`));
});

test('C11 thumbnails preview on hover', async ({ page }) => {
  await open(page);
  await row(page, LGD).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await row(page, LGD).locator('.catalogue-flat__toc-thumbwrap').hover();
  await expect(page.locator('.catalogue-flat__toc-thumbzoom--visible')).toHaveCount(1);
});

test('C12 each series shows its maps still to be added on request', async ({ page }) => {
  await open(page);
  const ded = catalogue.series.find((s) => s.id === 'electoral-divisions-district-electoral-divisions');
  const toggles = pane(page).locator('[data-cn-todo]');
  await expect(toggles).toHaveCount(ofKind('Boundary').filter((s) => s.todo?.length).length);
  const r = row(page, ded.id);
  await expect(r.locator('.cn-chip--todo')).toHaveCount(0);
  await r.locator('[data-cn-todo]').click();
  await expect(r.locator('.cn-chip--todo')).toHaveCount(ded.todo.length);
  await expect(r.locator('[data-cn-todo]')).toHaveText(`Hide ${ded.todo.length} to be added`);
  await r.locator('[data-cn-todo]').click();
  await expect(r.locator('.cn-chip--todo')).toHaveCount(0);
  await expect(pane(page).locator('[data-cn-filter="toAdd"]')).toHaveCount(0);
});

test('C13 the contents panel jumps to any shelf or subject', async ({ page }) => {
  await open(page, 'cat=places');
  const btn = page.locator('#catalogueContents');
  await expect(btn).toBeVisible();
  await btn.click();
  const drawer = page.locator('.cn-drawer');
  await expect(drawer.locator('[role="dialog"]')).toBeVisible();
  await expect(drawer.locator('.cn-toc__link', { hasText: 'Water' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await btn.click();
  await page.locator('.cn-drawer__scrim').click({ position: { x: 10, y: 300 } });
  await expect(page.locator('.cn-drawer')).toHaveCount(0);
  await btn.click();
  await page.locator('.cn-drawer .cn-toc__link[data-cn-goto-section="cn-shelf-water"]').click();
  await expect(page.locator('.cn-drawer')).toHaveCount(0);
  await expect.poll(async () => {
    const [tabs, shelf] = await Promise.all([pane(page).locator('.cn-tabs').boundingBox(), pane(page).locator('#cn-shelf-water').boundingBox()]);
    return Math.abs(shelf.y - (tabs.y + tabs.height)) < 90;
  }).toBe(true);
  await expect(pane(page).locator('.cn-jump')).toHaveCount(0);
});

test('C14 elections on a shelf per body, with thumbnails, open in one click and link to their results', async ({ page }) => {
  await open(page, 'cat=elections');
  const first = pane(page).locator('.cn-erow').first();
  await expect(first.locator('.catalogue-flat__toc-thumbwrap')).toHaveCount(1);
  await expect.poll(() => first.locator('img.catalogue-flat__toc-thumb').evaluate((img) => img.naturalWidth > 1)).toBe(true);
  await expect(first.locator('a.cn-iconbtn')).toHaveAttribute('href', /^\/browse\/#\/elections\/[a-z0-9-]+$/);
  await expect(pane(page).locator('.cn-shelf__name').first()).toHaveText('Dáil');
  await first.locator('[data-cn-election-toggle]').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__civgraphTest2.app.elections?.activeEntry)), { timeout: 30000 }).toBe(true);
  await expect(first.locator('[data-cn-election-toggle]')).toHaveAttribute('aria-pressed', 'true');
});

test('C15 by-elections are one filter away', async ({ page }) => {
  await open(page, 'cat=elections');
  await pane(page).locator('[data-cn-filter="ekind"][data-value="by-election"]').click();
  const expected = catalogue.elections.filter((e) => e.kind === 'by-election').length;
  await expect(pane(page).locator('.cn-erow')).toHaveCount(expected);
  await expect(pane(page).locator('.cn-erow').first()).toContainText('By-election');
});

test('C16 books keep their covers, View, Markdown and Archive.org, readable in both themes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch { /* private */ } });
  await open(page, 'cat=books');
  const contrast = await pane(page).locator('.book-card [data-book-format="markdown"]').first().evaluate((btn) => {
    const rgb = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let el = btn; let bg = 'rgba(0, 0, 0, 0)';
    while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    const a = lum(rgb(getComputedStyle(btn).color)); const b = lum(rgb(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThan(4.5);
  await expect(pane(page).locator('.book-card')).toHaveCount(books.length);
  const card = pane(page).locator('.book-card').filter({ has: page.locator('a', { hasText: 'Archive.org' }) }).first();
  await expect(card.locator('img').first()).toBeAttached();
  await pane(page).locator('.book-card [data-book-format="markdown"]').first().click();
  await expect(page.locator('#catalogueFlatView [data-cn-root]')).toHaveCount(0);
  await expect(page.locator('#catalogueFlatView')).not.toContainText('Failed to load', { timeout: 15000 });
});

test('C17 search finds places, each with its own buttons', async ({ page }) => {
  await open(page);
  await search(page, 'dungannon');
  await expect(pane(page).locator('.cn-place').first()).toBeVisible({ timeout: 20000 });
  await pane(page).locator('.cn-place summary').first().click();
  const strip = pane(page).locator('.cn-place__item .catalogue-search__action-strip[data-search-kind="feature"]').first();
  await expect(strip.locator('[data-catalogue-search-action="toggle-feature-load"]')).toBeVisible();
  await expect(strip.locator('[data-catalogue-search-action="copy-feature-url"]')).toBeAttached();
  await expect(strip.locator('[data-catalogue-search-action="download-feature"]')).toBeAttached();
  await expect(pane(page).locator('.cn-place__thumb img, .cn-place__thumb svg').first()).toBeAttached();
});

test('C18 search finds maps (despite typos, by year) and elections (by constituency)', async ({ page }) => {
  await open(page);
  await search(page, 'townlnds');
  await expect(row(page, 'townlands-townlands')).toBeVisible();
  await search(page, 'wards 1993');
  await expect(pane(page).locator('.cn-chip--hit').first()).toContainText('1993');
  await search(page, 'dungannon');
  await expect(pane(page).locator('.cn-tabs [data-cn-tab="elections"] .cn-tab__count')).not.toHaveText('0');
  await pane(page).locator('.cn-tabs [data-cn-tab="elections"]').click();
  await expect(pane(page).locator('.cn-erow').first()).toContainText(/Dungannon/);
});

test('C19 search finds parties', async ({ page }) => {
  await open(page);
  await search(page, 'sinn fein');
  await expect(pane(page).locator('#cn-people-h')).toContainText('Parties', { timeout: 20000 });
  const parties = pane(page).locator('section[aria-labelledby="cn-people-h"]');
  await expect(parties.locator('.cn-person__name').first()).toHaveAttribute('href', /\/browse\/parties\//);
});

test('C20 Books and Tables leave the pane: both are in Browse (Phelim Birch, 2026-10-08)', async ({ page }) => {
  await open(page);
  await expect(pane(page).locator('[data-cn-act="tables"]')).toHaveCount(0);
  await expect(pane(page).locator('[data-cn-tab="books"]')).toHaveCount(0);
});

test('C21 an old card link lands on its series, opened', async ({ page }) => {
  await open(page, 'flat-card-flat-lgds');
  await expect(row(page, LGD).locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => route(page)).toBe(`series/${LGD}`);
});

test('C22 the History, Back and Home controls are still there', async ({ page }) => {
  await open(page);
  await expect(page.locator('#catalogueHistory')).toBeAttached();
  await expect(page.locator('#catalogueHome')).toBeAttached();
});

test('C23 the sections are what a map draws, then Elections; Boundaries first', async ({ page }) => {
  await open(page);
  const tabs = pane(page).locator('.catalogue-flat__sections .catalogue-flat__section-tab');
  await expect(tabs).toHaveCount(5);
  await expect(tabs).toContainText(['Boundaries', 'Places & routes', 'Statistics', 'Historic Maps', 'Elections']);
  await expect(tabs.first()).toHaveAttribute('aria-current', 'true');
  // Each section counts its maps, not its rows (Phelim Birch, 2026-10-10).
  for (const [id, kind] of SECTION_TABS) await expect(pane(page).locator(`[data-cn-tab="${id}"] .cn-tab__count`)).toHaveText(mapsOf(kind).toLocaleString('en-GB'));
  // Among the boundaries, People & Places is called Census & Statistical Areas.
  await expect(pane(page).locator('#cn-shelf-people-and-places .cn-shelf__name')).toHaveText('Census & Statistical Areas');
  // Government & Administration and Elections & Representation split into Current and Former;
  // every other shelf lists its series without subject headings.
  await expect(pane(page).locator('#cn-shelf-government-and-administration .cn-subject__head')).toContainText(['Current', 'Former']);
  await expect(pane(page).locator('#cn-shelf-land-divisions .cn-subject__head')).toHaveCount(0);
});

/* ------------------------------------------------------------------ new */

test('N01 filters narrow the list in place: where, kind, years', async ({ page }) => {
  await open(page);
  const all = await pane(page).locator('.cn-row').count();
  await pane(page).locator('[data-cn-filter="scope"][data-value="Northern Ireland"]').click();
  const ni = await pane(page).locator('.cn-row').count();
  expect(ni).toBeLessThan(all);
  for (const meta of (await pane(page).locator('.cn-row__meta').allTextContents()).slice(0, 25)) expect(meta).toContain('NI');
  await pane(page).locator('[data-cn-filter="scope"][data-value=""]').click();
  await expect(pane(page).locator('[data-cn-filter="scope"]')).toHaveText(['All', 'NI', 'ROI', 'All-island']);
  // The kind is the section now, not a filter.
  await expect(pane(page).locator('[data-cn-filter="kind"]')).toHaveCount(0);
  await pane(page).locator('[data-cn-tab="places"]').click();
  await expect(pane(page).locator('.cn-row')).toHaveCount(ofKind('Places').length);
  await expect.poll(() => route(page)).toBe('places');
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  await expect(pane(page).locator('.cn-row')).toHaveCount(all);
  const from = pane(page).locator('[data-cn-range="from"][data-key="maps"]');
  await from.focus();
  await page.keyboard.press('End');
  await expect(pane(page).locator('[data-cn-years-out]')).toContainText('2020');
  await expect.poll(() => pane(page).locator('.cn-row').count()).toBeLessThan(all);
  // With years chosen, maps with no date leave unless the reader includes them.
  await expect(row(page, 'civil-parishes-civil-parishes')).toHaveCount(0);
  await pane(page).locator('[data-cn-undated]').check();
  await expect(row(page, 'civil-parishes-civil-parishes')).toHaveCount(1);
  await expect(row(page, 'civil-parishes-baronies')).toHaveCount(1);
  await pane(page).locator('[data-cn-undated]').uncheck();
  await pane(page).locator('[data-cn-act="years-reset"]').click();
  await expect(pane(page).locator('.cn-row')).toHaveCount(all);
});

test('N14 with years chosen, the maps in those years lead their row', async ({ page }) => {
  await open(page);
  const to = pane(page).locator('[data-cn-year="to"][data-key="maps"]');
  await to.fill('1930');
  await to.press('Enter');
  await to.blur();
  const chips = row(page, 'counties-counties').locator('.cn-chips [data-cn-toggle]');
  await expect(chips.first()).toHaveText('1927');
  await expect(chips.nth(1)).toHaveText('1922');
});

test('N15 the 1911 County Electoral Divisions (Paddy Matthews) are listed and draw', async ({ page }) => {
  await open(page);
  const r = row(page, 'electoral-divisions-county-electoral-divisions--ireland');
  await expect(r.locator('.cn-row__credit')).toContainText('Paddy Matthews');
  await r.locator('[data-cn-toggle="county-ed-1911"]').click();
  await expect.poll(() => loaded(page)).toEqual(expect.arrayContaining([expect.stringContaining('county-ed-1911')]));
});

test('N16 "+N more" can be undone with "Show fewer"', async ({ page }) => {
  await open(page);
  const r = row(page, 'local-government-local-authorities');
  const chips = r.locator('.cn-chips [data-cn-toggle]');
  const short = await chips.count();
  await r.locator('[data-cn-more]').click();
  await expect.poll(() => chips.count()).toBeGreaterThan(short);
  await r.locator('[data-cn-fewer]').click();
  await expect(chips).toHaveCount(short);
  await expect(r.locator('[data-cn-more]')).toHaveCount(1);
});

test('N17 council maps follow their edition; hovers name the unit; parts download; compare keeps the place', async ({ page }) => {
  await open(page);
  // Hover text: date · providers · count in the map's own unit.
  await expect(row(page, 'counties-counties').locator('.cn-chips [data-cn-toggle]').first()).toHaveAttribute('title', /· 32 Counties$/);
  // The 2019 ED council maps show with the 2019 edition only.
  const ed = row(page, 'electoral-divisions-electoral-divisions');
  await ed.locator('[data-cn-expand]').click();
  await ed.locator('.cn-tick[aria-label="2019"]').click();
  await expect(ed.locator('.cn-sub', { hasText: 'Council maps' })).toContainText('Fingal (2019)');
  await ed.locator('.cn-tick[aria-label="1997"]').click();
  await expect(ed.locator('.cn-sub', { hasText: 'Council maps' })).toHaveCount(0);
  // Parts have their own download.
  const town = row(page, 'townlands-townlands');
  await town.locator('[data-cn-expand]').click();
  await expect(town.locator('.cn-sub', { hasText: 'Parts' }).locator('[data-cn-act="downloads"]').first()).toBeVisible();
  await expect(town.locator('.cn-sub', { hasText: 'Parts' })).toContainText('Cork, Dublin and Galway cities and islands');
  // Starting a comparison leaves the list where it was.
  const scroller = await page.evaluate(() => { const el = document.querySelector('#catalogueFlatView [data-cn-root]').closest('.pane__content, .catalogue-flat, .pane') ; return !!el; });
  expect(scroller).toBe(true);
  const before = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => e.scrollTop));
  await page.evaluate(() => window.uiController._catalogueNext.startCompare('counties-ireland-1955', 'counties-ireland-1957'));
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)).map((e) => e.scrollTop));
  expect(after).toEqual(before);
});

test('N18 shelves start closed; a link to a set opens its section, shelf and row', async ({ page }) => {
  await open(page, '', { shelves: 'closed' });
  const toggles = pane(page).locator('[data-cn-shelf]');
  expect(await toggles.count()).toBeGreaterThan(3);
  for (const v of await toggles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')))) expect(v).toBe('false');
  // Boundaries gathers its environment rows on one shelf; the key explains the chip dots.
  await expect(pane(page).locator('.cn-shelf__name', { hasText: /^Environment$/ })).toHaveCount(1);
  await expect(pane(page).locator('.cn-key')).toContainText('Incomplete');
  // Historic Maps lists its rows straight, as Statistics does.
  await pane(page).locator('[data-cn-tab="historic"]').click();
  await expect(pane(page).locator('.cn-shelf__head, .cn-subject__head')).toHaveCount(0);
  await expect(pane(page).locator('.cn-row').first()).toBeVisible();
  // From there, a link to Provinces goes to Boundaries with its shelf and row open.
  await page.evaluate(() => { location.hash = 'cat=series/counties-provinces'; });
  await expect(pane(page).locator('[data-cn-tab="boundaries"]')).toHaveAttribute('aria-current', 'true');
  await expect(row(page, 'counties-provinces').locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'counties-provinces')).toBeVisible();
  await expect(row(page, 'counties-provinces')).toBeInViewport();
});

test('N19 a link that opens one map (Browse) opens its row at that map', async ({ page }) => {
  await open(page, 'layers=eds-1983', { shelves: 'closed' });
  const ed = row(page, 'electoral-divisions-electoral-divisions');
  await expect(ed.locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect(ed).toBeVisible();
  await expect(ed.locator('.cn-tick[aria-label="1983"]')).toHaveAttribute('aria-pressed', 'true');
});

test('N20 placeholders, transport order, constituency hovers and dates', async ({ page }) => {
  await open(page);
  // Every Statistics row whose maps are all still to come says so.
  await pane(page).locator('[data-cn-tab="statistics"]').click();
  const stats = ofKind('Statistics').filter((s) => s.members.every((m) => catalogue.maps[m.id].status === 'placeholder'));
  expect(stats.length).toBeGreaterThan(0);
  for (const s of stats.slice(0, 5)) await expect(row(page, s.id).locator('.cn-badge--todo')).toHaveCount(1);
  // Transport: routes and networks first, collisions and road defects last.
  await pane(page).locator('[data-cn-tab="places"]').click();
  const names = await pane(page).locator('#cn-shelf-transport .cn-row__name').allTextContents();
  expect(names[0]).toBe('Road Network');
  expect(names.slice(-4)).toEqual(['PSNI Road Traffic Collisions', 'TII Collision Rates', 'Pothole Enquiries', 'NI Road Surface Defects']);
  // A constituency map's hover gives no election-day date; its label keeps the year.
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  const wm = row(page, 'constituencies-parliamentary-constituencies').locator('.cn-chips [data-cn-toggle="pc-2023"]');
  await expect(wm).toHaveText(/2024/);
  expect(await wm.getAttribute('title')).not.toMatch(/July/);
  // Exact dates; Fingal's polling stations count in both their years; Gaeltacht's generalised map is a version.
  expect(catalogue.maps['dublin-electoral-counties-1985'].date).toBe('1985-04-03');
  expect(catalogue.maps['eds-1986'].date).toBe('1986-04-12');
  expect(catalogue.maps['fingal-polling-station-data'].years).toEqual([2011, 2016]);
  const g = catalogue.series.find((s) => s.id === 'language-and-gaeltacht-gaeltacht-areas');
  expect(g.members.find((m) => m.id === 'tailte-gaeltacht-boundaries-generalised-20m').of).toBe('roi-gaeltacht-areas');
  // Every main map with other versions says how it differs: none is "<row> (main)".
  for (const s of catalogue.series) for (const m of s.members) if (s.members.some((v) => v.of === m.id)) expect(m.version, `${s.id} ${m.id}`).toBeTruthy();
  // Pre-partition Westminster maps are one all-island map each, with no parts.
  expect(catalogue.maps['pc-1885-ireland'].parts).toBeUndefined();
  expect(catalogue.maps['pc-1918-ireland'].parts).toBeUndefined();
  // 2001 Wards keep their place among the census areas, with a note saying why.
  const ward01 = row(page, 'census-super-output-area').locator('.cn-chips [data-cn-toggle="wards-2001"]');
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  const more = row(page, 'census-super-output-area').locator('[data-cn-more]');
  if (await more.count()) await more.click();
  await expect(ward01).toHaveText(/2001 Wards/);
  expect(await ward01.getAttribute('title')).toContain('Same map as Wards 1993');
});

test('N02 every view has an address; Back and Forward move between them', async ({ page }) => {
  await open(page, `cat=series/${LGD}`);
  await expect(row(page, LGD).locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, LGD)).toBeInViewport();
  await pane(page).locator('.cn-tabs [data-cn-tab="elections"]').click();
  await expect.poll(() => route(page)).toBe('elections');
  await page.goBack();
  await expect.poll(() => route(page)).toBe(`series/${LGD}`);
  await expect(row(page, LGD).locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await page.goForward();
  await expect.poll(() => route(page)).toBe('elections');
  await expect(pane(page).locator('.cn-erow').first()).toBeVisible();
});

test('N03 arrow keys move along a row\'s editions', async ({ page }) => {
  await open(page);
  const chips = row(page, LGD).locator('.cn-chips button.cn-chip');
  await chips.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(chips.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(chips.last()).toBeFocused();
});

test('N04 two editions can be compared', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-menu]').click();
  await menuItem(page, '1993').first().click();
  await expect(pane(page).locator('.cn-compare')).toBeVisible({ timeout: 30000 });
  await pane(page).locator('[data-cn-fade]').fill('100');
  await pane(page).locator('[data-cn-act="end-compare"]').click();
  await expect(pane(page).locator('.cn-compare')).toHaveCount(0);
});

test('N05 What\'s here? (button hidden for now) still answers by address', async ({ page }) => {
  await open(page, 'cat=here/-6.66/54.5');
  await expect(pane(page).locator('.cn-here__head h3')).toHaveText("What's here");
  await expect(pane(page).locator('.cn-row').first()).toBeVisible();
  await expect(pane(page).locator('[data-cn-act="pick-here"]')).toHaveCount(0);
  await expect(pane(page).locator('[data-cn-filter="onMap"]')).toHaveCount(0);
});

test('N06 opening a row shows the timeline; choosing a dot changes the edition shown', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await expect(row(page, LGD).locator('.cn-tick')).toHaveCount(lgd.members.filter((m) => !m.of).length);
  await row(page, LGD).locator('.cn-tick[aria-label="1985"]').click();
  await expect(row(page, LGD).locator('.cn-tick[aria-label="1985"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, LGD).locator('.cn-ed__title')).toHaveCount(0);
  await expect.poll(() => route(page)).toMatch(new RegExp(`^series/${LGD}/`));
});

test('N07 the archived classic catalogue (/maps/classic/) is unchanged', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'CIVGRAPH_CATALOGUE', { value: 'classic', writable: false }); });
  await page.goto('/maps/');
  await expect(page.locator('#catalogueFlatView .catalogue-flat__sections')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#catalogueFlatView')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('[data-cn-root]')).toHaveCount(0);
});

test('N08 elections: grouped bodies, and where they were held', async ({ page }) => {
  await open(page, 'cat=elections');
  const devolved = ['northern-ireland-assembly', 'parliament-of-northern-ireland', 'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue'];
  // One shelf per body group, in order; no body filter any more.
  await expect(pane(page).locator('.cn-shelf__name')).toHaveText(['Dáil', 'Westminster', 'NI Devolved', 'NI local', 'Irish local', 'European', 'Referendum', 'Presidential']);
  await expect(pane(page).locator('[data-cn-filter="body"]')).toHaveCount(0);
  await expect(pane(page).locator('#cn-shelf-e-ni-devolved .cn-erow')).toHaveCount(generals.filter((e) => devolved.includes(e.bodySlug)).length);
  const ni = pane(page).locator('[data-cn-filter="escope"][data-value="Northern Ireland"]');
  await ni.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(generals.filter((e) => e.scope === 'Northern Ireland').length);
  await ni.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(generals.length);
  await expect(pane(page).locator('.cn-jump, .cn-hist')).toHaveCount(0);
});

test('N09 rows put their details beside the name; no blurbs, no histogram', async ({ page }) => {
  await open(page);
  const r = row(page, 'counties-counties');
  const [name, meta] = await Promise.all([r.locator('.cn-row__name').boundingBox(), r.locator('.cn-row__meta').boundingBox()]);
  expect(Math.abs(name.y - meta.y)).toBeLessThan(8);
  expect(meta.x).toBeGreaterThan(name.x + name.width - 1);
  await expect(pane(page).locator('.cn-shelf__blurb')).toHaveCount(0);
  await expect(pane(page).locator('.cn-hist')).toHaveCount(0);
});

test('N10 the catalogue takes the width it needs: about 36%, 400-560px; wider for wide things', async ({ page }) => {
  const width = () => page.evaluate(() => Math.round(document.querySelector('.pane--info').getBoundingClientRect().width));
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page);
  await expect.poll(width).toBe(461);
  // Wider for wide things: the Tables pane (now reached from Browse) still takes more room.
  await page.evaluate(() => window.uiController.showTab('tables'));
  await expect.poll(width).toBe(704);
  await page.evaluate(() => window.uiController.showTab('catalogue'));
  await expect.poll(width).toBe(461);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(width).toBe(560);
  const handle = await page.locator('#splitDrag').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 300);
  await page.mouse.down();
  await page.mouse.move(800, handle.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(width).toBeGreaterThan(760);
  await page.reload();
  await expect(pane(page).locator('[data-cn-results]')).toBeVisible({ timeout: 45000 });
  await expect.poll(width).toBeGreaterThan(760);
  await page.dblclick('#splitDrag');
  await expect.poll(width).toBe(560);
});

test('N11 search finds people; their elections show where they stood and whether elected', async ({ page }) => {
  await open(page);
  await search(page, 'sammy wilson');
  const person = pane(page).locator('.cn-person--row').first();
  await expect(person.locator('.cn-person__name')).toHaveText('Sammy Wilson', { timeout: 20000 });
  await expect(person.locator('.cn-person__name')).toHaveAttribute('href', '/browse/#/persons/sammy-wilson-96356');
  await expect(person).toContainText('DUP');
  await person.locator('[data-cn-person]').click();
  await expect.poll(() => route(page)).toBe('elections/person/96356');
  await expect(pane(page).locator('.cn-person-banner')).toContainText('Sammy Wilson');
  const people = JSON.parse(require('node:fs').readFileSync(require('node:path').join(ROOT, 'data/catalogue/people.json'), 'utf8'));
  const row = people.people.find((r) => r[0] === '96356');
  await expect(pane(page).locator('.cn-erow')).toHaveCount(new Set(row[8].map((c) => c[0])).size);
  await expect(pane(page).locator('.cn-erow .cn-person-note').first()).toContainText(/Elected|Not elected/);
  await expect(page.locator('#searchInput')).toHaveValue('');
  await page.reload();
  await expect(pane(page).locator('.cn-person-banner')).toContainText('Sammy Wilson', { timeout: 45000 });
  await pane(page).locator('[data-cn-act="clear-person"]').click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(generals.length);
  await expect.poll(() => route(page)).toBe('elections');
});

test('N21 links to maps without a row: to be added, hidden, and results listed under Elections', async ({ page }) => {
  // A map still to be added opens its row with the maps to come showing.
  await open(page, 'layers=admin-areas-1924-04-01', { shelves: 'closed' });
  const admin = row(page, 'local-government-administrative-areas');
  await expect(admin.locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect(admin.locator('[data-cn-todo]')).toHaveAttribute('aria-pressed', 'true');
  await expect(admin).toBeVisible();
  // A hidden part opens the row of the map it belongs to.
  await page.goto('about:blank'); // links arrive as a fresh page load, as from Browse
  await open(page, 'layers=pc-1884', { shelves: 'closed' });
  await expect.poll(() => route(page)).toBe('series/constituencies-parliamentary-constituencies/pc-1885-ireland');
  await expect(row(page, 'constituencies-parliamentary-constituencies')).toBeVisible();
  // Roscommon's local results files go to the Irish local elections.
  await page.goto('about:blank'); // links arrive as a fresh page load, as from Browse
  await open(page, 'layers=oda-map-00154-local-election-results-2014-roscommon', { shelves: 'closed' });
  await expect(pane(page).locator('#cn-shelf-e-irish-local [data-cn-shelf]')).toHaveAttribute('aria-expanded', 'true');
});

test('N22 a copied map link opens its row, even one that named only the section', async ({ page }) => {
  // Phelim Birch's link (2026-10-11), copied while the row was closed: it says only cat=boundaries.
  await open(page, 'layers=eds-2019&lng=-8.05000&lat=53.50197&zoom=5.86&cat=boundaries', { shelves: 'closed' });
  const ed = row(page, 'electoral-divisions-electoral-divisions');
  await expect(ed.locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expect(ed.locator('.cn-tick[aria-label="2019"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(ed).toBeInViewport();
  // The row's title starts below the sticky section tabs, not under them.
  const [tabsBottom, titleTop] = await page.evaluate(() => [document.querySelector('[data-cn-tabs]').getBoundingClientRect().bottom, document.querySelector('[data-cn-series="electoral-divisions-electoral-divisions"] .cn-row__name').getBoundingClientRect().top]);
  expect(titleTop).toBeGreaterThanOrEqual(tabsBottom);
  // "Copy link" now names the row and edition, whatever the pane is showing.
  await pane(page).locator('[data-cn-tab="historic"]').click();
  const link = await page.evaluate(() => window.uiController._catalogueNext.shareUrl('eds-1986'));
  expect(new URLSearchParams(new URL(link).hash.slice(1)).get('cat')).toBe('series/electoral-divisions-electoral-divisions/eds-1986');
});

test('N23 elections: shelves start closed, general elections by default, by-elections one click away', async ({ page }) => {
  await open(page, 'cat=elections', { shelves: 'closed' });
  for (const v of await pane(page).locator('[data-cn-shelf]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')))) expect(v).toBe('false');
  await expect(pane(page).locator('[data-cn-filter="ekind"][data-value="general"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(pane(page).locator('.cn-erow')).toHaveCount(generals.length);
  await expect(pane(page).locator('.cn-filters-toggle .cn-badge')).toHaveCount(0);
  // The summary offers the by-elections the default leaves out.
  const by = catalogue.elections.length - generals.length;
  const show = pane(page).locator('.cn-summary [data-cn-filter="ekind"][data-value=""]');
  await expect(show).toHaveText(`Show ${by.toLocaleString('en-GB')} by-elections too`);
  await show.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(catalogue.elections.length);
  // A link to a body opens its shelf.
  await page.goto('about:blank');
  await open(page, 'cat=elections/irish-local', { shelves: 'closed' });
  await expect(pane(page).locator('#cn-shelf-e-irish-local [data-cn-shelf]')).toHaveAttribute('aria-expanded', 'true');
  await expect(pane(page).locator('#cn-shelf-e-dail [data-cn-shelf]')).toHaveAttribute('aria-expanded', 'false');
});

test('N24 a county townland map downloads its own file, as every part does', async ({ page }) => {
  await open(page);
  const wrong = await page.evaluate(() => {
    const c = window.uiController._catalogueNext;
    const out = [];
    for (const s of c.data.series) for (const m of s.members) for (const x of [...(c.rec(m.id).parts || []), ...(c.rec(m.id).counties || [])]) {
      const f = c.full(x.id);
      const own = f?.files?.fgb;
      const url = f && (f.downloads?.fgb || f.files?.fgb || f.sourceFile);
      if (own && url !== own) out.push(x.id);
    }
    return out;
  });
  expect(wrong).toEqual([]);
});

test('N25 descriptions: an opened row, an election and a map Details page say what they are', async ({ page }) => {
  const desc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalogue/descriptions.json'), 'utf8'));
  await open(page);
  // The opened row starts with its description and links.
  const town = row(page, 'townlands-townlands');
  await town.locator('[data-cn-expand]').click();
  await expect(town.locator('.cn-about').first()).toContainText(desc.rows['townlands-townlands'].text[0]);
  await expect(town.locator('.cn-about a', { hasText: 'Wikipedia: Townland' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Townland');
  // A map's Details page shows its row's description.
  await page.evaluate(() => window.uiController.showCatalogueDetailView('counties-ireland-1957'));
  await expect(page.locator('.catalogue-detail__description')).toContainText(desc.rows['counties-counties'].text[0].slice(0, 60));
  // An election with a description can be expanded in the Elections tab.
  await page.goto('about:blank');
  await open(page, 'cat=elections');
  const ge = pane(page).locator('[data-cn-election="dail-eireann__2024-11-29"] .cn-erow__about');
  await ge.locator('summary').click();
  await expect(ge).toContainText('Election for the 34th Dáil');
  await expect(pane(page).locator('.cn-erow__about')).toHaveCount(Object.keys(desc.elections).length);
});

// The site's service worker answers /_api requests itself, out of reach of page.route: block it here.
test.describe('contributor editing', () => {
test.use({ serviceWorkers: 'block' });
test('N26 a contributor suggests an edit to a map from the catalogue; others are sent to sign in', async ({ page }) => {
  let sent = null;
  await page.route('**/_api/auth/status', (r) => r.fulfill({ json: { ok: true, auth: { authenticated: false, allowed: false } } }));
  await page.route('**/_api/contributions/whoami', (r) => r.fulfill({ json: { ok: true, auth: { authenticated: true, allowed: true, email: 'editor@example.org' } } }));
  await page.route('**/_api/contributions/submit', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ json: { ok: true, submission: { id: 'sub_test' } } }); });
  await open(page, `cat=series/${LGD}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.uiController._catalogueNext.auth?.allowed))).toBe(true);
  const btn = row(page, LGD).locator('[data-cn-act="edit"]');
  await expect(btn).toBeVisible();
  await btn.click();
  const dialog = page.locator('dialog.cn-edit');
  await expect(dialog).toBeVisible();
  const name = await dialog.locator('input[name="name"]').inputValue();
  expect(name.length).toBeGreaterThan(0);
  await dialog.locator('textarea[name="description"]').fill('A clearer description.');
  await dialog.locator('textarea[name="summary"]').fill('Rewrote the description.');
  await dialog.locator('[data-edit-submit]').click();
  await expect(dialog.locator('.cn-edit__status')).toContainText('Sent for review (sub_test)');
  expect(sent.kind).toBe('metadata-edit');
  expect(sent.entityType).toBe('map');
  expect(sent.entityId).toBe(LGD_NEWEST);
  expect(sent.patch).toEqual({ description: 'A clearer description.' });
});
});
