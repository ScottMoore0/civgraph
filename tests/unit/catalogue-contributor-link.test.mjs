// The map catalogue's contributor sign-in (src/catalogue/edit.js): offered signed out only on an
// address carrying ?contribute and from then on in that browser, with Browse's remembered flag
// (site/browse/browse.js contributorLinkWanted; QA 2026-11-11, M14).
//
//   node --test tests/unit/catalogue-contributor-link.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONTRIBUTOR_FLAG, contributorLinkWanted, suggestEditOffered } from '../../src/catalogue/edit.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), data };
}

test('?contribute offers the sign-in and is remembered; nothing else does', () => {
  const storage = memoryStorage();
  assert.equal(contributorLinkWanted({ search: '', storage }), false);
  assert.equal(contributorLinkWanted({ search: '?q=x', storage }), false);
  assert.equal(contributorLinkWanted({ search: '?contribute', storage }), true);
  assert.equal(storage.data.get(CONTRIBUTOR_FLAG), '1');
  assert.equal(contributorLinkWanted({ search: '', storage }), true);
  // Storage blocked: the address alone decides.
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(contributorLinkWanted({ search: '?contribute', storage: blocked }), true);
  assert.equal(contributorLinkWanted({ search: '', storage: blocked }), false);
});

test('Suggest an edit: signed-in readers always, signed-out ones only as contributors', () => {
  const storage = memoryStorage();
  assert.equal(suggestEditOffered(null, { search: '', storage }), false);
  assert.equal(suggestEditOffered({ authenticated: false, allowed: false }, { search: '', storage }), false);
  assert.equal(suggestEditOffered({ authenticated: true, allowed: false }, { search: '', storage }), true);
  assert.equal(suggestEditOffered({ authenticated: true, allowed: true }, { search: '', storage }), true);
  assert.equal(suggestEditOffered(null, { search: '?contribute', storage }), true);
});

test('the catalogue and Browse remember the same flag', () => {
  const browse = readFileSync(new URL('../../site/browse/browse.js', import.meta.url), 'utf8');
  assert.match(browse, new RegExp(`const CONTRIBUTOR_FLAG = '${CONTRIBUTOR_FLAG.replace(/\./g, '\\.')}';`));
  assert.match(browse, /new URLSearchParams\(location\.search\)\.has\('contribute'\)/);
});
