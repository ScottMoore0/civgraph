// @ts-check
/**
 * The intake statuses as explicit machines (refactor plan section 11, full weight: both have
 * more than three states and more than one entry path).
 *
 * BATCH_STATUS: the `status` of a batch.json.
 *   entry: `intake init` and `intake run` write draft; a hand-written manifest may start anywhere
 *   the table reaches, and `intake mark` moves it on, one guarded step at a time.
 *
 *     draft ----> staged ----> committed ----> uploaded ----> published
 *       |   <----   |              |               |
 *       +-----------+--------------+---------------+--------> abandoned
 *
 *   staged -> draft is the rework path (the staged change was thrown away and the batch is being
 *   edited again). A committed batch can still be abandoned (its commit reverted); an uploaded
 *   one too (the R2 objects stay, unlinked, as after any abandoned upload). published and
 *   abandoned are final. Guards: uploaded needs the owner's upload approval recorded, published
 *   the publish approval (both written by the main session from the owner's words, never by an
 *   agent), committed the commit recorded in repo.commits.
 *
 * CONTRIBUTION_STATUS: a queued submission (KV CIVGRAPH_CONTRIBUTION_QUEUE).
 *   entry: functions/_api/contributions/submit.js writes pending-review; decide.js writes approved
 *   or rejected; scripts/intake/contributions.mjs --mark-applied writes applied.
 *
 *     pending-review --> approved --> applied
 *            |            ^   |
 *            +--> rejected <--+   (a decision can be reversed until the submission is applied)
 */
import { defineMachine } from './state-machine.mjs';

/** @typedef {'draft' | 'staged' | 'committed' | 'uploaded' | 'published' | 'abandoned'} BatchStatus */

/**
 * @typedef {object} BatchStatusContext
 * @property {{ step: string }[]} [approvals]
 * @property {{ commits?: string[] }} [repo]
 */

/** @param {BatchStatusContext} m @param {string} step */
const approved = (m, step) => (m.approvals || []).some((a) => a.step === step);

export const BATCH_STATUS = defineMachine(/** @type {import('./state-machine.mjs').MachineDefinition<BatchStatus>} */ ({
  name: 'batch status',
  states: ['draft', 'staged', 'committed', 'uploaded', 'published', 'abandoned'],
  initial: 'draft',
  transitions: {
    draft: ['staged', 'abandoned'],
    staged: ['committed', 'draft', 'abandoned'],
    committed: ['uploaded', 'abandoned'],
    uploaded: ['published', 'abandoned'],
    published: [],
    abandoned: [],
  },
  guards: {
    'staged->committed': (m) => ((m.repo?.commits || []).length ? null : 'record the commit in repo.commits first'),
    'committed->uploaded': (m) => (approved(m, 'upload') ? null : "no approvals entry for upload (the main session records the owner's approval from chat)"),
    'uploaded->published': (m) => (approved(m, 'publish') ? null : "no approvals entry for publish (the main session records the owner's approval from chat)"),
  },
}));

/**
 * The statuses in which each gated command may run. `upload --yes` keeps its rule from
 * before the machine existed: committed, or uploaded to re-run.
 * @type {Readonly<Record<string, readonly BatchStatus[]>>}
 */
export const COMMAND_GATES = Object.freeze({
  'upload --yes': Object.freeze(/** @type {BatchStatus[]} */ (['committed', 'uploaded'])),
});

/**
 * @param {string} command  a key of COMMAND_GATES
 * @param {string} status
 */
export function commandAllowed(command, status) {
  const allowed = COMMAND_GATES[command];
  if (!allowed) throw new Error(`no gate for ${command}`);
  return allowed.includes(/** @type {BatchStatus} */ (status));
}

/** @typedef {'pending-review' | 'approved' | 'rejected' | 'applied'} ContributionStatus */

export const CONTRIBUTION_STATUS = defineMachine(/** @type {import('./state-machine.mjs').MachineDefinition<ContributionStatus>} */ ({
  name: 'contribution status',
  states: ['pending-review', 'approved', 'rejected', 'applied'],
  initial: 'pending-review',
  transitions: {
    'pending-review': ['approved', 'rejected'],
    approved: ['applied', 'rejected'],
    rejected: ['approved'],
    applied: [],
  },
}));
