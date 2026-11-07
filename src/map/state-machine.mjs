/**
 * Explicit state machines (REFACTOR-PLAN.md section 11): a named set of states, a transition
 * table, and a run that refuses any move the table does not list.
 *
 *   const LOAD = defineMachine({
 *     name: 'records deploy',
 *     initial: 'start',
 *     transitions: { start: ['migrated'], migrated: ['verified', 'failed'], verified: [], failed: [] },
 *   });
 *   const run = LOAD.start();
 *   run.to('migrated');          // ok
 *   run.to('start');             // throws: records deploy: migrated -> start is not a transition
 *
 * Full weight (3 or more states, or several entry paths): defineMachine with its table, guards at
 * the call sites, and tests that walk the forbidden moves. Light weight (a two-state toggle):
 * defineToggle(name, [off, on]), which is the same machine with both moves allowed.
 *
 * Pure: no I/O, no Node or DOM APIs, so it can move to the shared core package unchanged.
 */

/**
 * @template {string} S
 * @typedef {object} MachineSpec
 * @property {string} name
 * @property {S} initial
 * @property {Readonly<Record<S, readonly S[]>>} transitions   every state, with where it may go
 */

/**
 * @template {string} S
 * @typedef {object} Run
 * @property {() => S} state           the current state
 * @property {() => S[]} history       every state entered, in order, the initial one first
 * @property {(next: S) => S} to       move, or throw if the table has no such move
 * @property {() => boolean} done      the current state has no way out
 */

/**
 * @template {string} S
 * @typedef {object} Machine
 * @property {string} name
 * @property {readonly S[]} states
 * @property {S} initial
 * @property {Readonly<Record<S, readonly S[]>>} transitions
 * @property {(from: S, to: S) => boolean} can
 * @property {(from: S, to: S) => void} assertTransition
 * @property {(path: readonly S[]) => void} assertPath   a whole walk from the initial state
 * @property {(from?: S) => Run<S>} start
 */

/**
 * @template {string} S
 * @param {MachineSpec<S>} spec
 * @returns {Machine<S>}
 */
export function defineMachine({ name, initial, transitions }) {
  const states = /** @type {S[]} */ (Object.keys(transitions));
  if (!states.includes(initial)) throw new Error(`${name}: initial state ${initial} is not in the table`);
  for (const from of states) {
    for (const to of transitions[from]) {
      if (!states.includes(to)) throw new Error(`${name}: ${from} -> ${to} names a state that is not in the table`);
    }
  }
  const table = Object.freeze(Object.fromEntries(states.map((s) => [s, Object.freeze([...transitions[s]])])));
  const can = (/** @type {S} */ from, /** @type {S} */ to) => Boolean(table[from]?.includes(to));
  const assertTransition = (/** @type {S} */ from, /** @type {S} */ to) => {
    if (!can(from, to)) throw new Error(`${name}: ${from} -> ${to} is not a transition`);
  };
  /** @type {Machine<S>} */
  const machine = {
    name,
    states: Object.freeze(states),
    initial,
    transitions: /** @type {Readonly<Record<S, readonly S[]>>} */ (table),
    can,
    assertTransition,
    assertPath(path) {
      let at = initial;
      for (const next of path) {
        assertTransition(at, next);
        at = next;
      }
    },
    start(from = initial) {
      if (!states.includes(from)) throw new Error(`${name}: ${from} is not a state`);
      let current = from;
      const seen = [from];
      return {
        state: () => current,
        history: () => [...seen],
        to(next) {
          assertTransition(current, next);
          current = next;
          seen.push(next);
          return current;
        },
        done: () => table[current].length === 0,
      };
    },
  };
  return Object.freeze(machine);
}

/**
 * A two-state toggle (the light weight): either state may move to the other.
 * @template {string} S
 * @param {string} name
 * @param {[S, S]} states   [initial, other]
 * @returns {Machine<S>}
 */
export function defineToggle(name, [a, b]) {
  return defineMachine({ name, initial: a, transitions: /** @type {Record<S, S[]>} */ ({ [a]: [b], [b]: [a] }) });
}
