#!/usr/bin/env node
/**
 * check:root -- the production map app's shell, service worker and build stay as the
 * MapLibre promotion left them (maps/index.html, sw.js, packages/map/app/app.js, the build script).
 *
 * It reads nothing under archive/ (that went with 49e65a9e43) and nothing of the legacy
 * /render/ app, so it survives the restructure as the data design's checks.csv says: its
 * assertions are source-file rules for the live app and move into check:schema (C2). The
 * /test2/ assertions follow F5 (7 Nov 2026): /test2/ is a 301 and test2/sw.js the retired-app
 * kill switch, so no page there may carry the app.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { readMapAppSource } from '../../lib/map-app-source.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, 'utf8');
}

// The MapLibre application is at maps/index.html. It was the root until the landing
// page took that slot; every assertion below is about the page that carries the runtime,
// so it follows the application rather than the URL. `appHtml` is named for what it is.
const appHtml = read('site/maps/index.html');
const rootServiceWorker = read('site/sw.js');
const appSource = readMapAppSource(); // app.js and the modules split out of it under packages/map/src/app/
const mainCss = read('site/assets/css/main.css');
const test2Css = read('packages/map/app/test2.css');
const sharedAssetBuilder = read('scripts/build/shell-assets.mjs');
const packageJson = JSON.parse(read('package.json'));
// The retired Leaflet manifest and bundle.mjs used to be asserted present under
// archive/. archive/ left the repository in November 2026 (see docs/ARCHIVE.md); the
// tag leaflet-main-before-maplibre-root-20260612 still pins the Leaflet main.
const buildScript = String(packageJson.scripts?.build || '');

assert(appHtml.includes('Root MapLibre shell'), 'site/maps/index.html must carry the MapLibre marker.');
assert(appHtml.includes('/app/build/app.bundle.js'), 'site/maps/index.html must load the MapLibre JS runtime from /app.');
assert(appHtml.includes('/app/build/app.bundle.css'), 'site/maps/index.html must load the MapLibre CSS runtime from /app.');
assert(appHtml.includes('/app/election-viewer-package/css/election-viewer.css'), 'site/maps/index.html must preserve the election pane CSS under /app.');
assert(appHtml.includes('id="map"'), 'site/maps/index.html must contain the MapLibre map container.');
assert(appHtml.includes('class="app-shell"'), 'site/maps/index.html must use the production shell structure.');
assert(appHtml.includes('class="pane pane--info"'), 'site/maps/index.html must preserve the catalogue pane.');
assert(appHtml.includes('class="pane pane--map"'), 'site/maps/index.html must preserve the map pane.');
assert(appHtml.includes('href="/browse/"'), 'site/maps/index.html must preserve the Browse navbar route.');
assert(appHtml.includes('href="/"'), 'site/maps/index.html must preserve root Home/brand routes.');
assert(!/(?:src|href)=["']\/build\/app\.bundle\.js/i.test(appHtml), 'site/maps/index.html must not load the archived Leaflet app bundle.');
assert(!/leaflet-1\.9\.4/i.test(appHtml), 'site/maps/index.html must not load the archived Leaflet assets.');
assert(appHtml.includes('Root service-worker owns production cache'), 'site/maps/index.html must document root service-worker cache ownership.');

assert(!existsSync('site/test2/index.html'), '/test2/ must not serve a page: _redirects sends it to /maps/.');
assert(!read('site/test2/sw.js').includes('/app/build/app.bundle.js'), '/test2/sw.js must not cache the live app: it only retires the legacy worker.');

assert(rootServiceWorker.includes('root-maplibre-sw-'), 'Root service worker must use the MapLibre root cache version.');
assert(rootServiceWorker.includes('/app/build/app.bundle.js'), 'Root service worker must handle the MapLibre runtime entry.');
assert(rootServiceWorker.includes('request.headers.has(\'range\')'), 'Root service worker must not intercept PMTiles byte-range requests.');
assert(rootServiceWorker.includes('TEST2_SW_STATUS'), 'Root service worker must support the existing diagnostics status message.');
assert(rootServiceWorker.includes('civgraph-static-') && rootServiceWorker.includes('civgraph-runtime-'), 'Root service worker must clean up legacy Leaflet-era root caches.');

assert(appSource.includes('getServiceWorkerConfig()'), 'MapLibre runtime must choose its service-worker config centrally.');
assert(appSource.includes("url: '/sw.js'") && appSource.includes("scope: '/'"), 'MapLibre runtime must register the root service worker on /.');
assert(!appSource.includes("url: '/test2/sw.js'"), 'MapLibre runtime must not keep registering a /test2-scoped service worker.');

assert(
  buildScript.includes('promote-test2-root.mjs'),
  'npm run build must promote the MapLibre root deterministically.'
);
assert(
  buildScript.includes('scripts/build/shell-assets.mjs'),
  'npm run build must generate shared CSS/thumbnail/about assets without the legacy Leaflet app bundle.'
);
assert(
  !buildScript.includes('bundle.mjs') && !buildScript.includes('build-legacy-leaflet-app.mjs'),
  'npm run build must not run the archived Leaflet app bundler.'
);
// Also inverted. Keeping build:legacy-leaflet available made sense while the
// Leaflet bundle was a usable fallback; it is not one now, so the script is
// retired rather than preserved, and this asserts it stays retired.
assert(
  !packageJson.scripts?.['build:legacy-leaflet'],
  'build:legacy-leaflet must stay retired — the Leaflet stack is archived.'
);
assert(!existsSync('scripts/bundle.mjs'), 'Retired mixed Leaflet/CSS bundle script must stay archived outside scripts/.');
assert(
  sharedAssetBuilder.includes('site/assets/css/main.css') &&
    sharedAssetBuilder.includes('site/assets/thumbnails'),
  'Shared asset builder must own the root CSS and thumbnail manifest pipeline.'
);
assert(
  !sharedAssetBuilder.includes("entryPoints: ['js/app.js']") &&
    !sharedAssetBuilder.includes("hashFile('build/app.bundle.js") &&
    !sharedAssetBuilder.includes("updateAssetVersion(html, 'build/app.bundle.js"),
  'Shared asset builder must not bundle or version the archived Leaflet app.'
);
// Inverted after the Leaflet stack was archived.
//
// This used to assert that build-legacy-leaflet-app.mjs still declared
// entryPoints: ['js/app.js'] -- that a legacy builder existed and was kept
// separate from production. With the stack retired, the guarantee worth holding
// is the stronger one: no build script may take the Leaflet entry, so the
// promotion cannot be undone by accident.
//
// It was archived because it had stopped working anywhere, not merely because
// it was superseded: js/colour-palettes.js imported JSON with no import
// attribute, which modern browsers reject, so the module graph failed to
// instantiate whenever it was served unbundled. Every browser spec that
// imported it was already failing.
// Scan the LIVE build scripts, not the archived one. The archived builder still
// declares entryPoints: ['js/app.js'] -- that is precisely what it is, and
// asserting otherwise fails on the archive's own contents. What matters is that
// nothing under scripts/ takes that entry any more.
{
  const liveBuildScripts = readdirSync('scripts', { recursive: true })
    .map((f) => String(f).split(path.sep).join('/'))
    .filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))
    // Exclude this validator: it contains the literal string in its own
    // assertions, so scanning itself always "finds" a violation.
    .filter((f) => f !== 'check/rules/maplibre-root-promotion.mjs')
    .filter((f) => readFileSync(`scripts/${f}`, 'utf8').includes("entryPoints: ['js/app.js']"));
  assert(
    liveBuildScripts.length === 0,
    `No live build script may declare the archived Leaflet entry point (found: ${liveBuildScripts.join(', ')}).`
  );
}
assert(
  mainCss.includes(':root:not([data-theme="light"]) .election-results-pane') &&
    mainCss.includes(':root:not([data-theme="light"]) .election-party-table tbody td') &&
    mainCss.includes(':root:not([data-theme="light"]) .election-count-table tbody td') &&
    mainCss.includes(':root:not([data-theme="light"]) .election-na'),
  'System dark mode must override hardcoded election-pane table backgrounds.'
);
assert(
  mainCss.includes(':root:not([data-theme="light"]) .feature-info__summary') &&
    mainCss.includes(':root:not([data-theme="light"]) .feature-info__properties'),
  'System dark mode must override feature-info light-mode property blocks.'
);
assert(
  test2Css.includes(':root:not([data-theme="light"]) .flat-election-entry--active') &&
    test2Css.includes('background: var(--raw-1d2b3d)') &&
    test2Css.includes('color: var(--raw-eef6ff)') &&
    test2Css.includes(':root:not([data-theme="light"]) .test2-source-panel') &&
    test2Css.includes(':root:not([data-theme="light"]) .test2-election-table th'),
  '/test2 system dark mode must cover active catalogue rows and test2-specific panels.'
);
assert(
  mainCss.includes(':root:not([data-theme="light"]) .catalogue-flat__toc-toplink'),
  'System dark mode must keep catalogue top-level TOC labels readable.'
);
assert(!existsSync('build/app.bundle.js'), 'Normal MapLibre production build must not leave build/app.bundle.js behind.');
assert(
  String(packageJson.scripts?.check || '').includes('check:root') &&
    packageJson.scripts?.['check:root'] === 'node scripts/check/rules/maplibre-root-promotion.mjs',
  'npm run check must include root promotion validation.'
);

console.log('PASS: Root route uses /app MapLibre assets while /test2 remains a compatibility redirect.');
