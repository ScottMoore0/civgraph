/**
 * The parties registry: data/registries/parties.json (the abbreviations, and the names of the
 * party files) joined with those files by loadRegistry('parties'). The joined value:
 *
 *   { schemaVersion, description, parts, abbreviations, notParties,
 *     entities, lifespans, lineage, events, wikidata, wikidataOverrides,
 *     labelIds, labelFolds, labelInterpretations, colourReviewOverrides }
 *
 * each of the last ten the parsed file of that role. Pure (no I/O) apart from assembleParties,
 * which is handed a reader.
 */

/** The registry with each part read through `readJson(relPath)`. */
export function assembleParties(readJson, manifest) {
  const out = { ...manifest };
  for (const [role, rel] of Object.entries(manifest.parts || {})) out[role] = readJson(rel);
  return out;
}

/**
 * A label folded for matching, exactly as src/party-names.mjs keys its spellings: accents,
 * a trailing ballot-paper "Lozenge", "&", full stops and apostrophes, dashes, slashes and commas.
 */
export function partyLabelKey(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+lozenge$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[.'’`]/g, '')
    .replace(/[–—\-_/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** key -> { abbreviation, fullName }: the first row naming a spelling wins (src/party-names.mjs BY_KEY). */
export function abbreviationIndex(registry) {
  const byKey = new Map();
  for (const { abbreviation, fullName, spellings = [] } of registry.abbreviations) {
    for (const spelling of [abbreviation, fullName, ...spellings]) {
      const k = partyLabelKey(spelling);
      if (k && !byKey.has(k)) byKey.set(k, { abbreviation, fullName });
    }
  }
  return byKey;
}

/** { abbreviation, fullName } for a label as spelled in the data, or null (src/party-names.mjs partyInfo). */
export function partyInfoFrom(index, value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return index.get(partyLabelKey(text)) || index.get(partyLabelKey(text.replace(/\s*\([^)]*\)\s*$/, ''))) || null;
}

/** id -> entity of party_registry.json. */
export function partiesById(registry) {
  return new Map(registry.entities.entities.map((e) => [e.id, e]));
}

/** Every alias string of an entity (corrupted spellings included). */
export function entityAliasStrings(entity) {
  return (entity.aliases || []).map((a) => (typeof a === 'string' ? a : a.string));
}

/** Ballot label -> the Browse party slug it is listed under (data/registries/parties/label-folds.json). */
export function labelFoldIndex(registry) {
  const out = new Map();
  for (const [slug, fold] of Object.entries(registry.labelFolds.folds)) for (const label of fold.labels) out.set(label, slug);
  return out;
}

/** Retired Browse party slug -> the slug it now redirects to. */
export function retiredPartySlugs(registry) {
  const out = new Map();
  for (const [slug, entry] of Object.entries(registry.labelFolds.retiredSlugs || {})) for (const old of entry.slugs) out.set(old, slug);
  return out;
}

/** The rules document createPartyLabelInterpreter (scripts/lib/party-label-interpretations.mjs) takes. */
export function labelInterpretationRules(registry) {
  return registry.labelInterpretations;
}

/**
 * Checks across the party files that no one file's schema can state.
 * @returns {string[]} errors
 */
export function checkParties(registry) {
  const errors = [];
  const entities = registry.entities.entities;
  const ids = new Set();
  for (const e of entities) {
    if (ids.has(e.id)) errors.push(`entities: duplicate id ${e.id}`);
    ids.add(e.id);
    if (!(e.type in registry.entities.types)) errors.push(`entities: ${e.id} has undeclared type ${e.type}`);
  }
  for (const e of entities) {
    for (const f of ['splitFrom', 'successor', 'predecessor']) {
      if (e[f] && !ids.has(e[f])) errors.push(`entities: ${e.id}.${f} names unknown entity ${e[f]}`);
    }
    for (const old of e.formerIds || []) if (ids.has(old)) errors.push(`entities: ${e.id}.formerIds ${old} is still a live id`);
  }
  const byId = partiesById(registry);
  for (const p of registry.lifespans.parties) {
    const e = byId.get(p.id);
    if (!e) { errors.push(`lifespans: ${p.id} is not an entity`); continue; }
    for (const f of ['name', 'founded', 'foundedPrecision', 'dissolved', 'status']) {
      if ((e[f] ?? null) !== (p[f] ?? null)) errors.push(`lifespans: ${p.id}.${f} is ${JSON.stringify(p[f])}, the entity says ${JSON.stringify(e[f])}`);
    }
  }
  const labelIds = new Set(registry.labelIds.party_ids.map((p) => p.party_id));
  const canonical = new Set(registry.labelIds.party_ids.map((p) => p.canonical_name));
  if (labelIds.size !== registry.labelIds.party_ids.length) errors.push('labelIds: duplicate party_id');
  for (const [alias, id] of Object.entries(registry.labelIds.aliases)) if (!labelIds.has(id)) errors.push(`labelIds: alias ${JSON.stringify(alias)} -> unknown ${id}`);
  const neverFold = new Set(registry.labelFolds.neverFold);
  const folded = new Map();
  for (const [slug, fold] of Object.entries(registry.labelFolds.folds)) {
    for (const label of fold.labels) {
      if (!canonical.has(label)) errors.push(`labelFolds: ${slug} label ${JSON.stringify(label)} is not a canonical_name of party-ids.json`);
      if (neverFold.has(label)) errors.push(`labelFolds: ${JSON.stringify(label)} is both folded and neverFold`);
      if (folded.has(label)) errors.push(`labelFolds: ${JSON.stringify(label)} folds into ${folded.get(label)} and ${slug}`);
      folded.set(label, slug);
    }
  }
  for (const label of neverFold) if (!canonical.has(label)) errors.push(`labelFolds: neverFold ${JSON.stringify(label)} is not a canonical_name`);
  const retired = retiredPartySlugs(registry);
  for (const old of retired.keys()) if (old in registry.labelFolds.folds) errors.push(`labelFolds: retired slug ${old} still folds labels`);
  const regions = registry.labelInterpretations.regions || {};
  registry.labelInterpretations.rules.forEach((rule, i) => {
    if (rule.region && !regions[rule.region]) errors.push(`labelInterpretations: rules[${i}] names unknown region ${rule.region}`);
    if (!rule.printed && !rule.whenParty) errors.push(`labelInterpretations: rules[${i}] matches nothing (no printed, no whenParty)`);
  });
  const regionOf = new Map();
  for (const [name, region] of Object.entries(regions)) {
    for (const body of region.bodies) {
      if (regionOf.has(body)) errors.push(`labelInterpretations: body ${body} is in regions ${regionOf.get(body)} and ${name}`);
      regionOf.set(body, name);
    }
  }
  const abbreviations = new Set();
  for (const row of registry.abbreviations) {
    if (abbreviations.has(row.abbreviation)) errors.push(`abbreviations: ${row.abbreviation} is listed twice`);
    abbreviations.add(row.abbreviation);
  }
  const index = abbreviationIndex(registry);
  for (const label of registry.notParties) if (index.has(partyLabelKey(label))) errors.push(`notParties: ${label} also has an abbreviation`);
  for (const id of Object.keys(registry.wikidataOverrides).filter((k) => !k.startsWith('_'))) {
    if (registry.wikidataOverrides[id] !== null && !/^Q\d+$/.test(registry.wikidataOverrides[id])) errors.push(`wikidataOverrides: ${id} is not a Q id or null`);
  }
  return errors;
}
