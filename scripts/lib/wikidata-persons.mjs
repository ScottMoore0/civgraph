/**
 * The Wikidata crosswalk of Civgraph persons (data/elections/persons/wikidata-persons.json):
 * each linked person's Wikidata item, with the confidence and the evidence for the link.
 *
 * Read by the Browse person records (build-browse-indexes.mjs: a person whose official ids give
 * no Wikidata item takes the crosswalk's, shown as the Wikidata link and the JSON-LD sameAs) and
 * checked by scripts/check/rules/wikidata-persons.mjs.
 *
 * The file is built outside the repo by the wikidata-all stream's matcher (see the file's
 * `method`); merge leads and over-merged records are listed in it for the owner and are never
 * applied from here.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WIKIDATA_PERSONS = path.join(ROOT, 'data', 'elections', 'persons', 'wikidata-persons.json');
export const CONFIDENCE = ['official', 'high', 'medium'];
export const MERGE_VERDICTS = ['same', 'probably-same', 'different', 'review'];
const QID = /^Q[1-9]\d*$/;
const PERSON_ID = /^[1-9]\d*$/;

/** @returns {any} the parsed file, or an empty document when it is absent. */
export function loadWikidataPersons(file = WIKIDATA_PERSONS) {
  if (!existsSync(file)) return { persons: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The person's Wikidata item from the crosswalk, or null.
 * @param {any} doc  the parsed wikidata-persons.json
 * @param {string|number} personId
 * @returns {string|null}
 */
export function wikidataOf(doc, personId) {
  const entry = doc?.persons?.[String(personId)];
  return entry && QID.test(entry.qid) && CONFIDENCE.includes(entry.confidence) ? entry.qid : null;
}

/**
 * The Wikidata item a person record links: the one item its official ids give, else (when they
 * give none) the crosswalk's. Two or more items from the ids mean the record holds two people's
 * ids, and nothing is linked; the crosswalk never overrides them.
 * @param {Set<string>} idQids  the items the person's official ids give
 * @param {any} doc  the parsed wikidata-persons.json
 * @param {string|number} personId
 * @returns {{ qid: string|null, fromCrosswalk: boolean }}
 */
export function personWikidata(idQids, doc, personId) {
  if (idQids.size) return { qid: idQids.size === 1 ? [...idQids][0] : null, fromCrosswalk: false };
  const qid = wikidataOf(doc, personId);
  return { qid, fromCrosswalk: Boolean(qid) };
}

/** The item's Wikidata page, the URL a sameAs statement points to. */
export function wikidataUrl(qid) {
  return QID.test(String(qid || '')) ? `https://www.wikidata.org/wiki/${qid}` : null;
}

/**
 * Re-key the crosswalk after person merges: an id the registry has merged away (an entity's
 * `mergedFrom`) is replaced by the id it was merged into. A link moves to the kept person when
 * that person has none (or the same item); a merge lead whose persons collapse to one is
 * resolved and dropped. Ids that are simply gone (neither live nor merged) are reported, not
 * guessed. Returns a new document and what changed.
 * @param {any} doc
 * @param {{ personId: number|string, mergedFrom?: (number|string)[] }[]} entities  person_registry.json entities
 */
export function rekeyWikidataPersons(doc, entities) {
  const live = new Set(entities.map((e) => String(e.personId)));
  const into = new Map();
  for (const e of entities) for (const m of e.mergedFrom || []) into.set(String(m), String(e.personId));
  const target = (id) => (live.has(String(id)) ? String(id) : into.get(String(id)) || null);
  const changes = { moved: [], droppedLinks: [], resolvedLeads: [], missing: [] };
  const persons = {};
  const entries = Object.entries(doc.persons || {});
  // live ids first, so a kept person's own link wins over one moved onto it
  entries.sort(([a], [b]) => Number(!live.has(a)) - Number(!live.has(b)));
  for (const [id, entry] of entries) {
    const to = target(id);
    if (!to) { changes.missing.push(id); continue; }
    if (persons[to]) {
      if (persons[to].qid !== entry.qid) changes.droppedLinks.push({ from: id, to, qid: entry.qid, kept: persons[to].qid });
      continue;
    }
    if (to !== id) {
      changes.moved.push({ from: id, to, qid: entry.qid });
      persons[to] = { ...entry, evidence: [...entry.evidence, `re-keyed from ${id}, merged into ${to}`] };
    } else persons[to] = entry;
  }
  const mergeLeads = [];
  for (const lead of doc.mergeLeads || []) {
    const ids = [...new Set(lead.persons.map((p) => target(p.personId)).filter(Boolean))];
    if (ids.length < 2) { changes.resolvedLeads.push(lead.wikidata); continue; }
    mergeLeads.push({ ...lead, persons: lead.persons.filter((p, i, all) => {
      const t = target(p.personId);
      return t && all.findIndex((q) => target(q.personId) === t) === i;
    }).map((p) => ({ ...p, personId: target(p.personId) })) });
  }
  const byQid = new Set();
  for (const [id, entry] of Object.entries(persons)) {
    if (byQid.has(entry.qid)) { changes.droppedLinks.push({ from: id, to: id, qid: entry.qid, kept: entry.qid }); delete persons[id]; }
    else byQid.add(entry.qid);
  }
  const sorted = Object.fromEntries(Object.entries(persons).sort(([a], [b]) => Number(a) - Number(b)));
  return { doc: { ...doc, persons: sorted, mergeLeads }, changes };
}

/**
 * Validate the document's shape, and that every person id it names is a person in the registry.
 * @param {any} doc
 * @param {{ personIds: Set<string>, registryQids?: Map<string, string> }} registry
 *        personIds: every person id in person_registry.json; registryQids: person id -> the
 *        `wikidata:` official id the registry holds for it.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateWikidataPersons(doc, { personIds, registryQids = new Map() }) {
  const errors = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object') return { errors: ['not a JSON object'], warnings };
  if (doc.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!doc.source?.url || !doc.source?.licence) errors.push('source.url and source.licence are required');
  if (!doc.persons || typeof doc.persons !== 'object' || Array.isArray(doc.persons)) {
    errors.push('persons must be an object keyed by person id');
    return { errors, warnings };
  }
  const byQid = new Map();
  for (const [id, entry] of Object.entries(doc.persons)) {
    const at = `persons[${id}]`;
    if (!PERSON_ID.test(id)) errors.push(`${at}: key is not a person id`);
    else if (!personIds.has(id)) errors.push(`${at}: person id is not in person_registry.json (merged or renumbered?)`);
    if (!entry || typeof entry !== 'object') { errors.push(`${at}: not an object`); continue; }
    if (!QID.test(entry.qid || '')) errors.push(`${at}: qid ${JSON.stringify(entry.qid)} is not a Wikidata item id`);
    if (!CONFIDENCE.includes(entry.confidence)) errors.push(`${at}: confidence must be one of ${CONFIDENCE.join(', ')}`);
    if (typeof entry.name !== 'string' || !entry.name) errors.push(`${at}: name is required`);
    if (!Array.isArray(entry.evidence) || !entry.evidence.length || entry.evidence.some((e) => typeof e !== 'string' || !e)) {
      errors.push(`${at}: evidence must be a non-empty list of strings`);
    }
    const held = registryQids.get(id);
    if (held && entry.qid && held !== entry.qid) errors.push(`${at}: ${entry.qid} differs from the registry's wikidata:${held}`);
    if (entry.qid) {
      if (byQid.has(entry.qid)) errors.push(`${at}: ${entry.qid} is also linked to person ${byQid.get(entry.qid)}; one item is one person (list it under mergeLeads)`);
      else byQid.set(entry.qid, id);
    }
  }
  for (const [i, lead] of (doc.mergeLeads || []).entries()) {
    const at = `mergeLeads[${i}]`;
    if (!QID.test(lead?.wikidata || '')) errors.push(`${at}: wikidata is not an item id`);
    if (!Array.isArray(lead?.persons) || lead.persons.length < 2) { errors.push(`${at}: persons must list two or more`); continue; }
    for (const p of lead.persons) {
      if (!personIds.has(String(p?.personId))) errors.push(`${at}: person ${p?.personId} is not in person_registry.json (merged? then drop or update the lead)`);
    }
    if (!MERGE_VERDICTS.includes(lead.verdict)) errors.push(`${at}: verdict must be one of ${MERGE_VERDICTS.join(', ')}`);
    if (!lead.reason) errors.push(`${at}: reason is required`);
  }
  for (const [i, split] of (doc.splitFirst || []).entries()) {
    if (!personIds.has(String(split?.personId))) warnings.push(`splitFirst[${i}]: person ${split?.personId} is no longer in the registry (split done?)`);
  }
  return { errors, warnings };
}
