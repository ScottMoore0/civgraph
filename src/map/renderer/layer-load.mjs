// @ts-check
/**
 * A layer's load in the renderer as an explicit state machine (refactor plan section 11, full
 * weight; state-machine catalogue MA-06, fixed with the owner's approval of 7 Nov 2026).
 *
 *   absent   not on the map
 *   loading  loadLayer is awaiting the map and the layer's duplicate-id list
 *   loaded   its sources and layers are on the map
 *
 * The loading state used to be unrecorded: two loads of one layer both passed the "already
 * loaded?" test before their awaits, and the second threw "source already exists"; an unload
 * during the awaits found nothing to remove, and the layer appeared after the reader had taken it
 * off. Now a second load waits for the first, and an unload while loading cancels the load.
 */
import { defineMachine } from '../../../scripts/lib/state-machine.mjs';

/** @typedef {'absent' | 'loading' | 'loaded'} LayerLoadState */

export const LAYER_LOAD = defineMachine({
  name: 'layer load',
  initial: /** @type {LayerLoadState} */ ('absent'),
  transitions: {
    absent: ['loading'],
    // loaded: the load finished; absent: unloadLayer cancelled it.
    loading: ['loaded', 'absent'],
    loaded: ['absent']
  }
});
