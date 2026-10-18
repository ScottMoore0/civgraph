/** Small helpers shared by the rebuilt catalogue's views. */
import { formatDisplayDate } from '../date-format.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** "1993-04-01" -> "1 Apr 1993"; a year alone stays a year (src/date-format.mjs). */
export const longDate = (d) => formatDisplayDate(d);
export const shortDate = (d) => formatDisplayDate(d);

export const yearOf = (d) => {
  const m = /(1[5-9]\d\d|20\d\d)/.exec(String(d || ''));
  return m ? Number(m[1]) : null;
};

export const span = (years) => (!years ? '' : years[0] === years[1] ? String(years[0]) : `${years[0]}–${years[1]}`);

/** Text colour that reads on a fill of the given colour. */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1a202c' : '#fff';
}

/** Short names for the jurisdictions, as the filters and rows show them. */
export const SCOPE_SHORT = { 'Northern Ireland': 'NI', 'Republic of Ireland': 'ROI', Ireland: 'All-island' };
// An election held before partition (3 May 1921) covered the island because the island was
// one jurisdiction: Phelim Birch's "pre-partition" says that, where "all-island" would not.
export const ESCOPE_SHORT = { 'Northern Ireland': 'NI', 'Republic of Ireland': 'ROI', Ireland: 'Pre-partition' };
// What a series draws: areas with edges, places and routes (points and lines), or figures
// mapped onto areas.
export const KINDS = [['Boundary', 'Boundaries'], ['Places', 'Places & routes'], ['Statistics', 'Statistics']];
