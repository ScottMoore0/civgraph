// Browse's search across every record type (site/browse/search-all.js): the index page's groups,
// counts, "see all" links and the sentence a screen reader hears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEARCH_ALL_SHOWN, searchAllAnnouncement, sectionSearchHref, summariseSearchAll } from '../../site/browse/search-all.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ title: `Record ${i + 1}` }));

test("a section's search address carries the words, encoded", () => {
  assert.equal(sectionSearchHref('persons', 'Mícheál Martin'), '#/persons?q=M%C3%ADche%C3%A1l+Martin');
  assert.equal(sectionSearchHref('sources', 'a&b'), '#/sources?q=a%26b');
});

test('each section shows its first matches, its count and a link to all of them, in the order given', () => {
  const summary = summariseSearchAll('hume', [
    { type: 'maps', label: 'Maps', items: items(2), total: 2 },
    { type: 'persons', label: 'Persons', items: items(SEARCH_ALL_SHOWN), total: 12 },
  ]);
  assert.deepEqual(summary.groups.map((g) => g.type), ['maps', 'persons']);
  assert.equal(summary.groups[0].items.length, 2);
  assert.equal(summary.groups[0].count, '2 matches');
  assert.equal(summary.groups[0].seeAll, null, 'all of them are already shown');
  assert.equal(summary.groups[1].items.length, SEARCH_ALL_SHOWN);
  assert.equal(summary.groups[1].count, '12 matches');
  assert.equal(summary.groups[1].seeAll, 'See all in Persons');
  assert.equal(summary.groups[1].href, '#/persons?q=hume');
  assert.equal(summary.total, 14);
  assert.equal(summary.atLeast, false);
});

test('a section read whole is cut to the first few', () => {
  const summary = summariseSearchAll('ward', [{ type: 'elections', label: 'Elections', items: items(40), total: 40 }]);
  assert.equal(summary.groups[0].items.length, SEARCH_ALL_SHOWN);
  assert.equal(summary.groups[0].seeAll, 'See all in Elections');
});

test('sections with no match, or whose search failed, are named apart', () => {
  const summary = summariseSearchAll('zzz', [
    { type: 'maps', label: 'Maps', items: [], total: 0 },
    { type: 'parties', label: 'Parties / Labels', items: items(1), total: 1 },
    { type: 'sources', label: 'Books / Tables / Sources', items: [], total: 0, failed: true },
  ]);
  assert.deepEqual(summary.groups.map((g) => g.type), ['parties']);
  assert.equal(summary.groups[0].count, '1 match');
  assert.deepEqual(summary.empty, ['Maps']);
  assert.deepEqual(summary.failed, ['Books / Tables / Sources']);
});

test('a search that reports only a page (PRONI) says "more than" when the page is full', () => {
  const full = summariseSearchAll('workhouse', [{ type: 'proni', label: 'PRONI Records', items: items(SEARCH_ALL_SHOWN + 1), total: null }]);
  assert.equal(full.groups[0].items.length, SEARCH_ALL_SHOWN);
  assert.equal(full.groups[0].count, `More than ${SEARCH_ALL_SHOWN} matches`);
  assert.equal(full.groups[0].seeAll, 'See all in PRONI Records');
  assert.equal(full.atLeast, true);
  const few = summariseSearchAll('workhouse', [{ type: 'proni', label: 'PRONI Records', items: items(3), total: null }]);
  assert.equal(few.groups[0].count, '3 matches');
  assert.equal(few.groups[0].seeAll, null);
  assert.equal(few.atLeast, false);
});

test('numbers go through the formatter the page passes', () => {
  const format = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const summary = summariseSearchAll('a', [{ type: 'persons', label: 'Persons', items: items(5), total: 12345 }], { format });
  assert.equal(summary.groups[0].count, '12,345 matches');
  assert.equal(searchAllAnnouncement('a', summary, format), '12,345 matches for a in 1 section.');
});

test('the announcement counts the matches and the sections, or says there were none', () => {
  const summary = summariseSearchAll('hume', [
    { type: 'maps', label: 'Maps', items: items(1), total: 1 },
    { type: 'proni', label: 'PRONI Records', items: items(SEARCH_ALL_SHOWN + 1), total: null },
  ]);
  assert.equal(searchAllAnnouncement('hume', summary), `At least ${1 + SEARCH_ALL_SHOWN + 1} matches for hume in 2 sections.`);
  assert.equal(searchAllAnnouncement('zzz', summariseSearchAll('zzz', [])), 'No matches for zzz in any section.');
});
