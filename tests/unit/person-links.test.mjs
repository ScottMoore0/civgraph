/**
 * The one person-link helper (packages/core/src/format.js personSlug, personRecordKey,
 * personRecordPath; fast links, 12 Nov 2026) and the code that uses it: the Browse build's
 * person slugs, the server-rendered contest page, the Elections app, the catalogue's people
 * search; and the shared header's About link, which names the page, not its .html form (a 308).
 * That a contest page's links answer 200 is tests/functions/person-links.test.mjs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { personRecordKey, personRecordPath, personSlug } from '../../packages/core/src/format.js';
import { toHtmlString } from '../../packages/core/src/html.js';
import { electionBody } from '../../packages/ui/src/templates/records/election.js';
import { personUrl } from '../../site/apps/elections/lib/format.js';
import { countSheet } from '../../site/apps/elections/lib/count.js';
import { PeopleSearch } from '../../packages/map/src/catalogue/search.js';
import { footer, header } from '../../packages/ui/src/templates/shell.js';

test('personSlug: the Browse build\'s rule, name and registry id', () => {
  assert.equal(personSlug('51102', 'Naomi Long'), 'naomi-long-51102');
  assert.equal(personSlug(102046, 'Pádraig O\'Sullivan'), 'padraig-o-sullivan-102046');
  assert.equal(personSlug('7', '  Smith  &  Sons '), 'smith-and-sons-7');
  // A candidacy no registry id was found for: the name alone.
  assert.equal(personSlug('name:john-smith', 'John Smith'), 'john-smith');
  assert.equal(personSlug('', 'John Smith'), 'john-smith-entry');
});

test('personRecordKey: the person\'s own slug first, then name and id, then the id', () => {
  assert.equal(personRecordKey({ personSlug: 'robert-campbell-47167', personId: '47167', name: 'R. V. Campbell' }), 'robert-campbell-47167');
  assert.equal(personRecordKey({ personId: '47167', name: 'R. V. Campbell' }), 'r-v-campbell-47167');
  assert.equal(personRecordKey({ personSlug: null, personId: 47167 }), '47167', 'no name: the id, which the app and the page both resolve');
  assert.equal(personRecordKey({ personSlug: '', personId: null, name: 'A. Nobody' }), '');
  assert.equal(personRecordKey({ personId: '' }), '');
  assert.equal(personRecordKey(), '');
});

test('personRecordPath: /browse/persons/<key>, or null for no person', () => {
  assert.equal(personRecordPath({ personSlug: 'gerry-adams-27771', personId: '27771' }), '/browse/persons/gerry-adams-27771');
  assert.equal(personRecordPath({ personId: '27771', name: 'Gerry Adams' }), '/browse/persons/gerry-adams-27771');
  assert.equal(personRecordPath({ personId: 'name:a/b' }), '/browse/persons/name%3Aa%2Fb');
  assert.equal(personRecordPath({ name: 'A. Nobody' }), null);
});

test('the server-rendered contest page links candidates by slug', () => {
  const page = {
    kind: 'contest',
    election: { key: 'dail-eireann__2024-11-29', slug: 'dail-eireann-2024-11-29', title: '2024 Irish general election', body: 'Dáil Éireann', date: '2024-11-29', kind: null, votingSystem: 'STV', meta: {} },
    contest: { seq: 0, name: 'Cork North Central', slug: 'cork-north-central', seatsTotal: 4, electorate: null, quota: null, turnoutPct: null, sourceFile: null, meta: {} },
    candidates: [
      { ord: 0, name: 'R. V. Campbell', personId: '47167', personSlug: 'robert-campbell-47167', party: 'Independent', partyAsPrinted: null, colour: null, firstPrefs: 100, finalVotes: null, elected: 1, status: 'Elected' },
      { ord: 1, name: 'Naomi Long', personId: '51102', party: 'Alliance', partyAsPrinted: null, colour: null, firstPrefs: 90, finalVotes: null, elected: 1, status: 'Elected' },
      { ord: 2, name: 'A. Nobody', personId: null, party: 'Independent', partyAsPrinted: null, colour: null, firstPrefs: 1, finalVotes: null, elected: 0, status: 'Excluded' },
    ],
    citations: [],
  };
  const html = toHtmlString(electionBody(/** @type {any} */ (page), {}).body);
  const links = [...html.matchAll(/href="(\/browse\/persons\/[^"]+)"/g)].map((m) => m[1]);
  // The record's slug where the row has it; otherwise the name and id, which the page answers
  // directly unless the spelling differs (then a 301 through the id, never a miss).
  assert.deepEqual(links, ['/browse/persons/robert-campbell-47167', '/browse/persons/naomi-long-51102']);
});

test('the Elections app links a candidate by the person\'s slug the API gives', () => {
  assert.equal(personUrl('R. V. Campbell', '47167', 'robert-campbell-47167'), '/browse/persons/robert-campbell-47167');
  assert.equal(personUrl('Naomi Long', '51102'), '/browse/persons/naomi-long-51102');
  assert.equal(personUrl('X', null, 'x-1'), null);
  const [row] = countSheet([{ id: 'c1', name: 'R. V. Campbell', personId: 47167, personSlug: 'robert-campbell-47167', counts: [] }]).rows;
  assert.equal(row.personSlug, 'robert-campbell-47167');
});

test('the catalogue\'s people search makes a missing slug with the same rule', () => {
  const row = /** @type {any} */ (['96356', 'Sammy Wilson & Co']);
  assert.equal(PeopleSearch.slug(row), 'sammy-wilson-and-co-96356');
  row[10] = 'sammy-wilson-96356';
  assert.equal(PeopleSearch.url(row), '/browse/persons/sammy-wilson-96356');
});

test('the shared header and footer link About as /pages/about (the .html form answers 308)', () => {
  const chrome = `${String(header({ active: 'about' }))}${String(footer())}`;
  assert.equal((chrome.match(/href="\/pages\/about"/g) || []).length, 2);
  assert.doesNotMatch(chrome, /href="[^"]*\.html"/);
});
