// The interface-language preview: English, Irish (Gaeilge) and Ulster-Scots (Ulstèr-Scotch).
// See data/i18n/README.md. The preview is off unless the reader has typed the language phrase into
// the Maps search box (src/catalogue/lang-reveal.js), which sets localStorage civgraph.langPreview.
const { test, expect } = require('@playwright/test');

const PHRASE = 'language toggle';
const navLabels = (page) => page.locator('.app-header__nav .app-header__link span').allTextContents();
const ready = (page) => page.waitForFunction(() => window.civgraphI18n && document.documentElement.dataset.uiLang);
const flags = (page) => page.evaluate(() => [localStorage.getItem('civgraph.langPreview'), localStorage.getItem('civgraph.lang')]);
const i18nRequests = (page) => {
  const urls = [];
  page.on('request', (r) => { if (r.url().includes('/assets/i18n/')) urls.push(r.url()); });
  return urls;
};

// The flag the phrase sets, set directly, for the tests of the control itself.
async function previewOn(page) {
  await page.goto('/pages/about.html');
  await page.evaluate(() => localStorage.setItem('civgraph.langPreview', '1'));
}

// The Maps page, with the catalogue drawn and its search box ready.
async function openMaps(page) {
  await page.goto('/maps/');
  await expect(page.locator('#catalogueFlatView [data-cn-root] [data-cn-results]')).toBeVisible({ timeout: 45000 });
}
async function typeSearch(page, q) {
  await page.locator('#searchInput').fill(q);
  await expect.poll(() => page.evaluate(() => window.uiController._catalogueNext?.query || '')).toBe(q.trim());
  await page.waitForTimeout(300);
}

test.describe('language preview flag off', () => {
  test('no toggle, no runtime and English, even with ?lang=ga', async ({ page }) => {
    const requests = i18nRequests(page);
    await page.goto('/pages/about.html?lang=ga');
    await expect(page.locator('.app-header__nav')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.civgraphI18n)).toBe('undefined');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en-GB');
    expect(await navLabels(page)).toContain('Maps');
    expect(requests).toEqual([]);
  });

  test('?lang-preview=1 no longer turns it on', async ({ page }) => {
    const requests = i18nRequests(page);
    await page.goto('/pages/about.html?lang-preview=1&lang=ga');
    await expect(page.locator('.app-header__nav')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.civgraphI18n)).toBe('undefined');
    expect(await flags(page)).toEqual([null, null]);
    expect(requests).toEqual([]);
  });

  test('?lang-preview=0 switches a previewing browser back off', async ({ page }) => {
    await previewOn(page);
    await page.goto('/pages/about.html?lang=ga');
    await ready(page);
    await page.goto('/pages/about.html?lang-preview=0');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(await flags(page)).toEqual([null, null]);
  });

  test('the default Maps page loads no language files', async ({ page }) => {
    const requests = i18nRequests(page);
    await openMaps(page);
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(await page.evaluate(() => typeof window.civgraphI18n)).toBe('undefined');
    expect(requests).toEqual([]);
  });
});

