/**
 * The results map's modes (el-maps, 14 Nov 2026): what each contest's area shows, its words, the
 * legend, and the close-contests filter. Pure, no DOM: unit test elections-app-map-modes.test.mjs.
 *
 * Every mode reads one election bundle (/_api/elections?key=&format=bundle&lite=1, lib/api.js
 * electionBundle): each contest with its candidates, their first preferences, whether elected,
 * and their totals at every count, plus the contest's valid poll, ballots cast and spoilt ballots.
 *
 *   winner   the party with most seats; a tie is a tie (lib/most-seats.js), drawn in stripes of the
 *            tied parties' colours, never one of them;
 *   topper   the poll-topper: the candidate with most first preferences, in their party's colour;
 *   share    one party's share of the first preferences;
 *   swing    the change in that share since an earlier election on the same boundaries;
 *   margin   how close the contest was (contestMargin below), as a share of the valid poll;
 *   turnout  the turnout the records give;
 *   spoilt   spoilt ballots as a share of the ballots cast.
 *
 * Colour is never the only signal: each area has a sentence (the map's label and the table's
 * cell), and an area with no figure is hatched, which no value is. The words are English and keyed
 * for translation in data/i18n/strings/elections.txt (MAP_TEXT, MAP_PATTERNS; R10).
 */
import { contestPollStatus } from '../../../pkg/core/src/unopposed.mjs';
import { rampColours } from '../../../pkg/registries/src/browser/colour-palettes.mjs';
import { fmtDelta, fmtInt, fmtPct, isStv } from './format.js';
import { mostSeats, seatParty, tookSeat } from './most-seats.js';
import { partyColour } from './party.js';
import { fill } from './chart-data.js';

/**
 * Fixed words of the map (each a line of data/i18n/strings/elections.txt).
 */
export const MAP_TEXT = Object.freeze({
  unopposed: 'returned unopposed',
  notRecorded: 'votes not recorded',
  noTurnout: 'turnout not recorded',
  noSpoilt: 'spoilt ballots not recorded',
  losersMissing: 'losing candidates not on file',
  stagesMissing: 'the stages of the count are not on file',
  noSeat: 'no candidate is recorded as elected',
  noMargin: 'the figures give no margin',
  noMatch: 'no contest of the same name at the earlier election',
  noData: 'No figure (hatched)',
  filteredOut: 'Not a close contest (outline only)',
  keyWinner: 'Party with most seats',
  keyTopper: "Poll-topper's party (most first preferences)",
  keyTurnout: 'Turnout (% of the electorate)',
  keySpoilt: 'Spoilt ballots (% of the ballots cast)',
  keyMargin: 'Margin (% of the valid poll): the closer, the stronger the colour',
  keyTies: "Tie for most seats: stripes of the tied parties' colours",
  votes: 'votes',
  pctValid: '% of the valid poll',
  marginMethod: "A contest's margin is the votes between the weakest member elected and the strongest candidate not elected: under the single transferable vote at the runner-up's last count, among the members elected then or later; otherwise in first preferences. Its percentage is of the valid poll.",
  spoiltMethod: "Spoilt ballots are the source's figure, or the total poll less the valid poll; their share is of the total poll.",
});

/**
 * Words with values in them ({name} placeholders, filled by fill()): each a line of
 * data/i18n/strings/elections.txt, so the language runtime matches them as patterns.
 */
