#!/usr/bin/env node
/**
 * Render the Open Graph preview image: the picture a pasted Civgraph link shows.
 *
 * index.html declares og:image and twitter:image pointing at
 * assets/images/og-preview.png, and that file did not exist -- so every link shared
 * anywhere rendered a blank card. A missing og:image degrades; one that 404s does not.
 * Every page now declares it (packages/ui/src/templates/share.js, SHARE_IMAGE).
 *
 * THE CARD
 *
 * Until 11 Nov 2026 the image was a screenshot of the whole map page, and it went stale with
 * the page: it said "795 maps" and showed a header without the Maps item long after both had
 * changed (QA 2026-11-11, M3). The card now carries no figures and no interface: the brand
 * (logo, name, the strapline) on the header's gradient, beside the map of Ireland drawn by the
 * site itself with a layer loaded. Nothing on it can go out of date but the map's look.
 *
 * 1200x630 is the Open Graph standard; X accepts the same for summary_large_image.
 *
 * Usage:
 *   node scripts/build/og-preview.mjs                     # map captured from the live /maps/
 *   node scripts/build/og-preview.mjs --map map.png       # compose around a map image already made
 *   node scripts/build/og-preview.mjs [--url https://civgraph.net/maps/] [--layer counties-ireland]
 *   node scripts/build/og-preview.mjs --check             # verify the committed file only
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SITE } from '../../packages/config/src/node.mjs';

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

const OUT = path.resolve('site/assets/images/og-preview.png');
const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 1_000_000; // og:image should stay small enough to fetch eagerly

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

if (args.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error(`FAIL: ${path.relative(process.cwd(), OUT)} is missing, but every page declares og:image.`);
    console.error('Rebuild it with: node scripts/build/og-preview.mjs');
    process.exit(1);
  }
  const bytes = statSync(OUT).size;
  const size = pngSize(OUT);
  console.log(`OG preview: ${path.relative(process.cwd(), OUT)}, ${size ? `${size.width}x${size.height}, ` : ''}${(bytes / 1024).toFixed(0)} KB`);
  if (bytes > MAX_BYTES) {
    console.error(`FAIL: ${bytes} bytes exceeds the ${MAX_BYTES}-byte budget.`);
    process.exit(1);
  }
  // The pages declare og:image:width 1200 and og:image:height 630; the file must be that size.
  if (!size || size.width !== WIDTH || size.height !== HEIGHT) {
    console.error(`FAIL: the image must be ${WIDTH}x${HEIGHT}, as og:image:width and og:image:height declare.`);
    process.exit(1);
  }
  console.log('PASS: the declared og:image exists, is 1200x630 and is within budget.');
  process.exit(0);
}

// /maps/, not /: the interactive map moved there when the landing page took the root.
const URL_ = argVal('--url', `${SITE.origin}/maps/`);
// A counties layer, deliberately. The first attempt used eds-roi-1941, whose ~4,000
// electoral divisions render as overlapping labels -- visual noise at the thumbnail size
// a social card is actually viewed at. Counties are recognisable and readable when small.
const LAYER = argVal('--layer', 'counties-ireland');
const MAP_IMAGE = argVal('--map', '');

const { chromium } = require('playwright');
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

/** The map of Ireland as drawn by the site, without its controls: a PNG buffer. */
async function captureMap() {
  const page = await browser.newPage({ viewport: { width: 720, height: 760 }, deviceScaleFactor: 1 });
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.app, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
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
  // Frame the island: its shape is the most recognisable thing in the picture.
  const rect = await page.evaluate(async () => {
    const map = window.__civgraphTest2?.mapController?.map;
    if (!map) return null;
    map.fitBounds([[-10.9, 51.3], [-5.3, 55.5]], { padding: 16, duration: 0 });
    await new Promise((r) => map.once('idle', r));
    // Only the map and its labels: every control, hint and the attribution box go (the card
    // credits OpenStreetMap itself). visibility, not display, so nothing reflows.
    const style = document.createElement('style');
    style.textContent = 'body * { visibility: hidden !important; } '
      + '.maplibregl-canvas-container, .maplibregl-canvas-container *, .maplibregl-marker, .maplibregl-marker * { visibility: visible !important; }';
    document.head.appendChild(style);
    const box = map.getCanvas().getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.waitForTimeout(2500);
  const shot = await page.screenshot({ type: 'png', ...(rect ? { clip: rect } : {}) });
  await page.close();
  return shot;
}

const FONT = (file) => `data:font/woff2;base64,${readFileSync(path.resolve('site/assets/fonts', file)).toString('base64')}`;
const LOGO = readFileSync(path.resolve('site/assets/images/civgraph-logo-icon.svg'), 'utf8');

/** The card's HTML around the map image. No figures on it: nothing to go stale. */
function cardHtml(mapDataUrl) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Jakarta; src: url(${FONT('plus-jakarta-sans-latin.woff2')}) format('woff2'); font-weight: 200 800; }
@font-face { font-family: Inter; src: url(${FONT('inter-latin.woff2')}) format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
body {
  background: #065a6e;
  background-image:
    radial-gradient(circle at 0% 50%, #0fa55a 0%, transparent 50%),
    radial-gradient(circle at 100% 50%, #003870 0%, transparent 50%),
    radial-gradient(circle at 40% 100%, #0a7a78 0%, transparent 60%);
  color: #fff; font-family: Inter, sans-serif; display: flex; align-items: stretch;
}
.text { flex: 0 0 590px; padding: 64px 0 56px 64px; box-sizing: border-box; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 20px; }
.brand svg { width: 84px; height: 102px; }
.brand span { font-family: Jakarta, sans-serif; font-weight: 800; font-size: 76px; letter-spacing: -1.5px; }
h1 { font-family: Jakarta, sans-serif; font-weight: 700; font-size: 46px; line-height: 1.12; margin: 44px 0 0; letter-spacing: -0.5px; }
p { font-size: 25px; line-height: 1.4; margin: 22px 0 0; color: rgba(255,255,255,.9); max-width: 470px; }
.url { margin-top: auto; font-size: 24px; font-weight: 600; color: rgba(255,255,255,.85); }
.map { flex: 1; margin: 34px 34px 34px 0; border-radius: 22px; overflow: hidden; position: relative;
  box-shadow: 0 18px 48px rgba(0,0,0,.35); background: #aad3df; }
.map img { width: 100%; height: 100%; object-fit: cover; display: block; }
.credit { position: absolute; right: 10px; bottom: 8px; font-size: 13px; color: #333; background: rgba(255,255,255,.8); padding: 2px 7px; border-radius: 6px; }
</style></head><body>
<div class="text">
  <div class="brand">${LOGO.replace(/aria-hidden="true"/, 'aria-hidden="true" preserveAspectRatio="xMidYMid meet"')}<span>Civgraph</span></div>
  <h1>The civic record of Ireland</h1>
  <p>Elections, censuses, boundaries and archives, linked together and published openly.</p>
  <div class="url">civgraph.net</div>
</div>
<div class="map"><img src="${mapDataUrl}" alt=""><span class="credit">Map data © OpenStreetMap contributors</span></div>
</body></html>`;
}

try {
  const map = MAP_IMAGE ? readFileSync(path.resolve(MAP_IMAGE)) : await captureMap();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(cardHtml(`data:image/png;base64,${map.toString('base64')}`), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  mkdirSync(path.dirname(OUT), { recursive: true });
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(OUT, png);
  const bytes = statSync(OUT).size;
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${WIDTH}x${HEIGHT}, ${(bytes / 1024).toFixed(0)} KB)`);
  if (bytes > MAX_BYTES) console.warn(`  warning: ${bytes} bytes exceeds the ${MAX_BYTES}-byte budget`);
} finally {
  await browser.close();
}
