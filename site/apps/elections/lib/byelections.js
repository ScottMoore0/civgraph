/**
 * The by-election tracker's logic (/elections/byelections/, stream el-bodies): its URL state, the
 * filters, the sorting, the summary line and the CSV. Pure (no DOM): tests/unit/elections-app-bodies.test.mjs.
 *
 * URL state (every key optional; the defaults are left out of the address):
 *   body=<unit>          a body, or a council of a shared body (the table's `units`)
 *   area=<text>          the area's name contains this (accents and case aside)
 *   win=<party>          the winning party (a party key of the table; "none" for no party label)
 *   def=<party>          the defending party ("none": not recorded)
 *   stand=<a>,<b>        every one of these parties stood
 *   from=<year> to=<year>
 *   result=held|gained|unknown
 *   unopposed=yes|no
 *   type=by-election|co-option
 *   sort=date|turnout|majority|share   dir=desc|asc   party=<party> (the share sorted by)
 *   n=<rows shown>
 */
import { toCsvText } from './csv.js';

/** @typedef {import('./tables.js').ByElectionRow} Row @typedef {import('./tables.js').ByElectionsTable} Table */
/** @typedef {'date' | 'turnout' | 'majority' | 'share'} SortKey */
/** @typedef {'asc' | 'desc'} SortDir */
/** @typedef {'' | 'held' | 'gained' | 'unknown'} ResultFilter */
/** @typedef {'' | 'yes' | 'no'} YesNo */
/** @typedef {'' | 'by-election' | 'co-option'} TypeFilter */
/**
 * @typedef {{ body: string, area: string, win: string, def: string, stand: string[], from: number | null, to: number | null,
 *   result: ResultFilter, unopposed: YesNo, type: TypeFilter, sort: SortKey, dir: SortDir, party: string, n: number }} State
 */

/** Rows shown at first, and added by "Show more". */
export const PAGE = 100;
/** The party key a filter uses for "no party label" or "not recorded". */
export const NONE = 'none';

/** @type {Readonly<State>} */
export const DEFAULT_STATE = Object.freeze({
  body: '', area: '', win: '', def: '', stand: [], from: null, to: null,
  result: '', unopposed: '', type: '', sort: 'date', dir: 'desc', party: '', n: PAGE,
});

/** @type {readonly SortKey[]} */
export const SORTS = Object.freeze(['date', 'turnout', 'majority', 'share']);
/** @type {readonly ResultFilter[]} */
const RESULTS = Object.freeze(['', 'held', 'gained', 'unknown']);
/** @type {readonly TypeFilter[]} */
const TYPES = Object.freeze(['', 'by-election', 'co-option']);

/** @param {string | null} v */
const year = (v) => (v && /^\d{4}$/.test(v) ? Number(v) : null);

/**
 * The state of a query string.
 * @param {URLSearchParams} q
 * @returns {State}
 */
export function stateFromQuery(q) {
  const pick = /** @template {string} T @param {readonly T[]} list @param {string | null} v @param {T} dflt @returns {T} */ (list, v, dflt) => (list.includes(/** @type {T} */ (v)) ? /** @type {T} */ (v) : dflt);
  const n = Number(q.get('n'));
  return {
    body: q.get('body') || '',
    area: (q.get('area') || '').slice(0, 80),
    win: q.get('win') || '',
    def: q.get('def') || '',
    stand: (q.get('stand') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8),
    from: year(q.get('from')),
    to: year(q.get('to')),
    result: pick(RESULTS, q.get('result'), ''),
    unopposed: q.get('unopposed') === 'yes' ? 'yes' : q.get('unopposed') === 'no' ? 'no' : '',
    type: pick(TYPES, q.get('type'), ''),
    sort: pick(SORTS, q.get('sort'), 'date'),
    dir: q.get('dir') === 'asc' ? 'asc' : 'desc',
    party: q.get('party') || '',
    n: Number.isInteger(n) && n > 0 ? Math.min(n, 100000) : PAGE,
  };
}

/**
 * The query string of a state, without its defaults.
 * @param {State} s
 */
export function queryFromState(s) {
  const q = new URLSearchParams();
  if (s.body) q.set('body', s.body);
  if (s.area) q.set('area', s.area);
  if (s.win) q.set('win', s.win);
  if (s.def) q.set('def', s.def);
  if (s.stand.length) q.set('stand', s.stand.join(','));
  if (s.from !== null) q.set('from', String(s.from));
  if (s.to !== null) q.set('to', String(s.to));
  if (s.result) q.set('result', s.result);
  if (s.unopposed) q.set('unopposed', s.unopposed);
  if (s.type) q.set('type', s.type);
  if (s.sort !== 'date') q.set('sort', s.sort);
  if (s.dir !== 'desc') q.set('dir', s.dir);
  if (s.sort === 'share' && s.party) q.set('party', s.party);
  if (s.n !== PAGE) q.set('n', String(s.n));
  return q.toString();
}

/** Accent-free lower case, for the area search. @param {unknown} s */
export const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The parties that stood in a row (each once). @param {Row} r */
const standing = (r) => new Set(r.candidates.length ? r.candidates.map((c) => c.party || NONE) : r.winners.map((w) => w.party || NONE));

/** A row's winning party key (the first winner's), NONE for no label. @param {Row} r */
export const winningParty = (r) => (r.winners[0] ? r.winners[0].party || NONE : NONE);
/** A row's defending party key, NONE when not recorded. @param {Row} r */
export const defendingParty = (r) => (r.defending?.party ? r.defending.party : NONE);

/**
 * The rows a state's filters keep.
 * @param {Row[]} rows @param {State} s
 */
