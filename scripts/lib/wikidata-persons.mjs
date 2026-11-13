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

export const WIKIDATA_REMOVALS = path.join(ROOT, 'data', 'elections', 'persons', 'wikidata-persons-removals.json');
const REMOVALS_DESCRIPTION = 'Wikidata items the crosswalk (wikidata-persons.json) once linked or listed as a merge lead and no longer does, each with its reason. `conflicts` are for the owner: a merge joined a person holding one item to a person holding another (the kept person keeps its own), or a merge joined records the Wikidata review called different people. `removals` are the rest, each with its reason: a person id that left the registry without a redirect (`vanished`; the id rule says that should not happen, so look), or an item a person removed (`reviewed`). check:wikidata-persons fails when an item leaves the crosswalk without an entry here. Written by scripts/ingest/persons/rekey-wikidata-persons.mjs; a removal made by hand is added with kind "reviewed" and its reason.';

/** @returns {any} the parsed file, or an empty document when it is absent. */
export function loadWikidataPersons(file = WIKIDATA_PERSONS) {
  if (!existsSync(file)) return { persons: {} };
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The removal list (wikidata-persons-removals.json), or an empty one when it is absent.
 * @returns {{ schemaVersion: number, description: string, conflicts: WikidataRemoval[], removals: WikidataRemoval[], [key: string]: unknown }}
 */
export function loadRemovals(file = WIKIDATA_REMOVALS) {
  const empty = { schemaVersion: 1, description: REMOVALS_DESCRIPTION, conflicts: [], removals: [] };
  if (!existsSync(file)) return empty;
  return { ...empty, ...JSON.parse(readFileSync(file, 'utf8')) };
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

/**
 * The item's Wikidata page, the URL a sameAs statement points to.
 * @param {unknown} qid
 * @returns {string|null}
 */
export function wikidataUrl(qid) {
  return QID.test(String(qid || '')) ? `https://www.wikidata.org/wiki/${qid}` : null;
}

/**
 * A crosswalk link: the person's Wikidata item, with the confidence and the evidence for it.
 * @typedef {{ qid: string, name: string, label?: string, confidence: string, evidence: string[] }} WikidataLink
 */
/**
 * One record of a merge lead (an item reaching two or more Civgraph persons).
 * @typedef {{ personId: string, name?: string, grade?: string, officeEvidence?: string[], [key: string]: unknown }} LeadPerson
 */
/** @typedef {{ wikidata: string, label?: string, persons: LeadPerson[], verdict: string, reason?: string, [key: string]: unknown }} MergeLead */
/**
 * An item the crosswalk no longer links, and why: `conflict` (the kept person holds another item,
 * or the item is linked to someone else: the owner chooses), `merged-different` (the Wikidata
 * review called the records different people, yet they were merged), `vanished` (an id neither
 * live nor redirected), or `reviewed` (removed by a person, with the reason).
 * @typedef {{ qid: string, personId: string, name?: string | undefined, kind: string, reason: string, keptPersonId?: string, keptQid?: string, date?: string }} WikidataRemoval
 */
/**
 * What a re-key changed. `linkedFromLeads`: settled merge leads that became links.
 * @typedef {{ moved: { from: string, to: string, qid: string }[], linkedFromLeads: { qid: string, to: string, from: string[], verdict: string }[],
 *   conflicts: WikidataRemoval[], removals: WikidataRemoval[], resolvedLeads: string[], missing: string[] }} RekeyChanges
 */
export const REMOVAL_KINDS = ['conflict', 'merged-different', 'vanished', 'reviewed'];
const CONFIDENCE_RANK = new Map(CONFIDENCE.map((c, i) => [c, i]));

/**
 * Where each retired person id now answers: the registry's `mergedFrom` lists first, then the
 * redirect rows given (person_id_confirmed_merges.csv, person_id_merges.csv, ie-ei-crosswalk.csv:
 * any row with `keep` and `drop`), the first source naming a drop winning. Chains are followed to
 * a live id; a drop that is itself live is never redirected.
 * @param {{ personId: number|string, mergedFrom?: (number|string)[] }[]} entities  person_registry.json entities
 * @param {{ keep?: string, drop?: string }[]} [rows]
 * @returns {(id: string|number) => string|null}  the live id an id answers as, or null
 */
export function personRedirects(entities, rows = []) {
  const live = new Set(entities.map((e) => String(e.personId)));
  /** @type {Map<string, string>} */
  const into = new Map();
  for (const e of entities) for (const m of e.mergedFrom || []) if (!into.has(String(m))) into.set(String(m), String(e.personId));
  for (const r of rows) {
    const drop = String(r.drop || '').trim(), keep = String(r.keep || '').trim();
    if (PERSON_ID.test(drop) && PERSON_ID.test(keep) && drop !== keep && !into.has(drop)) into.set(drop, keep);
  }
  return (id) => {
    let at = String(id);
    const seen = new Set();
    while (!live.has(at) && into.has(at) && !seen.has(at)) { seen.add(at); at = /** @type {string} */ (into.get(at)); }
    return live.has(at) ? at : null;
  };
}

/**
 * The link a settled merge lead becomes on the kept person: the kept record's name (else the
 * first record's), the item's label, the best confidence its records were graded (medium when
 * none is a crosswalk grade), and their office evidence plus how the lead was settled.
 * @param {MergeLead} lead
 * @param {string} to  the kept person id
 * @param {string[]} from  the lead's person ids
 * @param {string} [note]  one more evidence line (who linked it, when)
 * @returns {WikidataLink}
 */
export function linkFromLead(lead, to, from, note) {
  const kept = lead.persons.find((p) => String(p.personId) === to) || lead.persons[0];
  const grades = lead.persons.map((p) => String(p.grade || '')).filter((g) => CONFIDENCE_RANK.has(g));
  grades.sort((a, b) => /** @type {number} */ (CONFIDENCE_RANK.get(a)) - /** @type {number} */ (CONFIDENCE_RANK.get(b)));
  const offices = [...new Set(lead.persons.flatMap((p) => (Array.isArray(p.officeEvidence) ? p.officeEvidence : [])))];
  const evidence = [...offices, `merge lead "${lead.verdict}"${lead.reason ? ` (${lead.reason})` : ''}: persons ${from.join(', ')} merged into ${to}`];
  if (note) evidence.push(note);
  return { qid: lead.wikidata, name: String(kept?.name || lead.label || ''), ...(lead.label ? { label: lead.label } : {}), confidence: grades[0] || 'medium', evidence };
}

/**
 * Re-key the crosswalk after person merges. Every id that has retired into a kept id (the
 * registry's `mergedFrom`, and the redirect rows: confirmed merges, the merge log, the
 * IrelandElection/ElectionsIreland crosswalk) is replaced by the kept id.
 *
 * - A link on a retired id moves to the kept person when that person has none.
 * - A merge lead whose persons collapse to one is settled: its item becomes the kept person's
 *   link (a lead the review called `different` is listed for the owner instead).
 * - When the kept person already holds another item (in the crosswalk, or the registry's own
 *   `wikidata:` id), or the item is linked to someone else, the kept person's link stays and
 *   the other item is listed under `conflicts` for the owner. Nothing is dropped unlisted.
 * - Ids neither live nor redirected are listed under `removals` (`vanished`) and `missing`.
 *
 * Returns a new document and what changed; `conflicts` and `removals` are what the crosswalk no
 * longer links, for wikidata-persons-removals.json.
 * @param {{ persons?: Record<string, WikidataLink>, mergeLeads?: MergeLead[], [key: string]: unknown }} doc
 * @param {{ personId: number|string, mergedFrom?: (number|string)[] }[]} entities  person_registry.json entities
 * @param {{ redirects?: { keep?: string, drop?: string }[], registryQids?: Map<string, string>, note?: string | undefined, date?: string | undefined }} [options]
 *        redirects: keep/drop rows beyond `mergedFrom`; registryQids: person id -> the registry's
 *        `wikidata:` id; note: an evidence line for links made from leads; date: stamped on removals.
 * @returns {{ doc: { persons: Record<string, WikidataLink>, mergeLeads: MergeLead[], [key: string]: unknown }, changes: RekeyChanges }}
 */
export function rekeyWikidataPersons(doc, entities, { redirects = [], registryQids = new Map(), note, date } = {}) {
  const live = new Set(entities.map((e) => String(e.personId)));
  const target = personRedirects(entities, redirects);
  /** @type {RekeyChanges} */
  const changes = { moved: [], linkedFromLeads: [], conflicts: [], removals: [], resolvedLeads: [], missing: [] };
  /** @type {Record<string, WikidataLink>} */
  const persons = {};
  /** @type {Map<string, string>} qid -> person id */
  const holder = new Map();
  const stamp = date ? { date } : {};
  /**
   * Link `qid` to `to` unless the kept person holds another item or the item is held elsewhere.
   * A live person's own link is checked against the registry by validateWikidataPersons, not here.
   * @param {string} to @param {WikidataLink} link @param {string} from @param {boolean} [ownLink] @returns {boolean} linked
   */
  const place = (to, link, from, ownLink = false) => {
    if (persons[to]?.qid === link.qid) return true;
    const own = persons[to]?.qid || (ownLink ? undefined : registryQids.get(to));
    if (own && own !== link.qid) {
      changes.conflicts.push({ qid: link.qid, personId: from, name: link.name, kind: 'conflict', reason: `merged into ${to}, which already links ${own}${persons[to] ? '' : ' (the registry\'s wikidata: id)'}; ${to} keeps ${own}`, keptPersonId: to, keptQid: own, ...stamp });
      return false;
    }
    const other = holder.get(link.qid);
    if (other) {
      changes.conflicts.push({ qid: link.qid, personId: from, name: link.name, kind: 'conflict', reason: `merged into ${to}, but the item is already linked to ${other}; ${other} keeps it`, keptPersonId: other, keptQid: link.qid, ...stamp });
      return false;
    }
    persons[to] = link;
    holder.set(link.qid, to);
    return true;
  };
  /** @type {[string, WikidataLink][]} */
  const entries = Object.entries(doc.persons || {});
  // live ids first, so a kept person's own link wins over one moved onto it
  entries.sort(([a], [b]) => Number(!live.has(a)) - Number(!live.has(b)));
  for (const [id, entry] of entries) {
    const to = target(id);
    if (!to) {
      changes.missing.push(id);
      changes.removals.push({ qid: entry.qid, personId: id, name: entry.name, kind: 'vanished', reason: `person ${id} is neither in person_registry.json nor redirected by a merge: re-run the matcher or add the redirect`, ...stamp });
      continue;
    }
    if (to === id) { place(to, entry, id, true); continue; }
    const moved = { ...entry, evidence: [...entry.evidence, `re-keyed from ${id}, merged into ${to}`] };
    place(to, moved, id);
    if (persons[to] === moved) changes.moved.push({ from: id, to, qid: entry.qid });
  }
  /** @type {MergeLead[]} */
  const mergeLeads = [];
  for (const lead of doc.mergeLeads || []) {
    const from = lead.persons.map((p) => String(p.personId));
    const ids = [...new Set(from.map(target).filter((t) => t !== null))];
    if (ids.length >= 2) {
      mergeLeads.push({ ...lead, persons: lead.persons.filter((p, i, all) => {
        const t = target(p.personId);
        return t && all.findIndex((q) => target(q.personId) === t) === i;
      }).map((p) => ({ ...p, personId: /** @type {string} */ (target(p.personId)) })) });
      continue;
    }
    changes.resolvedLeads.push(lead.wikidata);
    const [to] = ids;
    const gone = from.filter((f) => target(f) === null);
    if (!to || gone.length) {
      // a record that left without a redirect was not merged: nothing settles the lead
      changes.removals.push({ qid: lead.wikidata, personId: from.join(' '), name: lead.label, kind: 'vanished', reason: `merge lead: person(s) ${gone.join(', ')} neither in person_registry.json nor redirected by a merge${to ? `, so ${to} is not linked: link it by hand if the records were one person` : ''}`, ...(to ? { keptPersonId: to } : {}), ...stamp });
      continue;
    }
    if (holder.get(lead.wikidata) === to) continue;
    if (lead.verdict === 'different') {
      changes.conflicts.push({ qid: lead.wikidata, personId: from.join(' '), name: lead.label, kind: 'merged-different', reason: `the Wikidata review called persons ${from.join(', ')} different people (${lead.reason || 'no reason given'}), but they were merged into ${to}: link by hand if the merge stands`, keptPersonId: to, ...stamp });
      continue;
    }
    if (place(to, linkFromLead(lead, to, from, note), from.filter((f) => f !== to).join(' ') || to)) {
      changes.linkedFromLeads.push({ qid: lead.wikidata, to, from, verdict: lead.verdict });
    }
  }
  const sorted = Object.fromEntries(Object.entries(persons).sort(([a], [b]) => Number(a) - Number(b)));
  return { doc: { ...doc, persons: sorted, mergeLeads }, changes };
}

/**
 * Bring back the items an earlier crosswalk linked (or listed as leads) that the current one has
 * lost: the earlier document is re-keyed against today's registry and redirects, and each lost
 * item it links is placed on today's crosswalk under the same rules (a kept person's own item
 * wins; conflicts are listed, never dropped). Items `removed` already lists are left alone.
 * @param {{ persons: Record<string, WikidataLink>, mergeLeads?: MergeLead[], [key: string]: unknown }} current
 * @param {{ persons?: Record<string, WikidataLink>, mergeLeads?: MergeLead[], [key: string]: unknown }} earlier
 * @param {{ personId: number|string, mergedFrom?: (number|string)[] }[]} entities
 * @param {{ redirects?: { keep?: string, drop?: string }[], registryQids?: Map<string, string>, note?: string, date?: string, removed?: Set<string> }} [options]
 * @returns {{ doc: { persons: Record<string, WikidataLink>, mergeLeads: MergeLead[], [key: string]: unknown }, restored: { qid: string, to: string, name: string }[], conflicts: WikidataRemoval[], removals: WikidataRemoval[] }}
 */
export function restoreLostLinks(current, earlier, entities, { redirects = [], registryQids = new Map(), note, date, removed = new Set() } = {}) {
  const lost = new Set(lostQids(earlier, current).filter((l) => !removed.has(l.qid)).map((l) => l.qid));
  const lostDoc = {
    persons: Object.fromEntries(Object.entries(earlier.persons || {}).filter(([, e]) => lost.has(e.qid))
      .map(([id, e]) => [id, note ? { ...e, evidence: [...e.evidence, note] } : e])),
    mergeLeads: (earlier.mergeLeads || []).filter((l) => lost.has(l.wikidata))
  };
  const { doc: back, changes } = rekeyWikidataPersons(lostDoc, entities, { redirects, registryQids, note, date });
  // place them on today's crosswalk: re-key the union, today's links first (live ids, so they win)
  const merged = { ...current, persons: { ...current.persons }, mergeLeads: [...(current.mergeLeads || []), ...back.mergeLeads] };
  /** @type {{ qid: string, to: string, name: string }[]} */
  const restored = [];
  /** @type {WikidataRemoval[]} */
  const conflicts = [...changes.conflicts];
  const taken = new Map(Object.entries(merged.persons).map(([id, e]) => [e.qid, id]));
  for (const [to, link] of Object.entries(back.persons)) {
    const own = merged.persons[to]?.qid || registryQids.get(to);
    if (own && own !== link.qid) {
      conflicts.push({ qid: link.qid, personId: to, name: link.name, kind: 'conflict', reason: `restoring ${link.qid} to ${to}, which already links ${own}; ${to} keeps ${own}`, keptPersonId: to, keptQid: own, ...(date ? { date } : {}) });
      continue;
    }
    const other = taken.get(link.qid);
    if (other && other !== to) {
      conflicts.push({ qid: link.qid, personId: to, name: link.name, kind: 'conflict', reason: `restoring ${link.qid} to ${to}, but it is linked to ${other}; ${other} keeps it`, keptPersonId: other, keptQid: link.qid, ...(date ? { date } : {}) });
      continue;
    }
    if (merged.persons[to]?.qid === link.qid) continue;
    merged.persons[to] = link;
    taken.set(link.qid, to);
    restored.push({ qid: link.qid, to, name: link.name });
  }
  merged.persons = Object.fromEntries(Object.entries(merged.persons).sort(([a], [b]) => Number(a) - Number(b)));
  return { doc: merged, restored, conflicts, removals: changes.removals };
}

/**
 * The items an earlier crosswalk names (as a link or a merge lead) that a later one names
 * nowhere, less those a removal list accounts for: what check:wikidata-persons fails on.
 * @param {{ persons?: Record<string, { qid: string }>, mergeLeads?: { wikidata: string, persons?: { personId: string }[] }[] }} earlier
 * @param {{ persons?: Record<string, { qid: string }>, mergeLeads?: { wikidata: string }[] }} later
 * @param {Iterable<string>} [accounted]  items listed in wikidata-persons-removals.json
 * @returns {{ qid: string, personIds: string[] }[]}
 */
export function lostQids(earlier, later, accounted = []) {
  const now = new Set([...Object.values(later.persons || {}).map((e) => e.qid), ...(later.mergeLeads || []).map((l) => l.wikidata)]);
  const ok = new Set(accounted);
  /** @type {Map<string, string[]>} */
  const before = new Map();
  for (const [id, e] of Object.entries(earlier.persons || {})) before.set(e.qid, [...(before.get(e.qid) || []), id]);
  for (const l of earlier.mergeLeads || []) if (!before.has(l.wikidata)) before.set(l.wikidata, (l.persons || []).map((p) => String(p.personId)));
  return [...before].filter(([q]) => !now.has(q) && !ok.has(q)).map(([qid, personIds]) => ({ qid, personIds }));
}

/**
 * Validate wikidata-persons-removals.json: every entry names an item, a person and a kind, and
 * gives its reason.
 * @param {{ conflicts?: WikidataRemoval[], removals?: WikidataRemoval[], [key: string]: unknown }} doc
 * @returns {string[]} errors
 */
export function validateRemovals(doc) {
  /** @type {string[]} */
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['not a JSON object'];
  if (doc.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  for (const key of /** @type {const} */ (['conflicts', 'removals'])) {
    if (!Array.isArray(doc[key])) { errors.push(`${key} must be a list`); continue; }
    for (const [i, r] of /** @type {WikidataRemoval[]} */ (doc[key]).entries()) {
      const at = `${key}[${i}]`;
      if (!QID.test(r?.qid || '')) errors.push(`${at}: qid ${JSON.stringify(r?.qid)} is not a Wikidata item id`);
      if (!String(r?.personId || '').split(' ').every((p) => PERSON_ID.test(p))) errors.push(`${at}: personId must name the person id(s) it was linked to`);
      if (!REMOVAL_KINDS.includes(r?.kind)) errors.push(`${at}: kind must be one of ${REMOVAL_KINDS.join(', ')}`);
      if (typeof r?.reason !== 'string' || r.reason.trim().length < 10) errors.push(`${at}: a reason is required`);
    }
  }
  return errors;
}

/**
 * Add new conflicts and removals to the removal list, once each (by kind, item and person).
 * @param {{ conflicts?: WikidataRemoval[], removals?: WikidataRemoval[], [key: string]: unknown }} doc
 * @param {WikidataRemoval[]} conflicts
 * @param {WikidataRemoval[]} removals
 */
export function addRemovals(doc, conflicts, removals) {
  const key = (/** @type {WikidataRemoval} */ r) => `${r.kind}|${r.qid}|${r.personId}`;
  const out = { ...doc, conflicts: [...(doc.conflicts || [])], removals: [...(doc.removals || [])] };
  const seen = new Set([...out.conflicts, ...out.removals].map(key));
  for (const r of conflicts) if (!seen.has(key(r))) { out.conflicts.push(r); seen.add(key(r)); }
  for (const r of removals) if (!seen.has(key(r))) { out.removals.push(r); seen.add(key(r)); }
  return out;
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
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
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
    if (!Array.isArray(entry.evidence) || !entry.evidence.length || entry.evidence.some((/** @type {unknown} */ e) => typeof e !== 'string' || !e)) {
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
