/**
 * The records database, table by table: the one list the loader, the delta, verify and the
 * tests all read. migrations/0001_records.sql was generated from it
 * (`node scripts/records/schema.mjs --sql`) and tests/records/schema.test.mjs holds the two
 * equal; later changes go in new, append-only migration files and here together.
 *
 * Conventions (data design DESIGN.md section 2.2):
 * - every table has a natural primary key;
 * - `ord` keeps source order wherever a list is shown in source order, and every list query
 *   orders by it (or by columns ending in the key), never by rowid;
 * - `ord` is a sort key, not a position, in every table with `stableOrder`: the build keeps each
 *   row's value from the last-loaded snapshot and places new or moved rows between their
 *   neighbours (scripts/records/stable-order.mjs), so inserting N rows changes about N rows.
 *   Its values may be negative or multiples of 1/512 and have gaps; no read uses one as an index
 *   (a shard of a Browse index is a LIMIT/OFFSET slice in ord order). `sort` names the key's
 *   columns (graph_entities: shard, ord), `group` the list it orders (one subject's statements),
 *   `identity` how a row is matched to the seed: its primary key, or its other values where ord
 *   is part of the key. Left positional: candidacies and r_counts (the API returns a candidacy's
 *   ord and r_counts.candidacy_ord points at it; lists of one contest), contests.seq (part of
 *   public URLs) and election_aggregates.part (pieces of one payload);
 * - every table except `dataset` carries row_hash (SHA-1 of the canonical row, 40 hex) and
 *   row_hash_n (its first 8 hex digits as an integer, below 2^32), so a table checksum is
 *   SUM(row_hash_n) in SQLite and D1 alike without integer overflow;
 * - `meta`/`record`/`card` columns hold JSON stored verbatim (phase 2 stores what the
 *   transforms build; phase 4 turns cards into views).
 *
 * Two tables collide with live tables of a different shape and are created as r_elections
 * and r_counts until stage H renames them (functions/_api/_records.js T.elections, T.counts).
 *
 * Table groups (`group`) say which ingest module fills a table; `parents` gives the delta its
 * order (parents before children for inserts, children before parents for deletes).
 */

const T = 'TEXT';
const I = 'INTEGER';
const R = 'REAL';

/**
 * [name, type, notNull?]
 * @param {string} name
 * @returns {ColumnSpec}
 */
const c = (name, type = T, notNull = false) => ({ name, type, notNull });

const HASH = [c('row_hash', T, true), c('row_hash_n', I, true)];

/**
 * @typedef {{ name: string, type: string, notNull: boolean }} ColumnSpec
 * @typedef {{ name: string, group: string, columns: ColumnSpec[],
 *   pk: string[], hashed: boolean, order: string, indexes?: [string, string[], boolean?][],
 *   stableOrder?: { sort: string[], group?: string[], identity: 'key' | 'content' },
 *   parents?: string[], since?: number,
 *   volatileJson?: { column: string, keys: (row: Record<string, unknown>) => string[] },
 *   note?: string }} TableSpec
 *   `parents`: tables whose rows this one's reference (the delta's order); `since`: the
 *   migration that added the table (absent: 0001); `volatileJson`: build stamps inside a JSON
 *   column left out of row_hash (db.mjs hashValues).
 */
