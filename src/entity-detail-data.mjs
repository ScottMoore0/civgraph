/**
 * The figures behind the person, party and constituency pages in the map app's catalogue pane.
 *
 * Pure: no DOM and no fetch, so the arithmetic can be tested on its own
 * (tests/catalogue/entity-detail-data.test.mjs). packages/map/app/app.js shapes the Browse / D1 records
 * with these, and src/ui-controller.js renders the result.
 *
 * The rule throughout (UX review 2026-10-31, H1): a figure the record does not carry is null,
 * never 0. The pages used to coerce every missing field to 0, so every party "won 0.00% of
 * seats" and every person took "0.00%" of the vote; a null renders as a dash and a column that
 * is null on every row is left out.
 */

/**
 * A row of a person's or party's election history as the Browse / D1 record gives it: the
 * fields read here by name; the others stay unknown, and the helpers below add their own.
 * @typedef {{
 *   [field: string]: unknown,
 *   date?: string | null,
 *   electionDisplayName?: string | null,
 *   electionType?: string | null,
 *   body?: string | null,
 *   constituency?: unknown,
 *   elected?: unknown,
 *   isByElection?: unknown,
 *   contested?: unknown,
 *   isRecallPetition?: unknown
 * }} HistoryRow
 */
/** @typedef {import('../packages/core/src/election-view-model.mjs').ElectionResult} ElectionResult */

/**
 * True for a value that is a real number (0 included), false for null, '' and NaN.
 * @param {unknown} value
 */
export function hasNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

/**
 * A count the summary may not have carried. Browse's rule (browse.js knownCount): a 0 beside
 * seats won is an unopposed return or an older file with no candidate counts, not a real zero,
 * so "Stood 0, Seats 1" becomes "Stood -, Seats 1".
 * @param {unknown} value
 * @param {boolean} [zeroIsUnknown]
 */
export function knownCount(value, zeroIsUnknown = false) {
  if (!hasNumber(value)) return null;
  const n = Number(value);
  return n === 0 && zeroIsUnknown ? null : n;
}

/** Body groups, for the filter chips above a long history and the party headline cards. */
export const BODY_GROUP_ORDER = ['Dáil', 'Westminster', 'Devolved', 'Local', 'European', 'Presidential', 'Referendum', 'Other'];

/** @param {unknown} electionType */
export function bodyGroupOf(electionType) {
  const t = String(electionType || '');
  if (/D[aá]il/i.test(t)) return 'Dáil';
  if (/Westminster/i.test(t)) return 'Westminster';
  if (/Assembly|Forum|Convention|Parliament of NI/i.test(t)) return 'Devolved';
  if (/Local/i.test(t)) return 'Local';
  if (/European/i.test(t)) return 'European';
  if (/Presidential/i.test(t)) return 'Presidential';
  if (/Referendum/i.test(t)) return 'Referendum';
  return 'Other';
}

/**
 * What the members of each body are called, for the party headline cards.
 * @type {Record<string, [string, string]>}
 */
const MEMBER_WORD = {
  Westminster: ['MP', 'MPs'],
  'Dáil': ['TD', 'TDs'],
  Assembly: ['MLA', 'MLAs'],
  European: ['MEP', 'MEPs'],
  'Parliament of NI': ['MP (Stormont)', 'MPs (Stormont)'],
  Local: ['councillor', 'councillors'],
};

/**
 * @param {HistoryRow} a
 * @param {HistoryRow} b
 */
