// @ts-check
/**
 * Opening an election as an explicit state machine (refactor plan section 11, full weight;
 * state-machine catalogue MA-03, fixed with the owner's approval of 7 Nov 2026).
 *
 *   closed   no election open (or one being replaced, between its unload and the next load)
 *   loading  loadElection is fetching the results, the boundaries and the feature index
 *   open     the election is on the map and in the pane
 *
 * The request id (loadSerial) still tells a current load from a superseded one. What changed:
 * closing an election (the Close button, or Back) while it loads now cancels that load, which used
 * to finish and reopen it; a grouped NI year supersedes an ordinary load still on its way; and a
 * superseded load that fails no longer reports its error over the newer one.
 */
import { defineMachine } from '../../../core/src/state-machine.mjs';

/** @typedef {'closed' | 'loading' | 'open'} ElectionLoadState */

export const ELECTION_LOAD = defineMachine({
  name: 'election load',
  initial: /** @type {ElectionLoadState} */ ('closed'),
  transitions: {
    // unloadElection may run with nothing open.
    closed: ['loading', 'closed'],
    // loading: a newer load supersedes this one; open: it arrived; closed: it failed, or the
    // election was closed (or replaced by a grouped NI year) while it loaded.
    loading: ['loading', 'open', 'closed'],
    // loading: the same election again (a timeline step), or another one after the unload.
    open: ['loading', 'closed']
  }
});
