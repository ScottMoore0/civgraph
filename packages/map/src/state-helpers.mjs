// @ts-check
/**
 * The map app's light-weight state helpers (refactor plan section 11), built on the shared
 * machine helper, scripts/lib/state-machine.mjs (the app bundle inlines it, as it does
 * scripts/lib/layer-renames.mjs for url-compat.mjs).
 *
 * - `defineChoice(name, values)`: a field that holds one of a few fixed strings (the election
 *   overlay, the local level) keeps its plain string, and every assignment goes through
 *   `check(value)`, which returns the value unchanged and throws for one outside the choice.
 * - `createFlag(name)`: a boolean that is set, or held for the length of an operation and put
 *   back after it (holds nest: each release restores what its own hold found). Setting it to the
 *   value it already has is allowed, as assigning the old boolean was.
 * - `createLatch(name)`: a flag that may be set but never cleared (install-once guards), and
 *   `defineFlagFields(target, names)`, the one-line conversion of boolean fields to accessors
 *   over flags or latches, reads and writes unchanged.
 * - `createHoldCount(name)`: a re-entrancy count, idle or held.
 * - `setHidden(node, hidden)`: the DOM `hidden` toggles (a status line, a panel, a tooltip, a
 *   label): the element's own boolean, set through one checked call, so a value that is not a
 *   boolean throws instead of being coerced. Nothing the app sets today is anything else.
 * - `present(value, what)`: a value the code goes on to use as present (a node its own markup
 *   created, a field set before the call): returned as it is, or a TypeError, the error that
 *   reading a property of null or undefined at the same statement raised before.
 * - `createState(machine, from)`: the current state of a full machine, kept without the run's
 *   history. The map app's machines last as long as the page and some move on every gesture or
 *   frame (the gestures, the point-cloud tiles), so a run that remembers every state it entered
 *   would grow without limit; this holder checks each move against the table and keeps only
 *   where it is.
 */

import { defineMachine } from '../../../scripts/lib/state-machine.mjs';

/**
 * @template {string} V
 * @param {string} name
 * @param {readonly V[]} values  the allowed values; the first is the initial one
 */
export function defineChoice(name, values) {
  if (!values.length) throw new Error(`${name}: a choice needs at least one value`);
  // Any value may follow any other, itself included: the table only fixes the set.
  const machine = defineMachine({
    name,
    initial: values[0],
    transitions: /** @type {Record<V, V[]>} */ (Object.fromEntries(values.map((value) => [value, [...values]])))
  });
  return Object.freeze({
    name,
    machine,
    values: machine.states,
    initial: machine.initial,
    /** @param {unknown} value @returns {value is V} */
    has: (value) => machine.states.includes(/** @type {V} */ (value)),
    /** @param {unknown} value @returns {V} */
    check(value) {
      if (!machine.states.includes(/** @type {V} */ (value))) {
        throw new TypeError(`${name}: "${String(value)}" is not one of ${machine.states.join(', ')}`);
      }
      return /** @type {V} */ (value);
    }
  });
}

/**
 * @template {string} S
 * @param {import('../../../scripts/lib/state-machine.mjs').Machine<S>} machine
 * @param {S} [from]  the state to start in (the machine's initial one by default)
 */
export function createState(machine, from = machine.initial) {
  if (!machine.states.includes(from)) throw new Error(`${machine.name}: ${from} is not a state`);
  let current = from;
  return {
    machine,
    /** The current state (the same call as the shared helper's run, without its history). */
    state: () => current,
    /** @param {S} state */
    is: (state) => current === state,
    /** Whether the table allows a move from here to `next`. @param {S} next */
    can: (next) => machine.can(current, next),
    /** Move, or throw if the table has no such move; returns the new state. @param {S} next */
    to(next) {
      machine.assertTransition(current, next);
      current = next;
      return current;
    }
  };
}

/** The flag's two states, either reachable from either (itself included). */
/** @typedef {'off' | 'on'} FlagState */
const FLAG_TRANSITIONS = /** @type {Readonly<Record<FlagState, readonly FlagState[]>>} */ (Object.freeze({ off: ['off', 'on'], on: ['off', 'on'] }));
/** A latch: set once and never cleared (install-once guards). */
const LATCH_TRANSITIONS = /** @type {Readonly<Record<FlagState, readonly FlagState[]>>} */ (Object.freeze({ off: ['off', 'on'], on: ['on'] }));

