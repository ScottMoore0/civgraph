/**
 * An area's history (el-places, 14 Nov 2026): every contest held under one contest slug, from the
 * API's view=area-history, turned into the area page's series (one per body), its party-share
 * trend, its members grid, its boundary changes and the contest arrows. Pure (no DOM, no fetch):
 * the unit test elections-app-places.test.mjs.
 *
 * One dataset: the area page, the contest arrows and the person page all read the candidacies the
 * records hold, through the same derivations here and in lib/verdict.js, so they cannot disagree.
 *
 * Identity: the records hold no identity for an area across redistributions, only each contest's
 * name and the boundary map its election is drawn on. So a series is one body's contests under
 * one name; a change of boundary map inside a series is reported, and a series with no map says
 * that nothing is known of its boundaries. Nothing is guessed.
 */
import { normalizeName } from '../../../pkg/core/src/election-domain.mjs';
import { contestPollStatus } from '../../../pkg/core/src/unopposed.mjs';
import { foldText } from './search.js';

/** @typedef {import('./api.js').AreaContest} AreaContest */
/** @typedef {import('./api.js').AreaCandidate} AreaCandidate */
/** @typedef {import('./api.js').AreaHistoryAnswer} AreaHistory */
/** @typedef {import('../../../pkg/core/src/unopposed.mjs').PollStatus} PollStatus */

/**
 * @typedef {object} Member  a candidate, as the area page shows one
 * @property {string} name
 * @property {string} personKey   the person id, else the name (to follow a member term to term)
 * @property {string | null} personId
 * @property {string | null} personSlug
 * @property {string} party       the label recorded for this candidacy ('' when none)
 * @property {string} partyKey    the party it folds to (lib/area.js partyKeyFor)
 * @property {string} colour
 * @property {number | null} votes
 * @property {boolean} elected
 */
/**
 * @typedef {object} PartyResult  a party's figures in one contest
 * @property {string} key
 * @property {string} label
 * @property {string} colour
 * @property {number} votes
 * @property {number} seats
 * @property {number | null} share  null when the contest's votes are not complete
 */
/**
 * @typedef {object} ContestModel
 * @property {AreaContest} contest
 * @property {boolean} byElection
 * @property {boolean} referendum
 * @property {PollStatus} poll
 * @property {number} seats
 * @property {Member[]} candidates
 * @property {Member[]} elected
 * @property {number | null} validPoll     the sum of first preferences, when every candidate has one
 * @property {boolean} votesComplete       polled, every candidate has votes and the losers are on file
 * @property {PartyResult[]} parties       most votes (else seats) first
 * @property {'first' | 'same' | 'changed' | 'unknown'} boundary  against the series' previous contest
 * @property {ContestModel | null} previous  the contest a verdict compares with (see seriesOf)
 */
/**
 * @typedef {object} Series  one body's contests under one name, oldest first
 * @property {string} bodySlug
 * @property {string} body
 * @property {ContestModel[]} contests
 * @property {number} firstYear
 * @property {number} lastYear
 * @property {boolean} mapped   whether any of its contests has a boundary map
 */

/**
 * The key a party label folds to: the party's slug where the parties' name list knows the label
 * (/_api/parties?view=names: "D.U.P." and "Democratic Unionist Party" both "dup"), else the label
 * normalised. The name list folds every independent's spelling ("Ind.", "Non-party") to the one
 * key 'independent'; lib/verdict.js compares independents by person.
 * @param {Record<string, string>} [names]
 */
export function partyKeyFor(names = {}) {
  return (/** @type {unknown} */ label) => {
    const folded = foldText(label);
    if (!folded) return 'none';
    if (names[folded]) return names[folded];
    return folded === 'independent' ? folded : `label:${normalizeName(label)}`;
  };
}

/** Whether a party key stands for no party (an independent, or nothing recorded). @param {string} key */
export const isNoPartyKey = (key) => key === 'independent' || key === 'none';

/** @param {unknown} v @returns {number | null} */
const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * One contest of the history, with its members, poll status and party results.
 * @param {AreaContest} contest
 * @param {(label: unknown) => string} partyKey
 * @returns {ContestModel}
 */
