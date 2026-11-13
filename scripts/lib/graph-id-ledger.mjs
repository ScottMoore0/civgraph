/**
 * The ledger of published graph entity ids (data/elections/published-graph-ids.json).
 *
 * The semantic graph names a contest, an election and a person by an id made from its key
 * (graph-entity-id.mjs): `cg:contest:<election key>-<contest key>`, `cg:election:<slug>`,
 * `cg:person:<name>-<person id>`. A renamed contest or division, a merged person and a renamed
 * person all get a new id, and /_api/graph?entity=<old id> found nothing: the graph had no alias
 * table (w8-redirects, 12 Nov 2026).
 *
 * The ledger keeps every contest, election and person id a build published, with the Browse
 * slug its entity had. It only grows. At each graph build an id of the ledger that the build no
 * longer has is answered by the entity it became, worked out from the tables that already say so:
 *   - a contest or election: its Browse slug through the retired-slug tables
 *     (packages/core/src/election-slug-aliases.js), then the entity with that slug;
 *   - a person: the person id at the end of its slug through the person-id merges
 *     (person_id_confirmed_merges.csv and person_id_merges.csv, read by readPersonMerges), then
 *     the entity of the person kept, whatever their name is now.
 * The graph build writes the answers to indexes/entity-aliases.json, the records load puts them
 * in graph_browse_keys as `alias:<old id>` (and `slug:<old readable slug>`), and /_api/graph
 * answers an old id with its entity. The ids a renamed contest had before the ledger began
 * (6 Nov 2026) are worked out from the retired slugs the same way (derivedAliases).
 *
 * scripts/build/build-graph-id-ledger.mjs grows the ledger after a records build;
 * tests/records/published-graph-ids.test.mjs fails the records check when an id of the ledger
 * no longer answers. Everything here takes data and returns data, except readGraphLedger.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELECTION_SLUG_ALIASES, RETIRED_CONTEST_SLUGS, resolveElectionSlugAlias } from '../../packages/core/src/election-slug-aliases.js';
import { makeEntityId, slugify } from './graph-entity-id.mjs';
import { resolvePersonId } from './person-address-ledger.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GRAPH_LEDGER_FILE = path.join(ROOT, 'data', 'elections', 'published-graph-ids.json');
export const GRAPH_LEDGER_DESCRIPTION = 'Every contest, election and person id the semantic graph published, by type: the id after cg:<type>: with the Browse slug its entity had ("=" the same text, "" none). Entries are only added (scripts/build/build-graph-id-ledger.mjs, after each records build); the graph build answers an id it no longer has with the entity it became (through the retired election slugs and the person-id merges), and the records check fails when an id stops answering (scripts/lib/graph-id-ledger.mjs).';

/** The entity types whose ids the ledger keeps. */
export const LEDGER_TYPES = /** @type {const} */ (['contest', 'election', 'person']);
/** @typedef {typeof LEDGER_TYPES[number]} LedgerType */

/**
 * @typedef {object} GraphLedger
 * @property {number} schemaVersion
 * @property {string} [description]
 * @property {Record<LedgerType, Record<string, string>>} ids  type -> id after `cg:<type>:` -> its Browse slug ("=" the same, "" none)
 */

/**
 * @typedef {object} GraphEntityRow  a built graph entity, as far as the ledger needs it
 * @property {string} id
 * @property {string} [browseSlug]
 * @property {string} [electionKey]  a contest's election key (attributes.electionKey)
 */

/**
 * @typedef {object} GraphAliases
 * @property {Record<string, string>} ids    old entity id -> the live entity id it answers with
 * @property {Record<string, string>} slugs  old readable slug -> the live entity id it answers with
 * @property {string[]} unresolved           ledger ids the build has not and cannot answer
 */

/** @returns {GraphLedger} */
export function emptyGraphLedger() {
  return { schemaVersion: 1, ids: { contest: {}, election: {}, person: {} } };
}

/**
 * The ledger type of an id, or null for an id of another type.
 * @param {string} id
 * @returns {LedgerType | null}
 */
export function ledgerType(id) {
  const type = String(id).split(':')[1];
  return /** @type {readonly string[]} */ (LEDGER_TYPES).includes(type) && String(id).startsWith(`cg:${type}:`) ? /** @type {LedgerType} */ (type) : null;
}

