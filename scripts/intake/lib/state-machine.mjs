// @ts-check
/**
 * Explicit state machines for the intake layer (refactor plan section 11).
 *
 * A machine is a closed set of states, an initial state, a transition table and optional
 * guards. `assert(from, to, context)` throws on a state outside the set, on a transition the
 * table does not list, and on a guard that refuses; `check` returns the same verdict without
 * throwing. Two-state toggles use `defineToggle`, the light form.
 *
 * Pure: no file system, no network, so every rule can be tested on its own.
 */

/**
 * @template {string} S
 * @typedef {object} MachineDefinition
 * @property {string} name
 * @property {readonly S[]} states
 * @property {S} initial
 * @property {Readonly<Record<S, readonly S[]>>} transitions  every state must appear; [] = terminal
 * @property {Partial<Record<`${S}->${S}`, (context: any) => string | null>>} [guards]
 *           a guard returns null to allow the transition, or the reason it is refused
 */

/**
 * @template {string} S
 * @typedef {object} Machine
 * @property {string} name
 * @property {readonly S[]} states
 * @property {S} initial
 * @property {(value: unknown) => value is S} is
 * @property {(state: S) => readonly S[]} next
 * @property {(state: S) => boolean} isTerminal
 * @property {(from: string, to: string, context?: any) => { ok: boolean, reason?: string }} check
 * @property {(from: string, to: string, context?: any) => S} assert
 */

/**
 * @template {string} S
 * @param {MachineDefinition<S>} def
 * @returns {Machine<S>}
 */
export function defineMachine(def) {
  const states = Object.freeze([...def.states]);
  const set = new Set(states);
  if (set.size !== states.length) throw new Error(`${def.name}: a state is listed twice`);
  if (!set.has(def.initial)) throw new Error(`${def.name}: initial state ${def.initial} is not a state`);
  for (const s of states) {
    if (!Object.hasOwn(def.transitions, s)) throw new Error(`${def.name}: no transitions given for ${s}`);
    for (const t of def.transitions[s]) if (!set.has(t)) throw new Error(`${def.name}: ${s} -> ${t} names an unknown state`);
  }
  for (const k of Object.keys(def.transitions)) if (!set.has(/** @type {S} */ (k))) throw new Error(`${def.name}: transitions for unknown state ${k}`);
  /** @type {Record<string, (context: any) => string | null>} */
  const guards = def.guards || {};
  for (const k of Object.keys(guards)) {
    const [from, to] = k.split('->');
    if (!set.has(/** @type {S} */ (from)) || !def.transitions[/** @type {S} */ (from)].includes(/** @type {S} */ (to))) {
      throw new Error(`${def.name}: guard ${k} is on a transition the table does not list`);
    }
  }
  /** @type {(value: unknown) => value is S} */
  const is = (value) => typeof value === 'string' && set.has(/** @type {S} */ (value));
  /** @param {string} from @param {string} to @param {any} [context] */
  const check = (from, to, context) => {
    if (!is(from)) return { ok: /** @type {false} */ (false), reason: `${def.name}: "${from}" is not a state (${states.join(', ')})` };
    if (!is(to)) return { ok: /** @type {false} */ (false), reason: `${def.name}: "${to}" is not a state (${states.join(', ')})` };
    if (!def.transitions[from].includes(to)) {
      const allowed = def.transitions[from];
      return { ok: /** @type {false} */ (false), reason: `${def.name}: ${from} -> ${to} is not allowed (from ${from}: ${allowed.length ? allowed.join(', ') : 'none, it is final'})` };
    }
    const guard = guards[`${from}->${to}`];
    const refused = guard ? guard(context ?? {}) : null;
    return refused ? { ok: /** @type {false} */ (false), reason: `${def.name}: ${from} -> ${to}: ${refused}` } : { ok: /** @type {true} */ (true) };
  };
  return Object.freeze({
    name: def.name,
    states,
    initial: def.initial,
    is,
    next: (/** @type {S} */ s) => def.transitions[s],
    isTerminal: (/** @type {S} */ s) => def.transitions[s].length === 0,
    check,
    assert(from, to, context) {
      const verdict = check(from, to, context);
      if (!verdict.ok) throw new Error(verdict.reason);
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