export function contestModel(contest, partyKey) {
  const candidates = (contest.candidates || []).map((/** @type {AreaCandidate} */ c) => ({
    name: String(c.name || ''),
    personKey: String(c.personId || `name:${normalizeName(c.name)}`),
    personId: c.personId ? String(c.personId) : null,
    personSlug: c.personSlug ? String(c.personSlug) : null,
    party: String(c.party || ''),
    partyKey: partyKey(c.party),
    colour: String(c.colour || ''),
    votes: numOrNull(c.firstPrefs),
    elected: c.elected === true,
  }));
  const poll = contestPollStatus({ contestStatus: contest.contestStatus, candidates: /** @type {Array<Record<string, unknown>>} */ (contest.candidates || []) });
  const seats = Number(contest.seatsTotal) || candidates.filter((c) => c.elected).length || 1;
  const allVotes = candidates.length > 0 && candidates.every((c) => c.votes !== null);
  const validPoll = poll === 'polled' && allVotes ? candidates.reduce((s, c) => s + Number(c.votes), 0) : null;
  const votesComplete = validPoll !== null && validPoll > 0 && candidates.length > seats;
  /** @type {Map<string, PartyResult>} */
  const parties = new Map();
  for (const c of candidates) {
    const p = parties.get(c.partyKey) || { key: c.partyKey, label: c.party, colour: c.colour, votes: 0, seats: 0, share: null };
    p.votes += c.votes || 0;
    if (c.elected) p.seats += 1;
    if (!p.label && c.party) p.label = c.party;
    parties.set(c.partyKey, p);
  }
  for (const p of parties.values()) p.share = votesComplete ? (100 * p.votes) / Number(validPoll) : null;
  return {
    contest,
    byElection: contest.kind === 'by-election',
    referendum: contest.contestType === 'referendum',
    poll,
    seats,
    candidates,
    elected: candidates.filter((c) => c.elected),
    validPoll,
    votesComplete,
    parties: [...parties.values()].sort((a, b) => b.votes - a.votes || b.seats - a.seats),
    boundary: 'unknown',
    previous: null,
  };
}

/**
 * The history as series, one per body, the most recent series first. Within a series each
 * contest knows its boundary against the contest before it and the contest a verdict compares
 * with: a general election's is the previous general election, a by-election's the contest just
 * before it.
 * @param {AreaHistory} history
 * @param {(label: unknown) => string} [partyKey]
 * @returns {Series[]}
 */
export function seriesOf(history, partyKey = partyKeyFor()) {
  /** @type {Map<string, Series>} */
  const byBody = new Map();
  for (const contest of history.contests || []) {
    let s = byBody.get(contest.bodySlug);
    if (!s) {
      s = { bodySlug: contest.bodySlug, body: contest.body || contest.bodySlug, contests: [], firstYear: Number(contest.year) || 0, lastYear: 0, mapped: false };
      byBody.set(contest.bodySlug, s);
    }
    s.contests.push(contestModel(contest, partyKey));
    s.lastYear = Math.max(s.lastYear, Number(contest.year) || 0);
    if (contest.mapId) s.mapped = true;
  }
  for (const s of byBody.values()) {
    s.contests.sort((a, b) => a.contest.date.localeCompare(b.contest.date) || a.contest.seq - b.contest.seq);
    /** @type {ContestModel | null} */
    let lastGeneral = null;
    s.contests.forEach((m, i) => {
      const before = i ? s.contests[i - 1] : null;
      m.boundary = !before ? 'first'
        : !m.contest.mapId || !before.contest.mapId ? 'unknown'
          : m.contest.mapId === before.contest.mapId ? 'same' : 'changed';
      m.previous = m.byElection ? before : lastGeneral;
      if (!m.byElection) lastGeneral = m;
    });
  }
  return [...byBody.values()].sort((a, b) => b.lastYear - a.lastYear || b.contests.length - a.contests.length);
}

/**
 * Whether the boundary map changed between a contest and the one it is compared with (a
 * general election's previous general election may be several contests back).
 * @param {ContestModel} m
 */
export function boundaryChangedSince(m) {
  const p = m.previous;
  return !!p && !!p.contest.mapId && !!m.contest.mapId && p.contest.mapId !== m.contest.mapId;
}

