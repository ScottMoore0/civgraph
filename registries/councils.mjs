/**
 * The councils registry (data/registries/councils.json): every council the site files elections,
 * offices or boundaries under, one entry each, and the views the code used to keep as literals.
 *
 * Pure (no I/O): pass it the parsed registry, from loadRegistry('councils') in Node or the
 * generated browser module. Each view below names the literal it replaces; the parity tests
 * (tests/unit/registries-councils.test.mjs) hold each view equal to that literal until the
 * literal is gone.
 */

/** Lower-case ASCII words, as scripts/lib/election-names.mjs normalises a body name. */
export function normalizeCouncilName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const list = (registry) => registry.councils;
const flagged = (registry, flag) => list(registry).filter((c) => c.flags?.[flag]);

/** id -> council. */
export function councilsById(registry) {
  return new Map(list(registry).map((c) => [c.id, c]));
}

/** Councils filed under an elections body slug (one per pre-1973 council; many for local-government). */
export function councilsByBodySlug(registry, bodySlug) {
  return list(registry).filter((c) => c.bodySlug === bodySlug);
}

/** The council a body slug names (pre-1973 councils, whose body is the council), or null. */
export function councilForBodySlug(registry, bodySlug) {
  const found = councilsByBodySlug(registry, bodySlug);
  return found.length === 1 ? found[0] : null;
}

/** Body slugs of the councils carrying `flag`, in registry order. */
export function bodySlugsWithFlag(registry, flag) {
  return flagged(registry, flag).map((c) => c.bodySlug);
}

/**
 * Body slugs of the NI councils 1923-67 intake: NI_COUNCILS_1923_67_BODY_SLUGS of
 * scripts/build/build-test2-election-manifest.mjs (an array there, only ever spread into sets).
 */
export function niCouncils1923to67BodySlugs(registry) {
  return new Set(bodySlugsWithFlag(registry, 'niCouncils1923_67'));
}

/**
 * The manifest builder's council sets (scripts/build/build-test2-election-manifest.mjs):
 * PRE1973_COUNCIL_BODY_SLUGS, NI_COUNCILS_1923_67_RESULTS_ONLY_BODY_SLUGS,
 * PR1920_ONLY_COUNCIL_BODY_SLUGS, ARMAGH_PILOT_RESULTS_ONLY_BODY_SLUGS and LOCAL_GOVERNMENT_BODIES
 * (the last by elections-index name, as the builder matches it).
 */
export function manifestCouncilSets(registry) {
  return {
    pre1973: new Set(bodySlugsWithFlag(registry, 'pre1973Council')),
    resultsOnly1923to67: new Set(bodySlugsWithFlag(registry, 'resultsOnly1923_67')),
    pr1920Only: new Set(bodySlugsWithFlag(registry, 'pr1920Only')),
    armaghPilot: new Set(bodySlugsWithFlag(registry, 'armaghPilot')),
    localGovernmentBodies: new Set(flagged(registry, 'localGovernmentGroup').map((c) => c.indexName))
  };
}

/** NI_COUNCIL_SLUGS of src/ni-local-groups.mjs: the councils of 1921-72 a year groups. */
export function niLocalGroupSlugs(registry) {
  return new Set(bodySlugsWithFlag(registry, 'niLocalGroup'));
}

/**
 * A council's name on a date (YYYY, YYYY-MM or YYYY-MM-DD). `names` is ascending; an entry
 * applies from `from` and, if it has one, until `until` (inclusive), each compared at its own
 * precision; the entry with neither is the name otherwise. Without `names`, the council's name.
 */
export function councilNameOn(council, date) {
  const names = council.names || [];
  if (!names.length) return council.name;
  const day = String(date || '');
  const fallback = names.find((n) => n.from == null && n.until == null);
  let found = null;
  for (const n of names) {
    if (n === fallback) continue;
    if (n.from != null && day.slice(0, n.from.length) < n.from) continue;
    if (n.until != null && day.slice(0, n.until.length) > n.until) continue;
    found = n;
  }
  return (found || fallback || names[0]).name;
}

/**
 * NI_COUNCIL_ERA_TITLES of scripts/lib/election-names.mjs: normalised body name ->
 * [[from, name], ...] newest first, '' for the earliest. Only the councils whose eras are
 * dated to the day (`names[].basis` "date").
 */
