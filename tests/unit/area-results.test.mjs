// Results by area (packages/core/src/area-results.mjs): a national contest broken down by the areas
// it was counted in, summarised as contests are but never as candidacies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { areaCandidateColours, areaCountSheet, areaFeatureNames, CANDIDATE_PALETTE } from '../../packages/core/src/area-results.mjs';
import { summarizeResult } from '../../packages/core/src/election-domain.mjs';
import { loadRegistry } from '../../packages/registries/src/index.mjs';
import { electionBody } from '../../packages/registries/src/election-bodies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const NATIONAL = [
  { id: '1', name: 'Michael D Higgins', party: 'Irish Labour', colour: '#cc0000' },
  { id: '2', name: 'Seán Gallagher', party: 'Independent', colour: '#b8b8b8' },
  { id: '3', name: 'David Norris', party: 'Independent', colour: '#b8b8b8' },
  { id: '4', name: 'Someone Else', party: 'Irish Labour', colour: '#cc0000' }
];

test('each candidate gets a colour of its own: its party\'s where free, else the palette', () => {
  const colours = areaCandidateColours(NATIONAL);
  assert.equal(colours.get('1'), '#cc0000');
  assert.equal(colours.get('2'), CANDIDATE_PALETTE[0]);
  assert.equal(colours.get('3'), CANDIDATE_PALETTE[1]);
  assert.equal(colours.get('4'), CANDIDATE_PALETTE[2]);
  assert.equal(new Set(colours.values()).size, NATIONAL.length);
});

test('an area becomes a count sheet: national ids, nobody elected, exclusions and non-transferable rows', () => {
  const area = {
    constituency: 'Clare',
    map: { feature: 'Clare' },
    meta: { electorate: 1000, total_poll: 610, spoiled: 10, valid_poll: 600 },
    candidates: [
      { name: 'Michael D Higgins', party: 'Irish Labour', counts: [300, 330] },
      { name: 'Seán Gallagher', party: 'Independent', counts: [250, 260] },
      { name: 'David Norris', party: 'Independent', counts: [50, null] }
    ],
    non_transferable: [null, 10]
  };
  const byName = new Map(NATIONAL.map((c) => [c.name, c]));
  const sheet = areaCountSheet(area, (name) => byName.get(name), areaCandidateColours(NATIONAL));
  assert.deepEqual(sheet.unmatchedCandidates, []);
  const result = summarizeResult(sheet, area.constituency);
  assert.equal(result.constituency, 'Clare');
  assert.deepEqual(result.candidates.map((c) => c.id), ['1', '2', '3']);
  assert.equal(result.candidates.filter((c) => c.elected).length, 0);
  assert.equal(result.leadingName, 'Michael D Higgins');
  assert.equal(result.validPoll, 600);
  assert.equal(result.turnoutPct, 61);
  const norris = result.candidates.find((c) => c.id === '3');
  assert.ok(norris.excluded);
  assert.deepEqual(result.nonTransferable.map((n) => [n.count, n.total]), [[2, 10]]);
  assert.deepEqual(result.countNumbers, [1, 2]);
});

test('a candidate the national contest does not have is reported', () => {
  const sheet = areaCountSheet({ constituency: 'X', candidates: [{ name: 'Nobody', counts: [1] }] }, () => null, new Map());
  assert.deepEqual(sheet.unmatchedCandidates, ['Nobody']);
});

test('an area names one feature, or several when its count was reported for them together', () => {
  assert.deepEqual(areaFeatureNames({ map: { feature: 'A' } }), ['A']);
  assert.deepEqual(areaFeatureNames({ map: { feature: null, features: ['A', 'B'] } }), ['A', 'B']);
  assert.deepEqual(areaFeatureNames({}), []);
});

