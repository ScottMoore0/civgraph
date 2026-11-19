// The packages' type check (TS-4, npm run check:types:packages): tsc -b over
// config/tsconfig.packages.json, one composite project per package (two where a package cycle or
// a runtime/node split needed it), each strict and referencing the projects it imports.
//
// - every workspace package has a project, the solution references every project on disk, and
//   every reference of a project is a project of the solution;
// - each project stays composite, strict and declaration-only into tmp/tsbuild/, with the stricter
//   flags it had on 18 Nov 2026 (add flags; never take one off), its own flags, not inherited;
// - the include lists keep every entry, the exclude lists only shrink, and every script file of a
//   package is compiled by exactly one project or is on LEFT (which only shrinks: a file joins its
//   project once it checks clean, and leaves LEFT in the same commit);
// - no compiled file silences the checker;
// - check:types:packages runs tsc -b over the solution, in the check chain and the landing gates.
//
//   node --test tests/unit/packages-typecheck.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOLUTION = 'config/tsconfig.packages.json';
const rel = (/** @type {string} */ abs) => path.relative(ROOT, abs).split(path.sep).join('/');

const STRICT_FAMILY = ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn', 'noImplicitThis', 'useUnknownInCatchVariables', 'alwaysStrict'];

// Each project as of 18 Nov 2026: the stricter flags it passes and its include entries. Add to
// either; never take an entry out.
const BASELINE = {
  'packages/types/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['index.d.ts', 'generated/**/*.d.ts', 'hand/*.d.ts'] },
  'packages/types/tsconfig.project.generator.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/generate.mjs'] },
  'packages/config/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/config.js'] },
  'packages/config/tsconfig.project.node.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/node.mjs', 'src/check.mjs'] },
  'packages/registries/tsconfig.project.browser.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/browser/*.mjs'] },
  'packages/core/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/*.js', 'src/*.mjs'] },
  'packages/registries/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/*.mjs', 'src/seed/*.mjs', 'src/browser/build.mjs'] },
  'packages/storage/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/*.js', '../../functions/_lib/runtime.d.mts'] },
  'packages/storage/tsconfig.project.node.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/*.mjs'] },
  'packages/schema/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/*.mjs'] },
  'packages/ui/tsconfig.project.base.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/page-types.mjs', 'src/templates/proni/record-view.js'] },
  'packages/api/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noPropertyAccessFromIndexSignature'], include: ['src/**/*.js', 'src/**/*.d.ts', '../../functions/_lib/runtime.d.mts'] },
  'packages/map/tsconfig.project.views.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/views/*.mjs'] },
  'packages/ui/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['assets/**/*.js', 'src/**/*.js', 'src/**/*.mjs'] },
  'packages/map/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/**/*.js', 'src/**/*.mjs', 'src/**/*.d.ts', 'app/**/*.js', 'src/renderer/port-plan-client.generated.json'] },
  'packages/loader/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/*.mjs'] },
  'packages/intake/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/*.mjs', 'src/frozen-clock/*.mjs'] },
  'packages/maps-pipeline/tsconfig.project.json': { flags: ['noImplicitReturns', 'noFallthroughCasesInSwitch', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'], include: ['src/*.mjs', 'src/thumbnails/*.mjs', 'src/tiles/feature-index-from-tiles.mjs', 'src/tiles/repair-alias-layers.mjs', 'src/tiles/tile-profiles.mjs', 'src/tiles/vector-intake.mjs'] },
};

// The exclude entries as of 18 Nov 2026: each names files another project of the same package
// compiles, or files on LEFT. Take entries out; never add one.
const EXCLUDE = {
  'packages/registries/tsconfig.project.browser.json': ['src/browser/build.mjs'],
  'packages/ui/tsconfig.project.json': ['src/page-types.mjs', 'src/templates/proni/record-view.js'],
  'packages/map/tsconfig.project.json': ['src/views/**', 'src/jquery-shim.js'],
};

// Package script files in no project, with their strict findings on 18 Nov 2026. Only shrinks.
const LEFT = [
  'packages/map/src/jquery-shim.js', // 106: a classic script loaded by URL
  'packages/maps-pipeline/src/tiles/assign-missing-label-properties.mjs', // 16
  'packages/maps-pipeline/src/tiles/download-sources.mjs', // 30
  'packages/maps-pipeline/src/tiles/feature-indexes.mjs', // 45
  'packages/maps-pipeline/src/tiles/layer-plan.mjs', // 35
  'packages/maps-pipeline/src/tiles/pmtiles.mjs', // 83
  'packages/maps-pipeline/src/tiles/promote-layers.mjs', // 95
  'packages/maps-pipeline/src/tiles/repair-label-text.mjs', // 11
  'packages/maps-pipeline/src/tiles/vector-batch.mjs', // 54
];

/** @param {string} file repository-relative */
function readJson(file) {
  const read = ts.readConfigFile(path.join(ROOT, file), ts.sys.readFile);
  assert.equal(read.error, undefined, `${file} does not parse`);
  return read.config;
}

/** @param {string} file repository-relative */
function parse(file) {
  const abs = path.join(ROOT, file);
  const parsed = ts.parseJsonConfigFileContent(readJson(file), ts.sys, path.dirname(abs), undefined, abs);
  assert.deepEqual(parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], `${file} has config errors`);
  return parsed;
}

const solution = readJson(SOLUTION);
const projects = solution.references.map((/** @type {{ path: string }} */ r) => rel(path.resolve(ROOT, 'config', r.path)));
const parsed = Object.fromEntries(projects.map((/** @type {string} */ p) => [p, parse(p)]));

/** The script files of packages/<dir> (absolute), node_modules left out. @param {string} dir */
function scriptFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scriptFiles(abs));
    else if (/\.(?:[cm]?js|d\.[cm]?ts|[cm]?ts)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

const packageDirs = readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(ROOT, 'packages', e.name, 'package.json')))
  .map((e) => e.name);

