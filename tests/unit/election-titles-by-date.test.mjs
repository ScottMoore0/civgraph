// Titles the election-bodies registry gives outright (titlesByDate), for elections named for what
// was held rather than by their body's template: the Dáil's 1921 record holds the Southern Ireland
// general election that returned the Second Dáil (Phelim Birch's catalogue review #96). Keys and
// URLs are unchanged; only the title is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalElectionTitle } from '../../scripts/lib/election-names.mjs';
import { REPO_ROOT, loadRegistry } from '../../packages/registries/src/index.mjs';
import { electionBody, generalElectionTitleOf, jurisdictionLabel } from '../../packages/registries/src/election-bodies.mjs';

const DAIL = { body: 'Dáil Éireann', bodySlug: 'dail-eireann' };
/** @param {number} n */
const seats = (n) => Array.from({ length: n }, (_, i) => `C${i}`);

test('the Dáil\'s 1921 record is titled as the Southern Ireland general election (#96)', () => {
  const title = '1921 Southern Ireland general election (Second Dáil)';
  assert.equal(canonicalElectionTitle({ ...DAIL, date: '1921-05-24', constituencies: seats(28) }), title);
  // A registry title is never given a month, though the body held another general election that year.
  assert.equal(canonicalElectionTitle({ ...DAIL, date: '1921-05-24', constituencies: seats(28), sameYearGeneral: true }), title);
  assert.equal(generalElectionTitleOf(electionBody(loadRegistry('election-bodies'), 'dail-eireann'), '1921-05-24'), title);
});

test('the Dáil\'s other elections keep the titles the code gives them', () => {
  assert.equal(canonicalElectionTitle({ ...DAIL, date: '1923-08-27', constituencies: seats(30) }), '1923 Irish general election');
  assert.equal(canonicalElectionTitle({ ...DAIL, date: '1927-06-09', constituencies: seats(30), sameYearGeneral: true }), 'June 1927 Irish general election');
  assert.equal(canonicalElectionTitle({ ...DAIL, date: '1925-03-11', constituencies: ['Dublin North'] }), '1925 Dublin North by-election');
  // The Dáil is registered for its titles alone: it says where its elections were held, as before.
  assert.equal(jurisdictionLabel(electionBody(loadRegistry('election-bodies'), 'dail-eireann')), 'Republic of Ireland');
});

test('the committed catalogue carries the registry titles, and the 1918 election is still all-Ireland', () => {
  const catalogue = JSON.parse(readFileSync(path.join(REPO_ROOT, 'data/catalogue/catalogue.json'), 'utf8'));
  /** @param {string} key */
  const rec = (key) => catalogue.elections.find((/** @type {{ key: string }} */ e) => e.key === key);
  assert.equal(rec('dail-eireann__1921-05-24')?.title, '1921 Southern Ireland general election (Second Dáil)');
  assert.equal(rec('dail-eireann__1921-05-24')?.scope, 'Republic of Ireland');
  // Placed by its date before the registry's jurisdiction is asked (scripts/build/catalogue/build-catalogue.mjs).
  assert.equal(rec('dail-eireann__1918-12-14')?.scope, 'Ireland');
});
