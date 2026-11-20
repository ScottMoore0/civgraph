// The editor-time mirror of check:boundaries (scripts/check/eslint-boundaries.mjs, stream w20-refactor2,
// 20 Nov 2026): the eslint rule civgraph/boundaries gives check:boundaries' verdicts, eslint.config.mjs
// turns it on, and on the repository as it stands it agrees with the gate (every tracked edge allowed).
//
//   node --test tests/unit/eslint-boundaries.test.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { edges } from '../../scripts/check/boundaries.mjs';
import { repoPath, violations } from '../../scripts/check/eslint-boundaries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a forbidden import, node:* where a unit has no Node, an unresolved name and an engine API are flagged', () => {
  assert.equal(violations('packages/core/src/zz.mjs', '../../storage/src/d1.js').length, 1, 'core may not import storage');
  assert.match(violations('packages/core/src/zz.mjs', 'node:fs')[0] ?? '', /core may not import node:\*/);
  assert.match(violations('packages/core/src/zz.mjs', '@civgraph/no-such-package')[0] ?? '', /no export/);
  assert.match(violations('packages/map/src/zz.mjs', '@aws-sdk/client-s3')[0] ?? '', /engine API/);
  assert.equal(violations('packages/loader/src/zz.mjs', 'node:sqlite').length, 1, 'the loader opens SQLite through packages/storage');
  assert.equal(violations('functions/zz.js', '../scripts/lib/config.mjs').length, 1, 'functions may not import scripts');
});

test('allowed imports, npm names and files in no unit pass', () => {
  assert.deepEqual(violations('packages/core/src/zz.mjs', './format.js'), []);
  assert.deepEqual(violations('packages/map/src/zz.mjs', '../../core/src/format.js'), []);
  assert.deepEqual(violations('scripts/build/zz.mjs', 'node:fs'), []);
  assert.deepEqual(violations('packages/storage/src/sqlite.mjs', 'node:sqlite'), []);
  assert.deepEqual(violations('packages/core/src/zz.mjs', 'maplibre-gl'), []);
  assert.deepEqual(violations('zz-root-file.mjs', '../anything.js'), []);
  assert.equal(repoPath(path.join(ROOT, 'packages', 'core', 'src', 'x.mjs')), 'packages/core/src/x.mjs');
  assert.equal(repoPath(path.join(ROOT, '..', 'elsewhere.mjs')), null);
});

test('the rule and check:boundaries read each edge through the same function', () => {
  // Both take their verdict from boundaries.mjs's edgeOf, so they cannot disagree; check:boundaries
  // passes with an empty baseline, so `npm run lint` finds nothing under this rule either.
  const all = edges();
  assert.ok(all.length > 1000, 'check:boundaries reads the tracked imports');
  assert.deepEqual(all.filter((e) => !e.ok).map((e) => `${e.file} -> ${e.target}`), []);
  for (const e of all.filter((x) => x.to === 'node:*')) assert.ok(violations(e.file, e.target).length, `${e.file} -> ${e.target}`);
});

test('eslint.config.mjs runs the rule, as an error, and it reports where the import is written', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const config = await eslint.calculateConfigForFile(path.join(ROOT, 'packages', 'core', 'src', 'format.js'));
  assert.deepEqual(config.rules['civgraph/boundaries'], [2]);
  const [result] = await eslint.lintText("import { x } from '../../storage/src/d1.js';\nexport { x };\n", { filePath: path.join(ROOT, 'packages', 'core', 'src', 'zz-eslint-boundaries.mjs') });
  const hits = (result?.messages ?? []).filter((m) => m.ruleId === 'civgraph/boundaries');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.line, 1);
  assert.match(hits[0]?.message ?? '', /core may not import storage/);
});
