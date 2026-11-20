// The map app's type check. Until 20 Nov 2026 it was its own allowlist, packages/map/tsconfig.check.json
// (src/tsconfig.check.json until rf9-mapapp moved src/ into packages/map, 12 Nov 2026), run by
// npm run check:types:mapapp. Stream w20-refactor2 retired that config: every file it covered is in
// the map's package projects (packages/map/tsconfig.project.json and tsconfig.project.views.json),
// and core's, which npm run check:types:packages builds with the same flags and environment (the
// DOM, bundler resolution). This test holds what the allowlist held: every entry it had stays
// checked, none of those files silences the checker, and the strict flags stay on.
//
//   node --test tests/unit/map-typecheck.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'packages', 'map');
const PROJECTS = ['packages/map/tsconfig.project.json', 'packages/map/tsconfig.project.views.json', 'packages/core/tsconfig.project.json'];

/** @param {string} file repository-relative */
function parse(file) {
  const abs = path.join(ROOT, file);
  const read = ts.readConfigFile(abs, ts.sys.readFile);
  assert.equal(read.error, undefined, `${file} does not parse`);
  return { raw: read.config, parsed: ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(abs), undefined, abs) };
}

/** Every file the projects check, relative to packages/map/ as the old allowlist named them. */
const CHECKED = new Set(PROJECTS.flatMap((p) => parse(p).parsed.fileNames)
  .map((f) => path.relative(SRC, path.resolve(f)).split(path.sep).join('/')));

// The old allowlist's entries: those of 7 Nov 2026 and every one added since, relative to
// packages/map/. Each must stay checked; add to it, never take an entry out.
const BASELINE = [
  '../core/src/state-machine.mjs',
  'src/state-helpers.mjs',
  'src/app/**/*.mjs',
  'src/election/*.mjs',
  'src/*.mjs',
  'src/renderer/config.js',
  'src/renderer/utils.js',
  'src/renderer/labels.js',
  'src/renderer/feature-property-repairs.js',
  'src/renderer/approximate-segments.js',
  'src/renderer/layer-load.mjs',
  'src/renderer/layer-kinds/*.mjs',
  'src/renderer/indexed-tiles.mjs',
  '../core/src/tile-index.mjs',
  '../core/src/dem-overzoom.mjs',
  'src/cdn-url.js',
  'src/election-utils.js',
  'src/renderer/gesture-state.mjs',
  'src/renderer/point-cloud-node-state.mjs',
  'src/catalogue/route-state.mjs',
  'src/catalogue/row-model.mjs',
  // 8 Nov 2026 (noImplicitAny review): the catalogue search joins the check.
  'src/catalogue/search.js',
  'src/globals.d.ts',
  'src/debug-log.js',
  'src/catalogue/flag.js',
  'src/catalogue/lang-reveal.js',
  'src/catalogue/util.js',
  'src/catalogue/geocoder.js',
  'src/app/map-app.d.ts',
  'src/app/legend.js',
  'src/app/performance.js',
  'src/app/site-chrome.js',
  'src/data-service.js',
  'src/feature-loader.js',
  'src/renderer/basemap.mjs',
  'src/renderer/point-cloud-layer.js',
  'src/renderer/point-cloud-stream-layer.js',
  'src/renderer/map-controller.js',
  'app/settle.js',
  'app/maplibre-main-adapter.js',
  'src/app/timeline/changes.js',
  'src/app/timeline/animation.js',
  'src/app/timeline/controls.js',
  'src/views/*.mjs',
  'src/catalogue/custom-icons.js',
  'src/catalogue/icons.js',
  'src/catalogue/styles.js',
  'src/catalogue/menu.js',
  'src/catalogue/slider.js',
  'src/catalogue/edit.js',
  'src/catalogue/split.js',
  'src/catalogue/catalogue-types.d.ts',
  'src/catalogue/view-books.js',
  'src/catalogue/view-elections.js',
  'src/catalogue/view-maps.js',
  'src/catalogue/index.js',
  'src/renderer/metadata-service.js',
  'app/overlay-worker.js',
  'app/search-worker.js',
  'src/fgb-worker.js',
  'app/map-image-export.js',
  'src/election/election-manager.d.ts',
  'src/election/grouped-year-methods.js',
  'src/election/election-group-methods.js',
  'app/ni-local-view.js',
  'app/election-manager.js',
  'app/election-pane-main-contract.js',
  // 14 Nov 2026 (rf11-map-ui): the UI controller joins the check, with its declarations.
  'src/ui-controller-types.d.ts',
  'src/ui-controller.js',
  'src/app/lazy-runtime.js',
  'src/app/mobile-layout.js',
  'src/app/messages.js',
  'src/app/catalogue-list.js',
  'src/app/search.js',
  // 14 Nov 2026 (rf12-map-ui): the method modules join, each with its typed `this`.
  'src/app/controls.js',
  'src/app/sources.js',
  'src/app/layers.js',
  'src/app/election-pane.js',
  'src/app/url-state.js',
  'src/app/entity-bridge.js',
  'src/app/ui-wiring.js',
  // and the app itself, with its boot.
  'app/app.js',
  'app/boot.js'
];

