/**
 * The records dataset's loading flag (DESIGN.md 3.2) as a two-state toggle (REFACTOR-PLAN.md
 * section 11, light weight): `loaded` while dataset.loading is '' (or absent), `loading` while it
 * holds the version being loaded. A delta's first statement moves it to loading and its last back
 * to loaded (diff-load.mjs); the Functions cache nothing while it is loading
 * (packages/storage/src/store.js datasetState); a verify fails while it is still loading.
 */
import { defineToggle } from '../../../scripts/lib/state-machine.mjs';

/** @typedef {'loaded'|'loading'} DatasetLoadState */

export const DATASET_LOAD = defineToggle('records dataset', /** @type {[DatasetLoadState, DatasetLoadState]} */ (['loaded', 'loading']));

/** The dataset key that holds the flag. */
export const LOADING_KEY = 'loading';

/**
 * The value written to dataset.loading on entering a state: the version being loaded (or the
 * word 'loading' when there is none), or '' once it is loaded.
 * @param {DatasetLoadState} state
 * @param {string} [version]
 * @returns {string}
 */
export function loadingValue(state, version = '') {
  return state === 'loading' ? version || 'loading' : '';
}

/**
 * The state a stored dataset.loading value means.
 * @param {unknown} value
 * @returns {DatasetLoadState}
 */
export function datasetLoadState(value) {
  return value ? 'loading' : 'loaded';
}
