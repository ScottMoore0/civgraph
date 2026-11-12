/**
 * The headline record figures from D1, named as scripts/build/build-site-stats.mjs names them, so a
 * page can state them from the database (data design phase 2; the committed figures stay until
 * phase 4 moves the pages over).
 *
 *   GET /_api/stats -> { elections, electionContests, candidacies, people, cataloguedSources,
 *                        parties, registerEntries, divisions, graphEntities, version }
 */
import { cachedJson, datasetState, jsonResponse } from '../_records.js';
import { reportError } from '../_error.js';
import { binding } from '../../../../config/src/config.js';
import { fromD1 } from '../../../../storage/src/d1.js';
import { STATS } from '../../queries/stats.js';

const VERSION = 'stats-1';

/** @param {import('../../types.js').ApiContext} context */
export async function onRequestGet(context) {
  return cachedJson(context, VERSION, async () => {
    // cachedJson calls this only when ELECTIONS_DB is bound
    const db = /** @type {D1Database} */ (binding(context.env, 'ELECTIONS_DB'));
    try {
      // through the storage adapter (packages/storage/): the same SQL over D1 or SQLite
      const store = fromD1(db);
      const entries = await Promise.all(Object.entries(STATS).map(async ([name, sql]) => [name, (await store.value(sql)) ?? 0]));
      const { version } = await datasetState(db);
      return jsonResponse({ ...Object.fromEntries(entries), version });
    } catch (error) {
      return jsonResponse({ error: 'stats query failed', ...reportError(context.env, 'stats', error) }, 500);
    }
  });
}
