/**
 * Election results model: the pure helpers the election pane reads results through. Contest
 * classification (plurality, single-seat FPTP, referendum, forum, council aggregate),
 * referendum totals and outcome rows, the change-since-last-election ("delta") helpers, the
 * local-party and council summaries, and the STV transfer helpers.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1, seam E1) without
 * changing behaviour. Methods that read the active election from `this` take a context
 * instead: `{ bundle, entry, previousBundle }`, the manager's activeBundle, activeEntry and
 * previousBundle. Test2ElectionManager keeps one-line methods that delegate here, because
 * src/election-main-pane-contract.mjs calls them on the manager.
 *
 * Reconciled with the shared modules: sumNumbers and averageNumbers are the ones in
 * src/election-view-model.mjs (identical) and are re-exported from there; normalizeName is
 * src/election-domain.mjs's (identical output, memoised). buildLocalPartySummary and
 * buildCouncilSummary are NOT the view-model's functions of the same names: the map pane's
 * versions add seatShare, sort by share, resolve registry colours and keep a council's own
 * party colour and share, so they stay separate here.
 *
 * Pure: no DOM, no network, no module state.
 */
import {
  buildCandidateSummary,
  buildPartySummary,
  NO_LABEL,
  normalizeName,
  resolvePartyColour
} from '../../../core/src/election-domain.mjs';
import { averageNumbers, sumNumbers } from '../../../core/src/election-view-model.mjs';
import { mainPanePartyColour, partyColour } from './palette.mjs';

/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionRecord} ElectionRecord */
/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionResult} ElectionResult */
/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionContext} ElectionContext */

/**
 * A row the pane reads by name and coerces: a candidate, a referendum option, a count. The
 * sources differ in what they call a field (votes, firstPrefs, Total_Votes), so each is unknown
 * until read.
 * @typedef {{ [field: string]: unknown }} ResultRow
 */
/**
 * A candidate row with the previous election's row it was matched to.
 * @typedef {ResultRow & { previous?: ResultRow | null }} CandidateRow
 */
/**
 * A party's seats-and-votes row (buildPartySummary, the main-like summary): `share` is the
 * percentage of the vote, null when nothing was counted.
 * @typedef {ResultRow & { share: number | null }} PartyRow
 */
/**
 * A party within one area (buildLocalPartySummary).
 * @typedef {{
 *   party: unknown,
 *   constituency: unknown,
 *   resultKey: string,
 *   colour: string,
 *   stood: number,
 *   seats: number,
 *   firstPrefs: number,
 *   seatShare: number | null,
 *   share: number | null
 * }} LocalPartyRow
 */
/**
 * A council's running totals (buildCouncilSummary), by party name.
 * @typedef {{
 *   council: unknown,
 *   deas: number,
 *   seats: number,
 *   validPoll: number,
 *   electorate: number,
 *   partySeats: Map<unknown, number>,
 *   partyVotes: Map<unknown, number>,
 *   partyColours: Map<unknown, unknown>
 * }} CouncilTotals
 */
/**
 * A candidate in an STV count: when they were elected or excluded, and their row at each count.
 * @typedef {ResultRow & { excludedAt?: unknown, electedAt?: unknown, quota?: unknown, counts?: ResultRow[] }} StvCandidate
 */
/** @typedef {ElectionResult & { nonTransferable?: ResultRow[] }} StvResult */

export { averageNumbers, sumNumbers };

const PLURALITY_SYSTEMS = ['fptp', 'first past the post', 'first past post', 'block vote', 'block-vote'];

// ---------------------------------------------------------------------------------------------
// Numbers and statuses

/**
 * A finite number, or 0.
 * @param {unknown} value
 */
export function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * A number read from a figure ("1,234", "45.6%"), or null when there is none.
 * @param {unknown} value
 */
export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

/**
 * A candidate status read as 'elected', 'not_elected', 'excluded' or 'unknown'.
 * @param {unknown} status
 */
