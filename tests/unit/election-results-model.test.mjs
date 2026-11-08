// Election results model (src/map/election/results-model.mjs, seam E1 of the frontend plan):
// the pure result helpers moved out of app/src/election-manager.js, exercised on small
// fixtures of five election types (Westminster FPTP, Assembly STV, a referendum, a local
// election by DEA, the 1996 Forum).
//
//   node --test tests/unit/election-results-model.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  averageNumbers,
  buildCandidateDelta,
  buildCouncilSummary,
  buildLocalPartySummary,
  buildStvTransferContext,
  candidateDeltaLookupKey,
  candidateDeltasEligible,
  candidateFirstPrefPct,
  finiteNumber,
  isCouncilAggregateResult,
  isForumResult,
  isLocalGovernmentElection,
  isPluralityElection,
  isPluralityResult,
  isReferendumElection,
  isSingleSeatFptpResult,
  isStvResult,
  normalizedCountSequence,
  numberOrZero,
  previousResultsForCouncil,
  previousSourceCount,
  referendumOutcomeRows,
  referendumStats,
  selectedPaneStatusKind,
  shouldDashAfterTerminalTransfer,
  sumNumbers,
  terminalTransferOutCount,
  terminalTransferOutDisplayRow,
  withCandidateDeltas,
  withCouncilDeltas,
  withLocalPartyDeltas,
  withPartyDeltas
} from '../../src/map/election/results-model.mjs';
import * as viewModel from '../../packages/core/src/election-view-model.mjs';

// --- fixtures ---------------------------------------------------------------------------------

const westminsterEntry = { key: 'westminster-2024', body: 'House of Commons', votingSystem: 'FPTP', contestType: 'election' };
const westminsterResult = {
  constituency: 'Foyle',
  validPoll: 40_000,
  candidates: [
    { name: 'Colum Eastwood', party: 'SDLP', votes: 20_000, elected: true },
    { name: 'Sinead McLaughlin', party: 'Sinn Féin', votes: 15_000, status: 'Not elected' }
  ]
};

const assemblyEntry = { key: 'nia-2022', body: 'Northern Ireland Assembly', votingSystem: 'STV' };
const stvResult = {
  constituency: 'East Antrim',
  quota: 100,
  countNumbers: [1, 2, 3],
  candidates: [
    { name: 'Alice', party: 'Alliance', electedAt: 1, counts: [{ count: 1, total: 150 }, { count: 2, total: 100, transfers: -50 }] },
    { name: 'Bob', party: 'DUP', excludedAt: 2, counts: [{ count: 1, total: 30 }, { count: 2, total: 60, transfers: 30 }] },
    { name: 'Cara', party: 'SDLP', counts: [{ count: 1, total: 20 }, { count: 2, total: 35, transfers: 15 }, { count: 3, total: 90, transfers: 55 }] }
  ]
};

const referendumEntry = { key: 'referendum-ireland-2018', contestType: 'referendum', body: 'Referendum Ireland' };
const referendumResult = {
  constituency: 'Dublin Bay North',
  countInfo: { Total_Electorate: '100,000', Turnout_Pct: '60%' },
  validPoll: 59_000
};

const localEntry = { key: 'ni-local-2023', bodyGroup: 'local-government', votingSystem: 'STV' };
const localResults = [
  {
    constituency: 'Lisburn North', localBody: 'Lisburn and Castlereagh', seatsTotal: 5, validPoll: 1000, electorate: 2000,
    candidates: [
      { name: 'A', party: 'DUP', firstPrefs: 500, elected: true, colour: '#d46a4c' },
      { name: 'B', party: 'DUP', firstPrefs: 100, elected: true },
      { name: 'C', party: 'Alliance', firstPrefs: 400, elected: true }
    ]
  },
  {
    constituency: 'Downshire East', localBody: 'Lisburn and Castlereagh', seatsTotal: 5, validPoll: 1000, electorate: 2500,
    candidates: [
      { name: 'D', party: 'Alliance', firstPrefs: 700, elected: true },
      { name: 'E', party: '', firstPrefs: 300 }
    ]
  },
  {
    constituency: 'Banbridge', localBody: 'Armagh, Banbridge and Craigavon', seatsTotal: 6, validPoll: 500, electorate: 1000,
    candidates: [{ name: 'F', party: 'UUP', firstPrefs: 500, elected: true }]
  }
];

