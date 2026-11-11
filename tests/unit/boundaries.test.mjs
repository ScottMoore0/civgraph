// The import-boundary check (scripts/check/boundaries.mjs over config/boundaries.json, PKG-0/1; site/ joined 11 Nov 2026, R1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { allowed, edges, servedSource, SERVED_UNITS, specifiers, unitOf } from '../../scripts/check/boundaries.mjs';

const config = JSON.parse(readFileSync(new URL('../../config/boundaries.json', import.meta.url), 'utf8'));

test('boundaries: specifiers finds static, re-export, side-effect and dynamic imports, not comments', () => {
  const src = [
    "import a from './a.js';", "import { b } from '../b.mjs';", "export * from './c.js';", "export { d } from './d.js';",
    "import './e.js';", "const f = await import('./f.js');", "// import g from './g.js';", "/* import h from './h.js'; */",
    "import i from 'node:fs';", "import j from 'maplibre-gl';",
  ].join('\n');
  assert.deepEqual(specifiers(src).sort(), ['../b.mjs', './a.js', './c.js', './d.js', './e.js', './f.js', 'maplibre-gl', 'node:fs'].sort());
});

test('boundaries: units and rules follow the plan table', () => {
  assert.equal(unitOf('packages/storage/src/sqlite.mjs'), 'storage-node');
  assert.equal(unitOf('packages/storage/src/d1.js'), 'storage');
  assert.equal(unitOf('functions/_api/elections/index.js'), 'functions');
  assert.equal(unitOf('data/registries/councils.json'), null);
  assert.equal(allowed('api', 'storage'), true);
  assert.equal(allowed('api', 'ui'), false);
  assert.equal(allowed('ui', 'api'), false, 'templates never query');
  assert.equal(allowed('loader', 'api'), false);
  assert.equal(allowed('functions', 'loader'), false);
  assert.equal(allowed('scripts', 'functions'), false);
  assert.equal(allowed('scripts', 'map'), true);
  assert.equal(allowed('tests', 'functions'), true);
});

test('boundaries: the served pages are in units and reach packages only through the served mapping', () => {
  assert.equal(unitOf('site/browse/browse.js'), 'site');
  assert.equal(unitOf('site/apps/words/words.js'), 'site-apps');
  assert.equal(unitOf('src/ui-controller.js'), 'frontend');
  assert.equal(servedSource('site/assets/ui/state/machine.js'), 'packages/ui/assets/state/machine.js');
  assert.equal(servedSource('site/browse/browse.js'), 'site/browse/browse.js');
  assert.equal(servedSource('src/map/x.js'), 'src/map/x.js', 'only site/ paths are served paths');
  assert.ok(SERVED_UNITS.has('ui') && SERVED_UNITS.has('map'));
  assert.equal(allowed('site', 'ui'), true, 'ui is served at /assets/ui/');
  assert.equal(allowed('site', 'core'), SERVED_UNITS.has('core'), 'core only once a served prefix maps it');
  assert.equal(allowed('site', 'site-apps'), false, 'shared pages never import an app');
  assert.equal(allowed('site-apps', 'site'), true);
  assert.equal(allowed('site', 'api'), false);
});

// Whether every tracked script is in a unit (C2) is reported by check:architecture (report-only until its enforceFrom date).
test('boundaries: the repository passes with its baseline; each unowned entry gives its reason', () => {
  const bad = edges().filter((e) => !e.ok);
  assert.deepEqual(bad.map((e) => `${e.file} -> ${e.target}`).sort(), [...config.baseline].sort());
  for (const [key, reason] of Object.entries(config.unowned)) assert.ok(String(reason).length > 20, `unowned ${key} needs a reason`);
});
