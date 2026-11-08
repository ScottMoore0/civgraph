// @ts-check
/**
 * The grouped NI local-election view (packages/map/app/ni-local-view.js) as an explicit state machine
 * (refactor plan section 11, full weight; state-machine catalogue MA-05).
 *
 *   inactive   no grouped year open
 *   opening    open() is fetching the year's data
 *   active     the year is open (the old `active` flag was true)
 *   switching  setLevel is swapping the level's map (still active to every reader)
 *
 * The view's `active` is now a read-only view of this state: true while active or switching.
 * The table keeps the old behaviour exactly, including the two moves the catalogue lists as
 * risks (no request token yet): a teardown while the year's data is on its way does not stop
 * open() from activating the view when it arrives (inactive -> active), and a second open
 * resolving after the first has activated the view activates it again (active -> active).
 */
import { defineMachine } from '../../../../scripts/lib/state-machine.mjs';

/** @typedef {'inactive' | 'opening' | 'active' | 'switching'} NiLocalViewState */

export const NI_LOCAL_VIEW = defineMachine({
  name: 'NI grouped local view',
  initial: /** @type {NiLocalViewState} */ ('inactive'),
  transitions: {
    // opening: open(); inactive: teardown with nothing open; active: an open whose fetch
    // outlived a teardown (MA-05 risk, kept).
    inactive: ['opening', 'inactive', 'active'],
    // opening: a second open before the first's data arrived; active: the data arrived;
    // inactive: teardown, or the fetch failed.
    opening: ['opening', 'active', 'inactive'],
    // switching: setLevel; inactive: teardown; active: a second open resolving (MA-05 risk, kept).
    active: ['switching', 'inactive', 'active'],
    // switching: a second setLevel while the first loads (no in-flight guard, as before);
    // active: setLevel done, or an open resolving; inactive: teardown.
    switching: ['switching', 'active', 'inactive']
  }
});

/** Whether the view counts as open in this state (the old `active` flag). @param {NiLocalViewState} state */
export const niLocalViewActive = (state) => state === 'active' || state === 'switching';
