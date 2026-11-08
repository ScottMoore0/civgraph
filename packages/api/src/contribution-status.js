/**
 * The contribution queue's statuses and the moves between them (refactor state machine FN-04).
 * The table is the registry's (data/registries/statuses.json, machine `contribution`, RG-04),
 * read from its generated browser slice (pure data; the registry files stay out of dist/). The slice
 * module re-exports a plain .data.mjs, not a JSON import: Cloudflare's build image bundles Functions
 * with wrangler 3.114.17, which rejects `with { type: 'json' }` (it broke the build of 4da15fa5c2).
 * Check Functions changes with `npx wrangler@3.114.17 pages functions build`.
 * tests/functions/state-machines.test.mjs holds it equal to the registry's runnable machine.
 *
 *   pending-review  set by POST /_api/contributions/submit, never by anything else
 *   approved        POST /_api/contributions/decide (admin), from pending-review only
 *   rejected        the same; terminal
 *   applied         scripts/intake/contributions.mjs --mark-applied, from approved only
 *                   (its canMarkApplied); terminal
 *
 * One decision per submission. Before this table, decide.js set any decision on any status: an
 * applied submission could be re-approved (and applied twice) or rejected (recording as refused
 * something already enacted), and a rejected one approved. Those now answer 409; a submission
 * decided wrongly is resubmitted. Every decision is still appended to the `decisions` log.
 *
 * tests/functions/state-machines.test.mjs builds the machine from this table with the shared
 * helper (packages/core/src/state-machine.mjs) and walks every forbidden move.
 */

import statuses from '../../registries/src/browser/statuses.mjs';

/** @typedef {'pending-review' | 'approved' | 'rejected' | 'applied'} ContributionStatus */
/** @typedef {'approved' | 'rejected'} ContributionDecision */

// The table comes from the registry's browser slice (packages/registries/src/browser/statuses.json,
// generated from data/registries/statuses.json machine `contribution`), not a copy kept here. The
// slice is pure data; the statuses and decisions this module types are checked against it on load,
// so a registry edit that renames a status fails loudly instead of silently changing decide.js.
const { initial, transitions } = statuses.contribution;
const KNOWN = ['pending-review', 'approved', 'rejected', 'applied'];
if (initial !== 'pending-review' || Object.keys(transitions).sort().join() !== [...KNOWN].sort().join()) {
  throw new Error('contribution-status: the registry slice no longer has the statuses this module types');
}

/** @type {ContributionStatus} */
export const INITIAL_STATUS = /** @type {ContributionStatus} */ (initial);

/** @type {Readonly<Record<ContributionStatus, readonly ContributionStatus[]>>} */
export const CONTRIBUTION_TRANSITIONS = Object.freeze(/** @type {Record<ContributionStatus, readonly ContributionStatus[]>} */ (
  Object.fromEntries(Object.entries(transitions).map(([from, to]) => [from, Object.freeze([...to])]))));

/** What an administrator may decide (POST /_api/contributions/decide). */
export const DECISIONS = Object.freeze(/** @type {ContributionDecision[]} */ (['approved', 'rejected']));

/** @type {(value: unknown) => value is ContributionStatus} */
export const isContributionStatus = (value) => typeof value === 'string' && Object.hasOwn(CONTRIBUTION_TRANSITIONS, value);

/** @type {(value: unknown) => value is ContributionDecision} */
export const isDecision = (value) => DECISIONS.includes(/** @type {ContributionDecision} */ (value));

/**
 * Whether a decision may be recorded on a submission now in `status` (a submission stored
 * without a status counts as pending-review).
 * @param {unknown} status
 * @param {ContributionDecision} decision
 * @returns {{ ok: true, from: ContributionStatus } | { ok: false, from: string, reason: string }}
 */
export function canDecide(status, decision) {
  const from = status === undefined || status === null || status === '' ? INITIAL_STATUS : String(status);
  if (!isContributionStatus(from)) return { ok: false, from, reason: `status "${from}" is not a contribution status` };
  if (CONTRIBUTION_TRANSITIONS[from].includes(decision)) return { ok: true, from };
  return { ok: false, from, reason: `this submission is already ${from}; no decision can change it` };
}
