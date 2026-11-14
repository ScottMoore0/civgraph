/**
 * The by-election tracker's and council control's tables (stream el-bodies, 14 Nov 2026): built
 * with the pivot extracts from the records build (scripts/build/elections-app/bodies.mjs, which
 * says what they claim) and read from the same copy (../config.js: this server in development,
 * R2 in production), named in the extracts' index.json `tables`. Never live D1.
 *
 * The shapes below are the files' (schemaVersion 1); scripts/build/elections-app/bodies-model.mjs
 * defines the rows and timeline entries.
 */
import { EXTRACTS, extractsIndex } from './duck.js';

/**
 * A party a table names: its short name and its colour in the records.
 * @typedef {{ name: string, colour: string | null }} Party
 * @typedef {Record<string, Party>} Parties
 */
/**
 * The member a by-election replaced, and how the records link them to the seat.
 * @typedef {{ name: string, personId: string | null, party: string | null, since: string, basis: 'seat' | 'cause' }} Defending
 */
/**
 * One by-election, or one seat filled by co-option. `result`: whether the defending party kept
 * the seat; null when that cannot be said.
 * @typedef {{
 *   type: 'by-election' | 'co-option', election: string | null, contest: string | null, date: string, body: string, unit: string,
 *   area: string | null, areaSlug: string | null, seats: number, unopposed: boolean, turnout: number | null, electorate: number | null,
 *   majority: number | null, majorityPct: number | null,
 *   winners: Array<{ name: string, personId: string | null, party: string | null }>,
 *   candidates: Array<{ name: string, party: string | null, votes: number | null, share: number | null, elected: boolean }>,
 *   defending: Defending | null, result: 'held' | 'gained' | null, cause: string | null,
 * }} ByElectionRow
 */
/**
 * @typedef {{ schemaVersion: number, parties: Parties, units: Record<string, { name: string, body: string, bodyName: string, council: boolean }>, rows: ByElectionRow[] }} ByElectionsTable
 */
/**
 * Who controls a council: one party's majority, independents' majority, no overall control, or
 * not determinable (members without a known party could tip it).
 * @typedef {'majority' | 'independent' | 'noc' | 'unknown'} ControlKind
 * @typedef {{ kind: ControlKind, party: string | null }} Control
 * @typedef {Array<[string | null, number]>} Seats
 */
/**
 * One entry of a council's timeline: an election, or a change between elections.
 * @typedef {{
 *   type: 'election' | 'by-election' | 'co-option', date: string, election: string | null, contest: string | null, area: string | null,
 *   whole?: boolean, filled?: number, seats?: Seats,
 *   gain?: string | null, loss?: string | null, departing?: string | null, departingKnown?: boolean,
 *   composition: Seats | null, missing: number | null, total: number | null, control: Control | null,
 * }} TimelineEntry
 */
/**
 * @typedef {{ id: string, name: string, held: boolean }} CouncilLink
 * @typedef {{ id: string, name: string, body: string, generation: string, jurisdiction: string, aldermen: string | null, aldermenOf: string | null, predecessors: CouncilLink[], successors: CouncilLink[], timeline: TimelineEntry[] }} Council
 * @typedef {{ schemaVersion: number, parties: Parties, councils: Council[] }} ControlTable
 */

/** @type {Map<string, Promise<unknown>>} */
const cache = new Map();

/**
 * One table, or null when the extracts (or this table) are not there.
 * @param {'byelections' | 'control'} name
 * @returns {Promise<unknown>}
 */
function table(name) {
  if (!cache.has(name)) {
    cache.set(name, extractsIndex().then((idx) => {
      const tables = /** @type {Record<string, unknown> | undefined} */ (idx?.tables);
      const file = tables?.[name];
      if (typeof file !== 'string') return null;
      return fetch(`${EXTRACTS}${file}`).then((res) => (res.ok ? res.json() : null));
    }).then((j) => {
      if (!j) cache.delete(name); // not there yet: ask again next time
      return j;
    }, (err) => {
      cache.delete(name);
      throw err;
    }));
  }
  return /** @type {Promise<unknown>} */ (cache.get(name));
}

/** The by-election tracker's table, or null. @returns {Promise<ByElectionsTable | null>} */
export const byElectionsTable = () => /** @type {Promise<ByElectionsTable | null>} */ (table('byelections'));
/** Council control's table, or null. @returns {Promise<ControlTable | null>} */
export const controlTable = () => /** @type {Promise<ControlTable | null>} */ (table('control'));

/**
 * Save text as a file (the CSV downloads).
 * @param {string} name @param {string} text
 */
export function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