export const MAP_PATTERNS = Object.freeze({
  wonOne: '{party} ({name})',
  wonMany: '{party}: {seats} of {total} seats',
  tieOne: 'Tie: {parties}, 1 seat each',
  tieMany: 'Tie: {parties}, {seats} seats each',
  topper: '{name} ({party}), {votes} first preferences ({share})',
  topperTie: 'Tie: {names}, {votes} first preferences each',
  topperVotes: '{name} ({party}), {votes} votes ({share})',
  topperTieVotes: 'Tie: {names}, {votes} votes each',
  share: '{party} {share}',
  notStood: '{party} did not stand',
  swing: '{party} {change} points ({before} to {after})',
  notStoodEither: '{party} stood at neither election',
  margin: '{votes} votes ({pct} of the valid poll) between {winner} and {runnerUp}',
  marginAtCount: '{votes} votes ({pct} of the valid poll) between {winner} and {runnerUp} at count {count}',
  turnout: 'Turnout {pct}',
  spoilt: '{n} spoilt ballots ({pct} of the ballots cast)',
  keyShare: "{party}'s share of the first preferences",
  keyShareVotes: "{party}'s share of the vote",
  keySwing: "Change in {party}'s share since {election} (points)",
  keyTie: 'Tie: {parties}',
  label: '{area}: {value}',
  range: '{from} to {to}',
  candidate: '{name} ({party})',
});

// A pattern with its values put in: the chart-data component's (el-tables), not a copy.
export { fill };

// ------------------------------------------------------------------ the areas

/** @typedef {import('../../../pkg/core/src/election-domain.mjs').ContestResult} BundleResult */
/** @typedef {import('../../../pkg/core/src/election-domain.mjs').ResultCandidate} BundleCandidate */

/**
 * A candidate as the map reads one.
 * @typedef {{ name: string, party: string, colour: string, first: number | null, elected: boolean, electedAt: number | null, withoutPoll: boolean,
 *   counts: Array<[number, number]> }} MapCandidate  counts: [count, total] in count order, totals above 0 only
 */

/**
 * One contest as the map reads it.
 * @typedef {{ name: string, feature: string | null, seats: number, system: string, poll: import('../../../pkg/core/src/unopposed.mjs').PollStatus,
 *   valid: number | null, cast: number | null, spoilt: number | null, turnout: number | null, quota: number | null,
 *   candidates: MapCandidate[], lastCount: number }} MapArea
 */

/** A positive finite number or null. @param {unknown} v */
const pos = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The contests of an election bundle, as the map reads them. A contest drawn on no map area keeps
 * feature null (it is counted, never drawn).
 * @param {{ results?: BundleResult[], votingSystem?: unknown } | null | undefined} bundle
 * @returns {MapArea[]}
 */
export function bundleAreas(bundle) {
  return (bundle?.results || []).map((r) => {
    const cands = /** @type {BundleCandidate[]} */ (Array.isArray(r.candidates) ? r.candidates : []);
    /** @type {MapCandidate[]} */
    const candidates = cands.map((c) => {
      const counts = /** @type {Array<{ count?: unknown, total?: unknown }>} */ (Array.isArray(c.counts) ? c.counts : [])
        .map((x) => /** @type {[number, number]} */ ([Number(x.count), Number(x.total)]))
        .filter(([n, t]) => Number.isFinite(n) && Number.isFinite(t) && t > 0)
        .sort((a, b) => a[0] - b[0]);
      return {
        name: String(c.name || ''),
        party: seatParty(/** @type {import('./most-seats.js').SeatCandidate} */ (c)),
        colour: partyColour(c.colour),
        first: pos(c.firstPrefs),
        elected: tookSeat(/** @type {import('./most-seats.js').SeatCandidate} */ (c)),
        electedAt: pos(c.electedAt),
        withoutPoll: !(pos(c.firstPrefs)) && tookSeat(/** @type {import('./most-seats.js').SeatCandidate} */ (c)),
        counts,
      };
    });
    const valid = pos(r.validPoll);
    const spoiltGiven = pos(r.spoiled);
    const cast = pos(r.totalPoll);
    const spoilt = spoiltGiven ?? (cast !== null && valid !== null && cast > valid ? cast - valid : null);
    const matched = r.matched !== false;
    return {
      name: String(r.constituency || r.matchName || r.featureName || ''),
      feature: matched && r.featureName ? String(r.featureName).toUpperCase() : null,
      seats: pos(r.seatsTotal) || 1,
      system: String(r.votingSystem || bundle?.votingSystem || ''),
      poll: contestPollStatus(/** @type {Parameters<typeof contestPollStatus>[0]} */ (r)),
      valid,
      cast: cast ?? (valid !== null && spoiltGiven !== null ? valid + spoiltGiven : null),
      spoilt,
      turnout: pos(r.turnoutPct),
      quota: pos(r.quota),
      candidates,
      lastCount: Math.max(0, ...candidates.flatMap((c) => c.counts.map(([n]) => n))),
    };
  });
}

