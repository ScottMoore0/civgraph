#!/usr/bin/env node
// @ts-check
/**
 * Elections metadata rebuild and person-id re-stamp, in the documented order, as an explicit
 * state machine (state-machine catalogue IN-04). rebuild-person-ids.sh runs this file.
 *
 * The order matters: running the election manifest on its own and committing wipes every
 * personId and name_id it writes, so the registry steps must follow it every time.
 *
 *   start -> manifest -> summaries -> registry -> applied -> merging
 *   merging -> converged            "nothing to merge" in the merge pass's last 15 lines
 *   merging -> needs-relatives      "without their pages on file": exit 2, "NEEDS RELATIVES HARVEST"
 *   merging -> reapplied            the pass merged something; apply again
 *   reapplied -> merging            (up to MAX_PASSES passes)
 *   reapplied -> not-converged      MAX_PASSES passes and still merging: carried on to the name
 *                                   registry as before, now with a NOT CONVERGED warning
 *   converged | not-converged -> name-registry -> audited ("PERSON IDS OK")
 *   any step -> failed              exit 1
 *
 * Each command's output is appended to the log (tmp/rebuild-person-ids.log, or $LOG) and judged
 * on its own: a lock error (EBUSY, EPERM, Errno 22, UNKNOWN) in THAT attempt's last 30 lines
 * retries it, up to four attempts; an earlier command's lock error can no longer make a real
 * failure retry. The current state is written to <log>.state.json at every move, so a run that
 * stopped between the manifest and the apply (person ids wiped) is reported on the next start.
 *
 * Exit 2 with "NEEDS RELATIVES HARVEST": run
 *   python scripts/ingest/electionsireland/harvest_ei_candidate_ids.py --relatives <ids>
 * with the ids it lists, then run this again.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineMachine } from '../../lib/state-machine.mjs';

/** @typedef {'start' | 'manifest' | 'summaries' | 'registry' | 'applied' | 'merging' | 'reapplied' | 'converged' | 'not-converged' | 'needs-relatives' | 'name-registry' | 'audited' | 'failed'} RebuildState */

export const REBUILD = defineMachine(/** @type {import('../../lib/state-machine.mjs').MachineSpec<RebuildState>} */ ({
  name: 'person-id rebuild',
  initial: 'start',
  transitions: {
    start: ['manifest', 'failed'],
    manifest: ['summaries', 'failed'],
    summaries: ['registry', 'failed'],
    registry: ['applied', 'failed'],
    applied: ['merging', 'failed'],
    merging: ['converged', 'needs-relatives', 'reapplied', 'failed'],
    reapplied: ['merging', 'not-converged', 'failed'],
    converged: ['name-registry', 'failed'],
    'not-converged': ['name-registry', 'failed'],
    'name-registry': ['audited', 'failed'],
    audited: [],
    'needs-relatives': [],
    failed: [],
  },
}));

/** States in which the person ids in the tree are wiped (the manifest ran, the apply has not). */
export const IDS_WIPED = Object.freeze(/** @type {RebuildState[]} */ (['manifest', 'summaries', 'registry']));
export const MAX_PASSES = 6;
const LOCK_ERROR = /Errno 22|UNKNOWN|EBUSY|EPERM/;

/** @param {string} text @param {number} n */
const lastLines = (text, n) => text.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== '').slice(-n);

/**
 * @typedef {object} Io
 * @property {(argv: string[]) => { status: number | null, output: string }} exec   runs one command
 * @property {(text: string) => void} log       appends to the log file
 * @property {(text: string) => void} say       prints (the lines the .sh printed with tee)
 * @property {(ms: number) => void} sleep
 * @property {(state: RebuildState) => void} [record]
 */

/**
 * Run the rebuild. Returns the exit code (0 OK, 1 failed, 2 needs a relatives harvest).
 * @param {{ manifestArgs?: string[] }} options
 * @param {Io} io
 */
