/**
 * Formatting and small shared helpers of the Elections app. Pure (no DOM): tests/unit/elections-app-lib.test.mjs.
 *
 * Escaping, dates and slugs are the packages' own (packages/core, served at /pkg/ through
 * packages/served.json; the imports resolve to site/pkg/ in Node and tsc): the app keeps no copy.
 */
import { escapeHtml } from '../../../pkg/core/src/html.js';
import { formatDisplayDate } from '../../../pkg/core/src/date-format.mjs';
import { slugify } from '../../../pkg/core/src/format.js';
import { POLL_STATUS_TEXT, contestPollStatus, summaryPollStatus } from '../../../pkg/core/src/unopposed.mjs';

/** HTML-escape a value for text or an attribute (packages/core/src/html.js). */
export const esc = escapeHtml;
/** A date the one way Civgraph writes one: "05 May 2022" from "2022-05-05" (packages/core/src/date-format.mjs). */
export const fmtDate = (/** @type {unknown} */ iso) => formatDisplayDate(/** @type {string | null | undefined} */ (iso ?? ''));
/** URL slug of a name, the same rule as Browse's (packages/core/src/format.js). */
export { slugify };

/** A finite number or null. @param {unknown} value @returns {number | null} */
export function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A whole or fractional count with thousands separators; "—" when missing. */
/** @param {unknown} value */
export function fmtInt(value) {
  const n = num(value);
  if (n === null) return '—';
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  return n.toLocaleString('en-GB', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A percentage to one decimal place; "—" when missing. */
/** @param {unknown} value @param {number} [digits] */
export function fmtPct(value, digits = 1) {
  const n = num(value);
  return n === null ? '—' : `${n.toFixed(digits)}%`;
}

/** A signed change ("+3", "−1.2", "0"), with the Unicode minus. */
/** @param {unknown} value @param {number} [digits] */
export function fmtDelta(value, digits = 0) {
  const n = num(value);
  if (n === null) return '';
  const r = Number(n.toFixed(digits));
  if (r === 0) return digits ? (0).toFixed(digits) : '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)}`;
}

/** The Browse URL of a person record from a candidacy's name and person id. */
/** @param {unknown} name @param {string | number | null | undefined} personId */
export function personUrl(name, personId) {
  if (!personId) return null;
  return `/browse/persons/${slugify(name)}-${encodeURIComponent(personId)}`;
}

/** An election's URL slug from its key ("body__2022-05-05" -> "body-2022-05-05"). */
export const electionSlug = (/** @type {unknown} */ key) => String(key || '').replace(/__/g, '-');

/** The app's URL of an election, a contest, or a view. */
export const appUrl = {
  home: () => '/elections/',
  body: (/** @type {string} */ bodySlug) => `/elections/body/${encodeURIComponent(bodySlug)}/`,
  election: (/** @type {string} */ key) => `/elections/${encodeURIComponent(electionSlug(key))}/`,
  contest: (/** @type {string} */ key, /** @type {string} */ contestSlug) => `/elections/${encodeURIComponent(electionSlug(key))}/${encodeURIComponent(contestSlug)}/`,
};

/** The voting system in words. */
/** @param {string | null | undefined} system */
export function systemName(system) {
  /** @type {Record<string, string>} */
  const names = {
    fptp: 'first past the post', 'stv-hare': 'single transferable vote', 'stv-gregory': 'single transferable vote (Gregory method)',
    'party-list-dhondt': "party list (D'Hondt)", ordinal: 'referendum',
  };
  return names[String(system)] || system || 'unknown system';
}

export const isStv = (/** @type {unknown} */ system) => /^stv/.test(String(system || ''));

/** A readable text colour (black or white) on a background hex colour. */
/** @param {unknown} hex */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#000';
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}

/** Median of numbers (null for none). */
/** @param {unknown[]} values */
export function median(values) {
  const xs = values.filter((v) => num(v) !== null).map(Number).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Whether a contest went to a poll: one rule, packages/core/src/unopposed.mjs (served at /pkg/),
 * for the whole app. A contest without votes is "unopposed" only when the records say so; a
 * contest whose votes are missing is "votes not recorded" (POLL_STATUS_TEXT), never unopposed.
 *   contestPollStatus(result)   from a contest's candidates (the count sheet)
 *   summaryPollStatus(row)      from a row of an election summary (the overview, the maps)
 */
export { POLL_STATUS_TEXT, contestPollStatus, summaryPollStatus };

/** A positive figure or null (the summaries' 0 for "not recorded": turnout, quota, majority). */
export const positive = (/** @type {unknown} */ v) => ((num(v) || 0) > 0 ? Number(v) : null);