// ------------------------------------------------------------------ figures of one contest

/** A candidate's total at a count: the last total recorded at or before it. @param {MapCandidate} c @param {number} n */
function totalAt(c, n) {
  let t = null;
  for (const [k, v] of c.counts) if (k <= n) t = v;
  return t;
}

/** The last count at which a candidate held votes. @param {MapCandidate} c */
const lastHeld = (c) => (c.counts.length ? c.counts[c.counts.length - 1][0] : 0);

/**
 * How close a contest was: the votes between the weakest candidate elected and the strongest not
 * elected, and that as a share of the valid poll.
 *
 * With the count's stages (more than one count): the runner-up is the candidate not elected who
 * stayed in the count longest (then the most votes then); the gap is to the candidate with fewest
 * votes at the runner-up's last count among those elected at that count or later (a member elected
 * earlier sits at the quota once the surplus has gone, and is not the one the runner-up nearly beat). That is the last-seat margin of an STV count, and
 * the majority of a single-seat one. Without stages, first preferences: the majority under first
 * past the post and the block vote; under STV only when every member was elected on first
 * preferences alone (each at or over the quota), since otherwise the transfers decided the seats.
 *
 * No margin (null, with the reason) for a contest returned unopposed, with votes not recorded,
 * with its losing candidates not on file, or (STV) without its stages.
 * @param {MapArea} a
 * @returns {{ votes: number, pct: number | null, winner: MapCandidate, runnerUp: MapCandidate, count: number | null } | { reason: string }}
 */
export function contestMargin(a) {
  if (a.poll === 'unopposed') return { reason: MAP_TEXT.unopposed };
  if (a.poll !== 'polled') return { reason: MAP_TEXT.notRecorded };
  const winners = a.candidates.filter((c) => c.elected && !c.withoutPoll);
  const losers = a.candidates.filter((c) => !c.elected && (c.first !== null || c.counts.length));
  if (!winners.length) return { reason: MAP_TEXT.noSeat };
  if (!losers.length) return { reason: MAP_TEXT.losersMissing };
  const valid = a.valid ?? a.candidates.reduce((s, c) => s + (c.first || 0), 0);
  /** @type {MapCandidate} */
  let winner;
  /** @type {MapCandidate} */
  let runnerUp;
  /** @type {number} */
  let votes;
  /** @type {number | null} */
  let count = null;
  if (a.lastCount > 1) {
    runnerUp = [...losers].sort((x, y) => lastHeld(y) - lastHeld(x) || (totalAt(y, lastHeld(y)) || 0) - (totalAt(x, lastHeld(x)) || 0))[0];
    count = lastHeld(runnerUp);
    const at = /** @type {number} */ (count);
    const late = winners.filter((w) => w.electedAt !== null && w.electedAt >= at);
    const held = (late.length ? late : winners).map((w) => /** @type {[MapCandidate, number | null]} */ ([w, totalAt(w, at)])).filter(([, t]) => t !== null);
    if (!held.length || !count) return { reason: MAP_TEXT.stagesMissing };
    held.sort((x, y) => /** @type {number} */ (x[1]) - /** @type {number} */ (y[1]));
    winner = held[0][0];
    votes = /** @type {number} */ (held[0][1]) - /** @type {number} */ (totalAt(runnerUp, at));
  } else {
    if (isStv(a.system) && !(a.quota && winners.every((w) => (w.first || 0) >= /** @type {number} */ (a.quota)))) return { reason: MAP_TEXT.stagesMissing };
    if (winners.some((w) => w.first === null)) return { reason: MAP_TEXT.notRecorded };
    winner = [...winners].sort((x, y) => (x.first || 0) - (y.first || 0))[0];
    runnerUp = [...losers].sort((x, y) => (y.first || 0) - (x.first || 0))[0];
    votes = (winner.first || 0) - (runnerUp.first || 0);
  }
  if (!(votes >= 0)) return { reason: MAP_TEXT.noMargin };
  votes = Math.round(votes * 100) / 100;
  return { votes, pct: valid > 0 ? (100 * votes) / valid : null, winner, runnerUp, count: a.lastCount > 1 ? count : null };
}

