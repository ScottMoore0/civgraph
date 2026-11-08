// The map app's type-check allowlist (src/tsconfig.check.json, npm run check:types:mapapp) only
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
const SRC = path.join(ROOT, 'src');
const config = JSON.parse(readFileSync(path.join(SRC, 'tsconfig.check.json'), 'utf8'));

// The allowlist as of 7 Nov 2026. Add to it; never take an entry out.
const BASELINE = [
  '../packages/core/src/state-machine.mjs',
  '../packages/map/src/state-helpers.mjs',
  '../packages/map/src/app/**/*.mjs',
  '../packages/map/src/election/*.mjs',
  '*.mjs',
  '../packages/map/src/renderer/config.js',
  '../packages/map/src/renderer/utils.js',
  '../packages/map/src/renderer/labels.js',
  '../packages/map/src/renderer/feature-property-repairs.js',
  '../packages/map/src/renderer/approximate-segments.js',
  'cdn-url.js',
  'election-utils.js',
  // 8 Nov 2026 (noImplicitAny review): the catalogue search joins the check.
  'catalogue/search.js'
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
  for (const entry of BASELINE) assert.ok(config.include.includes(entry), `src/tsconfig.check.json lost ${entry}`);
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
  assert.match(pkg.scripts['check:types:mapapp'], /src\/tsconfig\.check\.json/);
  assert.match(pkg.scripts.check, /npm run check:types:mapapp/);
});

test('the strict flags stay on, strictNullChecks (round 3) and noImplicitAny (8 Nov 2026) among them', () => {
  const flags = ['strictNullChecks', 'noImplicitAny', 'strictBindCallApply', 'strictFunctionTypes', 'noImplicitThis', 'alwaysStrict',
    'useUnknownInCatchVariables', 'noImplicitReturns', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters'];
  for (const flag of flags) assert.equal(config.compilerOptions[flag], true, `src/tsconfig.check.json turned ${flag} off`);
  // `strict: false` or a stray override would not show above; the flag must be set here, not inherited.
  assert.equal(config.extends, undefined, 'src/tsconfig.check.json must not inherit its flags');
});
