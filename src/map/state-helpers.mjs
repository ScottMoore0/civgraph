// @ts-check
/**
 * The map app's light-weight state helpers (refactor plan section 11), built on the shared
 * machine helper (src/map/state-machine.mjs, a copy of scripts/lib/state-machine.mjs until that
 * lands; see LANDING.md of rf-mapapp).
 *
 * - `defineChoice(name, values)`: a field that holds one of a few fixed strings (the election
 *   overlay, the local level) keeps its plain string, and every assignment goes through
 *   `check(value)`, which returns the value unchanged and throws for one outside the choice.
 * - `createFlag(name)`: a boolean that is set, or held for the length of an operation and put
 *   back after it (holds nest: each release restores what its own hold found). Setting it to the
 *   value it already has is allowed, as assigning the old boolean was.
 */

import { defineMachine } from './state-machine.mjs';

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

/** The flag's two states, either reachable from either (itself included). */
const FLAG_TRANSITIONS = Object.freeze({ off: ['off', 'on'], on: ['off', 'on'] });

/**
 * @param {string} name
 * @param {boolean} [initial]
 */
export function createFlag(name, initial = false) {
  const machine = defineMachine({ name, initial: 'off', transitions: FLAG_TRANSITIONS });
  const run = machine.start(initial ? 'on' : 'off');
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
