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

const pane = (page) => page.locator('#catalogueFlatView [data-cn-root]');
const row = (page, id) => pane(page).locator(`[data-cn-series="${id}"]`);
const menuItem = (page, text) => page.locator('.cn-menu [role="menuitem"]', { hasText: text });
const route = (page) => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('cat'));
const loaded = (page) => page.evaluate(() => window.__civgraphTest2.app.getLoadedLayerIds());

async function open(page, hash = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
  await expect(pane(page).locator('.cn-row')).toHaveCount(catalogue.series.length);
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
  await expect(row(page, LGD).locator('.cn-sub', { hasText: 'Other versions' })).toContainText('OSNI 50k');
  const town = row(page, 'townlands-townlands');
  await town.scrollIntoViewIfNeeded();
  await town.locator('[data-cn-expand]').click();
  await town.locator('[data-cn-select="townlands-townlands|ni-townlands-1844"]').click();
  await expect(town.locator('.cn-sub', { hasText: 'Parts' })).toContainText('Antrim');
});

test('N12 a hidden map is left out and its parts stand as maps of their own', async ({ page }) => {
  await open(page);
  const town = row(page, 'townlands-townlands');
  await expect(town.locator('.cn-chips [data-cn-toggle="ni-townlands"]')).toContainText('Northern Ireland');
  await expect(town.locator('.cn-chips [data-cn-toggle="roi-townlands"]')).toContainText('Republic of Ireland');
  await expect(pane(page).locator('[data-cn-toggle="all-ireland-townlands"]')).toHaveCount(0);
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
  await expect(row(page, 'census-small-areas--ni').locator('.cn-row__meta')).toContainText(/\d,\d{3} /);
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
  await expect(toggles).toHaveCount(catalogue.series.filter((s) => s.todo?.length).length);
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
  await open(page);
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

test('C14 elections by decade, with thumbnails, open in one click and link to their results', async ({ page }) => {
  await open(page, 'cat=elections');
  const first = pane(page).locator('.cn-erow').first();
  await expect(first.locator('.catalogue-flat__toc-thumbwrap')).toHaveCount(1);
  await expect.poll(() => first.locator('img.catalogue-flat__toc-thumb').evaluate((img) => img.naturalWidth > 1)).toBe(true);
  await expect(first.locator('a.cn-iconbtn')).toHaveAttribute('href', /^\/browse\/#\/elections\/[a-z0-9-]+$/);
  await expect(pane(page).locator('.cn-decade__head').first()).toHaveText(/\d{3}0s/);
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

test('C20 the Tables tab opens', async ({ page }) => {
  await open(page);
  await pane(page).locator('[data-cn-act="tables"]').click();
  await expect(page.locator('.pane-tab-content[data-tab-content="tables"]')).not.toHaveClass(/pane-tab-content--hidden/);
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

test('C23 the section bar is the current one, with Maps first', async ({ page }) => {
  await open(page);
  const tabs = pane(page).locator('.catalogue-flat__sections .catalogue-flat__section-tab');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.first()).toContainText('Maps');
  await expect(tabs.first()).toHaveAttribute('aria-current', 'true');
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
  await expect(pane(page).locator('[data-cn-filter="kind"]')).toHaveText(['Boundaries', 'Places & routes', 'Statistics']);
  const data = pane(page).locator('[data-cn-filter="kind"][data-value="Places"]');
  await data.click();
  expect(await pane(page).locator('.cn-row').count()).toBeLessThan(all);
  await data.click();
  await expect(data).toHaveAttribute('aria-pressed', 'false');
  await expect(pane(page).locator('.cn-row')).toHaveCount(all);
  const from = pane(page).locator('[data-cn-range="from"][data-key="maps"]');
  await from.focus();
  await page.keyboard.press('End');
  await expect(pane(page).locator('[data-cn-years-out]')).toContainText('2020');
  await expect.poll(() => pane(page).locator('.cn-row').count()).toBeLessThan(all);
  // A map with no date is taken to cover all time, so it stays whatever years are chosen.
  await expect(row(page, 'civil-parishes-civil-parishes')).toHaveCount(1);
  await expect(row(page, 'civil-parishes-baronies')).toHaveCount(1);
  await pane(page).locator('[data-cn-act="years-reset"]').click();
  await expect(pane(page).locator('.cn-row')).toHaveCount(all);
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
  await row(page, LGD).locator('.cn-tick[aria-label="1984"]').click();
  await expect(row(page, LGD).locator('.cn-tick[aria-label="1984"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, LGD).locator('.cn-ed__title')).toHaveCount(0);
  await expect.poll(() => route(page)).toMatch(new RegExp(`^series/${LGD}/`));
});

test('N07 with the switch off the current catalogue is unchanged', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'CIVGRAPH_CATALOGUE', { value: 'current', writable: false }); });
  await page.goto('/maps/');
  await expect(page.locator('#catalogueFlatView .catalogue-flat__sections')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#catalogueFlatView')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('[data-cn-root]')).toHaveCount(0);
});

test('N08 elections: grouped bodies, and where they were held', async ({ page }) => {
  await open(page, 'cat=elections');
  const devolved = ['northern-ireland-assembly', 'parliament-of-northern-ireland', 'northern-ireland-constitutional-convention', 'northern-ireland-forum-for-political-dialogue'];
  const chip = pane(page).locator('[data-cn-filter="body"][data-value="ni-devolved"]');
  await expect(chip).toContainText('NI Devolved');
  await chip.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(catalogue.elections.filter((e) => devolved.includes(e.bodySlug)).length);
  await expect.poll(() => route(page)).toBe('elections/ni-devolved');
  await pane(page).locator('[data-cn-filter="body"][data-value=""]').click();
  await expect(pane(page).locator('[data-cn-filter="body"]')).toHaveCount(9);
  const ni = pane(page).locator('[data-cn-filter="escope"][data-value="Northern Ireland"]');
  await ni.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(catalogue.elections.filter((e) => e.scope === 'Northern Ireland').length);
  await ni.click();
  await expect(pane(page).locator('.cn-erow')).toHaveCount(catalogue.elections.length);
  await expect(pane(page).locator('.cn-jump, .cn-hist')).toHaveCount(0);
});

test('N09 rows put their details beside the name; no blurbs, no histogram', async ({ page }) => {
  await open(page);
  const r = row(page, 'civil-parishes-baronies');
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
  await pane(page).locator('[data-cn-act="tables"]').click();
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
  await expect(pane(page).locator('.cn-erow')).toHaveCount(catalogue.elections.length);
  await expect.poll(() => route(page)).toBe('elections');
});