const byDateAsc = (a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999'))
  || String(a.electionDisplayName || '').localeCompare(String(b.electionDisplayName || ''));

/**
 * One status vocabulary (M4). The sources say "Deemed elected" for every contested first-past-
 * the-post win, "Made Quota" for a Dáil STV win and "Elected" for an Assembly one, and leave a
 * loss blank; the reader sees Elected / Elected unopposed / Not elected, and the source's own
 * word stays in the tooltip.
 * @param {{ status?: unknown, firstPref?: unknown, firstPrefs?: unknown, votes?: unknown, elected?: unknown }} [row]
 */
export function normaliseStatus(row = {}) {
  const raw = String(row.status || '').trim();
  const votes = row.firstPref ?? row.firstPrefs ?? row.votes;
  const elected = row.elected === true || /^(elected|made quota|deemed elected|returned|elected at constituency|elected unopposed|unopposed)/i.test(raw);
  if (elected) {
    // Unopposed: said so by the source, or a "deemed" return with no vote recorded.
    const unopposed = /unopposed/i.test(raw) || (/deemed/i.test(raw) && !hasNumber(votes));
    return { label: unopposed ? 'Elected unopposed' : 'Elected', raw, elected: true };
  }
  if (row.elected === false || /^(excluded|eliminated|not elected|defeated|lost|withdrawn|-)?$/i.test(raw)) {
    return { label: 'Not elected', raw: raw === '-' ? '' : raw, elected: false };
  }
  return { label: raw, raw, elected: false };
}

/**
 * Number each appearance in a career (H1): the 12th time standing, the 10th win, the 5th
 * Assembly election, the 4th Assembly win. The D1 record does not carry these, and the four
 * columns that showed them were blank; they follow from the list itself, oldest first.
 * @param {HistoryRow[]} [appearances]
 * @returns {HistoryRow[]}
 */
export function addStandings(appearances = []) {
  const ordered = [...appearances].sort(byDateAsc);
  const counts = { stood: 0, won: 0, typeStood: new Map(), typeWon: new Map() };
  for (const row of ordered) {
    const type = row.electionType || 'Election';
    counts.stood += 1;
    counts.typeStood.set(type, (counts.typeStood.get(type) || 0) + 1);
    row.overallStandingNumber = counts.stood;
    row.bodyStandingNumber = counts.typeStood.get(type);
    if (row.elected) {
      counts.won += 1;
      counts.typeWon.set(type, (counts.typeWon.get(type) || 0) + 1);
      row.overallElectedNumber = counts.won;
      row.bodyElectedNumber = counts.typeWon.get(type);
    } else {
      row.overallElectedNumber = null;
      row.bodyElectedNumber = null;
    }
  }
  return ordered;
}

/**
 * "1970–2007", "1969–70", "1979–99", or one year.
 * @param {unknown} from
 * @param {unknown} to
 */
export function yearRange(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a)) return Number.isFinite(b) ? String(b) : '';
  if (!Number.isFinite(b) || a === b) return String(a);
  const sameCentury = Math.floor(a / 100) === Math.floor(b / 100);
  return `${a}–${sameCentury ? String(b).slice(2) : b}`;
}

/**
 * A person's constituencies once each, with the years they stood there (M3): "North Antrim
 * 1970–2007 · Bannside 1969–70" rather than a 26-item list repeating North Antrim per election.
 * Ordered by the first year; `elected` is true if they ever won there.
 * @template {HistoryRow} R
 * @param {R[]} [appearances]
 */
export function groupConstituencies(appearances = []) {
  /** @type {Map<string, { name: string, label: string, from: number | null, to: number | null, count: number, elected: boolean, latest: R }>} */
  const groups = new Map();
  for (const row of appearances) {
    const name = String(row.constituency || '').trim();
    if (!name) continue;
    const year = Number(String(row.date || '').slice(0, 4)) || null;
    const key = `${name.toLowerCase()}|${row.electionType === 'European' ? 'eu' : ''}`;
    if (!groups.has(key)) {
      groups.set(key, { name, label: name === 'Northern Ireland' && row.electionType === 'European' ? 'Northern Ireland (Europe)' : name, from: year, to: year, count: 0, elected: false, latest: row });
    }
    const g = /** @type {{ name: string, label: string, from: number | null, to: number | null, count: number, elected: boolean, latest: R }} */ (groups.get(key));
    g.count += 1;
    if (year && (!g.from || year < g.from)) g.from = year;
    if (year && (!g.to || year > g.to)) { g.to = year; g.latest = row; }
    if (row.elected) g.elected = true;
  }
  return [...groups.values()]
    .sort((a, b) => (a.from || 9999) - (b.from || 9999) || a.name.localeCompare(b.name))
    .map((g) => ({ ...g, years: yearRange(g.from, g.to) }));
}

/**
 * Changes since the party's previous general election to the same body (the "+/-" columns,
 * which the Browse record does not carry and which were blank). A by-election is compared with
 * nothing, and nothing is compared with it.
 * @param {HistoryRow[]} [rows]
 * @returns {HistoryRow[]}
 */
export function addPartyChanges(rows = []) {
  /** @type {Map<unknown, HistoryRow>} */
  const previous = new Map();
  for (const row of [...rows].sort(byDateAsc)) {
    if (row.isByElection || !row.contested) continue;
    const key = row.body || row.electionType;
    const prev = previous.get(key);
    /** @param {string} field */
    const delta = (field) => (prev && hasNumber(row[field]) && hasNumber(prev[field]) ? Number(row[field]) - Number(prev[field]) : null);
    row.electedDelta = delta('elected');
    row.stoodDelta = delta('stood');
    row.firstPrefsDelta = delta('firstPrefs');
    row.validVotePctDelta = delta('validVotePct');
    row.comparedWith = prev ? prev.electionDisplayName || prev.date : null;
    previous.set(key, row);
  }
  return rows;
}