/** @type {TableSpec[]} */
export const TABLES = [
  // ---------------------------------------------------------------- dataset and documents
  {
    name: 'dataset', group: 'dataset', hashed: false, pk: ['key'], order: 'key',
    columns: [c('key', T, true), c('value')],
    note: 'version, loading, git_commit, loaded_at, inputs_hash, table checksums',
  },
  {
    // Whole small documents served as they are: Browse index.json, party-label-folds.json,
    // the votes index, the graph manifest and lookup head, the manifests of the sharded
    // indexes (their shard lists are rewritten by the compatibility route).
    name: 'documents', group: 'documents', hashed: true, pk: ['name'], order: 'name',
    columns: [c('name', T, true), c('body', T, true), ...HASH],
    // Build stamps in a body change with every build or commit while the data does not: the
    // election manifest head's generatedAt (wall clock), the graph documents' generatedAt (the
    // HEAD commit's time) and the graph manifest's `inputs` (the Browse indexes' wall-clock
    // stamps). They are left out of row_hash (db.mjs hashValues), so a rebuild with no data
    // change gives an empty delta. The stored body keeps them: a document is reloaded, stamps
    // and all, whenever anything else in it changes.
    volatileJson: { column: 'body', keys: (row) => (row.name === 'graph/manifest.json' ? ['generatedAt', 'inputs'] : ['generatedAt']) },
  },

  // ---------------------------------------------------------------- elections
  {
    name: 'r_elections', group: 'elections', hashed: true, pk: ['key'], order: 'date, key',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('key', T, true), c('slug', T, true), c('body_slug', T, true), c('body'), c('body_group'),
      c('display_title'), c('contest_type'), c('kind'), c('voting_system'), c('contest_status'),
      c('date', T, true), c('year', I), c('decade', I), c('source_map_id'), c('layer_id'),
      c('label_property'), c('candidate_rows_expected', I), c('transfer_data_expected', I),
      c('previous_key'), c('placeholder', I), c('ord', I, true),
      // 1 when the bundle file was written compact (scripts/ingest/persons/generated_json.py: indented text over
      // 24 MiB is written without indentation), so the compatibility route writes it the same way.
      c('compact', I),
      // The bundle without results[] and the two whole-election aggregates, in the bundle's
      // own key order: a removed key is kept in place with the value null.
      c('meta', T, true), ...HASH,
    ],
    indexes: [['r_elections_slug', ['slug'], true], ['r_elections_body_date', ['body_slug', 'date', 'key']], ['r_elections_date', ['date', 'key']]],
  },
  {
    // mainLikeCandidateSummary and entityIndex, out of elections.meta: together they pushed
    // ireland-local 2004 and 2014 past D1's 2,000,000-byte row limit. Stored verbatim (the
    // person-id loop stamps the summary rows after the manifest builds them, so a rebuild on
    // request would not reproduce them), one row per part of at most PART_CHARS characters.
    name: 'election_aggregates', group: 'elections', hashed: true, pk: ['election_key', 'name', 'part'], order: 'election_key, name, part',
    columns: [c('election_key', T, true), c('name', T, true), c('part', I, true), c('payload', T, true), ...HASH],
  },
  {
    name: 'contests', group: 'elections', hashed: true, pk: ['election_key', 'seq'], parents: ['r_elections'], order: 'election_key, seq',
    columns: [
      c('election_key', T, true), c('seq', I, true), c('name', T, true), c('slug', T, true),
      c('source_file'), c('seats_total', I), c('electorate', I), c('quota', R), c('turnout_pct', R),
      c('winner_party'), c('winner_name'), c('leading_party'), c('leading_name'),
      c('leading_votes', R), c('leading_pct', R), c('majority', R), c('majority_pct', R),
      c('seats_won', I),
      // The result without candidates, countGroup, animationPayload and the feature match,
      // in the bundle's key order (those keys kept in place with the value null).
      c('meta', T, true), ...HASH,
    ],
    indexes: [['contests_slug', ['election_key', 'slug', 'seq']], ['contests_source_file', ['source_file']]],
  },
  {
    name: 'candidacies', group: 'elections', hashed: true, pk: ['election_key', 'contest_seq', 'ord'], parents: ['contests'], order: 'election_key, contest_seq, ord',
    columns: [
      c('election_key', T, true), c('contest_seq', I, true), c('ord', I, true),
      c('candidate_id'), c('person_id'), c('name'), c('name_as_printed'), c('party_as_printed'),
      c('party_label'), c('party_rule', I), c('party_id'), c('ballot_description'),
      c('first_prefs', R), c('final_votes', R), c('elected', I), c('elected_at', I),
      c('excluded', I), c('excluded_at', I), c('status'), c('unopposed', I), c('colour'), c('gender'),
      // The candidate verbatim: every field, in its own order.
      c('meta', T, true), ...HASH,
    ],
    indexes: [['cand_person', ['person_id', 'election_key', 'contest_seq', 'ord']], ['cand_party', ['party_id', 'election_key']], ['cand_label', ['party_label']]],
  },
  {
    name: 'r_counts', group: 'elections', hashed: true, pk: ['election_key', 'contest_seq', 'ord'], parents: ['contests'], order: 'election_key, contest_seq, ord',
    columns: [
      c('election_key', T, true), c('contest_seq', I, true), c('ord', I, true), c('row_id', I),
      c('candidacy_ord', I), c('candidate_id'), c('count_number', I), c('total_votes', R),
      c('transfers', R), c('status'), ...HASH,
    ],
  },
  {
    name: 'contest_animation', group: 'elections', hashed: true, pk: ['election_key', 'contest_seq'], parents: ['contests'], order: 'election_key, contest_seq',
    columns: [c('election_key', T, true), c('contest_seq', I, true), c('payload', T, true), ...HASH],
  },
  {
    name: 'contest_features', group: 'elections', hashed: true, pk: ['election_key', 'contest_seq'], parents: ['contests'], order: 'election_key, contest_seq',
    columns: [c('election_key', T, true), c('contest_seq', I, true), c('layer_id'), c('feature_id'), c('feature_name'), c('match_name'), c('matched', I), ...HASH],
    indexes: [['confeat_layer', ['layer_id', 'feature_id']]],
  },
  {
    name: 'election_summaries', group: 'elections', hashed: true, pk: ['election_key'], parents: ['r_elections'], order: 'election_key',
    columns: [c('election_key', T, true), c('file', T, true), c('summary', T, true), ...HASH],
    indexes: [['election_summaries_file', ['file'], true]],
  },
  {
    // The manifest entry (render/metadata/elections-test2.json elections[]), verbatim.
    name: 'election_manifest', group: 'elections', hashed: true, pk: ['key'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [c('key', T, true), c('ord', I, true), c('entry', T, true), ...HASH],
    indexes: [['election_manifest_ord', ['ord', 'key']]],
  },
  {
    // Browse election records: the 1,829 elections, their overall results and 13,360 contest
    // entries of data/browse/elections.json, with the list card of elections-list.json.
    name: 'election_cards', group: 'browse', hashed: true, pk: ['slug'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('key'), c('entry_kind'), c('election_key'), c('title'), c('title_norm'),
      c('search_norm'), c('body_slug'), c('body'), c('date'), c('decade'), c('kind'), c('ord', I, true),
      c('card', T, true), c('list_card'), ...HASH,
    ],
    indexes: [['election_cards_ord', ['ord', 'slug']], ['election_cards_election', ['election_key', 'ord']], ['election_cards_body', ['body_slug', 'ord']], ['election_cards_key', ['key']]],
  },
  {
    // details/elections/<slug>.json item and details/election-contests/<slug>.json items.
    name: 'election_details', group: 'browse', hashed: true, pk: ['slug'], order: 'slug',
    columns: [c('slug', T, true), c('election_key'), c('detail'), c('contests'), ...HASH],
    indexes: [['election_details_key', ['election_key']]],
  },

  // ---------------------------------------------------------------- persons
  {
    name: 'persons', group: 'persons', hashed: true, pk: ['person_id'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('person_id', T, true), c('registry_id'), c('display_name', T, true), c('first_year', I), c('last_year', I),
      c('provisional', I), c('candidacies', I), c('ord', I, true), c('meta', T, true), ...HASH,
    ],
  },
  {
    name: 'person_names', group: 'persons', hashed: true, pk: ['name_id', 'person_id'], order: 'name_id, person_id',
    columns: [c('name_id', T, true), c('person_id', T, true), c('name'), c('candidacies', I), c('first_year', I), c('last_year', I), ...HASH],
    indexes: [['person_names_person', ['person_id', 'name_id']]],
  },
  {
    // Old addresses of a person card: previous slugs, old ids and ids merged away.
    name: 'person_aliases', group: 'persons', hashed: true, pk: ['alias'], order: 'alias',
    columns: [c('alias', T, true), c('slug', T, true), ...HASH],
  },
  {
    name: 'person_merges', group: 'persons', hashed: true, pk: ['drop_id'], order: 'drop_id',
    columns: [c('drop_id', T, true), c('keep_id', T, true), c('confirmed', I), c('meta'), ...HASH],
  },
  {
    // reference-offices.json, reference-relations.json, reference-dates.json, one row per entry.
    name: 'person_facts', group: 'persons', hashed: true, pk: ['person_id', 'kind', 'ord'], order: 'person_id, kind, ord',
    stableOrder: { sort: ['ord'], group: ['person_id', 'kind'], identity: 'content' },
    columns: [c('person_id', T, true), c('kind', T, true), c('ord', I, true), c('value', T, true), ...HASH],
  },
  {
    name: 'person_cards', group: 'browse', hashed: true, pk: ['slug'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('title'), c('title_norm'), c('key_norm'), c('search_norm'),
      c('first_year', I), c('last_year', I), c('bodies'), c('decades'), c('elected'), c('contests', I), c('elected_count', I),
      c('ord', I, true), c('card', T, true), ...HASH,
    ],
    indexes: [
      ['person_cards_ord', ['ord']], ['person_cards_title', ['title_norm']], ['person_cards_key', ['key_norm']], ['person_cards_id', ['id']],
      ['person_cards_first_year', ['first_year']], ['person_cards_last_year', ['last_year']], ['person_cards_contests', ['contests']], ['person_cards_elected_count', ['elected_count']],
    ],
  },
  {
    name: 'person_cards_facets', group: 'browse', hashed: true, pk: ['id'], order: 'id',
    columns: [c('id', I, true), c('facets', T, true), ...HASH],
  },

  // ---------------------------------------------------------------- parties
  {
    name: 'parties', group: 'parties', hashed: true, pk: ['party_id'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('party_id', T, true), c('type'), c('name'), c('short_name'), c('founded'), c('founded_precision'),
      c('dissolved'), c('status'), c('provisional', I), c('confidence'), c('ord', I, true), c('meta', T, true), ...HASH,
    ],
  },
  {
    name: 'party_names', group: 'parties', hashed: true, pk: ['party_id', 'ord'], order: 'party_id, ord',
    stableOrder: { sort: ['ord'], group: ['party_id'], identity: 'content' },
    columns: [c('party_id', T, true), c('ord', I, true), c('name', T, true), c('kind', T, true), c('valid_from'), c('valid_until'), c('bodies'), c('meta'), ...HASH],
    indexes: [['party_names_name', ['name', 'party_id']]],
  },
  {
    // party-lineage.json events. Kept general (kind, related, basis, source, meta) so the
    // facts model's party events (docs/facts-model.md on branch facts-model) can load here.
    name: 'party_events', group: 'parties', hashed: true, pk: ['ord'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'content' },
    columns: [c('ord', I, true), c('party_id', T, true), c('date'), c('kind'), c('related'), c('meta', T, true), ...HASH],
    indexes: [['party_events_party', ['party_id', 'date', 'ord']]],
  },
  {
    // The ballot-paper label -> party map (party-names.json items), in its order.
    name: 'party_label_map', group: 'browse', hashed: true, pk: ['label'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [c('label', T, true), c('party_slug', T, true), c('ord', I, true), ...HASH],
  },
  {
    name: 'party_aliases', group: 'browse', hashed: true, pk: ['alias'], order: 'alias',
    columns: [c('alias', T, true), c('slug', T, true), ...HASH],
  },
  {
    name: 'party_cards', group: 'browse', hashed: true, pk: ['slug'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('title'), c('title_norm'), c('search_norm'), c('occurrences', I),
      c('ord', I, true), c('card', T, true), c('detail'), c('profile'), ...HASH,
    ],
    indexes: [['party_cards_ord', ['ord']]],
  },
  // The facts model's office pages (scripts/build/build-office-pages.mjs): the list card and the page.
  {
    name: 'office_cards', group: 'browse', hashed: true, pk: ['slug'], order: 'ord', since: 2,
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('title'), c('title_norm'), c('search_norm'),
      c('ord', I, true), c('card', T, true), c('detail'), ...HASH,
    ],
    indexes: [['office_cards_ord', ['ord']]],
  },

  // ---------------------------------------------------------------- sources and provenance
  {
    name: 'sources', group: 'browse', hashed: true, pk: ['slug'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('title'), c('title_norm'), c('key_norm'), c('search_norm'),
      c('provider'), c('category'), c('publication_status'), c('date'), c('license'),
      c('ord', I, true), c('card', T, true), c('detail'), ...HASH,
    ],
    indexes: [
      ['sources_ord', ['ord']], ['sources_title', ['title_norm']], ['sources_key', ['key_norm']], ['sources_id', ['id']],
      ['sources_provider', ['provider']], ['sources_category', ['category']], ['sources_publication_status', ['publication_status']], ['sources_date', ['date']], ['sources_license', ['license']],
    ],
  },
  {
    name: 'sources_facets', group: 'browse', hashed: true, pk: ['id'], order: 'id',
    columns: [c('id', I, true), c('facets', T, true), ...HASH],
  },
  {
    name: 'source_aliases', group: 'browse', hashed: true, pk: ['alias'], order: 'alias',
    columns: [c('alias', T, true), c('slug', T, true), ...HASH],
  },
  {
    // source-merges.json items, verbatim and in order.
    name: 'source_merges', group: 'browse', hashed: true, pk: ['ord'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'content' },
    columns: [c('ord', I, true), c('item', T, true), ...HASH],
  },
  {
    // One row per contest of data/database/election-provenance.json (the 25 MiB file):
    // the record without its sources (kept in place as null), joined to the contest.
    name: 'contest_provenance', group: 'provenance', hashed: true, pk: ['source_file'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('source_file', T, true), c('election_key'), c('contest_seq', I), c('body'), c('date'), c('constituency'),
      c('status'), c('ord', I, true), c('record', T, true), ...HASH,
    ],
    indexes: [['contest_provenance_contest', ['election_key', 'contest_seq']], ['contest_provenance_ord', ['ord']]],
  },
  {
    name: 'citations', group: 'provenance', hashed: true, pk: ['subject_type', 'subject_key', 'ord'], order: 'subject_type, subject_key, ord',
    stableOrder: { sort: ['ord'], group: ['subject_type', 'subject_key'], identity: 'content' },
    columns: [
      c('subject_type', T, true), c('subject_key', T, true), c('ord', I, true), c('title'), c('publisher'),
      c('url'), c('archive_url'), c('host'), c('kind'), c('origin'), c('basis'), c('scope'), c('checked', I),
      c('match'), c('document'), c('citation', T, true), ...HASH,
    ],
    indexes: [['citations_url', ['url']]],
  },
  {
    name: 'legislation', group: 'provenance', hashed: true, pk: ['legislation_id'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [c('legislation_id', T, true), c('title'), c('url'), c('ord', I, true), c('meta', T, true), ...HASH],
  },
  {
    name: 'election_legislation', group: 'provenance', hashed: true, pk: ['source_file', 'ord'], order: 'source_file, ord',
    stableOrder: { sort: ['ord'], group: ['source_file'], identity: 'content' },
    columns: [c('source_file', T, true), c('ord', I, true), c('legislation_id', T, true), ...HASH],
    indexes: [['election_legislation_id', ['legislation_id']]],
  },
  {
    // The per-election shard the map app reads (render/metadata/election-provenance/<key>.json).
    name: 'provenance_shards', group: 'provenance', hashed: true, pk: ['election_key'], order: 'election_key',
    columns: [c('election_key', T, true), c('shard', T, true), ...HASH],
  },

  // ---------------------------------------------------------------- register of interests
  {
    name: 'register_entries', group: 'browse', hashed: true, pk: ['slug'], order: 'ord',
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('slug', T, true), c('id'), c('title'), c('title_norm'), c('key_norm'), c('search_norm'),
      c('member_name'), c('elected_body'), c('category'), c('date'), c('constituency'), c('member_type'),
      c('chamber'), c('interest_count', I), c('source_count', I), c('nil_status'),
      // detail: the entry's record in data/database/ni-register-browse-records (its interests).
      c('ord', I, true), c('card', T, true), c('detail'), ...HASH,
    ],
    indexes: [
      ['register_entries_ord', ['ord']], ['register_entries_title', ['title_norm']], ['register_entries_key', ['key_norm']], ['register_entries_id', ['id']],
      ['register_entries_member_name', ['member_name']], ['register_entries_elected_body', ['elected_body']], ['register_entries_date', ['date']],
      ['register_entries_constituency', ['constituency']], ['register_entries_member_type', ['member_type']], ['register_entries_chamber', ['chamber']],
      ['register_entries_interest_count', ['interest_count']], ['register_entries_source_count', ['source_count']], ['register_entries_nil_status', ['nil_status']],
    ],
  },
  {
    name: 'register_entries_facets', group: 'browse', hashed: true, pk: ['id'], order: 'id',
    columns: [c('id', I, true), c('facets', T, true), ...HASH],
  },
  {
    name: 'register_entries_aliases', group: 'browse', hashed: true, pk: ['alias'], order: 'alias',
    columns: [c('alias', T, true), c('slug', T, true), ...HASH],
  },

  // ---------------------------------------------------------------- votes and divisions
  {
    name: 'divisions', group: 'votes', hashed: true, pk: ['division_id'], order: 'shard, ord',
    stableOrder: { sort: ['ord'], group: ['shard'], identity: 'key' },
    columns: [
      c('division_id', T, true), c('shard', I, true), c('ord', I, true), c('body'), c('date'), c('number'), c('title'),
      // The division record without its votes (kept in place as null).
      c('record', T, true), ...HASH,
    ],
    indexes: [['divisions_shard', ['shard', 'ord']], ['divisions_body_date', ['body', 'date', 'division_id']]],
  },
  {
    name: 'division_votes', group: 'votes', hashed: true, pk: ['division_id', 'ord'], parents: ['divisions'], order: 'division_id, ord',
    stableOrder: { sort: ['ord'], group: ['division_id'], identity: 'content' },
    columns: [c('division_id', T, true), c('ord', I, true), c('person_id'), c('vote'), c('party'), c('entry', T, true), ...HASH],
    indexes: [['dvotes_person', ['person_id', 'division_id']]],
  },
  {
    // The per-person and per-party vote summaries, as built (terms, titles, cohesion).
    name: 'vote_persons', group: 'votes', hashed: true, pk: ['person_id'], order: 'person_id',
    columns: [c('person_id', T, true), c('record', T, true), ...HASH],
  },
  {
    name: 'vote_parties', group: 'votes', hashed: true, pk: ['slug'], order: 'slug',
    columns: [c('slug', T, true), c('record', T, true), ...HASH],
  },

  // ---------------------------------------------------------------- semantic graph
  {
    name: 'graph_entities', group: 'graph', hashed: true, pk: ['entity_id'], order: 'shard, ord',
    // (shard, ord) is the entity's sort key: the entity-shards file and place it was first built
    // in, kept since (stable-order.mjs), not necessarily its file in the current graph build.
    stableOrder: { sort: ['shard', 'ord'], identity: 'key' },
    columns: [
      c('entity_id', T, true), c('shard', I, true), c('ord', I, true), c('slug'), c('label'), c('label_norm'),
      // entity: the entity-shard record; summary: its lookup entry without the shard numbers;
      // search: its entity-search entry, for the entities the search lists.
      c('entity', T, true), c('summary'), c('search'), ...HASH,
    ],
    indexes: [['graph_entities_shard', ['shard', 'ord']], ['graph_entities_slug', ['slug']], ['graph_entities_label', ['label_norm']]],
  },
  {
    // Browse record keys ("persons:ian-paisley-48601") -> entity.
    name: 'graph_browse_keys', group: 'graph', hashed: true, pk: ['browse_key'], order: 'browse_key',
    columns: [c('browse_key', T, true), c('entity_id', T, true), ...HASH],
  },
  {
    // A subject's statements as the record pages read them (statements-by-subject shards).
    name: 'graph_statements', group: 'graph', hashed: true, pk: ['subject_id', 'ord'], order: 'subject_id, ord',
    stableOrder: { sort: ['ord'], group: ['subject_id'], identity: 'content' },
    columns: [c('subject_id', T, true), c('ord', I, true), c('statement_id'), c('property_id'), c('statement', T, true), ...HASH],
  },
  {
    // Statements whose value is an entity, by that entity (reverse-entity-value shards).
    name: 'graph_reverse', group: 'graph', hashed: true, pk: ['entity_id', 'ord'], order: 'entity_id, ord',
    stableOrder: { sort: ['ord'], group: ['entity_id'], identity: 'content' },
    columns: [c('entity_id', T, true), c('ord', I, true), c('item', T, true), ...HASH],
  },
  {
    // Statements citing a source entity (source-statements shards).
    name: 'graph_source_statements', group: 'graph', hashed: true, pk: ['source_id', 'ord'], order: 'source_id, ord',
    stableOrder: { sort: ['ord'], group: ['source_id'], identity: 'content' },
    columns: [c('source_id', T, true), c('ord', I, true), c('item', T, true), ...HASH],
  },

  // ---------------------------------------------------------------- maps, layers, catalogue (phase 3)
  // Loaded by scripts/records/ingest-maps.mjs from the source files where they are
  // (data/database/maps.json, render/metadata/maps-test.json, data/catalogue/*.json,
  // agent/maps-index.json) and from the Browse build's map files. Data design PHASE3.md.
  {
    // maps.json maps[], verbatim in `record`: the civgraph-catalogue `maps` table, moved.
    name: 'maps', group: 'maps', hashed: true, pk: ['map_id'], order: 'ord', since: 3,
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('map_id', T, true), c('slug'), c('name'), c('category'), c('date'), c('hidden', I), c('featured', I),
      c('is_group', I), c('parent_id'), c('ord', I, true), c('record', T, true), ...HASH,
    ],
    indexes: [['maps_ord', ['ord', 'map_id']], ['maps_slug', ['slug']], ['maps_category', ['category', 'ord']]],
  },
  {
    // maps.json's other top-level keys (categories, timeSeriesChains, classes, c1s); ord is the
    // key's place in the document, counting `maps`, so the document reassembles in its own order.
    name: 'catalogue_parts', group: 'maps', hashed: true, pk: ['key'], order: 'ord', since: 3,
    columns: [c('key', T, true), c('ord', I, true), c('value', T, true), ...HASH],
  },
  {
    // maps-test.json layers[], verbatim in `record` (which is also the layer's detail document);
    // `duplicates` is the duplicate-feature-id sidecar computed from its feature index.
    name: 'layers', group: 'maps', hashed: true, pk: ['layer_id'], order: 'ord', since: 3,
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [
      c('layer_id', T, true), c('map_id'), c('kind'), c('alias_of'), c('ord', I, true),
      c('record', T, true), c('duplicates'), ...HASH,
    ],
    indexes: [['layers_ord', ['ord', 'layer_id']], ['layers_map', ['map_id', 'ord']]],
  },
  {
    // maps-test.json's other top-level keys, in place (ord counts `layers`).
    name: 'layer_parts', group: 'maps', hashed: true, pk: ['key'], order: 'ord', since: 3,
    columns: [c('key', T, true), c('ord', I, true), c('value', T, true), ...HASH],
  },
  {
    // Other spellings of a layer id (renames.csv: -vector, -raster and -alias <-> the retired
    // spellings with a further -test suffix, and packages/map/src/app/url-compat.mjs's renamed prefixes), each
    // pointing at the live id. Generated by the loader; never shadows a live id.
    name: 'layer_aliases', group: 'maps', hashed: true, pk: ['alias'], order: 'alias', since: 3,
    columns: [c('alias', T, true), c('layer_id', T, true), ...HASH],
  },
  {
    // Browse map records: data/browse/maps.json items (card) and details/maps/<slug>.json (detail).
    name: 'map_cards', group: 'maps', hashed: true, pk: ['slug'], order: 'ord', since: 3,
    stableOrder: { sort: ['ord'], identity: 'key' },
    columns: [c('slug', T, true), c('id'), c('title'), c('ord', I, true), c('card', T, true), c('detail'), ...HASH],
    indexes: [['map_cards_ord', ['ord', 'slug']], ['map_cards_id', ['id']]],
  },
  {
    // Browse feature groups: data/browse/features.json items, in order. Keyed by position: an id
    // can repeat (highlands-without-settlements is listed twice by two source maps).
    name: 'feature_groups', group: 'maps', hashed: true, pk: ['ord'], order: 'ord', since: 3,
    stableOrder: { sort: ['ord'], identity: 'content' },
    columns: [c('ord', I, true), c('id'), c('card', T, true), ...HASH],
  },
  {
    // Whole documents served byte for byte (the catalogue pane's catalogue.json, places.json and
    // people.json; agent/maps-index.json), split into parts of at most PART_CHARS characters
    // because two of them are over D1's 2,000,000-byte row limit. A document is its parts
    // concatenated in part order.
    name: 'document_parts', group: 'maps', hashed: true, pk: ['name', 'part'], order: 'name, part', since: 3,
    columns: [c('name', T, true), c('part', I, true), c('body', T, true), ...HASH],
  },
];