export function selectedPaneStatusKind(status) {
  const text = String(status || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('not elected')) return 'not_elected';
  if (text.includes('excluded')) return 'excluded';
  if (text.includes('elected') || text.includes('made quota') || text.includes('counted as elected') || text.includes('deemed elected')) return 'elected';
  return 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Contest classification

/**
 * A Northern Ireland Forum result (allocation rounds instead of counts).
 * @param {ElectionResult | null} [result]
 */
export function isForumResult(result = null) {
  return Boolean(result?.forum || result?.forumSequence || result?.allocationRounds);
}

/**
 * Whether the active election is a local-government one.
 * @param {ElectionContext} [context]
 */
export function isLocalGovernmentElection({ bundle = null, entry = null } = {}) {
  return (bundle?.bodyGroup || entry?.bodyGroup) === 'local-government';
}

/**
 * Whether a result was counted by STV (said so, or a quota and more than one count).
 * @param {ElectionResult} [result]
 */
export function isStvResult(result = {}) {
  const votingSystem = normalizeName(result.votingSystem || result.electionVotingSystem || result.system || '');
  if (votingSystem.includes('stv')) return true;
  const quota = finiteNumber(result.quota ?? result.Quota ?? result.countInfo?.Quota);
  return quota !== null && Array.isArray(result.countNumbers) && result.countNumbers.some((count) => Number(count) > 1);
}

/**
 * A plurality (FPTP or block vote) result: its own voting system, else the election's.
 * @param {ElectionResult} [result]
 * @param {ElectionContext} [context]
 */
export function isPluralityResult(result = {}, { bundle = null, entry = null } = {}) {
  if (!result || isStvResult(result)) return false;
  const votingSystem = normalizeName(
    result.votingSystem || result.electionVotingSystem || result.system
    || bundle?.votingSystem || entry?.votingSystem || ''
  );
  return PLURALITY_SYSTEMS.includes(votingSystem);
}

/**
 * Every result is plurality (and there is at least one).
 * @param {ElectionResult[]} [results]
 * @param {ElectionContext} [context]
 */
export function isPluralityElection(results = [], context = {}) {
  return results.length > 0 && results.every((result) => isPluralityResult(result, context));
}

/**
 * A council or district aggregate built from a local election's DEA results.
 * @param {ElectionResult | null} [result]
 * @param {ElectionContext} [context]
 */
export function isCouncilAggregateResult(result = null, context = {}) {
  if (!result || !isLocalGovernmentElection(context)) return false;
  return result.aggregateType === 'council' || result.aggregateType === 'district';
}

/**
 * A plurality election contest with at least one seat: shown as a candidate list. Two-member
 * plurality seats count too (the name predates them).
 * @param {ElectionResult} [result]
 * @param {ElectionContext} [context]
 */
export function isSingleSeatFptpResult(result = {}, context = {}) {
  const { bundle = null, entry = null } = context;
  if (!result || result.recallPetition || isCouncilAggregateResult(result, context) || isForumResult(result)) return false;
  const contestType = normalizeName(result.contestType || bundle?.contestType || entry?.contestType || 'election');
  if (contestType && contestType !== 'election') return false;
  const votingSystem = normalizeName(
    result.votingSystem
    || result.electionVotingSystem
    || result.system
    || bundle?.votingSystem
    || entry?.votingSystem
    || ''
  );
  // A two-member seat elected by block vote is plurality voting too, and is classed so.
  if (!PLURALITY_SYSTEMS.includes(votingSystem)) return false;
  const explicitSeats = [
    result.seatsTotal,
    result.seatsWon,
    result.seats,
    result.countInfo?.Number_Of_Seats,
    result.countInfo?.numberOfSeats,
    result.countInfo?.Seats
  ]
    .map(finiteNumber)
    .filter(/** @returns {value is number} */ (value) => value !== null && value > 0);
  // A two-member plurality seat (Cork City and Dublin University before 1918,
  // Antrim and Down 1922-45) reads as a candidate list too: each candidate is marked
  // elected from their own status. The party table these seats used to fall through to
  // is built for STV and showed an unopposed double return as "Valid votes 0" with no
  // names at all. The function keeps its name for its callers.
  if (explicitSeats.length) return Math.max(...explicitSeats) >= 1;
  const electedCount = (result.candidates || []).filter((candidate) => {
    if (candidate.elected) return true;
    return selectedPaneStatusKind(candidate.status || candidate.Status) === 'elected';
  }).length;
  return electedCount >= 1;
}

/**
 * Whether the result, or else the active election, is a referendum.
 * @param {ElectionResult | null} [result]
 * @param {ElectionContext} [context]
 */
export function isReferendumElection(result = null, { bundle = null, entry = null } = {}) {
  const values = [
    result?.contestType,
    result?.type,
    result?.body,
    bundle?.contestType,
    entry?.contestType,
    bundle?.body,
    entry?.body,
    bundle?.key,
    entry?.key
  ].map((value) => normalizeName(value));
  return values.some((value) => value.includes('referendum'));
}

// ---------------------------------------------------------------------------------------------
// Referendums

/**
 * Valid poll, total poll, electorate, spoiled and turnout for a referendum result.
 * @param {ElectionResult} [result]
 * @param {ResultRow[]} [rows]
 */
export function referendumStats(result = {}, rows = []) {
  const countInfo = /** @type {ResultRow} */ (result?.countInfo || {});
  const totals = /** @type {ResultRow} */ (result?.mainLikeTotals || {});
  const votesFromRows = rows.reduce((sum, row) => sum + numberOrZero(row.votes ?? row.firstPrefs ?? row.finalVotes ?? row.total), 0);
  const validPoll = finiteNumber(totals.validPoll ?? result.validPoll ?? countInfo.Valid_Poll) ?? (votesFromRows || null);
  const electorate = finiteNumber(totals.totalElectorate ?? result.electorate ?? countInfo.Total_Electorate);
  const explicitTotalPoll = finiteNumber(totals.totalPoll ?? result.totalPoll ?? countInfo.Total_Poll);
  const sourceTurnoutPct = finiteNumber(result.turnoutPct ?? result.turnout_pct ?? countInfo.Turnout_Pct);
  const totalPoll = explicitTotalPoll && explicitTotalPoll > 0
    ? explicitTotalPoll
    : (electorate !== null && sourceTurnoutPct !== null
    ? Math.round(electorate * sourceTurnoutPct / 100)
    : null);
  const explicitSpoiled = finiteNumber(totals.totalSpoiled ?? result.spoiled ?? countInfo.Spoiled);
  const spoiled = explicitSpoiled && explicitSpoiled > 0
    ? explicitSpoiled
    : (totalPoll !== null && validPoll !== null ? Math.max(0, totalPoll - validPoll) : explicitSpoiled);
  const turnoutPct = sourceTurnoutPct ?? (electorate !== null && totalPoll !== null && electorate > 0
    ? totalPoll / electorate * 100
    : null);
  return { validPoll, totalPoll, electorate, spoiled, turnoutPct };
}

/**
 * Referendum outcome rows (Yes/No, or the options), elected first then by votes. `roi` is the
 * manager's usesMainRoiPartyPalette() and picks the outcome colours.
 * @param {ResultRow[]} [sourceRows]
 * @param {number | null} [validPoll]
 * @param {boolean} [roi]
 */
export function referendumOutcomeRows(sourceRows = [], validPoll = null, roi = false) {
  return sourceRows
    .map((row) => {
      const outcome = row.party || row.name || row.candidate || row.label || '';
      const votes = finiteNumber(row.votes ?? row.firstPrefs ?? row.finalVotes ?? row.total) ?? 0;
      const share = finiteNumber(row.share ?? row.firstPrefPct ?? row.constPct) ?? (validPoll ? votes / validPoll * 100 : null);
      return {
        outcome,
        votes,
        share,
        constituencies: finiteNumber(row.seats ?? row.constituenciesWon ?? row.constituencies),
        colour: mainPanePartyColour(outcome, row.colour, roi),
        elected: Boolean(row.elected) || selectedPaneStatusKind(row.status || row.Status) === 'elected'
      };
    })
    .filter((row) => row.outcome)
    .sort((a, b) => {
      if (Number(Boolean(b.elected)) !== Number(Boolean(a.elected))) return Number(Boolean(b.elected)) - Number(Boolean(a.elected));
      if (numberOrZero(b.votes) !== numberOrZero(a.votes)) return numberOrZero(b.votes) - numberOrZero(a.votes);
      return String(a.outcome).localeCompare(String(b.outcome));
    });
}

// ---------------------------------------------------------------------------------------------
// Changes since the previous election

/**
 * Party rows with `previous` and `deltas` (stood, seats, votes, share). The previous rows are
 * options.previousRows, else the summary of options.previousResults, else the previous
 * bundle's (its main-like summary when options.mainLike).
 * @template {PartyRow} R
 * @param {R[]} [rows]
 * @param {{ previousRows?: PartyRow[], previousResults?: ElectionResult[], mainLike?: boolean }} [options]
 * @param {{ previousBundle?: ElectionRecord | null }} [context]
 */
export function withPartyDeltas(rows = [], options = {}, { previousBundle = /** @type {ElectionRecord | null} */ (null) } = {}) {
  const previousRows = Array.isArray(options.previousRows)
    ? options.previousRows
    : Array.isArray(options.previousResults)
    ? buildPartySummary(options.previousResults)
    : options.mainLike && previousBundle?.mainLikePartySummary?.length
    ? previousBundle.mainLikePartySummary
    : (previousBundle?.results?.length ? buildPartySummary(previousBundle.results) : []);
  // A party absent from the previous election -- or every party, when there is no previous
  // election -- has no previous result: its changes are null ("no previous result", shown as
  // an en dash), not a change equal to its whole figure. A party that DID stand and won
  // nothing keeps its real zero, so a gain from it still reads +N.
  const previousByParty = new Map(previousRows.map((row) => /** @type {[string, PartyRow]} */ ([normalizeName(row.party), row])));
  return rows.map((row) => {
    const previous = previousByParty.get(normalizeName(row.party)) || null;
    return {
      ...row,
      previous,
      deltas: previous ? {
        stood: numberOrZero(row.stood) - numberOrZero(previous.stood),
        seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
        votes: numberOrZero(row.votes) - numberOrZero(previous.votes),
        share: row.share !== null && previous.share !== null ? row.share - previous.share : null
      } : null
    };
  });
}

/**
 * Candidate changes are shown for elections only: not referendums, recall petitions, list or forum contests.
 * @param {ElectionResult} [result]
 * @param {ElectionContext} [context]
 */
export function candidateDeltasEligible(result = {}, { bundle = null, entry = null } = {}) {
  const contestType = normalizeName(result?.contestType || bundle?.contestType || entry?.contestType || 'election');
  if (contestType && contestType !== 'election') return false;
  const haystack = normalizeName([
    result?.body,
    result?.title,
    result?.type,
    result?.contestType,
    result?.votingSystem,
    bundle?.body,
    bundle?.type,
    bundle?.votingSystem,
    entry?.body,
    entry?.displayTitle,
    entry?.key,
    entry?.votingSystem
  ].filter(Boolean).join(' '));
  if (/referendum|recall petition/.test(haystack)) return false;
  if (/northern ireland forum|regional list|party list dhondt|party-list-dhondt|ordinal/.test(haystack)) return false;
  return true;
}

/**
 * The area a candidate row stood in, normalised.
 * @param {ResultRow} [row]
 * @param {ElectionResult} [result]
 */
export function candidateDeltaAreaKey(row = {}, result = {}) {
  return normalizeName(row.constituency || row.area || row.dea || row.district || row.localBody || result?.constituency || result?.matchName || result?.name || '');
}

/**
 * "name|area": how a candidate is matched with their previous result.
 * @param {ResultRow} [row]
 * @param {ElectionResult} [result]
 */
export function candidateDeltaLookupKey(row = {}, result = {}) {
  const name = normalizeName(row.name || row.candidateName || row.candidate || row.Candidate_Name || row.Candidate || '');
  const area = candidateDeltaAreaKey(row, result);
  return [name, area].filter(Boolean).join('|');
}

/**
 * A candidate's first-preference (or only) vote.
 * @param {ResultRow} [row]
 */
export function candidateFirstPrefValue(row = {}) {
  return numberOrZero(row.firstPrefs ?? row.votes ?? row.finalVotes ?? row.total ?? row.Total_Votes);
}

/**
 * A candidate's first-preference share: given, else computed from the result's valid poll.
 * @param {ResultRow} [row]
 * @param {ElectionResult} [result]
 */
export function candidateFirstPrefPct(row = {}, result = {}) {
  const explicit = row.firstPrefPct ?? row.votePct ?? row.constPct ?? row.share;
  if (Number.isFinite(Number(explicit))) return Number(explicit);
  const validPoll = numberOrZero(result?.validPoll);
  if (!validPoll) return null;
  return candidateFirstPrefValue(row) / validPoll * 100;
}

/**
 * `{ previous, deltas }` for one candidate against their previous row.
 * @param {ResultRow} [row]
 * @param {ResultRow | null} [previous]
 * @param {ElectionResult} [result]
 * @param {ElectionResult} [previousResult]
 */
export function buildCandidateDelta(row = {}, previous = null, result = {}, previousResult = {}) {
  if (!previous) return { previous: null, deltas: null };
  const currentPct = candidateFirstPrefPct(row, result);
  const previousPct = candidateFirstPrefPct(previous, previousResult);
  return {
    previous,
    deltas: {
      firstPrefs: candidateFirstPrefValue(row) - candidateFirstPrefValue(previous),
      firstPrefPct: currentPct !== null && previousPct !== null ? currentPct - previousPct : null
    }
  };
}

/**
 * Candidate rows with `previous` and `deltas`, matched by name and area.
 * @template {CandidateRow} R
 * @param {R[]} [rows]
 * @param {{ result?: ElectionResult, previousResults?: ElectionResult[], previousRows?: CandidateRow[], mainLike?: boolean }} [options]
 * @param {ElectionContext} [context]
 */
export function withCandidateDeltas(rows = [], options = {}, context = {}) {
  const { previousBundle = null } = context;
  if (!candidateDeltasEligible(options.result || {}, context)) {
    return rows.map((row) => ({ ...row, previous: row.previous || null, deltas: null }));
  }
  const previousResultByArea = new Map(
    (Array.isArray(options.previousResults) ? options.previousResults : [])
      .map((result) => /** @type {[string, ElectionResult]} */ ([candidateDeltaAreaKey({}, result), result]))
      .filter(([key]) => key)
  );
  const previousRows = Array.isArray(options.previousRows)
    ? options.previousRows
    : Array.isArray(options.previousResults)
    ? buildCandidateSummary(options.previousResults)
    : options.mainLike && previousBundle?.mainLikeCandidateSummary?.length
    ? previousBundle.mainLikeCandidateSummary
    : (previousBundle?.results?.length ? buildCandidateSummary(previousBundle.results) : []);
  const previousByCandidate = new Map(previousRows
    .map((row) => /** @type {[string, CandidateRow]} */ ([candidateDeltaLookupKey(row), row]))
    .filter(([key]) => key));
  return rows.map((row) => {
    const key = candidateDeltaLookupKey(row);
    const explicitPrevious = row.previous && candidateDeltaLookupKey(row.previous) === key ? row.previous : null;
    const previous = explicitPrevious || previousByCandidate.get(key) || null;
    const previousResult = previous ? previousResultByArea.get(candidateDeltaAreaKey(previous)) || {} : {};
    const delta = buildCandidateDelta(row, previous, options.result || {}, previousResult);
    return {
      ...row,
      previous: delta.previous,
      deltas: delta.deltas
    };
  });
}

/**
 * Council summary rows with `previous` and `deltas` against the previous bundle's councils.
 * @param {ReturnType<typeof buildCouncilSummary>} [rows]
 * @param {{ previousBundle?: ElectionRecord | null }} [context]
 */
export function withCouncilDeltas(rows = [], { previousBundle = /** @type {ElectionRecord | null} */ (null) } = {}) {
  const previousRows = previousBundle?.results?.length ? buildCouncilSummary(previousBundle.results) : [];
  const previousByCouncil = new Map(previousRows.map((row) => [normalizeName(row.council), row]));
  return rows.map((row) => {
    const previous = previousByCouncil.get(normalizeName(row.council));
    return {
      ...row,
      previous,
      deltas: previous ? {
        seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
        validPoll: numberOrZero(row.validPoll) - numberOrZero(previous.validPoll),
        turnoutPct: row.turnoutPct !== null && previous.turnoutPct !== null ? row.turnoutPct - previous.turnoutPct : null
      } : null
    };
  });
}

/**
 * Local party rows (party within area) with `previous` and `deltas`.
 * @param {LocalPartyRow[]} [rows]
 * @param {{ previousResults?: ElectionResult[] }} [options]
 * @param {{ previousBundle?: ElectionRecord | null }} [context]
 */
export function withLocalPartyDeltas(rows = [], options = {}, { previousBundle = /** @type {ElectionRecord | null} */ (null) } = {}) {
  const previousRows = Array.isArray(options.previousResults)
    ? buildLocalPartySummary(options.previousResults)
    : (previousBundle?.results?.length ? buildLocalPartySummary(previousBundle.results) : []);
  const previousByPartyAndArea = new Map(previousRows.map((row) => [
    `${normalizeName(row.party)}|${normalizeName(row.constituency)}`,
    row
  ]));
  // As withPartyDeltas: a party that did not contest this area last time has no change.
  return rows.map((row) => {
    const previous = previousByPartyAndArea.get(`${normalizeName(row.party)}|${normalizeName(row.constituency)}`) || null;
    return {
      ...row,
      previous,
      deltas: previous ? {
        stood: numberOrZero(row.stood) - numberOrZero(previous.stood),
        seats: numberOrZero(row.seats) - numberOrZero(previous.seats),
        seatShare: row.seatShare !== null && previous.seatShare !== null ? row.seatShare - previous.seatShare : null,
        firstPrefs: numberOrZero(row.firstPrefs) - numberOrZero(previous.firstPrefs),
        share: row.share !== null && previous.share !== null ? row.share - previous.share : null
      } : null
    };
  });
}

/**
 * The previous bundle's results for one council.
 * @param {unknown} councilName
 * @param {{ previousBundle?: ElectionRecord | null }} [context]
 */
export function previousResultsForCouncil(councilName, { previousBundle = /** @type {ElectionRecord | null} */ (null) } = {}) {
  const normalized = normalizeName(councilName);
  if (!normalized) return [];
  return (previousBundle?.results || []).filter((result) => normalizeName(result.localBody || '') === normalized);
}

// ---------------------------------------------------------------------------------------------
// Summaries

/**
 * One row per party per area: stood, seats, seat share, first preferences and share.
 * @param {ElectionResult[]} [results]
 * @returns {LocalPartyRow[]}
 */
export function buildLocalPartySummary(results = []) {
  /** @type {LocalPartyRow[]} */
  const rows = [];
  for (const result of results) {
    /** @type {Map<unknown, LocalPartyRow>} */
    const byParty = new Map();
    const validPoll = Number(result.validPoll || result.totalVotes || 0);
    for (const candidate of result.candidates || []) {
      const party = candidate.party || NO_LABEL;
      const key = normalizeName(party) || party;
      if (!byParty.has(key)) {
        byParty.set(key, {
          party,
          constituency: result.constituency || result.matchName || '',
          resultKey: normalizeName(result.matchName || result.constituency || ''),
          // The cast is for main's untyped resolvePartyColour (its sourceColour reads as a string); drop it once packages/core is typed (S0).
          colour: resolvePartyColour(party, /** @type {string | undefined} */ (candidate.colour), '') || partyColour(party),
          stood: 0,
          seats: 0,
          firstPrefs: 0,
          seatShare: null,
          share: null
        });
      }
      const row = /** @type {LocalPartyRow} */ (byParty.get(key));
      row.stood += 1;
      row.firstPrefs += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
      if (candidate.elected) row.seats += 1;
    }
    for (const row of byParty.values()) {
      row.seatShare = Number(result.seatsTotal) ? row.seats / Number(result.seatsTotal) * 100 : null;
      row.share = validPoll ? row.firstPrefs / validPoll * 100 : null;
      rows.push(row);
    }
  }
  return rows.sort((a, b) =>
    numberOrZero(b.share) - numberOrZero(a.share)
    || numberOrZero(b.firstPrefs) - numberOrZero(a.firstPrefs)
    || String(a.party).localeCompare(String(b.party))
    || String(a.constituency).localeCompare(String(b.constituency))
  );
}

/**
 * One row per council: DEAs, seats, valid poll, electorate, the leading party and turnout.
 * @param {ElectionResult[]} [results]
 */
export function buildCouncilSummary(results = []) {
  /** @type {Map<unknown, CouncilTotals>} */
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
        partyVotes: new Map(),
        partyColours: new Map()
      });
    }
    const row = /** @type {CouncilTotals} */ (councils.get(council));
    row.deas += 1;
    row.seats += Number(result.seatsWon ?? result.seatsTotal ?? 0) || 0;
    row.validPoll += Number(result.validPoll || result.totalVotes || 0) || 0;
    row.electorate += Number(result.electorate || 0) || 0;
    for (const candidate of result.candidates || []) {
      const party = candidate.party || NO_LABEL;
      row.partyVotes.set(party, (row.partyVotes.get(party) || 0) + (Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0));
      if (candidate.colour && !row.partyColours.has(party)) row.partyColours.set(party, candidate.colour);
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
      colour: row.partyColours.get(leading[0]) || partyColour(leading[0]),
      share: row.validPoll ? (row.partyVotes.get(leading[0]) || 0) / row.validPoll * 100 : null,
      turnoutPct: row.electorate ? row.validPoll / row.electorate * 100 : null
    };
  }).sort((a, b) => String(a.council).localeCompare(String(b.council)));
}

