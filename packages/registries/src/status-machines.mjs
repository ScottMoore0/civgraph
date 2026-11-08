/**
 * Runnable status machines from the statuses registry, over the shared helper
 * (scripts/lib/state-machine.mjs: defineMachine for the full ones, defineToggle for the light
 * ones). Callers in other folders import these instead of keeping their own tables:
 *
 *   import { statusMachines } from '../../../../registries/status-machines.mjs';
 *   statusMachines(registry).contribution.assertTransition(current, 'applied');
 *
 * Pure apart from the helper (no I/O): pass the loaded registry, or the generated browser copy.
 */
import { defineMachine, defineToggle } from '../../core/src/state-machine.mjs';

/** @typedef {import('../../types/index.js').StatusesRegistry} StatusesRegistry */
/** @typedef {import('./statuses.mjs').StatusMachineEntry} StatusMachineEntry */
/** @typedef {import('../../core/src/state-machine.mjs').Machine<string>} Machine */

/**
 * name -> Machine, one per entry of `machines` in data/registries/statuses.json.
 * @param {StatusesRegistry} registry
 * @returns {{ [name: string]: Machine }}
 */
export function statusMachines(registry) {
  /** @type {{ [name: string]: Machine }} */
  const out = {};
  for (const [name, m] of Object.entries(/** @type {{ [name: string]: StatusMachineEntry }} */ (registry.machines))) {
    out[name] = m.weight === 'full'
      ? defineMachine({ name: `${name} status`, initial: m.initial, transitions: m.transitions })
      : defineToggle(`${name} status`, /** @type {[string, string]} */ ([m.values[0], m.values[1]]));
  }
  return out;
}

/**
 * Whether a contribution in `status` may be marked applied, with the reason when not: the rule
 * scripts/intake/contributions.mjs canMarkApplied states, read from the table.
 * @param {StatusesRegistry} registry
 * @param {string} status
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canMarkContributionApplied(registry, status) {
  const machine = statusMachines(registry).contribution;
  if (machine.can(status, 'applied')) return { ok: true };
  if (status === 'applied') return { ok: false, reason: 'already marked applied' };
  return { ok: false, reason: `status is "${status}"; only an approved submission can be marked applied` };
}
