/**
 * The election manifest builder's name key (scripts/lib/manifest-name-key.mjs): curly apostrophes
 * and the backtick fold as the straight one does (the w11-code follow-up of 12 Nov 2026), and
 * nothing else about the key changes.
 *
 *   Run with node --test on this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixText, manifestNameKey } from '../../scripts/lib/manifest-name-key.mjs';
import { normalizeName as coreNormalizeName } from '../../packages/core/src/election-domain.mjs';

// The key as it was before the fold (build-test2-election-manifest.mjs, main a36887c3fb).
const before = (/** @type {unknown} */ value) => fixText(value)
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\([^)]*\)/g, ' ')
  .replace(/&/g, ' and ')
  .replace(/['`]/g, '')
  .replace(/[‐-―-_/.,()]/g, ' ')
  .replace(/\bconstituency\b/gi, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

test('curly apostrophes and the backtick are the straight one: one key', () => {
  for (const name of ['James O’Neill', 'James O‘Neill', 'James O`Neill', "James O'Neill", 'JAMES ONEILL']) {
    assert.equal(manifestNameKey(name), 'james oneill', name);
  }
  assert.equal(manifestNameKey('A. M’Bride'), manifestNameKey("A. M'Bride"));
  // Before the fold the curly form kept its apostrophe in the key, so the two never met.
  assert.notEqual(before('A. M’Bride'), before("A. M'Bride"));
});

test('the key agrees with core normalizeName on apostrophes', () => {
  for (const name of ['Pádraig Ó’Ceallaigh', "Seán O'Brien", 'D’Arcy', 'M‘Cann']) {
    assert.equal(manifestNameKey(name), coreNormalizeName(name), name);
  }
});

test('every other part of the key is as before', () => {
  const samples = [
    'Dublin North (Central)', 'Ballyfermot–Drimnagh', 'Mid-Ulster', 'Fermanagh & South Tyrone',
    'Belfast West Constituency', 'Seán Ó Fearghaíl', 'Ãrd Mhacha', 'J. S. Johnston', 'Lisburn_Central',
    'Lurgan (councillors)', 'David Patterson (Lake St)', '  Wm.   G.  Gordon ', null, undefined, 42,
  ];
  for (const value of samples) assert.equal(manifestNameKey(value), before(value), String(value));
});

test('the manifest builder keys names with this module, and keeps no copy of the old fold', () => {
  const source = readFileSync(new URL('../../scripts/build/build-test2-election-manifest.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{ fixText, manifestNameKey \} from '\.\.\/lib\/manifest-name-key\.mjs';/);
  assert.match(source, /function normalizeNameUncached\(value\) \{\n {2}return manifestNameKey\(value\);\n\}/);
  assert.doesNotMatch(source, /\.replace\(\/\['+`\]\/g/);
  assert.doesNotMatch(source, /^function fixText\(/m);
});
