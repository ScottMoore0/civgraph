// The election-groups slice's lists as named exports, each with the function that places a value in
// it (body-groups.mjs), for the map app and the served pages that import it from /pkg/
// (site/apps/elections/views/home.js): a page reaches a package module through a site/pkg/ shim,
// which is `export *` and so carries no default export (tests/unit/served-pkg.test.mjs).
import electionGroups from './election-groups.mjs';
import { groupLabel } from './body-groups.mjs';

/** The Elections home page's groups, in display order. @type {readonly string[]} */
export const ELECTIONS_HOME_ORDER = Object.freeze([...electionGroups.electionsHome.order]);

/**
 * The Elections home page's group of a body.
 * @param {string} slug
 * @returns {string}
 */
export function electionsHomeGroup(slug) {
  return groupLabel(electionGroups.electionsHome, slug);
}

/** The groups of a person's or party's election history, in display order. @type {readonly string[]} */
export const ENTITY_HISTORY_ORDER = Object.freeze([...electionGroups.entityHistory.order]);

/**
 * The election-history group of an election type (the map app's electionTypeFromEntityKey).
 * @param {unknown} electionType
 * @returns {string}
 */
export function entityHistoryGroup(electionType) {
  return groupLabel(electionGroups.entityHistory, electionType);
}
