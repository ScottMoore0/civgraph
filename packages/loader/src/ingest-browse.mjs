/**
 * Browse records into the records tables, stored as the Browse build wrote them (phase 2):
 * person, source, register-of-interests, party and election cards with their details, the
 * facet options, old addresses, and the small whole documents (index.json, label folds, the
 * manifests of the sharded indexes). Wrappers (schemaVersion, generatedAt) are dropped, so an
 * unchanged record hashes the same from one build to the next.
 *
 * The card columns, search text and lookup key are exactly those of
 * packages/loader/src/browse-columns.mjs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ENTITIES, searchText } from './browse-columns.mjs';
import { TableWriter, int, readJson, transaction, txt } from './db.mjs';
import { localPathForUrl, recordPaths } from './paths.mjs';

/** @typedef {import('./browse-columns.mjs').BrowseItem} BrowseItem */
/** @typedef {import('./browse-columns.mjs').EntitySpec} EntitySpec */
/** @typedef {import('./db.mjs').DocumentRow} DocumentRow */
/** @typedef {ReturnType<typeof recordPaths>} RecordPaths */

/**
 * Read a sharded index the way browse.js does (its readIndex).
 * @param {string} file
 * @param {RecordPaths} paths
 * @returns {{ manifest: Record<string, unknown>, items: BrowseItem[] }}
 */
function readIndex(file, paths) {
  const manifest = readJson(file);
  if (manifest.indexLayout !== 'sharded' || !Array.isArray(manifest.shards)) {
    return { manifest, items: Array.isArray(manifest.items) ? manifest.items : [] };
  }
  /** @type {BrowseItem[]} */
  const items = [];
  for (const shard of /** @type {{ url: string }[]} */ (manifest.shards)) {
    const shardFile = localPathForUrl(shard.url, paths);
    if (!shardFile || !existsSync(shardFile)) throw new Error(`shard missing on disk: ${shard.url}`);
    items.push(...(readJson(shardFile).items || []));
  }
  return { manifest, items };
}

/**
 * The document without its build stamp (generatedAt).
 * @param {Record<string, unknown>} doc
 * @returns {Record<string, unknown>}
 */
const strip = (doc) => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const { generatedAt: _g, ...rest } = doc;
  return rest;
};

/**
 * Card columns of one ENTITIES spec, as the old import computed them.
 * @param {EntitySpec} spec
 * @param {BrowseItem} item
 */
function cardColumns(spec, item) {
  const title = spec.title(item);
  /** @type {Record<string, unknown>} */
  const cols = {
    slug: item.slug,
    id: txt(item.id),
    title: txt(title),
    title_norm: String(title || '').toLowerCase(),
    key_norm: spec.key(item),
    search_norm: searchText(item),
  };
  for (const [col, fn] of Object.entries(spec.extra || {})) cols[col] = fn(item);
  return cols;
}

/**
 * @param {EntitySpec} spec
 * @param {BrowseItem[]} items
 */
function facetOptions(spec, items) {
  /** @type {Record<string, string[]>} */
  const facets = {};
  for (const [facetKey, extract] of Object.entries(spec.facets || {})) {
    /** @type {Set<string>} */
    const values = new Set();
    for (const item of items) for (const value of extract(item) || []) if (value) values.add(String(value));
    facets[facetKey] = [...values].sort((a, b) => a.localeCompare(b));
  }
  return facets;
}

/**
 * previousSlugs -> slug, first claim wins, never shadowing a live slug (the old import's rule).
 * @param {BrowseItem[]} items
 * @returns {{ alias: string, slug: string | undefined }[]}
 */
function aliasRows(items) {
  const live = new Set(items.map((item) => item.slug));
  /** @type {Map<string, string | undefined>} */
  const aliases = new Map();
  for (const item of items) {
    for (const alias of item.previousSlugs || []) {
      if (alias && !live.has(alias) && !aliases.has(alias)) aliases.set(alias, item.slug);
    }
  }
  return [...aliases].map(([alias, slug]) => ({ alias, slug }));
}

