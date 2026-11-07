/**
 * Named queries: elections, contests, candidacies, their animation payloads and aggregates
 * (storage slice ST-6). Every SQL string the Functions run lives in functions/_lib/queries/, one
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
