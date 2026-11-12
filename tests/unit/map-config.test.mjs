// The map app reads the site's origins from the config module (packages/config/src/config.js,
// REFACTOR-PLAN.md item 7), which the app bundle inlines, instead of writing them out.
//
//   node --test tests/unit/map-config.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../packages/config/src/config.js';
import { CDN_BASE, cdnUrl } from '../../packages/map/src/cdn-url.js';
import { resolveApproximateSegmentsUrl } from '../../packages/map/src/renderer/approximate-segments.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the CDN helpers give the same URLs as before, from the config', () => {
  assert.equal(SITE.dataOrigin, 'https://data.civgraph.net');
  assert.equal(CDN_BASE, SITE.dataOrigin);
  assert.equal(cdnUrl('/assets/thumbnails/x.webp'), 'https://data.civgraph.net/assets/thumbnails/x.webp');
  const layer = { approximateSegments: { url: 'https://data.civgraph.net/data/x.geojson' } };
  const local = { hostname: 'localhost', origin: 'http://localhost:8788' };
  assert.equal(resolveApproximateSegmentsUrl(layer, local), 'http://localhost:8788/_r/data/x.geojson');
  assert.equal(resolveApproximateSegmentsUrl(layer, { hostname: 'civgraph.net', origin: 'https://civgraph.net' }), 'https://data.civgraph.net/data/x.geojson');
});

test('the bundled map-app modules name no origin of their own', () => {
  // packages/map/src/fgb-worker.js is a worker script loaded on its own, outside the bundle, so it keeps its copy.
  for (const file of ['packages/map/src/cdn-url.js', 'packages/map/src/renderer/approximate-segments.js', 'packages/map/app/map-image-export.js']) {
    const code = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /'https:\/\/(data\.)?civgraph\.net/, `${file} writes out an origin`);
    assert.doesNotMatch(code, /`https:\/\/(data\.)?civgraph\.net/, `${file} writes out an origin`);
  }
});