test('every staged presidential area names only national candidates, and its counting basis has a label', () => {
  const config = electionBody(loadRegistry('election-bodies'), 'ireland-president')?.areaResults;
  assert.ok(config);
  const dir = path.join(ROOT, config.dir);
  for (const date of readdirSync(dir).filter((d) => /^\d{4}-/.test(d))) {
    const index = readJson(path.join(dir, date, '_constituencies.json'));
    assert.ok(config.labels[index.counting_basis], `${date}: ${index.counting_basis}`);
    const national = readJson(path.join(ROOT, 'data/elections-source/data/elections/ireland-president', date, 'ireland.json'));
    const names = new Set(national.candidates.map((c) => c.name));
    for (const file of readdirSync(path.join(dir, date)).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
      for (const c of readJson(path.join(dir, date, file)).candidates) assert.ok(names.has(c.name), `${date}/${file}: ${c.name}`);
    }
  }
});

// A bundle's geography modes as the manifest writes them: the national mode and one area mode.
const MODES = [
  { id: 'results', dataKind: 'results', label: 'Ireland' },
  {
    id: 'areas', dataKind: 'area-results', label: 'Constituency', countingBasis: 'dail-constituencies', sourceMapId: 'dail-2009', numCounts: 2,
    note: 'n', references: [{ label: 'Booklet', url: 'https://example.org/b.pdf' }],
    results: [{
      constituency: 'Clare', matched: true, featureName: 'Clare', validPoll: 600, turnoutPct: 61, leadingName: 'Michael D Higgins', leadingPct: 50,
      candidates: [
        { id: '1', nationalCandidateId: '1', firstPrefs: 300, colour: '#cc0000', counts: [{ count: 1, total: 300 }, { count: 2, total: 330 }] },
        { id: '3', nationalCandidateId: '3', firstPrefs: 50, colour: '#d62728', excluded: true, decidedAt: 2, counts: [{ count: 1, total: 50 }] }
      ],
      nonTransferable: [{ count: 2, total: 10 }],
      contestNotes: [{ label: 'Note', text: 'A note' }]
    }]
  }
];

test('the API answer of an election\'s results by area', async () => {
  const { areaResultsAnswer } = await import('../../packages/core/src/area-results.mjs');
  const answer = areaResultsAnswer({ key: 'ireland-president__2011-10-27', displayTitle: '2011 Irish presidential election' }, MODES,
    [{ id: '1', name: 'Michael D Higgins', party: 'Irish Labour', personId: 100313 }, { id: '3', name: 'David Norris', party: 'Independent', personId: null }]);
  assert.equal(answer.areaLabel, 'Constituency');
  assert.equal(answer.numCounts, 2);
  assert.deepEqual(answer.candidates.map((c) => [c.id, c.personId, c.colour]), [['1', '100313', '#cc0000'], ['3', null, '#d62728']]);
  const [clare] = answer.areas;
  assert.equal(clare.slug, 'clare');
  assert.deepEqual(clare.candidates.map((c) => [c.id, c.counts, c.share, c.excludedAt]), [['1', [300, 330], 50, null], ['3', [50, null], 8.33, 2]]);
  assert.deepEqual(clare.nonTransferable, [null, 10]);
  assert.deepEqual(clare.notes, ['A note']);
  const none = areaResultsAnswer({ key: 'dail-eireann__2024-11-29' }, null, []);
  assert.deepEqual(none.areas, []);
});

test('the server-rendered election page lists an election\'s areas', async () => {
  const { electionBody } = await import('../../packages/ui/src/templates/records/election.js');
  const page = { kind: 'election', election: { key: 'k', slug: 'k', title: 'T', body: 'President of Ireland', date: '2011-10-27', kind: 'general', votingSystem: 'stv-hare', meta: { geographyModes: MODES } }, contests: [], sources: [] };
  const html = String(electionBody(page).body);
  assert.match(html, /<h2 id="by-area">Results by constituency<\/h2>/);
  assert.match(html, /<th scope="row">Clare<\/th><td>Michael D Higgins<\/td>/);
  const plain = String(electionBody({ ...page, election: { ...page.election, meta: {} } }).body);
  assert.doesNotMatch(plain, /by-area/);
});
