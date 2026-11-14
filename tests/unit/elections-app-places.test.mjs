/**
 * The Elections app's places, people and parties (el-places, 14 Nov 2026): the search
 * (lib/search.js), the area model and its verdicts (lib/area.js, lib/verdict.js), the trend chart
 * (lib/trend.js), the person's career (lib/career.js), the party links (lib/party-links.js), the
 * URLs and routes, the API's area-history answer, and that every word is keyed for translation.
 * The last tests run over the records build (skipped without one): "Strangford", "Naomi Long" and
 * "Sinn Féin" find the right things, and the real area pages' verdicts.
 *
 *   node --test elections-app-places.test.mjs (in the unit tests)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSearchIndex, foldText, nameScore, rankPersons, searchIndex, wordsOf } from '../../site/apps/elections/lib/search.js';
import {
  boundaryChanges, contestModel, contestNeighbours, memberGrid, partyKeyFor, seriesOf, trendPoints,
} from '../../site/apps/elections/lib/area.js';
import { contestVerdict, majorityOf, seatChanges, seatTally } from '../../site/apps/elections/lib/verdict.js';
import { trendChart, trendTable } from '../../site/apps/elections/lib/trend.js';
import { careerRows, careerSummary, namesakes } from '../../site/apps/elections/lib/career.js';
import { partyHref } from '../../site/apps/elections/lib/party-links.js';
import { areaUrl, layerMapUrl, partyBrowseUrl, personAppUrl } from '../../site/apps/elections/lib/place-urls.js';
import { TEXT, fill } from '../../site/apps/elections/lib/places-text.js';
import { parseRoute } from '../../site/apps/elections/lib/route.js';
import { areaState } from '../../site/apps/elections/views/area.js';
import { personState } from '../../site/apps/elections/views/person.js';
import { searchHref, searchState } from '../../site/apps/elections/views/search-box.js';
import { areaHistoryAnswer } from '../../packages/api/src/handlers/elections/index.js';

const fmt = (/** @type {number} */ n) => n.toLocaleString('en-GB');

/** A contest of an area history, as the API answers it. */
function contest(over, candidates) {
  return {
    electionKey: `body__${over.date}`, electionSlug: `body-${over.date}`, displayTitle: `${over.date.slice(0, 4)} election`,
    body: 'Body', bodySlug: 'body', year: Number(over.date.slice(0, 4)), kind: 'general', contestType: 'election',
    votingSystem: 'fptp', contestStatus: 'contested', layerId: null, mapId: null, mapName: null,
    seq: 1, name: 'Seaview', contestSlug: 'seaview', seatsTotal: 1, electorate: null, turnoutPct: null, quota: null, majority: null,
    matched: false, ...over,
    candidates: candidates.map(([name, party, votes, elected, personId]) => ({ name, party, personId: personId ?? name.toLowerCase(), personSlug: null, firstPrefs: votes, elected, unopposed: null, status: elected ? 'Elected' : '', colour: '#123456' })),
  };
}

// ------------------------------------------------------------------ search

test('search folds case, accents and punctuation, and every word must begin a word', () => {
  assert.equal(foldText('Sinn Féin'), 'sinn fein');
  assert.equal(foldText("O'Neill, Michelle"), 'o neill michelle');
  assert.deepEqual(wordsOf('  Belfast  East '), ['belfast', 'east']);
  assert.equal(nameScore(['strangford'], wordsOf('Strangford')), 3);
  assert.equal(nameScore(['naomi', 'lo'], wordsOf('Naomi Long')), 2);
  assert.equal(nameScore(['long'], wordsOf('Naomi Long')), 1);
  assert.equal(nameScore(['long'], wordsOf('Belong')), 0);
});

