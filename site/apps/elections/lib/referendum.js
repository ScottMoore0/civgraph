/**
 * A referendum's result (14 Nov 2026): the options with their votes and shares, the electorate and
 * turnout, the result in words, and the result in each counting area. A referendum is not drawn
 * through the election template: it has options, not parties, and no seats. Pure (no DOM):
 * tests/unit/elections-app-fixes.test.mjs. The words are keyed in data/i18n/strings/elections.txt (R10).
 *
 * The figures are the records' own: the options are the election detail's partySummary (one row
 * an option, its votes and share), each area is a row of the election summary. An area's votes
 * for the other option of a two-option question are its valid poll less the leading option's.
 */

/** Every fixed wording and pattern (keys of data/i18n/strings/elections.txt). */
export const REFERENDUM_WORDS = Object.freeze({
  referendum: 'Referendum',
  proposal: 'The proposal',
  electorate: 'Electorate',
  totalPoll: 'Total poll',
  spoiled: 'Spoiled ballots',
  validVotes: 'Valid votes',
  turnout: 'Turnout',
  turnoutMedian: 'median {pct} across {n} areas',
  result: 'Result',
  option: 'Option',
  votes: 'Votes',
  share: 'Share',
  areas: 'Results by area',
  area: 'Area',
  majority: 'Majority',
  notRecorded: 'not recorded',
  carried: 'The proposal was carried: {pct} voted Yes.',
  rejected: 'The proposal was rejected: {pct} voted No.',
  won: '{option} won, with {pct} of the valid votes.',
  tied: 'The options tied.',
  shareCaption: 'Share of the valid votes.',
  areasNote: 'The result in each counting area, with a link to its own page.',
  optionVotes: '{option} votes',
  optionShare: '{option} %',
  sourcesNote: "Each area's page lists the sources of its own figures. For the referendum as a whole:",
});

/**
 * @typedef {{ option: string, votes: number | null, share: number | null, colour: string }} RefOption
 * @typedef {{ name: string, feature: string | null, valid: number | null, electorate: number | null, turnout: number | null,
 *   winner: string | null, votes: Record<string, number | null>, shares: Record<string, number | null>, majority: number | null }} RefArea
 */

const n = (/** @type {unknown} */ v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pos = (/** @type {unknown} */ v) => { const x = n(v); return x !== null && x > 0 ? x : null; };

/**
 * The options in display order: Yes before No where the question is Yes or No, else by votes.
 * @param {Array<{ party: string, votes?: number | null, share?: number | null, colour?: string }>} partySummary
 * @returns {RefOption[]}
 */
export function referendumOptions(partySummary) {
  const opts = (partySummary || []).filter((p) => p.party).map((p) => ({ option: String(p.party), votes: n(p.votes), share: n(p.share), colour: String(p.colour || '') }));
  const rank = (/** @type {string} */ o) => ({ yes: 0, no: 1 })[o.toLowerCase()] ?? 2;
  return opts.sort((a, b) => rank(a.option) - rank(b.option) || (b.votes ?? 0) - (a.votes ?? 0));
}

/**
 * The result in words: "The proposal was carried: 62.1% voted Yes.", or the winning option's share.
 * @param {RefOption[]} options @param {(v: number) => string} pct
 */
export function resultWords(options, pct) {
  const ranked = [...options].filter((o) => o.share !== null).sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  if (!ranked.length) return '';
  if (ranked.length > 1 && ranked[0].share === ranked[1].share) return REFERENDUM_WORDS.tied;
  const top = ranked[0];
  const yesNo = options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o.option));
  const share = pct(/** @type {number} */ (top.share));
  if (yesNo) return (/^yes$/i.test(top.option) ? REFERENDUM_WORDS.carried : REFERENDUM_WORDS.rejected).replace('{pct}', share);
  return REFERENDUM_WORDS.won.replace('{option}', top.option).replace('{pct}', share);
}

/**
 * The electorate, total poll and turnout of the whole vote: summed over the areas when every
 * area has the figure, else null (a total over some areas only would mislead). Turnout is the
 * total poll over the electorate; without both, the median of the areas' turnouts.
 * @param {Array<{ electorate?: unknown, totalPoll?: unknown, validPoll?: unknown, turnoutPct?: unknown }>} rows
 */
export function referendumTotals(rows) {
  const sum = (/** @type {(r: typeof rows[number]) => unknown} */ f) => (rows.length && rows.every((r) => pos(f(r)) !== null) ? rows.reduce((s, r) => s + /** @type {number} */ (pos(f(r))), 0) : null);
  const electorate = sum((r) => r.electorate);
  const totalPoll = sum((r) => r.totalPoll);
  const valid = sum((r) => r.validPoll);
  const turnouts = rows.map((r) => pos(r.turnoutPct)).filter((v) => v !== null).sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b));
  const mid = Math.floor(turnouts.length / 2);
  const median = turnouts.length ? (turnouts.length % 2 ? turnouts[mid] : (/** @type {number} */ (turnouts[mid - 1]) + /** @type {number} */ (turnouts[mid])) / 2) : null;
  return {
    electorate,
    totalPoll,
    valid,
    turnout: electorate && totalPoll ? (100 * totalPoll) / electorate : null,
    turnoutMedian: median,
    turnoutAreas: turnouts.length,
  };
}

/**
 * Each counting area's result, map-ready: `feature` is the area's map label (upper case, as the
 * results map matches it), `shares` each option's share there.
 * @param {Array<{ constituency: string, featureName?: string | null, validPoll?: unknown, electorate?: unknown, turnoutPct?: unknown,
 *   leadingParty?: string | null, leadingVotes?: unknown, leadingPct?: unknown, candidateCount?: unknown, majority?: unknown }>} rows
 * @param {RefOption[]} options
 * @returns {RefArea[]}
 */
export function referendumAreas(rows, options) {
  const names = options.map((o) => o.option);
  return rows.map((r) => {
    const valid = pos(r.validPoll);
    const lead = r.leadingParty ? String(r.leadingParty) : null;
    const leadVotes = n(r.leadingVotes);
    /** @type {Record<string, number | null>} */
    const votes = Object.fromEntries(names.map((o) => [o, null]));
    /** @type {Record<string, number | null>} */
    const shares = Object.fromEntries(names.map((o) => [o, null]));
    if (lead && names.includes(lead)) {
      votes[lead] = leadVotes;
      shares[lead] = n(r.leadingPct) ?? (leadVotes !== null && valid ? (100 * leadVotes) / valid : null);
      // A two-option question: the other option has the rest of the valid votes.
      const other = names.length === 2 ? names.find((o) => o !== lead) : undefined;
      if (other !== undefined) {
        votes[other] = valid !== null && leadVotes !== null ? valid - leadVotes : null;
        const ls = shares[lead];
        shares[other] = ls !== null ? 100 - ls : null;
      }
    }
    const v = Object.values(votes).filter((x) => x !== null);
    return {
      name: r.constituency,
      feature: r.featureName ? String(r.featureName).toUpperCase() : null,
      valid,
      electorate: pos(r.electorate),
      turnout: pos(r.turnoutPct),
      winner: lead,
      votes,
      shares,
      majority: n(r.majority) ?? (v.length === 2 ? Math.abs(/** @type {number} */ (v[0]) - /** @type {number} */ (v[1])) : null),
    };
  });
}
