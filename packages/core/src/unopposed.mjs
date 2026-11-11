/**
 * Seats returned without a poll (QA H4, 11 Nov 2026), in one small module with no imports so
 * the server-rendered record pages (packages/ui) can use it without loading election-domain.mjs.
 * site/browse/browse.js, which loads no package code, keeps a copy of candidateReturnWithoutPoll.
 *
 * How the data says it: a contest file's candidate carries `unopposed: true`; every built
 * candidacy (election bundle, records database `candidacies.status`, Browse) carries the status
 * "Elected unopposed" with no votes (first preferences null, or 0 in 252 older rows). The Dail's
 * Ceann Comhairle is "Elected (auto returned)" / `autoReturnedCeannComhairle`: also no poll for
 * that seat, though the constituency's other seats were contested.
 */

/** @param {unknown} value */
const votesOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * How a candidate was returned without a poll, or null when a poll was held for the seat.
 * @param {Record<string, unknown> | null | undefined} candidate
 * @returns {'unopposed' | 'auto-returned' | null}
 */
export function candidateReturnWithoutPoll(candidate) {
  if (!candidate) return null;
  const status = String(candidate.status ?? candidate.Status ?? '');
  if (candidate.autoReturnedCeannComhairle === true || /auto[- ]?returned/i.test(status)) return 'auto-returned';
  if (candidate.unopposed === true || candidate.unopposed === 1 || /unopposed/i.test(status)) return 'unopposed';
  return null;
}

/**
 * True for a candidate returned unopposed.
 * @param {Record<string, unknown> | null | undefined} candidate
 */
export function isUnopposedCandidate(candidate) {
  return candidateReturnWithoutPoll(candidate) === 'unopposed';
}

/**
 * True for a contest in which no poll was held: every candidate returned unopposed, or the
 * contest marked uncontested with no vote recorded. Its valid poll and turnout are not 0, they
 * do not exist.
 * @param {{ contestStatus?: unknown, candidates?: Array<Record<string, unknown>> } | null | undefined} result
 */
export function isUncontestedResult(result) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  if (candidates.length && candidates.every((candidate) => isUnopposedCandidate(candidate))) return true;
  return String(result?.contestStatus || '') === 'uncontested'
    && !candidates.some((candidate) => votesOf(candidate.firstPrefs ?? candidate.votes ?? candidate.finalVotes) > 0);
}

/**
 * True when no vote is recorded for any of a party's candidates in a seats-and-votes row: every
 * one returned unopposed (`unopposedSeats`, buildPartySummary), or a row with seats and no votes
 * at all (built before rows carried `unopposedSeats`). Its votes and share are not 0, there are
 * none, and a table shows a dash. `votes` may be given as `firstPrefs`.
 * @param {{ votes?: unknown, firstPrefs?: unknown, seats?: unknown, stood?: unknown, unopposedSeats?: unknown } | null | undefined} row
 */
export function partyHadNoPoll(row) {
  if (votesOf(row?.votes ?? row?.firstPrefs) > 0) return false;
  const unopposed = votesOf(row?.unopposedSeats);
  return unopposed > 0 ? votesOf(row?.stood || unopposed) <= unopposed : votesOf(row?.seats) > 0;
}

/** The note a seats-and-votes table carries when some seat in it was returned unopposed. */
export const UNOPPOSED_SEATS_NOTE = 'Seats returned unopposed count as seats but add no votes: votes and shares are of the contests that went to a poll.';

/**
 * Whether a contest went to a poll (one rule for every page; Elections arch audit, owner-approved
 * 11 Nov 2026):
 *   'unopposed'     no poll was held: isUncontestedResult() (every candidate returned unopposed,
 *                   or the contest marked uncontested with no vote recorded);
 *   'polled'        a vote is recorded;
 *   'not-recorded'  no vote is recorded and the contest is not known to be unopposed: the votes
 *                   are missing from the sources, not zero, and a page says "votes not recorded".
 * @typedef {'unopposed' | 'polled' | 'not-recorded'} PollStatus
 * @param {{ contestStatus?: unknown, validPoll?: unknown, candidates?: Array<Record<string, unknown>> } | null | undefined} result
 * @returns {PollStatus}
 */
export function contestPollStatus(result) {
  if (isUncontestedResult(result)) return 'unopposed';
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const polled = votesOf(result?.validPoll) > 0
    || candidates.some((candidate) => votesOf(candidate.firstPrefs ?? candidate.votes ?? candidate.finalVotes) > 0);
  return polled ? 'polled' : 'not-recorded';
}

/**
 * The same rule read from a row of an election summary, which has one line per contest and no
 * candidates (validPoll, leadingVotes, candidateCount, seatsTotal; the summaries write 0, not
 * null, for a contest without a poll). With no vote recorded, a contest that had no more
 * candidates than seats returned every candidate without a poll: unopposed. Over the records
 * build this agrees with contestPollStatus() for every contest
 * (tests/unit/elections-app-unopposed.test.mjs).
 * @param {{ validPoll?: unknown, leadingVotes?: unknown, candidateCount?: unknown, seatsTotal?: unknown } | null | undefined} row
 * @returns {PollStatus}
 */
export function summaryPollStatus(row) {
  if (votesOf(row?.validPoll) > 0 || votesOf(row?.leadingVotes) > 0) return 'polled';
  const candidates = votesOf(row?.candidateCount);
  const seats = votesOf(row?.seatsTotal);
  return candidates > 0 && seats > 0 && candidates <= seats ? 'unopposed' : 'not-recorded';
}

/** What a page writes for a contest's poll status, where a table cell or a map label needs words. */
export const POLL_STATUS_TEXT = Object.freeze({ unopposed: 'returned unopposed', polled: 'polled', 'not-recorded': 'votes not recorded' });
