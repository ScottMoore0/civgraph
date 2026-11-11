/**
 * Formatting and small shared helpers of the Elections app. Pure (no DOM): tests/unit/elections-app-lib.test.mjs.
 */

/** HTML-escape a value for text or an attribute. @param {unknown} value */
export function esc(value) {
  /** @type {Record<string, string>} */
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

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

/** "5 May 2022" from "2022-05-05". */
/** @param {unknown} iso */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** URL slug of a name (accents dropped, lowercase, hyphens). */
/** @param {unknown} value */
export function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

/** A party colour from the records, or a neutral grey. */
export const partyColour = (/** @type {unknown} */ colour) => (/^#[0-9a-f]{3,8}$/i.test(String(colour || '')) ? String(colour) : '#8a8f98');

/** A party chip (the shared .cg-party component) as HTML. */
/** @param {unknown} name @param {unknown} colour */
export function partyChip(name, colour) {
  return `<span class="cg-party"><span class="cg-party__swatch" style="--party-colour:${esc(partyColour(colour))}" aria-hidden="true"></span>${esc(name || 'No party recorded')}</span>`;
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
 * Whether a contest was returned unopposed: no votes recorded and either an "unopposed"
 * status, no more candidates than seats, or an uncontested election.
 * @param {{ candidates: Array<{ status?: string, firstPrefs?: number | null }>, seats?: number | null, contestStatus?: string | null }} c
 */
export function isUnopposed({ candidates, seats, contestStatus }) {
  if (!candidates?.length) return false;
  if (candidates.some((c) => num(c.firstPrefs) !== null)) return false;
  if (candidates.some((c) => /unopposed/i.test(String(c.status || '')))) return true;
  if (num(seats) !== null && candidates.length <= Number(seats)) return true;
  return contestStatus === 'uncontested';
}

/**
 * A contest in a summary's results list returned unopposed (no votes; candidates <= seats).
 * @param {{ validPoll?: number | null, leadingVotes?: number | null, candidateCount?: number, seatsTotal?: number }} r
 */
export function summaryUnopposed(r) {
  return !summaryHasVotes(r)
    && num(r.candidateCount) !== null && num(r.seatsTotal) !== null && Number(r.candidateCount) <= Number(r.seatsTotal);
}

/**
 * Whether a summary row records votes. The summaries write 0 (not null) for a contest without a
 * poll, so zero counts as none: no contest with a poll has 0 valid votes.
 * @param {{ validPoll?: number | null, leadingVotes?: number | null }} r
 */
export const summaryHasVotes = (r) => (num(r.validPoll) || 0) > 0 || (num(r.leadingVotes) || 0) > 0;

/** A positive figure or null (the summaries' 0 for "not recorded": turnout, quota, majority). */
export const positive = (/** @type {unknown} */ v) => ((num(v) || 0) > 0 ? Number(v) : null);
