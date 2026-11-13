/**
 * The source-kinds registry (data/registries/source-kinds.json): the kinds of source an election
 * result is cited from (a contest file's source.kind, a citation's kind), each with the label a
 * contest's Sources panel shows. Pure.
 */

/** @typedef {import('../../types/index.js').SourceKindsRegistry} SourceKindsRegistry */

/**
 * Checks a schema cannot state: an id given twice.
 * @param {SourceKindsRegistry} registry
 * @returns {string[]}
 */
export function checkSourceKinds(registry) {
  /** @type {string[]} */
  const errors = [];
  const ids = registry.kinds.map((kind) => kind.id);
  for (const id of new Set(ids)) if (ids.filter((v) => v === id).length > 1) errors.push(`kinds: id ${id} is given twice`);
  return errors;
}

/**
 * The kinds' ids: the values a contest file's source.kind may take.
 * @param {SourceKindsRegistry} registry
 * @returns {string[]}
 */
export function sourceKindIds(registry) {
  return registry.kinds.map((kind) => kind.id);
}

/**
 * The browser's slice: kind id -> its label (empty for a kind shown without one).
 * @param {SourceKindsRegistry} registry
 * @returns {{ labels: Record<string, string> }}
 */
export function browserSourceKinds(registry) {
  return { labels: Object.fromEntries(registry.kinds.map((kind) => [kind.id, kind.label])) };
}

/**
 * The kinds a list of citations uses that the registry does not hold, each with how many citations
 * use it (sorted by kind). A citation with no kind (null) is not a kind and is skipped.
 * @param {SourceKindsRegistry} registry
 * @param {Iterable<{ kind?: string | null }>} citations
 * @returns {[string, number][]}
 */
export function unregisteredSourceKinds(registry, citations) {
  const known = new Set(sourceKindIds(registry));
  /** @type {Map<string, number>} */
  const unknown = new Map();
  for (const citation of citations) {
    const kind = citation.kind;
    if (kind == null || known.has(kind)) continue;
    unknown.set(kind, (unknown.get(kind) ?? 0) + 1);
  }
  return [...unknown].sort((a, b) => a[0].localeCompare(b[0]));
}
