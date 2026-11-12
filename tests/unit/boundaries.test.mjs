// The import-boundary check (scripts/check/boundaries.mjs over config/boundaries.json, PKG-0/1; site/ joined 11 Nov 2026, R1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { allowed, edges, engineEdges, engineOf, engineUses, mayUseEngine, specifiers, unitOf } from '../../scripts/check/boundaries.mjs';

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
  // A departure from the plan table (rf9-ui, 12 Nov 2026): the PRONI record page's server render
  // (api handlers/proni/page.js) writes the record with ui's record-view.js. Never the other way.
  assert.equal(allowed('api', 'ui'), true);
  assert.equal(allowed('ui', 'api'), false, 'templates never query');
  assert.equal(allowed('loader', 'api'), false);
  assert.equal(allowed('functions', 'loader'), false);
  assert.equal(allowed('scripts', 'functions'), false);
  assert.equal(allowed('scripts', 'map'), true);
  assert.equal(allowed('tests', 'functions'), true);
});

test('boundaries: the served pages are in units and reach packages only through the served shims', () => {
  assert.equal(unitOf('site/browse/browse.js'), 'site');
  assert.equal(unitOf('site/apps/words/words.js'), 'site-apps');
  assert.equal(unitOf('site/assets/ui/state/machine.js'), 'site-served');
  assert.equal(unitOf('src/libs/pako.min.js'), 'frontend');
  assert.equal(unitOf('packages/map/src/ui-controller.js'), 'map');
  assert.equal(allowed('site', 'site-served'), true, 'pages import the shim at the served path');
  assert.equal(allowed('site-served', 'ui'), true, 'the shim re-exports packages/ui/assets/');
  for (const unit of ['ui', 'core', 'map', 'api', 'config']) {
    assert.equal(allowed('site', unit), false, `site -> ${unit}: a served page cannot reach packages/`);
    assert.equal(allowed('site-apps', unit), false, `site-apps -> ${unit}`);
  }
  assert.equal(allowed('site', 'site-apps'), false, 'shared pages never import an app');
  assert.equal(allowed('site-apps', 'site'), true);
});

// Whether every tracked script is in a unit (C2) is reported by check:architecture (report-only until its enforceFrom date).
test('boundaries: the repository passes with its baseline; each unowned entry gives its reason', () => {
  const bad = edges().filter((e) => !e.ok);
  assert.deepEqual(bad.map((e) => `${e.file} -> ${e.target}`).sort(), [...config.baseline].sort());
  for (const [key, reason] of Object.entries(config.unowned)) assert.ok(String(reason).length > 20, `unowned ${key} needs a reason`);
});

test('boundaries: the Elections app is in a unit, and may import only its own files, the served /pkg/ modules and the site', () => {
  for (const file of ['site/apps/elections/app.js', 'site/apps/elections/lib/format.js', 'site/apps/elections/views/map.js', 'site/apps/elections/embed/embed.js']) {
    assert.equal(unitOf(file), 'elections-app', file);
  }
  assert.equal(allowed('elections-app', 'site-pkg'), true);
  assert.equal(allowed('elections-app', 'site-served'), true);
  for (const unit of ['core', 'ui', 'config', 'map', 'api', 'storage', 'registries-browser', 'scripts']) {
    assert.equal(allowed('elections-app', unit), false, `elections-app -> ${unit}: a served page cannot reach packages/ (use /pkg/)`);
  }
});

// The engine rule (config/boundaries.json `engines`; stream rf9-loader-storage, ST-7, acceptance test A3).
test('boundaries: engineUses finds an engine by import, import() and JSDoc type import, and nothing else', () => {
  const src = [
    "import { DatabaseSync } from 'node:sqlite';",
    "const { S3Client } = await import('@aws-sdk/client-s3');",
    "/** @param {import('pg').Client} c */",
    "/** @typedef {import('@libsql/client').Client} L */",
    "import x from './sql.js-httpvfs/index.js';", "import y from 'sql.js-httpvfs';", "import z from 'node:fs';",
    "// the engine is named in prose only: node:sqlite",
  ].join('\n');
  assert.deepEqual(engineUses(src), ['@aws-sdk/client-s3', '@libsql/', 'node:sqlite', 'pg']);
  assert.equal(engineOf('better-sqlite3'), 'better-sqlite3');
  assert.equal(engineOf('pg/lib/client'), 'pg');
  assert.equal(engineOf('pgx'), null);
});

test('boundaries: only the storage adapter (and the tests) may use an engine API', () => {
  assert.equal(mayUseEngine(unitOf('packages/storage/src/sqlite.mjs')), true);
  for (const file of ['packages/loader/src/db.mjs', 'packages/maps-pipeline/src/tiles/repair-label-text.mjs', 'scripts/build/build-elections-sqlite.mjs',
    'scripts/check/rules/contest-arithmetic.mjs', 'packages/storage/src/d1.js', 'functions/_api/elections/index.js', 'tools/dev-site/server.mjs']) {
    assert.equal(mayUseEngine(unitOf(file)), false, file);
  }
  assert.equal(mayUseEngine(unitOf('tests/records/delta.test.mjs')), true);
  assert.equal(mayUseEngine(null), false, 'a file in no unit may not');
});

test('boundaries: the repository passes the engine rule with its baseline, and no SQLite use is in it', () => {
  const bad = engineEdges().filter((e) => !e.ok);
  assert.deepEqual(bad.map((e) => `${e.file} -> ${e.engine}`).sort(), [...config.engines.baseline].sort());
  assert.ok(config.engines.baseline.every((b) => !b.endsWith('node:sqlite')), 'every node:sqlite use outside the tests is behind packages/storage');
  assert.ok(String(config.engines['//']).length > 100);
});