export function eraTitles(registry) {
  const out = new Map();
  for (const c of list(registry)) {
    if (!c.names || c.names.some((n) => n.basis !== 'date')) continue;
    out.set(normalizeCouncilName(c.indexName || c.name), [...c.names].reverse().map((n) => [n.from || '', n.name]));
  }
  return out;
}

/**
 * NI_COUNCILS_1923_67_PLAIN_TITLES of scripts/lib/election-names.mjs (only ever tested with
 * includes): the 1923-67 councils titled by their one name, i.e. without era names and not an
 * aldermanic body.
 */
export function plainTitleBodies(registry) {
  return new Set(flagged(registry, 'niCouncils1923_67')
    .filter((c) => !c.names && !c.aldermenOf)
    .map((c) => normalizeCouncilName(c.indexName)));
}

/** PRE1973_COUNCIL_BODIES of scripts/lib/election-names.mjs: normalised index names. */
export function pre1973CouncilBodyNames(registry) {
  return new Set(flagged(registry, 'pre1973Council').map((c) => normalizeCouncilName(c.indexName)));
}

/** The names src/catalogue/search.js gives a local election's councils, by generation. */
export function catalogueCouncilNames(registry, { generation, jurisdiction = 'northern-ireland' }) {
  return list(registry)
    .filter((c) => c.generation === generation && c.jurisdiction === jurisdiction && c.searchName)
    .map((c) => c.searchName);
}

/** BODY_ALIASES of src/catalogue/search.js, for the councils (body slug -> words). */
export function catalogueBodyAliases(registry) {
  return Object.fromEntries(list(registry).filter((c) => c.searchAliases && c.bodySlug).map((c) => [c.bodySlug, c.searchAliases]));
}

/** The type of council a body slug names (NI_LOCAL_TIERS key), or null. */
export function councilType(registry, bodySlug) {
  return councilForBodySlug(registry, bodySlug)?.type ?? null;
}

/**
 * Checks beyond the schema: unique ids and body slugs, every reference resolves, relations are
 * symmetric, types are declared, and a flag's companion data is present.
 * @returns {string[]} errors
 */
export function checkCouncils(registry) {
  const errors = [];
  const byId = councilsById(registry);
  if (byId.size !== list(registry).length) {
    const seen = new Set();
    for (const c of list(registry)) { if (seen.has(c.id)) errors.push(`duplicate id ${c.id}`); seen.add(c.id); }
  }
  const slugs = new Map();
  for (const c of list(registry)) {
    if (c.bodySlug && c.generation === 'pre-1973') {
      if (slugs.has(c.bodySlug)) errors.push(`${c.id}: body slug ${c.bodySlug} also on ${slugs.get(c.bodySlug)}`);
      slugs.set(c.bodySlug, c.id);
    }
    if (!registry.types[c.type]) errors.push(`${c.id}: type ${c.type} is not declared in types`);
    if (c.aldermenOf && !byId.has(c.aldermenOf)) errors.push(`${c.id}: aldermenOf ${c.aldermenOf} is not a council`);
    if (c.names) {
      const fallbacks = c.names.filter((n) => n.from == null && n.until == null);
      if (fallbacks.length !== 1) errors.push(`${c.id}: names needs exactly one entry without from/until`);
      const dated = c.names.filter((n) => n.from != null).map((n) => n.from);
      if (dated.join() !== [...dated].sort().join()) errors.push(`${c.id}: names are not in ascending order`);
    }
    for (const [side, other] of [['predecessors', 'successors'], ['successors', 'predecessors']]) {
      for (const rel of c[side] || []) {
        const target = byId.get(rel.id);
        if (!target) { errors.push(`${c.id}: ${side} names unknown council ${rel.id}`); continue; }
        const back = (target[other] || []).find((r) => r.id === c.id);
        if (!back) errors.push(`${c.id}: ${side} ${rel.id} does not list it among its ${other}`);
        else if (JSON.stringify(back.basis) !== JSON.stringify(rel.basis)) errors.push(`${c.id}: ${side} ${rel.id} cites a different basis on each side`);
      }
    }
    if (c.flags?.pr1920Only && !c.flags?.pre1973Council) errors.push(`${c.id}: pr1920Only without pre1973Council`);
  }
  return errors;
}
