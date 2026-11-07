/**
 * The records deploy (deploy-records.mjs) as an explicit state machine: its options, the checks
 * on them, the steps each kind of run takes, and the order no run may break.
 *
 *   start ─┬─ dry run ──> migrations-listed ──> delta-previewed ──> dry-run-reported
 *          └─ real ─────> migrated ─┬─ (remote) ──> bookmarked ─┐
 *                                   └───────────────────────────┴─┬─> delta-written ──> applied ─┐
 *                                                                 └─ (--resync) ─────────────────┴─> verified ──> snapshotted
 *   any step ──> failed
 *
 * The rules the table and the per-mode paths keep:
 *   - the last-loaded snapshot is replaced only after a PASS (snapshotted only from verified);
 *   - a dry run applies nothing, records no bookmark and never verifies or snapshots: its states
 *     (migrations-listed, delta-previewed) lead nowhere else, whatever the options;
 *   - only a real remote run records a Time Travel bookmark, and before any statement is applied;
 *   - --resync applies no delta: it goes from the migrations straight to the verify.
 *
 * Pure (no I/O), so the tests can walk every mode and every forbidden move.
 */
import { defineMachine } from '../lib/state-machine.mjs';

/** @typedef {'start'|'migrations-listed'|'delta-previewed'|'dry-run-reported'|'migrated'|'bookmarked'|'delta-written'|'applied'|'verified'|'snapshotted'|'failed'} DeployState */

export const DEPLOY = defineMachine(/** @type {import('../lib/state-machine.mjs').MachineSpec<DeployState>} */ ({
  name: 'records deploy',
  initial: 'start',
  transitions: {
    start: ['migrations-listed', 'migrated', 'failed'],
    'migrations-listed': ['delta-previewed', 'failed'],
    'delta-previewed': ['dry-run-reported', 'failed'],
    'dry-run-reported': [],
    migrated: ['bookmarked', 'delta-written', 'verified', 'failed'],
    bookmarked: ['delta-written', 'verified', 'failed'],
    'delta-written': ['applied', 'failed'],
    applied: ['verified', 'failed'],
    verified: ['snapshotted', 'failed'],
    snapshotted: [],
    failed: [],
  },
}));

/**
 * @typedef {object} DeployMode
 * @property {boolean} remote
 * @property {boolean} local
 * @property {boolean} dryRun
 * @property {boolean} full        diff against nothing (a full load)
 * @property {boolean} resync      verify and reset the snapshot; no delta
 * @property {boolean} direct      local only: apply the statements to the local D1 file itself
 * @property {boolean} fullVerify
 * @property {'full'|'bounded'} verify
 * @property {number} startPart    resume at this part (0: from the first)
 */

/**
 * The verify mode a run uses: --full-verify scans; the remote database (and --bounded) is
 * checked bounded; the local D1 file is scanned.
 * @param {{ remote?: boolean, fullVerify?: boolean, bounded?: boolean }} flags
 * @returns {'full'|'bounded'}
 */
export function verifyModeFor({ remote = false, fullVerify = false, bounded = false }) {
  return fullVerify ? 'full' : remote || bounded ? 'bounded' : 'full';
}

/**
 * The options of deploy-records.mjs, read from its arguments without judging them.
 * @param {string[]} args
 * @returns {DeployMode}
 */
export function parseDeployArgs(args) {
  const remote = args.includes('--remote');
  const fullVerify = args.includes('--full-verify');
  return {
    remote,
    local: args.includes('--local'),
    dryRun: args.includes('--dry-run'),
    full: args.includes('--full'),
    resync: args.includes('--resync'),
    direct: args.includes('--direct'),
    fullVerify,
    verify: verifyModeFor({ remote, fullVerify, bounded: args.includes('--bounded') }),
    startPart: args.includes('--start-part') ? Number(args[args.indexOf('--start-part') + 1]) : 0,
  };
}

/**
 * Why a mode may not run, in the order the checks are made (empty: it may).
 * @param {DeployMode} mode
 * @returns {string[]}
 */
export function deployModeErrors(mode) {
  const errors = [];
  if (mode.remote === mode.local) errors.push('say --local or --remote');
  if (mode.remote && mode.direct) errors.push('--direct is local only');
  if (mode.remote && mode.resync && !mode.fullVerify) {
    errors.push('--remote --resync needs --full-verify: it scans every table of the live database, so run it at a quiet time, never from the publish');
  }
  // A dry run changes nothing; --resync's only steps are a verify and a snapshot reset, so with
  // --dry-run it used to fall through to both (and, remote, to a full scan of the live database).
  if (mode.dryRun && mode.resync) errors.push('--dry-run --resync has nothing to list: --resync applies no delta, it verifies and resets the snapshot; run it without --dry-run');
  return errors;
}

/**
 * The states a successful run of this mode passes through, after `start`.
 * @param {DeployMode} mode
 * @returns {DeployState[]}
 */
export function deployPath(mode) {
  if (mode.dryRun) return ['migrations-listed', 'delta-previewed', 'dry-run-reported'];
  /** @type {DeployState[]} */
  const path = ['migrated'];
  if (mode.remote) path.push('bookmarked');
  if (!mode.resync) path.push('delta-written', 'applied');
  path.push('verified', 'snapshotted');
  return path;
}

/**
 * @typedef {{ state: () => DeployState, history: () => DeployState[], to: (next: DeployState) => DeployState }} DeployRun
 */

/**
 * A run of one mode: `to(state)` moves only along the table AND along this mode's path (or to
 * `failed`), so a step taken out of turn, or one this mode never takes, throws.
 * @param {DeployMode} mode
 * @returns {DeployRun}
 */
export function deployRun(mode) {
  const errors = deployModeErrors(mode);
  if (errors.length) throw new Error(errors[0]);
  const path = deployPath(mode);
  DEPLOY.assertPath(path);
  const run = DEPLOY.start();
  return {
    state: run.state,
    history: run.history,
    /** @param {DeployState} next */
    to(next) {
      DEPLOY.assertTransition(run.state(), next);
      if (next !== 'failed') {
        const expected = path[run.history().length - 1];
        if (next !== expected) throw new Error(`records deploy: ${run.state()} -> ${next} out of turn for this run (next is ${expected ?? 'nothing'})`);
      }
      return run.to(next);
    },
  };
}
