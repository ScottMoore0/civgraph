// The rebuilt catalogue in the browser, against the local test site (tools/dev-site/), which
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
const SECTION_TABS = [['boundaries', 'Boundary', 'Boundaries'], ['places', 'Places', 'Places'], ['statistics', 'Statistics', 'Statistics'], ['historic', 'Historic', 'Historic']];
const mapsOf = (kind) => ofKind(kind).reduce((n, s) => n + s.members.length + (s.local?.length || 0), 0);
const pane = (page) => page.locator('#catalogueFlatView [data-cn-root]');
const row = (page, id) => pane(page).locator(`[data-cn-series="${id}"]`);
const menuItem = (page, text) => page.locator('.cn-menu [role="menuitem"]', { hasText: text });
// An opened row of several maps: its "Details for" menu, and the button that opens or closes the
// chosen map's facts, versions and parts (Phelim Birch, 25 Nov 2026: the strip of chips, open or closed).
const picker = (r) => r.locator('.cn-panel [data-cn-pick-edition]');
const pickMore = (r) => r.locator('.cn-panel .cn-picker__more');
const chosenLabel = (r) => picker(r).evaluate((el) => /** @type {HTMLSelectElement} */ (el).selectedOptions[0]?.textContent || '');
/** The map chosen in an opened row, its facts open. */
const expectPicked = async (r, label) => {
  await expect(pickMore(r)).toHaveAttribute('aria-label', `${label}: facts, versions and parts`);
  await expect(pickMore(r)).toHaveAttribute('aria-expanded', 'true');
  expect(await chosenLabel(r)).toBe(label);
};
/** Choose a map in an opened row and open its facts: the open one's button closes it (N59), so click only when it is closed. */
const openPick = async (r, label) => {
  if ((await chosenLabel(r)) !== label) await picker(r).selectOption({ label });
  await expect(pickMore(r)).toHaveAttribute('aria-label', `${label}: facts, versions and parts`);
  if ((await pickMore(r).getAttribute('aria-expanded')) !== 'true') await pickMore(r).click();
  await expectPicked(r, label);
};
const route = (page) => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('cat'));
const loaded = (page) => page.evaluate(() => window.__civgraphTest2.app.getLoadedLayerIds());

// Shelves start closed; most tests work inside them, so they start with every shelf open
// (as a reader who had opened them this session) unless a test asks for the default.
const ELECTION_SHELVES = ['dail', 'westminster', 'ni-devolved', 'ni-local', 'irish-local', 'pre-partition-local', 'european', 'referendum', 'presidential'];
const SHELF_IDS = [...catalogue.shelves.map((s) => s.id), 'environment', ...ELECTION_SHELVES.map((g) => `e-${g}`)];
const generals = catalogue.elections.filter((e) => e.kind !== 'by-election');
// An election the election-bodies registry also lists under a second body has a row on that body's
// shelf too (groups.alsoListed: the 1918 election on the Dáil and Westminster shelves).
const ALSO_LISTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/registries/election-bodies.json'), 'utf8')).groups.alsoListed || [];
const rowsOf = (list) => list.length + ALSO_LISTED.filter((a) => list.some((e) => e.key === a.election)).length;
// A grouped entry (groups.groupedElections: the European elections of a year in the Republic and
// Northern Ireland, the 2019 mayoral plebiscites) is one row standing for its members, held in
// each of their places.
const GROUPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/registries/election-bodies.json'), 'utf8')).groups.groupedElections || [];
const heldIn = (e, scope) => e.scope === scope || Boolean(e.scopes?.includes(scope));
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

test('C03 a loaded map can be hidden and shown from the loaded-layers panel', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`).click();
  await expect.poll(() => loaded(page)).toContain(LGD_NEWEST);
  // The row has no Hide since Phelim Birch's notes (19 Nov 2026): the panel of loaded layers does it.
  await page.evaluate(() => document.getElementById('activeLayers')?.classList.remove('hidden'));
  const eye = page.locator(`#activeLayersList .visibility-btn[data-map-id="${LGD_NEWEST}"]`);
  await eye.click();
  await expect.poll(() => page.evaluate((id) => window.uiController.onCheckMapVisible(id), LGD_NEWEST)).toBe(false);
  await page.locator(`#activeLayersList .visibility-btn[data-map-id="${LGD_NEWEST}"]`).click();
  await expect.poll(() => page.evaluate((id) => window.uiController.onCheckMapVisible(id), LGD_NEWEST)).toBe(true);
});

test('C04 a row\'s link and a map\'s link can be copied', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  // A row of several maps links to itself.
  await row(page, LGD).locator('.cn-row__end [data-cn-act="row-link"]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`cat=series/${LGD}`);
  // A map's own link is on its Details page.
  await page.evaluate((id) => window.uiController.showCatalogueDetailView(id, true), LGD_NEWEST);
  await page.locator('[data-cn-detail-actions] [data-cn-act="copy-link"]').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`layers=${LGD_NEWEST}`);
});

test('C05 C06 FlatGeobuf, the provider\'s files and the original GeoJSON are offered for download', async ({ page }) => {
  await open(page);
  const found = await page.evaluate(() => {
    const ui = window.uiController;
    const n = ui._catalogueNext;
    for (const s of n.data.series) {
      if (s.members.filter((m) => !m.of).length !== 1) continue;
      const full = n.full(s.members[0].id);
      const src = full ? ui.getSourceDownloads(full) : [];
      if (src.length >= 2) return { series: s.id, labels: src.slice(0, 3).map((d) => d.label) };
    }
    return null;
  });
  expect(found).not.toBeNull();
  // A row of one map has its Download beside Add (the row may be in another section: go to it).
  await page.evaluate((id) => { location.hash = `cat=series/${id}`; }, found.series);
  const r = row(page, found.series);
  await expect(r).toBeVisible({ timeout: 20000 });
  await r.scrollIntoViewIfNeeded();
  await r.locator('.cn-row__end [data-cn-act="downloads"]').click();
  for (const label of found.labels) await expect(menuItem(page, label).first()).toBeVisible();
  await page.keyboard.press('Escape');
  // A row of several: each map on its strip has its own, open or closed (Phelim Birch, 25 Nov 2026).
  await page.evaluate((id) => { location.hash = `cat=series/${id}`; }, LGD);
  await expect(row(page, LGD).locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true', { timeout: 20000 });
  await row(page, LGD).locator(`:scope > .cn-chips [data-cn-act="downloads"][data-map="${LGD_NEWEST}"]`).click();
  await expect(menuItem(page, 'FlatGeobuf')).toBeVisible();
});

test('C07 other versions of an edition and a map\'s parts are reachable', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await openPick(row(page, LGD), '1993');
  const versions = row(page, LGD).locator('.cn-sub', { hasText: 'Versions' });
  await expect(versions).toContainText('OSNI 1:50,000');
  // Each version has its own chip, Zoom, Download and Details.
  await expect(versions.locator('.cn-chip[data-cn-toggle]')).toHaveCount(await versions.locator('.cn-vlist__item').count());
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
  await expect(row(page, 'counties-counties').locator('.cn-row__credit')).toContainText('Birch');
});

test('C08 a map\'s details page opens', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await row(page, LGD).locator(`[data-cn-act="details"][data-map="${LGD_NEWEST}"]`).click();
  await expect(page.locator('#catalogueDetailView')).toBeVisible();
  await expect(page.locator('#catalogueDetailView')).toContainText('2022');
});

test('C09 provider and feature count are shown', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  // The opened row leaves out the title, authors and geometry (user, 2026-10-05).
  await expect(row(page, LGD).locator('.cn-facts')).not.toContainText('Local Government Boundary Commission');
  // The opened row keeps its strip of chips (N54); a chip's hover names the provider.
  await expect(row(page, LGD).locator(`:scope > .cn-chips [data-cn-toggle="${LGD_NEWEST}"]`)).toHaveAttribute('title', /Local Government Boundary Commission/);
  await expect(row(page, 'census-census-grid').locator('.cn-row__credit')).toContainText(/\d,\d{3} /);
});

