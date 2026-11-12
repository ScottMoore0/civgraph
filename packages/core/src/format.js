/**
 * Text formatting shared by the record pages and every app: numbers, dates, lists, slugs.
 * Pure functions; used by functions/_browse-page.js, packages/ui/src/templates/records/, the map
 * app and the served pages (through /pkg/core/src/format.js). The one place a locale is named
 * (docs/ARCHITECTURE-RULES.md R10).
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

/**
 * A person record's slug, which the Browse build gives each person (scripts/build/
 * build-browse-indexes.mjs): a URL a reader can recognise that still resolves uniquely. The name
 * alone is not enough, because the registry keeps distinct people who share a name apart, so the
 * readable part carries the name and the registry id keeps it unique: "naomi-long-51102". A
 * candidacy no registry id was found for has the id "name:<slug>", one per name by construction,
 * so its name alone is unique and no suffix is added.
 * @param {unknown} personId
 * @param {unknown} name
 * @returns {string}
 */
export function personSlug(personId, name) {
  const id = String(personId || '');
  const readable = slugify(name);
  if (id.startsWith('name:')) return readable || slugify(id);
  return readable ? `${readable}-${slugify(id)}` : slugify(id);
}

/**
 * What a link to a person's page names: the person's own slug where the row carries it (a
 * candidacy's personSlug, read from person_cards), which the page answers directly; else, given
 * a name, the slug the name and id make (personSlug: right unless the candidacy spells the
 * name differently from the record, when the page still finds the person by the id and answers
 * a 301); else the id (always a 301 to the slug). The in-app Browse links give no name: its API
 * finds a record by slug or id, not by a misspelt slug. '' for a row with no person.
 * @param {{ personSlug?: unknown, personId?: unknown, name?: unknown }} person
 * @returns {string}
 */
export function personRecordKey({ personSlug: slug, personId, name } = {}) {
  if (slug) return String(slug);
  if (personId === null || personId === undefined || personId === '') return '';
  return name ? personSlug(personId, name) : String(personId);
}

/**
 * The address of a person's page, /browse/persons/<slug> (personRecordKey), or null for a row
 * with no person.
 * @param {{ personSlug?: unknown, personId?: unknown, name?: unknown }} person
 * @returns {string | null}
 */
export function personRecordPath(person) {
  const key = personRecordKey(person);
  return key ? `/browse/persons/${encodeURIComponent(key)}` : null;
}

/**
 * The locale every number and date on the site is written in. The interface languages (Irish,
 * Ulster-Scots: site/assets/i18n/i18n.js) translate the English the page renders, dates
 * included, so the formatter writes English and nothing else names a locale (R10, check C10).
 */
const LOCALE = 'en-GB';

/** @type {Map<string, Intl.NumberFormat>} one formatter per set of options, made once */
const numberFormats = new Map();

/**
 * A number as the site writes it: siteNumber(1234) "1,234", siteNumber(0.5, { style:
 * 'percent' }) "50%". The same as `value.toLocaleString(<the site locale>, options)` for a number.
 * @param {number | bigint} value
 * @param {Intl.NumberFormatOptions} [options]
 * @returns {string}
 */
export function siteNumber(value, options) {
  const key = options ? JSON.stringify(options) : '';
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/**
 * A date as the site writes it with Intl: the same as `date.toLocaleDateString(<the site
 * locale>, options)` when options name the parts to show. For "01 Apr 1969" from a date string,
 * use formatDisplayDate (./date-format.mjs).
 * @param {Date | number} date
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function siteDate(date, options) {
  // As toLocaleDateString: an invalid date reads "Invalid Date" (Intl would throw).
  if (Number.isNaN(Number(date))) return 'Invalid Date';
  return new Intl.DateTimeFormat(LOCALE, options).format(date);
}

/** "1,234" (the site's grouping), or '' for null, '' and anything not a finite number. */
export const numberText = (/** @type {string | number | null | undefined} */ value) => {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? siteNumber(number) : '';
};

/** The English month names, January to December: the formatter's own table. */
export const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const MONTHS = MONTH_NAMES;

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