/**
 * Every id of the ledger with the Browse slug its entity had ('' none).
 * @param {GraphLedger} ledger
 * @returns {[string, string][]}
 */
export function ledgerEntries(ledger) {
  /** @type {[string, string][]} */
  const out = [];
  for (const type of LEDGER_TYPES) {
    for (const [rest, slug] of Object.entries(ledger.ids[type] || {})) out.push([`cg:${type}:${rest}`, slug === '=' ? rest : slug]);
  }
  return out;
}

/**
 * The ledger with the built entities' contest, election and person ids added. An entry already
 * there is never changed.
 * @param {GraphLedger} ledger
 * @param {GraphEntityRow[]} entities
 * @returns {{ ledger: GraphLedger, added: number }}
 */
export function growGraphLedger(ledger, entities) {
  /** @type {GraphLedger} */
  const next = { ...ledger, ids: { contest: { ...ledger.ids.contest }, election: { ...ledger.ids.election }, person: { ...ledger.ids.person } } };
  let added = 0;
  for (const entity of entities) {
    const type = ledgerType(entity.id);
    if (!type) continue;
    const rest = entity.id.slice(`cg:${type}:`.length);
    if (Object.hasOwn(next.ids[type], rest)) continue;
    const slug = String(entity.browseSlug || '');
    next.ids[type][rest] = slug && slug === rest ? '=' : slug;
    added += 1;
  }
  return { ledger: next, added };
}

export const PERSON_NAME_REDIRECTS_FILE = path.join(ROOT, 'data', 'elections', 'persons', 'person-name-redirects.csv');

/**
 * A PERSON OF NAME-ONLY ROWS WHOSE ROWS FIND THEIR PERSON. Rows the registry cannot give an id
 * made a person of their own, named by the name alone (cg:person:paddy-burke: the 1999 Castlebar
 * row of the senator Paddy Burke); once the rows are given to their person, that id has no
 * number to follow through the merges. data/elections/persons/person-name-redirects.csv names the
 * person id each such slug's rows went to. Returns slug -> person id.
 * @param {string} [file]
 * @returns {Map<string, string>}
 */
