/**
 * Which party won most seats in a contest, with ties kept (el-maps, 14 Nov 2026). An election
 * summary's winnerParty names one party even when two or more won the same number of seats (North
 * Antrim 2022: five parties one seat each; East Antrim 2022: DUP 2, Alliance 2), so a page that
 * shows "the winner" of a multi-member contest asks this instead and says "tie" when there is one.
 *
 * The rule: a seat is a candidate elected, at a poll or without one (returned unopposed, or the
 * Ceann Comhairle returned automatically: core's candidateReturnWithoutPoll). The parties with the
 * largest number of seats won; more than one is a tie. A candidate with no party counts under
 * "No party recorded" (core's NO_PARTY_RECORDED), never "Independent".
 *
 * Pure, no DOM: unit test elections-app-map-modes.test.mjs. Written so the other views (the
 * overview's and Compare's contest tables) can use the same rule.
 */
import { NO_PARTY_RECORDED } from '../../../pkg/core/src/election-domain.mjs';
import { candidateReturnWithoutPoll } from '../../../pkg/core/src/unopposed.mjs';

/**
 * A candidate as the rule reads it: an election bundle's or a contest answer's candidate.
 * @typedef {{ party?: string | null, elected?: boolean | number | null, status?: string | null, autoReturnedCeannComhairle?: boolean, unopposed?: boolean | number, firstPrefs?: number | null }} SeatCandidate
 */

/** True when a candidate took a seat, at a poll or without one. @param {SeatCandidate} c */
export function tookSeat(c) {
  return c.elected === true || c.elected === 1 || candidateReturnWithoutPoll(/** @type {Record<string, unknown>} */ (c)) !== null;
}

/** A candidate's party for counting seats: the label, or "No party recorded". @param {SeatCandidate} c */
export const seatParty = (c) => (c.party && String(c.party).trim() ? String(c.party) : NO_PARTY_RECORDED);

/**
 * Seats won per party in one contest, most seats first (then most first-preference votes, then
 * name), so the order is the same on every page.
 * @param {Iterable<SeatCandidate>} candidates
 * @returns {Array<{ party: string, seats: number, votes: number }>}
 */
export function seatsByParty(candidates) {
  /** @type {Map<string, { party: string, seats: number, votes: number }>} */
  const by = new Map();
  for (const c of candidates) {
    if (!tookSeat(c)) continue;
    const party = seatParty(c);
    const row = by.get(party) || { party, seats: 0, votes: 0 };
    row.seats += 1;
    row.votes += Number(c.firstPrefs) > 0 ? Number(c.firstPrefs) : 0;
    by.set(party, row);
  }
  return [...by.values()].sort((a, b) => b.seats - a.seats || b.votes - a.votes || a.party.localeCompare(b.party));
}

/**
 * The party or parties with most seats: one party, or several in a tie (`tie: true`), or none when
 * no candidate is recorded as elected.
 * @param {Iterable<SeatCandidate>} candidates
 * @returns {{ parties: string[], seats: number, tie: boolean, all: Array<{ party: string, seats: number, votes: number }> }}
 */
export function mostSeats(candidates) {
  return topOfSeats(seatsByParty(candidates));
}

/**
 * The tie rule itself, over seats already counted and ranked (seatsByParty's order): the parties
 * with the largest count, a tie when more than one. The overview and Compare apply it to the
 * election summary's seatsByParty, which the summaries count in the same order (core's
 * seatCountsByParty), so every view finds the same winner (lib/winner.js).
 * @param {Array<{ party: string, seats: number, votes: number }>} all
 * @returns {{ parties: string[], seats: number, tie: boolean, all: Array<{ party: string, seats: number, votes: number }> }}
 */
export function topOfSeats(all) {
  const top = all[0]?.seats || 0;
  const parties = top ? all.filter((r) => r.seats === top).map((r) => r.party) : [];
  return { parties, seats: top, tie: parties.length > 1, all };
}