/**
 * @param {import('../../storage/src/sqlite.mjs').SqliteHandle} db
 * @param {{ browseDir: string, paths?: RecordPaths }} options
 */
export function ingestBrowse(db, { browseDir, paths = recordPaths() }) {
  const at = (/** @type {string[]} */ ...parts) => path.join(browseDir, ...parts);
  /** @type {DocumentRow[]} */
  const docs = [];
  const doc = (/** @type {string} */ name, /** @type {unknown} */ body) => docs.push({ name, body: JSON.stringify(body) });
  /** @type {Record<string, number>} */
  const out = {};

  transaction(db, () => {
    // ---- persons
    {
      const { manifest, items } = readIndex(at('persons.json'), paths);
      const cards = new TableWriter(db, 'person_cards');
      items.forEach((item, ord) => {
        const cols = cardColumns(ENTITIES.persons, item);
        cards.add({
          ...cols,
          first_year: cols.first_year, last_year: cols.last_year,
          ord, card: JSON.stringify(item),
        });
      });
      out.person_cards = cards.finish();
      const aliases = new TableWriter(db, 'person_aliases');
      const personAliases = aliasRows(items);
      // A person id merged away (person_id_merges.csv, person_id_confirmed_merges.csv) answers
      // with the person it was merged into, followed through chains of merges.
      const slugById = new Map(items.map((item) => [String(item.id), item.slug]));
      const taken = new Set([...items.map((item) => item.slug), ...items.map((item) => String(item.id)), ...personAliases.map((a) => a.alias)]);
      const keepOf = new Map(db.prepare('SELECT drop_id, keep_id FROM person_merges ORDER BY drop_id').all().map((r) => /** @type {[string, string]} */ ([String(r.drop_id), String(r.keep_id)])));
      for (const drop of [...keepOf.keys()].sort()) {
        // Followed only while the id reached is not a live person: a merge row whose drop id
        // still holds a person (a temporary id a later rebuild gave back) must not carry the
        // chain past it to an id that no longer exists (142098 -> 47167, a live person, not on
        // to 102344).
        let keep = /** @type {string} */ (keepOf.get(drop));
        for (let hops = 0; !slugById.has(keep) && keepOf.has(keep) && hops < 10; hops += 1) keep = /** @type {string} */ (keepOf.get(keep));
        if (!taken.has(drop) && slugById.has(keep)) {
          personAliases.push({ alias: drop, slug: slugById.get(keep) });
          taken.add(drop);
        }
      }
      for (const row of personAliases) aliases.add(row);
      out.person_aliases = aliases.finish();
      const facets = readJson(at('persons-facets.json'), null);
      if (facets) new TableWriter(db, 'person_cards_facets').add({ id: 1, facets: JSON.stringify(facets.facets || {}) });
      doc('browse/persons.json', strip(manifest));
      if (facets) doc('browse/persons-facets.json', strip(facets));
    }

    // ---- register of interests
    {
      const { manifest, items } = readIndex(at('register-interests.json'), paths);
      const details = new Map();
      for (const url of new Set(items.map((item) => item.detailUrl).filter(Boolean))) {
        const shard = readJson(localPathForUrl(url, paths), null);
        for (const record of shard?.interests || shard?.items || []) details.set(String(record.id), record);
      }
      const w = new TableWriter(db, 'register_entries');
      items.forEach((item, ord) => {
        const detail = details.get(String(item.id));
        w.add({ ...cardColumns(ENTITIES['register-interests'], item), ord, card: JSON.stringify(item), detail: detail ? JSON.stringify(detail) : null });
      });
      out.register_entries = w.finish();
      new TableWriter(db, 'register_entries_facets').add({ id: 1, facets: JSON.stringify(facetOptions(ENTITIES['register-interests'], items)) });
      const aliases = new TableWriter(db, 'register_entries_aliases');
      for (const row of aliasRows(items)) aliases.add(row);
      out.register_entries_aliases = aliases.finish();
      doc('browse/register-interests.json', strip(manifest));
    }

    // ---- sources (card + the detail shard record)
    {
      const { manifest, items } = readIndex(at('sources.json'), paths);
      /** @type {Map<string, BrowseItem[]>} */
      const shards = new Map();
      const detailFor = (/** @type {BrowseItem} */ item) => {
        if (!item.detailUrl) return null;
        if (!shards.has(item.detailUrl)) shards.set(item.detailUrl, readJson(localPathForUrl(item.detailUrl, paths), { items: [] }).items || []);
        const slug = String(item.slug || '').toLowerCase();
        const id = String(item.id || '').toLowerCase();
        return /** @type {BrowseItem[]} */ (shards.get(item.detailUrl)).find((c) => String(c.slug || '').toLowerCase() === slug || String(c.id || '').toLowerCase() === id) || null;
      };
      const w = new TableWriter(db, 'sources');
      items.forEach((item, ord) => {
        const detail = detailFor(item);
        w.add({ ...cardColumns(ENTITIES.sources, item), ord, card: JSON.stringify(item), detail: detail ? JSON.stringify(detail) : null });
      });
      out.sources = w.finish();
      new TableWriter(db, 'sources_facets').add({ id: 1, facets: JSON.stringify(facetOptions(ENTITIES.sources, items)) });
      const aliases = new TableWriter(db, 'source_aliases');
      for (const row of aliasRows(items)) aliases.add(row);
      out.source_aliases = aliases.finish();
      doc('browse/sources.json', strip(manifest));
      const merges = readJson(at('source-merges.json'), null);
      if (merges) {
        const m = new TableWriter(db, 'source_merges');
        (merges.items || []).forEach((/** @type {unknown} */ item, /** @type {number} */ ord) => m.add({ ord, item: JSON.stringify(item) }));
        out.source_merges = m.finish();
        const { items: _i, ...head } = strip(merges);
        doc('browse/source-merges.json', head);
      }
    }

    // ---- parties: card, detail, profile; retired slugs; the label map and the folds
    {
      /** @type {{ items?: BrowseItem[], [key: string]: unknown }} */
      const parties = readJson(at('parties.json'));
      const live = new Set((parties.items || []).map((p) => p.slug));
      const w = new TableWriter(db, 'party_cards');
      const readItem = (/** @type {string} */ dir, /** @type {string | undefined} */ slug) => {
        const file = at(dir, `${slug}.json`);
        return existsSync(file) ? readJson(file) : null;
      };
      (parties.items || []).forEach((item, ord) => {
        const detail = readItem(path.join('details', 'parties'), item.slug);
        const profile = readItem('party-profiles', item.slug);
        w.add({
          slug: item.slug, id: txt(item.id), title: txt(item.title), title_norm: String(item.title || '').toLowerCase(),
          search_norm: searchText(item), occurrences: int(item.occurrenceCount), ord,
          card: JSON.stringify(item), detail: detail ? JSON.stringify(detail.item ?? null) : null,
          profile: profile ? JSON.stringify(strip(profile)) : null,
        });
      });
      out.party_cards = w.finish();
      // A detail file under a slug no party has is a retired slug pointing at the party it now is.
      const aliases = new Map();
      for (const f of readdirSync(at('details', 'parties')).filter((x) => x.endsWith('.json')).sort()) {
        const slug = f.slice(0, -5);
        if (live.has(slug)) continue;
        const target = readJson(at('details', 'parties', f)).item?.slug;
        if (target && target !== slug && live.has(target)) aliases.set(slug, target);
      }
      for (const item of parties.items || []) {
        for (const alias of item.previousSlugs || []) if (alias && !live.has(alias) && !aliases.has(alias)) aliases.set(alias, item.slug);
      }
      const a = new TableWriter(db, 'party_aliases');
      for (const [alias, slug] of [...aliases].sort()) a.add({ alias, slug });
      out.party_aliases = a.finish();
      const { items: _p, ...partiesHead } = strip(parties);
      doc('browse/parties.json', partiesHead);

      const names = readJson(at('party-names.json'), { items: {} });
      const lm = new TableWriter(db, 'party_label_map');
      Object.entries(names.items || {}).forEach(([label, slug], ord) => lm.add({ label, party_slug: String(slug), ord }));
      out.party_label_map = lm.finish();
      const { items: _n, ...namesHead } = strip(names);
      doc('browse/party-names.json', namesHead);
      const folds = readJson(at('party-label-folds.json'), null);
      if (folds) doc('browse/party-label-folds.json', strip(folds));
    }

    // ---- offices (the facts model, scripts/build/build-office-pages.mjs): card and page
    {
      /** @type {{ items?: BrowseItem[], [key: string]: unknown } | null} */
      const offices = readJson(at('offices.json'), null);
      if (offices) {
        const w = new TableWriter(db, 'office_cards');
        (offices.items || []).forEach((item, ord) => {
          const file = at('details', 'offices', `${item.slug}.json`);
          const detail = existsSync(file) ? readJson(file) : null;
          const title = item.title || '';
          w.add({
            slug: item.slug, id: txt(item.id), title: txt(title), title_norm: String(title).toLowerCase(),
            search_norm: searchText(item), ord, card: JSON.stringify(item),
            detail: detail ? JSON.stringify(detail.item ?? null) : null,
          });
        });
        out.office_cards = w.finish();
        const { items: _o, ...officesHead } = strip(offices);
        doc('browse/offices.json', officesHead);
      }
    }

    // ---- elections: cards (elections.json + elections-list.json), details, contest shards
    {
      /** @type {{ items?: BrowseItem[], [key: string]: unknown }} */
      const full = readJson(at('elections.json'));
      /** @type {{ items?: BrowseItem[], [key: string]: unknown }} */
      const list = readJson(at('elections-list.json'), { items: [] });
      const listBySlug = new Map((list.items || []).map((item) => [item.slug, item]));
      const w = new TableWriter(db, 'election_cards');
      (full.items || []).forEach((item, ord) => {
        const electionKey = item.entryKind === 'election' ? item.key : (item.parentElectionKey || null);
        const title = item.title || '';
        w.add({
          slug: item.slug, id: txt(item.id), key: txt(item.key), entry_kind: txt(item.entryKind),
          election_key: txt(electionKey), title: txt(title), title_norm: String(title).toLowerCase(),
          search_norm: searchText(item), body_slug: txt(item.bodySlug), body: txt(item.body), date: txt(item.date),
          decade: txt(item.decade), kind: txt(item.kind), ord, card: JSON.stringify(item),
          list_card: listBySlug.has(item.slug) ? JSON.stringify(listBySlug.get(item.slug)) : null,
        });
      });
      out.election_cards = w.finish();
      const { items: _e, ...fullHead } = strip(full);
      doc('browse/elections.json', fullHead);
      const { items: _l, ...listHead } = strip(list);
      // Its items are elections.json's, in the same order: election_cards.list_card by ord.
      doc('browse/elections-list.json', listHead);

      const d = new TableWriter(db, 'election_details');
      const detailDir = at('details', 'elections');
      const contestDir = at('details', 'election-contests');
      const slugs = new Set([
        ...readdirSync(detailDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)),
        ...(existsSync(contestDir) ? readdirSync(contestDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []),
      ]);
      for (const slug of [...slugs].sort()) {
        const detail = existsSync(path.join(detailDir, `${slug}.json`)) ? readJson(path.join(detailDir, `${slug}.json`)) : null;
        const contests = existsSync(path.join(contestDir, `${slug}.json`)) ? readJson(path.join(contestDir, `${slug}.json`)) : null;
        d.add({
          slug,
          election_key: txt(detail?.item?.key ?? contests?.items?.[0]?.parentElectionKey ?? null),
          detail: detail ? JSON.stringify(detail.item ?? null) : null,
          contests: contests ? JSON.stringify(contests.items || []) : null,
        });
      }
      out.election_details = d.finish();
    }

    // ---- small whole documents
    doc('browse/index.json', strip(readJson(at('index.json'))));

  });
  // documents is written once, by the orchestrator, from every ingest's documents.
  return { counts: out, docs };
}

