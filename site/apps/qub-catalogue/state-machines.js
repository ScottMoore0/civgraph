/**
 * The Independent QUB Catalogue app's state machines (architecture rule R7), over the shared
 * helper (assets/ui/state/machine.js). app.js runs them; the unit test qub-app.test.mjs walks every
 * forbidden move.
 */
import { defineMachine } from '../../assets/ui/state/machine.js';

/**
 * The current search's results, page by page.
 *   idle -> loading    a page is requested (the first, or "More results")
 *   loading -> idle    a full page came, so more may follow
 *   loading -> done    the last page
 *   loading -> failed  the API answered with an error
 *   any -> idle        a new search (the old request is then stale and moves nothing)
 */
export const RESULTS = defineMachine({
  name: 'qub results',
  initial: 'idle',
  transitions: {
    idle: ['idle', 'loading'],
    loading: ['idle', 'done', 'failed'],
    done: ['idle'],
    failed: ['idle'],
  },
});

/** Which view is shown: the search or a record. route() can reach either from either. */
export const VIEW = defineMachine({
  name: 'qub view',
  initial: 'search',
  transitions: {
    search: ['search', 'record'],
    record: ['search', 'record'],
  },
});