test('search: places gather a name across bodies; parties answer to their other names; elections by title and year', () => {
  const index = buildSearchIndex({
    areas: [
      { slug: 'strangford', name: 'Strangford', bodySlug: 'commons', body: 'House of Commons', contests: 12, firstYear: 1983, lastYear: 2024 },
      { slug: 'strangford', name: 'Strangford', bodySlug: 'assembly', body: 'NI Assembly', contests: 7, firstYear: 1998, lastYear: 2022 },
      { slug: 'strangford-lough', name: 'Strangford Lough', bodySlug: 'x', body: 'X', contests: 1, firstYear: 1930, lastYear: 1930 },
    ],
    parties: [
      { id: 'party:sinn-fein', slug: 'sinn-fein', type: 'party', title: 'Sinn Féin', colour: '#326760', browseUrl: '/browse/parties/sinn-fein', knownAliases: ['SF'], totals: { stood: 4106 } },
      { id: 'party:workers-party', slug: 'workers-party', type: 'party', title: "Workers' Party", colour: '#c00', browseUrl: '', knownAliases: ['Sinn Féin Workers\''], totals: { stood: 900 } },
    ],
    elections: [{ key: 'ni__2022-05-05', displayTitle: '2022 Northern Ireland Assembly election', body: 'NI Assembly', bodySlug: 'a', date: '2022-05-05', year: 2022 }],
  });
  const s = searchIndex(index, 'strangford');
  assert.deepEqual(s.places.map((p) => p.slug), ['strangford', 'strangford-lough']);
  assert.deepEqual(s.places[0].bodies.map((b) => b.bodySlug), ['commons', 'assembly'], 'the most recent body first');
  assert.equal(s.places[0].contests, 19);
  assert.deepEqual(searchIndex(index, 'sinn fein').parties.map((p) => p.slug), ['sinn-fein', 'workers-party'], 'own name before another name');
  assert.deepEqual(searchIndex(index, 'SINN FÉIN').parties.map((p) => p.slug), ['sinn-fein', 'workers-party']);
  assert.deepEqual(searchIndex(index, '2022 assembly').elections.map((e) => e.key), ['ni__2022-05-05']);
  assert.deepEqual(searchIndex(index, '   ').places, []);
});

test('search: people are kept when their name answers, best match then most elected first', () => {
  const people = [
    { id: '1', slug: 'naomi-longford-1', type: 'person', title: 'Naomi Longford', name: 'Naomi Longford', browseUrl: '', totals: { elected: 9 } },
    { id: '2', slug: 'naomi-long-51102', type: 'person', title: 'Naomi Long', name: 'Naomi Long', browseUrl: '', totals: { elected: 9 } },
    { id: '3', slug: 'x-3', type: 'person', title: 'Jim Shannon', name: 'Jim Shannon', browseUrl: '', totals: { elected: 9 } },
  ];
  assert.deepEqual(rankPersons(people, wordsOf('naomi long')).map((p) => p.slug), ['naomi-long-51102', 'naomi-longford-1']);
  assert.deepEqual(rankPersons(people, wordsOf('strangford')), [], 'a person matched only by a place they stood in is left out');
});

// ------------------------------------------------------------------ area model and verdicts

const history = {
  schemaVersion: 1, slug: 'seaview', name: 'Seaview',
  contests: [
    contest({ date: '2001-06-07', mapId: 'pc-1995', mapName: 'Constituencies 1995', layerId: 'pc-1995-vector' }, [['Ann', 'UUP', 5000, true], ['Bob', 'DUP', 4000, false]]),
    contest({ date: '2003-02-01', kind: 'by-election', mapId: 'pc-1995', mapName: 'Constituencies 1995' }, [['Cat', 'DUP', 6000, true], ['Dan', 'UUP', 3000, false]]),
    contest({ date: '2005-05-05', mapId: 'pc-1995', mapName: 'Constituencies 1995', majority: 1500 }, [['Cat', 'DUP', 7000, true], ['Ann', 'U.U.P.', 5500, false]]),
    contest({ date: '2010-05-06', mapId: 'pc-2008', mapName: 'Constituencies 2008', layerId: 'pc-2008-vector' }, [['Cat', 'DUP', 8000, true], ['Eve', 'Alliance', 2000, false]]),
    contest({ date: '2015-05-07', mapId: 'pc-2008', mapName: 'Constituencies 2008' }, [['Fay', 'Independent', 9000, true], ['Cat', 'DUP', 8500, false]]),
  ],
};
const names = { 'uup': 'uup', 'u u p': 'uup', 'dup': 'dup', 'alliance': 'alliance' };

test('area: series, boundaries, the previous a verdict compares with, and the one-line verdicts', () => {
  const [s] = seriesOf(history, partyKeyFor(names));
  assert.equal(s.contests.length, 5);
  assert.deepEqual(s.contests.map((m) => m.boundary), ['first', 'same', 'same', 'changed', 'same']);
  assert.equal(s.contests[2].previous, s.contests[0], 'a general election is compared with the previous general election, not the by-election');
  assert.equal(s.contests[1].previous, s.contests[0], 'a by-election with the contest just before it');
  const verdicts = s.contests.map((m) => contestVerdict(m, fmt));
  assert.deepEqual(verdicts, [
    'UUP win, the first contest here on record, majority 1,000',
    'DUP gain from UUP, majority 3,000',
    'DUP gain from UUP, majority 1,500',
    'DUP win, on new boundaries, majority 6,000',
    'Independent gain from DUP, majority 500',
  ]);
  assert.deepEqual(boundaryChanges(s).map((b) => [b.mapId, b.previous]), [['pc-1995', null], ['pc-2008', 'Constituencies 1995']]);
  assert.equal(s.mapped, true);
});

