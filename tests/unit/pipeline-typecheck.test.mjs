/**
 * The pipeline type check (tsconfig.pipeline.json, npm run check:types:pipeline) keeps
 * noImplicitAny on (the 8 Nov 2026 review, stream S3) over scripts/publish, scripts/i18n,
 * scripts/maps and scripts/dev, and those folders carry no type-check suppressions.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

// Stream rf9-pipeline-types (12 Nov 2026): the pipeline and tools scripts under full strict plus
// noUnusedLocals and noUnusedParameters, the Node ones in tsconfig.pipeline-strict.json and the
// catalogue editor's browser script in tsconfig.tools-browser.json. Every script in these places
// is checked by one of them, and neither config loosens.
const STRICT_CONFIGS = ['tsconfig.pipeline-strict.json', 'tsconfig.tools-browser.json'];
const STRICT_FLAGS = ['strict', 'noImplicitAny', 'strictNullChecks', 'useUnknownInCatchVariables', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn', 'noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns'];
// Folders, and single-level folders (a trailing /*), whose every script must be checked.
const STRICT_PLACES = ['scripts/publish', 'scripts/maps', 'scripts/dev', 'tools', 'packages/maps-pipeline/src/thumbnails', 'scripts/*'];
const SCRIPT = /\.(m?js|cjs)$/;

/** The files a config checks (repository-relative), as tsc resolves its include list. */
async function checkedFiles(/** @type {string} */ name) {
  const ts = (await import('typescript')).default;
  const abs = path.join(REPO_ROOT, 'config', name);
  const read = ts.readConfigFile(abs, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(abs), undefined, abs);
  return parsed.fileNames.map((f) => path.relative(REPO_ROOT, f).split(path.sep).join('/'));
}

/** The scripts of a place: a folder, walked, or `dir/*`, that folder's own files only. */
function scriptsOf(/** @type {string} */ place) {
  const shallow = place.endsWith('/*');
  const dir = shallow ? place.slice(0, -2) : place;
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel) => {
    for (const e of readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (!shallow && e.name !== 'state' && e.name !== 'node_modules') walk(child); }
      else if (SCRIPT.test(e.name)) out.push(child);
    }
  };
  walk(dir);
  return out;
}

/** The files git does not ignore: a local, gitignored one-off script (excluded in the config) is not the repository's. */
function notIgnored(/** @type {string[]} */ files) {
  if (!files.length) return files;
  let ignored = '';
  try { ignored = execFileSync('git', ['check-ignore', '--', ...files], { cwd: REPO_ROOT, encoding: 'utf8' }); }
  catch (e) { ignored = /** @type {{ stdout?: string }} */ (e).stdout ?? ''; }
  const out = new Set(ignored.split('\n').map((l) => l.trim()).filter(Boolean));
  return files.filter((f) => !out.has(f));
}

test('the strict pipeline and tools configs keep full strict and noUnused* on', () => {
  for (const name of STRICT_CONFIGS) {
    const c = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config', name), 'utf8'));
    for (const flag of STRICT_FLAGS) assert.equal(c.compilerOptions[flag], true, `${name} turned ${flag} off`);
    assert.equal(c.extends, undefined, `${name} must not inherit its flags`);
  }
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const name of STRICT_CONFIGS) assert.match(pkg.scripts['check:types:pipeline'], new RegExp(`config/${name.replaceAll('.', '\.')}`));
  assert.match(pkg.scripts.check, /npm run check:types:pipeline/);
});

test('every pipeline and tools script is checked under strict with noUnused*', async () => {
  const checked = new Set((await Promise.all(STRICT_CONFIGS.map(checkedFiles))).flat());
  const missing = notIgnored(STRICT_PLACES.flatMap(scriptsOf).filter((f) => !checked.has(f)));
  assert.deepEqual(missing, [], 'a script here joins tsconfig.pipeline-strict.json (Node) or tsconfig.tools-browser.json (browser)');
});

test('no type-check suppressions in the tools and thumbnail scripts', () => {
  const found = ['tools', 'packages/maps-pipeline/src/thumbnails', 'scripts/*'].flatMap(scriptsOf)
    .filter((f) => /@ts-(nocheck|ignore|expect-error)/.test(readFileSync(path.join(REPO_ROOT, f), 'utf8')));
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

// Every scripts/build and scripts/check/rules file is typed since 13 Nov 2026 (stream
// rf10-build-types): each is listed in tsconfig.pipeline.json, or, for the three that drive a
// browser through Playwright, in tsconfig.pipeline-playwright.json (the DOM library on top of the
// same full-strict options).
const playwright = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config', 'tsconfig.pipeline-playwright.json'), 'utf8').replaceAll('"../', '"'));

test('every scripts/build and scripts/check/rules file is in a strict pipeline config', () => {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.m?js$/.test(e.name)) files.push(rel);
    }
  };
  walk('scripts/build');
  walk('scripts/check/rules');
  const listed = new Set([...config.include, ...playwright.include]);
  assert.deepEqual(files.filter((f) => !listed.has(f)), [], 'a new scripts/build or scripts/check/rules file joins tsconfig.pipeline.json (or tsconfig.pipeline-playwright.json if its page callbacks need the DOM)');
  assert.ok(TYPED_BUILD_AND_RULES.length >= 109, `${TYPED_BUILD_AND_RULES.length} build and check-rule files listed in tsconfig.pipeline.json; fewer than the 109 typed on 13 Nov 2026`);
});

test('tsconfig.pipeline-playwright.json keeps the pipeline options under full strict, with the DOM library', () => {
  const o = playwright.compilerOptions;
  assert.equal(o.strict, true);
  assert.equal(o.noImplicitAny, true);
  assert.ok(o.lib.includes('dom'), 'the page callbacks need the DOM types');
  for (const [key, value] of Object.entries(config.compilerOptions)) {
    if (key !== 'lib') assert.deepEqual(o[key], value, `${key} as in tsconfig.pipeline.json`);
  }
  for (const entry of ['scripts/build/og-preview.mjs', 'scripts/build/render_cited_sources.mjs', 'scripts/check/rules/general-parity.mjs']) assert.ok(playwright.include.includes(entry), entry);
});