/**
 * @param {string} name
 * @param {boolean} [initial]
 */
export function createFlag(name, initial = false) {
  return booleanState(name, initial, FLAG_TRANSITIONS);
}

/**
 * A boolean that may be set but never cleared: clearing it once set throws.
 * @param {string} name
 * @param {boolean} [initial]
 */
export function createLatch(name, initial = false) {
  return booleanState(name, initial, LATCH_TRANSITIONS);
}

/**
 * The one-line conversion of boolean fields (refactor plan section 11, light weight): each named
 * field of `target` becomes an accessor over a flag (or a latch), so reads and writes stay as
 * they were and a write that is not a boolean (or that clears a latch) throws.
 * @param {object} target
 * @param {readonly string[]} names
 * @param {{ latch?: boolean, initial?: boolean }} [options]
 */
export function defineFlagFields(target, names, { latch = false, initial = false } = {}) {
  for (const name of names) {
    const flag = latch ? createLatch(name, initial) : createFlag(name, initial);
    Object.defineProperty(target, name, {
      get: () => flag.on,
      set: (/** @type {boolean} */ value) => { flag.set(value); },
      enumerable: true,
      configurable: true
    });
  }
}

/**
 * @param {string} name
 * @param {boolean} initial
 * @param {Readonly<Record<'off' | 'on', readonly ('off' | 'on')[]>>} transitions
 */
function booleanState(name, initial, transitions) {
  const machine = defineMachine({ name, initial: /** @type {'off' | 'on'} */ ('off'), transitions });
  const run = createState(machine, initial ? 'on' : 'off');
  const set = (/** @type {boolean} */ value) => {
    if (typeof value !== 'boolean') throw new TypeError(`${name}: expected a boolean, got ${typeof value}`);
    const previous = run.state() === 'on';
    run.to(value ? 'on' : 'off');
    return previous;
  };
  return {
    name,
    machine,
    get on() { return run.state() === 'on'; },
    /** Set the flag; returns the previous value. */
    set,
    /** Turn it on; returns the previous value, for `release`. */
    hold: () => set(true),
    /** Put back the value `hold` returned. */
    release(/** @type {boolean} */ previous) {
      if (typeof previous !== 'boolean') throw new TypeError(`${name}: release needs the value hold returned`);
      set(previous);
    }
  };
}

/** A re-entrancy count's two states: idle, or held by one or more callers. */
const HOLD_TRANSITIONS = /** @type {Readonly<Record<'idle' | 'held', readonly ('idle' | 'held')[]>>} */ (Object.freeze({ idle: ['held', 'idle'], held: ['held', 'idle'] }));

/**
 * A count of nested holds (a re-entrancy guard): `hold()` adds one, `release()` takes one off
 * (never below zero) and returns whether it is now idle. The state is `held` while any hold is out.
 * @param {string} name
 */
export function createHoldCount(name) {
  const machine = defineMachine({ name, initial: /** @type {'idle' | 'held'} */ ('idle'), transitions: HOLD_TRANSITIONS });
  const run = createState(machine);
  let depth = 0;
  return {
    name,
    machine,
    state: () => run.state(),
    get active() { return run.state() === 'held'; },
    get depth() { return depth; },
    hold() {
      depth += 1;
      run.to('held');
    },
    release() {
      depth = Math.max(0, depth - 1);
      run.to(depth ? 'held' : 'idle');
      return depth === 0;
    }
  };
}

/**
 * A value the caller is about to use as present: returned as it is, or a TypeError when it is
 * null or undefined (what reading a property of it at the same statement would have thrown).
 * @template T
 * @param {T} value
 * @param {string} what  named in the error
 * @returns {NonNullable<T>}
 */
export function present(value, what) {
  if (value === null || value === undefined) throw new TypeError(`${what} is ${value === null ? 'null' : 'undefined'}`);
  return /** @type {NonNullable<T>} */ (value);
}

/**
 * Show or hide an element through its `hidden` property (the platform's own boolean state,
 * MA-L): the value must be a boolean (true hides), the same assignment as before otherwise.
 * A missing element throws as the assignment did. Returns the value set.
 * @param {{ hidden: boolean | string }} node
 * @param {boolean} hidden
 */
export function setHidden(node, hidden) {
  if (typeof hidden !== 'boolean') throw new TypeError(`hidden: expected a boolean, got ${typeof hidden}`);
  node.hidden = hidden;
  return hidden;
}