export function filterRows(rows, s) {
  const area = fold(s.area).trim();
  return rows.filter((r) => {
    const y = Number(r.date.slice(0, 4));
    if (s.body && r.unit !== s.body) return false;
    if (area && !fold(r.area).includes(area)) return false;
    if (s.win && winningParty(r) !== s.win) return false;
    if (s.def && defendingParty(r) !== s.def) return false;
    if (s.from !== null && y < s.from) return false;
    if (s.to !== null && y > s.to) return false;
    if (s.result === 'held' && r.result !== 'held') return false;
    if (s.result === 'gained' && r.result !== 'gained') return false;
    if (s.result === 'unknown' && r.result !== null) return false;
    if (s.unopposed === 'yes' && !r.unopposed) return false;
    if (s.unopposed === 'no' && r.unopposed) return false;
    if (s.type && r.type !== s.type) return false;
    if (s.stand.length) {
      const st = standing(r);
      if (!s.stand.every((p) => st.has(p))) return false;
    }
    return true;
  });
}

/**
 * A party's share of the vote in a row (its candidates' shares added), or null when it did not
 * stand or no vote figures are on file.
 * @param {Row} r @param {string} party
 */
export function partyShare(r, party) {
  const mine = r.candidates.filter((c) => (c.party || NONE) === party && c.share !== null);
  return mine.length ? Math.round(mine.reduce((s, c) => s + /** @type {number} */ (c.share), 0) * 100) / 100 : null;
}

/**
 * The rows in a state's order. A row without the figure sorted by goes last either way; ties
 * keep date order (newest first).
 * @param {Row[]} rows @param {State} s
 */
export function sortRows(rows, s) {
  /** @type {(r: Row) => number | string | null} */
  const key = s.sort === 'turnout' ? (r) => r.turnout
    : s.sort === 'majority' ? (r) => r.majority
      : s.sort === 'share' ? (r) => (s.party ? partyShare(r, s.party) : null)
        : (r) => r.date;
  const sign = s.dir === 'asc' ? 1 : -1;
  return rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => {
    if (a.k === null && b.k === null) return b.r.date.localeCompare(a.r.date) || a.i - b.i;
    if (a.k === null) return 1;
    if (b.k === null) return -1;
    const d = typeof a.k === 'string' ? String(a.k).localeCompare(String(b.k)) : Number(a.k) - Number(b.k);
    return sign * d || b.r.date.localeCompare(a.r.date) || a.i - b.i;
  }).map((x) => x.r);
}

/**
 * The counts of the summary line.
 * @param {Row[]} rows
 * @returns {{ byElections: number, changed: number, held: number, unknown: number, coOptions: number }}
 */
export function summarise(rows) {
  const by = rows.filter((r) => r.type === 'by-election');
  return {
    byElections: by.length,
    changed: by.filter((r) => r.result === 'gained').length,
    held: by.filter((r) => r.result === 'held').length,
    unknown: by.filter((r) => r.result === null).length,
    coOptions: rows.length - by.length,
  };
}

/**
 * The parties a filter can offer: every party a row names (winner, defender, candidate), by name.
 * @param {Table} table
 * @returns {Array<{ key: string, name: string }>}
 */
export function partyOptions(table) {
  const keys = new Set();
  for (const r of table.rows) {
    for (const w of r.winners) if (w.party) keys.add(w.party);
    for (const c of r.candidates) if (c.party) keys.add(c.party);
    if (r.defending?.party) keys.add(r.defending.party);
  }
  return [...keys].map((k) => ({ key: String(k), name: table.parties[String(k)]?.name || String(k) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The bodies a filter can offer: each unit with by-elections, by name, with its count.
 * @param {Table} table
 * @returns {Array<{ key: string, name: string, count: number }>}
 */
export function bodyOptions(table) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of table.rows) counts.set(r.unit, (counts.get(r.unit) || 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, name: table.units[key]?.name || key, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The address of a row's area page, where there is one. Area pages are stream el-places' (14 Nov
 * 2026): until they land there is none, and the view links the area to its contest instead. This
 * is the one place to point it at them.
 * @param {Row} row
 * @returns {string | null}
 */
export function areaUrl(row) {
  void row;
  return null;
}

/** The CSV's columns, in order. */
export const CSV_COLUMNS = Object.freeze([
  'date', 'type', 'body', 'area', 'seats', 'unopposed', 'winners', 'winning_party', 'defending_party', 'departing_member',
  'defending_basis', 'result', 'turnout_pct', 'electorate', 'majority', 'majority_pct', 'candidates', 'cause', 'election_key', 'contest_slug',
]);

/**
 * The filtered rows as CSV (every row, not only those shown). Party columns carry the party's
 * name; "not recorded" cells are empty.
 * @param {Row[]} rows @param {Table} table
 */
export function byElectionsCsv(rows, table) {
  const name = (/** @type {string | null | undefined} */ p) => (p ? table.parties[p]?.name || p : '');
  return toCsvText([...CSV_COLUMNS], rows.map((r) => ({
    date: r.date,
    type: r.type,
    body: table.units[r.unit]?.name || r.unit,
    area: r.area,
    seats: r.seats,
    unopposed: r.unopposed,
    winners: r.winners.map((w) => w.name).join('; '),
    winning_party: r.winners.map((w) => name(w.party)).join('; '),
    defending_party: name(r.defending?.party),
    departing_member: r.defending?.name || '',
    defending_basis: r.defending?.basis || '',
    result: r.result || '',
    turnout_pct: r.turnout,
    electorate: r.electorate,
    majority: r.majority,
    majority_pct: r.majorityPct,
    candidates: r.candidates.map((c) => `${c.name} (${name(c.party) || '-'}${c.votes !== null ? `, ${c.votes}` : ''})`).join('; '),
    cause: r.cause,
    election_key: r.election,
    contest_slug: r.contest,
  })));
}
