// @ts-check
/**
 * Explicit state machines for the map app (refactor plan section 11, 7 Nov 2026).
 *
 * Two weights, as the plan sets them:
 *
 * - Full (`defineMachine` + `createMachine`): a machine of three or more states, or one entered
 *   from several places, names its states and events and lists every allowed transition in one
 *   table. `send(event)` moves along the table and throws `InvalidTransitionError` for a move the
 *   table does not list, so a new code path cannot put the machine into a combination that the old
 *   loose flags allowed by accident. Each machine's table is pinned by tests under tests/unit/.
 *
 * - Light (`defineChoice`, `createFlag`): a two-state toggle keeps its plain value (a string the
 *   address and the panel read, or a boolean) and only gains a typed guard: `choice.check(value)`
 *   returns the value, or throws for one outside the choice; a flag is a named boolean with
 *   `set`, `hold` and `release`.
 *
 * Nothing here touches the DOM, so it runs under node --test as well as in the browser.
 */

/** A transition that the machine's table does not allow. */
export class InvalidTransitionError extends Error {
  /**
   * @param {string} machine
   * @param {string} state
   * @param {string} event
   */
  constructor(machine, state, event) {
    super(`${machine}: no transition for "${event}" from "${state}"`);
    this.name = 'InvalidTransitionError';
    this.machine = machine;
    this.state = state;
    this.event = event;
  }
}

/**
 * @template {string} S
 * @template {string} E
 * @typedef {object} MachineDefinition
 * @property {string} name
 * @property {S} initial
 * @property {readonly S[]} states
 * @property {readonly E[]} events
 * @property {Readonly<Record<S, Readonly<Partial<Record<E, S>>>>>} transitions
 * @property {(state: S, event: E) => S | undefined} next  The state `event` leads to from `state`, or undefined.
 */

/**
 * Freeze and validate a machine's table: every state named in it exists, every event is declared,
 * and every state is reachable from the initial one.
 *
 * @template {string} S
 * @template {string} E
 * @param {{ name: string, initial: S, states: readonly S[], events: readonly E[], transitions: Record<S, Partial<Record<E, S>>> }} spec
 * @returns {MachineDefinition<S, E>}
 */
export function defineMachine(spec) {
  const { name, initial, states, events, transitions } = spec;
  const stateSet = new Set(states);
  const eventSet = new Set(events);
  if (!stateSet.has(initial)) throw new Error(`${name}: initial state "${initial}" is not a state`);
  /** @type {Record<string, Readonly<Record<string, string>>>} */
  const table = {};
  for (const state of states) {
    const row = transitions[state] || {};
    for (const [event, target] of Object.entries(row)) {
      if (!eventSet.has(/** @type {E} */ (event))) throw new Error(`${name}: unknown event "${event}" in state "${state}"`);
      if (!stateSet.has(/** @type {S} */ (target))) throw new Error(`${name}: "${state}" --${event}--> unknown state "${target}"`);
    }
    table[state] = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({ ...row }));
  }
  for (const state of Object.keys(transitions)) {
    if (!stateSet.has(/** @type {S} */ (state))) throw new Error(`${name}: transitions for unknown state "${state}"`);
  }
  const reachable = new Set([initial]);
  for (let grew = true; grew;) {
    grew = false;
    for (const state of reachable) {
      for (const target of Object.values(table[state])) {
        if (!reachable.has(/** @type {S} */ (target))) { reachable.add(/** @type {S} */ (target)); grew = true; }
      }
    }
  }
  const unreachable = states.filter((state) => !reachable.has(state));
  if (unreachable.length) throw new Error(`${name}: unreachable state(s) ${unreachable.join(', ')}`);
  const frozen = /** @type {Readonly<Record<S, Readonly<Partial<Record<E, S>>>>>} */ (Object.freeze(table));
  return Object.freeze({
    name,
    initial,
    states: Object.freeze([...states]),
    events: Object.freeze([...events]),
    transitions: frozen,
    next: (/** @type {S} */ state, /** @type {E} */ event) => /** @type {S | undefined} */ (frozen[state]?.[event])
  });
}

