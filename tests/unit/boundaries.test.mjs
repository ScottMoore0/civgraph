// The import-boundary check (scripts/check/boundaries.mjs over boundaries.json, PKG-0/1).
import assert from 'node:assert/strict';
import test from 'node:test';
import { allowed, edges, specifiers, unitOf } from '../../scripts/check/boundaries.mjs';

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

test('boundaries: the repository passes with an empty baseline', () => {
  const bad = edges().filter((e) => !e.ok);
  assert.deepEqual(bad.map((e) => `${e.file} -> ${e.target}`), []);
});