test('C10 each chip takes the colour of its row (the loaded-layers panel shows the colour a map is drawn in: N56)', async ({ page }) => {
  await open(page);
  const colour = lgd.color;
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
  await expect(first.locator('a.cn-iconbtn')).toHaveAttribute('href', /^\/browse\/elections\/[a-z0-9-]+$/);
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
  await expect(pane(page).locator('.cn-erow').first()).toContainText(/Bye?-election/);
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
  await expect(tabs).toContainText(['Boundaries', 'Places', 'Statistics', 'Historic', 'Elections']);
  await expect(tabs.first()).toHaveAttribute('aria-current', 'true');
  // Each section counts its maps, not its rows (Phelim Birch, 2026-10-10).
  for (const [id, kind] of SECTION_TABS) await expect(pane(page).locator(`[data-cn-tab="${id}"] .cn-tab__count`)).toHaveText(mapsOf(kind).toLocaleString('en-GB'));
  // The line under the tabs gives the same map count as the tab, named for its section
  // (QA 2026-11-11, M3: it said "324 maps" beside "Boundaries 343").
  await expect(pane(page).locator('.cn-summary--count')).toContainText(`${mapsOf('Boundary').toLocaleString('en-GB')} maps in Boundaries`);
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
  await expect(r.locator('.cn-row__credit')).toContainText('Matthews');
  await r.locator('[data-cn-toggle="county-ed-1911"]').click();
  await expect.poll(() => loaded(page)).toEqual(expect.arrayContaining([expect.stringContaining('county-ed-1911')]));
});

test('N15b a row whose maps are all still to be added says so, lists them on request and offers nothing to load', async ({ page }) => {
  // The six rows of 21 Nov 2026 (Administrative Counties (Ireland), Superintendent Registrars' Districts, the three
  // Poor Law Unions rows, Towns under the Towns Improvement Act): every edition is to be added.
  await open(page);
  for (const id of ['local-government-poor-law-unions--roi', 'local-government-poor-law-unions--ireland', 'local-government-towns-improvement-act-towns']) {
    const r = row(page, id);
    await expect(r.locator('.cn-badge--todo')).toHaveText('To be added');
    await expect(r.locator('[data-cn-toggle]')).toHaveCount(0);
    await expect(r.locator('[data-cn-expand]')).toHaveCount(0);
  }
  const plu = row(page, 'local-government-poor-law-unions--ireland');
  await plu.locator('[data-cn-todo]').click();
  await expect(plu.locator('.cn-chip--todo')).toHaveCount(8);
  await expect(plu.locator('.cn-chip--todo').first()).toContainText('1921');
});

test('N16 a row keeps its chips to one line; "+N more" shows the rest and "Hide" puts them back', async ({ page }) => {
  await open(page);
  const r = row(page, 'local-government-local-authorities');
  const chips = r.locator('.cn-chips [data-cn-toggle]:visible');
  const top = async () => new Set(await chips.evaluateAll((els) => els.map((el) => el.offsetTop))).size;
  expect(await top()).toBe(1);
  const short = await chips.count();
  await r.locator('[data-cn-more]').click();
  await expect.poll(() => chips.count()).toBeGreaterThan(short);
  await expect(r.locator('[data-cn-fewer]')).toHaveText('Hide');
  await r.locator('[data-cn-fewer]').click();
  await expect(chips).toHaveCount(short);
  await expect(r.locator('[data-cn-more]:visible')).toHaveCount(1);
});

test('N17 council maps follow their edition; hovers name the unit; parts download; compare keeps the place', async ({ page }) => {
  await open(page);
  // Hover text: date · providers · count in the map's own unit.
  await expect(row(page, 'counties-counties').locator('.cn-chips [data-cn-toggle]').first()).toHaveAttribute('title', /· 32 Counties$/);
  // The 2019 ED council maps show with the 2019 edition only.
  const ed = row(page, 'electoral-divisions-electoral-divisions');
  await ed.locator('[data-cn-expand]').click();
  await openPick(ed, '2019');
  await expect(ed.locator('.cn-sub', { hasText: 'Council maps' })).toContainText('Fingal (2019)');
  await openPick(ed, '1997');
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
  // Historic lists its rows straight, as Statistics does.
  await pane(page).locator('[data-cn-tab="historic"]').click();
  await expect(pane(page).locator('.cn-shelf__head, .cn-subject__head')).toHaveCount(0);
  await expect(pane(page).locator('.cn-row').first()).toBeVisible();
  // OSNI Orthophoto Coverage is listed here, and Road Traffic Collisions under Statistics (Phelim Birch, 15 Nov 2026).
  await expect(row(page, 'aerial-imagery-and-elevation-osni-orthophoto-coverage')).toHaveCount(1);
  await pane(page).locator('[data-cn-tab="statistics"]').click();
  await expect(row(page, 'roads-and-traffic-psni-road-traffic-collisions')).toHaveCount(1);
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
  await expectPicked(ed, '1983');
});

test('N20 placeholders, transport order, constituency hovers and dates', async ({ page }) => {
  await open(page);
  // Every Statistics row whose maps are all still to come says so. Since the census statistics
  // became map overlays (src/census-overlay.mjs, 2026-11-01) there may be none left to come.
  await pane(page).locator('[data-cn-tab="statistics"]').click();
  const stats = ofKind('Statistics').filter((s) => s.members.every((m) => catalogue.maps[m.id].status === 'placeholder'));
  for (const s of stats.slice(0, 5)) await expect(row(page, s.id).locator('.cn-badge--todo')).toHaveCount(1);
  // Transport: routes and networks first, then collisions and road defects, and Way Points and
  // GDF2s last (Phelim Birch's review, 11 Nov 2026).
  await pane(page).locator('[data-cn-tab="places"]').click();
  const names = await pane(page).locator('#cn-shelf-transport .cn-row__name').allTextContents();
  expect(names[0]).toBe('Roads');
  // The collision rows are one since Phelim Birch's review of 12 Nov 2026 (#46/#47), listed under
  // Statistics since his comment of 15 Nov 2026; and "NI" left the defects row (#49).
  expect(names.slice(-4)).toEqual(['Pothole Enquiries', 'Road Surface Defects', 'Way Points', 'GDF2s']);
  expect(names).not.toContain('Road Traffic Collisions');
  // Water opens with the coast (#70: the shelf's `first` list).
  expect((await pane(page).locator('#cn-shelf-water .cn-row__name').allTextContents())[0]).toBe('Coast');
  // A constituency map's hover gives no election-day date; its label keeps the year.
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  // Boundaries has a Water shelf of its own, as Places & routes does (Phelim Birch, 15 Nov 2026).
  await expect(pane(page).locator('#cn-shelf-water')).toHaveCount(1);
  await expect(pane(page).locator('#cn-shelf-water [data-cn-series="water-quality-water-bodies"]').first()).toHaveCount(1);
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
  const more = row(page, 'census-super-output-area').locator('[data-cn-more]:visible');
  if (await more.count()) await more.click();
  await expect(ward01).toHaveText(/2001/);
  expect(await ward01.getAttribute('title')).toContain('Same map as Wards 1993');
});

