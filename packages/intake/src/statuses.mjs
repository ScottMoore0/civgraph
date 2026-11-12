// @ts-check
/**
 * The intake statuses as explicit machines (refactor plan section 11, full weight), on the shared
 * helper packages/core/src/state-machine.mjs; the guards live here, beside the tables.
 *
 * BATCH_STATUS (catalogue IN-01): the `status` of a batch.json.
 *   entry: `intake init` and `intake run` write draft; `intake mark` moves it on one guarded step.
 *
 *     draft ----> staged ----> committed ----> uploaded ----> published
 *       |   <----   |              |               |
 *       +-----------+--------------+---------------+--------> abandoned
 *
 *   staged -> draft is the rework path. A committed batch can still be abandoned (its commit
 *   reverted), and an uploaded one (the R2 objects stay, unlinked). published and abandoned are
 *   final. Guards: committed needs the commit in repo.commits, uploaded the owner's upload
 *   approval, published the publish approval (approvals are written by the main session from the
 *   owner's words, never by an agent).
 *   Command gates: stage --write never runs on a published or abandoned batch; upload --yes needs
 *   committed (or uploaded, to re-run); post-upload --write needs uploaded or committed AND a
 *   recorded real upload (state/upload.json), so layers are never switched to CDN URLs this
 *   batch did not upload.
 *
 * CONTRIBUTION_STATUS (IN-02): a queued submission (KV CIVGRAPH_CONTRIBUTION_QUEUE).
 *   entry: functions/_api/contributions/submit.js writes pending-review; decide.js approved or
 *   rejected; scripts/intake/contributions.mjs --mark-applied applied.
 *
 *     pending-review --> approved --> applied
 *            |
 *            +--> rejected
 *   The table is the one in data/registries/statuses.json (rf-registries, RG-04); once that lands,
 *   this machine is read from packages/registries/src/statuses.mjs instead of being written out here.
 *
 * ROUND_STATUS (IN-03): a council election round in an NI councils staging folder
 *   (work/<slug>/<round>.json `status`; absent means done, as tools/build.py reads it).
 *
 *     queued --> held --> done | partial | no-election
 *       +-------------->  done | partial | no-election
 *     partial --> done;  done | partial --> applied
 *
 *   The apply gate (apply-exclude.json rule of 7 Nov 2026): done and partial rounds apply (a
 *   partial round publishes with a completeness line); held and no-election rounds must be
 *   excluded; any round may also be excluded for a citation still to confirm or an unknown poll
 *   day. checks/ni-council-rounds.mjs reports a staging folder against this gate.
 */
import { defineMachine } from '../../core/src/state-machine.mjs';
import { loadRegistry } from '../../registries/src/index.mjs';

/** @typedef {'draft' | 'staged' | 'committed' | 'uploaded' | 'published' | 'abandoned'} BatchStatus */

export const BATCH_STATUS = defineMachine(/** @type {import('../../core/src/state-machine.mjs').MachineSpec<BatchStatus>} */ ({
  name: 'batch status',
  initial: 'draft',
  transitions: {
    draft: ['staged', 'abandoned'],
    staged: ['committed', 'draft', 'abandoned'],
    committed: ['uploaded', 'abandoned'],
    uploaded: ['published', 'abandoned'],
    published: [],
    abandoned: [],
  },
}));

/**
 * @typedef {object} BatchContext
 * @property {{ step: string }[]} [approvals]
 * @property {{ commits?: string[] }} [repo]
 */

/** @param {BatchContext} m @param {string} step */
const approved = (m, step) => (m.approvals || []).some((a) => a.step === step);

/** @type {Readonly<Record<string, (m: BatchContext) => string | null>>} */
export const BATCH_GUARDS = Object.freeze({
  'staged->committed': (m) => ((m.repo?.commits || []).length ? null : 'record the commit in repo.commits first'),
  'committed->uploaded': (m) => (approved(m, 'upload') ? null : "no approvals entry for upload (the main session records the owner's approval from chat)"),
  'uploaded->published': (m) => (approved(m, 'publish') ? null : "no approvals entry for publish (the main session records the owner's approval from chat)"),
});