test('every package has a project, and the solution references every project on disk and nothing else', () => {
  assert.deepEqual(solution.files, [], 'the solution compiles nothing itself');
  const onDisk = packageDirs.flatMap((dir) => readdirSync(path.join(ROOT, 'packages', dir))
    .filter((name) => /^tsconfig\.project(?:\.[a-z-]+)?\.json$/.test(name))
    .map((name) => `packages/${dir}/${name}`));
  assert.deepEqual([...projects].sort(), [...onDisk].sort(), 'config/tsconfig.packages.json must reference exactly the packages/*/tsconfig.project*.json files');
  for (const dir of packageDirs) assert.ok(projects.some((/** @type {string} */ p) => p.startsWith(`packages/${dir}/`)), `packages/${dir} has no project`);
  assert.deepEqual(Object.keys(BASELINE).sort(), [...projects].sort(), 'a project joined or left: list it in BASELINE');
  for (const p of projects) {
    for (const r of parsed[p].projectReferences ?? []) {
      assert.ok(projects.includes(rel(r.path)), `${p} references ${rel(r.path)}, which is not a project of the solution`);
    }
  }
});

test('each project stays composite, strict and declaration-only into tmp/tsbuild/, with its flags set in it', () => {
  /** @type {Set<string>} */
  const outDirs = new Set();
  for (const p of projects) {
    const raw = readJson(p);
    assert.equal(raw.extends, undefined, `${p} must not inherit its flags`);
    const co = raw.compilerOptions;
    for (const flag of ['composite', 'declaration', 'emitDeclarationOnly', 'allowJs', 'checkJs', 'strict']) assert.equal(co[flag], true, `${p} turned ${flag} off`);
    assert.equal(co.noEmit, undefined, `${p} sets noEmit (tsc -b emits declarations)`);
    for (const flag of STRICT_FAMILY) assert.notEqual(co[flag], false, `${p} turned ${flag} off`);
    for (const flag of BASELINE[p].flags) assert.equal(co[flag], true, `${p} turned ${flag} off`);
    const outDir = rel(/** @type {string} */ (parsed[p].options.outDir));
    assert.match(outDir, /^tmp\/tsbuild\/[a-z-]+$/, `${p} emits outside tmp/tsbuild/`);
    assert.ok(!outDirs.has(outDir), `${p} shares its outDir ${outDir}`);
    outDirs.add(outDir);
    assert.equal(parsed[p].options.declarationDir, undefined, `${p} sets a declarationDir`);
  }
});

test('the include lists keep every entry, and the exclude lists only shrink', () => {
  for (const p of projects) {
    const raw = readJson(p);
    for (const entry of BASELINE[p].include) assert.ok(raw.include.includes(entry), `${p} lost the include entry ${entry}`);
    for (const entry of raw.exclude ?? []) assert.ok((EXCLUDE[p] ?? []).includes(entry), `${p} added the exclude entry ${entry}`);
  }
});

test('every package script file is compiled by exactly one project, or is LEFT', () => {
  /** @type {Map<string, string>} */
  const owner = new Map();
  for (const p of projects) {
    for (const abs of parsed[p].fileNames) {
      const f = rel(path.resolve(abs));
      if (!f.startsWith('packages/')) continue;
      assert.ok(!owner.has(f), `${f} is compiled by both ${owner.get(f)} and ${p}`);
      owner.set(f, p);
    }
  }
  for (const dir of packageDirs) {
    for (const abs of scriptFiles(path.join(ROOT, 'packages', dir))) {
      const f = rel(abs);
      if (LEFT.includes(f)) assert.ok(!owner.has(f), `${f} joined ${owner.get(f)}: take it off LEFT`);
      else assert.ok(owner.has(f), `${f} is in no project of config/tsconfig.packages.json: add it to its package's project`);
    }
  }
  for (const f of LEFT) assert.ok(existsSync(path.join(ROOT, f)), `${f} is gone: take it off LEFT`);
});

test('no compiled file silences the checker', () => {
  for (const p of projects) {
    for (const abs of parsed[p].fileNames) {
      if (abs.endsWith('.json')) continue;
      const text = readFileSync(abs, 'utf8');
      assert.doesNotMatch(text, /@ts-(?:nocheck|ignore|expect-error)/, `${rel(abs)} silences the type check`);
      assert.doesNotMatch(text, /\{\s*any(?:\[\])?\s*\}/, `${rel(abs)} declares an any`);
    }
  }
});

test('check:types:packages runs tsc -b over the solution, in the check chain and the landing gates', () => {
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['check:types:packages'], 'node node_modules/typescript/bin/tsc -b config/tsconfig.packages.json');
  assert.match(scripts.check, /npm run check:types:packages(?: |$)/);
  const gates = JSON.parse(readFileSync(path.join(ROOT, 'config', 'worktrees.json'), 'utf8')).landing.gates;
  assert.ok(gates.includes('check:types:packages'), 'config/worktrees.json landing.gates lacks check:types:packages');
});
