// The map app's type-check allowlist (packages/map/tsconfig.check.json, src/tsconfig.check.json until
// rf9-mapapp moved src/ into packages/map, 12 Nov 2026; npm run check:types:mapapp) only
// grows: every entry it had stays, each names files that exist, and no file it covers silences
// the checker. The check itself runs in the check chain.
//
//   node --test tests/unit/map-typecheck.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'packages', 'map');
const CONFIG = 'packages/map/tsconfig.check.json';
const config = JSON.parse(readFileSync(path.join(SRC, 'tsconfig.check.json'), 'utf8'));

// The allowlist as of 7 Nov 2026, relative to packages/map/ since the move (src/*.mjs, cdn-url.js
// and the rest were src/ files). Add to it; never take an entry out.
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
  'src/cdn-url.js',
  'src/election-utils.js',
  // 8 Nov 2026 (noImplicitAny review): the catalogue search joins the check.
  'src/catalogue/search.js'
];

/** The files a simple include pattern names (a file, dir/*.ext, or dir/**\/*.ext). */
function expand(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const [dir, rest] = pattern.includes('/**/') ? pattern.split('/**/') : [path.posix.dirname(pattern), path.posix.basename(pattern)];
  const ext = rest.replace('*', '');
  const deep = pattern.includes('/**/');
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
      const child = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (deep) walk(child); } else if (entry.name.endsWith(ext)) out.push(child);
    }
  };
  walk(dir);
  return out;
}

test('the allowlist keeps every entry it had', () => {
  for (const entry of BASELINE) assert.ok(config.include.includes(entry), `${CONFIG} lost ${entry}`);
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
});

test('each entry names files that exist, and none of them silences the checker', () => {
  for (const entry of config.include) {
    const files = expand(entry);
    assert.ok(files.length, `${entry} names no file`);
    for (const file of files) {
      assert.ok(existsSync(path.join(SRC, file)), `${file} is missing`);
      assert.doesNotMatch(readFileSync(path.join(SRC, file), 'utf8'), /@ts-(nocheck|ignore|expect-error)/, `${file} silences the type check`);
    }
  }
});

test('the check script runs this config', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:types:mapapp'], /-p packages\/map\/tsconfig\.check\.json$/);
  assert.match(pkg.scripts.check, /npm run check:types:mapapp/);
});

test('the strict flags stay on, strictNullChecks (round 3) and noImplicitAny (8 Nov 2026) among them', () => {
  const flags = ['strictNullChecks', 'noImplicitAny', 'strictBindCallApply', 'strictFunctionTypes', 'noImplicitThis', 'alwaysStrict',
    'useUnknownInCatchVariables', 'noImplicitReturns', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters',
    // full strict since 12 Nov 2026 (stream rf8-types)
    'strictPropertyInitialization', 'strictBuiltinIteratorReturn', 'strict'];
  for (const flag of flags) assert.equal(config.compilerOptions[flag], true, `${CONFIG} turned ${flag} off`);
  // `strict: false` or a stray override would not show above; the flag must be set here, not inherited.
  assert.equal(config.extends, undefined, `${CONFIG} must not inherit its flags`);
});
