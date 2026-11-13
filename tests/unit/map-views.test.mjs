// The map's pure drawing code, packages/map/src/views/ (rf10-gallery, 13 Nov 2026): the component
// renderers the map app and the design system's gallery both import. The modules moved there from
// packages/map/src/ and packages/map/src/app/; each old path still answers with the same functions,
// so importers that were not touched (the election manager, the legend and timeline methods, other
// streams' branches) get exactly what they got before.
//
//   node --test tests/unit/map-views.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowed, unitOf } from '../../scripts/check/boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// old path -> its module in views/. Add to it; never take one out until S10 removes the shims.
const MOVED = {
  'packages/map/src/app/legend-view.mjs': 'packages/map/src/views/legend-view.mjs',
  'packages/map/src/app/timeline/timeline-view.mjs': 'packages/map/src/views/timeline-view.mjs',
  'packages/map/src/election-renderer.mjs': 'packages/map/src/views/election-renderer.mjs',
  'packages/map/src/colours.mjs': 'packages/map/src/views/colours.mjs',
  'packages/map/src/specimens.mjs': 'packages/map/src/views/specimens.mjs',
};

const load = (/** @type {string} */ file) => import(new URL(`../../${file}`, import.meta.url).href);

test('every old path re-exports its views module: the same names, the same objects', async () => {
  for (const [old, moved] of Object.entries(MOVED)) {
    const [a, b] = await Promise.all([load(old), load(moved)]);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), old);
    for (const name of Object.keys(b)) assert.equal(a[name], b[name], `${old} ${name}`);
    const source = readFileSync(path.join(ROOT, old), 'utf8');
    assert.match(source, /^export \* from '[./]+[\w/.-]*views\/[\w-]+\.mjs';$/m, `${old} is a one-line re-export`);
    assert.doesNotMatch(source.replace(/^\/\/.*$/gm, ''), /function|const |class /, `${old} holds no code of its own`);
  }
});

test('the trend chart: the pure half is in views/, the browser half re-exports it under its old names', async () => {
  const [old, pure] = await Promise.all([load('packages/map/src/election-trend-chart.mjs'), load('packages/map/src/views/election-trend-chart.mjs')]);
  // The names the old module has always had, and no more.
  assert.deepEqual(Object.keys(old).sort(), ['buildTrendChartModel', 'formatShare', 'layoutTrendChart', 'mountTrendChart', 'renderTrendChartSvg']);
  for (const name of ['buildTrendChartModel', 'formatShare', 'layoutTrendChart', 'renderTrendChartSvg']) assert.equal(old[name], pure[name], name);
  assert.equal(typeof old.mountTrendChart, 'function');
  assert.equal(pure.mountTrendChart, undefined, 'the browser half stays in the map app');
});

test('views/ is the map-views unit: map and ui may import it; it imports neither', () => {
  for (const file of Object.values(MOVED)) assert.equal(unitOf(file), 'map-views', file);
  assert.equal(unitOf('packages/map/src/views/election-trend-chart.mjs'), 'map-views');
  assert.equal(unitOf('packages/map/src/election-trend-chart.mjs'), 'map');
  assert.equal(allowed('map', 'map-views'), true);
  assert.equal(allowed('ui', 'map-views'), true, 'the gallery draws the map components');
  assert.equal(allowed('ui', 'map'), false, 'map imports ui: ui -> map would be a cycle');
  for (const unit of ['map', 'ui', 'config', 'api', 'storage']) assert.equal(allowed('map-views', unit), false, `map-views -> ${unit}`);
});

test('the views modules are pure: no DOM, no window, no document at all', () => {
  for (const file of [...Object.values(MOVED), 'packages/map/src/views/election-trend-chart.mjs']) {
    const code = readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\b(document|window|globalThis|localStorage|getComputedStyle|querySelector|addEventListener)\b/, file);
  }
});

test('the gallery draws the map components with the views renderers, from views/ only', async () => {
  const route = await import('../../packages/ui/src/gallery/route.js');
  const source = readFileSync(path.join(ROOT, 'packages/ui/src/gallery/route.js'), 'utf8');
  const mapImports = [...source.matchAll(/from '([^']*\/map\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(mapImports.length > 0);
  for (const spec of mapImports) assert.match(spec, /^\.\.\/\.\.\/\.\.\/map\/src\/views\//, `the gallery imports ${spec}: only views/ is open to ui`);
  const map = route.APP_SPECIMENS.filter((s) => s.app === 'map');
  assert.deepEqual(map.map((s) => s.id), ['map-legend', 'map-results', 'map-trends', 'map-timeline', 'map-timeline-changes']);
  const expect = {
    'map-legend': /<section class="test2-map-legend"[^>]*><details open><summary class="test2-map-legend__summary"><span>Legend: Winner<\/span>/,
    'map-results': /data-election-renderer="shared"[\s\S]*data-election-view="party"/,
    'map-trends': /<svg class="test2-election-trends__svg"[\s\S]*class="test2-election-trends__legend-item"|class="test2-election-trends__legend-item"[\s\S]*<svg class="test2-election-trends__svg"/,
    'map-timeline': /<div class="timeline-track"><input type="range" class="timeline-range"[^>]*><div class="timeline-ticks" aria-hidden="true"><span class="timeline-tick/,
    'map-timeline-changes': /<section class="timeline-changes-panel" aria-label="Boundary changes">[\s\S]*Changes, 1973 to 1985/,
  };
  for (const s of map) {
    assert.ok(s.render, s.id);
    assert.match(String(s.render()), expect[s.id], s.id);
    assert.ok(s.source.startsWith('packages/map/src/views/'), s.id);
    assert.deepEqual(s.stylesheets, ['assets/css/main.css', 'app/src/test2.css'], s.id);
  }
  // Every frame style is rules for the frame's own #specimen, nothing global.
  for (const s of map.filter((x) => x.frameStyle)) {
    for (const rule of String(s.frameStyle).replace(/@media[^{]*\{/g, '').split('}').map((r) => r.trim()).filter(Boolean)) {
      assert.match(rule, /^#specimen\b/, `${s.id}: ${rule}`);
    }
  }
});
