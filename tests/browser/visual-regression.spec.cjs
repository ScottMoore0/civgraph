/**
 * Visual regression: every gallery specimen and the top of the key pages, compared pixel for
 * pixel with committed baselines, at a phone width and a desktop width, in light and dark.
 *
 * The shell spec (site-shell.spec.cjs) checks the shell's behaviour and saves screenshots for a
 * person to look at; this one fails when a pixel moves. It is the evidence for "a restyle touches
 * only tokens" (acceptance test A4): a token edit changes exactly the snapshots that show it, and a
 * refactor that should change nothing changes none.
 *
 * What is held:
 *   - /design-system/ (packages/ui/src/gallery/route.js, the Function's own render, served at its
 *     path as in site-shell.spec.cjs): each specimen's example box (the shared components and the
 *     apps' own: Elections charts, PRONI record, Browse), the type section and the token table, one
 *     snapshot each, so a failure names the component;
 *   - the first screen of pages whose content does not follow the data: home (its live counts and
 *     the constellation's moving signals masked), about, apps, PRONI Search before a search, 404.
 *     Pages drawn from records (Browse, the Elections app, status) would change with every data
 *     landing; their components are held through their gallery specimens instead.
 *
 * Kept steady: animations and transitions off and the caret hidden (toHaveScreenshot's own
 * `animations: 'disabled'`, `caret: 'hide'`), reduced motion asked for, the self-hosted web fonts
 * loaded before the shot (document.fonts.ready, so no fallback-font frame is caught), and no
 * request leaves the test server (external hosts answer 404: nothing on these screens needs one).
 *
 * Baselines are per platform, because font rasterising differs between operating systems:
 * tests/browser/visual-regression.spec.cjs-snapshots/<name>-<platform>.png. They were made on
 * win32, where the site is built and landed. A platform with no baseline for a snapshot SKIPS it
 * (with a note) rather than failing, so a Linux CI run is never red for want of one; make that
 * platform's set with --update-snapshots and commit it to start holding it there.
 *
 *   npx playwright test --config config/playwright.config.cjs tests/browser/visual-regression.spec.cjs
 *   ... --update-snapshots    (after an intended visual change: review the diffs first)
 *
 * Map-app components (legend, results tables, trend chart, timeline) and the STV count viewer join
 * the gallery's APP_SPECIMENS, and so this spec, after rf9-mapapp's F2 move (REFACTOR-PLAN.md G-5);
 * nothing here needs changing for them.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const SIZES = [{ width: 375, height: 812 }, { width: 1280, height: 900 }];
const THEMES = ['light', 'dark'];
// Any colour difference counts (threshold 0: a one-step change of a token is caught), and up to
// 0.05% of a shot's pixels may differ, for anti-aliasing noise. Same machine, same Chromium: a real
// change moves hundreds of pixels; three runs in a row on win32 differed by none.
const COMPARE = { animations: 'disabled', caret: 'hide', scale: 'css', threshold: 0, maxDiffPixelRatio: 0.0005 };

// For a component's own shot: the shell header stays in its place in the flow instead of sticking
// over whatever the shot scrolled under it (layout unchanged: sticky keeps its space).
const UNSTICK = path.join(__dirname, 'fixtures', 'visual-unstick.css');

const PAGES = [
  { name: 'home', url: '/', mask: ['.stat__n', '[data-stat]', '.constellation__signals'] },
  { name: 'about', url: '/pages/about.html' },
  { name: 'apps', url: '/apps/' },
  { name: 'proni-search', url: '/apps/proni-search/' },
  { name: '404', url: '/404.html' },
];

/** The snapshot file for `name` on this platform (Playwright's default path template). */
function baselineOf(name) {
  return path.join(__dirname, `${path.basename(__filename)}-snapshots`, `${name}-${process.platform}.png`);
}

/** Skip, with a note, when this platform has no baseline and the run is not making them. */
function needBaseline(name) {
  const mode = test.info().config.updateSnapshots;
  if (mode === 'all' || mode === 'changed' || process.env.VISUAL_UPDATE === '1') return;
  test.skip(!fs.existsSync(baselineOf(name)), `no ${process.platform} baseline for ${name}: run with --update-snapshots to make one`);
}

async function open(browser, size, theme) {
  const context = await browser.newContext({ viewport: size, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch (e) { /* private mode */ } }, theme);
  const page = await context.newPage();
  // Nothing outside the test server: a third-party answer must not decide a pixel.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.fulfill({ status: 404, body: '' }));
  return { context, page };
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready.then(() => document.fonts.status));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

let gallery;
async function galleryHtml() {
  if (!gallery) {
    const route = await import(pathToFileURL(path.join(ROOT, 'packages', 'ui', 'src', 'gallery', 'route.js')).href);
    gallery = { body: await (await route.onRequestGet()).text(), ids: [...route.SPECIMENS, ...(route.APP_SPECIMENS || [])].map((s) => s.id) };
  }
  return gallery;
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`gallery ${size.width}px ${theme}: every specimen matches its baseline`, async ({ browser }) => {
      const { body, ids } = await galleryHtml();
      const { context, page } = await open(browser, size, theme);
      await page.route('**/design-system/', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }));
      await page.goto('/design-system/', { waitUntil: 'load' });
      await expect(page.locator('#cg-gallery-tokens table').first()).toBeVisible();
      // The apps' components draw themselves into shadow roots (gallery.js drawIslands).
      await expect(page.locator('[data-gallery-island]:not([data-ready="true"])')).toHaveCount(0);
      await settle(page);
      const shots = [
        ['tokens', '#cg-gallery-tokens'],
        ['type', '#type'],
        ...ids.map((id) => [id, `#${id} .cg-gallery__example`]),
      ];
      let held = 0;
      for (const [id, selector] of shots) {
        const name = `gallery-${id}-${size.width}-${theme}`;
        const mode = test.info().config.updateSnapshots;
        if (!fs.existsSync(baselineOf(name)) && mode !== 'all' && mode !== 'changed' && process.env.VISUAL_UPDATE !== '1') {
          test.info().annotations.push({ type: 'skipped', description: `no ${process.platform} baseline for ${name}` });
          continue;
        }
        await expect.soft(page.locator(selector), name).toHaveScreenshot(`${name}.png`, { ...COMPARE, stylePath: UNSTICK });
        held += 1;
      }
      test.skip(held === 0, `no ${process.platform} baselines for the gallery`);
      await context.close();
    });

    for (const pageDef of PAGES) {
      const name = `page-${pageDef.name}-${size.width}-${theme}`;
      test(`${pageDef.name} ${size.width}px ${theme}: first screen matches its baseline`, async ({ browser }) => {
        needBaseline(name);
        const { context, page } = await open(browser, size, theme);
        await page.goto(pageDef.url, { waitUntil: 'load' });
        await expect(page.locator('header.app-header')).toBeVisible();
        await settle(page);
        await expect(page).toHaveScreenshot(`${name}.png`, {
          ...COMPARE,
          mask: (pageDef.mask || []).map((s) => page.locator(s)),
        });
        await context.close();
      });
    }
  }
}
