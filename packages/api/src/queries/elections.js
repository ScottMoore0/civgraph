/**
 * Named queries: elections, contests, candidacies, their animation payloads and aggregates
 * (storage slice ST-6). Every SQL string the Functions run lives in packages/api/src/queries/, one
 * module per table group; tests/functions/named-queries.test.mjs prepares each one on the records
 * build and lists the SQLite-only features they use, which is what a database swap would have to
 * replace. Parameters are numbered (?1, ?2) and passed as arrays to the RecordStore.
 */
import { T } from './tables.js';

export const ELECTIONS = Object.freeze({
  /** [key] -> { key, slug, compact, meta } */
  row: `SELECT key, slug, compact, meta FROM ${T.elections} WHERE key = ?1`,
  /** [key] -> { name, payload } in part order */
  aggregates: 'SELECT name, payload FROM election_aggregates WHERE election_key = ?1 ORDER BY name, part',
  /** [key] -> { seq, meta } */
  contests: 'SELECT seq, meta FROM contests WHERE election_key = ?1 ORDER BY seq',
  /** [key] -> { seq, meta } every candidacy of the election */
  candidacyMetas: 'SELECT contest_seq AS seq, meta FROM candidacies WHERE election_key = ?1 ORDER BY contest_seq, ord',
  /** [key] -> { seq, payload } */
  animations: 'SELECT contest_seq AS seq, payload FROM contest_animation WHERE election_key = ?1 ORDER BY contest_seq',
  /** [key, seq] -> { meta } */
  contestCandidacyMetas: 'SELECT meta FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY ord',
  /** [key, seq] -> { payload } */
  contestAnimation: 'SELECT payload FROM contest_animation WHERE election_key = ?1 AND contest_seq = ?2',
});

// ---------------------------------------------------------------- the elections API (/_api/elections)

const ELECTION_COLS =
  'key, body, body_slug AS bodySlug, body_group AS bodyGroup, display_title AS displayTitle, '
  + 'contest_type AS contestType, kind, voting_system AS votingSystem, '
  + 'contest_status AS contestStatus, date, year, source_map_id AS sourceMapId, '
  + 'layer_id AS layerId, label_property AS labelProperty, '
  + 'candidate_rows_expected AS candidateRowsExpected, transfer_data_expected AS transferDataExpected';

const CONS_COL_LIST = [
  'seq', 'name', 'winner_party AS winnerParty', 'winner_name AS winnerName',
  'leading_party AS leadingParty', 'leading_name AS leadingName', 'leading_votes AS leadingVotes',
  'leading_pct AS leadingPct', 'turnout_pct AS turnoutPct', 'majority', 'majority_pct AS majorityPct',
  'seats_won AS seatsWon', 'seats_total AS seatsTotal', 'quota', 'electorate', 'source_file AS sourceFile',
];
const CONS_COLS = CONS_COL_LIST.join(', ');

const CAND_COLS =
  'candidate_id AS id, name, party_label AS party, person_id AS personId, '
  + 'first_prefs AS firstPrefs, final_votes AS finalVotes, elected, elected_at AS electedAt, '
  + 'excluded, excluded_at AS excludedAt, status, colour, gender, meta';

/** A citation's columns, for the citations views. */
const CITE_COLS = 'ci.title, ci.publisher, ci.url, ci.archive_url AS archiveUrl, ci.host, ci.kind, ci.basis, ci.checked';
/** The join from a contest (alias k) to its citations (alias ci): by the contest file's path. */
const CITES_CONTEST = "ci.subject_type = 'contest' AND ci.subject_key = "
  + "(CASE WHEN k.source_file LIKE 'data/elections-source/data/elections/%' THEN substr(k.source_file, 38) ELSE k.source_file END)";

