// Curly apostrophes read as the straight one (owner-approved 12 Nov 2026; measured in
// C:\Users\scomo\civgraph-apostrophe-impact\REPORT.txt):
//   - the name key (packages/core/src/election-domain.mjs normalizeName and its map-app copies),
//     which matches a candidate to the previous result and count sheets to candidates;
//   - search (packages/core/src/format.js foldSearchText), on the stored search columns and the
//     query, so "O'Neill" finds "O’Neill" and the other way round.
// Neither touches person ids, slugs or addresses: slugify drops every apostrophe already.
//
//   node --test tests/unit/apostrophe-fold.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeName, normalizeNameUncached } from '../../packages/core/src/election-domain.mjs';
import { foldSearchText, personSlug, slugify } from '../../packages/core/src/format.js';
import { normalizeEntityName } from '../../packages/map/src/app/helpers.mjs';
import { searchText } from '../../packages/loader/src/browse-columns.mjs';

const RIGHT = '\u2019';
const LEFT = '\u2018';

test("the name key reads ’ ‘ and ` as the straight apostrophe", () => {
  for (const form of [`O${RIGHT}Neill`, `O${LEFT}Neill`, 'O`Neill', "O'Neill"]) {
    assert.equal(normalizeNameUncached(form), 'oneill');
    assert.equal(normalizeName(form), 'oneill');
    assert.equal(normalizeEntityName(`${form}|SDLP`), 'oneill');
  }
  assert.equal(normalizeName(`A. M${RIGHT}Bride`), normalizeName("A. M'Bride"));
});

test('the name key is otherwise unchanged', () => {
  assert.equal(normalizeName('Éamon de Valera (Clare)'), 'eamon de valera');
  assert.equal(normalizeName('Down & Antrim-North'), 'down and antrim north');
  assert.equal(normalizeName("D'Arcy, J."), 'darcy j');
});

test('search folds accents, case and apostrophes, and keeps everything else', () => {
  assert.equal(foldSearchText(`Mícheál O${RIGHT}Neill`), "micheal o'neill");
  assert.equal(foldSearchText("O'NEILL"), "o'neill");
  assert.equal(foldSearchText(`${LEFT}quoted${RIGHT}`), "'quoted'");
  assert.equal(foldSearchText('Fianna Fáil - Cork North-Central'), 'fianna fail - cork north-central');
  assert.equal(foldSearchText(null), '');
  assert.equal(foldSearchText(undefined), '');
});

test('a straight query finds a curly name in the stored search text, and the other way round', () => {
  const curly = searchText({ title: `Laura O${RIGHT}Neill` });
  const straight = searchText({ title: "Laura O'Neill" });
  assert.equal(curly, straight);
  for (const query of ["o'neill", `O${RIGHT}Neill`, `o${LEFT}neill`]) {
    assert.ok(curly.includes(foldSearchText(query)), query);
    assert.ok(straight.includes(foldSearchText(query)), query);
  }
});

test('slugs, and so person addresses, do not change', () => {
  assert.equal(slugify(`O${RIGHT}Neill`), 'o-neill');
  assert.equal(slugify("O'Neill"), 'o-neill');
  assert.equal(personSlug('141017', `Henry O${RIGHT}H. O${RIGHT}Neill`), personSlug('141017', "Henry O'H. O'Neill"));
});
