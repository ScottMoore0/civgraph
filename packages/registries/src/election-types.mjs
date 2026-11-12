/**
 * The election-types registry (data/registries/election-types.json, REG-2): the voting systems and
 * the kinds of election, with the words the site shows for them. Pure: the views take the loaded
 * value, so the browser slice (packages/registries/src/browser/election-types.json) is computed by
 * the same functions.
 */

/** @typedef {import('../../types/index.js').ElectionTypesRegistry} ElectionTypesRegistry */

/**
 * The voting system ids, in registry order.
 * @param {ElectionTypesRegistry} registry
 * @returns {string[]}
 */
export function votingSystemIds(registry) {
  return Object.keys(registry.votingSystems);
}

/**
 * The kinds of election (general, by-election), in registry order.
 * @param {ElectionTypesRegistry} registry
 * @returns {string[]}
 */
export function electionKindIds(registry) {
  return Object.keys(registry.electionKinds);
}

/**
 * Errors the schema cannot state: none yet (ids are unique as object keys). Kept so the registry
 * has the same shape as the others.
 * @param {ElectionTypesRegistry} _registry
 * @returns {string[]}
 */
export function checkElectionTypes(_registry) {
  return [];
}

/**
 * The browser's slice: each voting system's name (where it has one) and each kind's list label.
 * @param {ElectionTypesRegistry} registry
 * @returns {{ votingSystemNames: Record<string, string>, electionKindLabels: Record<string, string> }}
 */
export function browserElectionTypes(registry) {
  return {
    votingSystemNames: Object.fromEntries(Object.entries(registry.votingSystems).filter(([, system]) => system.name).map(([id, system]) => [id, /** @type {string} */ (system.name)])),
    electionKindLabels: Object.fromEntries(Object.entries(registry.electionKinds).map(([id, kind]) => [id, kind.listLabel])),
  };
}
