/**
 * The ledger of published person addresses (data/elections/persons/published-person-addresses.json).
 *
 * A person page answers at /browse/persons/<slug>, where the slug is the name and the person id,
 * and at two name keys while the name is one person's: `name-<name>` (the pre-registry address)
 * and `<name>` (build-browse-indexes.mjs, "Old person URLs, kept resolvable"). Name keys are
 * worked out afresh at every build, so a person who is renamed or merged, or whose name another
 * person comes to share, loses them: wave 7 (12 Nov 2026) dropped about 200 that the site had
 * published (name-hon-c-l-corry, now Lowry-Corry).
 *
 * The ledger keeps every name key a build published, with the person id it answered with, and
 * every person id that had a page. It only grows:
 *   - build-browse-indexes.mjs gives each ledger key back to its person (followed through the
 *     person-id merges to the person kept), ahead of the key a fresh build would compute;
 *   - scripts/build/build-person-address-ledger.mjs adds what a build publishes (run after each
 *     records build, before the publish);
 *   - tests/records/published-person-addresses.test.mjs fails the records check when a key or
 *     id of the ledger no longer answers, or answers with another person.
 * A temporary id of the merge log (dropped in the rebuild that issued it) never had a page, so it
 * is never in the ledger.
 *
 * The functions take data and return data, except readLedger, ledgerText and personKeepOf, which
 * read and format the files.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPersonMerges } from '../../packages/loader/src/ingest-registries.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER_FILE = path.join(ROOT, 'data', 'elections', 'persons', 'published-person-addresses.json');
export const LEDGER_DESCRIPTION = 'Every person address a build published: aliases holds each name key (name-<name> and <name>) with the person id it answered with when first published; ids every person id that had a page. Entries are only added (scripts/build/build-person-address-ledger.mjs, after each records build); the Browse build gives each key back to its person through the person-id merges, and the records check fails when a key or id stops answering (scripts/lib/person-address-ledger.mjs).';

/**
 * @typedef {object} AddressLedger
 * @property {number} schemaVersion
 * @property {string} [description]
 * @property {Record<string, string>} aliases  name key -> the person id it answered with when first published
 * @property {string[]} ids                    every person id that had a page, ascending
 */

/**
 * @typedef {object} PersonItem  a Browse person record, as far as the ledger needs it
 * @property {string | number} id
 * @property {string} slug
 * @property {string[]} [previousSlugs]
 */

const PERSON_ID = /^[1-9]\d*$/;

/** A key of the ledger's aliases: a name key, never a bare person id (those are merges). */
export function isNameKey(/** @type {unknown} */ alias) {
  return typeof alias === 'string' && alias !== '' && !/^\d+$/.test(alias);
}

/** @returns {AddressLedger} */
export function emptyLedger() {
  return { schemaVersion: 1, aliases: {}, ids: [] };
}

/**
 * The live person an id answers with: itself while it has a page, else the person its merges
 * lead to (followed only while the id reached has no page, as the loader does), else null.
 * @param {string | number} id
 * @param {Set<string>} liveIds
 * @param {Map<string, string>} keepOf  drop id -> keep id
 * @returns {string | null}
 */
export function resolvePersonId(id, liveIds, keepOf) {
  let at = String(id);
  for (let hops = 0; !liveIds.has(at) && keepOf.has(at) && hops < 10; hops += 1) at = /** @type {string} */ (keepOf.get(at));
  return liveIds.has(at) ? at : null;
}

/**
 * The ledger with what these records publish added: each record's name keys (previousSlugs
 * that are not ids) and each numeric person id. An entry already there is never changed, so a
 * key keeps the person it was first published for.
 * @param {AddressLedger} ledger
 * @param {PersonItem[]} items
 * @returns {{ ledger: AddressLedger, addedAliases: number, addedIds: number }}
 */
export function growLedger(ledger, items) {
  const aliases = { ...ledger.aliases };
  const ids = new Set(ledger.ids.map(String));
  let addedAliases = 0;
  let addedIds = 0;
  for (const item of items) {
    const id = String(item.id);
    if (!PERSON_ID.test(id)) continue;
    if (!ids.has(id)) { ids.add(id); addedIds += 1; }
    for (const alias of item.previousSlugs || []) {
      if (isNameKey(alias) && !Object.hasOwn(aliases, alias)) { aliases[alias] = id; addedAliases += 1; }
    }
  }
  const sortedAliases = Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const sortedIds = [...ids].sort((a, b) => Number(a) - Number(b));
  return { ledger: { ...ledger, aliases: sortedAliases, ids: sortedIds }, addedAliases, addedIds };
}

/**
 * Each record's previousSlugs with the ledger applied: a ledger key goes to the person it was
 * published for (followed through merges), and leaves any other record that a fresh build gave
 * it to. A key that is a record's own slug stays that record's. Keys whose person no longer
 * resolves are left as the build had them and returned as unresolved.
 * @param {AddressLedger} ledger
 * @param {PersonItem[]} items
 * @param {Map<string, string>} keepOf
 * @returns {{ previousSlugs: Map<string, string[]>, restored: number, moved: number, unresolved: [string, string][] }}
 *   previousSlugs: record id -> its new list, for the records whose list changes
 */
