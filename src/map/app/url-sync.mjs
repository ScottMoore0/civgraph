// @ts-check
/**
 * The address bar's two states for the map app (refactor plan section 11).
 *
 * Restoring the map from the address (restoreURLState) is entered from three places: start-up,
 * the hashchange that Back and Forward fire, and the replay of a hashchange that arrived while a
 * restore was still running. It was two booleans, `_restoringURLState` and `_hashRestorePending`;
 * it is now one machine (full weight):
 *
 *   idle       the address follows the map (updateURLState writes it)
 *   restoring  the map is being set from the address; nothing writes it
 *   queued     restoring, and a hashchange came in meanwhile: restore again once this one ends
 *
 * A restore begun while one is running (the replay racing a new hashchange) keeps the state it
 * found, and the later of the two to end finds it idle, as the old flag did.
 *
 * Holding the address still while something else changes the map (start-up until the first
 * restore is done, an election being swapped for another) is a plain toggle that nests: the
 * light weight, `createFlag`.
 */

import { createFlag, createMachine, defineMachine } from '../state-machine.mjs';

/** @typedef {'idle' | 'restoring' | 'queued'} UrlRestoreState */
/** @typedef {'begin' | 'queue' | 'end'} UrlRestoreEvent */

export const URL_RESTORE = defineMachine({
  name: 'URL restore',
  initial: /** @type {UrlRestoreState} */ ('idle'),
  states: /** @type {const} */ (['idle', 'restoring', 'queued']),
  events: /** @type {const} */ (['begin', 'queue', 'end']),
  transitions: {
    // A restore that overlapped another (the replay racing a new hashchange) ends after the
    // first one has already set the state back to idle.
    idle: { begin: 'restoring', end: 'idle' },
    restoring: { begin: 'restoring', queue: 'queued', end: 'idle' },
    queued: { begin: 'queued', queue: 'queued', end: 'idle' }
  }
});

/** A running URL-restore machine for the app (`this.urlRestore`). */
export function createUrlRestore() {
  return createMachine(URL_RESTORE);
}

/** The app's hold on the address (`this.urlSuspend`): on while nothing may write it. */
export function createUrlSuspend() {
  return createFlag('URL suspend');
}
