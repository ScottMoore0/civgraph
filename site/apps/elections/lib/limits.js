/**
 * The data's known limits, each noted where it applies and nowhere else (EL2, owner 13 Nov 2026:
 * "noted in each instance where there is data with an issue or limitation, rather than a broad
 * blanket disclaimer"). The limits are listed in docs/tasks/elections-app-data-audit.md. Each note
 * here is decided from the data in front of the view, never from a list of contests:
 *
 *   losers         a polled contest with no more candidates than seats: its losing candidates are
 *                  not on file. A contest file that says its source printed only the members
 *                  elected (`losersNotPrinted: true`, carried into the contest's record by
 *                  scripts/build/build-test2-election-manifest.mjs) gets the firmer wording;
 *   votes          a polled contest where some candidates have no vote figure;
 *   transfers      a seat estimate from first preferences for a voting system whose count
 *                  transfers votes (the election-types registry's `transfers`);
 *   gender, incumbency, party, unopposed
 *                  the pivot table's notes, from counts of the rows behind the table on screen;
 *   leaders        the records hold no party leaders, so the parties table says so.
 *
 * The words are English and keyed for translation in data/i18n/strings/elections.txt (R10: the
 * language runtime translates each note by its wording, so a note is one text node, a sentence a
 * node). Pure (no DOM), with a unit test of its own (elections-app-limits).
 */
import { NO_PARTY_RECORDED } from '../../../pkg/core/src/election-domain.mjs';
import { votingSystemsWithTransfers } from '../../../pkg/registries/src/browser/election-type-names.mjs';
import { summaryPollStatus } from '../../../pkg/core/src/unopposed.mjs';

/** Every fixed sentence a note can use (each a key of data/i18n/strings/elections.txt). */
export const NOTE = Object.freeze({
  losersNotPrinted: 'The source printed only the members elected, so the losing candidates are not known.',
  losersMissing: 'The losing candidates are not on file: the sources read so far name only the members elected.',
  electedVotesOnly: "The valid poll and the shares here count the elected members' votes alone, and no majority can be given.",
  noMajority: "No majority can be given without the runner-up's votes.",
  votesNotRecorded: 'not recorded',
  losersMarker: 'losing candidates not on file',
  transfers: 'Seats are shared out by quotas of first preferences: the transfers that decide many seats under this system are left out.',
  leaders: 'Party leaders are not recorded in Civgraph yet.',
  genderNeverInferred: 'The rest are shown as not recorded: gender is never inferred from a name.',
  incumbencyDerived: 'Incumbency is worked out, not taken from a source: a candidate counts as an incumbent when the same person was elected to the same body at its previous general election or at a by-election since.',
  partyAsPrinted: 'Party is the label on the ballot paper as recorded.',
});

/** Sentences with a count in them ({n} of {total}): the singular and the plural wording. */
const COUNTED = Object.freeze({
  votesMissing: ['{n} candidate has no vote figure in the sources Civgraph holds.', '{n} candidates have no vote figure in the sources Civgraph holds.'],
  electionLosers: ["Party votes and shares leave out the losing candidates' votes in {n} contest, whose losers are not on file.", "Party votes and shares leave out the losing candidates' votes in {n} contests, whose losers are not on file."],
  genderRecorded: ['Gender is recorded for {n} of the {total} candidacies in this table.', 'Gender is recorded for {n} of the {total} candidacies in this table.'],
  incumbencyUnknown: ['Incumbency is unknown for {n} of the {total} candidacies in this table (no person link, or no earlier election of the body on file).', 'Incumbency is unknown for {n} of the {total} candidacies in this table (no person link, or no earlier election of the body on file).'],
  noParty: ['{n} of the {total} candidacies in this table has no party recorded.', '{n} of the {total} candidacies in this table have no party recorded.'],
  unopposed: ['{n} of the {total} candidacies in this table was returned unopposed: it counts in seats and candidates, but has no votes.', '{n} of the {total} candidacies in this table were returned unopposed: they count in seats and candidates, but have no votes.'],
});

/** Every pattern a note can use (keys of data/i18n/strings/elections.txt), for the key test. */
export const COUNTED_PATTERNS = Object.freeze([...new Set(Object.values(COUNTED).flat())]);

/**
 * A counted sentence, its numbers formatted by `fmt`.
 * @param {keyof typeof COUNTED} id @param {number} n @param {(v: number) => string} fmt @param {number} [total]
 */
export function counted(id, n, fmt, total) {
  const [one, many] = COUNTED[id];
  return (n === 1 ? one : many).replace('{n}', fmt(n)).replace('{total}', total === undefined ? '' : fmt(total));
}

/**
 * A data note: an id (the data-limit attribute, for tests and styling hooks) and its sentences.
 * @typedef {{ id: 'losers' | 'votes' | 'transfers' | 'leaders' | 'gender' | 'incumbency' | 'party' | 'unopposed' | 'election-losers', sentences: string[] }} Limit
 */

/** Whether a voting system's count transfers votes (registry `transfers`). @param {unknown} system */
export const countsTransfers = (system) => votingSystemsWithTransfers.includes(String(system || ''));

/** The polled kinds of count sheet (lib/count.js): votes were cast and recorded. */
const POLLED = new Set(['stages', 'single', 'order']);