test('area: an independent holds only as the same person; unopposed and missing votes are said, not inferred', () => {
  const ind = seriesOf({ ...history, contests: [
    contest({ date: '2001-01-01' }, [['Fay', 'Independent', 9000, true, 'p1'], ['X', 'DUP', 10, false]]),
    contest({ date: '2002-01-01' }, [['Gil', 'Independent', 9000, true, 'p2'], ['Fay', 'Independent', 10, false, 'p1']]),
    contest({ date: '2003-01-01' }, [['Gil', 'Independent', 9000, true, 'p2'], ['Y', 'UUP', 10, false]]),
  ] })[0];
  assert.deepEqual(ind.contests.slice(1).map((m) => contestVerdict(m, fmt)), ['Independent gain from Independent, majority 8,990', 'Independent hold, majority 8,990']);
  const unopposed = contestModel({ ...contest({ date: '1930-01-01' }, []), candidates: [{ name: 'S. Sharvin', party: null, personId: '9', personSlug: null, firstPrefs: null, elected: true, unopposed: null, status: 'Elected unopposed', colour: null }] }, partyKeyFor());
  assert.equal(unopposed.poll, 'unopposed');
  assert.equal(contestVerdict(unopposed, fmt), 'S. Sharvin (Independent) returned unopposed');
  const missing = contestModel(contest({ date: '1950-01-01' }, [['A', 'UUP', null, true], ['B', 'Labour', null, false]]), partyKeyFor());
  assert.equal(missing.poll, 'not-recorded');
  assert.equal(majorityOf(missing), null);
  assert.equal(contestVerdict(missing, fmt), 'UUP win, the first contest here on record · votes not recorded');
});

test('area: multi-seat verdicts tally seats and their change; the members grid keeps a returning member in their column', () => {
  const stv = (date, rows, over = {}) => contest({ date, seatsTotal: 3, votingSystem: 'stv', ...over }, rows);
  const s = seriesOf({ ...history, contests: [
    stv('2016-05-05', [['A', 'DUP', 9, true], ['B', 'DUP', 8, true], ['C', 'UUP', 7, true], ['D', 'Alliance', 6, false]]),
    stv('2017-03-02', [['C', 'UUP', 9, true], ['A', 'DUP', 8, true], ['D', 'Alliance', 7, true], ['B', 'DUP', 6, false]]),
    stv('2022-05-05', [['C', 'UUP', 9, true], ['A', 'DUP', 8, true], ['D', 'Alliance', 7, true], ['E', 'TUV', 1, false]]),
  ] }, partyKeyFor(names))[0];
  assert.equal(seatTally(s.contests[1]), 'DUP 1, UUP 1, Alliance 1', 'equal seats: more votes first');
  assert.equal(seatChanges(s.contests[1], s.contests[0]), 'Alliance +1, DUP −1');
  assert.deepEqual(s.contests.map((m) => contestVerdict(m, fmt)), ['DUP 2, UUP 1', 'DUP 1, UUP 1, Alliance 1 (Alliance +1, DUP −1)', 'UUP 1, DUP 1, Alliance 1 (no change)']);
  const grid = memberGrid(s);
  assert.equal(grid.columns, 3);
  const names2 = grid.rows.map((r) => r.cells.map((c) => (c ? `${c.member.name}${c.isNew ? '*' : ''}` : '-')));
  assert.deepEqual(names2, [['A*', 'B*', 'C*'], ['A', 'D*', 'C'], ['A', 'D', 'C']], 'A and C keep their columns; D takes the seat B left');
});

test('area: a by-election winner has a row of their own; trend points leave out by-elections and incomplete votes', () => {
  const [s] = seriesOf(history, partyKeyFor(names));
  const grid = memberGrid(s);
  assert.equal(grid.columns, 1);
  assert.equal(grid.rows[1].byElection?.member.name, 'Cat');
  assert.equal(grid.rows[2].cells[0]?.isNew, false, 'Cat, elected at the by-election, is not new at the next general election');
  const points = trendPoints(s);
  assert.deepEqual([...new Set(points.map((p) => p.entry.date))], ['2001-06-07', '2005-05-05', '2010-05-06', '2015-05-07']);
  const p2001 = points.filter((p) => p.entry.date === '2001-06-07');
  assert.deepEqual(p2001.map((p) => [p.party, Number(p.share.toFixed(2))]), [['UUP', 55.56], ['DUP', 44.44]]);
  const chart = trendChart(points, { width: 600, ariaLabel: 'Share' });
  assert.ok(chart);
  assert.match(chart.svg, /^<svg[^>]+role="img"[^>]+aria-label="Share"/);
  const table = trendTable(chart.model);
  assert.equal(table.rows.length, 4);
  assert.equal(table.parties.length, table.rows[0].shares.length);
  assert.equal(trendChart(points.slice(0, 2), { width: 600, ariaLabel: 'x' }), null, 'one election is no trend');
});