test('N28 live planning maps are dated as at their snapshot (owner, 11 Nov 2026)', async ({ page }) => {
  // data.gov.ie's national extract (ETL) of 20 Apr 2026; Roscommon's live layer, fetched 8 Jul 2026.
  const national = catalogue.maps['roi-national-planning-applications'];
  const roscommon = catalogue.maps['oda-map-00115-planning-application-boundaries-roscommon'];
  expect([national.date, national.dateAsAt]).toEqual(['2026-04-20', true]);
  expect([roscommon.date, roscommon.dateAsAt]).toEqual(['2026-07-08', true]);
  expect(roscommon.dateNote).toMatch(/8 Jul 2026/);
  // Maps not dated that way read as before.
  expect(catalogue.maps['pc-2023'].dateAsAt).toBeUndefined();
  await open(page);
  await pane(page).locator('[data-cn-tab="boundaries"]').click();
  const r = row(page, 'planning-applications-and-registers-planning-application-boundaries');
  await r.scrollIntoViewIfNeeded();
  // A one-map row carries its map's hover line on the row title (its Add button has none).
  const title = r.locator('[data-cn-expand="planning-applications-and-registers-planning-application-boundaries"]');
  expect(await title.getAttribute('title')).toMatch(/^as at 20 Apr 2026 · /);
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
  const chips = row(page, LGD).locator('.cn-chips button.cn-chip:visible');
  await chips.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(chips.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(chips.last()).toBeFocused();
});

test('N04 two editions can be compared, chosen in turn from the row\'s Compare', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('.cn-row__end [data-cn-act="row-compare"]').click();
  await menuItem(page, lgd.members[0].label).first().click();
  await expect(page.locator('.cn-menu')).toContainText(`Compare ${lgd.members[0].label} with`);
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

test('N06 opening a row keeps its strip of chips; "Details for" chooses a map, by its name on the strip, and opens its facts', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  const r = row(page, LGD);
  // No timeline in the row: the slider under the map is the timeline (Phelim Birch's notes, 19 Nov 2026).
  await expect(r.locator('.cn-tl, .cn-tick')).toHaveCount(0);
  // The menu lists the strip's maps in the strip's order, by the chips' own names (Phelim Birch, 25 Nov 2026).
  const stripLabels = await r.locator(':scope > .cn-chips .cn-chip[data-cn-toggle] .cn-chip__label').allTextContents();
  const options = await picker(r).locator('option').allTextContents();
  expect(options).toEqual(stripLabels);
  expect(options).toEqual(lgd.members.filter((m) => !m.of).map((m) => m.label));
  // The chosen map has its Zoom, Download and Details beside the menu.
  await expect(r.locator('.cn-picker [data-cn-act="details"]')).toHaveCount(1);
  await openPick(r, '1985');
  await expect(r.locator('.cn-panel .cn-facts')).toContainText('1985');
  await expect(r.locator('.cn-ed__title')).toHaveCount(0);
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
  await expect(pane(page).locator('.cn-shelf__name')).toHaveText(['Dáil', 'Seanad', 'Westminster', 'NI Devolved', 'NI local', 'Irish local', 'Pre-partition local', 'European', 'Referendum', 'Presidential']);
  await expect(pane(page).locator('[data-cn-filter="body"]')).toHaveCount(0);
  await expect(pane(page).locator('#cn-shelf-e-ni-devolved .cn-erow')).toHaveCount(generals.filter((e) => devolved.includes(e.bodySlug)).length);
  const ni = pane(page).locator('[data-cn-filter="escope"][data-value="Northern Ireland"]');
  await ni.click();
  // The 1921 Northern Ireland general election is on the Dáil shelf too (alsoListed), so it is two rows.
  await expect(pane(page).locator('.cn-erow')).toHaveCount(rowsOf(generals.filter((e) => heldIn(e, 'Northern Ireland'))));
  await ni.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(rowsOf(generals));
  await expect(pane(page).locator('.cn-jump, .cn-hist')).toHaveCount(0);
});

test('W16 an election also listed under a second body is on both shelves, one record turned on from either', async ({ page }) => {
  await open(page, 'cat=elections');
  const key = 'dail-eireann__1918-12-14';
  await expect(pane(page).locator(`#cn-shelf-e-dail [data-cn-election="${key}"]`)).toHaveCount(1);
  const westminster = pane(page).locator(`#cn-shelf-e-westminster [data-cn-election="${key}"]`);
  await expect(westminster).toHaveCount(1);
  // Filed under the Dáil, it says so on the Westminster shelf; its shelf count includes it.
  await expect(westminster.locator('.cn-badge').first()).toHaveText('Dáil');
  const onShelf = catalogue.elections.filter((e) => e.kind !== 'by-election' && e.bodySlug === 'house-of-commons-of-the-united-kingdom').length + 1;
  await expect(pane(page).locator('#cn-shelf-e-westminster .cn-erow')).toHaveCount(onShelf);
  // Turned on from one shelf, both rows show it on the map.
  await westminster.locator('[data-cn-election-toggle]').click();
  await expect(pane(page).locator(`#cn-shelf-e-dail [data-cn-election="${key}"] [data-cn-election-toggle]`)).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 });
});

test('W19 the European shelf lists each year 1979-2019 as one entry for both elections; 2024 alone', async ({ page }) => {
  await open(page, 'cat=elections');
  const shelf = pane(page).locator('#cn-shelf-e-european');
  const european = generals.filter((e) => ['ireland-european', 'european-parliament'].includes(e.bodySlug));
  // Nine entries and the Republic's 2024 election, which Northern Ireland, out of the EU, did not hold.
  await expect(shelf.locator('.cn-erow')).toHaveCount(european.length);
  await expect(shelf.locator('.cn-erow--group')).toHaveCount(9);
  await expect(shelf.locator('[data-cn-election="ireland-european__2024-06-07"]')).toHaveCount(1);
  await expect(shelf.locator('[data-cn-election="european-parliament__2019-05-23"], [data-cn-election="ireland-european__2019-05-24"]')).toHaveCount(0);
  const y2019 = shelf.locator('[data-cn-election="european-parliament-2019"]');
  await expect(y2019.locator('.cn-erow__title')).toHaveText('2019 European Parliament election');
  await expect(y2019.locator('.cn-badge').first()).toHaveText('European');
  // Each election keeps its own results page.
  await expect(y2019.locator('.cn-erow__members a')).toHaveText(['Republic of Ireland', 'Northern Ireland']);
  await expect(y2019.locator('.cn-erow__members a').first()).toHaveAttribute('href', '/browse/elections/ireland-european-2019-05-24');
  await expect(y2019.locator('.cn-erow__members a').last()).toHaveAttribute('href', '/browse/elections/european-parliament-2019-05-23');
  // Held in both places: each Where filter keeps it.
  for (const scope of ['Northern Ireland', 'Republic of Ireland']) {
    const chip = pane(page).locator(`[data-cn-filter="escope"][data-value="${scope}"]`);
    await chip.click();
    await expect(pane(page).locator('[data-cn-election="european-parliament-2019"]')).toHaveCount(1);
    await chip.click();
  }
});

/** The group open on the map: its key, the member shown and the members' maps, as the manager holds them. */
const groupState = (page) => page.evaluate(() => {
  const el = window.__civgraphTest2?.elections;
  return el?.activeGroup ? { key: el.activeGroup.entry.key, shown: el.activeEntry?.key, members: el.activeGroup.members.map((m) => m.entry.key) } : null;
});

