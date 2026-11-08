// @ts-check
/**
 * One point-cloud tile's content as an explicit state machine (refactor plan section 11, full
 * weight; state-machine catalogue MA-12). Each tile (a node of point-cloud-stream-layer.js) keeps
 * its state in `node.state`, a plain string read every frame; every write goes through
 * `moveNode`, which checks the move against this table.
 *
 *   unloaded -> queued    the view wants the tile (_enqueue)
 *   queued -> loading     _pump starts its fetch
 *   queued -> unloaded    _pump finds it wanted only by a view long gone (stale)
 *   loading -> loaded     the tile arrived and is on the GPU (_upload)
 *   loading -> unloaded   the fetch or the parse failed (tried again when next wanted)
 *   loaded -> unloaded    evicted to keep within the point budget
 *
 * The catalogue's low risk is kept: there is no failed state, so a tile that keeps failing is
 * fetched again each time it is wanted.
 */
import { defineMachine } from '../../../core/src/state-machine.mjs';

/** @typedef {'unloaded' | 'queued' | 'loading' | 'loaded'} PointCloudNodeState */

export const POINT_CLOUD_NODE = defineMachine({
  name: 'point-cloud tile',
  initial: /** @type {PointCloudNodeState} */ ('unloaded'),
  transitions: {
    unloaded: ['queued'],
    queued: ['loading', 'unloaded'],
    loading: ['loaded', 'unloaded'],
    loaded: ['unloaded']
  }
});

/**
 * Move a tile to `next`, or throw if the table has no such move.
 * @param {{ state: PointCloudNodeState }} node
 * @param {PointCloudNodeState} next
 */
export function moveNode(node, next) {
  POINT_CLOUD_NODE.assertTransition(node.state, next);
  node.state = next;
}