/**
 * The headline cards on a party page (M1): its latest general election for each body it
 * actually contested, newest first, so Fianna Fáil shows TDs and Sinn Féin shows TDs, MPs and
 * MLAs, rather than every party showing Northern Ireland's MPs and MLAs and four N/As.
 * @template {HistoryRow} R
 * @param {R[]} [rows]
 * @param {{ max?: number }} [options]
 */
export function partyHeadlineCards(rows = [], { max = 4 } = {}) {
  /** @type {Map<string, R>} */
  const latest = new Map();
  for (const row of rows) {
    if (row.isByElection || !row.contested || row.isRecallPetition) continue;
    const type = row.electionType || 'Election';
    if (/Referendum|Presidential/i.test(type)) continue;
    const current = latest.get(type);
    if (!current || String(row.date || '') > String(current.date || '')) latest.set(type, row);
  }
  return [...latest.entries()]
    .sort((a, b) => String(b[1].date || '').localeCompare(String(a[1].date || '')))
    .slice(0, max)
    .map(([type, row]) => {
      const [one, many] = MEMBER_WORD[type] || ['seat', 'seats'];
      const seats = knownCount(row.elected);
      const year = String(row.date || '').slice(0, 4);
      return {
        label: `${type} ${year}`.trim(),
        value: seats === null ? '—' : `${seats.toLocaleString('en-GB')} ${seats === 1 ? one : many}`,
        subtext: hasNumber(row.validVotePct) ? `${Number(row.validVotePct).toFixed(1)}% of the vote` : '',
        row,
      };
    });
}

/**
 * The party that led a contest on votes (H3). "Leading party" used to be the poll-topper's
 * party with the poll-topper's own first preferences: North Antrim 2022 read "UUP 9,530" when
 * the DUP's three candidates had 12,989 between them. For a single-seat contest the two agree.
 * @param {ElectionResult} [result]
 * @param {{ normalise?: (value: unknown) => string }} [options]
 */
export function leadingPartyOf(result = {}, { normalise = (v) => String(v || '').toLowerCase() } = {}) {
  /** @type {Map<string, { party: unknown, votes: number, colour: unknown, counted: boolean }>} */
  const totals = new Map();
  for (const candidate of result.candidates || []) {
    // Nothing printed and nothing inferred is "No label" (packages/core/src/election-domain.mjs NO_LABEL), never Independent.
    const party = candidate.party || 'No label';
    const key = normalise(party);
    const current = totals.get(key) || { party, votes: 0, colour: candidate.colour || null, counted: false };
    const votes = candidate.firstPrefs ?? candidate.votes;
    if (hasNumber(votes)) { current.votes += Number(votes); current.counted = true; }
    if (!current.colour && candidate.colour) current.colour = candidate.colour;
    totals.set(key, current);
  }
  const ranked = [...totals.values()].filter((t) => t.counted).sort((a, b) => b.votes - a.votes);
  const valid = hasNumber(result.validPoll) ? Number(result.validPoll) : (hasNumber(result.totalVotes) ? Number(result.totalVotes) : null);
  const elected = (result.candidates || []).filter((c) => c.elected).map((c) => ({
    name: c.name || c.candidate || '',
    party: c.party || '',
    personId: c.personId ?? null,
  })).filter((c) => c.name);
  if (!ranked.length) {
    // No votes recorded (an unopposed return): the winner's party, and no figures.
    const party = result.winnerParty || result.leadingParty || elected[0]?.party || '';
    return { party, colour: result.winnerColour || result.leadingColour || result.colour || null, votes: null, pct: null, valid, elected };
  }
  const top = ranked[0];
  return {
    party: top.party,
    colour: top.colour || result.leadingColour || result.colour || null,
    votes: top.votes,
    pct: valid ? top.votes / valid * 100 : null,
    valid,
    elected,
  };
}

/**
 * Labels like "DUP list": the 1996 Forum's regional lists, which are not people (H8).
 * @param {unknown} name
 */
export function isListPseudoCandidate(name) {
  return /(^|\s)list$/i.test(String(name || '').trim());
}