/**
 * The poll-topper: the candidate or candidates (a tie) with most first preferences.
 * @param {MapArea} a
 * @returns {MapCandidate[]}
 */
export function pollToppers(a) {
  if (a.poll !== 'polled') return [];
  const top = Math.max(0, ...a.candidates.map((c) => c.first || 0));
  return top > 0 ? a.candidates.filter((c) => c.first === top) : [];
}

/**
 * One party's share of a contest's first preferences (%), with whether it stood; null with no
 * votes recorded.
 * @param {MapArea} a @param {string} party
 * @returns {{ share: number, stood: boolean } | null}
 */
export function partyShareIn(a, party) {
  if (a.poll !== 'polled') return null;
  let all = 0;
  let mine = 0;
  let stood = false;
  for (const c of a.candidates) {
    all += c.first || 0;
    if (c.party === party) { stood = true; mine += c.first || 0; }
  }
  return all > 0 ? { share: (100 * mine) / all, stood } : null;
}

/** Spoilt ballots as a share of the ballots cast (%), or null. @param {MapArea} a */
export function spoiltShare(a) {
  return a.spoilt !== null && a.cast ? (100 * a.spoilt) / a.cast : null;
}

// ------------------------------------------------------------------ scales and legends

/**
 * A legend entry: a colour swatch, a hatched "no figure" swatch, a split swatch (a tie), or an
 * empty one (outside the filter).
 * @typedef {{ kind: 'swatch' | 'none' | 'split' | 'empty', colours: string[], label: string }} LegendItem
 */

const SEQ = rampColours.sequential;

/** A step of a nice size near `raw` (1, 2, 2.5 or 5 times a power of ten). @param {number} raw */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}

/**
 * Class edges over values: equal steps of a nice size from below the lowest to above the highest,
 * at most `n` classes (more steps when the nice size leaves more). Edges are [lo, hi) but the last
 * class takes its top.
 * @param {number[]} values @param {number} [n]
 * @returns {number[]} edges, one more than the classes
 */
export function classEdges(values, n = 5) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return [min, min];
  let step = niceStep((max - min) / n);
  let lo = Math.floor(min / step) * step;
  while (Math.ceil((max - lo) / step) > n) { step = niceStep(step * 1.01); lo = Math.floor(min / step) * step; }
  const edges = [lo];
  while (edges[edges.length - 1] < max) edges.push(Math.round((edges[edges.length - 1] + step) * 1e6) / 1e6);
  return edges;
}

/** The colours of k classes from the sequential ramp, spread over it. @param {number} k */
export function classColours(k) {
  if (k <= 1) return [SEQ[Math.floor(SEQ.length / 2)]];
  return Array.from({ length: k }, (_, i) => SEQ[Math.round((i * (SEQ.length - 1)) / (k - 1))]);
}

/** The class of v among the edges. @param {number} v @param {number[]} edges */
export function classOf(v, edges) {
  if (edges.length < 2) return 0;
  for (let i = 1; i < edges.length - 1; i += 1) if (v < edges[i]) return i - 1;
  return edges.length - 2;
}

/**
 * Colours and legend of a sequential (low to high) or reversed (closest darkest) scale. The key's
 * figures have as many decimals as the edges need (at most two), so no two edges read the same.
 * @param {Array<number | null>} values @param {(v: number, digits: number) => string} fmt @param {{ reverse?: boolean }} [opt]
 */
