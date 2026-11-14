/**
 * How the Elections app works out the figures it does not read from a source, and the short
 * notes that point to it (stream el-tables, 14 Nov 2026). Each worked-out figure carries its own
 * note where it is shown (EL2, owner 13 Nov 2026: no blanket disclaimers), and the note links to
 * its section of the methods page (/elections/methods/, views/methods.js), which says exactly how
 * the figure is made. The words are the code's: change the code, change the words here (the unit
 * test holds the numbers that are constants elsewhere, such as the swingometer's limit).
 *
 * Every sentence is keyed for translation in data/i18n/strings/elections.txt (R10: the language
 * runtime translates a text node by its wording, so a paragraph is one text node). Pure (no DOM):
 * tests/unit/elections-app-methods.test.mjs.
 */
import { escapeHtml as esc } from '../../../pkg/core/src/html.js';

/** The methods page's address. */
export const METHODS_URL = '/elections/methods/';

/**
 * One derivation: its anchor on the methods page, its heading, the words of the link that points
 * to it from a figure, and its paragraphs.
 * @typedef {{ id: MethodId, title: string, link: string, paragraphs: string[] }} Method
 * @typedef {'shares' | 'losers' | 'change' | 'swing' | 'turnout' | 'majority' | 'party-labels' | 'incumbency' | 'seat-estimates' | 'swingometer' | 'notional' | 'checked'} MethodId
 */

