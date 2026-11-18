// The refactor's acceptance suite (scripts/check/acceptance.mjs over config/acceptance.json,
// rf-final): the file is well formed, a gap's measure is a ratchet both ways, and the shim and
// option readers say what they should. The suite itself runs with npm run test:acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ASSERTS, MEASURES, effectiveOptions, isShim, judgeGap, shapeProblems } from '../../scripts/check/acceptance.mjs';

const FILE = JSON.parse(readFileSync(new URL('../../config/acceptance.json', import.meta.url), 'utf8'));

test('config/acceptance.json: every criterion is well formed, with existing evidence and known measures', () => {
  assert.deepEqual(shapeProblems(FILE), []);
  const ids = FILE.criteria.map((c) => c.id);
  for (const id of ['A1', 'A2', 'A3', 'A4', 'A5']) assert.ok(ids.includes(id), `the owner's acceptance test ${id} is listed`);
});

test('a gap passes only at its recorded value: growth is a regression, shrinkage must be written down', () => {
  assert.equal(judgeGap({ measure: 'm', value: 3 }, 3).ok, true);
  assert.match(judgeGap({ measure: 'm', value: 3 }, 4).detail, /regression/);
  assert.match(judgeGap({ measure: 'm', value: 3 }, 2).detail, /record 2/);
  assert.match(judgeGap({ measure: 'm', value: 1 }, 0).detail, /mark the criterion met/);
  assert.match(shapeProblems({ criteria: [{ id: 'X', title: 'x', status: 'met', evidence: {}, gaps: [{ measure: 'old-path-shims', value: 1 }] }] })[0] ?? '', /met, but lists gaps/);
  assert.match(shapeProblems({ criteria: [{ id: 'X', title: 'x', status: 'open', evidence: {} }] })[0] ?? '', /lists no gap/);
});

test('a shim is nothing but re-exports, and a Pages route is not one', () => {
  assert.equal(isShim("// Moved.\nexport * from '../views/legend-view.mjs';\n"), true);
  assert.equal(isShim("export { a, b } from '@civgraph/core/html.js';\nexport * from './x.js';\n"), true);
  assert.equal(isShim("export { onRequestGet } from '@civgraph/api/handlers/persons/index.js';\n"), false);
  assert.equal(isShim("import x from './x.js';\nexport default x;\n"), false);
});

test('the measures and assertions answer on this tree', async () => {
  assert.equal(typeof (await MEASURES['old-path-shims']('')), 'number');
  assert.equal(effectiveOptions('config/tsconfig.ui-strict.json').strict, true, 'extends is followed');
  assert.equal(ASSERTS.file('config/acceptance.json').ok, true);
  assert.equal(ASSERTS.file('config/no-such-file.json').ok, false);
});
