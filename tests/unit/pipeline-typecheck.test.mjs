/**
 * The pipeline type check (tsconfig.pipeline.json, npm run check:types:pipeline) keeps
 * noImplicitAny on (the 8 Nov 2026 review, stream S3) over scripts/publish, scripts/i18n,
 * scripts/maps and scripts/dev, and those folders carry no type-check suppressions.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT } from '../../scripts/lib/typecheck.mjs';

const FOLDERS = ['scripts/publish', 'scripts/i18n', 'scripts/maps', 'scripts/dev'];
const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config', 'tsconfig.pipeline.json'), 'utf8').replaceAll('"../', '"'));

test('tsconfig.pipeline.json checks the pipeline folders under full strict, noImplicitAny on', () => {
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noImplicitAny, true);
  assert.equal(config.compilerOptions.strictNullChecks, true);
  // full strict since 12 Nov 2026 (stream rf8-types)
  assert.equal(config.compilerOptions.strict, true, 'tsconfig.pipeline.json turned strict off');
  for (const flag of ['useUnknownInCatchVariables', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn']) assert.equal(config.compilerOptions[flag], true, flag);
  for (const folder of FOLDERS) assert.ok(config.include.includes(`${folder}/**/*.mjs`), folder);
});

test('no type-check suppressions in the pipeline folders', () => {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name) && /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO_ROOT, p));
    }
  };
  for (const folder of FOLDERS) walk(path.join(REPO_ROOT, folder));
  assert.deepEqual(found, []);
});

// scripts/build and scripts/check/rules join tsconfig.pipeline.json file by file as each is typed
// (stream rf9-build-types, 12 Nov 2026); tests/records/d1-shim.mjs joined tsconfig.records.json.
// A typed file stays listed: the list only grows until each folder is listed whole.
const TYPED_BUILD_AND_RULES = config.include.filter((/** @type {string} */ entry) => /^scripts\/(build|check\/rules)\//.test(entry));

test('the typed scripts/build and scripts/check/rules files stay in tsconfig.pipeline.json', () => {
  assert.ok(TYPED_BUILD_AND_RULES.length >= 63, `${TYPED_BUILD_AND_RULES.length} build and check-rule files listed; fewer than the 63 typed on 12 Nov 2026`);
  for (const entry of ['scripts/build/site.mjs', 'scripts/build/shell-assets.mjs', 'scripts/build/app-bundle.mjs', 'scripts/build/build-sitemap.mjs', 'scripts/build/build-site-stats.mjs', 'scripts/build/corpus-index.mjs']) {
    assert.ok(config.include.includes(entry), entry);
  }
  const records = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config', 'tsconfig.records.json'), 'utf8').replaceAll('"../', '"'));
  assert.ok(records.include.includes('tests/records/d1-shim.mjs'), 'tests/records/d1-shim.mjs');
});

test('no type-check suppressions in scripts/build, scripts/check/rules or the D1 shim', () => {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name) && /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'scripts', 'build'));
  walk(path.join(REPO_ROOT, 'scripts', 'check', 'rules'));
  if (/@ts-(nocheck|ignore|expect-error)/.test(readFileSync(path.join(REPO_ROOT, 'tests', 'records', 'd1-shim.mjs'), 'utf8'))) found.push('tests/records/d1-shim.mjs');
  assert.deepEqual(found, []);
});
