// The shared modules' type check (tsconfig.shared.json, npm run check:types:shared): packages/core's
// .mjs modules and the registries package, under full strict with noImplicitAny (the review of
// 8 Nov 2026). The flags stay on, the include list keeps every entry, each entry names files, none
// of them silences the checker, and the check runs in the chain.
//
//   node --test tests/unit/shared-types.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(ROOT, 'config', 'tsconfig.shared.json'), 'utf8').replaceAll('"../', '"'));

// The include list as of 8 Nov 2026. Add to it; never take an entry out.
const BASELINE = [
  'packages/core/src/*.mjs',
  'packages/registries/src/*.mjs',
  'packages/registries/src/browser/*.mjs',
  'packages/registries/src/seed/*.mjs'
];

/** The files an include entry names (a file, or dir/*.ext). */
function expand(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const dir = path.posix.dirname(pattern);
  const ext = path.posix.basename(pattern).replace('*', '');
  return readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith(ext)).map((name) => `${dir}/${name}`);
}

test('noImplicitAny and strict stay on, set here and not inherited', () => {
  assert.equal(config.compilerOptions.noImplicitAny, true, 'tsconfig.shared.json turned noImplicitAny off');
  assert.equal(config.compilerOptions.strict, true, 'tsconfig.shared.json turned strict off');
  for (const flag of ['strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply', 'noImplicitThis', 'useUnknownInCatchVariables', 'alwaysStrict']) {
    assert.notEqual(config.compilerOptions[flag], false, `tsconfig.shared.json turned ${flag} off`);
  }
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.extends, undefined, 'tsconfig.shared.json must not inherit its flags');
});

test('the include list keeps every entry it had', () => {
  for (const entry of BASELINE) assert.ok(config.include.includes(entry), `tsconfig.shared.json lost ${entry}`);
});

test('each entry names files, and none of them silences the checker', () => {
  for (const entry of config.include) {
    const files = expand(entry);
    assert.ok(files.length, `${entry} names no file`);
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      assert.doesNotMatch(text, /@ts-(nocheck|ignore|expect-error)/, `${file} silences the type check`);
      assert.doesNotMatch(text, /\{\s*any(\[\])?\s*\}/, `${file} declares an any`);
    }
  }
});

test('the check script runs this config with tsc -p, in the check chain', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:types:shared'], /tsc -p config\/tsconfig\.shared\.json/);
  assert.match(pkg.scripts.check, /npm run check:types:shared/);
});
