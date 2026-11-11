/**
 * Named queries: the server-rendered record pages (functions/_browse-page.js heads and
 * packages/ui/src/templates/records/*; storage slice ST-6). The card lookups by slug or alias are
 * CARDS.bySlug/byAlias (cards.js), shared with the Browse index.
 */
import { T } from './tables.js';

export const ELECTION_PAGES = Object.freeze({
  /** [slug] -> { card }: a grouped local-election year's Browse card */
  groupedYear: 'SELECT card FROM election_cards WHERE slug = ?1 LIMIT 1',
  /**
   * [slug] -> the election a page slug belongs to: its key or slug, or the longest slug that
   * prefixes it. A prefix test by substr, not LIKE: D1 refuses a LIKE whose pattern is a column.
   */
  electionOfSlug: `SELECT key, slug, display_title AS title, body, date, voting_system AS votingSystem, meta FROM ${T.elections} `
    + "WHERE key = ?1 OR slug = ?1 OR substr(?1, 1, LENGTH(slug) + 1) = slug || '-' "
    + 'ORDER BY LENGTH(key) DESC, key LIMIT 1',
  /** [key, contestSlug] -> the contest's head facts */
  contestOfSlug: 'SELECT seq, name, slug, electorate, turnout_pct AS turnoutPct, seats_total AS seatsTotal, quota FROM contests WHERE election_key = ?1 AND slug = ?2 ORDER BY seq LIMIT 1',
  /** [key, seq] -> { name, party, elected } by first preferences */
  contestWinners: 'SELECT name, party_label AS party, elected FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY first_prefs DESC, ord',
  /** [key] -> the election page's election row */
  election: `SELECT key, slug, display_title AS title, body, date, kind, voting_system AS votingSystem, meta FROM ${T.elections} WHERE key = ?1`,
  /** [key, seq] -> the contest page's contest row */
  contest: 'SELECT seq, name, slug, seats_total AS seatsTotal, electorate, quota, turnout_pct AS turnoutPct, source_file AS sourceFile, meta FROM contests WHERE election_key = ?1 AND seq = ?2',
  /** [key, seq] -> the contest page's candidates */
  candidates: 'SELECT ord, name, person_id AS personId, party_label AS party, party_as_printed AS partyAsPrinted, colour, first_prefs AS firstPrefs, final_votes AS finalVotes, elected, status FROM candidacies WHERE election_key = ?1 AND contest_seq = ?2 ORDER BY first_prefs DESC, ord',
  /** [sourceFile] -> { title, publisher, url }: a contest's citations */
  citations: "SELECT title, publisher, url FROM citations WHERE subject_type = 'contest' AND subject_key = ?1 ORDER BY ord",
  /** [key] -> the election page's contest list */
  contests: 'SELECT seq, name, slug, seats_total AS seatsTotal, winner_party AS winnerParty, winner_name AS winnerName FROM contests WHERE election_key = ?1 ORDER BY seq',
});

export const RECORD_PAGES = Object.freeze({
  /** [slug] -> { slug, card, detail }: a party, following a retired slug */
  party: 'SELECT slug, card, detail FROM party_cards WHERE slug = ?1 OR slug = (SELECT slug FROM party_aliases WHERE alias = ?1) ORDER BY (slug = ?1) DESC LIMIT 1',
  /** [slug] -> { detail, card } */
  office: 'SELECT detail, card FROM office_cards WHERE slug = ?1 ORDER BY ord LIMIT 1',
  /** [] -> { slug }: whether map_cards holds anything */
  anyMap: 'SELECT slug FROM map_cards LIMIT 1',
});
