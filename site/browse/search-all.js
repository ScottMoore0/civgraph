/**
 * Browse's search across every record type: what the index page (/browse/, /records/,
 * /catalogue/) shows when a reader types before choosing a section (owner, 13 Nov 2026; it used
 * to ask them to choose a section first).
 *
 * Each section is searched as its own page searches it (browse.js searchSection), and this module
 * turns those answers into the page's groups: the sections in their order, the first few matches
 * of each, its count, and the address of the section's own search, which lists them all. Pure,
 * so tests/unit/browse-search-all.test.mjs holds it.
 */

/** How many matches a section shows here; the rest are on its own search. */
export const SEARCH_ALL_SHOWN = 5;

/**
 * One section's answer. `total` is the number of matches, or null when the section's search
 * reports only a page (PRONI's), and `more` says that page was full.
 * @typedef {{ type: string, label: string, items: Record<string, unknown>[], total: number | null, more?: boolean, failed?: boolean }} SectionAnswer
 */

/**
 * A section as the page shows it.
 * @typedef {{ type: string, label: string, items: Record<string, unknown>[], count: string, href: string, seeAll: string | null, failed: boolean }} SearchAllGroup
 */

/**
 * The address of a section's own search for `query`: the section's list, filtered by it.
 * @param {string} type
 * @param {string} query
 */
export function sectionSearchHref(type, query) {
  return `#/${type}?${new URLSearchParams({ q: query })}`;
}

/**
 * @param {number} n
 * @param {(n: number) => string} format
 */
const matches = (n, format) => `${format(n)} ${n === 1 ? 'match' : 'matches'}`;

/**
 * The page's groups, in the order the answers are given (the section's order). A section with
 * no match is left out of `groups` and named in `empty`, so the reader sees where nothing was
 * found without a heading for each.
 * @param {string} query
 * @param {SectionAnswer[]} answers
 * @param {{ shown?: number, format?: (n: number) => string }} [options]
 * @returns {{ groups: SearchAllGroup[], empty: string[], failed: string[], total: number, atLeast: boolean }}
 */
export function summariseSearchAll(query, answers, { shown = SEARCH_ALL_SHOWN, format = String } = {}) {
  /** @type {SearchAllGroup[]} */
  const groups = [];
  /** @type {string[]} */
  const empty = [];
  /** @type {string[]} */
  const failed = [];
  let total = 0;
  let atLeast = false;
  for (const answer of answers) {
    if (answer.failed) {
      failed.push(answer.label);
      continue;
    }
    const found = answer.total ?? answer.items.length;
    if (!found) {
      empty.push(answer.label);
      continue;
    }
    const more = answer.total === null ? Boolean(answer.more) || answer.items.length > shown : found > shown;
    const count = answer.total === null && more ? `More than ${matches(Math.min(answer.items.length, shown), format)}` : matches(found, format);
    total += found;
    if (answer.total === null && more) atLeast = true;
    groups.push({
      type: answer.type,
      label: answer.label,
      items: answer.items.slice(0, shown),
      count,
      href: sectionSearchHref(answer.type, query),
      seeAll: more ? `See all in ${answer.label}` : null,
      failed: false,
    });
  }
  return { groups, empty, failed, total, atLeast };
}

/**
 * The sentence a screen reader hears when the results arrive.
 * @param {string} query
 * @param {{ groups: SearchAllGroup[], total: number, atLeast: boolean }} summary
 * @param {(n: number) => string} [format]
 */
export function searchAllAnnouncement(query, summary, format = String) {
  if (!summary.groups.length) return `No matches for ${query} in any section.`;
  const sections = summary.groups.length;
  return `${summary.atLeast ? 'At least ' : ''}${matches(summary.total, format)} for ${query} in ${format(sections)} ${sections === 1 ? 'section' : 'sections'}.`;
}