/**
 * The trend chart's points (the /maps/ trend chart's TrendPoint): each party's share at each
 * general election of the series whose votes are complete.
 * @param {Series} series
 * @returns {Array<{ party: string, share: number, votes: number, seats: number, colour: string, entry: { key: string, body: string, date: string } }>}
 */
export function trendPoints(series) {
  return series.contests
    .filter((m) => !m.byElection && !m.referendum && m.votesComplete)
    .flatMap((m) => m.parties.filter((p) => p.share !== null).map((p) => ({
      party: p.label || p.key,
      share: Number(p.share),
      votes: p.votes,
      seats: p.seats,
      colour: p.colour,
      entry: { key: m.contest.electionKey, body: series.body, date: m.contest.date },
    })));
}

/**
 * The members grid, term by term (the Wikipedia constituency grid): a row per contest, a
 * column per seat. A member returned again keeps their column; new members fill the columns
 * freed. A by-election's winner is shown on their own row (who they replaced is not recorded).
 * @param {Series} series
 * @returns {{ columns: number, rows: Array<{ model: ContestModel, cells: Array<{ member: Member, isNew: boolean } | null>, byElection: { member: Member, isNew: boolean } | null }> }}
 */
export function memberGrid(series) {
  const columns = Math.max(1, ...series.contests.filter((m) => !m.byElection).map((m) => m.seats));
  /** @type {Array<string | null>} */
  let sitting = new Array(columns).fill(null);
  /** @type {Set<string>} */
  let current = new Set();
  const rows = series.contests.filter((m) => !m.referendum).map((m) => {
    if (m.byElection) {
      const member = m.elected[0];
      if (!member) return { model: m, cells: [], byElection: null };
      const isNew = !current.has(member.personKey);
      current = new Set([...current, member.personKey]);
      // A single seat: the winner takes it. Several: who left is not recorded, so the columns stay.
      if (columns === 1) sitting = [member.personKey];
      return { model: m, cells: [], byElection: { member, isNew } };
    }
    const elected = [...m.elected];
    /** @type {Array<{ member: Member, isNew: boolean } | null>} */
    const cells = new Array(columns).fill(null);
    const placed = new Set();
    sitting.forEach((key, i) => {
      const member = key ? elected.find((e) => e.personKey === key) : undefined;
      if (member) { cells[i] = { member, isNew: false }; placed.add(member.personKey); }
    });
    for (const member of elected) {
      if (placed.has(member.personKey)) continue;
      const free = cells.findIndex((c) => c === null);
      if (free === -1) break;
      cells[free] = { member, isNew: !current.has(member.personKey) };
      placed.add(member.personKey);
    }
    sitting = cells.map((c) => (c ? c.member.personKey : null));
    current = new Set(elected.map((e) => e.personKey));
    return { model: m, cells, byElection: null };
  });
  return { columns, rows };
}

/**
 * The boundary maps a series was drawn on, in order, each with the contest it starts at.
 * @param {Series} series
 * @returns {Array<{ model: ContestModel, mapId: string, mapName: string, layerId: string | null, previous: string | null }>}
 */
export function boundaryChanges(series) {
  /** @type {Array<{ model: ContestModel, mapId: string, mapName: string, layerId: string | null, previous: string | null }>} */
  const out = [];
  /** @type {string | null} */
  let last = null;
  /** @type {string | null} */
  let lastName = null;
  for (const m of series.contests) {
    const id = m.contest.mapId;
    if (!id) continue;
    const name = String(m.contest.mapName || id);
    if (id !== last) out.push({ model: m, mapId: id, mapName: name, layerId: m.contest.layerId || null, previous: lastName });
    last = id;
    lastName = name;
  }
  return out;
}

/**
 * The contests before and after one, in the same body under the same name (the contest page's
 * arrows), of any kind.
 * @param {AreaHistory} history
 * @param {string} electionKey
 * @param {number} seq
 * @returns {{ previous: AreaContest | null, next: AreaContest | null }}
 */
export function contestNeighbours(history, electionKey, seq) {
  const here = (history.contests || []).find((c) => c.electionKey === electionKey && Number(c.seq) === Number(seq));
  if (!here) return { previous: null, next: null };
  const same = (history.contests || []).filter((c) => c.bodySlug === here.bodySlug)
    .sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  const i = same.indexOf(here);
  return { previous: same[i - 1] || null, next: same[i + 1] || null };
}
