import {
  buildCandidateSummary,
  buildEntityIndex,
  buildPartySummary,
  compareResults,
  normalizeName,
  numberOrZero,
  partyColour,
  summarizeResult
} from './election-domain.mjs';

export function buildElectionViewModel({
  entry = null,
  bundle = null,
  results = [],
  previousResults = [],
  selectedResult = null,
  view = 'party',
  mode = 'winner',
  overlayMode = 'circles',
  localMode = 'constituency',
  countDetailedView = false
} = {}) {
  const currentResults = previousResults.length ? compareResults(results, previousResults) : results;
  const selectedKey = selectedResult ? normalizeName(selectedResult.matchName || selectedResult.constituency || '') : null;
  const partySummary = bundle?.partySummary?.length ? bundle.partySummary : buildPartySummary(currentResults);
  const candidateSummary = buildCandidateSummary(currentResults);
  const localGovernment = (bundle?.bodyGroup || entry?.bodyGroup) === 'local-government';
  const recallPetition = currentResults.some((result) => result.recallPetition);

  return {
    entry,
    bundle,
    title: bundle?.displayTitle || entry?.displayTitle || bundle?.body || entry?.body || '',
    date: bundle?.date || entry?.date || '',
    body: bundle?.body || entry?.body || '',
    bodyGroup: bundle?.bodyGroup || entry?.bodyGroup || null,
    view,
    mode,
    overlayMode,
    localMode,
    countDetailedView,
    selectedKey,
    selectedResult,
    results: currentResults,
    previousResults,
    partySummary,
    candidateSummary,
    entityIndex: bundle?.entityIndex || buildEntityIndex(currentResults),
    localGovernment,
    recallPetition,
    coverage: {
      matched: Number(bundle?.matchedCount || 0),
      unmatched: Number(bundle?.unmatchedCount || 0),
      total: Number(bundle?.totalConstituencies || currentResults.length || 0)
    },
    totals: buildElectionTotals(currentResults, partySummary)
  };
}

export function buildElectionViewModelFromTest2Manager(manager, selectedResult = null, view = null) {
  return buildElectionViewModel({
    entry: manager.activeEntry,
    bundle: manager.activeBundle,
    results: manager.activeBundle?.results || [],
    previousResults: manager.previousBundle?.results || [],
    selectedResult,
    view: view || manager.activePanelView || 'party',
    mode: manager.activeMode,
    overlayMode: manager.overlayMode,
    localMode: manager.activeLocalMode,
    countDetailedView: manager.countDetailedView
  });
}

export function buildElectionViewModelFromMainController(controller, view = 'party', selectedConstituency = null) {
  const results = Object.entries(controller.resultsByConstituency || {})
    .map(([constituency, payload]) => summarizeResult(payload, constituency));
  const previousResults = Object.entries(controller.previousResultsByConstituency || {})
    .map(([constituency, payload]) => summarizeResult(payload, constituency));
  const selectedResult = selectedConstituency
    ? results.find((result) => normalizeName(result.constituency) === normalizeName(selectedConstituency))
    : null;
  return buildElectionViewModel({
    entry: {
      body: controller.body,
      date: controller.date,
      bodyGroup: controller.bodyGroup
    },
    bundle: {
      body: controller.body,
      date: controller.date,
      displayTitle: typeof controller._niWideTitle === 'function'
        ? controller._niWideTitle()
        : `${controller.body || 'Election'}${controller.date ? ` (${controller.date})` : ''}`,
      bodyGroup: controller.bodyGroup,
      matchedCount: results.length,
      unmatchedCount: 0,
      totalConstituencies: results.length
    },
    results,
    previousResults,
    selectedResult,
    view,
    mode: controller._currentStyleMode || 'winner',
    overlayMode: controller.overlayMode || 'circles',
    localMode: controller._localResultsMode || 'constituency',
    countDetailedView: controller._countDetailedView
  });
}

export function buildLocalPartySummary(results = []) {
  const rows = [];
  for (const result of results) {
    const byParty = new Map();
    const validPoll = Number(result.validPoll || result.totalVotes || 0);
    for (const candidate of result.candidates || []) {
      const party = candidate.party || 'Independent/Other';
      const key = normalizeName(party) || party;
      if (!byParty.has(key)) {
        byParty.set(key, {
          party,
          constituency: result.constituency || result.matchName || '',
          resultKey: normalizeName(result.matchName || result.constituency || ''),
          colour: candidate.colour || partyColour(party),
          stood: 0,
          seats: 0,
          firstPrefs: 0,
          share: null
        });
      }
      const row = byParty.get(key);
      row.stood += 1;
      row.firstPrefs += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
      if (candidate.elected) row.seats += 1;
    }
    for (const row of byParty.values()) {
      row.share = validPoll ? row.firstPrefs / validPoll * 100 : null;
      rows.push(row);
    }
  }
  return rows.sort((a, b) =>
    String(a.party).localeCompare(String(b.party))
    || String(a.constituency).localeCompare(String(b.constituency))
    || b.firstPrefs - a.firstPrefs
  );
}

export function buildCouncilSummary(results = []) {
  const councils = new Map();
  for (const result of results) {
    const council = result.localBody || 'Unknown council';
    if (!councils.has(council)) {
      councils.set(council, {
        council,
        deas: 0,
        seats: 0,
        validPoll: 0,
        electorate: 0,
        partySeats: new Map(),
        partyVotes: new Map()
      });
    }
    const row = councils.get(council);
    row.deas += 1;
    row.seats += Number(result.seatsWon ?? result.seatsTotal ?? 0) || 0;
    row.validPoll += Number(result.validPoll || result.totalVotes || 0) || 0;
    row.electorate += Number(result.electorate || 0) || 0;
    for (const candidate of result.candidates || []) {
      const party = candidate.party || 'Independent/Other';
      row.partyVotes.set(party, (row.partyVotes.get(party) || 0) + (Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0));
      if (candidate.elected) row.partySeats.set(party, (row.partySeats.get(party) || 0) + 1);
    }
  }
  return [...councils.values()].map((row) => {
    const leading = [...row.partySeats.entries()].sort((a, b) => b[1] - a[1] || (row.partyVotes.get(b[0]) || 0) - (row.partyVotes.get(a[0]) || 0))[0]
      || [...row.partyVotes.entries()].sort((a, b) => b[1] - a[1])[0]
      || ['', 0];
    return {
      ...row,
      leadingParty: leading[0],
      colour: partyColour(leading[0]),
      turnoutPct: row.electorate ? row.validPoll / row.electorate * 100 : null
    };
  }).sort((a, b) => String(a.council).localeCompare(String(b.council)));
}

export function sumNumbers(results, key) {
  return results.reduce((sum, result) => {
    const value = Number(result?.[key]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

export function averageNumbers(results, key) {
  const values = results
    .map((result) => Number(result?.[key]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildElectionTotals(results, partySummary) {
  const validPoll = sumNumbers(results, 'validPoll');
  const totalPoll = sumNumbers(results, 'totalPoll');
  const electorate = sumNumbers(results, 'electorate');
  const totalSeats = partySummary.reduce((sum, row) => sum + numberOrZero(row.seats), 0);
  return {
    constituencies: results.length,
    totalSeats,
    validPoll,
    totalPoll,
    electorate,
    turnoutPct: electorate && totalPoll ? (totalPoll / electorate) * 100 : averageNumbers(results, 'turnoutPct')
  };
}
