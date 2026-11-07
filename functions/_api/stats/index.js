/**
 * The headline record figures from D1, named as scripts/build/build-site-stats.mjs names them, so a
 * page can state them from the database (data design phase 2; the committed figures stay until
 * phase 4 moves the pages over).
 *
 *   GET /_api/stats -> { elections, electionContests, candidacies, people, cataloguedSources,
 *                        parties, registerEntries, divisions, graphEntities, version }
 */
import { T, cachedJson, datasetState, jsonResponse } from '../_records.js';
import { reportError } from '../_error.js';
import { binding } from '../../_lib/config.js';

const VERSION = 'stats-1';

const COUNTS = {
  elections: `SELECT COUNT(*) AS n FROM ${T.elections}`,
  electionContests: 'SELECT COUNT(*) AS n FROM contests',
  candidacies: 'SELECT COUNT(*) AS n FROM candidacies',
  people: 'SELECT COUNT(*) AS n FROM person_cards',
  cataloguedSources: 'SELECT COUNT(*) AS n FROM sources',
  parties: 'SELECT COUNT(*) AS n FROM party_cards',
  registerEntries: 'SELECT COUNT(*) AS n FROM register_entries',
  divisions: 'SELECT COUNT(*) AS n FROM divisions',
  graphEntities: 'SELECT COUNT(*) AS n FROM graph_entities',
};

export async function onRequestGet(context) {
  return cachedJson(context, VERSION, async () => {
    const db = binding(context.env, 'ELECTIONS_DB');
    try {
      const entries = await Promise.all(Object.entries(COUNTS).map(async ([name, sql]) => [name, (await db.prepare(sql).first())?.n ?? 0]));
      const { version } = await datasetState(db);
      return jsonResponse({ ...Object.fromEntries(entries), version });
    } catch (error) {
      return jsonResponse({ error: 'stats query failed', ...reportError(context.env, 'stats', error) }, 500);
    }
  });
}