/**
 * The notes of one contest page, from its count sheet and its record.
 * @param {{ kind: string, rows: Array<{ firstPrefs: number | null, unopposed: boolean, autoReturned: boolean }>, seats: number | null, validPoll: number | null }} sheet
 * @param {{ losersNotPrinted?: unknown }} [contest]
 * @returns {{ notes: Limit[], losersMissing: boolean, votesMissing: number }}
 */
export function contestLimits(sheet, contest = {}) {
  /** @type {Limit[]} */
  const notes = [];
  if (!POLLED.has(sheet.kind)) return { notes, losersMissing: false, votesMissing: 0 };
  const polled = sheet.rows.filter((r) => !r.unopposed && !r.autoReturned);
  const seats = sheet.seats || 0;
  const losersMissing = seats > 0 && sheet.rows.length > 0 && sheet.rows.length <= seats;
  if (losersMissing) {
    const sum = polled.reduce((s, r) => s + (r.firstPrefs || 0), 0);
    const electedOnly = sheet.validPoll !== null && Math.abs(sheet.validPoll - sum) < 0.5;
    notes.push({
      id: 'losers',
      sentences: [contest.losersNotPrinted === true ? NOTE.losersNotPrinted : NOTE.losersMissing, electedOnly ? NOTE.electedVotesOnly : NOTE.noMajority],
    });
  }
  const votesMissing = polled.filter((r) => r.firstPrefs === null).length;
  return { notes, losersMissing, votesMissing };
}

/** The note of a contest's candidates with no vote figure. @param {number} n @param {(v: number) => string} fmt @returns {Limit | null} */
export const votesMissingNote = (n, fmt) => (n > 0 ? { id: 'votes', sentences: [counted('votesMissing', n, fmt)] } : null);

/**
 * Whether a row of an election summary is a polled contest whose losing candidates are not on
 * file (no more candidates than seats).
 * @param {{ candidateCount?: unknown, seatsTotal?: unknown, validPoll?: unknown, leadingVotes?: unknown }} row
 */
export function summaryLosersMissing(row) {
  const candidates = Number(row.candidateCount) || 0;
  const seats = Number(row.seatsTotal) || 0;
  return summaryPollStatus(row) === 'polled' && candidates > 0 && seats > 0 && candidates <= seats;
}

/** The swingometer's caveat beside its seat estimate, for a system that transfers votes. @param {unknown} system @returns {Limit | null} */
export const swingLimit = (system) => (countsTransfers(system) ? { id: 'transfers', sentences: [NOTE.transfers] } : null);

/**
 * The SQL of the counts behind the pivot table's notes, over the same rows and filters as the
 * table (`where` from lib/pivot.js whereSql).
 * @param {string} where
 */
export function pivotLimitsSql(where) {
  return `SELECT COUNT(*) AS total, COUNT(gender) AS gender, COUNT(*) FILTER (WHERE incumbent IS NULL) AS incumbent_unknown,
    COUNT(*) FILTER (WHERE party = '${NO_PARTY_RECORDED.replace(/'/g, "''")}' OR party IS NULL OR party = '') AS no_party,
    COUNT(*) FILTER (WHERE unopposed) AS unopposed FROM rows ${where}`;
}

/** Measures that read votes (an unopposed return has none). */
const VOTE_MEASURES = new Set(['votes', 'share', 'avg_share', 'transfers']);

/**
 * The pivot table's notes: each limit of a dimension, filter or measure the table uses, with the
 * counts of its own rows. A table that uses none of them has no notes.
 * @param {{ rows: string, cols: string, measure: string, filters: Record<string, string[]> }} settings
 * @param {{ total: number, gender: number, incumbent_unknown: number, no_party: number, unopposed: number }} counts
 * @param {(v: number) => string} fmt
 * @returns {Limit[]}
 */
export function pivotLimits(settings, counts, fmt) {
  const uses = (/** @type {string} */ d) => settings.rows === d || settings.cols === d || (settings.filters[d] || []).length > 0;
  const total = Number(counts.total) || 0;
  /** @type {Limit[]} */
  const out = [];
  if (!total) return out;
  if (uses('gender')) out.push({ id: 'gender', sentences: [counted('genderRecorded', Number(counts.gender) || 0, fmt, total), NOTE.genderNeverInferred] });
  if (uses('incumbent')) {
    const unknown = Number(counts.incumbent_unknown) || 0;
    out.push({ id: 'incumbency', sentences: [NOTE.incumbencyDerived, ...(unknown ? [counted('incumbencyUnknown', unknown, fmt, total)] : [])] });
  }
  if (uses('party')) {
    const none = Number(counts.no_party) || 0;
    out.push({ id: 'party', sentences: [NOTE.partyAsPrinted, ...(none ? [counted('noParty', none, fmt, total)] : [])] });
  }
  const unopposed = Number(counts.unopposed) || 0;
  if (VOTE_MEASURES.has(settings.measure) && unopposed) out.push({ id: 'unopposed', sentences: [counted('unopposed', unopposed, fmt, total)] });
  return out;
}

/**
 * A note as HTML: one sentence a span, so the language runtime translates each by its wording.
 * @param {Limit} limit @param {(s: string) => string} esc @param {string} [cls]  the element's classes
 */
export function limitHtml(limit, esc, cls = 'cg-notice') {
  return `<p class="${cls}" data-limit="${esc(limit.id)}">${limit.sentences.map((s) => `<span>${esc(s)}</span>`).join(' ')}</p>`;
}