/** @type {ReadonlyArray<Method>} */
export const METHODS = Object.freeze([
  {
    id: 'shares',
    title: 'Vote shares',
    link: 'How shares are worked out',
    paragraphs: [
      "A party's share of the vote at an election is its candidates' votes added up, divided by the votes of every candidate in the contests that went to a poll, as a percentage. Under the single transferable vote the votes are first preferences.",
      'A contest returned unopposed counts towards seats and candidates but has no votes, so it adds nothing to either side of the division. Where some contests of an election have no recorded votes, the shares are of the contests that have them, and the page says how many those are.',
      "A candidate's share in a contest is their votes divided by the contest's valid poll as the source gives it. Where the source gives no valid poll, the candidates' votes added up stand for it, and the contest page says so.",
      "In the pivot tables, a share of the votes or seats in the column is a cell's votes or seats divided by those of its whole column. The average candidate share is the plain mean of each candidate's share of their own contest's valid poll.",
    ],
  },
  {
    id: 'losers',
    title: 'Shares when the losing candidates are missing',
    link: 'How these shares are affected',
    paragraphs: [
      'Some contests are on file with only the members elected: the source printed no losing candidates, or the sources read so far name only the winners. A contest counts as one of these when it went to a poll and has no more candidates on file than seats.',
      "Their votes are counted as they are. An election's party votes and shares therefore leave out the losing candidates' votes in those contests, and a contest's own shares are of the elected members' votes alone. No majority is given for such a contest, since the runner-up's votes are not known. Each page with such figures says how many contests are affected.",
    ],
  },
  {
    id: 'change',
    title: 'Change since the previous election',
    link: 'How change is worked out',
    paragraphs: [
      "The seat change (±) is a party's seats at this election minus its seats at the body's previous general election. The share change (± pts) is the difference between its two vote shares, in percentage points. A vote change is given only when both elections have recorded votes.",
      'Change is shown between general elections only: a by-election is not compared, since the election before it filled every seat. Parties are matched by their names as the party table gives them (see party labels); a party that won seats last time and did not stand this time is listed with its losses.',
      'Compare sets any two elections side by side the same way. Between two bodies, parties are matched by their labels only. Contest by contest, contests are matched by name, and a contest is marked changed when its winning party differs, or, where it elects several members, the party with most seats.',
    ],
  },
  {
    id: 'swing',
    title: 'Swing on the results map',
    link: 'How swing is worked out',
    paragraphs: [
      "The map's change mode shows, area by area, a party's share at this election minus its share at an earlier election of the same body fought on the same boundaries, in percentage points. A party's share in an area is its votes there divided by all the votes there (first preferences under the single transferable vote).",
      'Parties are matched by their ballot label as printed. An area with no recorded votes at either election is hatched. No change is mapped across a boundary change: the notional results carry votes across one.',
    ],
  },
  {
    id: 'turnout',
    title: 'Turnout',
    link: 'How turnout is worked out',
    paragraphs: [
      "A contest's turnout is the figure its source gives. Where the source gives none but gives the total poll and the electorate, turnout is the total poll divided by the electorate, as a percentage, and the contest page says it was worked out. Where the source gives the turnout but not the total poll, the total poll is the electorate times the turnout, rounded to a whole vote.",
      "An election's turnout is the median of its contests' turnouts, with the lowest and the highest. Contests with no turnout on file, those returned unopposed among them, are left out. The pivot tables' average turnout is the plain mean of the contests' turnouts, each contest counted once.",
    ],
  },
  {
    id: 'majority',
    title: 'Majority and quota',
    link: 'How the majority is worked out',
    paragraphs: [
      "Under first past the post the majority is the winner's votes minus the runner-up's. It is the source's figure where the source gives one; otherwise it is worked out from the candidates' votes, and the contest page says so. Its percentage is of the valid poll.",
      "Under the single transferable vote a contest gives its quota instead, as the source states it. Progress to the quota is each candidate's votes at their last count divided by the quota.",
    ],
  },
  {
    id: 'party-labels',
    title: 'Party labels',
    link: 'How party labels are grouped',
    paragraphs: [
      'Candidates stand under the label printed on the ballot paper, and the records keep that label as printed.',
      "An election's party table groups the labels. Labels that differ only in capital letters, accents, punctuation, '&' for 'and', or a note in brackets count as one party, shown under the first spelling met. At Dáil elections a few older spellings are read as the current name (Sinn Fein as Sinn Féin, Fianna Fail as Fianna Fáil, Labour as Irish Labour, People Before Profit as PBP), and a candidate with no label counts as Independent.",
      'The pivot tables, the share and change maps, the swingometer and the notional results do not group labels: each label as printed is a party of its own there, so one party can appear under several spellings. A candidacy with no label reads No party recorded.',
    ],
  },
  {
    id: 'incumbency',
    title: 'Incumbency',
    link: 'How incumbency is worked out',
    paragraphs: [
      "Incumbency is worked out, not taken from a source. A candidate counts as an incumbent when the same person, by Civgraph's person link, was elected to the same body at its previous general election or at a by-election since. Someone elected then who left the body before this election still counts.",
      'Incumbency is unknown for a candidacy with no person link, and for every candidacy at the first election of a body that Civgraph holds.',
    ],
  },
  {
    id: 'seat-estimates',
    title: 'Seat estimates from first preferences',
    link: 'How seats are estimated',
    paragraphs: [
      'The swingometer and the notional results estimate seats from vote shares alone. A contest with one seat goes to the party with the largest share. In a contest with several seats, each party gets a seat for every whole quota of 100 ÷ (seats + 1) per cent in its share, and any seats left go to the largest remainders.',
      "A party's candidates are pooled, so the estimate is of the party's seats, not of who would win them. Under the single transferable vote the real count transfers votes, which often decides the last seats. Transfers are not modelled, so these estimates can differ from the seats actually won, even with no change at all.",
    ],
  },
  {
    id: 'swingometer',
    title: 'The swingometer',
    link: 'How the swingometer works',
    paragraphs: [
      "The swingometer starts from a base election's votes by contest and party (first preferences under the single transferable vote). Moving a party's slider adds that many points to its share in every contest: a uniform swing. A share cannot fall below zero, and each contest's shares are then scaled to add up to 100. Seats are then estimated as above.",
      "Each party with at least 0.5% of the base election's vote has a slider, from −15 to +15 points. The base seats are the same estimate with no change, so they can differ from the seats actually won. The new share is each party's share of the whole vote with its change applied, scaled with the others to add up to 100. No poll is used.",
    ],
  },
  {
    id: 'notional',
    title: 'Notional results',
    link: 'How notional results are worked out',
    paragraphs: [
      "A notional result estimates how an election would have gone on new boundaries. Each old constituency's votes are shared out among the new constituencies that take in part of it, by one of two weights: the share of its 2021 usual residents living in each (population-weighted, with each 2021 Data Zone counted whole in the old and new constituency that hold its central point), or the share of its land area (area-weighted).",
      "A new constituency's notional votes are the sum, over the old constituencies, of each one's votes times its weight. Each new constituency has as many seats as the base election's contests had on average, estimated from its notional shares as above. The projection takes the shares you type, works out each party's change from its notional share, and applies that change as a uniform swing. These are Civgraph's estimates, not official notional results.",
    ],
  },
  {
    id: 'checked',
    title: 'Data checked dates',
    link: 'What the checked date means',
    paragraphs: [
      "Where Civgraph fetched a source and compared it with a contest figure by figure, the source carries the day of that comparison. A contest page gives, beside its figures, the latest such day among the sources that agreed with every figure compared, and each source in its list gives its own day.",
      'A source that was compared but disagreed somewhere carries its day too, with what differed. Sources checked another way, such as a printed volume read page by page, carry no day.',
    ],
  },
]);

