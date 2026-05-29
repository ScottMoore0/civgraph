#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';

const failures = [];
const index = readFileSync('test2/index.html', 'utf8');

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(index.includes('<base href="/">'), '/test2 must keep root-relative production assets via <base href="/">');
assert(index.includes('/test2/build/test2.bundle.js'), '/test2 must load its own MapLibre bundle');
assert(index.includes('/test2/build/test2.bundle.css'), '/test2 must load its own MapLibre CSS bundle');
assert(!index.includes('leaflet-1.9.4'), '/test2 must not load Leaflet assets');
assert(!index.includes('build/app.bundle.js'), '/test2 must not load the production app bundle');
assert(!index.includes("register('/sw.js'"), '/test2 must not register the production service worker');
assert(index.includes('class="app-header"'), '/test2 must preserve the production header shell');
assert(index.includes('class="pane pane--info"'), '/test2 must preserve the production catalogue pane');
assert(index.includes('class="pane pane--map"'), '/test2 must preserve the production map pane');
assert(index.includes('id="catalogueFlatView"'), '/test2 must preserve production catalogue containers');

for (const path of [
  'test2/build/test2.bundle.js',
  'test2/build/test2.bundle.css',
  'test2/src/app.js',
  'test2/src/maplibre-main-adapter.js'
]) {
  assert(existsSync(path), `${path} is missing`);
}

const bundleBytes = existsSync('test2/build/test2.bundle.js') ? statSync('test2/build/test2.bundle.js').size : 0;
assert(bundleBytes > 100_000, '/test2 bundle is unexpectedly small');
assert(bundleBytes < 2_500_000, `/test2 bundle is too large for the route budget: ${bundleBytes} bytes`);

if (failures.length) {
  console.error('Test2 Route Validation');
  failures.forEach((failure) => console.error(`- FAIL: ${failure}`));
  process.exit(1);
}

console.log('PASS: /test2 route shell and engine isolation checks passed.');