export function sequentialScale(values, fmt, opt = {}) {
  const edges = classEdges(/** @type {number[]} */ (values.filter((v) => v !== null)));
  const digits = Math.min(2, Math.max(0, ...edges.map((x) => (String(x).split('.')[1] || '').length)));
  const k = Math.max(1, edges.length - 1);
  const colours = classColours(k);
  if (opt.reverse) colours.reverse();
  const colourOf = (/** @type {number | null} */ v) => (v === null || !edges.length ? null : colours[classOf(v, edges)]);
  /** @type {LegendItem[]} */
  const legend = edges.length < 2 ? [] : edges[0] === edges[1]
    ? [{ kind: 'swatch', colours: [colours[0]], label: fmt(edges[0], digits) }]
    : colours.map((c, i) => ({ kind: 'swatch', colours: [c], label: `${fmt(edges[i], digits)}–${fmt(edges[i + 1], digits)}` }));
  return { colourOf, legend };
}

/**
 * Colours and legend of the swing scale: two hues around a neutral middle (|v| under a twentieth of
 * the limit), four classes a side, the limit a nice size over the largest change.
 * @param {Array<number | null>} values @param {(v: number) => string} fmt
 */
export function divergingScale(values, fmt) {
  const big = Math.max(0, ...values.map((v) => (v === null ? 0 : Math.abs(v))));
  const limit = big > 0 ? niceStep(big / 4) * 4 : 4;
  const q = limit / 4;
  const mid = limit / 20;
  const neg = rampColours.divergingLow;
  const posR = rampColours.divergingHigh;
  const colourOf = (/** @type {number | null} */ v) => {
    if (v === null) return null;
    if (Math.abs(v) < mid) return rampColours.divergingMid;
    const i = Math.min(3, Math.floor(Math.abs(v) / q));
    return v < 0 ? neg[3 - i] : posR[i];
  };
  /** @type {LegendItem[]} */
  const legend = [
    ...neg.map((c, i) => ({ kind: /** @type {const} */ ('swatch'), colours: [c], label: fill(MAP_PATTERNS.range, { from: fmt(-limit + i * q), to: fmt(i === 3 ? -mid : -limit + (i + 1) * q) }) })),
    { kind: 'swatch', colours: [rampColours.divergingMid], label: fill(MAP_PATTERNS.range, { from: fmt(-mid), to: fmt(mid) }) },
    ...posR.map((c, i) => ({ kind: /** @type {const} */ ('swatch'), colours: [c], label: fill(MAP_PATTERNS.range, { from: fmt(i === 0 ? mid : i * q), to: fmt((i + 1) * q) }) })),
  ];
  return { colourOf, legend };
}

// ------------------------------------------------------------------ one mode over an election

/**
 * One contest's figure in a mode: the value (null: no figure), its fill (a colour, or a pattern id
 * for a tie or no figure), and its words.
 * @typedef {{ name: string, feature: string | null, value: number | null, colour: string | null, pattern: string | null,
 *   text: string, margin: ReturnType<typeof contestMargin> }} AreaFigure
 */

/** The pattern id of "no figure" (the map draws it hatched). */
export const NO_DATA = 'no-data';

/** How many ties the key lists one by one; more share one entry. */
export const TIES_LISTED = 4;

/**
 * Options of a mode: the party (share, swing), the earlier election's areas and title (swing), and
 * whether the page is dark: there a sequential scale runs dark to light, so the strong end of the
 * scale stands out from the dark page as the dark end does from a light one.
 * @typedef {{ party?: string | undefined, before?: MapArea[] | null, beforeTitle?: string | undefined, dark?: boolean | undefined }} ModeOptions
 */