for (const group of GROUPED) {
  test(`W19 ${group.id}: one Open draws every election, each in its own colours, with a tab each; Open again takes it off`, async ({ page }) => {
    const errors = await open(page, 'cat=elections');
    const row = pane(page).locator(`[data-cn-election="${group.id}"]`).first();
    const toggle = row.locator('[data-cn-election-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 60000 });
    await expect.poll(() => groupState(page), { timeout: 30000 }).toEqual({ key: group.id, shown: group.members[0].election, members: group.members.map((m) => m.election) });
    // Every member's map is drawn, styled by its own election.
    const maps = await page.evaluate((keys) => keys.map((key) => window.__civgraphTest2.elections.catalogue.elections.find((e) => e.key === key)?.sourceMapId), group.members.map((m) => m.election));
    const layers = await loaded(page);
    for (const id of new Set(maps)) expect(layers).toContain(id);
    // The pane names the entry; its tabs name the members, the first shown.
    await expect(page.locator('#electionPaneTitle')).toHaveText(group.title);
    const tabs = page.locator('#electionPaneContent [data-election-group-member]');
    await expect(tabs).toHaveText(group.members.map((m) => m.label));
    await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
    // The legend has a section a member.
    await expect(page.locator('#test2MapLegend .test2-map-legend__heading--member')).toHaveText(group.members.map((m) => m.label));
    // Another tab shows that member's results; the address says which.
    await tabs.nth(1).click();
    await expect.poll(async () => (await groupState(page))?.shown).toBe(group.members[1].election);
    await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('electionMember'))).toBe(group.members[1].election);
    expect(await page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('layers'))).toBe(`election-group-${group.id}`);
    // Open again: off, every member's map with it.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false', { timeout: 30000 });
    await expect.poll(() => groupState(page)).toBe(null);
    await expect.poll(() => loaded(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('W19 a grouped entry\'s address opens it, at the member it names; the timeline steps through the entries', async ({ page }) => {
  const group = GROUPED.find((g) => g.id === 'european-parliament-2014');
  const member = group.members[1].election;
  await open(page, `electionBody=Group&electionDate=${group.id}&electionMember=${member}&cat=elections`);
  await expect.poll(() => groupState(page), { timeout: 60000 }).toEqual({ key: group.id, shown: member, members: group.members.map((m) => m.election) });
  await expect(page.locator(`#electionPaneContent [data-election-group-member="${member}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(pane(page).locator(`[data-cn-election="${group.id}"] [data-cn-election-toggle]`).first()).toHaveAttribute('aria-pressed', 'true');
  // The layer form of the address (as a copied link or the History list writes it) opens it too.
  await page.goto('about:blank');
  await open(page, `layers=election-group-${group.id}&cat=elections`);
  await expect.poll(async () => (await groupState(page))?.key, { timeout: 60000 }).toBe(group.id);
  // The timeline's stops are the entries (and the Republic's 2024 election), not their members.
  const stops = await page.evaluate(() => (window.__civgraphTest2.app.timelineItems || []).map((item) => item.date));
  expect(stops).toContain('european-parliament-2019');
  expect(stops).toContain('2024-06-07');
  expect(stops).not.toContain('2014-05-22');
});

test('W19 a member\'s own address still opens that election alone', async ({ page }) => {
  // Browse's "Open map" link for the 2019 European election in Northern Ireland.
  await open(page, 'layers=election-european-parliament-2019-05-23');
  await expect.poll(() => page.evaluate(() => window.__civgraphTest2?.elections?.activeEntry?.key || null), { timeout: 60000 }).toBe('european-parliament__2019-05-23');
  expect(await groupState(page)).toBe(null);
  await expect(page.locator('#electionPaneContent [data-election-group-member]')).toHaveCount(0);
  // The pane's own title for one election ("European - 23 May 2019"), not the entry's.
  await expect(page.locator('#electionPaneTitle')).toHaveText('European - 23 May 2019');
  // And by body and date, as an election-history link names it.
  await page.goto('about:blank');
  await open(page, 'electionBody=Referendum%20(Ireland)&electionDate=2019-05-24-directly-elected-mayor-cork-city');
  await expect.poll(() => page.evaluate(() => window.__civgraphTest2?.elections?.activeEntry?.key || null), { timeout: 60000 }).toBe('ireland-referendum__2019-05-24-directly-elected-mayor-cork-city');
  expect(await groupState(page)).toBe(null);
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
  await expect(person.locator('.cn-person__name')).toHaveAttribute('href', '/browse/persons/sammy-wilson-96356');
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
  await expect(pane(page).locator('.cn-erow')).toHaveCount(rowsOf(generals));
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

test('N21b the old address of a merged row opens the row it went into', async ({ page }) => {
  // Phelim Birch's review (#59/#60): Ringfort went into Monuments (seriesRedirects).
  await open(page, 'cat=series/archaeology-and-monuments-ringfort', { shelves: 'closed' });
  await expect.poll(() => route(page)).toBe('series/archaeology-and-monuments-monument-types');
  await expect(row(page, 'archaeology-and-monuments-monument-types').locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
});

test('N22 a copied map link opens its row, even one that named only the section', async ({ page }) => {
  // Phelim Birch's link (2026-10-11), copied while the row was closed: it says only cat=boundaries.
  await open(page, 'layers=eds-2019&lng=-8.05000&lat=53.50197&zoom=5.86&cat=boundaries', { shelves: 'closed' });
  const ed = row(page, 'electoral-divisions-electoral-divisions');
  await expect(ed.locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
  await expectPicked(ed, '2019');
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
  await expect(pane(page).locator('.cn-erow')).toHaveCount(rowsOf(generals));
  await expect(pane(page).locator('.cn-filters-toggle .cn-badge')).toHaveCount(0);
  // The summary offers the by-elections the default leaves out.
  const by = catalogue.elections.length - generals.length;
  const show = pane(page).locator('.cn-summary [data-cn-filter="ekind"][data-value=""]');
  await expect(show).toHaveText(`Show ${by.toLocaleString('en-GB')} by-elections too`);
  await show.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(rowsOf(catalogue.elections));
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
  // Counted by election: a row listed on two shelves is one election. A grouped entry is one row
  // for its members: its own description, else its members'.
  const memberOf = new Map(GROUPED.flatMap((g) => g.members.map((m) => [m.election, g.id])));
  const described = new Set(Object.keys(desc.elections).map((key) => memberOf.get(key) || key));
  for (const g of GROUPED) if (g.about) described.add(g.id);
  await expect.poll(() => pane(page).locator('.cn-erow:has(.cn-erow__about)').evaluateAll((rows) => new Set(rows.map((r) => r.getAttribute('data-cn-election'))).size)).toBe(described.size);
  // The plebiscites' entry carries Phelim Birch's description.
  const plebiscites = pane(page).locator('[data-cn-election="mayoral-plebiscites-2019"] .cn-erow__about');
  await plebiscites.locator('summary').click();
  await expect(plebiscites.locator('summary')).toHaveText('About these plebiscites');
  await expect(plebiscites).toContainText(GROUPED.find((g) => g.id === 'mayoral-plebiscites-2019').about.text[0].slice(0, 80));
});

// The site's service worker answers /_api requests itself, out of reach of page.route: block it here.
test('N27 an open election gets more of the screen: a narrower catalogue, shorter results that fold away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const paneWidth = () => page.evaluate(() => Math.round(document.querySelector('.pane--info').getBoundingClientRect().width));
  const resultsHeight = () => page.evaluate(() => Math.round(document.getElementById('electionResultsPane').getBoundingClientRect().height));
  await open(page, 'cat=elections');
  await expect.poll(paneWidth).toBe(461);
  await pane(page).locator('.cn-erow').first().locator('[data-cn-election-toggle]').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.__civgraphTest2.app.elections?.activeEntry)), { timeout: 30000 }).toBe(true);
  // The catalogue gives the map room while the election is open (28% of 1280 = 358px)...
  await expect.poll(paneWidth).toBe(358);
  // ...and the results take 30% of the window by default, not 38%.
  await expect.poll(resultsHeight).toBe(240);
  // The results fold down to their header, and open again.
  const fold = page.locator('#electionPaneCollapse');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(resultsHeight).toBe(40);
  await fold.click();
  await expect.poll(resultsHeight).toBe(240);
});

test('N27 the language control: typing the phrase shows it, nothing else does, and an ordinary visit loads none of it', async ({ page }) => {
  const i18n = [];
  // The map itself loads place-name-fields.json for the Irish second line on labels, shown to every
  // reader (owner, 24 Nov 2026); the language control's own files must still stay unloaded.
  page.on('request', (r) => { if (r.url().includes('/assets/i18n/') && !r.url().includes('/assets/i18n/place-name-fields.json')) i18n.push(r.url()); });
  const flag = () => page.evaluate(() => localStorage.getItem('civgraph.langPreview'));
  await open(page);
  await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
  for (const q of ['language', 'toggle', 'irish', 'toggle language']) {
    await search(page, q);
    await expect(pane(page).locator('[data-cn-lang-notice]')).toHaveCount(0);
  }
  await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
  expect(i18n).toEqual([]);
  expect(await flag()).toBeNull();

  await page.fill('#searchInput', 'Language toggle!');
  await expect(pane(page).locator('[data-cn-lang-notice]')).toHaveText('Language options are now shown.', { timeout: 15000 });
  await expect(pane(page).locator('.cn-empty, .cn-shelf')).toHaveCount(0);
  await expect(page.locator('[data-lang-switch] select')).toBeVisible();
  expect(await flag()).toBe('1');

  // It persists: the next visit loads the runtime by itself. Hide clears it again.
  await page.reload();
  await expect(page.locator('[data-lang-switch] select')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-lang-switch] [data-lang-hide]').click();
  await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
  expect(await flag()).toBeNull();
});

test.describe('contributor editing', () => {
test.use({ serviceWorkers: 'block' });
test('N26 a contributor suggests an edit to a map from the catalogue; others are sent to sign in', async ({ page }) => {
  let sent = null;
  await page.route('**/_api/auth/status', (r) => r.fulfill({ json: { ok: true, auth: { authenticated: false, allowed: false } } }));
  await page.route('**/_api/contributions/whoami', (r) => r.fulfill({ json: { ok: true, auth: { authenticated: true, allowed: true, email: 'editor@example.org' } } }));
  await page.route('**/_api/contributions/submit', async (r) => { sent = JSON.parse(r.request().postData()); await r.fulfill({ json: { ok: true, submission: { id: 'sub_test' } } }); });
  await open(page, `cat=series/${LGD}`);
  await expect.poll(() => page.evaluate(() => Boolean(window.uiController._catalogueNext.auth?.allowed))).toBe(true);
  // Suggest an edit is on the map's Details page (Phelim Birch's notes, 19 Nov 2026), not in its row.
  await expect(row(page, LGD).locator('[data-cn-act="edit"]')).toHaveCount(0);
  await page.evaluate((id) => window.uiController.showCatalogueDetailView(id, true), LGD_NEWEST);
  const btn = page.locator('[data-cn-detail-actions] [data-cn-act="edit"]');
  await expect(btn).toBeVisible();
  await btn.click();
  const dialog = page.locator('dialog.cn-edit');
  await expect(dialog).toBeVisible();
  // Keywords are no longer offered.
  await expect(dialog.locator('[name="keywords"]')).toHaveCount(0);
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

/* ------------------------------------------------------------------ Phelim Birch's notes, 19 Nov 2026 */

test('N40 rows act by their shape: several maps link, cite and compare; one map adds, zooms, downloads and opens its Details', async ({ page }) => {
  await open(page);
  // No ⋯ menu any more.
  await expect(pane(page).locator('[data-cn-menu]')).toHaveCount(0);
  const multi = row(page, LGD).locator('.cn-row__end');
  await expect(multi.locator('[data-cn-act]')).toHaveCount(3);
  for (const [act, name] of [['row-link', `Copy a link to ${lgd.name}`], ['row-cite', `Cite ${lgd.name}`], ['row-compare', `Compare two editions of ${lgd.name}`]]) {
    await expect(multi.locator(`[data-cn-act="${act}"]`)).toHaveAttribute('aria-label', name);
  }
  const town = row(page, 'townlands-townlands').locator('.cn-row__end');
  await expect(town.locator('.cn-add[data-cn-toggle]')).toHaveCount(1);
  for (const act of ['zoom', 'downloads', 'details']) await expect(town.locator(`[data-cn-act="${act}"]`)).toHaveCount(1);
  // Every icon button has a name and a tooltip.
  const unnamed = await pane(page).locator('.cn-iconbtn').evaluateAll((els) => els.filter((b) => !b.getAttribute('aria-label') || !b.getAttribute('title')).length);
  expect(unnamed).toBe(0);
  // Tab order: the row's title, then its actions, then its chips.
  const order = await row(page, LGD).evaluate((li) => [...li.querySelectorAll('button')].slice(0, 5).map((b) => b.dataset.cnAct || (b.dataset.cnExpand ? 'title' : 'chip')));
  expect(order.slice(0, 4)).toEqual(['title', 'row-link', 'row-cite', 'row-compare']);
});

test('N41 a row of dated editions counts its latest complete edition\'s features and its editions', async ({ page }) => {
  await open(page);
  const counties = catalogue.series.find((s) => s.id === 'counties-counties');
  const editions = counties.members.filter((m) => !m.of).length;
  const latest = catalogue.maps[counties.members[0].id];
  await expect(row(page, 'counties-counties').locator('.cn-row__credit')).toContainText(`${latest.features} ${latest.unit} · ${editions} editions`);
});

test('N42 the Details page: its actions, and no Style, Data File or Keywords', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.uiController.showCatalogueDetailView('counties-ireland', true));
  const strip = page.locator('[data-cn-detail-actions]');
  await expect(strip).toBeVisible();
  for (const text of ['Add to map', 'Zoom to', 'Download', 'Copy link', 'Cite', 'Map image']) await expect(strip).toContainText(text);
  const view = page.locator('#catalogueDetailView');
  await expect(view.locator('.catalogue-detail__meta')).not.toContainText('Style');
  await expect(view.locator('.catalogue-detail__meta')).not.toContainText('Data File');
  await expect(view).not.toContainText('Keywords');
  // Download lists every format, the source's files too; Map image the two pictures of the view.
  await strip.locator('[data-cn-act="downloads-data"]').click();
  await expect(menuItem(page, 'FlatGeobuf')).toBeVisible();
  await expect(menuItem(page, 'Map image of this view')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await strip.locator('[data-cn-act="map-image"]').click();
  await expect(menuItem(page, 'Map image of this view (SVG)')).toBeVisible();
  await expect(menuItem(page, 'Map image of this view (PNG)')).toBeVisible();
  await page.keyboard.press('Escape');
  // Add puts the map on, and the button says so.
  await strip.locator('[data-cn-toggle]').click();
  await expect.poll(() => loaded(page)).toContain('counties-ireland');
  await expect(strip.locator('[data-cn-toggle]')).toHaveAttribute('aria-pressed', 'true');
});

test('N43 load-order colours, the legend\'s names in the loaded-layers panel, and a colour of the reader\'s own', async ({ page }) => {
  await page.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('civgraph:test:controls:')) localStorage.removeItem(k); } catch { /* private */ } });
  await open(page, 'layers=counties-ireland-1922,civil-parishes-by-province,baronies-all-ireland');
  await expect.poll(() => loaded(page)).toHaveLength(3);
  const palette = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/registries/colours.json'), 'utf8')).palettes.map.colours.loadOrder.values;
  const colours = await page.evaluate(() => ['counties-ireland-1922', 'civil-parishes-by-province', 'baronies-all-ireland'].map((id) => window.mapController.getLayerColour(id)));
  expect(colours.map((c) => c.toLowerCase())).toEqual(palette.slice(0, 3).map((c) => c.toLowerCase()));
  // The panel names each layer as the legend does.
  const names = await page.locator('#activeLayersList .active-layer-item__name').allTextContents();
  expect(names.sort()).toEqual(['Baronies', 'Civil Parishes', 'Counties, 1922'].sort());
  // A reader's colour, kept with the layer's preferences; Reset brings back the load-order colour.
  await page.evaluate(() => document.getElementById('activeLayers')?.classList.remove('hidden'));
  await page.locator('#activeLayersList .opacity-toggle-btn[data-map-id="baronies-all-ireland"]').click();
  const input = page.locator('#activeLayersList .layer-colour-input[data-map-id="baronies-all-ireland"]');
  await expect(input).toHaveAttribute('aria-label', 'Colour, Baronies');
  await input.evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect.poll(() => page.evaluate(() => window.mapController.getLayerColour('baronies-all-ireland'))).toBe('#123456');
  await page.locator('#activeLayersList .layer-colour-reset[data-map-id="baronies-all-ireland"]').click();
  await expect.poll(() => page.evaluate(() => window.mapController.getLayerColour('baronies-all-ireland').toLowerCase())).toBe(palette[2].toLowerCase());
  // A map taken off frees its colour for the next.
  await page.evaluate(() => window.uiController.onMapUnload('civil-parishes-by-province'));
  await page.evaluate(() => window.uiController.onMapLoad('provinces-1955'));
  await expect.poll(() => page.evaluate(() => window.mapController.getLayerColour('provinces-1955').toLowerCase())).toBe(palette[1].toLowerCase());
});

test('N44 the Provider filter: several providers, with counts, combined with Where', async ({ page }) => {
  await open(page);
  const box = pane(page).locator('[data-cn-providers]');
  // A narrow pane folds the filters behind the Filters button beside the search box.
  if (!(await box.isVisible())) await page.locator('#cnFiltersButton').click();
  await box.locator('summary').click();
  const osni = box.locator('[data-cn-provider="osni"]');
  const count = Number(await box.locator('[data-cn-provider-count="osni"]').textContent());
  expect(count).toBeGreaterThan(5);
  await osni.check();
  await expect(pane(page).locator('.cn-row')).toHaveCount(count);
  await expect(box.locator('[data-cn-provider-summary]')).toHaveText('OSNI');
  // A second provider widens the list; Where narrows it.
  await box.locator('[data-cn-provider="cso"]').check();
  await expect.poll(() => pane(page).locator('.cn-row').count()).toBeGreaterThan(count);
  await pane(page).locator('[data-cn-filter="scope"][data-value="Northern Ireland"]').click();
  const ni = Number(await box.locator('[data-cn-provider-count="osni"]').textContent());
  expect(ni).toBeLessThanOrEqual(count);
  await expect(pane(page).locator('.cn-row .cn-row__meta', { hasText: 'ROI' })).toHaveCount(0);
  // Kept with the other filters.
  expect(await page.evaluate(() => window.uiController._catalogueNext.filters.providers)).toEqual(['osni', 'cso']);
  await box.locator('[data-cn-act="clear-providers"]').click();
  expect(await page.evaluate(() => window.uiController._catalogueNext.filters.providers)).toEqual([]);
});

test('N45 the map\'s timeline: the date above, the catalogue category under it', async ({ page }) => {
  await open(page, 'layers=counties-ireland-1922');
  await expect(page.locator('#timelineSlider')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#timelineSublabel')).toHaveText('Counties');
  await expect(page.locator('#timelineLabel')).toHaveText(/^\d{4}$|\d{4}$/);
});

test('N46 the section names are Places and Historic at every width', async ({ page }) => {
  await open(page);
  const tabs = () => pane(page).locator('.cn-tab').evaluateAll((els) => els.filter((el) => el.offsetParent).map((el) => el.querySelector('.cn-tab__label')?.textContent));
  expect(await tabs()).toEqual(['Boundaries', 'Places', 'Statistics', 'Historic', 'Elections']);
  // A phone shows the same names under the icons: there is no shortened form to switch to.
  await expect(pane(page).locator('.cn-tab__short, .cn-tab__long')).toHaveCount(0);
  expect(await pane(page).locator('.cn-tab .cn-tab__label').allTextContents()).toEqual(['Boundaries', 'Places', 'Statistics', 'Historic', 'Elections']);
});

/* ------------------------------------------------------------------ Phelim Birch's review, 20 Nov 2026 */

test('N47 "+N" (other versions) marks the collapsed row only, not the opened row\'s lists', async ({ page }) => {
  await open(page);
  const base = lgd.members.find((m) => lgd.members.some((x) => x.of === m.id));
  const versions = lgd.members.filter((x) => x.of === base.id).length;
  await expect(row(page, LGD).locator(`:scope > .cn-chips [data-cn-toggle="${base.id}"] .cn-chip__more`)).toHaveText(`+${versions}`);
  await row(page, LGD).locator('[data-cn-expand]').click();
  await openPick(row(page, LGD), base.label);
  await expect(row(page, LGD).locator('.cn-sub', { hasText: 'Versions' })).toBeVisible();
  await expect(row(page, LGD).locator('.cn-panel .cn-chip__more')).toHaveCount(0);
});

test('N48 parts and county maps have no Details of their own; their Zoom and Download stay', async ({ page }) => {
  await open(page);
  const town = row(page, 'townlands-townlands');
  await town.scrollIntoViewIfNeeded();
  await town.locator('[data-cn-expand]').click();
  const parts = town.locator('.cn-sub', { hasText: 'Parts' });
  await expect(parts.locator('.cn-item')).toHaveCount(catalogue.maps['all-ireland-townlands'].parts.length);
  await expect(parts.locator('[data-cn-act="details"]')).toHaveCount(0);
  await expect(parts.locator('[data-cn-act="zoom"]').first()).toBeVisible();
  await expect(parts.locator('[data-cn-act="downloads"]').first()).toBeVisible();
  await expect(town.locator('.cn-sub', { hasText: 'By county' }).locator('[data-cn-act="details"]')).toHaveCount(0);
  // The map itself keeps its Details.
  await expect(town.locator('.cn-row__end [data-cn-act="details"]')).toHaveCount(1);
});

test('N49 an old address naming a part opens its map\'s details page', async ({ page }) => {
  // The details page covers the list, so this waits for it, not for the list (open()).
  await page.goto('/maps/#detail=townlands-cities-and-islands');
  await expect(page.locator('#catalogueDetailView')).toBeVisible({ timeout: 45000 });
  const parent = await page.evaluate(() => window.__civgraphTest2.app.currentDetailMapId);
  expect(parent).toBe('all-ireland-townlands');
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('detail'))).toBe('all-ireland-townlands');
  // A county map opens the map it is listed under in the catalogue.
  await page.evaluate(() => window.uiController.showCatalogueDetailView('cork-townlands'));
  expect(await page.evaluate(() => window.__civgraphTest2.app.currentDetailMapId)).toBe('all-ireland-townlands');
});

for (const [name, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 375, height: 812 }]]) {
  test(`N50 long names wrap in the opened row, their buttons in view (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (name === 'phone') {
      // A phone opens on the map: the catalogue is a button away. Shelves open as in open().
      await page.addInitScript((ids) => {
        const KEY = 'civgraph.catalogueNext.v2';
        if (!sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, JSON.stringify({ opened: ids }));
      }, SHELF_IDS);
      await page.goto('/maps/');
      await page.getByRole('button', { name: 'Open the catalogue' }).click({ timeout: 45000 });
      await expect(pane(page).locator('[data-cn-results]')).toBeVisible({ timeout: 45000 });
    } else await open(page);
    const town = row(page, 'townlands-townlands');
    await town.scrollIntoViewIfNeeded();
    await town.locator('[data-cn-expand]').click();
    const item = town.locator('.cn-item', { has: page.locator('[data-cn-toggle="townlands-cities-and-islands"]') });
    await expect(item).toBeVisible();
    const fit = await item.evaluate((el) => {
      const panel = /** @type {HTMLElement} */ (el.closest('.cn-panel')).getBoundingClientRect();
      const chip = /** @type {HTMLElement} */ (el.querySelector('.cn-chip')).getBoundingClientRect();
      const buttons = [...el.querySelectorAll('.cn-iconbtn')].map((b) => b.getBoundingClientRect());
      return {
        inside: [chip, ...buttons].every((r) => r.right <= panel.right + 0.5 && r.left >= panel.left - 0.5),
        buttons: buttons.length,
        centred: buttons.every((b) => Math.abs((b.top + b.bottom) / 2 - (chip.top + chip.bottom) / 2) < 2),
        label: /** @type {HTMLElement} */ (el.querySelector('.cn-chip__label')).scrollWidth <= /** @type {HTMLElement} */ (el.querySelector('.cn-chip__label')).clientWidth + 1,
      };
    });
    expect(fit).toEqual({ inside: true, buttons: 2, centred: true, label: true });
    // Nothing in the pane runs past its right edge.
    const over = await pane(page).evaluate((root) => {
      const edge = root.getBoundingClientRect().right + 0.5;
      return [...root.querySelectorAll('.cn-row__name, .cn-row__meta, .cn-row__credit, .cn-chip, .cn-iconbtn')]
        .filter((e) => /** @type {HTMLElement} */ (e).offsetParent && e.getBoundingClientRect().right > edge).length;
    });
    expect(over).toBe(0);
  });
}

test('N51 a map\'s Details page names it as the catalogue does, not as the old layer list did', async ({ page }) => {
  // Phelim Birch's review, owner-approved 20 Nov 2026: the page said "Ireland" (the old layer list's
  // name under its "Townlands" category) for the Townlands map.
  const town = catalogue.series.find((s) => s.id === 'townlands-townlands');
  const member = town.members.find((m) => m.id === 'all-ireland-townlands');
  const shelf = catalogue.shelves.find((s) => s.id === town.shelf);
  await open(page);
  await page.evaluate(() => window.uiController.showCatalogueDetailView('all-ireland-townlands'));
  const view = page.locator('#catalogueDetailView');
  await expect(view.locator('.catalogue-detail__name')).toHaveText(`${town.name}, ${member.label}`);
  // The row holds several maps, so the line ends with its name (N52).
  await expect(view.locator('.catalogue-detail__trail')).toHaveText(`Boundaries › ${shelf.name} › ${town.name}`);
  await expect(view.locator('.catalogue-detail__meta')).not.toContainText('Category');
  await expect(view.locator('.catalogue-detail__badge--group')).toHaveCount(0);
  // A map's parts go by the catalogue's names for them.
  await page.evaluate(() => window.uiController.showCatalogueDetailView('eds-2022'));
  const eds = catalogue.maps['eds-2022'];
  await expect(view.locator('.catalogue-detail__section-title', { hasText: 'Parts' })).toBeVisible();
  for (const p of eds.parts || []) await expect(view.locator('.catalogue-detail__variant', { hasText: p.label }).first()).toBeVisible();
  // An address naming a map draws its page before the catalogue has loaded, then again with its names.
  const roads = catalogue.series.find((s) => s.members.some((m) => m.id === 'dfi-surface-defects-2021'));
  const edition = roads.members.find((m) => m.id === 'dfi-surface-defects-2021');
  // A fresh load (about:blank first: a goto that changes only the hash does not reload the page).
  await page.goto('about:blank');
  await page.goto('/maps/#detail=dfi-surface-defects-2021');
  await expect(page.locator('#catalogueDetailView .catalogue-detail__name')).toHaveText(`${roads.name}, ${edition.label}`, { timeout: 45000 });
  await expect(page.locator('#catalogueDetailView .catalogue-detail__trail')).toHaveText(`Places › Transport › ${roads.name}`);
  await expect.poll(() => page.title()).toContain(`${roads.name}, ${edition.label}`);
});

/* ------------------------------------------------------------------ Phelim Birch's notes, 20 Nov 2026 (w20-ui2) */

const mapsIn = (s) => s.members.length + (s.local?.length || 0);

test('N52 the Details page\'s Section line ends with the row\'s name when the row holds several maps, and only then', async ({ page }) => {
  const counties = catalogue.series.find((s) => s.id === 'counties-counties');
  const shelf = catalogue.shelves.find((s) => s.id === counties.shelf);
  const single = catalogue.series.find((s) => s.id === 'census-statistics-median-age');
  expect(mapsIn(counties)).toBeGreaterThan(1);
  expect(mapsIn(single)).toBe(1);
  await open(page);
  const trail = page.locator('#catalogueDetailView .catalogue-detail__trail');
  await page.evaluate(() => window.uiController.showCatalogueDetailView('counties-ireland-1922'));
  await expect(trail).toHaveText(`Boundaries › ${shelf.name} › ${counties.name}`);
  // A row of one map: its name is the page's heading, not repeated on the line.
  await page.evaluate((id) => window.uiController.showCatalogueDetailView(id), single.members[0].id);
  await expect(page.locator('#catalogueDetailView .catalogue-detail__name')).toHaveText(single.name);
  await expect(trail).toHaveText('Statistics');
});

test('N53 a row\'s second line wraps word by word, each dot kept with the fact before it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript((ids) => {
    const KEY = 'civgraph.catalogueNext.v2';
    if (!sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, JSON.stringify({ opened: ids }));
  }, SHELF_IDS);
  await page.goto('/maps/');
  await page.getByRole('button', { name: 'Open the catalogue' }).click({ timeout: 45000 });
  const town = row(page, 'townlands-townlands');
  await town.scrollIntoViewIfNeeded();
  const facts = await town.locator('.cn-row__credit .cn-row__item').evaluateAll((items) => items.map((el) => ({
    display: getComputedStyle(el).display,
    text: el.textContent,
    lines: el.getClientRects().length,
  })));
  expect(facts.length).toBeGreaterThan(1);
  for (const f of facts) expect(f.display).toBe('inline');
  // Every fact but the last ends with its dot, joined by a no-break space.
  for (const f of facts.slice(0, -1)) expect(f.text.endsWith(' ·')).toBe(true);
  // At 375px the facts fill each line: one breaks across two lines rather than moving whole.
  expect(facts.some((f) => f.lines > 1)).toBe(true);
});

test('N54 a row of several maps keeps one strip of chips, open or closed, each map with its Zoom and Download', async ({ page }) => {
  // Phelim Birch chose the strip (25 Nov 2026, Option B), in place of the opened row's dated list.
  await open(page);
  const counties = catalogue.series.find((s) => s.id === 'counties-counties');
  const r = row(page, counties.id);
  const strip = r.locator(':scope > .cn-chips .cn-chip[data-cn-toggle]');
  await expect(strip.first()).toBeVisible();
  const closed = await strip.evaluateAll((els) => els.map((el) => el.getAttribute('data-cn-toggle')));
  // Each map on the strip: its chip, then its own Zoom and Download, as a map's parts have; no Details.
  const first = r.locator(':scope > .cn-chips > .cn-item').first();
  await expect(first.locator('.cn-chip[data-cn-toggle]')).toHaveCount(1);
  await expect(first.locator('[data-cn-act="zoom"]')).toHaveCount(1);
  await expect(first.locator('[data-cn-act="downloads"]')).toHaveCount(1);
  await expect(r.locator(':scope > .cn-chips [data-cn-act="details"]')).toHaveCount(0);
  await r.locator('[data-cn-expand]').click();
  // The same strip, the same maps, in the same order, once the row is open; no dated list.
  await expect(r.locator('.cn-dlist, .cn-dlist__item')).toHaveCount(0);
  expect(await strip.evaluateAll((els) => els.map((el) => el.getAttribute('data-cn-toggle')))).toEqual(closed);
  await expect(r.locator('.cn-panel .cn-picker')).toBeVisible();
  // A chip on the opened row's strip adds its map; its Zoom is there too.
  await r.locator(`:scope > .cn-chips [data-cn-toggle="${closed[1]}"]`).click();
  await expect.poll(() => loaded(page)).toContain(closed[1]);
  await expect(r.locator(`:scope > .cn-chips [data-cn-act="zoom"][data-map="${closed[1]}"]`)).toHaveCount(1);
  await r.locator('[data-cn-expand]').click();
  await expect(strip.first()).toBeVisible();
  // The switch for maps still to be added stays on an opened row, with the strip.
  const withTodo = catalogue.series.find((s) => s.id === 'electoral-divisions-district-electoral-divisions');
  const t = row(page, withTodo.id);
  await t.scrollIntoViewIfNeeded();
  await t.locator('[data-cn-expand]').click();
  await expect(t.locator(':scope > .cn-chips [data-cn-todo]')).toBeVisible();
  await expect(t.locator(':scope > .cn-chips .cn-chip[data-cn-toggle]').first()).toBeVisible();
});

test('N55 a map\'s own description shows in its row, as on its Details page; a map with none shows nothing', async ({ page }) => {
  await open(page);
  await pane(page).locator('[data-cn-tab="statistics"]').click();
  const description = (id) => page.evaluate((x) => window.uiController._catalogueNext.mapDescription(x), id);
  // The census statistics' own texts were AI-written and are gone (the 16 longer ones on 24 Nov, the
  // 69 template ones on 27 Nov 2026, owner-approved): none is left to show.
  const census = catalogue.series.filter((x) => /^census-statistics-/.test(x.id));
  expect(census.length).toBeGreaterThan(0);
  for (const s of census.slice(0, 20)) expect(await description(s.members[0].id)).toBe('');
  const one = row(page, census.find((x) => x.members.length === 1).id);
  await one.scrollIntoViewIfNeeded();
  await one.locator('[data-cn-expand]').click();
  await expect(one.locator('.cn-mapdesc')).toHaveCount(0);
  // The mechanism, with a description given to two maps of a row: the chosen map's shows under
  // "Details for", and only that one; choosing the other shows its own.
  const several = census.find((x) => x.members.filter((m) => !m.of).length > 1) || catalogue.series.find((x) => x.id === 'counties-counties');
  const [a, b] = several.members.filter((m) => !m.of);
  await page.evaluate(([ida, idb]) => {
    const c = window.uiController._catalogueNext;
    const texts = { [ida]: 'First test description.', [idb]: 'Second test description.' };
    c.mapDescription = (id) => texts[id] || '';
  }, [a.id, b.id]);
  if (!several.id.startsWith('census-statistics-')) await pane(page).locator('[data-cn-tab="boundaries"]').click();
  const r = row(page, several.id);
  await r.scrollIntoViewIfNeeded();
  await r.locator('[data-cn-expand]').click();
  await openPick(r, a.label);
  await expect(r.locator('.cn-panel .cn-mapdesc')).toHaveText('First test description.');
  await openPick(r, b.label);
  await expect(r.locator('.cn-panel .cn-mapdesc')).toHaveText('Second test description.');
  await expect(r.locator('.cn-mapdesc')).toHaveCount(1);
  // A map with no description of its own: no block, no placeholder.
  await page.goto('about:blank');
  await open(page);
  expect(await description('counties-ireland')).toBe('');
  const counties = row(page, 'counties-counties');
  await counties.scrollIntoViewIfNeeded();
  await counties.locator('[data-cn-expand]').click();
  await expect(counties.locator('.cn-picker')).toBeVisible();
  await expect(counties.locator('.cn-mapdesc')).toHaveCount(0);
});

test('N56 every chip, dot and Add button in a row takes the row\'s colour, on the map or off; the loaded-layers panel keeps the map\'s', async ({ page }) => {
  await open(page);
  const town = catalogue.series.find((s) => s.id === 'townlands-townlands');
  const r = row(page, town.id);
  await r.scrollIntoViewIfNeeded();
  await r.locator('[data-cn-expand]').click();
  const colours = () => r.locator('.cn-chip[data-cn-toggle], .cn-add').evaluateAll((els) => [...new Set(els.map((el) => el.style.getPropertyValue('--c').toLowerCase()))]);
  expect(await colours()).toEqual([town.color.toLowerCase()]);
  // Versions and council maps have colours of their own; their chips still take the row's.
  expect(catalogue.maps['osni-open-data-50k-boundaries-townlands'].color.toLowerCase()).not.toBe(town.color.toLowerCase());
  const local = town.local[0].id;
  await r.locator(`[data-cn-toggle="${local}"]`).first().click();
  await expect.poll(() => loaded(page)).toContain(local);
  const live = await page.evaluate((id) => window.mapController.getLayerColour(id), local);
  expect(live).toBeTruthy();
  expect(await colours()).toEqual([town.color.toLowerCase()]);
});

test('N57 an old address naming Townlands 1844 (in no row) opens the Townlands page; a map in no row names its parts as the catalogue does', async ({ page }) => {
  await page.goto('/maps/#detail=ni-townlands-1844');
  await expect(page.locator('#catalogueDetailView')).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.evaluate(() => window.__civgraphTest2.app.currentDetailMapId), { timeout: 45000 }).toBe('all-ireland-townlands');
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('detail'))).toBe('all-ireland-townlands');
  await expect(page.locator('#catalogueDetailView .catalogue-detail__name')).toHaveText('Townlands, All-island');
  // eds-roi-1921-06-28 is in no row: its parts go by the labels its map gives them, under "Parts".
  await page.evaluate(() => window.uiController.showCatalogueDetailView('eds-roi-1921-06-28'));
  const view = page.locator('#catalogueDetailView');
  await expect(view.locator('.catalogue-detail__section-title', { hasText: 'Parts (4)' })).toBeVisible();
  await expect(view.locator('.catalogue-detail__section-title', { hasText: 'Variants' })).toHaveCount(0);
  for (const label of ['Connacht', 'Leinster', 'Munster', 'Ulster (outside Northern Ireland)']) {
    await expect(view.locator('.catalogue-detail__variant', { hasText: label })).toHaveCount(1);
  }
});