/**
 * Whether a batch may move from one status to another: the table, then the guard.
 * @param {string} from
 * @param {string} to
 * @param {BatchContext} [manifest]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBatchTransition(from, to, manifest = {}) {
  const states = BATCH_STATUS.states.join(', ');
  if (!BATCH_STATUS.states.includes(/** @type {BatchStatus} */ (from))) return { ok: false, reason: `"${from}" is not a batch status (${states})` };
  if (!BATCH_STATUS.states.includes(/** @type {BatchStatus} */ (to))) return { ok: false, reason: `"${to}" is not a batch status (${states})` };
  if (!BATCH_STATUS.can(/** @type {BatchStatus} */ (from), /** @type {BatchStatus} */ (to))) {
    const next = BATCH_STATUS.transitions[/** @type {BatchStatus} */ (from)];
    return { ok: false, reason: `${from} -> ${to} is not allowed (from ${from}: ${next.length ? next.join(', ') : 'none, it is final'})` };
  }
  const refused = BATCH_GUARDS[`${from}->${to}`]?.(manifest);
  return refused ? { ok: false, reason: `${from} -> ${to}: ${refused}` } : { ok: true };
}

/**
 * The statuses in which each gated command may run.
 * @type {Readonly<Record<string, readonly BatchStatus[]>>}
 */
export const COMMAND_GATES = Object.freeze({
  'stage --write': Object.freeze(/** @type {BatchStatus[]} */ (['draft', 'staged', 'committed', 'uploaded'])),
  'upload --yes': Object.freeze(/** @type {BatchStatus[]} */ (['committed', 'uploaded'])),
  'post-upload --write': Object.freeze(/** @type {BatchStatus[]} */ (['committed', 'uploaded'])),
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

// The table is the statuses registry's machine `contribution` (RG-04), not a copy kept here.
const CONTRIBUTION_MACHINE = loadRegistry('statuses').machines.contribution;
export const CONTRIBUTION_STATUS = defineMachine(/** @type {import('../../core/src/state-machine.mjs').MachineSpec<ContributionStatus>} */ (/** @type {unknown} */ ({
  name: 'contribution status',
  initial: CONTRIBUTION_MACHINE.initial,
  transitions: structuredClone(CONTRIBUTION_MACHINE.transitions),
})));

/** @typedef {'queued' | 'held' | 'done' | 'partial' | 'no-election' | 'applied'} RoundStatus */

export const ROUND_STATUS = defineMachine(/** @type {import('../../core/src/state-machine.mjs').MachineSpec<RoundStatus>} */ ({
  name: 'council round status',
  initial: 'queued',
  transitions: {
    queued: ['held', 'done', 'partial', 'no-election'],
    held: ['done', 'partial', 'no-election'],
    partial: ['done', 'applied'],
    done: ['applied'],
    'no-election': [],
    applied: [],
  },
}));

/** Work-record statuses that may be copied into the repository. */
export const ROUND_APPLIES = Object.freeze(/** @type {RoundStatus[]} */ (['done', 'partial']));

/**
 * A work record's status, as tools/build.py reads it: absent means done.
 * @param {{ status?: string }} record
 * @returns {{ status: string, implied: boolean, known: boolean }}
 */
export function roundStatusOf(record) {
  const raw = record?.status;
  const status = raw === undefined || raw === null || raw === '' ? 'done' : String(raw);
  return { status, implied: raw === undefined || raw === null || raw === '', known: ROUND_STATUS.states.includes(/** @type {RoundStatus} */ (status)) };
}

/**
 * The gate verdict for one round: apply, held back (excluded as it must be), or a problem.
 * @param {string} status
 * @param {boolean} excluded  listed in apply-exclude.json
 * @returns {{ verdict: 'apply' | 'held-back' | 'excluded-by-choice' | 'would-apply-wrongly' | 'unknown-status' }}
 */
export function roundGate(status, excluded) {
  if (!ROUND_STATUS.states.includes(/** @type {RoundStatus} */ (status))) return { verdict: 'unknown-status' };
  const applies = ROUND_APPLIES.includes(/** @type {RoundStatus} */ (status));
  if (applies) return { verdict: excluded ? 'excluded-by-choice' : 'apply' };
  return { verdict: excluded ? 'held-back' : 'would-apply-wrongly' };
}