/**
 * A mode over an election's contests: a figure per contest, the legend, and the patterns the map
 * needs (id -> the colours of its stripes: the tie patterns; NO_DATA is the hatch).
 * @param {MapArea[]} areas
 * @param {import('../state-machines.js').MapMode} mode
 * @param {ModeOptions} [opt]
 * @returns {{ figures: AreaFigure[], legend: LegendItem[], title: string, patterns: Map<string, string[]> }}
 */
export function modeFigures(areas, mode, opt = {}) {
  /** @type {Map<string, string[]>} */
  const patterns = new Map();
  /** @type {LegendItem[]} */
  let legend = [];
  let title = '';
  const party = opt.party || '';
  /** @type {Array<{ value: number | null, colour?: string | null, pattern?: string | null, text: string }>} */
  let raw;
  const blank = (/** @type {string} */ text) => ({ value: null, pattern: NO_DATA, text });

  if (mode === 'winner' || mode === 'topper') {
    /** @type {Map<string, string>} */
    const used = new Map();
    raw = areas.map((a) => {
      /** @type {Array<{ party: string, colour: string }>} */
      let who = [];
      let text = '';
      if (mode === 'winner') {
        const m = mostSeats(a.candidates.map((c) => ({ party: c.party, elected: c.elected, firstPrefs: c.first })));
        // A tie's parties in name order, so the same tie is one pattern and one key entry.
        if (m.tie) m.parties.sort((x, y) => x.localeCompare(y));
        if (!m.parties.length) return blank(a.poll === 'polled' ? MAP_TEXT.noSeat : a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.notRecorded);
        who = m.parties.map((p) => ({ party: p, colour: /** @type {MapCandidate} */ (a.candidates.find((c) => c.party === p)).colour }));
        const lone = a.candidates.filter((c) => c.elected);
        text = m.tie
          ? fill(m.seats === 1 ? MAP_PATTERNS.tieOne : MAP_PATTERNS.tieMany, { parties: m.parties.join(', '), seats: m.seats })
          : a.seats === 1 && lone.length === 1
            ? fill(MAP_PATTERNS.wonOne, { party: m.parties[0], name: lone[0].name })
            : fill(MAP_PATTERNS.wonMany, { party: m.parties[0], seats: m.seats, total: a.seats });
        if (a.poll !== 'polled') text += ` (${a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.notRecorded})`;
      } else {
        const top = pollToppers(a);
        if (!top.length) return blank(a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.notRecorded);
        who = [...new Map(top.map((c) => [c.party, { party: c.party, colour: c.colour }])).values()].sort((x, y) => x.party.localeCompare(y.party));
        const share = a.valid ? fmtPct((100 * /** @type {number} */ (top[0].first)) / a.valid) : '—';
        const stv = isStv(a.system);
        text = top.length > 1
          ? fill(stv ? MAP_PATTERNS.topperTie : MAP_PATTERNS.topperTieVotes, { names: top.map((c) => fill(MAP_PATTERNS.candidate, { name: c.name, party: c.party })).join(', '), votes: fmtInt(top[0].first) })
          : fill(stv ? MAP_PATTERNS.topper : MAP_PATTERNS.topperVotes, { name: top[0].name, party: top[0].party, votes: fmtInt(top[0].first), share });
      }
      if (who.length > 1) {
        const id = `tie:${who.map((w) => w.party).join('|')}`;
        patterns.set(id, who.map((w) => w.colour));
        // Every party in a stripe has its colour in the key.
        for (const w of who) used.set(w.party, w.colour);
        return { value: who.length, pattern: id, text };
      }
      used.set(who[0].party, who[0].colour);
      return { value: 1, colour: who[0].colour, text };
    });
    title = mode === 'winner' ? MAP_TEXT.keyWinner : MAP_TEXT.keyTopper;
    // Up to TIES_LISTED ties each have their own entry; more (a local election has dozens) share one.
    const ties = [...patterns];
    legend = [
      ...[...used].sort((x, y) => x[0].localeCompare(y[0])).map(([label, colour]) => ({ kind: /** @type {const} */ ('swatch'), colours: [colour], label })),
      ...(ties.length > TIES_LISTED
        ? [{ kind: /** @type {const} */ ('split'), colours: ties[0][1], label: MAP_TEXT.keyTies }]
        : ties.map(([id, colours]) => ({ kind: /** @type {const} */ ('split'), colours, label: fill(MAP_PATTERNS.keyTie, { parties: id.slice(4).split('|').join(', ') }) }))),
    ];
  } else if (mode === 'share' || mode === 'swing') {
    /** @type {Map<string, MapArea>} */
    const before = new Map((opt.before || []).map((b) => [b.name, b]));
    raw = areas.map((a) => {
      const now = partyShareIn(a, party);
      if (!now) return blank(a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.notRecorded);
      if (mode === 'share') {
        return { value: now.share, text: now.stood ? fill(MAP_PATTERNS.share, { party, share: fmtPct(now.share) }) : fill(MAP_PATTERNS.notStood, { party }) };
      }
      const prev = before.get(a.name);
      if (!prev) return blank(MAP_TEXT.noMatch);
      const then = partyShareIn(prev, party);
      if (!then) return blank(prev.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.notRecorded);
      const change = now.share - then.share;
      return {
        value: change,
        text: !now.stood && !then.stood ? fill(MAP_PATTERNS.notStoodEither, { party })
          : fill(MAP_PATTERNS.swing, { party, change: fmtDelta(change, 1), before: fmtPct(then.share), after: fmtPct(now.share) }),
      };
    });
    const scale = mode === 'share' ? sequentialScale(raw.map((r) => r.value), (v, d) => fmtPct(v, d), { reverse: !!opt.dark }) : divergingScale(raw.map((r) => r.value), (v) => fmtDelta(v, 1));
    raw = raw.map((r) => ({ ...r, colour: r.value === null ? null : scale.colourOf(r.value) }));
    legend = scale.legend;
    title = mode === 'share' ? fill(areas.some((a) => isStv(a.system)) ? MAP_PATTERNS.keyShare : MAP_PATTERNS.keyShareVotes, { party }) : fill(MAP_PATTERNS.keySwing, { party, election: opt.beforeTitle || '' });
  } else {
    raw = areas.map((a) => {
      if (mode === 'turnout') {
        return a.turnout === null ? blank(a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.noTurnout) : { value: a.turnout, text: fill(MAP_PATTERNS.turnout, { pct: fmtPct(a.turnout) }) };
      }
      if (mode === 'spoilt') {
        const s = spoiltShare(a);
        return s === null ? blank(a.poll === 'unopposed' ? MAP_TEXT.unopposed : MAP_TEXT.noSpoilt) : { value: s, text: fill(MAP_PATTERNS.spoilt, { n: fmtInt(a.spoilt), pct: fmtPct(s, 2) }) };
      }
      const m = contestMargin(a);
      if ('reason' in m) return blank(m.reason);
      return { value: m.pct, text: marginText(m) };
    });
    const scale = sequentialScale(raw.map((r) => r.value), (v, d) => fmtPct(v, d), { reverse: (mode === 'margin') !== !!opt.dark });
    raw = raw.map((r) => ({ ...r, colour: r.value === null ? null : scale.colourOf(r.value) }));
    legend = scale.legend;
    title = mode === 'turnout' ? MAP_TEXT.keyTurnout : mode === 'spoilt' ? MAP_TEXT.keySpoilt : MAP_TEXT.keyMargin;
  }

  const figures = areas.map((a, i) => ({
    name: a.name,
    feature: a.feature,
    value: raw[i].value,
    colour: raw[i].colour ?? null,
    pattern: raw[i].pattern ?? null,
    text: raw[i].text,
    margin: contestMargin(a),
  }));
  if (figures.some((f) => f.pattern === NO_DATA)) legend.push({ kind: 'none', colours: [], label: MAP_TEXT.noData });
  return { figures, legend, title, patterns };
}