test('N58 a hidden copy or version of a map opens that map\'s Details page; a referendum counted by constituency keeps its own', async ({ page }) => {
  // Owner, 21 Nov 2026 ("limit the redirect"): the referendums link to the constituency map
  // (mapLinks, for #layers=), but are another subject (ownDetails).
  expect(catalogue.ownDetails).toContain('eu-referendum-2016');
  expect(catalogue.mapLinks['eu-referendum-2016'].map).toBe('pc-2008');
  const detail = () => page.evaluate(() => window.__civgraphTest2.app.currentDetailMapId);
  const hashDetail = () => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('detail'));
  // Kept: Provinces 2019 is the 1955 map.
  await page.goto('/maps/#detail=provinces');
  await expect(page.locator('#catalogueDetailView')).toBeVisible({ timeout: 45000 });
  await expect.poll(detail, { timeout: 45000 }).toBe('provinces-1955');
  await expect.poll(hashDetail).toBe('provinces-1955');
  // Dropped: the EU referendum opens its own page and keeps its address, as before 20 Nov.
  await page.goto('about:blank');
  await page.goto('/maps/#detail=eu-referendum-2016');
  await expect(page.locator('#catalogueDetailView')).toBeVisible({ timeout: 45000 });
  await expect.poll(detail, { timeout: 45000 }).toBe('eu-referendum-2016');
  // Still its own once the catalogue has loaded and the holders are set.
  await expect.poll(() => page.evaluate(() => Boolean(window.uiController._catalogueNext?.data)), { timeout: 45000 }).toBe(true);
  await page.evaluate(() => window.uiController.showCatalogueDetailView('eu-referendum-2016'));
  await expect.poll(detail).toBe('eu-referendum-2016');
  await expect.poll(hashDetail).toBe('eu-referendum-2016');
  await expect(page.locator('#catalogueDetailView .catalogue-detail__name')).toContainText('Referendum');
});

