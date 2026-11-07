// @ts-check
/**
 * The R2 key migration of the layer-id rename, as an explicit machine (state-machine catalogue
 * PL-03, refactor plan section 10.2).
 *
 * Each PMTiles archive moves from its old key (data/maps/test/pmtiles/generated/<id>-vector-test
 * .pmtiles) to its new one (data/maps/pmtiles/<id>-vector.pmtiles):
 *
 *   old-key --plan--> copy-planned --copy--> copied --switch tileUrl--> serving-new --retire--> old-retired
 *      ^                   |                   |
 *      +--- error <--------+-------------------+   (copy failed, or the two keys hold different bytes)
 *
 * The state used to be inferred from strings, which is how one manifest regeneration moved all 934
 * entries to the new keys before any copy existed (fixed in 95cec4d53c; the manifest now keeps each
 * archive's own key, pmtiles-keys.mjs). Here r2-copy-keys's per-pair statuses map onto the states,
 * its receipt records them, and the two moves that change what the site serves are guarded:
 * `copied -> serving-new` needs a verify that both keys hold the same object, and
 * `serving-new -> old-retired` needs the owner's recorded approval.
 */
import { defineMachine } from '../lib/state-machine.mjs';
import { layerIdForm } from '../lib/layer-renames.mjs';
import { assertTransition, checkTransition, defineGuards } from './transition-check.mjs';

/** @typedef {'old-key' | 'copy-planned' | 'copied' | 'serving-new' | 'old-retired' | 'error'} KeyState */

export const keyMigration = defineMachine(/** @type {import('../lib/state-machine.mjs').MachineSpec<KeyState>} */ ({
  name: 'R2 key migration',
  initial: 'old-key',
  transitions: {
    'old-key': ['copy-planned', 'copied'],
    'copy-planned': ['copied', 'error'],
    copied: ['serving-new', 'error'],
    error: ['copy-planned', 'copied'],
    'serving-new': ['old-retired'],
    'old-retired': [],
  },
}));

export const keyMigrationGuards = defineGuards(keyMigration, {
  'copied->serving-new': (/** @type {{ verifyStatus?: string }} */ ctx) => (
    ctx.verifyStatus === 'ok' ? null : `r2-copy-keys verify says ${ctx.verifyStatus || 'nothing'}, not ok: both keys must hold the same object first`
  ),
  'serving-new->old-retired': (/** @type {{ approval?: { date?: string, note?: string } }} */ ctx) => (
    ctx.approval?.date && ctx.approval?.note ? null : "retiring an old key deletes a public object: it needs the owner's approval {date, note}"
  ),
});

/** @param {string} from @param {string} to @param {object} [context] */
export const checkKeyTransition = (from, to, context) => checkTransition(keyMigration, keyMigrationGuards, from, to, context);
/** @param {string} from @param {KeyState} to @param {object} [context] */
export const assertKeyTransition = (from, to, context) => assertTransition(keyMigration, keyMigrationGuards, from, to, context);

/** The state an r2-copy-keys copy result puts its pair in. @param {string} status @returns {KeyState} */
export function stateAfterCopy(status) {
  if (status === 'planned') return 'copy-planned';
  if (status === 'copied' || status === 'already-copied') return 'copied';
  return 'error';
}

/**
 * The state an r2-copy-keys verify result shows. `old-missing` means only the new key holds the
 * archive: retired, or never uploaded under the old one; the bucket cannot tell which, so it reads
 * as the end state and a switch does not need it.
 * @param {string} status
 * @returns {KeyState}
 */
export function stateFromVerify(status) {
  if (status === 'ok') return 'copied';
  if (status === 'new-missing') return 'old-key';
  if (status === 'old-missing') return 'old-retired';
  return 'error';
}

/**
 * Whether a pair is the rename's shape: an old-prefix key whose name is the legacy id (or, for an
 * archive uploaded after the id rename, already the current one) and a new key with the current
 * id. Reason or null.
 * @param {{ from: string, to: string }} pair
 */
export function pairShapeProblem({ from, to }) {
  const stem = (/** @type {string} */ key) => key.slice(key.lastIndexOf('/') + 1).replace(/\.pmtiles$/, '');
  if (layerIdForm(stem(to)) !== 'current') return `${to} is not named by a renamed (-vector, -raster, -alias) id`;
  if (layerIdForm(stem(from)) === 'other') return `${from} is not named by a layer id on either side of the rename`;
  return null;
}
