/**
 * Named queries: the Browse card tables served by functions/_api/_browse-index.js (person_cards,
 * sources, register_entries), their alias and facet tables, and the per-record views of persons,
 * sources and the register (storage slice ST-6). The index queries are builders over the table a
 * route names, its record column (`record`, or `card AS record`) and the filter clause the index
 * assembles from its declared filters; every value reaches the database as a parameter.
 */
import { T } from './tables.js';

export const CARDS = Object.freeze({
  /** [slug] -> { record, slug }: by key, slug or id, preferring the slug, then the id, then source order */
  bySlug: (/** @type {string} */ table, /** @type {string} */ record) =>
    `SELECT ${record}, slug FROM ${table} WHERE key_norm = ?1 OR slug = ?1 OR id = ?1 ORDER BY (slug = ?1) DESC, (id = ?1) DESC, ord LIMIT 1`,
  /** [alias] -> { record, slug }: an old address (previousSlugs) */
  byAlias: (/** @type {string} */ table, /** @type {string} */ record, /** @type {string} */ aliasTable) =>
    `SELECT ${record}, slug FROM ${table} WHERE slug = (SELECT slug FROM ${aliasTable} WHERE alias = ?1) LIMIT 1`,
  /** [] -> { facets } */
  facets: (/** @type {string} */ facetsTable) => `SELECT facets FROM ${facetsTable} LIMIT 1`,
  /** [...filter binds, limit, offset] -> { record } */
  page: (/** @type {string} */ table, /** @type {string} */ record, /** @type {string} */ clause, /** @type {string} */ orderBy, /** @type {number} */ bindCount) =>
    `SELECT ${record} FROM ${table} ${clause} ORDER BY ${orderBy} LIMIT ?${bindCount + 1} OFFSET ?${bindCount + 2}`,
  /** [...filter binds] -> { n } */
  count: (/** @type {string} */ table, /** @type {string} */ clause) => `SELECT COUNT(*) AS n FROM ${table} ${clause}`,
});

export const SHARDS = Object.freeze({
  /** [size, offset] -> { card }: one index shard of a card table, in source order */
  page: (/** @type {string} */ table) => `SELECT card FROM ${table} ORDER BY ord LIMIT ?1 OFFSET ?2`,
});

export const OFFICES = Object.freeze({
  /** [] -> { card } */
  cards: 'SELECT card FROM office_cards ORDER BY ord, slug',
  /** [slug] -> { detail } */
  detail: 'SELECT detail FROM office_cards WHERE slug = ?1',
});

export const PERSONS = Object.freeze({
  /** [personId] -> a person's candidacies in date order */
  candidacies: `SELECT c.election_key AS electionKey, e.slug AS electionSlug, e.display_title AS electionTitle, e.date, e.body,
       c.contest_seq AS contestSeq, k.name AS contest, k.slug AS contestSlug, c.ord, c.name, c.party_label AS party,
       c.party_as_printed AS partyAsPrinted, c.party_id AS partyId, c.first_prefs AS firstPrefs, c.final_votes AS finalVotes,
       c.elected, c.status, c.unopposed
     FROM candidacies c
     JOIN ${T.elections} e ON e.key = c.election_key
     JOIN contests k ON k.election_key = c.election_key AND k.seq = c.contest_seq
     WHERE c.person_id = ?1
     ORDER BY e.date, e.key, c.contest_seq, c.ord`,
  /** A filter clause for the People list: the person stood for any of these parties (placeholders such as ?3) */
  partyFilter: (/** @type {string[]} */ placeholders) => `EXISTS (
        SELECT 1 FROM json_each(person_cards.card, '$.parties')
        WHERE json_extract(value, '$.name') IN (${placeholders.join(', ')})
      )`,
  /** [personId] -> { record }: the votes/persons/<id>.json document */
  votes: 'SELECT record FROM vote_persons WHERE person_id = ?1',
});

export const SOURCES = Object.freeze({
  /** [slug] -> { detail } */
  detail: 'SELECT detail FROM sources WHERE slug = ?1',
  /** [] -> { item } */
  merges: 'SELECT item FROM source_merges ORDER BY ord',
  /** [detailUrl] -> { detail }: the sources whose card names this detail shard, by slug */
  detailsInShard: "SELECT detail FROM sources WHERE json_extract(card, '$.detailUrl') = ?1 AND detail IS NOT NULL ORDER BY slug",
});

export const REGISTER = Object.freeze({
  /** [slug] -> { detail } */
  detail: 'SELECT detail FROM register_entries WHERE slug = ?1',
});