test('area: the contest arrows stay in the same body under the same name', () => {
  const two = { ...history, contests: [...history.contests, { ...history.contests[0], bodySlug: 'other', body: 'Other', electionKey: 'other__2003-01-01', date: '2003-01-01' }] };
  const n = contestNeighbours(two, 'body__2005-05-05', 1);
  assert.equal(n.previous?.electionKey, 'body__2003-02-01');
  assert.equal(n.next?.electionKey, 'body__2010-05-06');
  assert.deepEqual(contestNeighbours(two, 'nope', 1), { previous: null, next: null });
  assert.equal(contestNeighbours(two, 'other__2003-01-01', 1).previous, null);
});

// ------------------------------------------------------------------ career, links, routes, API

test('career: candidacies with their shares, the summary, and namesakes', () => {
  const rows = careerRows([
    { electionKey: 'b__2022', electionSlug: 'b-2022', electionTitle: '2022 X', body: 'Assembly', date: '2022-05-05', contest: 'Belfast East', contestSlug: 'belfast-east', name: 'N', elected: true, party: 'Alliance', firstPrefs: 8195, status: 'Elected', unopposed: false },
    { electionKey: 'a__2005', electionSlug: 'a-2005', electionTitle: '2005 Y', body: 'Councils', date: '2005-05-05', contest: 'Victoria', contestSlug: 'victoria', name: 'N', elected: false, party: 'Alliance', firstPrefs: 100, status: '', unopposed: false },
    { electionKey: 'c__1930', electionSlug: 'c-1930', date: '1930-01-01', contest: 'Ward', name: 'N', elected: true, status: 'Elected unopposed' },
  ], [{ key: 'b__2022', constituency: 'Belfast East', elected: true, share: 18.95 }]);
  assert.deepEqual(rows.map((r) => [r.date.slice(0, 4), r.share, r.outcome]), [['1930', null, 'unopposed'], ['2005', null, 'not-elected'], ['2022', 18.95, 'elected']]);
  assert.deepEqual(careerSummary(rows), { stood: 3, elected: 2, firstYear: 1930, lastYear: 2022, bodies: ['Councils', 'Assembly'] });
  const found = [{ slug: 'a-1', title: 'Frank Aiken' }, { slug: 'a-2', title: 'Frank Aiken' }, { slug: 'a-3', title: 'Frank Aikens' }];
  assert.deepEqual(namesakes(/** @type {any} */ (found), { slug: 'a-1', title: 'Frank Aiken' }).map((p) => p.slug), ['a-2']);
});

test('links and routes: party chips, area and person pages, the URL state of each view', () => {
  assert.equal(partyHref('Sinn Féin', { 'sinn fein': 'sinn-fein' }), '/browse/parties/sinn-fein');
  assert.equal(partyHref('Nobody', {}), null);
  assert.equal(partyBrowseUrl('dup'), '/browse/parties/dup');
  assert.equal(areaUrl('strangford'), '/elections/area/strangford/');
  assert.equal(areaUrl('strangford', 'northern-ireland-assembly'), '/elections/area/strangford/?body=northern-ireland-assembly');
  assert.equal(personAppUrl({ personSlug: 'naomi-long-51102' }), '/elections/person/naomi-long-51102/');
  assert.equal(personAppUrl({ personId: '51102' }), '/elections/person/51102/');
  assert.equal(personAppUrl({}), null);
  assert.equal(layerMapUrl('pc-2008-vector'), '/maps/#layers=pc-2008-vector');
  const area = parseRoute('/elections/area/strangford/', '?body=x');
  assert.equal(area.view, 'area');
  assert.deepEqual(areaState(area), { slug: 'strangford', body: 'x' });
  const person = parseRoute('/apps/elections/person/naomi-long-51102/');
  assert.equal(person.view, 'person');
  assert.deepEqual(personState(person), { key: 'naomi-long-51102' });
  assert.equal(parseRoute('/elections/area/').view, 'election', 'no slug: not an area page');
  assert.deepEqual(searchState(new URLSearchParams('q=Sinn%20F%C3%A9in')), { q: 'Sinn Féin' });
  assert.equal(searchHref('/elections/', ' naomi long '), '/elections/?q=naomi%20long');
  assert.equal(searchHref('/elections/', ''), '/elections/');
});

