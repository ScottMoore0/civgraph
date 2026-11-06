/**
 * Text formatting shared by the record pages: numbers, dates, lists, slugs.
 * Pure functions; used by functions/_browse-page.js and functions/_templates/records/.
 */

/** The same slug rule as browse.js and scripts/build-browse-indexes.mjs. */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

export const numberText = (value) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? new Intl.NumberFormat('en-GB').format(number) : '';
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "29 November 2024"; a year or year-month is shown as far as it goes. */
export function dateText(value) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(value || ''));
  if (!match) return String(value || '');
  const [, year, month, day] = match;
  if (!month) return year;
  const monthName = MONTHS[Number(month) - 1] || month;
  return day ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/** "a, b, c and 2 more", de-duplicated. */
export function listText(values, max = 4) {
  const items = [...new Set((values || []).filter(Boolean))];
  if (!items.length) return '';
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/** "1983-2016", "1983", or "". */
export function yearSpan(first, last) {
  if (!first && !last) return '';
  if (!first || !last || first === last) return String(first || last);
  return `${first}–${last}`;
}

/** "71.1%" for a share already in percent. */
export const percentText = (value, digits = 1) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? `${number.toFixed(digits)}%` : '';
};

/** Only http(s) and site-relative URLs reach an href; anything else (javascript:, data:) is dropped. */
export function safeUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) return url;
  return '';
}
