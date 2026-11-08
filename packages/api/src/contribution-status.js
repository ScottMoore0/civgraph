/**
 * The contribution queue's statuses and the moves between them (refactor state machine FN-04).
 * The table is the registry's (data/registries/statuses.json, machine `contribution`, RG-04),
 * mirrored here rather than imported. Importing the registry's slice (packages/registries/src/
 * browser/statuses.mjs) was tried on 8 Nov 2026 and broke the Pages build: Cloudflare's build
 * image bundles Functions with wrangler 3.114.17, whose esbuild rejects the slice's
 * `import ... with { type: 'json' }` (local wrangler 4.x accepts it). Until the build image's
 * wrangler is newer, or the slice is also emitted as a plain .mjs data module, the table stays
 * here; tests/functions/state-machines.test.mjs holds it equal to the registry's table and to
 * its runnable machine. Check any Functions change with `npx wrangler@3.114.17 pages functions build`.
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
 * helper (scripts/lib/state-machine.mjs) and walks every forbidden move.
 */

/** @typedef {'pending-review' | 'approved' | 'rejected' | 'applied'} ContributionStatus */
/** @typedef {'approved' | 'rejected'} ContributionDecision */

/** @type {ContributionStatus} */
export const INITIAL_STATUS = 'pending-review';

/** @type {Readonly<Record<ContributionStatus, readonly ContributionStatus[]>>} */
export const CONTRIBUTION_TRANSITIONS = Object.freeze({
  'pending-review': Object.freeze(/** @type {ContributionStatus[]} */ (['approved', 'rejected'])),
  approved: Object.freeze(/** @type {ContributionStatus[]} */ (['applied'])),
  rejected: Object.freeze(/** @type {ContributionStatus[]} */ ([])),
  applied: Object.freeze(/** @type {ContributionStatus[]} */ ([])),
});

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