/** A margin in words. @param {{ votes: number, pct: number | null, winner: MapCandidate, runnerUp: MapCandidate, count: number | null }} m */
export function marginText(m) {
  const values = {
    votes: fmtInt(m.votes),
    pct: fmtPct(m.pct, 2),
    winner: fill(MAP_PATTERNS.candidate, { name: m.winner.name, party: m.winner.party }),
    runnerUp: fill(MAP_PATTERNS.candidate, { name: m.runnerUp.name, party: m.runnerUp.party }),
  };
  return m.count ? fill(MAP_PATTERNS.marginAtCount, { ...values, count: m.count }) : fill(MAP_PATTERNS.margin, values);
}

// ------------------------------------------------------------------ the close-contests filter

/** @typedef {'votes' | 'pct'} MarginUnit */

/**
 * Whether a contest is close: a margin under the limit, in votes or in points of the valid poll.
 * A contest with no margin (unopposed, votes or losers not on file) is never close.
 * @param {AreaFigure['margin']} margin @param {number} under @param {MarginUnit} unit
 */
export function isClose(margin, under, unit) {
  if ('reason' in margin) return false;
  const v = unit === 'pct' ? margin.pct : margin.votes;
  return v !== null && v < under;
}

/**
 * The close contests, as rows of the sortable list.
 * @param {AreaFigure[]} figures @param {number} under @param {MarginUnit} unit
 * @returns {Array<{ name: string, winner: string, runnerUp: string, votes: number, pct: number | null, count: number | null }>}
 */