/* ------------------------------------------------------------------ Phelim Birch's review, 26 Nov 2026 */

test('N59 the open map\'s button closes it again; another map\'s opens that one', async ({ page }) => {
  await open(page);
  await row(page, LGD).locator('[data-cn-expand]').click();
  const r = row(page, LGD);
  await openPick(r, '1985');
  await pickMore(r).click();
  await expect(pickMore(r)).toHaveAttribute('aria-expanded', 'false');
  await expect(r.locator('.cn-panel .cn-ed')).toHaveCount(0);
  await pickMore(r).click();
  await expect(pickMore(r)).toHaveAttribute('aria-expanded', 'true');
  await expect(r.locator('.cn-panel .cn-facts')).toContainText('1985');
  // Closed, then another map chosen: that one opens.
  await pickMore(r).click();
  await picker(r).selectOption({ label: '1993' });
  await expectPicked(r, '1993');
  await expect(r.locator('.cn-panel .cn-ed')).toHaveCount(1);
});

test('N60 the Details page: a one-map row\'s main map does not end its Section line with its own name; its council map does', async ({ page }) => {
  await open(page);
  const trail = page.locator('#catalogueDetailView .catalogue-detail__trail');
  await page.evaluate(() => window.uiController.showCatalogueDetailView('roi-municipal-districts-2019'));
  await expect(page.locator('#catalogueDetailView .catalogue-detail__name')).toHaveText('Municipal Districts');
  await expect(trail).not.toContainText('Municipal Districts');
  await page.evaluate(() => window.uiController.showCatalogueDetailView('oda-map-00639-municipal-district'));
  await expect(trail).toHaveText(/› Municipal Districts$/);
  // The label and its value do not run together.
  const gap = await page.locator('#catalogueDetailView .catalogue-detail__meta-row').first().evaluate((el) => getComputedStyle(el).columnGap);
  expect(parseFloat(gap)).toBeGreaterThan(0);
});

