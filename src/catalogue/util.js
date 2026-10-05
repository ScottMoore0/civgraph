/** Small helpers shared by the rebuilt catalogue's views. */

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-GB')} ${n === 1 ? one : many}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "1993-04-01" -> "1 April 1993"; a year alone stays a year. */
export function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(d || '');
}

/** "1993-04-01" -> "1 Apr 1993". */
export function shortDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}` : String(d || '');
}

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
export const SCOPE_SHORT = { 'Northern Ireland': 'NI', 'Republic of Ireland': 'ROI', Ireland: 'Ireland' };
