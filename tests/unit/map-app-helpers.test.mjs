// Pure helpers of the map app (src/map/app/helpers.mjs, frontend-plan.md 5.2): moved out of
// app/src/app.js unchanged.
//
//   node --test tests/unit/map-app-helpers.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalEntityKind,
  electionBodyFromEntityKey,
  electionTypeFromEntityKey,
  entityBrowseSearchUrl,
  entityKeyLabel,
  escapeHtml,
  formatBytes,
  mapWithConcurrency,
  normalizeEntityName,
  normalizeSearchText,
  pageParamOf,
  parsePageParam,
  shortCacheName,
  slugifyEntityKey
} from '../../src/map/app/helpers.mjs';
import { entityKey as browseSlug } from '../../scripts/records/browse-columns.mjs';

test('escapeHtml escapes the five HTML characters and stringifies null', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});

test('slugifyEntityKey drops the party part, accents and prefixes', () => {
  assert.equal(slugifyEntityKey('Seán Lemass|Fianna Fáil'), 'sean-lemass');
  assert.equal(slugifyEntityKey('party:Sinn Féin'), 'sinn-fein');
  assert.equal(slugifyEntityKey('Ulster Unionist & Co'), 'ulster-unionist-and-co');
  assert.equal(slugifyEntityKey(''), '');
});

test('slugifyEntityKey matches the records build (scripts/records/browse-columns.mjs)', () => {
  for (const value of ['Seán Lemass|Fianna Fáil', 'party:Sinn Féin', "O'Neill, Terence", 'name:Ian Paisley']) {
    assert.equal(slugifyEntityKey(value), browseSlug(value), value);
  }
});

test('normalizeEntityName folds case, accents, brackets and punctuation', () => {
  assert.equal(normalizeEntityName('Éamon de Valera (Clare)|FF'), 'eamon de valera');
  assert.equal(normalizeEntityName('Down & Antrim-North'), 'down and antrim north');
});

test('election body and type from an entity key', () => {
  assert.equal(electionBodyFromEntityKey('dail-eireann__1923'), 'Dáil Éireann');
  assert.equal(electionBodyFromEntityKey('local-government-districts__1973'), 'Local Government Districts');
  assert.equal(electionBodyFromEntityKey('belfast-county-borough__1946'), 'Belfast County Borough');
  assert.equal(electionBodyFromEntityKey(''), '');
  assert.equal(electionTypeFromEntityKey('dail-eireann__1923'), 'Dáil');
  assert.equal(electionTypeFromEntityKey('strabane-urban-district__1949'), 'Local');
  assert.equal(electionTypeFromEntityKey('ireland-referendum__2015', ''), 'Referendum');
  assert.equal(electionTypeFromEntityKey('seanad-eireann__1938'), 'Seanad');
  assert.equal(electionTypeFromEntityKey(''), 'Election');
});

test('formatBytes and shortCacheName', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(shortCacheName('civgraph-test2-sw-v3-runtime'), 'runtime');
  assert.equal(shortCacheName('civgraph-static-abc'), 'static-abc');
});

test('normalizeSearchText', () => {
  assert.equal(normalizeSearchText('  Baile Átha Cliath / Dublin '), 'baile atha cliath dublin');
});

test('page= parameter round trip', () => {
  assert.equal(pageParamOf({ kind: 'candidate', key: 'ian-paisley-48601' }), 'person:ian-paisley-48601');
  assert.equal(pageParamOf({ kind: 'party', key: 'dup' }), 'party:dup');
  assert.equal(pageParamOf(null), '');
  assert.deepEqual(parsePageParam('person:ian-paisley-48601'), { kind: 'candidate', key: 'ian-paisley-48601' });
  assert.deepEqual(parsePageParam('feature:abc:1'), { kind: 'feature', key: 'abc:1' });
  assert.deepEqual(parsePageParam('dea:lagan'), { kind: 'dea', key: 'lagan' });
  assert.equal(parsePageParam('nonsense:x'), null);
  assert.equal(parsePageParam('party:'), null);
  assert.equal(parsePageParam('party'), null);
  assert.equal(canonicalEntityKind('Person'), 'candidate');
  assert.equal(canonicalEntityKind('feature'), '');
});

test('entityKeyLabel and entityBrowseSearchUrl', () => {
  assert.equal(entityKeyLabel('candidate', '48601'), 'Person 48601');
  assert.equal(entityKeyLabel('candidate', 'ian-paisley-48601'), 'Ian Paisley');
  assert.equal(entityKeyLabel('party', 'Sinn Féin|SF'), 'Sinn Féin');
  assert.equal(entityBrowseSearchUrl('party', 'Sinn Féin|SF'), '/browse/#/parties?q=Sinn%20F%C3%A9in');
  assert.equal(entityBrowseSearchUrl('candidate', 'X'), '/browse/#/persons?q=X');
  assert.equal(entityBrowseSearchUrl('lgd', 'X'), '/browse/#/features?q=X');
});

test('mapWithConcurrency keeps order and the limit', async () => {
  let running = 0;
  let peak = 0;
  const results = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms, index) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running -= 1;
    return index * 10;
  });
  assert.deepEqual(results, [0, 10, 20, 30]);
  assert.equal(peak, 2);
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
});
