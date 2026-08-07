#!/usr/bin/env node
/**
 * Render the Open Graph preview image from the live site.
 *
 * index.html declares og:image and twitter:image pointing at
 * assets/images/og-preview.png, and that file did not exist -- so every link shared
 * anywhere rendered a blank card. A missing og:image degrades; one that 404s does not.
 *
 * The image is a screenshot of the site itself with a layer loaded, rather than
 * illustration. Two reasons: it shows what a visitor will actually get, and it is
 * reproducible, so it can be refreshed when the design changes instead of drifting into
 * a picture of a site that no longer exists.
 *
 * 1200x630 is the Open Graph standard; Twitter/X accepts the same for summary_large_image.
 *
 * Usage:
 *   node scripts/build-og-preview.mjs [--url https://civgraph.net/] [--layer eds-roi-1941]
 *   node scripts/build-og-preview.mjs --check     # verify the committed file only
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Resolve relative to this module. This previously hardcoded an absolute path
// to one developer's checkout, which resolves nowhere else -- so
// check:og-preview crashed with ERR_INVALID_ARG_VALUE on every CI runner
// before it could run at all.
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = path.resolve('assets/images/og-preview.png');
const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 1_000_000; // og:image should stay small enough to fetch eagerly

if (args.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`FAIL: ${path.relative(process.cwd(), OUT)} is missing, but index.html declares og:image.`);
    console.error('Rebuild it with: node scripts/build-og-preview.mjs');
    process.exit(1);
  }
  const bytes = statSync(OUT).size;
  console.log(`OG preview: ${path.relative(process.cwd(), OUT)}, ${(bytes / 1024).toFixed(0)} KB`);
  if (bytes > MAX_BYTES) {
    console.error(`FAIL: ${bytes} bytes exceeds the ${MAX_BYTES}-byte budget.`);
    process.exit(1);
  }
  console.log('PASS: the declared og:image exists and is within budget.');
  process.exit(0);
}

const URL_ = argVal('--url', 'https://civgraph.net/');
// A counties layer, deliberately. The first attempt used eds-roi-1941, whose ~4,000
// electoral divisions render as overlapping labels -- visual noise at the thumbnail size
// a social card is actually viewed at. Counties are recognisable and readable when small.
const LAYER = argVal('--layer', 'counties-ireland');

const { chromium } = require('playwright');
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 90000 });
  await page.waitForTimeout(2500);

  // Load a layer so the map is not empty. A blank basemap says nothing about the project.
  const loaded = await page.evaluate(async (layerId) => {
    const t = window.__civgraphTest2;
    try {
      await t.app.loadMap(layerId);
      await new Promise((r) => t.mapController.map.once('idle', r));
      return true;
    } catch {
      return false;
    }
  }, LAYER);
  if (!loaded) console.warn(`  (could not load ${LAYER}; capturing the default view instead)`);

  // Frame the island. Without this the map keeps whatever viewport it restored and
  // Ireland was cut off at the right edge -- the shape is the most recognisable thing in
  // the picture, so it has to be whole.
  await page.evaluate(async () => {
    const map = window.__civgraphTest2?.mapController?.map;
    if (!map) return;
    map.fitBounds([[-10.9, 51.3], [-5.3, 55.5]], { padding: 24, duration: 0 });
    await new Promise((r) => map.once('idle', r));
  });

  // Give the map a moment to finish painting labels after idle.
  await page.waitForTimeout(2500);

  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, type: 'png' });
  const bytes = statSync(OUT).size;
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${WIDTH}x${HEIGHT}, ${(bytes / 1024).toFixed(0)} KB)`);
  if (bytes > MAX_BYTES) console.warn(`  warning: ${bytes} bytes exceeds the ${MAX_BYTES}-byte budget`);
} finally {
  await browser.close();
}
