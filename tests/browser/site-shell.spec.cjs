/**
 * One site shell on every page type: the shared header, footer, skip link and token layer
 * (packages/ui/src/templates/shell.js, assets/ui/), in light and dark, at a phone width and a
 * desktop width.
 *
 * For each page, viewport and theme it checks that
 *   - the theme the reader chose is on <html data-theme> and the token set answers for it;
 *   - the header is there, and (except on the map app, which has its own pair) the shell's
 *     skip link is the first focusable element and shows on screen when focused;
 *   - the footer is there (the map app has none, by design);
 *   - a header link shows a focus ring when reached by keyboard;
 *   - with reduced motion asked for, the chrome's transitions are switched off;
 * and saves a screenshot to test-results/site-shell/<page>-<width>-<theme>.png for review
 * (before/after sets for a change go next to its notes, not into the repository).
 *
 *   npx playwright test --config config/playwright.config.cjs tests/browser/site-shell.spec.cjs
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const PAGES = [
  { name: 'home', url: '/' },
  { name: 'about', url: '/pages/about.html' },
  { name: 'status', url: '/pages/status.html' },
  { name: 'api', url: '/pages/api.html' },
  { name: 'privacy', url: '/pages/privacy.html' },
  { name: 'licence', url: '/pages/licence.html' },
  { name: 'cite', url: '/pages/cite.html' },
  { name: 'downloads', url: '/pages/downloads.html' },
  { name: 'apps', url: '/apps/' },
  { name: 'words', url: '/apps/words/' },
  { name: 'census-explorer', url: '/pages/census-explorer.html' },
  { name: 'browse', url: '/browse/' },
  { name: 'records', url: '/records/' },
  { name: 'catalogue', url: '/catalogue/' },
  { name: 'proni-search', url: '/apps/proni-search/' },
  { name: '404', url: '/404.html' },
  { name: 'maps', url: '/maps/', app: true },
];
const SIZES = [{ width: 375, height: 812 }, { width: 1280, height: 900 }];
// The token values the shell layer sets for each theme (assets/ui/tokens.css).
const EXPECT = {
  light: { focusRing: '#2c5282', chromeBase: '#065a6e' },
  dark: { focusRing: '#a8c6ea', chromeBase: '#065a6e' },
};
const OUT = path.join(__dirname, '..', '..', 'test-results', 'site-shell');

for (const pageDef of PAGES) {
  for (const size of SIZES) {
    for (const theme of ['light', 'dark']) {
      test(`${pageDef.name} ${size.width}px ${theme}: shared shell`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: size, colorScheme: theme, reducedMotion: 'reduce' });
        await context.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ } }, theme);
        const page = await context.newPage();
        await page.goto(pageDef.url, { waitUntil: 'load' });
        await expect(page.locator('header.app-header')).toBeVisible();

        const tokens = await page.evaluate(() => {
          const css = getComputedStyle(document.documentElement);
          return {
            theme: document.documentElement.dataset.theme,
            focusRing: css.getPropertyValue('--focus-ring').trim(),
            chromeBase: css.getPropertyValue('--chrome-base').trim(),
          };
        });
        expect(tokens.theme).toBe(theme);
        expect(tokens.focusRing).toBe(EXPECT[theme].focusRing);
        expect(tokens.chromeBase).toBe(EXPECT[theme].chromeBase);

        if (pageDef.app) {
          await expect(page.locator('.cg-skip-link')).toHaveCount(0);
        } else {
          await expect(page.locator('.cg-skip-link[href="#main-content"]')).toHaveCount(1);
          await expect(page.locator('footer.ftr')).toHaveCount(1);
          // The skip link is the first focusable thing on the page (PRONI Search then puts the
          // cursor in its search box, so this is checked in document order, not by pressing Tab).
          const first = await page.evaluate(() => {
            const el = document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
            return el && el.matches('.cg-skip-link[href="#main-content"]');
          });
          expect(first).toBe(true);
          const skip = page.locator('.cg-skip-link[href="#main-content"]');
          await skip.focus();
          await expect(skip).toBeFocused();
          // On focus it slides into view (one frame, even with motion reduced).
          await expect.poll(async () => {
            const box = await skip.boundingBox();
            return Boolean(box && box.y >= 0 && box.y + box.height <= size.height);
          }).toBe(true);
          expect(await page.locator('main#main-content').count()).toBe(1);
        }

        // Keyboard focus on a header control shows a ring.
        const control = size.width >= 1000
          ? page.locator('.app-header__link').first()
          : page.locator('.mobile-menu-toggle');
        await control.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const outline = await page.evaluate(() => {
          const el = document.activeElement;
          const s = el && getComputedStyle(el);
          return s ? { style: s.outlineStyle, width: parseFloat(s.outlineWidth) } : null;
        });
        expect(outline && outline.style !== 'none' && outline.width > 0).toBeTruthy();

        // Reduced motion: the base layer switches transitions off.
        const duration = await page.evaluate(() => {
          const el = document.querySelector('.app-header__link') || document.querySelector('.mobile-menu-toggle');
          return parseFloat(getComputedStyle(el).transitionDuration);
        });
        expect(duration).toBeLessThan(0.01);

        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `${pageDef.name}-${size.width}-${theme}.png`) });
        await context.close();
      });
    }
  }
}

/*
 * The component gallery (/design-system/, functions/design-system/index.js: REFACTOR-PLAN.md
 * G-3) at the same widths and themes: every token and component on the one page, so this is the
 * visual check of the whole component set (screenshots to test-results/site-shell/design-system-*)
 * and its accessibility check (axe, WCAG 2 A and AA). The static test server does not run Pages
 * Functions, so the page is the Function's own render, served at its path.
 */
for (const size of SIZES) {
  for (const theme of ['light', 'dark']) {
    test(`design-system ${size.width}px ${theme}: gallery renders and passes axe`, async ({ browser }) => {
      const { pathToFileURL } = require('url');
      const gallery = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'ui', 'src', 'gallery', 'route.js')).href);
      const body = await (await gallery.onRequestGet()).text();
      const context = await browser.newContext({ viewport: size, colorScheme: theme, reducedMotion: 'reduce' });
      await context.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ } }, theme);
      const page = await context.newPage();
      await page.route('**/design-system/', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
      await page.goto('/design-system/', { waitUntil: 'load' });
      await expect(page.locator('header.app-header')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      expect(await page.locator('main#main-content').count()).toBe(1);
      // Wide content scrolls inside its own box, never the page.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      const AxeBuilder = require('@axe-core/playwright').default;
      const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
      const found = results.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')})`);
      expect(found).toEqual([]);

      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `design-system-${size.width}-${theme}.png`), fullPage: true });
      await context.close();
    });
  }
}
