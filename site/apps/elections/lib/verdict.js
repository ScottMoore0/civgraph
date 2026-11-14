/**
 * A one-line verdict per contest (el-places, 14 Nov 2026), the way a results table or a
 * constituency page sums one up: "DUP hold, majority 1,234", "Alliance gain from DUP", "SF 2,
 * DUP 2, Alliance 1 (Alliance +1, UUP −1)", "J. Smith (UUP) returned unopposed". Pure:
 * the unit test elections-app-places.test.mjs.
 *
 * It compares a contest only with the one lib/area.js names as its previous (the same body under
 * the same name), never across a change of boundary map ("on new boundaries"), and an independent
 * with a person, not with "Independent". Where the votes are missing it says so; it never infers.
 */
import { POLL_STATUS_TEXT } from '../../../pkg/core/src/unopposed.mjs';
import { boundaryChangedSince, isNoPartyKey } from './area.js';
import { TEXT, fill } from './places-text.js';

/** @typedef {import('./area.js').ContestModel} ContestModel */
/** @typedef {import('./area.js').Member} Member */

/** A party's name in a verdict: its label, or "Independent" when none is recorded. @param {Member | import('./area.js').PartyResult} m */
const partyName = (m) => ('label' in m ? m.label : m.party) || TEXT.independent;

/**
 * Seats by party, most first: "SF 2, DUP 2, Alliance 1".
 * @param {ContestModel} m
 */
export function seatTally(m) {
  return m.parties.filter((p) => p.seats > 0).sort((a, b) => b.seats - a.seats || b.votes - a.votes)
    .map((p) => `${partyName(p)} ${p.seats}`).join(', ');
}

/**
 * The seat changes against an earlier contest, by party: "Alliance +1, UUP −1", or '' for none.
 * @param {ContestModel} m @param {ContestModel} before
 */
export function seatChanges(m, before) {
  /** @type {Map<string, { name: string, change: number }>} */
  const change = new Map();
  for (const p of before.parties) if (p.seats) change.set(p.key, { name: partyName(p), change: -p.seats });
  for (const p of m.parties) {
    if (!p.seats) continue;
    const c = change.get(p.key) || { name: partyName(p), change: 0 };
    c.name = partyName(p);
    c.change += p.seats;
    change.set(p.key, c);
  }
  return [...change.values()].filter((c) => c.change !== 0)
    .sort((a, b) => b.change - a.change || a.name.localeCompare(b.name))
    .map((c) => `${c.name} ${c.change > 0 ? '+' : '−'}${Math.abs(c.change)}`).join(', ');
}

/**
 * A single-seat contest's majority: the record's, else the winner's lead over the runner-up when
 * every vote is known. Null when it cannot be given.
 * @param {ContestModel} m
 */
export function majorityOf(m) {
  const recorded = Number(m.contest.majority);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  if (!m.votesComplete) return null;
  const votes = m.candidates.map((c) => Number(c.votes)).sort((a, b) => b - a);
  return votes.length > 1 ? votes[0] - votes[1] : null;
}

/**
 * The verdict of one contest.
 * @param {ContestModel} m
 * @param {(n: number) => string} fmt  how a number is written (lib/format.js fmtInt)
 * @returns {string}
 */
export function contestVerdict(m, fmt) {
  if (m.referendum) {
    const top = m.parties[0];
    if (!m.votesComplete || !top) return POLL_STATUS_TEXT['not-recorded'];
    return `${top.label} ${Number(top.share).toFixed(1)}%`;
  }
  if (m.poll === 'unopposed') {
    if (m.elected.length === 1) return fill(TEXT.unopposedOne, { name: m.elected[0].name, party: partyName(m.elected[0]) });
    return fill(TEXT.unopposedMany, { n: fmt(m.elected.length), parties: seatTally(m) });
  }
  if (!m.elected.length) return TEXT.noneElected;
  const comparable = m.previous && !boundaryChangedSince(m) && m.previous.elected.length > 0;
  const tail = m.poll === 'not-recorded' ? ` · ${POLL_STATUS_TEXT['not-recorded']}` : '';

  if (m.seats === 1 || m.byElection) {
    const w = m.elected[0];
    let line;
    if (!m.previous) line = fill(TEXT.winFirst, { party: partyName(w) });
    else if (!comparable) line = fill(boundaryChangedSince(m) ? TEXT.winNewBoundaries : TEXT.win, { party: partyName(w) });
    else {
      const before = /** @type {ContestModel} */ (m.previous);
      // A by-election in a multi-seat area is held against the party that held the seat before:
      // who left is not recorded, so it is a hold when that party had any seat there.
      const held = isNoPartyKey(w.partyKey)
        ? before.elected.some((e) => e.personKey === w.personKey)
        : before.elected.some((e) => e.partyKey === w.partyKey);
      if (held) line = fill(TEXT.hold, { party: partyName(w) });
      else {
        const loser = before.elected.length === 1 ? before.elected[0] : null;
        line = loser ? fill(TEXT.gain, { party: partyName(w), previous: partyName(loser) }) : fill(TEXT.win, { party: partyName(w) });
      }
    }
    const majority = m.seats === 1 ? majorityOf(m) : null;
    return `${line}${majority !== null ? `, ${fill(TEXT.majority, { n: fmt(majority) })}` : ''}${tail}`;
  }

  const tally = seatTally(m);
  if (!comparable) return `${tally}${boundaryChangedSince(m) ? ` (${TEXT.newBoundaries})` : ''}${tail}`;
  const changes = seatChanges(m, /** @type {ContestModel} */ (m.previous));
  return `${tally} (${changes || TEXT.noChange})${tail}`;
}
