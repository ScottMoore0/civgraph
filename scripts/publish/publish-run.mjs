#!/usr/bin/env node
// @ts-check
/**
 * The stages of a publish (scripts/publish/publish.sh) as an explicit machine, recorded between
 * runs (state-machine catalogue PL-01).
 *
 *   start --> refused                                (uncommitted changes, real run)
 *   start --> built --> loaded ----------> [downloads] --> pushed --> logged
 *               |   \-> would-load (dry) -> [downloads] ------------> logged
 *               +--> aborted-before-load             (records:build failed: nothing loaded)
 *   built  --> load-failed                           (records:deploy failed: D1 may hold part of it)
 *   loaded or downloads --> aborted-after-load       (push failed: D1 is ahead of the deployed code)
 *
 * publish.sh used to keep the stage in its control flow only and log finished runs only, so an
 * abort after the D1 load left nothing for the next run to see. Each stage now goes through this
 * CLI, which refuses a move the table does not list and writes the run to
 * <work>/publish-run.json; a run that starts after a load-failed or aborted-after-load run (or one
 * that died mid-way) says so first.
 *
 *   node scripts/publish/publish-run.mjs <work-dir> start [--dry]
 *   node scripts/publish/publish-run.mjs <work-dir> to <stage>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { defineMachine } from '../lib/state-machine.mjs';
import { assertTransition, checkTransition, defineGuards } from './transition-check.mjs';

/**
 * @typedef {'start' | 'refused' | 'built' | 'loaded' | 'would-load' | 'downloads' | 'pushed' | 'logged'
 *   | 'aborted-before-load' | 'load-failed' | 'aborted-after-load'} PublishStage
 */

export const publishRun = defineMachine(/** @type {import('../lib/state-machine.mjs').MachineSpec<PublishStage>} */ ({
  name: 'publish',
  initial: 'start',
  transitions: {
    start: ['refused', 'built', 'aborted-before-load'],
    built: ['loaded', 'would-load', 'load-failed'],
    loaded: ['downloads', 'pushed', 'aborted-after-load'],
    'would-load': ['downloads', 'logged'],
    downloads: ['pushed', 'logged', 'aborted-after-load'],
    pushed: ['logged'],
    refused: [],
    logged: [],
    'aborted-before-load': [],
    'load-failed': [],
    'aborted-after-load': [],
  },
}));

const dryOnly = (/** @type {{ dry?: boolean }} */ ctx) => (ctx.dry ? null : 'only a dry run');
const realOnly = (/** @type {{ dry?: boolean }} */ ctx) => (ctx.dry ? 'a dry run loads and pushes nothing' : null);

export const publishGuards = defineGuards(publishRun, {
  'start->refused': realOnly, // a dry run warns about uncommitted changes and goes on
  'built->loaded': realOnly,
  'built->load-failed': realOnly,
  'built->would-load': dryOnly,
  'would-load->logged': dryOnly,
  'downloads->logged': dryOnly,
  'downloads->pushed': realOnly,
  'downloads->aborted-after-load': realOnly,
});

/** @param {string} from @param {string} to @param {{ dry?: boolean }} [context] */
export const checkPublishTransition = (from, to, context) => checkTransition(publishRun, publishGuards, from, to, context);

/** Final stages that leave D1 ahead of (or out of step with) the deployed code. */
export const UNSETTLED = Object.freeze(['load-failed', 'aborted-after-load']);

/**
 * The warning a new run prints about the last one, or null when it finished cleanly.
 * @param {{ stage?: string, head?: string, startedAt?: string, dry?: boolean } | null | undefined} last
 */
export function previousRunWarning(last) {
  if (!last?.stage) return null;
  const which = `the last publish (${last.startedAt || 'time unknown'}, ${last.head || 'HEAD unknown'}${last.dry ? ', dry run' : ''})`;
  if (last.stage === 'load-failed') return `WARNING: ${which} failed during the D1 load: D1 may hold part of that build. records:deploy is idempotent; this run reloads the delta.`;
  if (last.stage === 'aborted-after-load') return `WARNING: ${which} loaded D1 but did not push: D1 is ahead of the deployed Functions until this run pushes.`;
  if (!publishRun.start(/** @type {PublishStage} */ (last.stage)).done()) return `WARNING: ${which} stopped at "${last.stage}" without finishing (killed or crashed).`;
  return null;
}

function headCommit() {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const [workDir, command, arg] = argv;
  if (!workDir || !['start', 'to'].includes(command || '')) {
    console.error('usage: publish-run.mjs <work-dir> start [--dry] | publish-run.mjs <work-dir> to <stage>');
    return 2;
  }
  const file = path.join(workDir, 'publish-run.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (command === 'start') {
    const warning = previousRunWarning(saved.run);
    if (warning) console.log(warning);
    const run = { startedAt: new Date().toISOString(), head: headCommit(), dry: argv.includes('--dry'), stage: publishRun.initial, history: [publishRun.initial] };
    mkdirSync(workDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ run, previous: saved.run || null }, null, 2)}\n`);
    return 0;
  }
  const run = saved.run;
  if (!run) { console.error('publish-run: no run started'); return 2; }
  try {
    run.stage = assertTransition(publishRun, publishGuards, run.stage, /** @type {PublishStage} */ (arg), { dry: run.dry });
  } catch (error) {
    console.error(`publish-run: ${/** @type {Error} */ (error).message}`);
    return 1;
  }
  run.history.push(run.stage);
  run.updatedAt = new Date().toISOString();
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