test("N61 the Details page's colour is the row's, as the catalogue shows it, not a map's older own colour", async ({ page }) => {
  const s = catalogue.series.find((x) => x.members.some((m) => m.id === 'local-authorities-1927'));
  expect(catalogue.maps['local-authorities-1927'].color.toLowerCase()).not.toBe(s.color.toLowerCase());
  await open(page);
  await page.evaluate(() => window.uiController.showCatalogueDetailView('local-authorities-1927'));
  const swatch = page.locator('#catalogueDetailView .catalogue-detail__color');
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  await expect.poll(async () => hex(await swatch.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(s.color.toLowerCase());
});

test('N62 leaving a Details page returns to its map\'s row, not the top of the catalogue', async ({ page }) => {
  await open(page);
  // The last row drawn, well down the list: its first map's page opened as the layer list opens it.
  const last = await pane(page).locator('[data-cn-series]').last().getAttribute('data-cn-series');
  const s = catalogue.series.find((x) => x.id === last);
  expect(s?.members?.length).toBeGreaterThan(0);
  await page.evaluate(() => { const p = document.querySelector('.pane__content[data-tab-content="catalogue"]'); if (p) p.scrollTop = 0; });
  await page.evaluate((id) => window.uiController.showCatalogueDetailView(id), s.members[0].id);
  await expect(page.locator('#catalogueDetailView')).toBeVisible();
  await page.locator('#catalogueBackLink').click();
  await expect(row(page, last)).toBeInViewport();
  await expect(row(page, last).locator('[data-cn-expand]')).toHaveAttribute('aria-expanded', 'true');
});

test('N63 adding a map leaves the view where it was (each layer has its own Zoom button)', async ({ page }) => {
  await open(page);
  const view = () => page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const c = map.getCenter();
    return [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4)), Number(map.getZoom().toFixed(2))];
  });
  const before = await view();
  const chip = row(page, LGD).locator(`.cn-chips [data-cn-toggle="${LGD_NEWEST}"]`);
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await expect.poll(() => loaded(page)).toContain(LGD_NEWEST);
  await page.waitForTimeout(600);
  expect(await view()).toEqual(before);
});

