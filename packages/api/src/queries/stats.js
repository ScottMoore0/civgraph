/** Named queries: the headline record counts of /_api/stats (storage slice ST-6). */
import { T } from './tables.js';

/** Each figure's count, by the name build-site-stats.mjs gives it; each [] -> { n } */
export const STATS = Object.freeze({
  elections: `SELECT COUNT(*) AS n FROM ${T.elections}`,
  electionContests: 'SELECT COUNT(*) AS n FROM contests',
  candidacies: 'SELECT COUNT(*) AS n FROM candidacies',
  people: 'SELECT COUNT(*) AS n FROM person_cards',
  cataloguedSources: 'SELECT COUNT(*) AS n FROM sources',
  parties: 'SELECT COUNT(*) AS n FROM party_cards',
  registerEntries: 'SELECT COUNT(*) AS n FROM register_entries',
  divisions: 'SELECT COUNT(*) AS n FROM divisions',
  graphEntities: 'SELECT COUNT(*) AS n FROM graph_entities',
});
