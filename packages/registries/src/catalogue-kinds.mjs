/**
 * The catalogue-kinds registry (data/registries/catalogue-kinds.json): the kinds of map series the
 * catalogue arranges, each with its section and, where the filters offer it, its filter label. Pure.
 */

/** @typedef {import('../../types/index.js').CatalogueKindsRegistry} CatalogueKindsRegistry */

/**
 * Checks a schema cannot state: an id or a section given twice.
 * @param {CatalogueKindsRegistry} registry
 * @returns {string[]}
 */
export function checkCatalogueKinds(registry) {
  /** @type {string[]} */
  const errors = [];
  for (const field of /** @type {const} */ (['id', 'section'])) {
    const values = registry.kinds.map((kind) => kind[field]);
    for (const value of new Set(values)) if (values.filter((v) => v === value).length > 1) errors.push(`kinds: ${field} ${value} is given twice`);
  }
  return errors;
}

/**
 * The kinds' ids, in display order: the values a series' kind may take.
 * @param {CatalogueKindsRegistry} registry
 * @returns {string[]}
 */
export function catalogueKindIds(registry) {
  return registry.kinds.map((kind) => kind.id);
}

/**
 * The browser's slice: [section, kind, section label, icon] for every kind (the catalogue's
 * SECTIONS), and [kind, filter label] for the kinds the filters offer (KINDS).
 * @param {CatalogueKindsRegistry} registry
 */
export function browserCatalogueKinds(registry) {
  return {
    sections: registry.kinds.map((kind) => [kind.section, kind.id, kind.sectionLabel, kind.icon]),
    filters: registry.kinds.flatMap((kind) => (kind.filterLabel ? [[kind.id, kind.filterLabel]] : []))
  };
}
