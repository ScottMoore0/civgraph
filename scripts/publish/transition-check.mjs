// @ts-check
/**
 * A transition with guards, on the shared machines of scripts/lib/state-machine.mjs: the table
 * says whether a move exists; a guard (a pure function of the evidence) says whether it may be
 * taken now. The verdict names the reason, so a refusing pipeline step can print it.
 *
 * Guards are keyed `from->to` and must sit on a transition the table lists (checked when the
 * guards are declared). Candidate for scripts/lib/state-machine.mjs when the streams land.
 */

/** @typedef {{ ok: true } | { ok: false, reason: string }} Verdict */

/**
 * @template {string} S
 * @param {import('../lib/state-machine.mjs').Machine<S>} machine
 * @param {Partial<Record<`${S}->${S}`, (context: any) => string | null>>} guards
 */
export function defineGuards(machine, guards) {
  for (const key of Object.keys(guards)) {
    const [from, to] = key.split('->');
    if (!machine.can(/** @type {S} */ (from), /** @type {S} */ (to))) {
      throw new Error(`${machine.name}: guard ${key} is on a transition the table does not list`);
    }
  }
  return Object.freeze({ ...guards });
}

/**
 * @template {string} S
 * @param {import('../lib/state-machine.mjs').Machine<S>} machine
 * @param {Partial<Record<string, (context: any) => string | null>>} guards
 * @param {string} from
 * @param {string} to
 * @param {any} [context]
 * @returns {Verdict}
 */
export function checkTransition(machine, guards, from, to, context = {}) {
  const states = /** @type {readonly string[]} */ (machine.states);
  for (const state of [from, to]) {
    if (!states.includes(state)) return { ok: false, reason: `${machine.name}: "${state}" is not a state (${states.join(', ')})` };
  }
  if (!machine.can(/** @type {S} */ (from), /** @type {S} */ (to))) {
    const allowed = machine.transitions[/** @type {S} */ (from)];
    return { ok: false, reason: `${machine.name}: ${from} -> ${to} is not allowed (from ${from}: ${allowed.length ? allowed.join(', ') : 'none, it is final'})` };
  }
  const guard = guards[`${from}->${to}`];
  const refused = guard ? guard(context) : null;
  return refused ? { ok: false, reason: `${machine.name}: ${from} -> ${to}: ${refused}` } : { ok: true };
}

/**
 * `checkTransition`, throwing the reason.
 * @template {string} S
 * @param {import('../lib/state-machine.mjs').Machine<S>} machine
 * @param {Partial<Record<string, (context: any) => string | null>>} guards
 * @param {string} from
 * @param {S} to
 * @param {any} [context]
 * @returns {S}
 */
export function assertTransition(machine, guards, from, to, context = {}) {
  const verdict = checkTransition(machine, guards, from, to, context);
  if (!verdict.ok) throw new Error(verdict.reason);
  return to;
}