/** @type {Record<string, TableSpec>} */
/**
 * Tables a later migration dropped: kept here only so the migration that created them still
 * generates byte-equal (tests/records/schema.test.mjs). `dropped` is the migration that drops it.
 * @type {(TableSpec & { dropped: number })[]}
 */
export const RETIRED_TABLES = [
  {
    // Data phase 4: which keys each of the graph build's old /data/graph files held, so
    // functions/data/graph answered those URLs from the graph tables. The URLs retired on
    // 8 Nov 2026 (owner, the 90-day window ended early): 410 Gone, and 0005 drops the table.
    name: 'graph_files', group: 'graph', hashed: true, pk: ['file', 'part'], order: 'file, part', since: 4, dropped: 5,
    columns: [c('file', T, true), c('part', I, true), c('keys', T, true), c('extra'), ...HASH],
  },
];

export const TABLE = Object.fromEntries(TABLES.map((t) => [t.name, t]));
export const HASHED_TABLES = TABLES.filter((t) => t.hashed);

/** Largest value any one column may hold: D1's row limit is 2,000,000 bytes. */
export const MAX_VALUE_BYTES = 1_900_000;
/** election_aggregates splits a payload into parts of this many characters. */
export const PART_CHARS = 600_000;

/** @param {TableSpec} t */
export function createTableSql(t) {
  const cols = t.columns.map((col) => `  ${col.name} ${col.type}${col.notNull ? ' NOT NULL' : ''}`);
  cols.push(`  PRIMARY KEY (${t.pk.join(', ')})`);
  const lines = [`CREATE TABLE ${t.name} (\n${cols.join(',\n')}\n);`];
  for (const [name, columns, unique] of t.indexes || []) {
    lines.push(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${t.name}(${columns.join(', ')});`);
  }
  return lines.join('\n');
}

/**
 * The SQL of one migration: 1 is 0001_records.sql (every table without `since`); n > 1 is the
 * tables whose `since` is n, appended in that migration file, and the RETIRED_TABLES it drops.
 */
export function schemaSql(migration = 1) {
  if (migration > 1) {
    const added = [...TABLES, ...RETIRED_TABLES].filter((t) => t.since === migration);
    const dropped = RETIRED_TABLES.filter((t) => t.dropped === migration);
    const n = String(migration).padStart(4, '0');
    return [
      added.length || !dropped.length
        ? `-- civgraph records database: tables added in migration ${n} (generated by scripts/records/schema.mjs --sql ${migration}).`
        : `-- civgraph records database: tables dropped in migration ${n} (generated by scripts/records/schema.mjs --sql ${migration}).`,
      '',
      ...added.map(createTableSql),
      ...dropped.map((t) => `DROP TABLE IF EXISTS ${t.name};`),
      '',
    ].join('\n\n');
  }
  return [
    '-- civgraph records database: phase 2 tables (generated by scripts/records/schema.mjs --sql).',
    '-- Created beside the live tables (elections, constituencies, candidates, counts,',
    '-- constituency_animation, constituency_features, browse_*), which this migration does not touch.',
    '-- dataset already exists in production (the elections loader made it): IF NOT EXISTS.',
    '',
    ...TABLES.filter((t) => !t.since).map((t) => (t.name === 'dataset'
      ? createTableSql(t).replace('CREATE TABLE dataset', 'CREATE TABLE IF NOT EXISTS dataset')
      : createTableSql(t))),
    '',
  ].join('\n\n');
}

if (process.argv[1] && import.meta.url.endsWith(String(process.argv[1].replace(/\\/g, '/').split('/').pop())) && process.argv.includes('--sql')) {
  const n = Number(process.argv[process.argv.indexOf('--sql') + 1]) || 1;
  process.stdout.write(schemaSql(n));
}
