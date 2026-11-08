/**
 * Text formatting shared by the record pages: numbers, dates, lists, slugs.
 * Pure functions; used by functions/_browse-page.js and functions/_templates/records/.
 */

/**
 * The same slug rule as browse.js and scripts/build/build-browse-indexes.mjs.
 * @param {unknown} value
 * @returns {string}
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

/** "1,234" (en-GB grouping), or '' for null, '' and anything not a finite number. */
export const numberText = (/** @type {string | number | null | undefined} */ value) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? new Intl.NumberFormat('en-GB').format(number) : '';
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "29 November 2024"; a year or year-month is shown as far as it goes.
 * @param {string | number | null | undefined} value  an ISO date, year-month or year
 * @returns {string}
 */
export function dateText(value) {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(String(value || ''));
  if (!match) return String(value || '');
  const [, year, month, day] = match;
  if (!month) return year;
  const monthName = MONTHS[Number(month) - 1] || month;
  return day ? `${Number(day)} ${monthName} ${year}` : `${monthName} ${year}`;
}

/**
 * "a, b, c and 2 more", de-duplicated.
 * @param {readonly (string | null | undefined)[] | null | undefined} values
 * @param {number} [max]
 * @returns {string}
 */
export function listText(values, max = 4) {
  const items = [...new Set((values || []).filter(Boolean))];
  if (!items.length) return '';
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/**
 * "1983-2016", "1983", or "".
 * @param {string | number | null | undefined} first
 * @param {string | number | null | undefined} last
 * @returns {string}
 */
export function yearSpan(first, last) {
  if (!first && !last) return '';
  if (!first || !last || first === last) return String(first || last);
  return `${first}–${last}`;
}

/** "71.1%" for a share already in percent. */
export const percentText = (/** @type {string | number | null | undefined} */ value, digits = 1) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? `${number.toFixed(digits)}%` : '';
};

/**
 * Only http(s) and site-relative URLs reach an href; anything else (javascript:, data:) is dropped.
 * @param {unknown} value
 * @returns {string}
 */
export function safeUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//'))) return url;
  return '';
}