/** The methods by id. */
const BY_ID = new Map(METHODS.map((m) => [m.id, m]));

/**
 * The link from a figure to its method.
 * @param {MethodId} id
 */
export function methodLink(id) {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`no method ${id}`);
  return `<a class="el-method-link" href="${METHODS_URL}#${m.id}">${esc(m.link)}</a>`;
}

/** The short notes beside worked-out figures (keys of data/i18n/strings/elections.txt). */
export const METHOD_NOTE = Object.freeze({
  changeSince: "Change is against this body's previous general election.",
  partyGrouped: 'Ballot labels that differ only in spelling are counted as one party.',
  turnoutDerived: 'Worked out from the total poll and the electorate.',
  validDerived: "The source gives no valid poll: the candidates' votes added up stand for it.",
  majorityDerived: "Worked out from the candidates' votes.",
  shareOfPolled: 'Shares are of the votes cast in contests with a poll.',
  mapShare: "Each area's share is the party's votes there divided by all the votes there.",
  mapSwing: "Each area's change is the party's share now minus its share then, in points, on the same boundaries.",
  mapTurnout: "Each area's turnout as its source gives it, or worked out from the total poll and the electorate.",
  labelsAsPrinted: 'Parties here are ballot labels as printed.',
  compareChange: 'Seat and share changes are later minus earlier.',
  uniformSwing: 'Every contest moves by the same points (uniform swing).',
  notionalWeights: "Each old constituency's votes are shared out by the weights chosen above.",
});

/**
 * A short note beside a worked-out figure, with the link to its method: one paragraph, one
 * span a sentence (so each is translated by its wording).
 * @param {MethodId} id
 * @param {string[]} [sentences]
 * @param {string} [cls]
 */
export function methodNote(id, sentences = [], cls = 'el-muted el-method') {
  return `<p class="${cls}" data-method="${esc(id)}">${sentences.map((s) => `<span>${esc(s)}</span> `).join('')}${methodLink(id)}</p>`;
}

/** Every fixed sentence of this module, for the key test. */
export const METHOD_STRINGS = Object.freeze([
  ...METHODS.flatMap((m) => [m.title, m.link, ...m.paragraphs]),
  ...Object.values(METHOD_NOTE),
]);

/** The pivot measures whose figures are worked out, and their methods. */
const PIVOT_MEASURE_METHOD = /** @type {Readonly<Record<string, MethodId>>} */ (Object.freeze({
  share: 'shares', seat_share: 'shares', avg_share: 'shares', turnout: 'turnout',
}));
/** The pivot notes (lib/limits.js ids) whose figures are worked out, and their methods. */
const PIVOT_LIMIT_METHOD = /** @type {Readonly<Record<string, MethodId>>} */ (Object.freeze({
  incumbency: 'incumbency', party: 'party-labels',
}));

/**
 * The method links of a pivot table: one for its measure when that is worked out, and one for
 * each of its notes (by the note's id) that is.
 * @param {{ measure: string }} settings
 * @returns {{ measure: MethodId | null, limits: Readonly<Record<string, MethodId>> }}
 */
export function pivotMethodLinks(settings) {
  return { measure: PIVOT_MEASURE_METHOD[settings.measure] || null, limits: PIVOT_LIMIT_METHOD };
}
