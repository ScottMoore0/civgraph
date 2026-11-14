/**
 * "Same votes, other systems" (el-context, 14 Nov 2026): an STV or first-past-the-post election's
 * first preferences, shared out again under D'Hondt, Sainte-Laguë, first past the post (where
 * every contest elects one member) and pure national proportional representation. Illustrative
 * arithmetic, never a prediction: the same votes, no tactical change, no transfers. Pure (no DOM):
 * tests/unit/elections-app-other-systems.test.mjs. The seat methods are packages/core's
 * (apportionment.mjs, served at /pkg/).
 *
 * What is assumed, as the methods note on the page says it:
 *   - every party keeps its first preferences; the constituencies and their seats are unchanged;
 *   - in multi-member contests, D'Hondt and Sainte-Laguë share out each constituency's seats; when
 *     every contest elects one member they would just repeat first past the post, so they share out
 *     all the seats as one area instead;
 *   - pure PR shares out all the seats as one area by the Hare quota and the largest remainders;
 *   - a party is the label on the ballot paper as recorded; a candidate with no party, or with a
 *     label that starts "Independent", stands as a list of one and can take one seat at most;
 *   - a seat returned without a poll (unopposed, the outgoing Ceann Comhairle), and every seat of
 *     a contest whose votes are not all recorded, is kept as it was under every system.
 */
import { highestAverages, largestRemainder, plurality } from '../../../pkg/core/src/apportionment.mjs';
import { NO_PARTY_RECORDED } from '../../../pkg/core/src/election-domain.mjs';
import { candidateReturnWithoutPoll, contestPollStatus } from '../../../pkg/core/src/unopposed.mjs';

/**
 * A candidate as an election bundle gives one (only the fields read here).
 * @typedef {{ name?: unknown, party?: unknown, colour?: unknown, firstPrefs?: unknown, votes?: unknown, elected?: unknown, status?: unknown, unopposed?: unknown, autoReturnedCeannComhairle?: unknown }} BundleCandidate
 * @typedef {{ constituency?: unknown, seatsTotal?: unknown, validPoll?: unknown, contestStatus?: unknown, candidates?: BundleCandidate[] }} BundleResult
 */

/**
 * One contest, ready to share out: the seats open to a poll, its lists, and the seats kept as they
 * were (returned without a poll, or the whole contest when its votes are not all recorded).
 * @typedef {{ id: string, party: string, votes: number, cap?: number }} PartyList
 * @typedef {{ name: string, seats: number, open: number, lists: PartyList[], kept: Map<string, number>, actual: Map<string, number>, status: 'counted' | 'unopposed' | 'incomplete' }} SystemsContest
 */

/** The systems a column can show. @typedef {'actual' | 'fptp' | 'dhondt' | 'sainteLague' | 'pr'} SystemId */

/**
 * The comparison: whether it applies, its columns, and a row per party.
 * @typedef {{ party: string, colour: string, votes: number, share: number | null, seats: Record<SystemId, number> }} SystemsRow
 * @typedef {{
 *   applicable: true, singleMember: boolean, columns: SystemId[], rows: SystemsRow[], seats: number,
 *   contests: number, unopposed: number, incomplete: number, keptSeats: number, votes: number
 * } | { applicable: false, reason: 'system' | 'block-vote' | 'no-votes' }} SystemsComparison
 */

