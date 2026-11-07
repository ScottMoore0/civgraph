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

import { defineMachine } from '../../../scripts/lib/state-machine.mjs';
import { createFlag, createState } from '../state-helpers.mjs';

/** @typedef {'idle' | 'restoring' | 'queued'} UrlRestoreState */

export const URL_RESTORE = defineMachine({
  name: 'URL restore',
  initial: /** @type {UrlRestoreState} */ ('idle'),
  transitions: {
    // A restore that overlapped another (the replay racing a new hashchange) ends after the
    // first one has already set the state back to idle.
    idle: ['restoring', 'idle'],
    restoring: ['restoring', 'queued', 'idle'],
    queued: ['queued', 'idle']
  }
});

/**
 * A running URL-restore machine for the app (`this.urlRestore`), with the three moves the app
 * makes named after what it is doing.
 */
export function createUrlRestore() {
  const run = createState(URL_RESTORE);
  return {
    state: () => run.state(),
    /** Restoring (or restoring with a replay queued): nothing writes the address. */
    get active() { return run.state() !== 'idle'; },
    /** restoreURLState starts: restoring, or still queued if a replay was already due. */
    begin: () => run.to(run.state() === 'queued' ? 'queued' : 'restoring'),
    /** A hashchange during a restore: replay it once the restore is done. */
    queue: () => run.to('queued'),
    /** restoreURLState is done: idle; returns whether a queued hashchange is to be replayed. */
    end() {
      const replay = run.state() === 'queued';
      run.to('idle');
      return replay;
    }
  };
}

/** The app's hold on the address (`this.urlSuspend`): on while nothing may write it. */
export function createUrlSuspend() {
  return createFlag('URL suspend');
}

/** @typedef {'none' | 'pending'} NavigationPushState */

/**
 * The next address write as a history entry (MA-02, full weight): `beginNavigation(label)`
 * marks that the next write pushes an entry named `label` rather than replacing the current
 * one; the write takes the label (pending -> none), and `endNavigation`, a failed load or a
 * superseded election clear it. It was `_pushNextURL`, null or a label, written from three
 * modules.
 */
export const NAVIGATION_PUSH = defineMachine({
  name: 'navigation push',
  initial: /** @type {NavigationPushState} */ ('none'),
  transitions: {
    // Clearing with nothing pending is a no-op, as setting the old field to null was.
    none: ['pending', 'none'],
    // A second beginNavigation before the write renames the entry.
    pending: ['pending', 'none']
  }
});

/** The app's pending history push (`this.navigationPush`). */
export function createNavigationPush() {
  const run = createState(NAVIGATION_PUSH);
  /** @type {string | null} */
  let label = null;
  return {
    state: () => run.state(),
    get pending() { return run.state() === 'pending'; },
    /** The label the next pushed entry will carry, or null. */
    get label() { return label; },
    /** @param {string} next */
    begin(next) {
      run.to('pending');
      label = next;
    },
    /** Forget the pending push. */
    clear() {
      run.to('none');
      label = null;
    },
    /** The write pushes: returns the label and clears. */
    take() {
      const taken = label;
      run.to('none');
      label = null;
      return taken;
    }
  };
}

/** @typedef {'listening' | 'ignoring'} HashListenState */

/**
 * The hashchange listener's two states (MA-02): `undoNavigationSince` steps back over a failed
 * step with history.go, whose hashchange is not the reader's; the listener ignores hashchanges
 * until each such step's 500 ms release has run. Holds nest (a count), as the old
 * `_ignoreHashChanges` counter did; the state is `ignoring` while any hold is out.
 */
export const HASH_LISTEN = defineMachine({
  name: 'hash listen',
  initial: /** @type {HashListenState} */ ('listening'),
  transitions: {
    // A release with no hold out leaves it listening (the old Math.max(0, n - 1)).
    listening: ['ignoring', 'listening'],
    ignoring: ['ignoring', 'listening']
  }
});

/** The app's hashchange ignore count (`this.hashListen`). */
export function createHashListen() {
  const run = createState(HASH_LISTEN);
  let holds = 0;
  return {
    state: () => run.state(),
    get ignoring() { return run.state() === 'ignoring'; },
    get holds() { return holds; },
    hold() {
      holds += 1;
      run.to('ignoring');
    },
    release() {
      holds = Math.max(0, holds - 1);
      run.to(holds ? 'ignoring' : 'listening');
    }
  };
}
