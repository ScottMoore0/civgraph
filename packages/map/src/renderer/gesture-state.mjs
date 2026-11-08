// @ts-check
/**
 * The map's direct gesture handling as an explicit state machine (refactor plan section 11, full
 * weight; state-machine catalogue MA-11).
 *
 * When MapLibre's own handlers fail to move the camera (some phones, some embedded browsers),
 * map-controller.js drives it itself: a one-finger pan, a two-finger pinch, or the wheel. While
 * one of them is driving, the map's moveend and idle do not announce a change (they would fire on
 * every frame). That was one boolean, `directGestureActive`, set true by each gesture as it moved
 * and false by each as it ended; it is now this machine, which also says which gesture holds it.
 * `directGestureActive` reads `state !== 'idle'`.
 *
 * The table is complete on purpose, and keeps the old boolean's behaviour exactly: any gesture
 * may take over from another (a wheel during a pan), and any one's end returns to idle, even
 * while another is still under way (the catalogue's medium risk: the wheel's 140 ms end timer
 * clearing a pan; kept, so change notifications fire as before). Each gesture's own progress
 * (state.fallbackActive, state.moved) stays with that gesture.
 */
import { defineMachine } from '../../../../scripts/lib/state-machine.mjs';

/** @typedef {'idle' | 'pan' | 'pinch' | 'wheel'} DirectGestureState */

const ALL = /** @type {DirectGestureState[]} */ (['idle', 'pan', 'pinch', 'wheel']);

export const DIRECT_GESTURE = defineMachine({
  name: 'direct gesture',
  initial: /** @type {DirectGestureState} */ ('idle'),
  transitions: { idle: ALL, pan: ALL, pinch: ALL, wheel: ALL }
});
