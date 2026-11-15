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
 * The kind a poll of a contest type other than an election is listed under: the kind whose
 * contestTypes names it (a recall petition is listed with the by-elections); null when no kind
 * names it (a referendum, and an election, whose kind is its own: general or by-election).
 * @param {ElectionTypesRegistry} registry
 * @param {unknown} contestType  the poll's contestType ('referendum', 'recall-petition')
 * @returns {string | null}
 */
export function kindOfContestType(registry, contestType) {
  const type = String(contestType ?? '');
  return Object.entries(registry.electionKinds).find(([, kind]) => kind.contestTypes?.includes(type))?.[0] ?? null;
}

/**
 * Every contest type other than an election that some kind lists (the recall petition, the
 * Union's roll of members), in registry order: the contest types a bundle may carry besides
 * 'election' and 'referendum'.
 * @param {ElectionTypesRegistry} registry
 * @returns {string[]}
 */
export function kindContestTypes(registry) {
  return Object.values(registry.electionKinds).flatMap((kind) => kind.contestTypes || []);
}

/**
 * Errors the schema cannot state: a contest type two kinds both name (ids are unique as object keys).
 * @param {ElectionTypesRegistry} registry
 * @returns {string[]}
 */
export function checkElectionTypes(registry) {
  /** @type {string[]} */
  const errors = [];
  const seen = new Map();
  for (const [id, kind] of Object.entries(registry.electionKinds)) {
    for (const type of kind.contestTypes || []) {
      if (seen.has(type)) errors.push(`electionKinds: ${type} is listed under ${seen.get(type)} and ${id}`);
      seen.set(type, id);
    }
  }
  return errors;
}

/**
 * The browser's slice: each voting system's name (where it has one), each kind's list label, and the
 * voting systems whose count transfers votes (the swingometer's caveat beside its seat estimate).
 * @param {ElectionTypesRegistry} registry
 * @returns {{ votingSystemNames: Record<string, string>, electionKindLabels: Record<string, string>, votingSystemsWithTransfers: string[] }}
 */
export function browserElectionTypes(registry) {
  return {
    votingSystemNames: Object.fromEntries(Object.entries(registry.votingSystems).filter(([, system]) => system.name).map(([id, system]) => [id, /** @type {string} */ (system.name)])),
    electionKindLabels: Object.fromEntries(Object.entries(registry.electionKinds).map(([id, kind]) => [id, kind.listLabel])),
    votingSystemsWithTransfers: Object.entries(registry.votingSystems).filter(([, system]) => system.transfers === true).map(([id]) => id),
  };
}
