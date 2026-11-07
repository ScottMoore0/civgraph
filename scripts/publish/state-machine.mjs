// @ts-check
/**
 * Explicit state machines for the pipeline scripts (refactor plan section 11).
 *
 * A machine is a closed set of states, an initial state, a transition table and optional guards.
 * `check(from, to, context)` returns a verdict; `assert` throws it. A state outside the set, a
 * transition the table does not list and a guard that refuses are all refusals, with the reason.
 * Two-state toggles use `defineToggle`, the light form.
 *
 * Same shape as the intake layer's helper (scripts/intake/lib/state-machine.mjs on rf-ingest), so
 * the two can become one module in scripts/lib/ when the streams land. Pure: no I/O.
 */

/**
 * @template {string} S
 * @typedef {object} MachineDefinition
 * @property {string} name
 * @property {readonly S[]} states
 * @property {S} initial
 * @property {Readonly<Record<S, readonly S[]>>} transitions  every state appears; [] = final
 * @property {Partial<Record<`${S}->${S}`, (context: any) => string | null>>} [guards]
 *           null allows the transition; a string is the reason it is refused
 */

/** @typedef {{ ok: true } | { ok: false, reason: string }} Verdict */

/**
 * @template {string} S
 * @typedef {object} Machine
 * @property {string} name
 * @property {readonly S[]} states
 * @property {S} initial
 * @property {(value: unknown) => value is S} is
 * @property {(state: S) => readonly S[]} next
 * @property {(state: S) => boolean} isFinal
 * @property {(from: string, to: string, context?: any) => Verdict} check
 * @property {(from: string, to: string, context?: any) => S} assert
 */

export class InvalidTransitionError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * @template {string} S
 * @param {MachineDefinition<S>} def
 * @returns {Machine<S>}
 */
export function defineMachine(def) {
  const states = Object.freeze([...def.states]);
  const known = new Set(states);
  /** @type {(value: unknown) => value is S} */
  const is = (value) => typeof value === 'string' && known.has(/** @type {S} */ (value));
  if (known.size !== states.length) throw new Error(`${def.name}: a state is listed twice`);
  if (!is(def.initial)) throw new Error(`${def.name}: the initial state ${def.initial} is not a state`);
  for (const from of Object.keys(def.transitions)) {
    if (!is(from)) throw new Error(`${def.name}: transitions given for unknown state ${from}`);
  }
  for (const from of states) {
    if (!Object.hasOwn(def.transitions, from)) throw new Error(`${def.name}: no transitions given for ${from}`);
    for (const to of def.transitions[from]) if (!is(to)) throw new Error(`${def.name}: ${from} -> ${to} names an unknown state`);
  }
  /** @type {Record<string, (context: any) => string | null>} */
  const guards = { ...(def.guards || {}) };
  for (const key of Object.keys(guards)) {
    const [from, to] = key.split('->');
    if (!is(from) || !is(to) || !def.transitions[from].includes(to)) {
      throw new Error(`${def.name}: guard ${key} is on a transition the table does not list`);
    }
  }
  /** @type {(from: string, to: string, context?: any) => Verdict} */
  const check = (from, to, context) => {
    if (!is(from)) return { ok: false, reason: `${def.name}: "${from}" is not a state (${states.join(', ')})` };
    if (!is(to)) return { ok: false, reason: `${def.name}: "${to}" is not a state (${states.join(', ')})` };
    const allowed = def.transitions[from];
    if (!allowed.includes(to)) {
      return { ok: false, reason: `${def.name}: ${from} -> ${to} is not allowed (from ${from}: ${allowed.length ? allowed.join(', ') : 'none, it is final'})` };
    }
    const guard = guards[`${from}->${to}`];
    const refused = guard ? guard(context ?? {}) : null;
    return refused ? { ok: false, reason: `${def.name}: ${from} -> ${to}: ${refused}` } : { ok: true };
  };
  return Object.freeze({
    name: def.name,
    states,
    initial: def.initial,
    is,
    next: (/** @type {S} */ state) => def.transitions[state],
    isFinal: (/** @type {S} */ state) => def.transitions[state].length === 0,
    check,
    assert(from, to, context) {
      const verdict = check(from, to, context);
      if (!verdict.ok) throw new InvalidTransitionError(verdict.reason);
      return /** @type {S} */ (to);
    },
  });
}

/**
 * The light form for a two-state toggle: either state may go to the other.
 * @template {string} S
 * @param {string} name
 * @param {[S, S]} pair  [initial, other]
 * @returns {Machine<S>}
 */
export function defineToggle(name, [a, b]) {
  return defineMachine({ name, states: [a, b], initial: a, transitions: /** @type {Record<S, S[]>} */ ({ [a]: [b], [b]: [a] }) });
}
