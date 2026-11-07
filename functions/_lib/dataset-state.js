/**
 * The records dataset's state as the Functions read it (refactor state machine FN-03).
 *
 * The records loader writes D1's `dataset` table (scripts/records/, RC-01): `version` is the
 * loaded dataset, `loading` holds the version being loaded while a delta runs and is '' once it
 * is loaded. The writer names those two states `loaded` and `loading`
 * (scripts/records/dataset-state.mjs); the reader adds `unknown`, for a database with no
 * dataset table or one that could not be read. Same names on both sides, mirrored here because a
 * Function cannot import scripts/.
 *
 *   unknown   no version and no loading flag: answers carry no dataset version
 *   loaded    version v, loading ''
 *   loading   loading set (the version being loaded); answers are not stored at the edge
 *             (functions/_api/_records.js cachedJson), so a half-applied delta is never cached
 *
 * The reader cannot refuse what D1 says, so there is no transition guard here: any state may
 * follow any other between two reads. What the state decides is what a Function may do with an
 * answer (STORE below), and that is the table the tests hold.
 *
 * Read through the storage adapter (functions/_lib/storage/: fromD1, datasetState), so the
 * same reader runs over D1 and over a local SQLite store.
 *
 * ONE memo per isolate, read at most once a minute, shared by the JSON answers (cachedJson) and
 * the server-rendered pages (respond.js datasetVersion): before this they kept a memo each and
 * could disagree for up to a minute about which version was loaded.
 */
import { fromD1 } from './storage/d1.js';
import { datasetState } from './storage/store.js';

/** @typedef {'unknown' | 'loaded' | 'loading'} DatasetPhase */

/** @type {readonly DatasetPhase[]} */
export const DATASET_PHASES = Object.freeze(['unknown', 'loaded', 'loading']);

/** Whether an answer built in this phase may be stored at the edge (and as last-good). */
export const STORE = Object.freeze(/** @type {Record<DatasetPhase, boolean>} */ ({ unknown: true, loaded: true, loading: false }));

/**
 * @param {{ version: string, loading: string }} state
 * @returns {DatasetPhase}
 */
export function phaseOf({ version, loading }) {
  if (loading) return 'loading';
  return version ? 'loaded' : 'unknown';
}

export const MEMO_MS = 60_000;

/** @typedef {{ version: string, loading: string, expires: number }} DatasetMemo */

/** @type {DatasetMemo} */
let memo = { version: '', loading: '', expires: 0 };

/**
 * The dataset's version and loading flag ('' when absent or unreadable), read at most once a
 * minute per isolate.
 * @param {D1Database} db
 * @param {number} [now]
 * @returns {Promise<DatasetMemo>}
 */
export async function readDataset(db, now = Date.now()) {
  if (now < memo.expires) return memo;
  let state = { version: '', loading: '' };
  try { state = await datasetState(fromD1(db)); } catch { /* keep '' */ }
  memo = { version: String(state.version || ''), loading: String(state.loading || ''), expires: now + MEMO_MS };
  return memo;
}

/** For tests: forget the memo. */
export function resetDatasetMemo() {
  memo = { version: '', loading: '', expires: 0 };
}