/** The files a simple include pattern names (a file, dir/*.ext, or dir/**\/*.ext). @param {string} pattern */
function expand(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const [dir, rest] = pattern.includes('/**/') ? pattern.split('/**/') : [path.posix.dirname(pattern), path.posix.basename(pattern)];
  const ext = String(rest).replace('*', '');
  const deep = pattern.includes('/**/');
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ rel) => {
    for (const entry of readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
      const child = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (deep) walk(child); } else if (entry.name.endsWith(ext)) out.push(child);
    }
  };
  walk(String(dir));
  return out;
}

test('the old config is retired, and no script runs it', () => {
  assert.equal(existsSync(path.join(SRC, 'tsconfig.check.json')), false, 'packages/map/tsconfig.check.json is back: the map projects check its files');
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:types:mapapp'], undefined);
  assert.doesNotMatch(pkg.scripts.check, /check:types:mapapp/);
  assert.match(pkg.scripts.check, /npm run check:types:packages/);
  const solution = parse('config/tsconfig.packages.json').raw;
  for (const p of PROJECTS) assert.ok(solution.references.some((/** @type {{ path: string }} */ r) => path.posix.join('config', r.path) === p), `${p} left the check:types:packages solution`);
});

test('every file the old allowlist checked is in a package project, and none silences the checker', () => {
  for (const entry of BASELINE) {
    const files = expand(entry);
    assert.ok(files.length, `${entry} names no file`);
    for (const file of files) {
      assert.ok(CHECKED.has(file), `${file} is in no map or core package project`);
      assert.doesNotMatch(readFileSync(path.join(SRC, file), 'utf8'), /@ts-(nocheck|ignore|expect-error)/, `${file} silences the type check`);
    }
  }
});

test('the map projects keep strict and the stricter flags the old config had', () => {
  const flags = ['strict', 'noImplicitReturns', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters', 'noFallthroughCasesInSwitch',
    // rf-final-mapflags, 18 Nov 2026
    'exactOptionalPropertyTypes',
    // w19-refactor-now, 19 Nov 2026
    'noUncheckedIndexedAccess',
    // w20-refactor, 20 Nov 2026
    'noPropertyAccessFromIndexSignature'];
  for (const p of PROJECTS) {
    const { raw, parsed } = parse(p);
    for (const flag of flags) assert.equal(raw.compilerOptions[flag], true, `${p} turned ${flag} off`);
    assert.equal(raw.extends, undefined, `${p} must not inherit its flags`);
    // `strict` covers the strict family the old config listed one by one; none is turned off.
    for (const flag of ['strictNullChecks', 'noImplicitAny', 'strictBindCallApply', 'strictFunctionTypes', 'noImplicitThis', 'alwaysStrict',
      'useUnknownInCatchVariables', 'strictPropertyInitialization', 'strictBuiltinIteratorReturn']) assert.notEqual(parsed.options[flag], false, `${p} turned ${flag} off`);
    assert.ok(parsed.options.lib?.some((l) => /dom/.test(l)), `${p} lost the DOM types the map app is checked with`);
  }
});