// ---------------------------------------------------------------------------------------------
// STV transfers

/**
 * Counts as sorted unique numbers.
 * @param {unknown[]} [countNumbers]
 */
export function normalizedCountSequence(countNumbers = []) {
  return [...new Set(countNumbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

/**
 * The count before `count` in a sorted sequence, or null.
 * @param {unknown[]} countNumbers
 * @param {unknown} count
 */
export function previousSourceCount(countNumbers = [], count) {
  let previous = null;
  for (const candidate of countNumbers) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric >= Number(count)) break;
    previous = numeric;
  }
  return previous;
}

/**
 * A count after a candidate's terminal transfer shows a dash.
 * @param {unknown} count
 * @param {unknown} terminalCount
 */
export function shouldDashAfterTerminalTransfer(count, terminalCount) {
  return terminalCount !== null && terminalCount !== undefined && Number(count) > Number(terminalCount);
}

/**
 * The row to show for a candidate at a count, inferring the transfer out (an exclusion or a
 * surplus) when the source left it out on the count after the event.
 * @param {StvCandidate} candidate
 * @param {unknown} count
 * @param {Map<number, ResultRow>} counts  the candidate's rows by count number
 * @param {ElectionResult} result
 * @param {unknown[]} countNumbers
 * @param {ResultRow | null | undefined} [baseRow]  the candidate's own row at `count`
 */
export function terminalTransferOutDisplayRow(candidate = {}, count, counts = new Map(), result = {}, countNumbers = [], baseRow = /** @type {{ [field: string]: unknown } | null} */ (null)) {
  const numericCount = Number(count);
  if (!Number.isFinite(numericCount) || numericCount <= 1) return baseRow || null;
  const actualTransfer = finiteNumber(baseRow?.transfers);
  if (actualTransfer !== null && actualTransfer < -0.01) return baseRow;

  const normalizedCounts = normalizedCountSequence(countNumbers.length ? countNumbers : [...counts.keys()]);
  const previousCount = previousSourceCount(normalizedCounts, numericCount);
  if (previousCount === null) return baseRow || null;
  const eventCount = Number(candidate.excludedAt || candidate.electedAt || 0);
  if (!eventCount || eventCount !== previousCount) return baseRow || null;

  const eventRow = counts.get(eventCount);
  const eventTotal = finiteNumber(eventRow?.total ?? eventRow?.firstPrefs);
  if (eventTotal === null || eventTotal <= 0.01) return baseRow || null;

  if (candidate.excludedAt && Number(candidate.excludedAt) === eventCount) {
    return {
      ...(baseRow || {}),
      count: numericCount,
      total: 0,
      transfers: -eventTotal,
      status: 'Excluded transfer'
    };
  }

  if (candidate.electedAt && Number(candidate.electedAt) === eventCount) {
    const quota = finiteNumber(result.quota ?? result.Quota ?? result.countInfo?.Quota ?? candidate.quota);
    if (quota === null || quota <= 0 || eventTotal <= quota + 0.01) return baseRow || null;
    return {
      ...(baseRow || {}),
      count: numericCount,
      total: quota,
      transfers: quota - eventTotal,
      status: 'Surplus transfer'
    };
  }

  return baseRow || null;
}

/**
 * The count at which a candidate's votes were all transferred out (excluded, or cut to quota), or null.
 * @param {StvCandidate} [candidate]
 * @param {Map<number, ResultRow>} [counts]
 * @param {ElectionResult} [result]
 * @param {unknown[]} [countNumbers]
 * @returns {number | null}
 */
export function terminalTransferOutCount(candidate = {}, counts = new Map(), result = {}, countNumbers = []) {
  const quota = finiteNumber(result.quota ?? result.Quota ?? result.countInfo?.Quota ?? candidate.quota);
  const rows = normalizedCountSequence(countNumbers.length ? countNumbers : [...counts.keys()]);
  /** @type {number | null} */
  let terminalCount = null;

  rows.forEach((count) => {
    if (terminalCount !== null || count <= 1) return;
    const row = terminalTransferOutDisplayRow(candidate, count, counts, result, rows, counts.get(count));
    if (!row) return;
    const total = finiteNumber(row.total ?? row.firstPrefs);
    const transfer = finiteNumber(row.transfers);
    if (total === null || transfer === null || transfer >= -0.01) return;

    const wasExcludedAndRedistributed = total <= 0.01;
    const wasSurplusReducedToQuota = quota !== null
      && quota > 0
      && Math.abs(total - quota) <= 0.01;

    if (wasExcludedAndRedistributed || wasSurplusReducedToQuota) {
      terminalCount = count;
    }
  });

  return terminalCount;
}

/**
 * Per count: the non-transferable row (explicit, or inferred from the candidates' transfers)
 * and the denominators transfer shares are taken over (votes received, votes transferred out).
 * @param {StvResult} [result]
 * @param {StvCandidate[]} [candidates]
 * @param {unknown[]} [countNumbers]
 */
export function buildStvTransferContext(result = {}, candidates = [], countNumbers = []) {
  const explicitNonTransferable = new Map((result.nonTransferable || []).map((row) => [Number(row.count), row]));
  /** @type {Map<number, { count: number, total: number, transfers: number, inferred: boolean }>} */
  const nonTransferable = new Map();
  /** @type {Map<number, { positive: number, negativeAbs: number }>} */
  const transferDenominators = new Map();
  let runningNonTransferableTotal = 0;
  const normalizedCountNumbers = normalizedCountSequence(countNumbers);
  for (const count of normalizedCountNumbers) {
    const explicitRow = explicitNonTransferable.get(count);
    let candidateTransferSum = 0;
    let positiveRecipientTransfers = 0;
    let negativeTransferOutAbs = 0;
    for (const candidate of candidates || []) {
      const counts = new Map((candidate.counts || []).map((entry) => [Number(entry.count), entry]));
      const row = counts.get(count);
      const displayRow = terminalTransferOutDisplayRow(candidate, count, counts, result, normalizedCountNumbers, row);
      const transfer = finiteNumber(displayRow?.transfers);
      if (transfer === null) continue;
      candidateTransferSum += transfer;
      if (transfer > 0) positiveRecipientTransfers += transfer;
      if (transfer < 0) negativeTransferOutAbs += Math.abs(transfer);
    }
    let nonTransferableTransfer = finiteNumber(explicitRow?.transfers);
    if (nonTransferableTransfer === null && count > 1) {
      const inferred = -candidateTransferSum;
      nonTransferableTransfer = inferred > 0.0001 ? inferred : 0;
    }
    let nonTransferableTotal = finiteNumber(explicitRow?.total);
    if (nonTransferableTotal === null) {
      nonTransferableTotal = count <= 1
        ? 0
        : runningNonTransferableTotal + Math.max(0, nonTransferableTransfer || 0);
    }
    runningNonTransferableTotal = nonTransferableTotal;
    nonTransferable.set(count, {
      count,
      total: nonTransferableTotal,
      transfers: nonTransferableTransfer || 0,
      inferred: !explicitRow
    });
    transferDenominators.set(count, {
      positive: positiveRecipientTransfers + Math.max(0, nonTransferableTransfer || 0),
      negativeAbs: negativeTransferOutAbs
    });
  }
  return { nonTransferable, transferDenominators };
}
