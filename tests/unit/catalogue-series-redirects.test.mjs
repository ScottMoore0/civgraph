// Row redirects in the /maps catalogue: a merged row's old series/<id> link opens the row it went
// into (catalogue.source.json seriesRedirects; packages/map/src/catalogue/route-state.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { followSeriesRedirect, seriesRedirectProblems } from '@civgraph/map/catalogue/route-state.mjs';

const rows = new Set(['parking', 'heritage-sites']);
const has = (/** @type {string} */ id) => rows.has(id);

test('a retired row id leads to the row it was merged into', () => {
  assert.equal(followSeriesRedirect({ 'parking-meters': 'parking' }, 'parking-meters', has), 'parking');
  assert.equal(followSeriesRedirect({ 'parking-meters': 'parking' }, 'unknown', has), '');
  assert.equal(followSeriesRedirect(undefined, 'parking-meters', has), '');
});

test('a row merged twice is followed down the chain', () => {
  const r = { 'defence-heritage': 'heritage-surveys', 'heritage-surveys': 'heritage-sites' };
  assert.equal(followSeriesRedirect(r, 'defence-heritage', has), 'heritage-sites');
});

test('a loop or a chain that ends at no row leads nowhere', () => {
  assert.equal(followSeriesRedirect({ a: 'b', b: 'a' }, 'a', has), '');
  assert.equal(followSeriesRedirect({ a: 'gone' }, 'a', has), '');
  assert.equal(followSeriesRedirect({ a: 'a' }, 'a', has), '');
});

test('the check names a redirect from a live row, a loop and a dead end', () => {
  assert.deepEqual(seriesRedirectProblems({ 'parking-meters': 'parking' }, rows), []);
  const problems = seriesRedirectProblems({ parking: 'heritage-sites', a: 'b', b: 'a', c: 'gone' }, rows);
  assert.equal(problems.length, 4);
  assert.match(problems[0], /parking is still a row/);
  assert.match(problems.slice(1).join('\n'), /a -> b loops or ends at no row/);
  assert.match(problems.slice(1).join('\n'), /c -> gone loops or ends at no row/);
});

test('the catalogue as built: every redirect lands on a row, and the pane follows them', () => {
  const doc = JSON.parse(readFileSync('data/catalogue/catalogue.json', 'utf8'));
  const ids = new Set(doc.series.map((/** @type {{ id: string }} */ s) => s.id));
  assert.deepEqual(seriesRedirectProblems(doc.seriesRedirects, ids), []);
  const index = readFileSync('packages/map/src/catalogue/index.js', 'utf8');
  assert.match(index, /followSeriesRedirect\(this\.data\?\.seriesRedirects/);
});
