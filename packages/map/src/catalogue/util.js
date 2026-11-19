/** Small helpers shared by the rebuilt catalogue's views. */
import catalogueKinds from '../../../registries/src/browser/catalogue-kinds.mjs';
import providerRegistry from '../../../registries/src/browser/providers.mjs';
import { providerIndex } from './row-model.mjs';
import { formatDisplayDate } from '../../../core/src/date-format.mjs';
import { siteNumber } from '../../../core/src/format.js';
import { MAP_COLOURS } from '../colours.mjs';

/** A row named "Other" or "Other ..." (Planning & Property's "Other"). */
const OTHER_ROW = /^other(?![a-z])/i;

/**
 * Rows named "Other ..." moved to the end, in their order; the rest keep theirs (Phelim Birch's
 * review #18: "Other" stays at the bottom of its shelf, whatever subject it sits in).
 * @template {{ id: string, name?: string }} R
 * @param {R[]} rows
 * @returns {R[]}
 */
export function otherRowsLast(rows) {
  const isOther = (/** @type {R} */ s) => OTHER_ROW.test(String(s.name ?? '').trim());
  return [...rows.filter((s) => !isOther(s)), ...rows.filter(isOther)];
}

/**
 * A flat shelf's rows in order: the shelf's `first` rows at the top (Water: the coast, Phelim
 * Birch's review #70), its `last` rows at the end (Transport: collisions and road defects after
 * every route and network), each in the order the shelf lists them, and the rest as their
 * subjects give them. A row named "Other ..." comes after all of them (otherRowsLast).
 * @template {{ id: string, name?: string }} R
 * @param {R[]} rows
 * @param {{ first?: string[], last?: string[] }} sh
 * @returns {R[]}
 */
export function orderShelfRows(rows, { first = [], last = [] }) {
  const pick = (/** @type {string[]} */ ids) => /** @type {R[]} */ (ids.map((id) => rows.find((s) => s.id === id)).filter(Boolean));
  return otherRowsLast([...pick(first), ...rows.filter((s) => !first.includes(s.id) && !last.includes(s.id)), ...pick(last.filter((id) => !first.includes(id)))]);
}

/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** @param {unknown} s */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

/**
 * @param {number | string} n
 * @param {string} one
 * @param {string} [many]
 */
export const plural = (n, one, many = `${one}s`) => `${siteNumber(Number(n))} ${n === 1 ? one : many}`;

/** "1993-04-01" -> "1 Apr 1993"; a year alone stays a year (packages/core/src/date-format.mjs). */
/** @param {string | number | Date | null | undefined} d */
export const longDate = (d) => formatDisplayDate(d);
/** @param {string | number | Date | null | undefined} d */
export const shortDate = (d) => formatDisplayDate(d);

/**
 * A map's date. One stored as 1 January when only the year is known ("1977-01-01" for the
 * 1977 DEDs) reads as the year; a map named "1 Jan 1919", or in force from that day, keeps
 * its day (UX review 2026-10-31, L4). A snapshot of a live dataset reads "as at <date>".
 * @param {{ date?: string | null, dateAsAt?: unknown, dateEffective?: string | null, id?: string, name?: string, title?: string } | null | undefined} r
 */
export const mapDate = (r) => {
  const raw = String(r?.date ?? '').trim();
  // A live dataset (planning applications) is dated by the snapshot Civgraph holds: "as at 20 Apr
  // 2026" (owner, 11 Nov 2026; maps.json dateKind "as-at").
  if (r?.dateAsAt && raw) return `as at ${formatDisplayDate(raw)}`;
  if (r && /^\d{4}-01-01$/.test(raw) && r.dateEffective !== raw
    && !/\b1 Jan(uary)?\b|-01-01\b/i.test(`${r.id || ''} ${r.name || ''} ${r.title || ''}`)) return raw.slice(0, 4);
  return formatDisplayDate(r?.date);
};

/** @param {unknown} d */
export const yearOf = (d) => {
  const m = /(1[5-9]\d\d|20\d\d)/.exec(String(d || ''));
  return m ? Number(m[1]) : null;
};

/** @param {number[] | null | undefined} years */
export const span = (years) => (!years ? '' : years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`);

/**
 * Text colour that reads on a fill of the given colour.
 * @param {unknown} hex
 */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return MAP_COLOURS.catalogueInkLight;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? MAP_COLOURS.catalogueInkDark : MAP_COLOURS.catalogueInkLight;
}

/**
 * Short names for providers, as a row's credit line shows them; the full name stays in the
 * row's tooltip and the map's details.
 * @type {Record<string, string>}
 */
/** The catalogue's providers, from the providers registry (data/registries/providers.json): a
 * provider string's entry, and each entry's full and short names. */
export const PROVIDERS = providerIndex(/** @type {import('./row-model.mjs').ProviderEntry[]} */ (providerRegistry.providers));
/** A provider's short name ("TÉ", "Birch"), as a row's credit line shows it: the registry's, else the name itself.
 * @param {string | null | undefined} name */
export const shortProvider = (name) => {
  const id = PROVIDERS.idOf.get(String(name || '').trim());
  return (id && PROVIDERS.byId.get(id)?.short) || name;
};

/** Short names for the jurisdictions, as the filters and rows show them. @type {Record<string, string>} */
export const SCOPE_SHORT = { 'Northern Ireland': 'NI', 'Republic of Ireland': 'ROI', Ireland: 'All-island' };
// An election held before partition (3 May 1921) covered the island because the island was
// one jurisdiction: Phelim Birch's "pre-partition" says that, where "all-island" would not.
export const ESCOPE_SHORT = { 'Northern Ireland': 'NI', 'Republic of Ireland': 'ROI', Ireland: 'Pre-partition' };
// What a series draws: areas with edges, places and routes (points and lines), or figures
// mapped onto areas: the kinds the filters offer, with their labels (the catalogue-kinds registry,
// data/registries/catalogue-kinds.json).
export const KINDS = catalogueKinds.filters.map(([kind, label]) => [kind, label]);
