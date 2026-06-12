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
const packageJson = JSON.parse(read('package.json'));
const archiveDocExists = existsSync('archive/leaflet-main-before-maplibre-root-20260612.md');

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

assert(test2Html.includes('/test2/build/test2.bundle.js'), '/test2 compatibility route must still load its own runtime bundle.');
assert(test2Html.includes('id="map"'), '/test2 compatibility route must still contain the map container.');

assert(
  String(packageJson.scripts?.build || '').includes('promote-test2-root.mjs'),
  'npm run build must promote the MapLibre root deterministically.'
);
assert(
  String(packageJson.scripts?.check || '').includes('check:root') &&
    packageJson.scripts?.['check:root'] === 'node scripts/validate-maplibre-root-promotion.mjs',
  'npm run check must include root promotion validation.'
);
assert(archiveDocExists, 'Leaflet main archive manifest is missing.');

console.log('PASS: Root route is promoted to the /test2 MapLibre shell while /test2 remains compatible.');
