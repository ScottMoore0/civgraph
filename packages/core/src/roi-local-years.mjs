/**
 * Republic of Ireland local election years whose councils polled on different days.
 *
 * In 1928, 1934, 1955 and 1960 the county and city councils did not all poll on one day. Each
 * council's contests are filed under its own poll date (data/elections-source/data/elections/
 * ireland-local/<YYYY-MM-DD>/), as by-elections and every other round are filed by poll date
 * (owner, 13 Nov 2026, OT28). The year's dates are listed as one election year: the year entry
 * `roi-local__1955`, "1955 Irish local elections", holds the year's rounds, and each round keeps
 * its own key and address (ireland-local__1955-06-23 and so on).
 *
 * The years of one polling day (1942, 1945, 1950, 1967, and from 1974) are a single round and are
 * not grouped. No DOM, no Node APIs.
 */

/** The years whose councils polled on different days. */
export const ROI_STAGGERED_LOCAL_YEARS = Object.freeze([1928, 1934, 1955, 1960]);

export const ROI_LOCAL_BODY_SLUG = 'ireland-local';
export const ROI_LOCAL_YEAR_PREFIX = 'roi-local__';

/**
 * @typedef {{ key?: string, bodySlug?: string, date?: string, body?: string, [field: string]: unknown }} RoiLocalRound
 */

/**
 * Whether a year's councils polled on different days.
 * @param {string | number} year
 */
export function isRoiStaggeredLocalYear(year) {
  return ROI_STAGGERED_LOCAL_YEARS.includes(Number(String(year).slice(0, 4)));
}

/**
 * Whether an election entry is one council date of a staggered year (an ireland-local round
 * filed under its own poll date in 1928, 1934, 1955 or 1960).
 * @param {RoiLocalRound | null | undefined} entry
 */
export function isRoiStaggeredRound(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.bodySlug !== ROI_LOCAL_BODY_SLUG) return false;
  const date = String(entry.date || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && isRoiStaggeredLocalYear(date);
}

/**
 * The year entry's key: `roi-local__1955`.
 * @param {string | number} year
 */
export function roiLocalYearKey(year) {
  return `${ROI_LOCAL_YEAR_PREFIX}${String(year).slice(0, 4)}`;
}

/**
 * The year entry's title: "1955 Irish local elections".
 * @param {string | number} year
 */
export function roiLocalYearTitle(year) {
  return `${String(year).slice(0, 4)} Irish local elections`;
}

/**
 * A staggered year's rounds: Map(year -> rounds sorted by date then body).
 * @template {RoiLocalRound} E
 * @param {E[] | null} [entries]
 * @returns {Map<number, E[]>}
 */
export function groupRoiStaggeredRounds(entries = []) {
  /** @type {Map<number, E[]>} */
  const byYear = new Map();
  for (const entry of entries || []) {
    if (!isRoiStaggeredRound(entry)) continue;
    const year = Number(String(entry.date).slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, []);
    /** @type {E[]} */ (byYear.get(year)).push(entry);
  }
  for (const rounds of byYear.values()) {
    rounds.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.body || '').localeCompare(String(b.body || '')));
  }
  return new Map([...byYear.entries()].sort((a, b) => a[0] - b[0]));
}

/**
 * The entry that stands for a staggered year in an election list.
 * @param {string | number} year
 * @param {RoiLocalRound[]} [rounds]
 */
export function buildRoiLocalYearEntry(year, rounds = []) {
  const dates = [...new Set(rounds.map((round) => String(round.date || '')).filter(Boolean))].sort();
  return {
    key: roiLocalYearKey(year),
    body: 'Irish local elections',
    bodySlug: ROI_LOCAL_BODY_SLUG,
    date: String(year).slice(0, 4),
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    dates,
    year: Number(String(year).slice(0, 4)),
    roiLocalYear: true,
    kind: 'general',
    isByElection: false,
    contestType: 'election',
    displayTitle: roiLocalYearTitle(year),
    displaySubtitle: `${dates.length} polling day${dates.length === 1 ? '' : 's'}`,
    roundKeys: rounds.map((round) => String(round.key || '')),
  };
}

/**
 * An election list with each staggered year's council dates replaced by the year's entry, placed
 * where the year's first date was. Everything else keeps its place.
 * @template {RoiLocalRound} E
 * @param {E[] | null} [entries]
 * @returns {Array<E | ReturnType<typeof buildRoiLocalYearEntry>>}
 */
export function replaceRoiStaggeredRoundsWithYears(entries = []) {
  const groups = groupRoiStaggeredRounds(entries);
  const placed = new Set();
  /** @type {Array<E | ReturnType<typeof buildRoiLocalYearEntry>>} */
  const out = [];
  for (const entry of entries || []) {
    if (!isRoiStaggeredRound(entry)) {
      out.push(entry);
      continue;
    }
    const year = Number(String(entry.date).slice(0, 4));
    if (placed.has(year)) continue;
    placed.add(year);
    out.push(buildRoiLocalYearEntry(year, groups.get(year) || []));
  }
  return out;
}