/* ------------------------------------------------------------------ Phelim Birch's reply, 25 Nov 2026 (Option B) */

test('N64 the opened row\'s previous and next buttons step to the maps either side on the strip', async ({ page }) => {
  await open(page);
  const r = row(page, LGD);
  await r.locator('[data-cn-expand]').click();
  const labels = await picker(r).locator('option').allTextContents();
  expect(labels.length).toBeGreaterThan(2);
  const prev = r.locator('.cn-picker [data-cn-step="prev"]');
  const next = r.locator('.cn-picker [data-cn-step="next"]');
  await openPick(r, labels[0]);
  // The first map has nothing before it.
  await expect(prev).toBeDisabled();
  await expect(next).toHaveAttribute('aria-label', `Next map: ${labels[1]}`);
  await next.click();
  await expectPicked(r, labels[1]);
  // The focus stays on the button, so the reader can step on.
  await expect(r.locator('.cn-picker [data-cn-step="next"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expectPicked(r, labels[2]);
  await prev.click();
  await expectPicked(r, labels[1]);
  // The last map has nothing after it.
  await openPick(r, labels[labels.length - 1]);
  await expect(next).toBeDisabled();
  await expect(prev).toHaveAttribute('aria-label', `Previous map: ${labels[labels.length - 2]}`);
  // Stepping does not add a map to the map.
  expect(await loaded(page)).not.toContain(lgd.members.find((m) => m.label === labels[1]).id);
});

test('N65 "Show N to be added" sits to the right of "+N more", on the strip\'s one line', async ({ page }) => {
  await open(page);
  const s = catalogue.series.find((x) => x.todo?.length && x.members.filter((m) => !m.of).length > 6);
  expect(s).toBeTruthy();
  const r = row(page, s.id);
  await r.scrollIntoViewIfNeeded();
  const more = r.locator(':scope > .cn-chips > [data-cn-more]');
  const todo = r.locator(':scope > .cn-chips > [data-cn-todo]');
  await expect(todo).toBeVisible();
  const order = await r.locator(':scope > .cn-chips').evaluate((box) => {
    const kids = [...box.children];
    const m = box.querySelector(':scope > [data-cn-more]');
    const t = box.querySelector(':scope > [data-cn-todo]');
    return { more: kids.indexOf(m), todo: kids.indexOf(t), last: kids.length - 1 };
  });
  expect(order.todo).toBe(order.last);
  expect(order.more).toBe(order.todo - 1);
  if (await more.isVisible()) {
    const [m, t] = [await more.boundingBox(), await todo.boundingBox()];
    expect(t.x).toBeGreaterThan(m.x);
    expect(Math.abs(t.y - m.y)).toBeLessThan(4);
  }
});