export function applyLedger(ledger, items, keepOf) {
  const liveIds = new Set(items.map((item) => String(item.id)));
  const liveSlugs = new Set(items.map((item) => item.slug));
  /** @type {Map<string, string>} name key -> the record id it belongs to now */
  const owner = new Map();
  /** @type {[string, string][]} */
  const unresolved = [];
  for (const [alias, id] of Object.entries(ledger.aliases)) {
    if (!isNameKey(alias) || liveSlugs.has(alias)) continue;
    const to = resolvePersonId(id, liveIds, keepOf);
    if (to) owner.set(alias, to); else unresolved.push([alias, String(id)]);
  }
  /** @type {Map<string, string[]>} */
  const previousSlugs = new Map();
  /** @type {Map<string, string[]>} */
  const claimed = new Map();
  for (const [alias, id] of owner) claimed.set(id, [...(claimed.get(id) || []), alias]);
  let restored = 0;
  let moved = 0;
  for (const item of items) {
    const id = String(item.id);
    const had = item.previousSlugs || [];
    const kept = had.filter((alias) => !owner.has(alias) || owner.get(alias) === id);
    moved += had.length - kept.length;
    const added = (claimed.get(id) || []).filter((alias) => !kept.includes(alias));
    restored += added.length;
    if (added.length || kept.length !== had.length) previousSlugs.set(id, [...kept, ...added.sort()]);
  }
  return { previousSlugs, restored, moved, unresolved };
}

/**
 * What a records build publishes, from its person_cards (id, slug) and person_aliases (alias,
 * slug) rows: the records with the name keys that answer with them, the live ids' slugs and the
 * alias table.
 * @param {{ id: unknown, slug: unknown }[]} cards
 * @param {{ alias: unknown, slug: unknown }[]} aliasRows
 * @returns {{ items: PersonItem[], slugById: Map<string, string>, aliasSlug: Map<string, string> }}
 */
export function publishedFromRows(cards, aliasRows) {
  const slugById = new Map(cards.map((card) => [String(card.id), String(card.slug)]));
  const aliasSlug = new Map(aliasRows.map((row) => [String(row.alias), String(row.slug)]));
  const idBySlug = new Map([...slugById].map(([id, slug]) => [slug, id]));
  /** @type {Map<string, string[]>} */
  const keys = new Map();
  for (const [alias, slug] of aliasSlug) {
    const id = idBySlug.get(slug);
    if (id && isNameKey(alias)) keys.set(id, [...(keys.get(id) || []), alias]);
  }
  const items = [...slugById].map(([id, slug]) => ({ id, slug, previousSlugs: keys.get(id) || [] }));
  return { items, slugById, aliasSlug };
}

/**
 * What no longer answers as the ledger says: each name key must answer with the person it was
 * published for (after merges), and each id must still answer (a page, or a merge to one).
 * @param {AddressLedger} ledger
 * @param {{ slugById: Map<string, string>, aliasSlug: Map<string, string>, keepOf: Map<string, string> }} published
 *   slugById: the live records' ids and slugs; aliasSlug: the alias table (alias -> slug)
 * @returns {string[]} one line per failure
 */
export function ledgerFailures(ledger, { slugById, aliasSlug, keepOf }) {
  const liveIds = new Set(slugById.keys());
  const idBySlug = new Map([...slugById].map(([id, slug]) => [slug, id]));
  /** @type {string[]} */
  const failures = [];
  for (const [alias, id] of Object.entries(ledger.aliases)) {
    const want = resolvePersonId(id, liveIds, keepOf);
    if (!want) { failures.push(`${alias}: person ${id} no longer has a page or a merge to one`); continue; }
    const slug = idBySlug.has(alias) ? alias : aliasSlug.get(alias);
    if (!slug) failures.push(`${alias}: no longer answers (was person ${id}, now ${slugById.get(want)})`);
    else if (idBySlug.get(slug) !== want) failures.push(`${alias}: answers with ${slug}, not ${slugById.get(want)} (person ${id})`);
  }
  for (const id of ledger.ids) {
    const want = resolvePersonId(id, liveIds, keepOf);
    if (!want) failures.push(`person ${id}: no longer has a page or a merge to one`);
    else if (want !== String(id) && !aliasSlug.has(String(id))) failures.push(`person ${id}: merged into ${want} but the alias table has no row for it`);
  }
  return failures;
}

/** @returns {AddressLedger} the ledger file, or an empty ledger when there is none */
export function readLedger(file = LEDGER_FILE) {
  if (!existsSync(file)) return emptyLedger();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  return { ...doc, aliases: doc.aliases || {}, ids: (doc.ids || []).map(String) };
}

/**
 * The file's text: one entry per line, so each build's additions are a small diff.
 * @param {AddressLedger} ledger
 */
export function ledgerText(ledger) {
  const { aliases, ids, ...head } = ledger;
  const lines = Object.entries(aliases).map(([alias, id]) => `    ${JSON.stringify(alias)}: ${JSON.stringify(String(id))}`);
  const out = ['{'];
  for (const [key, value] of Object.entries(head)) out.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  out.push('  "aliases": {', lines.join(',\n'), '  },', '  "ids": [');
  out.push(ids.map((id) => `    ${JSON.stringify(String(id))}`).join(',\n'), '  ]', '}', '');
  return out.join('\n');
}

/** @returns {Map<string, string>} drop id -> keep id, from the person-id merge files */
export function personKeepOf(root = ROOT) {
  return new Map(readPersonMerges(root).map((row) => [String(row.drop), String(row.keep)]));
}
