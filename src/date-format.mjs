/**
 * The one way Civgraph writes a date: a year alone ("1950") or day, short month and year
 * ("01 Jan 1950", "13 Apr 1983"): the day always two digits; no dd/mm/yyyy, no long month names.
 *
 * Accepts what the data holds: ISO dates ("1983-04-13"), years, year-months ("1983-04", shown
 * as "Apr 1983" because the day is not known), dd/mm/yyyy ("04/10/1920") and written dates
 * ("01 April 1969", "1 October 1921"). Anything else comes back unchanged, so a label that is
 * not a date ("1st edition", "1921–1969") is left alone.
 */
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthIndex(name) {
  const n = String(name || '').toLowerCase().replace(/\.$/, '');
  const full = LONG_MONTHS.indexOf(n);
  if (full >= 0) return full;
  const short = n === 'sept' ? 8 : SHORT_MONTHS.findIndex((m) => m.toLowerCase() === n);
  return short;
}

const dayMonthYear = (day, month, year) => `${String(Number(day)).padStart(2, '0')} ${SHORT_MONTHS[month]} ${year}`;

export function formatDisplayDate(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? dayMonthYear(value.getUTCDate(), value.getUTCMonth(), value.getUTCFullYear())
      : '';
  }
  const s = String(value ?? '').trim();
  // A referendum's date carries its question ("2024-03-08-the-family"); the day is what to show.
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*|-[a-z0-9-]+)?$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return dayMonthYear(m[3], Number(m[2]) - 1, m[1]);
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return dayMonthYear(m[1], Number(m[2]) - 1, m[3]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+\.?),?\s+(\d{4})$/.exec(s);
  if (m && monthIndex(m[2]) >= 0) return dayMonthYear(m[1], monthIndex(m[2]), m[3]);
  return s;
}

/** The same rule for dates written inside a longer label ("Cavan — 01 April 1969"). */
export function formatDatesInText(value) {
  return String(value ?? '')
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (all, d, mo, y) => formatDisplayDate(`${d}/${mo}/${y}`))
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]+\.?),?\s+(\d{4})\b/g, (all, d, mo, y) => (
      monthIndex(mo) >= 0 ? dayMonthYear(d, monthIndex(mo), y) : all));
}