const forumResult = { constituency: 'North Down', forum: true, allocationRounds: [] };

// --- tests ------------------------------------------------------------------------------------

test('numbers and statuses', () => {
  assert.equal(finiteNumber('1,234'), 1234);
  assert.equal(finiteNumber('45.5%'), 45.5);
  assert.equal(finiteNumber(''), null);
  assert.equal(finiteNumber('n/a'), null);
  assert.equal(numberOrZero('x'), 0);
  assert.equal(selectedPaneStatusKind('Deemed elected'), 'elected');
  assert.equal(selectedPaneStatusKind('Not elected'), 'not_elected');
  assert.equal(selectedPaneStatusKind('Excluded'), 'excluded');
  assert.equal(selectedPaneStatusKind(''), 'unknown');
});

test('sumNumbers and averageNumbers are the view model\'s', () => {
  assert.equal(sumNumbers, viewModel.sumNumbers);
  assert.equal(averageNumbers, viewModel.averageNumbers);
  assert.equal(sumNumbers(localResults, 'validPoll'), 2500);
  assert.equal(averageNumbers([{ t: 50 }, { t: 'x' }, { t: 70 }], 't'), 60);
});

test('classification: Westminster FPTP', () => {
  const context = { entry: westminsterEntry };
  assert.equal(isPluralityResult(westminsterResult, context), true);
  assert.equal(isPluralityElection([westminsterResult], context), true);
  assert.equal(isPluralityElection([], context), false);
  assert.equal(isSingleSeatFptpResult(westminsterResult, context), true);
  assert.equal(isSingleSeatFptpResult({ ...westminsterResult, recallPetition: true }, context), false);
  assert.equal(isSingleSeatFptpResult({ ...westminsterResult, seatsTotal: 2 }, { entry: { votingSystem: 'Block vote' } }), true);
  assert.equal(isSingleSeatFptpResult({ candidates: [] }, context), false);
  assert.equal(isReferendumElection(westminsterResult, context), false);
  assert.equal(candidateDeltasEligible(westminsterResult, context), true);
});

test('classification: Assembly STV', () => {
  const context = { entry: assemblyEntry };
  assert.equal(isStvResult(stvResult), true);
  assert.equal(isStvResult({ votingSystem: 'STV' }), true);
  assert.equal(isPluralityResult(stvResult, { entry: westminsterEntry }), false);
  assert.equal(isSingleSeatFptpResult(stvResult, context), false);
});

test('classification: referendum, forum, local council aggregates', () => {
  assert.equal(isReferendumElection(null, { entry: referendumEntry }), true);
  assert.equal(isReferendumElection({ contestType: 'Referendum' }), true);
  assert.equal(candidateDeltasEligible({}, { entry: referendumEntry }), false);
  assert.equal(isForumResult(forumResult), true);
  assert.equal(isForumResult(null), false);
  assert.equal(isSingleSeatFptpResult(forumResult, { entry: westminsterEntry }), false);
  assert.equal(candidateDeltasEligible({ body: 'Northern Ireland Forum' }), false);
  assert.equal(isLocalGovernmentElection({ entry: localEntry }), true);
  assert.equal(isLocalGovernmentElection({ bundle: { bodyGroup: 'parliament' }, entry: localEntry }), false);
  assert.equal(isCouncilAggregateResult({ aggregateType: 'council' }, { entry: localEntry }), true);
  assert.equal(isCouncilAggregateResult({ aggregateType: 'council' }, { entry: westminsterEntry }), false);
  assert.equal(isCouncilAggregateResult({ aggregateType: 'dea' }, { entry: localEntry }), false);
});

