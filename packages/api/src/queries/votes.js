/** Named queries: divisions, their votes, and the per-person and per-party vote documents (storage slice ST-6). */

export const VOTES = Object.freeze({
  /** [shard] -> { division_id, record } */
  shardDivisions: 'SELECT division_id, record FROM divisions WHERE shard = ?1 ORDER BY ord, division_id',
  /** [shard] -> { division_id, entry } */
  shardVotes: 'SELECT v.division_id, v.entry FROM division_votes v JOIN divisions d ON d.division_id = v.division_id WHERE d.shard = ?1 ORDER BY v.division_id, v.ord',
  /** [divisionId] -> { division_id, record } */
  division: 'SELECT division_id, record FROM divisions WHERE division_id = ?1',
  /** [divisionId] -> { entry } */
  divisionVotes: 'SELECT entry FROM division_votes WHERE division_id = ?1 ORDER BY ord',
  /** [personId] -> { record } */
  person: 'SELECT record FROM vote_persons WHERE person_id = ?1',
  /** [slug] -> { record } */
  party: 'SELECT record FROM vote_parties WHERE slug = ?1',
});