test.describe('the Maps search phrase', () => {
  test('typing the phrase shows the control, which then stays on every page', async ({ page }) => {
    const requests = i18nRequests(page);
    await openMaps(page);
    await typeSearch(page, ` ${PHRASE.toUpperCase()}. `);
    await expect(page.locator('[data-cn-lang-notice]')).toHaveText('Language options are now shown.');
    await expect(page.locator('#catalogueFlatView .cn-empty')).toHaveCount(0);
    await expect(page.locator('[data-lang-switch] select')).toBeVisible();
    expect(requests.some((u) => u.includes('/assets/i18n/i18n.js'))).toBe(true);
    expect(await flags(page)).toEqual(['1', null]);

    await page.goto('/pages/about.html');
    await ready(page);
    await expect(page.locator('[data-lang-switch] select')).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(page.locator('[data-lang-switch] select')).toBeVisible();
  });

  for (const q of ['language', 'toggle', 'irish', 'language toggles', 'toggle language', 'language toggle maps']) {
    test(`"${q}" does not show it`, async ({ page }) => {
      const requests = i18nRequests(page);
      await openMaps(page);
      await typeSearch(page, q);
      await page.waitForTimeout(500);
      await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
      await expect(page.locator('[data-cn-lang-notice]')).toHaveCount(0);
      expect(await flags(page)).toEqual([null, null]);
      expect(requests).toEqual([]);
    });
  }

  test('the phrase in the address (#q=) is not typing and shows nothing', async ({ page }) => {
    const requests = i18nRequests(page);
    await page.goto(`/maps/#q=${encodeURIComponent(PHRASE)}`);
    await expect(page.locator('#catalogueFlatView [data-cn-root] [data-cn-results]')).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(await flags(page)).toEqual([null, null]);
    expect(requests).toEqual([]);
  });

  test('Hide removes the control, returns the page to English and clears the flag', async ({ page }) => {
    await openMaps(page);
    await typeSearch(page, PHRASE);
    const select = page.locator('[data-lang-switch] select');
    await expect(select).toBeVisible();
    await select.selectOption('ga');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ga');
    await expect(page.locator('.app-header__nav')).toContainText('Léarscáileanna');

    await page.locator('[data-lang-switch] [data-lang-hide]').click();
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en'); // the Maps page's own
    await expect(page.locator('html')).not.toHaveAttribute('data-ui-lang', /./);
    await expect(page.locator('.app-header__nav')).toContainText('Maps');
    await expect(page).not.toHaveURL(/[?&]lang=/);
    expect(await flags(page)).toEqual([null, null]);
    // The phrase leaves the search box with it.
    await expect(page.locator('#searchInput')).toHaveValue('');
    await expect(page.locator('[data-cn-lang-notice]')).toHaveCount(0);

    // Typed again on the same page, it comes back.
    await typeSearch(page, PHRASE);
    await expect(page.locator('[data-lang-switch] select')).toBeVisible();
    await page.locator('[data-lang-switch] [data-lang-hide]').click();

    const requests = i18nRequests(page);
    await page.goto('/pages/about.html');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    expect(requests).toEqual([]);
  });

  test('a fresh browser does not see it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const requests = i18nRequests(page);
    for (const path of ['/maps/', '/pages/about.html', '/apps/']) {
      await page.goto(path);
      await page.waitForTimeout(800);
      await expect(page.locator('[data-lang-switch]')).toHaveCount(0);
    }
    expect(requests).toEqual([]);
    await context.close();
  });
});

