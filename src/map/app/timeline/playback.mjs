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
 * `send(event)` and the table below.
 */

import { createMachine, defineMachine } from '../../state-machine.mjs';

/** @typedef {'idle' | 'playing' | 'paused' | 'ended'} TimelinePlaybackState */
/** @typedef {'play' | 'pause' | 'finish' | 'stop'} TimelinePlaybackEvent */

export const TIMELINE_PLAYBACK = defineMachine({
  name: 'timeline playback',
  initial: /** @type {TimelinePlaybackState} */ ('idle'),
  states: /** @type {const} */ (['idle', 'playing', 'paused', 'ended']),
  events: /** @type {const} */ (['play', 'pause', 'finish', 'stop']),
  transitions: {
    // startTimelineAnimation: from the start, from where it was paused, or again from the first
    // step after the end. Play while playing restarts the run (the button pauses instead, but
    // startTimelineAnimation itself has always allowed it).
    idle: { play: 'playing', stop: 'idle' },
    playing: { play: 'playing', pause: 'paused', finish: 'ended', stop: 'idle' },
    // pauseTimelineAnimation pauses only a run that is playing or paused.
    paused: { play: 'playing', pause: 'paused', stop: 'idle' },
    // stopTimelineAnimation and hideTimeline stop from any state.
    ended: { play: 'playing', stop: 'idle' }
  }
});

/**
 * @typedef {object} TimelineAnimationState
 * @property {TimelinePlaybackState} phase
 * @property {boolean} playing  phase === 'playing' (read-only)
 * @property {boolean} paused  phase === 'paused' (read-only)
 * @property {boolean} atEnd  phase === 'ended' (read-only)
 * @property {(event: TimelinePlaybackEvent) => TimelinePlaybackState} send
 * @property {(event: TimelinePlaybackEvent) => boolean} can
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
 * @param {Partial<Omit<TimelineAnimationState, 'phase' | 'playing' | 'paused' | 'atEnd' | 'send' | 'can'>>} fields
 * @returns {TimelineAnimationState}
 */
export function createTimelineAnimationState(fields = {}) {
  const machine = createMachine(TIMELINE_PLAYBACK);
  const state = {
    get phase() { return machine.state; },
    get playing() { return machine.state === 'playing'; },
    get paused() { return machine.state === 'paused'; },
    get atEnd() { return machine.state === 'ended'; },
    send: (/** @type {TimelinePlaybackEvent} */ event) => machine.send(event),
    can: (/** @type {TimelinePlaybackEvent} */ event) => machine.can(event),
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
