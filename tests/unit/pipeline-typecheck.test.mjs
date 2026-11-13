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
