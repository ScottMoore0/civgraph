/**
 * The providers registry (data/registries/providers.json): the bodies and people the map catalogue
 * credits, each with the full name the catalogue's provider filter lists and the short name a row's
 * credit line shows; another spelling of the same body is an alias of its entry. Pure.
 */

/** @typedef {import('@civgraph/types').ProvidersRegistry} ProvidersRegistry */

/**
 * Checks a schema cannot state: an id given twice, or a provider string (a name or an alias) that
 * names two entries.
 * @param {ProvidersRegistry} registry
 * @returns {string[]}
 */
export function checkProviders(registry) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, string>} */
  const named = new Map();
  const ids = new Set();
  for (const p of registry.providers) {
    if (ids.has(p.id)) errors.push(`providers: id ${p.id} is given twice`);
    ids.add(p.id);
    for (const n of [p.name, ...(p.aliases || [])]) {
      const other = named.get(n);
      if (other && other !== p.id) errors.push(`providers: "${n}" names both ${other} and ${p.id}`);
      named.set(n, p.id);
    }
  }
  return errors;
}

/**
 * The browser's slice: [id, full name, short name, the provider strings it stands for] for every
 * entry, in the registry's order.
 * @param {ProvidersRegistry} registry
 * @returns {{ providers: Array<[string, string, string, string[]]> }}
 */
export function browserProviders(registry) {
  return { providers: registry.providers.map((p) => [p.id, p.full, p.short, [p.name, ...(p.aliases || [])]]) };
}
