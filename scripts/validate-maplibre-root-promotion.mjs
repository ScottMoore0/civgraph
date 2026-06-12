#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(existsSync(path), `Missing required file: ${path}`);
  return readFileSync(path, 'utf8');
}

const rootHtml = read('index.html');
const test2Html = read('test2/index.html');
const rootServiceWorker = read('sw.js');
const appSource = read('test2/src/app.js');
const sharedAssetBuilder = read('scripts/build-shared-shell-assets.mjs');
const legacyLeafletBuilder = read('scripts/build-legacy-leaflet-app.mjs');
const packageJson = JSON.parse(read('package.json'));
const archiveDocExists = existsSync('archive/leaflet-main-before-maplibre-root-20260612.md');
const archivedBundleExists = existsSync('archive/legacy-scripts/bundle.mjs');
const buildScript = String(packageJson.scripts?.build || '');

assert(rootHtml.includes('Root MapLibre shell promoted from /test2'), 'Root index must carry the MapLibre promotion marker.');
assert(rootHtml.includes('/test2/build/test2.bundle.js'), 'Root index must load the MapLibre /test2 JS runtime.');
assert(rootHtml.includes('/test2/build/test2.bundle.css'), 'Root index must load the MapLibre /test2 CSS runtime.');
assert(rootHtml.includes('/test2/election-viewer-package/css/election-viewer.css'), 'Root index must preserve the route-scoped election pane CSS.');
assert(rootHtml.includes('id="map"'), 'Root index must contain the MapLibre map container.');
assert(rootHtml.includes('class="app-shell"'), 'Root index must use the production shell structure.');
assert(rootHtml.includes('class="pane pane--info"'), 'Root index must preserve the catalogue pane.');
assert(rootHtml.includes('class="pane pane--map"'), 'Root index must preserve the map pane.');
assert(rootHtml.includes('href="/browse/"'), 'Root index must preserve the Browse navbar route.');
assert(rootHtml.includes('href="/"'), 'Root index must preserve root Home/brand routes.');
assert(!/build\/app\.bundle\.js/i.test(rootHtml), 'Root index must not load the archived Leaflet app bundle.');
assert(!/leaflet-1\.9\.4/i.test(rootHtml), 'Root index must not load the archived Leaflet assets.');
assert(rootHtml.includes('Root service-worker owns production cache'), 'Root index must document root service-worker cache ownership.');

assert(test2Html.includes('/test2/build/test2.bundle.js'), '/test2 compatibility route must still load its own runtime bundle.');
assert(test2Html.includes('id="map"'), '/test2 compatibility route must still contain the map container.');

assert(rootServiceWorker.includes('root-maplibre-sw-'), 'Root service worker must use the MapLibre root cache version.');
assert(rootServiceWorker.includes('/test2/build/test2.bundle.js'), 'Root service worker must handle the MapLibre runtime entry.');
assert(rootServiceWorker.includes('request.headers.has(\'range\')'), 'Root service worker must not intercept PMTiles byte-range requests.');
assert(rootServiceWorker.includes('TEST2_SW_STATUS'), 'Root service worker must support the existing diagnostics status message.');
assert(rootServiceWorker.includes('civgraph-static-') && rootServiceWorker.includes('civgraph-runtime-'), 'Root service worker must clean up legacy Leaflet-era root caches.');

assert(appSource.includes('getServiceWorkerConfig()'), 'MapLibre runtime must choose service-worker scope by route.');
assert(appSource.includes("url: '/sw.js'") && appSource.includes("scope: '/'"), 'MapLibre runtime must register the root service worker on /.');
assert(appSource.includes("url: '/test2/sw.js'") && appSource.includes("scope: '/test2/'"), 'MapLibre runtime must preserve the /test2 scoped service worker.');

assert(
  buildScript.includes('promote-test2-root.mjs'),
  'npm run build must promote the MapLibre root deterministically.'
);
assert(
  buildScript.includes('build-shared-shell-assets.mjs'),
  'npm run build must generate shared CSS/thumbnail/about assets without the legacy Leaflet app bundle.'
);
assert(
  !buildScript.includes('bundle.mjs') && !buildScript.includes('build-legacy-leaflet-app.mjs'),
  'npm run build must not run the archived Leaflet app bundler.'
);
assert(
  packageJson.scripts?.['build:legacy-leaflet'] === 'node scripts/build-legacy-leaflet-app.mjs',
  'Archived Leaflet bundle generation must stay available through npm run build:legacy-leaflet.'
);
assert(!existsSync('scripts/bundle.mjs'), 'Retired mixed Leaflet/CSS bundle script must stay archived outside scripts/.');
assert(archivedBundleExists, 'Archived mixed Leaflet/CSS bundle script is missing from archive/legacy-scripts/bundle.mjs.');
assert(
  sharedAssetBuilder.includes('assets/css/main.css') &&
    sharedAssetBuilder.includes('assets/thumbnails') &&
    sharedAssetBuilder.includes('build/about.css'),
  'Shared asset builder must own the root CSS, thumbnail manifest, and about.css pipeline.'
);
assert(
  !sharedAssetBuilder.includes("entryPoints: ['js/app.js']") &&
    !sharedAssetBuilder.includes("hashFile('build/app.bundle.js") &&
    !sharedAssetBuilder.includes("updateAssetVersion(html, 'build/app.bundle.js"),
  'Shared asset builder must not bundle or version the archived Leaflet app.'
);
assert(
  legacyLeafletBuilder.includes("entryPoints: ['js/app.js']") &&
    legacyLeafletBuilder.includes('build/app.bundle.js'),
  'Legacy Leaflet builder must be explicit and separate from the production build path.'
);
assert(!existsSync('build/app.bundle.js'), 'Normal MapLibre production build must not leave build/app.bundle.js behind.');
assert(
  String(packageJson.scripts?.check || '').includes('check:root') &&
    packageJson.scripts?.['check:root'] === 'node scripts/validate-maplibre-root-promotion.mjs',
  'npm run check must include root promotion validation.'
);
assert(archiveDocExists, 'Leaflet main archive manifest is missing.');

console.log('PASS: Root route is promoted to the /test2 MapLibre shell while /test2 remains compatible.');
