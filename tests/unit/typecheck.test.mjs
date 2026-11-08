/**
 * The JSDoc type check (REFACTOR-PLAN.md item 2): scripts/lib/typecheck.mjs fails only on errors
 * in the allowlisted files, and the records allowlist only grows.
 *
 * - tsconfig.records.json keeps scripts/lib and scripts/records, with checkJs on;
 * - tsconfig.records-strict.json keeps noImplicitAny on for scripts/lib and the packages' files it lists;
 * - no @ts-nocheck, @ts-ignore or @ts-expect-error in those folders (a cast in JSDoc says what
 *   is meant; a suppression hides it);
 * - typecheck() splits errors into the allowlisted files (failures) and the files they import
 *   (notes), over a two-file fixture.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { REPO_ROOT, typecheck } from '../../scripts/lib/typecheck.mjs';

const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tsconfig.records.json'), 'utf8'));

test('tsconfig.records.json checks scripts/lib, scripts/records and the loader, schema and storage packages', () => {
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
  for (const entry of ['scripts/lib/**/*.mjs', 'scripts/records/**/*.mjs', 'packages/loader/src/**/*.mjs', 'packages/schema/src/*.mjs', 'packages/storage/src/sqlite.mjs']) assert.ok(config.include.includes(entry), entry);
});

test('tsconfig.records-strict.json keeps noImplicitAny on for scripts/lib and the storage, config, schema and maps-pipeline files, and check:types:records runs it', () => {
  const strict = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tsconfig.records-strict.json'), 'utf8'));
  assert.equal(strict.extends, './tsconfig.records.json');
  assert.equal(strict.compilerOptions.noImplicitAny, true);
  for (const entry of ['scripts/lib/**/*.mjs', 'packages/storage/src/sqlite.mjs', 'packages/config/src/node.mjs', 'packages/schema/src/schema.mjs', 'packages/maps-pipeline/src/layer-bounds.mjs', 'packages/maps-pipeline/src/safe-artefact-write.mjs']) assert.ok(strict.include.includes(entry), entry);
  // The base config must not switch it off for everything that extends it.
  assert.notEqual(config.compilerOptions.noImplicitAny, false);
  const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
  assert.match(scripts['check:types:records'], /typecheck\.mjs tsconfig\.records-strict\.json/);
});

test('no type-check suppressions in the allowlisted folders', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.m?js$/.test(e.name) && /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'scripts', 'lib'));
  walk(path.join(REPO_ROOT, 'scripts', 'records'));
  for (const p of ['loader', 'schema', 'storage', 'config', 'maps-pipeline']) walk(path.join(REPO_ROOT, 'packages', p, 'src'));
  assert.deepEqual(found, []);
});

test('typecheck() fails on allowlisted files only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'civgraph-typecheck-'));
  try {
    mkdirSync(path.join(dir, 'in'));
    mkdirSync(path.join(dir, 'out'));
    writeFileSync(path.join(dir, 'out', 'dep.mjs'), "/** @type {number} */\nexport const n = 'not a number';\n");
    writeFileSync(path.join(dir, 'in', 'main.mjs'), "import { n } from '../out/dep.mjs';\n/** @type {string} */\nexport const s = n;\nexport const ok = n + 1;\n");
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { allowJs: true, checkJs: true, noEmit: true, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2023', lib: ['es2023'], types: [] },
      include: ['in/**/*.mjs'],
    }));
    const result = await typecheck('tsconfig.json', { root: dir });
    assert.deepEqual(result.files, ['in/main.mjs']);
    assert.deepEqual(result.errors.map((e) => [e.file, e.line, e.code]), [['in/main.mjs', 3, 2322]]);
    assert.deepEqual(result.outside.map((e) => [e.file, e.line, e.code]), [['out/dep.mjs', 2, 2322]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