export function rebuild({ manifestArgs = [] }, io) {
  const run = REBUILD.start();
  const to = (/** @type {RebuildState} */ s) => { run.to(s); io.record?.(s); };
  /** @param {string[]} argv @returns {string | null} the command's output, or null when it failed */
  const attempt = (argv) => {
    for (let n = 1; n <= 4; n += 1) {
      const { status, output } = io.exec(argv);
      io.log(output);
      if (status === 0) return output;
      if (lastLines(output, 30).some((l) => LOCK_ERROR.test(l))) {
        io.log(`retry ${n}: ${argv.join(' ')}\n`);
        if (n < 4) io.sleep(5000);
        continue;
      }
      io.say(`FAILED: ${argv.join(' ')}`);
      return null;
    }
    io.say(`FAILED after retries: ${argv.join(' ')}`);
    return null;
  };
  const step = (/** @type {string[]} */ argv, /** @type {RebuildState} */ next) => {
    const out = attempt(argv);
    if (out === null) { to('failed'); return null; }
    to(next);
    return out;
  };

  if (step(['node', 'scripts/build/build-test2-election-manifest.mjs', ...manifestArgs], 'manifest') === null) return 1;
  if (step(['node', 'scripts/build/build-test2-election-summaries.mjs'], 'summaries') === null) return 1;
  if (step(['python', 'scripts/ingest/persons/build_person_registry_v2.py', '--force'], 'registry') === null) return 1;
  if (step(['python', 'scripts/ingest/persons/apply_person_ids_v2.py'], 'applied') === null) return 1;
  for (let pass = 1; ; pass += 1) {
    const out = step(['python', 'scripts/ingest/persons/merge_person_ids.py'], 'merging');
    if (out === null) return 1;
    const tail40 = lastLines(out, 40);
    const at = tail40.findIndex((l) => l.includes('without their pages on file'));
    if (at >= 0) {
      to('needs-relatives');
      io.say('NEEDS RELATIVES HARVEST');
      // grep -A3 over the last 40 lines: every matching line and the three after it.
      const shown = new Set();
      tail40.forEach((l, i) => { if (l.includes('without their pages')) for (let k = i; k <= i + 3 && k < tail40.length; k += 1) shown.add(k); });
      io.say([...shown].sort((a, b) => a - b).map((k) => tail40[k]).join('\n'));
      return 2;
    }
    if (lastLines(out, 15).some((l) => /nothing to merge/i.test(l))) {
      io.log(`merge loop done after ${pass} pass(es)\n`);
      to('converged');
      break;
    }
    if (step(['python', 'scripts/ingest/persons/apply_person_ids_v2.py'], 'reapplied') === null) return 1;
    if (pass === MAX_PASSES) {
      to('not-converged');
      io.say(`NOT CONVERGED: the merge loop still merged on pass ${MAX_PASSES}; the ids are applied, but run this again until a pass finds nothing to merge`);
      break;
    }
  }
  if (step(['python', 'scripts/ingest/persons/build_name_registry.py'], 'name-registry') === null) return 1;
  if (step(['python', 'scripts/ingest/persons/audit_person_ids.py'], 'audited') === null) return 1;
  io.say('PERSON IDS OK');
  return 0;
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  process.chdir(repo);
  mkdirSync('tmp', { recursive: true });
  const logFile = process.env.LOG || 'tmp/rebuild-person-ids.log';
  const stateFile = `${logFile}.state.json`;
  if (existsSync(stateFile)) {
    try {
      const last = JSON.parse(readFileSync(stateFile, 'utf8')).state;
      if (IDS_WIPED.includes(last)) console.log(`note: the last run stopped at "${last}", after the manifest and before the apply, so the person ids in the tree are wiped; this run restores them`);
    } catch { /* unreadable: ignore */ }
  }
  writeFileSync(logFile, '');
  const write = (/** @type {string} */ t) => appendFileSync(logFile, t);
  /** @type {Io} */
  const io = {
    exec: (argv) => {
      const [prog, ...rest] = argv;
      const res = spawnSync(prog === 'node' ? process.execPath : prog, rest, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
      return { status: res.error ? 1 : res.status, output: `${res.stdout || ''}${res.stderr || ''}${res.error ? `${res.error.message}\n` : ''}` };
    },
    log: write,
    say: (t) => { console.log(t); write(`${t}\n`); },
    sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
    record: (state) => writeFileSync(stateFile, `${JSON.stringify({ state, at: new Date().toISOString() })}\n`),
  };
  const manifestArgs = (process.env.MANIFEST_ARGS || '').split(/\s+/).filter(Boolean);
  return rebuild({ manifestArgs }, io);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