/**
 * @template {string} S
 * @template {string} E
 * @typedef {object} Machine
 * @property {S} state  The current state.
 * @property {(event: E) => S} send  Take a transition; throws InvalidTransitionError if the table has none.
 * @property {(event: E) => boolean} can  Whether `event` has a transition from the current state.
 * @property {(...states: S[]) => boolean} is  Whether the current state is one of `states`.
 * @property {MachineDefinition<S, E>} definition
 */

/**
 * A running instance of a defined machine.
 *
 * @template {string} S
 * @template {string} E
 * @param {MachineDefinition<S, E>} definition
 * @param {{ initial?: S, onTransition?: (from: S, to: S, event: E) => void }} [options]
 * @returns {Machine<S, E>}
 */
export function createMachine(definition, options = {}) {
  let state = options.initial ?? definition.initial;
  if (!definition.states.includes(state)) throw new Error(`${definition.name}: initial state "${state}" is not a state`);
  const { onTransition } = options;
  return {
    get state() { return state; },
    send(event) {
      const target = definition.next(state, event);
      if (target === undefined) throw new InvalidTransitionError(definition.name, state, event);
      const from = state;
      state = target;
      if (onTransition) onTransition(from, target, event);
      return target;
    },
    can(event) { return definition.next(state, event) !== undefined; },
    is(...states) { return states.includes(state); },
    definition
  };
}

/**
 * @template {string} V
 * @typedef {object} Choice
 * @property {string} name
 * @property {readonly V[]} values
 * @property {V} initial
 * @property {(value: unknown) => value is V} has
 * @property {(value: unknown) => V} check  Returns `value` unchanged; throws a TypeError for one outside the choice.
 */

/**
 * Light weight, for a value that is one of a few fixed strings (a two-state toggle such as the
 * election overlay's circles or bars). The field keeps its plain string; assignments go through
 * `check`, which returns the value unchanged and throws for one outside the choice.
 *
 * @template {string} V
 * @param {string} name
 * @param {readonly V[]} values  The allowed values; the first is the initial one.
 * @returns {Choice<V>}
 */
export function defineChoice(name, values) {
  if (!values.length) throw new Error(`${name}: a choice needs at least one value`);
  const allowed = new Set(values);
  /** @type {(value: unknown) => value is V} */
  const has = (value) => allowed.has(/** @type {V} */ (value));
  return Object.freeze({
    name,
    values: Object.freeze([...values]),
    initial: values[0],
    has,
    check(value) {
      if (!has(value)) throw new TypeError(`${name}: "${String(value)}" is not one of ${values.join(', ')}`);
      return value;
    }
  });
}

/**
 * @typedef {object} Flag
 * @property {string} name
 * @property {boolean} on
 * @property {(value: boolean) => boolean} set  Set the flag; returns the previous value.
 * @property {() => boolean} hold  Turn it on; returns the previous value, for `release`.
 * @property {(previous: boolean) => void} release  Put back the value `hold` returned.
 */

/**
 * Light weight, for a boolean toggle that is held for the length of an operation and put back
 * after it (a hold may nest: each release restores what its own hold found).
 *
 * @param {string} name
 * @param {boolean} [initial]
 * @returns {Flag}
 */
export function createFlag(name, initial = false) {
  let on = Boolean(initial);
  return {
    name,
    get on() { return on; },
    set(value) {
      if (typeof value !== 'boolean') throw new TypeError(`${name}: expected a boolean, got ${typeof value}`);
      const previous = on;
      on = value;
      return previous;
    },
    hold() {
      const previous = on;
      on = true;
      return previous;
    },
    release(previous) {
      if (typeof previous !== 'boolean') throw new TypeError(`${name}: release needs the value hold returned`);
      on = previous;
    }
  };
}
