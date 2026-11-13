// Acceptance test A5, "a new language needs only translation files": the page half. A dummy
// fourth language (tests/i18n/fixtures/new-language.json), added to copies of the registry and the
// string files and built by the unchanged scripts/i18n/build-i18n.mjs (new-language-fixture.mjs),
// is served in place of the committed language files: the unchanged runtime lists it, translates
// the page into it, writes its <html lang> and dir, and it and the shared formatter
// (packages/core/src/format.js) write its numbers and dates. The build half is
// tests/unit/i18n-new-language.test.mjs.
//   npx playwright test --config tests/i18n/playwright.config.cjs new-language
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('@playwright/test');

/** @type {string} */
let tree = '';
/** @type {{ code: string, entry: { name: string, bcp47: string, locale: string }, translations: Record<string, string> }} */
let NEW;

test.beforeAll(async () => {
  const fixture = await import(pathToFileURL(path.join(__dirname, 'new-language-fixture.mjs')).href);
  tree = fixture.buildNewLanguageTree();
  NEW = fixture.NEW_LANGUAGE;
});
test.afterAll(() => { if (tree) fs.rmSync(tree, { recursive: true, force: true }); });

const ready = (page) => page.waitForFunction(() => window.civgraphI18n && document.documentElement.dataset.uiLang);
const navLabels = (page) => page.locator('.app-header__nav .app-header__link span').allTextContents();
const DATE = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' };

// The fixture tree's built language files stand in for the committed ones; anything it did not
// build (place-name-fields.json, the runtime itself) comes from this checkout.
async function serveTree(page) {
  await page.route('**/assets/i18n/*.json*', (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop();
    const built = path.join(tree, 'site/assets/i18n', file);
    return fs.existsSync(built) ? route.fulfill({ path: built, contentType: 'application/json' }) : route.continue();
  });
}

async function previewOn(page) {
  await page.goto('/pages/about.html');
  await page.evaluate(() => localStorage.setItem('civgraph.langPreview', '1'));
}

test('A5: a fourth language from its files alone is listed, translates the page and sets its locale and direction', async ({ page }) => {
  await serveTree(page);
  await previewOn(page);
  await page.goto(`/pages/about.html?lang=${NEW.code}`);
  await ready(page);

  const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.getAttribute('dir'), ui: document.documentElement.dataset.uiLang }));
  expect(html).toEqual({ lang: NEW.entry.bcp47, dir: 'rtl', ui: NEW.code });
  const select = page.locator('[data-lang-switch] select');
  await expect(select).toHaveValue(NEW.code);
  expect(await select.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]))).toEqual([
    ['en', 'English'], ['ga', 'Gaeilge'], ['sco', 'Ulstèr-Scotch'], [NEW.code, NEW.entry.name]
  ]);
  expect(await navLabels(page)).toContain(NEW.translations.Maps);
  expect(await page.evaluate(() => window.civgraphI18n.t('chrome.language'))).toBe(NEW.translations.Language);

  // Its numbers and dates: the runtime's formatters and the shared formatter both follow its locale.
  const written = await page.evaluate(async (date) => {
    const f = await import('/pkg/core/src/format.js');
    const i = window.civgraphI18n;
    const d = new Date(Date.UTC(1969, 3, 1));
    return {
      locale: i.locale,
      runtime: i.formatNumber(1234567.5),
      shared: f.siteNumber(1234567.5),
      sharedDate: f.siteDate(d, date),
      intl: new Intl.NumberFormat(i.locale).format(1234567.5),
      intlDate: new Intl.DateTimeFormat(i.locale, date).format(d)
    };
  }, DATE);
  expect(written.locale).toBe(NEW.entry.locale);
  expect(written.runtime).toBe(written.intl);
  expect(written.shared).toBe(written.intl);
  expect(written.sharedDate).toBe(written.intlDate);
  expect(written.shared).not.toBe('1,234,567.5');

  // Back to English: the page's own lang and direction, English words and en-GB numbers.
  await page.evaluate(() => window.civgraphI18n.setLanguage('en'));
  const back = await page.evaluate(async () => {
    const f = await import('/pkg/core/src/format.js');
    return { lang: document.documentElement.lang, dir: document.documentElement.getAttribute('dir'), number: f.siteNumber(1234567.5) };
  });
  expect(back).toEqual({ lang: 'en-GB', dir: null, number: '1,234,567.5' });
  expect(await navLabels(page)).toContain('Maps');
});

test('in Irish a formatted date shows the Irish month, and reads English again back in English', async ({ page }) => {
  // The month the runtime shows: the language file's (it wins over Intl, which many browser builds
  // lack for Irish). Where the browser has Irish data the formatter writes it; where not, it
  // writes en-GB and the runtime translates it; the page shows the same either way.
  const ga = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'site/assets/i18n/ga.json'), 'utf8'));
  const month = ga.strings['months.short.3'];
  await previewOn(page);
  await page.goto('/pages/about.html?lang=ga');
  await ready(page);
  const written = await page.evaluate(async (date) => {
    const f = await import('/pkg/core/src/format.js');
    const el = document.createElement('p');
    el.id = 'a5-date';
    el.textContent = f.siteDate(new Date(Date.UTC(1969, 3, 1)), date);
    document.body.appendChild(el);
    return { text: el.textContent, irishData: Intl.DateTimeFormat.supportedLocalesOf(['ga-IE']).length > 0 };
  }, DATE);
  expect(written.text).toBe(written.irishData ? `01 ${month} 1969` : '01 Apr 1969');
  // What a browser with Irish data gets from the formatter, rendered directly whatever this one has.
  await page.evaluate((text) => {
    const el = document.createElement('p');
    el.id = 'a5-irish';
    el.textContent = `Held ${text}`;
    document.body.appendChild(el);
  }, `01 ${month} 1969`);
  await expect(page.locator('#a5-date')).toHaveText(`01 ${month} 1969`);
  await expect(page.locator('#a5-irish')).toHaveText(new RegExp(`01 ${month} 1969$`));
  await page.evaluate(() => window.civgraphI18n.setLanguage('en'));
  await expect(page.locator('#a5-date')).toHaveText('01 Apr 1969');
  await expect(page.locator('#a5-irish')).toHaveText('Held 01 Apr 1969');
});
