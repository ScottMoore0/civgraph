/**
 * The browser UI's type checking (tsconfig.ui.json, `npm run check:types:ui`) only grows.
 *
 *   - every browser script under browse/, apps/ and assets/ui/ is checked, or named in
 *     UI_TYPES_PENDING below with the reason it is not yet;
 *   - the files checked today stay checked (the allowlist cannot shrink);
 *   - no checked file opts out with @ts-nocheck or @ts-ignore, and @ts-expect-error stays at
 *     its count (none), so an error is fixed or annotated rather than silenced.
 *
 *   node --test tests/unit/ui-types.test.mjs
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.ui.json'), 'utf8'));
const UI_DIRS = ['browse', 'apps', 'assets/ui'];

// Browser scripts in UI_DIRS that tsconfig.ui.json does not check yet, with the reason.
export const UI_TYPES_PENDING = new Map([]);

// Checked since the slice that introduced the config; never removed.
const CHECKED_SINCE_TS_UI_1 = [
  'browse/browse.js',
  'apps/proni-search/app.js',
  'apps/words/words.js',
  'assets/ui/gallery/gallery.js',
];
const EXPECT_ERROR_BUDGET = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(m?js)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Whether a repository path matches one of tsconfig's include patterns (`*` within one folder). */
function included(rel) {
  return CONFIG.include.some((pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
    return re.test(rel);
  });
}

const uiScripts = UI_DIRS.flatMap((dir) => walk(dir));

test('every browser script of the UI is type-checked or pending with a reason', () => {
  const missing = uiScripts.filter((rel) => !included(rel) && !UI_TYPES_PENDING.has(rel));
  assert.deepEqual(missing, [], 'add these to tsconfig.ui.json include (or UI_TYPES_PENDING, with a reason)');
  for (const [rel, reason] of UI_TYPES_PENDING) {
    assert.ok(uiScripts.includes(rel), `${rel} is pending but no longer exists`);
    assert.ok(String(reason).length > 10, `${rel} needs a reason`);
  }
});

test('the checked files stay checked', () => {
  for (const rel of CHECKED_SINCE_TS_UI_1) assert.ok(included(rel), `${rel} left tsconfig.ui.json include`);
  assert.equal(CONFIG.compilerOptions.checkJs, true);
  assert.equal(CONFIG.compilerOptions.noEmit, true);
});

test('no checked file silences the checker', () => {
  let expectError = 0;
  for (const rel of uiScripts.filter(included)) {
    const text = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/@ts-nocheck|@ts-ignore/.test(text), `${rel} uses @ts-nocheck or @ts-ignore`);
    expectError += (text.match(/@ts-expect-error/g) || []).length;
  }
  assert.ok(expectError <= EXPECT_ERROR_BUDGET, `@ts-expect-error count ${expectError} > ${EXPECT_ERROR_BUDGET}`);
});

// The strict-family flags tsconfig.ui.json met on 7 Nov 2026 (r2-ui) and 8 Nov (r3-ui:
// strictNullChecks), and the files that check under full `strict` (tsconfig.ui-strict.json):
// neither list may shrink.
const FLAGS_SINCE_R2_UI = ['strictFunctionTypes', 'strictBindCallApply', 'noImplicitThis', 'alwaysStrict',
  'useUnknownInCatchVariables', 'noImplicitReturns', 'noImplicitOverride', 'noUnusedLocals', 'noUnusedParameters',
  'strictNullChecks'];
const STRICT_SINCE_R2_UI = ['assets/ui/state/machine.js', 'assets/ui/state/theme.js', 'browse/state-machines.js',
  'apps/proni-search/state-machines.js', 'apps/words/state-machines.js', 'assets/ui/gallery/gallery.js'];

test('the strictness the UI has reached stays', () => {
  for (const flag of FLAGS_SINCE_R2_UI) assert.equal(CONFIG.compilerOptions[flag], true, `tsconfig.ui.json ${flag} was turned off`);
  const strict = JSON.parse(readFileSync(path.join(ROOT, 'tsconfig.ui-strict.json'), 'utf8'));
  assert.equal(strict.extends, './tsconfig.ui.json');
  assert.equal(strict.compilerOptions.strict, true);
  for (const rel of STRICT_SINCE_R2_UI) assert.ok(strict.include.includes(rel), `${rel} left tsconfig.ui-strict.json include`);
  for (const rel of strict.include) assert.ok(included(rel), `${rel} is strict-checked but not in tsconfig.ui.json include`);
  for (const rel of strict.include) {
    assert.ok(!/@ts-nocheck|@ts-ignore|@ts-expect-error/.test(readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} silences the checker`);
  }
});