test.describe('language preview flag on', () => {
  test.beforeEach(async ({ page }) => { await previewOn(page); });

  test('switching language changes interface strings and <html lang>', async ({ page }) => {
    await page.goto('/pages/about.html');
    await ready(page);
    const select = page.locator('[data-lang-switch] select');
    await expect(select).toBeVisible();
    expect(await navLabels(page)).toContain('Maps');

    await select.selectOption('ga');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ga');
    await expect(page.locator('.app-header__nav')).toContainText('Léarscáileanna');
    await expect(page.locator('h1')).toHaveText('Maidir le Civgraph');
    await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-label', 'Oscail an nascleanúint');

    await select.selectOption('sco');
    await expect(page.locator('html')).toHaveAttribute('lang', 'sco-ulster');
    await expect(page.locator('.app-header__nav')).toContainText('Hame');

    await select.selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
    expect(await navLabels(page)).toEqual(expect.arrayContaining(['Home', 'Maps', 'Browse', 'Apps', 'About']));
    await expect(page.locator('h1')).toHaveText('About Civgraph');
  });

  test('the choice persists across reloads and pages, and is in the address', async ({ page }) => {
    await page.goto('/pages/about.html');
    await ready(page);
    await page.locator('[data-lang-switch] select').selectOption('ga');
    await expect(page).toHaveURL(/[?&]lang=ga\b/);
    expect(await page.evaluate(() => localStorage.getItem('civgraph.lang'))).toBe('ga');

    await page.goto('/apps/');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ga');
    await expect(page.locator('.app-header__nav')).toContainText('Aipeanna');
    await expect(page.locator('[data-lang-switch] select')).toHaveValue('ga');

    await page.reload();
    await ready(page);
    await expect(page.locator('.app-header__nav')).toContainText('Brabhsáil');
  });

  test('a URL parameter selects the language for a shared link', async ({ page }) => {
    await page.goto('/pages/about.html?lang=sco');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sco-ulster');
    await expect(page.locator('[data-lang-switch] select')).toHaveValue('sco');
  });

  test('missing translations fall back to English', async ({ page }) => {
    await page.goto('/pages/about.html?lang=sco');
    await ready(page);
    // Ulster-Scots has "Hame" for Home but no form for Maps: Maps stays English.
    const labels = await navLabels(page);
    expect(labels).toContain('Hame');
    expect(labels).toContain('Maps');
    const out = await page.evaluate(() => ({
      keyed: window.civgraphI18n.t('chrome.languageDraftTitle'),
      unknown: window.civgraphI18n.t('no.such.key'),
      untranslated: window.civgraphI18n.translate('A string nobody has translated'),
      pattern: window.civgraphI18n.translate('12 maps')
    }));
    expect(out.keyed).toBe('Preview: the Irish and Ulster-Scots texts are drafts awaiting review');
    expect(out.unknown).toBe('no.such.key');
    expect(out.untranslated).toBe('A string nobody has translated');
    expect(out.pattern).toBe('12 maps');
  });

  test('Irish: counted phrases, dates and place-name fields', async ({ page }) => {
    await page.goto('/pages/about.html?lang=ga');
    await ready(page);
    const out = await page.evaluate(() => {
      const i = window.civgraphI18n;
      return {
        count: i.translate('12 maps'),
        noMatch: i.translate('Townland map'),
        date: i.translate('01 Apr 1969'),
        composite: i.translate('01 Nov 1957 · Phelim Birch · 32 Counties'),
        title: i.translate('2016 Irish general election'),
        field: i.placeNameField({ id: 'counties-ireland-vector-test' }),
        fieldByMap: i.placeNameField({ id: 'counties-ireland' }),
        none: i.placeNameField({ id: 'no-such-layer' }),
        number: i.formatNumber(1234567.5)
      };
    });
    expect(out.count).toBe('12 léarscáil');
    expect(out.noMatch).toBe('Townland map');
    expect(out.date).toBe('01 Aib 1969');
    expect(out.composite).toBe('01 Samh 1957 · Phelim Birch · 32 contae');
    expect(out.title).toBe('Olltoghchán na hÉireann 2016');
    expect(out.field).toBe('GAEILGE');
    expect(out.fieldByMap).toBe('GAEILGE');
    expect(out.none).toBeNull();
    expect(out.number).toBe('1,234,567.5');
  });

  test('English never uses an Irish place-name field', async ({ page }) => {
    await page.goto('/pages/about.html?lang=en');
    await ready(page);
    expect(await page.evaluate(() => window.civgraphI18n.placeNameField({ id: 'counties-ireland-vector-test' }))).toBeNull();
  });

  test('the map catalogue renders in Irish', async ({ page }) => {
    await page.goto('/maps/?lang=ga');
    await ready(page);
    await expect(page.locator('body')).toContainText('Tíreolaíochtaí Stairiúla', { timeout: 20000 });
    await expect(page.locator('body')).toContainText('Teorainneacha');
  });

  for (const path of ['/pages/about.html', '/maps/', '/apps/']) {
    test(`no horizontal scroll at 375px in Irish: ${path}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await previewOn(page);
      await page.goto(`${path}?lang=ga`);
      await ready(page);
      await page.waitForTimeout(1500);
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(widths[0]).toBeLessThanOrEqual(widths[1]);
      await page.locator('.mobile-menu-toggle').click();
      await expect(page.locator('[data-lang-switch] select')).toBeVisible();
      await expect(page.locator('[data-lang-switch]')).toBeInViewport({ ratio: 1 });
      await page.waitForTimeout(800); // the menu slides in
      const box = await page.locator('[data-lang-switch]').boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(375);
      await context.close();
    });
  }
});