export function closeContests(figures, under, unit) {
  return figures.flatMap((f) => {
    const m = f.margin;
    if (!isClose(m, under, unit) || 'reason' in m) return [];
    return [{
      name: f.name,
      winner: fill(MAP_PATTERNS.candidate, { name: m.winner.name, party: m.winner.party }),
      runnerUp: fill(MAP_PATTERNS.candidate, { name: m.runnerUp.name, party: m.runnerUp.party }),
      votes: m.votes,
      pct: m.pct,
      count: m.count,
    }];
  });
}

/**
 * Rows sorted by a column, ascending or descending; text by the locale's order, numbers by value,
 * a missing number last either way; ties keep the rows' order.
 * @template {Record<string, unknown>} T
 * @param {T[]} rows @param {keyof T & string} key @param {'asc' | 'desc'} dir
 * @returns {T[]}
 */
export function sortRows(rows, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => /** @type {[T, number]} */ ([r, i])).sort(([a, i], [b, j]) => {
    const x = a[key];
    const y = b[key];
    if (x === null || x === undefined || y === null || y === undefined) {
      if ((x === null || x === undefined) && (y === null || y === undefined)) return i - j;
      return x === null || x === undefined ? 1 : -1;
    }
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c ? sign * c : i - j;
  }).map(([r]) => r);
}

// ------------------------------------------------------------------ patterns

/** The bytes of a hex colour ("#abc", "#aabbcc", "#aabbccdd"). @param {string} hex @returns {[number, number, number, number]} */
export function rgbaOf(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  const n = (/** @type {number} */ i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 255];
}

/**
 * A square image of diagonal stripes, for MapLibre's fill-pattern: equal stripes of the colours in
 * turn (a tie), or of one colour on nothing (`gap`: the "no figure" hatch). RGBA bytes, row by row.
 * @param {string[]} colours @param {{ size?: number, stripe?: number, gap?: boolean }} [opt]
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function stripeImage(colours, opt = {}) {
  const stripe = opt.stripe || 4;
  const bands = opt.gap ? [...colours.map(rgbaOf), null] : colours.map(rgbaOf);
  // The tile repeats seamlessly when its size is a whole number of the bands' period.
  const period = stripe * bands.length;
  const size = opt.size || period * Math.max(1, Math.round(16 / period));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const band = bands[Math.floor(((x + y) % period) / stripe)];
      if (!band) continue;
      data.set(band, (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}