export function readPersonNameRedirects(file = PERSON_NAME_REDIRECTS_FILE) {
  if (!existsSync(file)) return new Map();
  const [head, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  const [slugAt, keepAt] = [cols.indexOf('name_slug'), cols.indexOf('keep')];
  return new Map(lines.map((line) => line.split(',')).map((row) => [row[slugAt], row[keepAt]]));
}

/** The person id a person entity's slug ends with ("dawson-bates-104451" -> "104451"), or null. */
export function personNumber(/** @type {string} */ slug) {
  return /-(\d+)$/.exec(String(slug))?.[1] ?? null;
}

/**
 * The live entities by type and Browse slug, and the live persons by person id. The first entity
 * (by id) holds a slug two share.
 * @param {GraphEntityRow[]} entities
 */
function liveIndex(entities) {
  /** @type {Map<string, GraphEntityRow>} */
  const byTypeSlug = new Map();
  /** @type {Map<string, string>} */
  const personById = new Map();
  for (const entity of [...entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const type = ledgerType(entity.id);
    if (!type || !entity.browseSlug) continue;
    const key = `${type}|${String(entity.browseSlug).toLowerCase()}`;
    if (!byTypeSlug.has(key)) byTypeSlug.set(key, entity);
    const number = type === 'person' ? personNumber(entity.browseSlug) : null;
    if (number && !personById.has(number)) personById.set(number, entity.id);
  }
  return { byTypeSlug, personById };
}

/**
 * The live contest or election entity a Browse slug names now: the slug through the retired-slug
 * tables, then an entity of the same type with it, else of the other (a retired contest may
 * now be its round's page).
 * @param {ReturnType<typeof liveIndex>} live
 * @param {'contest' | 'election'} type
 * @param {string} slug
 * @param {(slug: string) => string} resolveSlug
 * @returns {GraphEntityRow | null}
 */
function liveForSlug(live, type, slug, resolveSlug) {
  const target = resolveSlug(slug);
  const other = type === 'contest' ? 'election' : 'contest';
  return live.byTypeSlug.get(`${type}|${target}`) || live.byTypeSlug.get(`${other}|${target}`) || null;
}

/**
 * The retired slugs and the slugs they answer with now: each retired contest slug, and each
 * live slug a retired prefix (a renamed body's round) continues, with the prefix put back.
 * @param {Iterable<string>} liveSlugs
 * @param {{ retiredContestSlugs?: readonly (readonly string[])[], electionSlugAliases?: readonly (readonly string[])[] }} [tables]
 * @returns {[string, string][]} [old slug, live slug]
 */
export function retiredSlugPairs(liveSlugs, { retiredContestSlugs = RETIRED_CONTEST_SLUGS, electionSlugAliases = ELECTION_SLUG_ALIASES } = {}) {
  /** @type {[string, string][]} */
  const pairs = retiredContestSlugs.map(([from, to]) => /** @type {[string, string]} */ ([from, to]));
  for (const slug of liveSlugs) {
    for (const [from, to] of electionSlugAliases) {
      if (slug === to || slug.startsWith(`${to}-`)) pairs.push([from + slug.slice(to.length), slug]);
    }
  }
  return pairs;
}

/**
 * What every id of the ledger answers with in this build: itself while the build has it, else
 * the entity it became (a contest or election through its Browse slug and the retired-slug
 * tables, a person through the person-id merges), plus the ids a retired slug had before the
 * ledger began. Each old id's readable slug answers with the same entity.
 * @param {GraphLedger} ledger
 * @param {GraphEntityRow[]} entities  the built graph's entities (at least its contests, elections and persons)
 * @param {{ keepOf: Map<string, string>, nameKeepOf?: Map<string, string>, resolveSlug?: (slug: string) => string, retiredContestSlugs?: readonly (readonly string[])[], electionSlugAliases?: readonly (readonly string[])[] }} options
 *   keepOf: dropped person id -> kept person id (personKeepOf)
 *   nameKeepOf: a person slug without a number (a person of name-only rows) -> the person id its
 *     rows went to (readPersonNameRedirects)
 * @returns {GraphAliases}
 */
export function graphEntityAliases(ledger, entities, { keepOf, nameKeepOf = new Map(), resolveSlug = resolveElectionSlugAlias, ...tables }) {
  const liveIds = new Set(entities.map((e) => e.id));
  const live = liveIndex(entities);
  const livePersons = new Set(live.personById.keys());
  /** @type {Record<string, string>} */
  const ids = {};
  /** @type {Record<string, string>} */
  const slugs = {};
  /** @type {string[]} */
  const unresolved = [];
  const addSlug = (/** @type {string} */ slug, /** @type {string} */ id) => {
    const readable = slugify(slug);
    if (slug && !Object.hasOwn(slugs, readable)) slugs[readable] = id;
  };

  for (const [id, slug] of ledgerEntries(ledger)) {
    if (liveIds.has(id)) continue;
    const type = /** @type {LedgerType} */ (ledgerType(id));
    let target = null;
    if (type === 'person') {
      const number = personNumber(slug || id) ?? nameKeepOf.get(slug || id.slice('cg:person:'.length)) ?? null;
      const kept = number ? resolvePersonId(number, livePersons, keepOf) : null;
      target = kept ? live.personById.get(kept) || null : null;
    } else if (slug) {
      target = liveForSlug(live, type, slug, resolveSlug)?.id || null;
    }
    if (!target) { unresolved.push(id); continue; }
    ids[id] = target;
    addSlug(slug, target);
  }

  // Before the ledger: the election id of a retired slug (its key is the slug), and the contest
  // id (the live contest's election key with the old slug as the contest key).
  const liveSlugs = new Set([...live.byTypeSlug.keys()].map((key) => key.slice(key.indexOf('|') + 1)));
  for (const [from, to] of retiredSlugPairs(liveSlugs, tables)) {
    for (const type of /** @type {const} */ (['election', 'contest'])) {
      const entity = live.byTypeSlug.get(`${type}|${to}`);
      if (!entity) continue;
      const old = type === 'election' ? makeEntityId('election', from) : entity.electionKey ? makeEntityId('contest', `${entity.electionKey}::${from}`) : null;
      if (old && !liveIds.has(old) && !Object.hasOwn(ids, old)) ids[old] = entity.id;
    }
    const entity = liveForSlug(live, 'contest', to, (s) => s);
    if (entity) addSlug(from, entity.id);
  }
  return { ids: sortKeys(ids), slugs: sortKeys(slugs), unresolved: unresolved.sort() };
}

/**
 * The ids of the ledger that no longer answer: neither built nor aliased to a built entity.
 * @param {GraphLedger} ledger
 * @param {{ liveIds: Set<string>, aliasOf: Map<string, string> }} published
 *   liveIds: the built graph's entity ids; aliasOf: old id -> entity id (the `alias:` keys)
 * @returns {string[]} one line per failure
 */
export function graphLedgerFailures(ledger, { liveIds, aliasOf }) {
  /** @type {string[]} */
  const failures = [];
  for (const [id] of ledgerEntries(ledger)) {
    if (liveIds.has(id)) continue;
    const target = aliasOf.get(id);
    if (!target) failures.push(`${id}: no longer in the graph and no alias answers it`);
    else if (!liveIds.has(target)) failures.push(`${id}: its alias ${target} is not in the graph`);
  }
  return failures;
}

/** What a records build publishes, read by publishedGraphFromRows. */
export const PUBLISHED_GRAPH_SQL = Object.freeze({
  /** -> { entity_id, entity }: the contests, elections and persons */
  entities: "SELECT entity_id, entity FROM graph_entities WHERE entity_id LIKE 'cg:contest:%' OR entity_id LIKE 'cg:election:%' OR entity_id LIKE 'cg:person:%' ORDER BY entity_id",
  /** -> { browse_key, entity_id }: the retired ids' aliases */
  aliases: "SELECT browse_key, entity_id FROM graph_browse_keys WHERE browse_key LIKE 'alias:%' ORDER BY browse_key",
});

/**
 * A records build's graph, from its graph_entities rows (entity_id, entity JSON) and its
 * alias: rows of graph_browse_keys.
 * @param {{ entity_id: unknown, entity: unknown }[]} entityRows
 * @param {{ browse_key: unknown, entity_id: unknown }[]} aliasRows
 * @returns {{ entities: GraphEntityRow[], liveIds: Set<string>, aliasOf: Map<string, string> }}
 */
export function publishedGraphFromRows(entityRows, aliasRows) {
  const entities = entityRows.map((row) => {
    const entity = JSON.parse(String(row.entity || '{}'));
    return { id: String(row.entity_id), browseSlug: entity.browseSlug || undefined, electionKey: entity.attributes?.electionKey || undefined };
  });
  const aliasOf = new Map(aliasRows.map((row) => [String(row.browse_key).slice('alias:'.length), String(row.entity_id)]));
  return { entities, liveIds: new Set(entities.map((e) => e.id)), aliasOf };
}

/** @template T @param {Record<string, T>} record @returns {Record<string, T>} */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** @returns {GraphLedger} the ledger file, or an empty ledger when there is none */
export function readGraphLedger(file = GRAPH_LEDGER_FILE) {
  if (!existsSync(file)) return emptyGraphLedger();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const empty = emptyGraphLedger();
  return { ...doc, ids: { contest: doc.ids?.contest || empty.ids.contest, election: doc.ids?.election || empty.ids.election, person: doc.ids?.person || empty.ids.person } };
}

/**
 * The file's text: one entry per line, sorted, so each build's additions are a small diff.
 * @param {GraphLedger} ledger
 * @returns {string}
 */
export function graphLedgerText(ledger) {
  const block = (/** @type {Record<string, string>} */ map) => {
    const lines = Object.keys(map).sort().map((key) => `      ${JSON.stringify(key)}: ${JSON.stringify(map[key])}`);
    return lines.length ? `{\n${lines.join(',\n')}\n    }` : '{}';
  };
  const types = LEDGER_TYPES.map((type) => `    ${JSON.stringify(type)}: ${block(ledger.ids[type] || {})}`).join(',\n');
  return `{\n  "schemaVersion": ${ledger.schemaVersion || 1},\n  "description": ${JSON.stringify(ledger.description || GRAPH_LEDGER_DESCRIPTION)},\n  "ids": {\n${types}\n  }\n}\n`;
}
