// @ts-check
/**
 * The timeline's Play button as an explicit state machine (refactor plan section 11, full weight).
 *
 * It was three booleans on app.timelineAnimation (`playing`, `paused`, `atEnd`) written in pairs
 * and triples from five places (start, advance, pause, stop, hideTimeline). Only four of their
 * eight combinations ever occurred, and these are the states:
 *
 *   idle     nothing running: the Play button plays
 *   playing  stepping through the editions
 *   paused   stopped part-way; Play resumes from the step it stopped on
 *   ended    the last step was reached; Play replays from the first
 *
 * `createTimelineAnimationState` builds the object the app keeps as `this.timelineAnimation`:
 * the same fields as before, with `playing`, `paused` and `atEnd` now read-only views of `phase`,
 * so a stray assignment throws instead of making a fifth combination. Moves go through
 * `to(state)` and the table below (the shared helper, src/map/state-machine.mjs).
 */

import { defineMachine } from '../../state-machine.mjs';

/** @typedef {'idle' | 'playing' | 'paused' | 'ended'} TimelinePlaybackState */

export const TIMELINE_PLAYBACK = defineMachine({
  name: 'timeline playback',
  initial: /** @type {TimelinePlaybackState} */ ('idle'),
  transitions: {
    // startTimelineAnimation plays from the start, from where it was paused, or again from the
    // first step after the end; Play while playing restarts the run (the button pauses instead,
    // but startTimelineAnimation itself has always allowed it). stopTimelineAnimation and
    // hideTimeline stop from any state, idle included.
    idle: ['playing', 'idle'],
    // advance reaches the last step: ended. pauseTimelineAnimation pauses only a run that is
    // playing or paused.
    playing: ['playing', 'paused', 'ended', 'idle'],
    paused: ['playing', 'paused', 'idle'],
    ended: ['playing', 'idle']
  }
});

/**
 * @typedef {object} TimelineAnimationState
 * @property {TimelinePlaybackState} phase
 * @property {boolean} playing  phase === 'playing' (read-only)
 * @property {boolean} paused  phase === 'paused' (read-only)
 * @property {boolean} atEnd  phase === 'ended' (read-only)
 * @property {(next: TimelinePlaybackState) => TimelinePlaybackState} to  move, or throw if the table has no such move
 * @property {number} timer
 * @property {number} runId
 * @property {string | null} originalLayerId
 * @property {number} currentIndex
 * @property {string | null} singleLayerReferenceId
 * @property {any[]} sequenceItems
 * @property {(() => void) | null} [delayResolve]
 */

/**
 * The app's `timelineAnimation`: the playback machine plus the run's bookkeeping, which keeps
 * its plain fields.
 *
 * @param {Partial<Omit<TimelineAnimationState, 'phase' | 'playing' | 'paused' | 'atEnd' | 'to'>>} fields
 * @returns {TimelineAnimationState}
 */
export function createTimelineAnimationState(fields = {}) {
  const run = TIMELINE_PLAYBACK.start();
  const state = {
    get phase() { return run.state(); },
    get playing() { return run.state() === 'playing'; },
    get paused() { return run.state() === 'paused'; },
    get atEnd() { return run.state() === 'ended'; },
    to: (/** @type {TimelinePlaybackState} */ next) => run.to(next),
    timer: 0,
    runId: 0,
    originalLayerId: null,
    currentIndex: 0,
    singleLayerReferenceId: null,
    sequenceItems: [],
    ...fields
  };
  return /** @type {TimelineAnimationState} */ (state);
}