test('referendumStats derives total poll, spoiled and turnout', () => {
  const stats = referendumStats(referendumResult, []);
  assert.deepEqual(stats, { validPoll: 59_000, totalPoll: 60_000, electorate: 100_000, spoiled: 1_000, turnoutPct: 60 });
  const fromRows = referendumStats({}, [{ votes: 300 }, { votes: 200 }]);
  assert.equal(fromRows.validPoll, 500);
  assert.equal(fromRows.turnoutPct, null);
});

test('referendumOutcomeRows: carried outcome first, shares from the valid poll', () => {
  const rows = referendumOutcomeRows([
    { name: 'No', votes: '20,000' },
    { name: 'Yes', votes: 39_000, status: 'Elected' },
    { name: '', votes: 5 }
  ], 59_000, true);
  assert.deepEqual(rows.map((row) => row.outcome), ['Yes', 'No']);
  assert.equal(rows[0].elected, true);
  assert.equal(rows[0].colour, '#43A047');
  assert.equal(rows[1].colour, '#E53935');
  assert.ok(Math.abs(rows[1].share - 20_000 / 59_000 * 100) < 1e-9);
});

test('withPartyDeltas: null change for a party with no previous result, real zero kept', () => {
  const rows = withPartyDeltas(
    [{ party: 'SDLP', stood: 2, seats: 1, votes: 100, share: 40 }, { party: 'Aontú', stood: 1, seats: 0, votes: 10, share: 4 }],
    { previousRows: [{ party: 'SDLP', stood: 1, seats: 0, votes: 80, share: 35 }] }
  );
  assert.deepEqual(rows[0].deltas, { stood: 1, seats: 1, votes: 20, share: 5 });
  assert.equal(rows[1].previous, null);
  assert.equal(rows[1].deltas, null);
  // With nothing to compare against, every change is null.
  assert.equal(withPartyDeltas([{ party: 'SDLP' }], {}, {})[0].deltas, null);
  // The previous bundle's main-like summary when asked for.
  const viaBundle = withPartyDeltas([{ party: 'SDLP', seats: 3 }], { mainLike: true }, { previousBundle: { mainLikePartySummary: [{ party: 'sdlp', seats: 1 }] } });
  assert.equal(viaBundle[0].deltas.seats, 2);
});

test('candidate deltas match by name and area', () => {
  assert.equal(candidateDeltaLookupKey({ name: 'Colum Eastwood', constituency: 'Foyle' }), 'colum eastwood|foyle');
  assert.equal(candidateFirstPrefPct({ votes: 50 }, { validPoll: 200 }), 25);
  assert.equal(candidateFirstPrefPct({ share: '12.5' }), 12.5);
  assert.deepEqual(buildCandidateDelta({ votes: 10 }, null), { previous: null, deltas: null });
  const rows = withCandidateDeltas(
    [{ name: 'Colum Eastwood', constituency: 'Foyle', votes: 20_000, firstPrefPct: 50 }],
    { previousRows: [{ name: 'Colum Eastwood', constituency: 'Foyle', votes: 17_000, firstPrefPct: 40 }] },
    { entry: westminsterEntry }
  );
  assert.deepEqual(rows[0].deltas, { firstPrefs: 3_000, firstPrefPct: 10 });
  const referendumRows = withCandidateDeltas([{ name: 'Yes', previous: { name: 'Yes' } }], { previousRows: [{ name: 'Yes' }] }, { entry: referendumEntry });
  assert.equal(referendumRows[0].deltas, null);
  assert.deepEqual(referendumRows[0].previous, { name: 'Yes' });
});

