// The Pages Functions' type check (functions/tsconfig.check.json, npm run check:types:functions)
// only tightens: every strict-family flag it has stays on, the flags are its own (not
// inherited), the check chain runs it, and no file it covers silences the checker.
//
//   node --test tests/unit/functions-types.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = path.join(ROOT, 'functions', 'tsconfig.check.json');
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

// The flags on since r2-functions (7 Nov 2026).
const FLAGS = ['strictNullChecks', 'strictBindCallApply', 'strictFunctionTypes', 'noFallthroughCasesInSwitch',
  'noImplicitThis', 'alwaysStrict', 'useUnknownInCatchVariables', 'strictPropertyInitialization',
  'strictBuiltinIteratorReturn', 'noImplicitReturns', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters',
  'exactOptionalPropertyTypes', 'checkJs'];

test('the strict-family flags stay on', () => {
  for (const flag of FLAGS) assert.equal(config.compilerOptions[flag], true, `functions/tsconfig.check.json turned ${flag} off`);
  // `strict: false` or an inherited override would not show above; the flags must be set here.
  assert.equal(config.extends, undefined, 'functions/tsconfig.check.json must not inherit its flags');
  assert.equal(config.compilerOptions.strict, undefined, 'functions/tsconfig.check.json sets each flag, not `strict`');
});

test('the check script runs this config', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:types:functions'], /functions\/tsconfig\.check\.json/);
  assert.match(pkg.scripts.check, /npm run check:types:functions/);
});

/** Every .js file under a directory, skipping node_modules. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no file the check covers silences it', () => {
  // The include's roots: functions/ and the packages' sources it names.
  const roots = ['functions', 'packages/storage/src', 'packages/api/src', 'packages/config/src', 'packages/core/src', 'packages/ui/src'];
  for (const root of roots) {
    for (const file of jsFiles(path.join(ROOT, root))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /@ts-(nocheck|ignore|expect-error)/, `${path.relative(ROOT, file)} silences the type check`);
    }
  }
});
