/**
 * The results map's state in its URL (R8: one pure function parses it, one writes it; el-maps,
 * 14 Nov 2026). Pure: tests/unit/elections-app-map-modes.test.mjs.
 *
 *   /elections/map/?e=<election>&mode=<mode>&party=<label>&vs=<election>&under=<n>&unit=votes|pct&sort=<column>|-<column>
 *
 *   e      the election (its slug); the view picks a default when it is missing or unknown
 *   mode   winner, turnout, share, swing, margin, spoilt or topper (state-machines.js MAP_MODES)
 *   party  the party of share and swing (a ballot label of the election)
 *   vs     the earlier election of swing
 *   under  the close-contests filter: contests whose margin is under this many
 *   unit   ... votes (the default) or points of the valid poll (pct)
 *   sort   the close-contests list's order: a column (name, votes, pct), descending with a "-"
 *
 * Old links (e, mode, party, vs) read as they did.
 */
import { mapModeOf } from '../state-machines.js';

/** The columns the close-contests list sorts by. */
export const SORT_KEYS = /** @type {const} */ (['name', 'votes', 'pct']);
/** @typedef {typeof SORT_KEYS[number]} SortKey */

/**
 * @typedef {{ e: string | null, mode: import('../state-machines.js').MapMode, party: string | null, vs: string | null,
 *   under: number | null, unit: import('./map-modes.js').MarginUnit, sort: { key: SortKey, dir: 'asc' | 'desc' } }} MapState
 */

/** The list's order when the URL gives none: closest first, in the filter's unit. @param {import('./map-modes.js').MarginUnit} unit */
const defaultSort = (unit) => ({ key: /** @type {SortKey} */ (unit === 'pct' ? 'pct' : 'votes'), dir: /** @type {const} */ ('asc') });

/**
 * The map's state from its query string.
 * @param {URLSearchParams} q
 * @returns {MapState}
 */
export function parseMapState(q) {
  const text = (/** @type {string} */ k) => {
    const v = (q.get(k) || '').trim();
    return v || null;
  };
  const n = Number(q.get('under'));
  const under = q.get('under') !== null && Number.isFinite(n) && n > 0 ? n : null;
  const unit = q.get('unit') === 'pct' ? 'pct' : 'votes';
  const raw = text('sort') || '';
  const key = raw.replace(/^-/, '');
  const sort = /** @type {readonly string[]} */ (SORT_KEYS).includes(key)
    ? { key: /** @type {SortKey} */ (key), dir: /** @type {'asc' | 'desc'} */ (raw.startsWith('-') ? 'desc' : 'asc') }
    : defaultSort(unit);
  return { e: text('e'), mode: mapModeOf(q.get('mode')), party: text('party'), vs: text('vs'), under, unit, sort };
}

/**
 * The query string of a state (no "?"): the election and mode always, the rest only when they say
 * something (a party or vs chosen, kept across modes; the filter when on; a sort that is not the default).
 * @param {MapState} s
 */
export function mapStateQuery(s) {
  /** @type {Array<[string, string]>} */
  const out = [];
  if (s.e) out.push(['e', s.e]);
  out.push(['mode', s.mode]);
  if (s.party) out.push(['party', s.party]);
  if (s.vs) out.push(['vs', s.vs]);
  if (s.under !== null) {
    out.push(['under', String(s.under)]);
    if (s.unit === 'pct') out.push(['unit', 'pct']);
    const d = defaultSort(s.unit);
    if (s.sort.key !== d.key || s.sort.dir !== d.dir) out.push(['sort', `${s.sort.dir === 'desc' ? '-' : ''}${s.sort.key}`]);
  }
  return new URLSearchParams(out).toString();
}
