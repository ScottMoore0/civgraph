// @ts-check
/**
 * The /maps catalogue's route and tab (refactor plan section 11; state-machine catalogue MA-13).
 *
 * The catalogue shows one of three tabs, and its address (routeString, applyRoute) names one of
 * seven kinds of place in them. The address, a tab click, the search and a place picked on the
 * map may each go from any of them to any other, so the tab is a choice: CatalogueNext's `tab`
 * keeps its plain string and every write goes through TAB.check. The route kinds are listed with
 * the tab each belongs to; routeKind says which a route string is.
 *
 * The catalogue's medium risk is kept: an elections/person/<id> route whose people index is
 * still loading sets the person once it arrives, even if the reader has moved on.
 */
import { defineChoice } from '../state-helpers.mjs';

export const CATALOGUE_TAB = defineChoice('catalogue tab', ['maps', 'elections', 'books']);

/** Each kind of route, and the tab it opens. */
export const ROUTE_KINDS = Object.freeze({
  section: 'maps',
  series: 'maps',
  subject: 'maps',
  here: 'maps',
  elections: 'elections',
  'elections-person': 'elections',
  books: 'books'
});

/**
 * The kind of a route string as routeString writes it (an unknown first part is a section, as
 * applyRoute falls back to the maps tab).
 * @param {string} route
 * @returns {keyof typeof ROUTE_KINDS}
 */
export function routeKind(route) {
  const [view, a, b] = String(route || 'maps').split('/');
  if (view === 'series' || view === 'subject' || view === 'books' || view === 'here') return view;
  if (view === 'elections') return a === 'person' && b ? 'elections-person' : 'elections';
  return 'section';
}