test('the API groups an area history by contest, its candidates elected as booleans', () => {
  const answer = areaHistoryAnswer('seaview', [
    { electionKey: 'a', seq: 1, name: 'Seaview', matched: 1 },
    { electionKey: 'b', seq: 2, name: 'Sea View', matched: null },
  ], [
    { electionKey: 'a', seq: 1, name: 'X', elected: 1 },
    { electionKey: 'a', seq: 1, name: 'Y', elected: 0 },
    { electionKey: 'b', seq: 2, name: 'Z', elected: 1 },
  ]);
  assert.equal(answer.name, 'Sea View', 'the latest contest names the area');
  assert.deepEqual(answer.contests.map((c) => [c.matched, c.candidates.map((x) => `${x.name}${x.elected ? '+' : ''}`)]), [[true, ['X+', 'Y']], [false, ['Z+']]]);
});

test('every word of the area pages, search and person page is keyed for translation (R10)', () => {
  const en = JSON.parse(readFileSync(new URL('../../site/assets/i18n/en.json', import.meta.url), 'utf8')).strings;
  const english = new Set(Object.values(en));
  for (const s of Object.values(TEXT)) assert.ok(english.has(s), `not keyed: ${s}`);
  assert.equal(fill(TEXT.gain, { party: 'A', previous: 'B' }), 'A gain from B');
  assert.equal(fill('{x} {y}', { x: 1 }), '1 {y}', 'an unknown part is left as it is');
});

// ------------------------------------------------------------------ over the records build

const DB = new URL('../../tmp/records/civgraph-records.sqlite', import.meta.url);
test('over the records build: the benchmark searches find the right things, and real verdicts', { skip: !existsSync(DB) && 'no records build' }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { ELECTIONS_API } = await import('../../packages/api/src/queries/elections.js');
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const areas = db.prepare(ELECTIONS_API.areaIndex).all();
    const parties = db.prepare('SELECT card FROM party_cards ORDER BY ord').all().map((r) => JSON.parse(String(r.card)));
    const index = buildSearchIndex({ areas, parties });
    const strangford = searchIndex(index, 'Strangford');
    assert.equal(strangford.places[0].slug, 'strangford');
    assert.ok(strangford.places[0].bodies.some((b) => b.bodySlug === 'northern-ireland-assembly'));
    assert.ok(strangford.places[0].bodies.some((b) => b.bodySlug === 'house-of-commons-of-the-united-kingdom'));
    assert.equal(searchIndex(index, 'Sinn Féin').parties[0].slug, 'sinn-fein');
    assert.equal(searchIndex(index, 'sinn fein').parties[0].slug, 'sinn-fein');
    // People: what the persons API's search_norm column would return for "naomi long", ranked.
    const people = db.prepare("SELECT card FROM person_cards WHERE search_norm LIKE '%naomi%' AND search_norm LIKE '%long%' ORDER BY elected_count DESC LIMIT 40").all().map((r) => JSON.parse(String(r.card)));
    assert.equal(rankPersons(people, wordsOf('Naomi Long'))[0]?.slug, 'naomi-long-51102');

    const names = Object.fromEntries(db.prepare('SELECT label, party_slug FROM party_label_map').all().map((r) => [r.label, r.party_slug]));
    const answer = areaHistoryAnswer('strangford', db.prepare(ELECTIONS_API.areaContests).all('strangford'), db.prepare(ELECTIONS_API.areaCandidates).all('strangford'));
    const series = seriesOf(JSON.parse(JSON.stringify(answer)), partyKeyFor(names));
    const commons = series.find((s) => s.bodySlug === 'house-of-commons-of-the-united-kingdom');
    const verdict = (date) => contestVerdict(/** @type {any} */ (commons?.contests.find((m) => m.contest.date === date)), fmt);
    assert.match(verdict('2024-07-04'), /^DUP win, on new boundaries, majority /, 'Strangford was redrawn for 2024');
    assert.match(verdict('2019-12-12'), /^DUP hold, majority /);
    const assembly = series.find((s) => s.bodySlug === 'northern-ireland-assembly');
    assert.ok(assembly && memberGrid(assembly).columns >= 5);
    assert.ok(trendPoints(assembly).length > 10);
    const council = series.find((s) => s.bodySlug === 'east-down-rural-district-council');
    assert.equal(council?.mapped, false, 'no boundary map is held for the 1930s district council: the page says so');
  } finally {
    db.close();
  }
});