export const ELECTIONS_API = Object.freeze({
  /** [keyOrSlug] -> { key }: the key first, then the slug */
  keyFor: `SELECT key FROM ${T.elections} WHERE key = ?1 OR slug = ?1 ORDER BY (key = ?1) DESC, key LIMIT 1`,
  /** [] -> the election columns, every election by date */
  index: `SELECT ${ELECTION_COLS} FROM ${T.elections} ORDER BY date, key`,
  /** [bodySlug] -> the election columns of one body's elections */
  indexOfBody: `SELECT ${ELECTION_COLS} FROM ${T.elections} WHERE body_slug = ?1 ORDER BY date, key`,
  /** [key, contestSlug] -> { seq } */
  contestBySlug: 'SELECT seq FROM contests WHERE election_key = ?1 AND slug = ?2 ORDER BY seq LIMIT 1',
  /** [key] -> { seq, name } */
  contestNames: 'SELECT seq, name FROM contests WHERE election_key = ?1 ORDER BY seq',
  /** [key, seq] -> the contest columns and meta */
  contest: `SELECT ${CONS_COLS}, meta FROM contests WHERE election_key = ?1 AND seq = ?2`,
  /** [key, seq] -> the candidacy columns, by first preferences */
  contestCandidates: `SELECT ${CAND_COLS} FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY first_prefs DESC, ord`,
  /** [key, seq] -> the count rows */
  contestCounts: `SELECT candidate_id AS candidateId, count_number AS countNumber, total_votes AS totalVotes, transfers, status FROM ${T.counts} WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY count_number, ord`,
  /** [key, seq] -> the contest's map feature match */
  contestFeature: 'SELECT layer_id AS layerId, feature_id AS featureId, feature_name AS featureName, match_name AS matchName, matched FROM contest_features WHERE election_key = ?1 AND contest_seq = ?2',
  /** [key] -> the election columns and meta */
  election: `SELECT ${ELECTION_COLS}, meta FROM ${T.elections} WHERE key = ?1`,
  /** [key] -> every contest with its feature match */
  electionContests: `SELECT ${CONS_COL_LIST.map((c) => `c.${c}`).join(', ')}, c.meta, `
    + 'f.feature_id AS featureId, f.feature_name AS featureName, f.matched '
    + 'FROM contests c '
    + 'LEFT JOIN contest_features f '
    + '  ON f.election_key = c.election_key AND f.contest_seq = c.seq '
    + 'WHERE c.election_key = ?1 ORDER BY c.seq',
  /** [] -> { entry } */
  manifest: 'SELECT entry FROM election_manifest ORDER BY ord, key',
  /** [key] -> { summary } */
  summary: 'SELECT summary FROM election_summaries WHERE election_key = ?1',
  /** [key] -> { shard } */
  provenance: 'SELECT shard FROM provenance_shards WHERE election_key = ?1',
  /** [file] -> { summary }: render/metadata's summaries by file name */
  summaryOfFile: 'SELECT summary FROM election_summaries WHERE file = ?1',
  // The original sources of the results (QA H5): the contest citations of
  // data/database/election-provenance.json, in the citations table under the contest file's
  // path relative to data/elections-source/data/elections/.
  /** [key, seq] -> one contest's citations, in their order */
  contestCitations: `SELECT ${CITE_COLS} FROM contests k JOIN citations ci ON ${CITES_CONTEST} WHERE k.election_key = ?1 AND k.seq = ?2 ORDER BY ci.ord`,
  /** [key] -> an election's distinct sources, with how many of its contests cite each */
  electionCitations: `SELECT ci.title, ci.publisher, ci.url, ci.host, ci.kind, COUNT(DISTINCT k.seq) AS contests FROM contests k JOIN citations ci ON ${CITES_CONTEST} `
    + 'WHERE k.election_key = ?1 GROUP BY ci.title, ci.publisher, ci.url, ci.host, ci.kind ORDER BY contests DESC, ci.title, ci.url LIMIT 40',
  /** [key] -> { n } how many contests the election has */
  electionContestCount: 'SELECT COUNT(*) AS n FROM contests WHERE election_key = ?1',
  /** [personId] -> each of a person's candidacies with its contest's citations */
  personCitations: `SELECT c.election_key AS electionKey, k.seq, k.name AS constituency, ${CITE_COLS} FROM candidacies c `
    + 'JOIN contests k ON k.election_key = c.election_key AND k.seq = c.contest_seq '
    + `JOIN citations ci ON ${CITES_CONTEST} WHERE c.person_id = ?1 ORDER BY c.election_key, k.seq, c.ord, ci.ord`,
});

export const ELECTION_CARDS = Object.freeze({
  /** [slugOrKey] -> { slug } an election's Browse slug */
  slugFor: "SELECT slug FROM election_cards WHERE (slug = ?1 OR key = ?1) AND entry_kind = 'election' ORDER BY (slug = ?1) DESC, ord LIMIT 1",
  /** [slug] -> { slug, entryKind, electionKey } */
  card: 'SELECT slug, entry_kind AS entryKind, election_key AS electionKey FROM election_cards WHERE slug = ?1',
  /** [offset] -> { card }: data/browse/elections.json in pages of 1,000 */
  cardsPage: 'SELECT card FROM election_cards ORDER BY ord, slug LIMIT 1000 OFFSET ?1',
  /** [] -> { list_card } the whole elections list */
  listCards: 'SELECT list_card FROM election_cards WHERE list_card IS NOT NULL ORDER BY ord, slug',
  /** [] -> { slug, parent }: every contest or overall entry with its election's slug */
  contestParents: `SELECT c.slug, p.slug AS parent FROM election_cards c
        JOIN election_cards p ON p.key = c.election_key AND p.entry_kind = 'election'
        WHERE c.entry_kind <> 'election' ORDER BY c.ord, c.slug`,
  /** [slug] -> { detail } */
  detail: 'SELECT detail FROM election_details WHERE slug = ?1',
  /** [slug] -> { contests } */
  contests: 'SELECT contests FROM election_details WHERE slug = ?1',
  /** Filter clauses of the elections list, over placeholders such as ?1 */
  bodyFilter: (/** @type {string[]} */ slugs, /** @type {string[]} */ names) => `(body_slug IN (${slugs.join(', ')}) OR body IN (${names.join(', ')}))`,
  decadeFilter: (/** @type {string[]} */ decades) => `decade IN (${decades.join(', ')})`,
  wordFilter: (/** @type {string} */ placeholder) => `search_norm LIKE ${placeholder}`,
  /** [...binds] -> { list_card }; `page` is '' or ' LIMIT n OFFSET m' over bounded numbers */
  list: (/** @type {string} */ clause, /** @type {string} */ page) => `SELECT list_card FROM election_cards ${clause} ORDER BY ord, slug${page}`,
  /** [...binds] -> { n } */
  listCount: (/** @type {string} */ clause) => `SELECT COUNT(*) AS n FROM election_cards ${clause}`,
});
