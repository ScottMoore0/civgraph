/**
 * The grouped years in the map's election catalogue: the pre-1973 Northern Ireland (and, before
 * 1921, Irish) council rounds listed as one entry a year (packages/map/src/ni-local-groups.mjs). This is how
 * the election manager adds those entries, hides the rounds they stand for from the lists, finds a
 * year by an older name or layer id, runs the timeline through the years, and carries the year
 * view's settings from one year to the next and from an address. Opening a year is
 * packages/map/src/election/grouped-year-methods.js; drawing it is packages/map/app/ni-local-view.js.
 *
 * Moved out of packages/map/app/election-manager.js (frontend plan section 5.1) without changing
 * behaviour. Pure: no DOM, no network.
 */
import {
  LOCAL_GROUP_BODIES,
  buildNiLocalGroupEntry,
  groupNiLocalRounds,
  isNiLocalCouncilRound
} from '../ni-local-groups.mjs';

/** @typedef {import('../../../core/src/election-view-model.mjs').ElectionRecord} ElectionRecord */

/**
 * Add a year entry for each year of council rounds to the catalogue's election list (once: a
 * list that already has them is left alone). The rounds stay in the catalogue, so their own
 * addresses and the links to them still open them; the lists show the year instead.
 * @param {{ elections?: ElectionRecord[] } | null | undefined} catalogue
 */
export function addGroupedYears(catalogue) {
  const elections = catalogue?.elections;
  if (!Array.isArray(elections) || elections.some((entry) => entry.niLocalGroup)) return;
  const groups = groupNiLocalRounds(elections);
  for (const [year, rounds] of groups) {
    elections.push({
      ...buildNiLocalGroupEntry(year, rounds),
      loadable: true,
      resultsOnly: false,
      placeholder: false,
      sourceMapId: null,
      stylingModes: []
    });
  }
}

/**
 * The elections a list shows: everything but the council rounds a year entry stands for.
 * @template {ElectionRecord} E
 * @param {E[]} [elections]
 */
export function listedElections(elections = []) {
  return elections.filter((entry) => !isNiLocalCouncilRound(entry));
}

/**
 * A council year by a name it no longer has: before 1921 the year is "Irish local elections",
 * which an address may still call "Northern Ireland local elections". Null for anything else.
 * @template {ElectionRecord} E
 * @param {E[]} elections
 * @param {string} body
 * @param {unknown} date
 * @returns {E | null}
 */
export function findGroupedYear(elections = [], body, date) {
  if (LOCAL_GROUP_BODIES.includes(body) && /^\d{4}$/.test(String(date || ''))) {
    return elections.find((entry) => entry.niLocalGroup && entry.date === String(date)) || null;
  }
  return null;
}

/**
 * election-northern-ireland-local-elections-1911 (a pre-1921 year by its earlier name): the body and year to look up.
 * @param {unknown} layerId
 */
export function groupedYearForLayerId(layerId) {
  const year = String(layerId).match(/^election-northern-ireland-local-elections-(\d{4})$/)?.[1];
  return year ? { body: LOCAL_GROUP_BODIES[1], date: year } : null;
}

/**
 * Whether `entry` is a stop on the open election's timeline: the council years run as one series, the island's (before 1921) into Northern Ireland's.
 * @param {ElectionRecord} entry
 * @param {ElectionRecord} activeEntry
 */
export function inTimelineSeries(entry, activeEntry) {
  return activeEntry.niLocalGroup
    ? Boolean(entry.niLocalGroup)
    : entry.body === activeEntry.body;
}

/**
 * Stepping from one year to the next keeps the level, votes or seats, and members of an open year view.
 * @param {{ active?: boolean, level?: unknown, show?: unknown, members?: unknown } | null | undefined} view
 */
export function keptGroupedYearView(view) {
  return view?.active ? { level: view.level, show: view.show, members: view.members } : {};
}

/**
 * A year view's settings as an address gives them.
 * @param {URLSearchParams} params
 */
export function groupedYearOptionsFromParams(params) {
  return {
    level: params.get('electionLevel'),
    show: params.get('electionShow'),
    members: params.get('electionMembers'),
    area: params.get('electionArea')
  };
}