test('local elections: party-by-area summary, council summary and their deltas', () => {
  const local = buildLocalPartySummary(localResults);
  assert.deepEqual(local.map((row) => [row.party, row.constituency, row.seats]), [
    ['UUP', 'Banbridge', 1],
    ['Alliance', 'Downshire East', 1],
    ['DUP', 'Lisburn North', 2],
    ['Alliance', 'Lisburn North', 1],
    ['No label', 'Downshire East', 0]
  ]);
  assert.equal(local[2].seatShare, 40);
  assert.equal(local[2].colour, '#d46a4c');

  const councils = buildCouncilSummary(localResults);
  assert.deepEqual(councils.map((row) => row.council), ['Armagh, Banbridge and Craigavon', 'Lisburn and Castlereagh']);
  const lisburn = councils[1];
  assert.equal(lisburn.deas, 2);
  // Two seats each: the tie goes to votes, Alliance 1,100 to the DUP's 600.
  assert.equal(lisburn.leadingParty, 'Alliance');
  assert.equal(lisburn.share, 1100 / 2000 * 100);
  assert.equal(lisburn.turnoutPct, 2000 / 4500 * 100);

  const previousBundle = { results: localResults.map((result) => ({ ...result, validPoll: result.validPoll / 2 })) };
  const councilDeltas = withCouncilDeltas(councils, { previousBundle });
  assert.equal(councilDeltas[1].deltas.validPoll, 1000);
  assert.equal(councilDeltas[1].deltas.seats, 0);

  const localDeltas = withLocalPartyDeltas(local, {}, { previousBundle });
  // UUP in Banbridge: the same 500 votes of a valid poll twice the size.
  assert.equal(localDeltas[0].deltas.firstPrefs, 0);
  assert.equal(localDeltas[0].deltas.share, -100);
  assert.equal(withLocalPartyDeltas(local, { previousResults: [] })[0].deltas, null);

  assert.equal(previousResultsForCouncil('lisburn and castlereagh', { previousBundle }).length, 2);
  assert.deepEqual(previousResultsForCouncil('', { previousBundle }), []);
});

test('STV transfer helpers', () => {
  assert.deepEqual(normalizedCountSequence(['3', 1, 2, 2, 'x']), [1, 2, 3]);
  assert.equal(previousSourceCount([1, 2, 3], 3), 2);
  assert.equal(previousSourceCount([1, 2, 3], 1), null);
  assert.equal(shouldDashAfterTerminalTransfer(3, 2), true);
  assert.equal(shouldDashAfterTerminalTransfer(2, 2), false);
  assert.equal(shouldDashAfterTerminalTransfer(5, null), false);

  const [alice, bob] = stvResult.candidates;
  const aliceCounts = new Map(alice.counts.map((row) => [row.count, row]));
  const bobCounts = new Map(bob.counts.map((row) => [row.count, row]));
  // Alice's surplus is recorded at count 2; Bob's exclusion transfer is missing at count 3 and inferred.
  assert.equal(terminalTransferOutCount(alice, aliceCounts, stvResult, stvResult.countNumbers), 2);
  const inferred = terminalTransferOutDisplayRow(bob, 3, bobCounts, stvResult, stvResult.countNumbers, null);
  assert.deepEqual(inferred, { count: 3, total: 0, transfers: -60, status: 'Excluded transfer' });
  assert.equal(terminalTransferOutCount(bob, bobCounts, stvResult, stvResult.countNumbers), 3);

  const { nonTransferable, transferDenominators } = buildStvTransferContext(stvResult, stvResult.candidates, stvResult.countNumbers);
  // Count 2: +30 +15 in, -50 out: 5 non-transferable.
  assert.deepEqual(nonTransferable.get(2), { count: 2, total: 5, transfers: 5, inferred: true });
  assert.deepEqual(transferDenominators.get(2), { positive: 50, negativeAbs: 50 });
  // Count 3: Cara +55, Bob's inferred -60: 5 more non-transferable.
  assert.deepEqual(nonTransferable.get(3), { count: 3, total: 10, transfers: 5, inferred: true });
  assert.equal(nonTransferable.get(1).total, 0);
});
