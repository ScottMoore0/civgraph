/**
 * The election viewer package's marked copies of package functions (architecture rule R2, check
 * C3). site/app/election-viewer-package/js/ are classic scripts (no import), so stages2.js and
 * election_viewer.js each keep a copy of packages/core/src/html.js escapeHtml, marked
 * `// copy-of: packages/core/src/html.js`. This test reads each copy out of its script and holds
 * it to the package's answers, so a copy cannot drift. Remove a copy (and its case here) when its
 * script becomes a module or is bundled.
 *
 *   node --test tests/unit/viewer-package-copies.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from '../../packages/core/src/html.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWER = 'site/app/election-viewer-package/js';

/**
 * The marked copy of `name` in a script: from its `copy-of:` line to the end of the function
 * (what lies between, such as a lookup table, comes with it), as a callable function.
 * @param {string} file
 * @param {string} name
 * @returns {(value: unknown) => string}
 */
function markedCopy(file, name) {
  const source = readFileSync(path.join(ROOT, VIEWER, file), 'utf8');
  const fn = source.indexOf(`function ${name}(`);
  assert.ok(fn > 0, `${file}: no function ${name}`);
  const marker = source.lastIndexOf('copy-of: packages/core/src/html.js', fn);
  assert.ok(marker > 0 && source.slice(marker, fn).split('\n').length <= 4, `${file}: ${name} is not marked copy-of: packages/core/src/html.js`);
  let depth = 0;
  let end = source.indexOf('{', fn);
  for (; end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}' && --depth === 0) break;
  }
  const chunk = source.slice(source.indexOf('\n', marker) + 1, end + 1);
  return /** @type {(value: unknown) => string} */ (new Function(`${chunk}\nreturn ${name};`)());
}

const INPUTS = [
  'plain text', '<b>bold</b> & "quoted" \'single\'', '&amp; already escaped', 'Sinn Féin — Ó Fiaich',
  '', 0, 42, 3.5, false, true, null, undefined, ['a', '<b>'], { toString: () => '<obj>' },
];

for (const file of ['stages2.js', 'election_viewer.js']) {
  test(`${file}: its escapeHtml answers as packages/core/src/html.js escapeHtml`, () => {
    const copy = markedCopy(file, 'escapeHtml');
    for (const value of INPUTS) assert.equal(copy(value), escapeHtml(value), `${file} escapeHtml(${String(value)})`);
  });
}