const finite = (/** @type {unknown} */ v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The party a candidate's seat counts for: the ballot label, or "No party recorded". @param {BundleCandidate} c */
export const partyOf = (c) => String(c.party || '').trim() || NO_PARTY_RECORDED;

/** True for a label whose candidates stand alone (each a list of one). @param {string} party */
export const standsAlone = (party) => party === NO_PARTY_RECORDED || /^(independent|non-party)\b/i.test(party);

/**
 * The contests of an election bundle (its `results`), each with its lists and kept seats.
 * @param {readonly BundleResult[]} results
 * @returns {SystemsContest[]}
 */
export function systemsContests(results) {
  return (results || []).map((r) => {
    const cands = Array.isArray(r.candidates) ? r.candidates : [];
    /** @type {Map<string, number>} */
    const actual = new Map();
    for (const c of cands) if (c.elected === true || c.elected === 1) actual.set(partyOf(c), (actual.get(partyOf(c)) || 0) + 1);
    const seats = finite(r.seatsTotal) || [...actual.values()].reduce((s, n) => s + n, 0) || 1;
    const poll = contestPollStatus(/** @type {Parameters<typeof contestPollStatus>[0]} */ (r));
    const name = String(r.constituency || '');
    if (poll === 'unopposed') return { name, seats, open: 0, lists: [], kept: actual, actual, status: /** @type {const} */ ('unopposed') };
    // Seats returned without a poll inside a polled contest stay as they were.
    /** @type {Map<string, number>} */
    const kept = new Map();
    const polled = [];
    for (const c of cands) {
      if (candidateReturnWithoutPoll(/** @type {Record<string, unknown>} */ (c))) kept.set(partyOf(c), (kept.get(partyOf(c)) || 0) + 1);
      else polled.push(c);
    }
    const open = Math.max(0, seats - [...kept.values()].reduce((s, n) => s + n, 0));
    const votesOf = (/** @type {BundleCandidate} */ c) => finite(c.firstPrefs ?? c.votes);
    // Not every vote recorded (or only the members elected are known): the contest keeps its result.
    if (poll !== 'polled' || polled.some((c) => votesOf(c) === null) || polled.length <= open) {
      return { name, seats, open: 0, lists: [], kept: actual, actual, status: /** @type {const} */ ('incomplete') };
    }
    /** @type {Map<string, PartyList>} */
    const lists = new Map();
    for (const c of polled) {
      const party = partyOf(c);
      const alone = standsAlone(party);
      const id = alone ? `${party}\u0000${String(c.name || '')}\u0000${lists.size}` : party;
      const l = lists.get(id) || { id, party, votes: 0, ...(alone ? { cap: 1 } : {}) };
      l.votes += Number(votesOf(c));
      lists.set(id, l);
    }
    return { name, seats, open, lists: [...lists.values()], kept, actual, status: /** @type {const} */ ('counted') };
  });
}

/**
 * Seats by party from seats by list id.
 * @param {Map<string, number>} won @param {Map<string, string>} partyOfList @param {Map<string, number>} into
 */
function credit(won, partyOfList, into) {
  for (const [id, n] of won) {
    const party = /** @type {string} */ (partyOfList.get(id));
    into.set(party, (into.get(party) || 0) + n);
  }
}

/**
 * Lists summed across contests: a party's votes into one national list; each candidate standing
 * alone stays a list of one.
 * @param {SystemsContest[]} contests
 */
function nationalLists(contests) {
  /** @type {Map<string, PartyList>} */
  const out = new Map();
  for (const c of contests) {
    for (const l of c.lists) {
      const id = l.cap === 1 ? `${c.name}\u0000${l.id}` : l.id;
      const cur = out.get(id) || { ...l, id, votes: 0 };
      cur.votes += l.votes;
      out.set(id, cur);
    }
  }
  return [...out.values()];
}

/**
 * Whether an election is one the comparison can work from, told before its votes load: STV, or
 * first past the post with one seat a contest (the summary's seats per contest).
 * @param {string | null | undefined} votingSystem
 * @param {ReadonlyArray<{ seatsTotal?: unknown }>} contests the election summary's rows
 */
export function systemsOffered(votingSystem, contests) {
  const system = String(votingSystem || '');
  if (/^stv/.test(system)) return contests.length > 0;
  return system === 'fptp' && contests.length > 0 && contests.every((c) => (finite(c.seatsTotal) ?? 1) <= 1);
}

/**
 * Compare the election's seats under other systems, from its bundle results and voting system.
 * @param {readonly BundleResult[]} results
 * @param {string | null | undefined} votingSystem the election's (election-types registry id)
 * @param {Map<string, string>} [colours] party -> colour (the election's party summary)
 * @returns {SystemsComparison}
 */
export function compareSystems(results, votingSystem, colours = new Map()) {
  const system = String(votingSystem || '');
  const stv = /^stv/.test(system);
  if (!stv && system !== 'fptp') return { applicable: false, reason: 'system' };
  const contests = systemsContests(results);
  const singleMember = contests.every((c) => c.seats === 1);
  // First past the post with several seats a contest is the block vote: a voter's several votes
  // are not first preferences, and no list arithmetic applies.
  if (!stv && !singleMember) return { applicable: false, reason: 'block-vote' };
  const counted = contests.filter((c) => c.status === 'counted');
  if (!counted.length) return { applicable: false, reason: 'no-votes' };

  /** @type {Map<string, string>} */
  const partyOfList = new Map();
  for (const c of counted) for (const l of c.lists) partyOfList.set(l.id, l.party);
  const national = nationalLists(counted);
  for (const l of national) partyOfList.set(l.id, l.party);
  const openSeats = counted.reduce((s, c) => s + c.open, 0);

  /** @type {Record<SystemId, Map<string, number>>} */
  const by = { actual: new Map(), fptp: new Map(), dhondt: new Map(), sainteLague: new Map(), pr: new Map() };
  for (const c of contests) for (const [p, n] of c.actual) by.actual.set(p, (by.actual.get(p) || 0) + n);
  // Seats kept as they were count under every other system too.
  for (const id of /** @type {SystemId[]} */ (['fptp', 'dhondt', 'sainteLague', 'pr'])) {
    for (const c of contests) for (const [p, n] of c.kept) by[id].set(p, (by[id].get(p) || 0) + n);
  }
  if (singleMember) {
    for (const c of counted) {
      const win = c.open ? plurality(c.lists) : null;
      if (win) credit(new Map([[win, 1]]), partyOfList, by.fptp);
    }
    credit(highestAverages(national, openSeats, 'dhondt'), partyOfList, by.dhondt);
    credit(highestAverages(national, openSeats, 'sainte-lague'), partyOfList, by.sainteLague);
  } else {
    for (const c of counted) {
      credit(highestAverages(c.lists, c.open, 'dhondt'), partyOfList, by.dhondt);
      credit(highestAverages(c.lists, c.open, 'sainte-lague'), partyOfList, by.sainteLague);
    }
  }
  credit(largestRemainder(national, openSeats), partyOfList, by.pr);

  /** @type {Map<string, number>} */
  const votes = new Map();
  for (const l of national) votes.set(l.party, (votes.get(l.party) || 0) + l.votes);
  const allVotes = [...votes.values()].reduce((s, v) => s + v, 0);
  // First past the post is its own column only where the election was not held by it.
  /** @type {SystemId[]} */
  const columns = ['actual', ...(singleMember && stv ? /** @type {SystemId[]} */ (['fptp']) : []), 'dhondt', 'sainteLague', 'pr'];
  const parties = new Set([...votes.keys(), ...by.actual.keys()]);
  const rows = [...parties].map((party) => ({
    party,
    colour: colours.get(party) || '',
    votes: votes.get(party) || 0,
    share: allVotes ? (100 * (votes.get(party) || 0)) / allVotes : null,
    seats: /** @type {Record<SystemId, number>} */ (Object.fromEntries(Object.entries(by).map(([id, m]) => [id, m.get(party) || 0]))),
  }))
    // Parties with no seat under any system and under 1% of the vote are folded away by the view.
    .sort((a, b) => b.seats.actual - a.seats.actual || b.votes - a.votes || (a.party < b.party ? -1 : 1));
  return {
    applicable: true,
    singleMember,
    columns,
    rows,
    seats: contests.reduce((s, c) => s + c.seats, 0),
    contests: contests.length,
    unopposed: contests.filter((c) => c.status === 'unopposed').length,
    incomplete: contests.filter((c) => c.status === 'incomplete').length,
    keptSeats: contests.reduce((s, c) => s + [...c.kept.values()].reduce((t, n) => t + n, 0), 0),
    votes: allVotes,
  };
}

/**
 * Whether a row is worth its own line: a seat under any system, or at least `minShare` % of the vote.
 * @param {SystemsRow} row @param {number} [minShare]
 */
export function rowShown(row, minShare = 1) {
  return Object.values(row.seats).some((n) => n > 0) || (row.share ?? 0) >= minShare;
}
