// @ts-check
/**
 * The intake commands for ingest plugins and batch statuses (see lib/plugins.mjs, lib/statuses.mjs):
 *
 *   intake plugins [--check]                          list the plugins; --check also fails on
 *                                                     folder files no plugin accounts for
 *   intake run <plugin> <batch-dir> [--step s]... [--all] [--allow-network] [--input k=v]...
 *              [--replace] [-- <extra script arguments>]
 *                                                     run the plugin; write staged/ and batch.json
 *   intake parity <plugin> [--step s]... [--input k=v]... [--scratch dir] [--live-clock] [--offline] [-- <args>]
 *                                                     old command lines against plugin + stage, both
 *                                                     with the same frozen wall clock unless --live-clock;
 *                                                     --offline closes the network to both runs, so a
 *                                                     network step replays from its cache or fails
 *   intake mark <batch-dir> <status>                  move the batch's status one guarded step
 *   intake from-contribution <submission-id> <batch-dir> [--submission <file>] [--replace]
 *                                                     an approved site contribution as a batch,
 *                                                     through the contribution plugin; without
 *                                                     --submission it reads the live queue (wrangler)
 *
 * `--repo <root>` works with each. Nothing here pushes, uploads or publishes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_REPO, loadBatch, validateBatch } from './batch.mjs';
import { discoverPlugins, loadPlugin, missingNeeds, parity, parityLedgerProblems, pluginManifest, producePlugin, readParityLedger, selectSteps, unaccountedFiles } from './plugins.mjs';
import { checkLock, git, writeLock, writeState } from './review.mjs';
import { stageBatch } from './stage.mjs';
import { contributionRefusal, readQueuedSubmission, submissionRecord } from './contribution.mjs';
import { checkBatchTransition } from './statuses.mjs';

export const PLUGIN_COMMANDS = new Set(['plugins', 'run', 'parity', 'mark', 'from-contribution']);
const BOOL = new Set(['--check', '--all', '--allow-network', '--replace', '--quiet', '--live-clock', '--offline']);
const VALUE = new Set(['--step', '--input', '--repo', '--scratch', '--submission']);

/** @param {string[]} argv */
export function parsePluginArgs(argv) {
  const [command, ...rest] = argv;
  /** @type {{ command: string, positional: string[], flags: Set<string>, steps: string[], inputs: Record<string, string>, values: Record<string, string>, extra: string[] }} */
  const o = { command, positional: [], flags: new Set(), steps: [], inputs: {}, values: {}, extra: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--') { o.extra = rest.slice(i + 1); break; }
    if (a.startsWith('--')) {
      if (BOOL.has(a)) { o.flags.add(a); continue; }
      if (!VALUE.has(a)) throw new Error(`unknown flag ${a}`);
      const v = rest[i + 1];
      if (v === undefined) throw new Error(`${a} needs a value`);
      i += 1;
      if (a === '--step') o.steps.push(v);
      else if (a === '--input') {
        const eq = v.indexOf('=');
        if (eq <= 0) throw new Error(`--input takes name=value (got ${v})`);
        o.inputs[v.slice(0, eq)] = v.slice(eq + 1);
      } else o.values[a.slice(2)] = v;
    } else o.positional.push(a);
  }
  return o;
}

/**
 * @param {string[]} argv
 * @param {{ log?: (s: string) => void, err?: (s: string) => void, stdio?: import('node:child_process').StdioOptions }} [io]
 * @returns {Promise<number>}
 */
export async function pluginMain(argv, { log = console.log, err = console.error, stdio = 'inherit' } = {}) {
  let o;
  try { o = parsePluginArgs(argv); } catch (e) { err(`intake: ${/** @type {Error} */ (e).message}`); return 2; }
  const repo = path.resolve(o.values.repo || DEFAULT_REPO);
  try {
    switch (o.command) {
      case 'plugins': return await listPlugins(repo, o.flags.has('--check'), log);
      case 'run': return await runCommand(repo, o, { log, err, stdio });
      case 'parity': return await parityCommand(repo, o, { log, err, stdio });
      case 'mark': return markCommand(repo, o, { log, err });
      case 'from-contribution': return await fromContributionCommand(repo, o, { log, err, stdio });
      default: err(`intake: unknown command ${o.command}`); return 2;
    }
  } catch (e) {
    err(`intake: ${/** @type {Error} */ (e).message}`);
    return 1;
  }
}

/** @param {string} repo @param {boolean} check @param {(s: string) => void} log */
async function listPlugins(repo, check, log) {
  const { plugins, without, errors } = await discoverPlugins(repo);
  const ledger = readParityLedger(repo);
  let bad = errors.length;
  for (const p of plugins) {
    const steps = Object.entries(p.steps || {});
    log(`${p.id}: ${p.title} [${p.kinds.join(', ')}]${p.command ? ` (bridge: ${p.command.join(' ')})` : p.produce ? ' (produce)' : ''}`);
    for (const [id, st] of steps) {
      const entry = ledger[`${p.id}/${id}`];
      const parityNote = entry ? ('proved' in entry ? ' [parity proved]' : ' [parity blocked]') : '';
      log(`  ${id}${st.network ? ' (network)' : ''}${parityNote}: ${st.title}`);
    }
    const loose = unaccountedFiles(p);
    if (loose.length) { bad += 1; log(`  NOT ACCOUNTED FOR: ${loose.join(', ')}`); }
    if (check) for (const [id, miss] of Object.entries(missingNeeds(p, repo))) log(`  ${id} cannot run in this checkout; missing ${miss.join(', ')}`);
  }
  for (const w of without) log(`${w}: no plugin.mjs yet`);
  for (const e of errors) log(`ERROR ${e}`);
  const ledgerProblems = parityLedgerProblems(plugins, ledger);
  if (check) for (const e of ledgerProblems) { bad += 1; log(`PARITY LEDGER ${e}`); }
  const entries = Object.values(ledger);
  log(`${plugins.length} plugin(s), ${without.length} folder(s) without one${bad ? `, ${bad} problem(s)` : ''}; parity (scripts/ingest/parity.json): ${entries.filter((e) => 'proved' in e).length} step(s) proved, ${entries.filter((e) => 'blocked' in e).length} blocked`);
  return check && bad ? 1 : 0;
}

/**
 * @param {string} repo
 * @param {ReturnType<typeof parsePluginArgs>} o
 * @param {{ log: (s: string) => void, err: (s: string) => void, stdio: import('node:child_process').StdioOptions }} io
 */
async function runCommand(repo, o, { log, err, stdio }) {
  if (o.positional.length !== 2) { err('intake: run <plugin> <batch-dir>'); return 2; }
  const [pluginId, dirArg] = /** @type {[string, string]} */ (o.positional);
  const plugin = await loadPlugin(repo, pluginId);
  const dir = batchFolder(dirArg, o, err);
  if (!dir) return 1;
  return writePluginBatch(repo, plugin, dir, dirArg, {
    steps: o.steps, all: o.flags.has('--all'), allowNetwork: o.flags.has('--allow-network'), args: o.extra, inputs: o.inputs,
  }, { log, stdio });
}

/**
 * The batch folder a run writes, made ready: its name must be a batch id, and a folder that
 * already holds a batch is started again only with --replace. Null (after saying why) when not.
 * @param {string} dirArg
 * @param {ReturnType<typeof parsePluginArgs>} o
 * @param {(s: string) => void} err
 * @returns {string | null}
 */
function batchFolder(dirArg, o, err) {
  const dir = path.resolve(dirArg);
  const id = path.basename(dir).toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) { err(`intake: the folder name ${id} is not a batch id (lower case, digits, dots, hyphens)`); return null; }
  const stagedDir = path.join(dir, 'staged');
  const occupied = existsSync(path.join(dir, 'batch.json')) || (existsSync(stagedDir) && readdirSync(stagedDir).length > 0);
  if (occupied && !o.flags.has('--replace')) { err(`intake: ${dir} already holds a batch; --replace starts it again`); return null; }
  if (o.flags.has('--replace')) rmSync(stagedDir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Run a plugin into a batch folder and write its batch.json (status draft), then validate it.
 * @param {string} repo
 * @param {import('./plugins.mjs').Plugin} plugin
 * @param {string} dir
 * @param {string} dirArg   the folder as given, for the next-step hint
 * @param {{ steps?: string[], all?: boolean, allowNetwork?: boolean, args?: string[], inputs?: Record<string, string> }} run
 * @param {{ log: (s: string) => void, stdio: import('node:child_process').StdioOptions, title?: string, preparedBy?: string }} how
 */
async function writePluginBatch(repo, plugin, dir, dirArg, run, { log, stdio, title, preparedBy }) {
  const manifestPath = path.join(dir, 'batch.json');
  const stagedDir = path.join(dir, 'staged');
  const produced = await producePlugin(plugin, { repo, batchDir: dir, ...run, stdio });
  for (const d of produced.deleted) log(`warning: the run deleted ${d}; a batch cannot carry a deletion, so it was put back`);
  if (!produced.staged.length && !produced.operations.length) {
    log(`${plugin.id}: the run changed nothing; no batch written`);
    return 0;
  }
  const id = path.basename(dir).toLowerCase();
  const manifest = pluginManifest(plugin, { id, baseCommit: git(repo, ['rev-parse', '--short=10', 'HEAD']), produced, stagedDir });
  if (title) manifest.title = title;
  if (preparedBy) manifest.preparedBy = preparedBy;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const batch = loadBatch(dir, { repo });
  writeState(batch, 'run', { exitCode: 0, plugin: plugin.id, steps: produced.steps, args: run.args || [], staged: produced.staged });
  const v = validateBatch(batch);
  for (const w of v.warnings) log(`warning: ${w}`);
  for (const e of v.errors) log(`ERROR: ${e}`);
  log(`Wrote ${manifestPath}: ${produced.staged.length} staged file(s), ${manifest.operations.length} operation(s), status draft.`);
  log(v.errors.length ? 'It does not validate yet; fix the plugin or the batch.' : `Next: intake validate ${dirArg} --lock, intake plan, intake stage --write.`);
  return v.errors.length ? 1 : 0;
}

/**
 * intake from-contribution <submission-id> <batch-dir> [--submission <file>] [--replace]
 * (refactor plan IP-4): an approved contribution as a batch, through the contribution plugin
 * (scripts/ingest/contribution/plugin.mjs). The submission comes from --submission, or else from
 * the live queue through wrangler (the owner's terminal); the batch keeps it without the
 * contributor's identity, in contribution/submission.json.
 * @param {string} repo
 * @param {ReturnType<typeof parsePluginArgs>} o
 * @param {{ log: (s: string) => void, err: (s: string) => void, stdio: import('node:child_process').StdioOptions }} io
 */
async function fromContributionCommand(repo, o, { log, err, stdio }) {
  if (o.positional.length !== 2) { err('intake: from-contribution <submission-id> <batch-dir> [--submission <file>]'); return 2; }
  const [subId, dirArg] = /** @type {[string, string]} */ (o.positional);
  const file = o.values.submission;
  /** @type {import('./contribution.mjs').Submission} */
  const submission = file ? JSON.parse(readFileSync(path.resolve(file), 'utf8')) : readQueuedSubmission(subId);
  if (submission?.id !== subId) { err(`intake: ${file || 'the queue entry'} is ${submission?.id ? `submission ${submission.id}` : 'not a submission'}, which is not submission ${subId}`); return 1; }
  const refusal = contributionRefusal(submission);
  if (refusal) { err(`intake: REFUSED ${subId}: ${refusal}`); return 1; }
  const plugin = await loadPlugin(repo, 'contribution');
  const dir = batchFolder(dirArg, o, err);
  if (!dir) return 1;
  const kept = path.join(dir, 'contribution', 'submission.json');
  mkdirSync(path.dirname(kept), { recursive: true });
  writeFileSync(kept, `${JSON.stringify(submissionRecord(submission), null, 2)}\n`);
  try {
    return await writePluginBatch(repo, plugin, dir, dirArg, { inputs: { submission: kept } }, {
      log, stdio, title: `Contribution ${subId}: ${submission.title || submission.kind}`, preparedBy: `intake from-contribution ${subId}`,
    });
  } catch (e) {
    rmSync(path.dirname(kept), { recursive: true, force: true });
    throw e;
  }
}

/**
 * @param {string} repo
 * @param {ReturnType<typeof parsePluginArgs>} o
 * @param {{ log: (s: string) => void, err: (s: string) => void, stdio: import('node:child_process').StdioOptions }} io
 */
async function parityCommand(repo, o, { log, err, stdio }) {
  if (o.positional.length !== 1) { err('intake: parity <plugin>'); return 2; }
  const plugin = await loadPlugin(repo, o.positional[0]);
  if (!plugin.steps) { err('intake: parity compares step plugins with their old command lines'); return 2; }
  const offline = o.flags.has('--offline');
  const steps = selectSteps(plugin, o.steps, { all: o.flags.has('--all'), allowNetwork: offline });
  const scratch = path.resolve(o.values.scratch || path.join(os.tmpdir(), 'intake-parity'));
  mkdirSync(scratch, { recursive: true });
  if (offline) log(`offline: the network is closed to ${steps.join(', ')} (both runs)`);
  const res = await parity(plugin, {
    repo, steps, args: o.extra, inputs: o.inputs, scratch, stdio, frozenClock: !o.flags.has('--live-clock'), offline,
    stageWrite: (batchDir) => {
      const b = loadBatch(batchDir, { repo });
      const v = validateBatch(b, { checkPublicationGate: false });
      if (v.errors.length) throw new Error(`the plugin's batch does not validate: ${v.errors.join('; ')}`);
      const r = stageBatch(b, { write: true });
      if (r.errors.length || r.conflicts.length) throw new Error(`stage failed: ${[...r.errors, ...r.conflicts.map((c) => `${c.path}: ${c.reason}`)].join('; ')}`);
    },
  });
  if (res.sameIgnoringVolatile.length) log(`note: ${res.sameIgnoringVolatile.length} output(s) equal once the steps' volatile keys are ignored: ${res.sameIgnoringVolatile.join(', ')}`);
  for (const d of res.differ) log(`DIFFER ${d.path}: old ${d.old.slice(0, 12)} new ${d.new.slice(0, 12)}`);
  const delMismatch = JSON.stringify(res.oldDeleted) !== JSON.stringify(res.newDeleted);
  if (delMismatch) log(`DELETIONS differ: old ${res.oldDeleted.join(', ') || 'none'}; plugin ${res.newDeleted.join(', ') || 'none'}`);
  const ok = !res.differ.length && !delMismatch && res.same.length > 0;
  log(`${ok ? 'PARITY' : 'NO PARITY'}: ${plugin.id} ${steps.join(', ')}: ${res.same.length} identical output(s), ${res.differ.length} differing${res.same.length ? '' : ' (the old run changed nothing, so there is nothing to compare)'}`);
  if (!o.flags.has('--quiet')) for (const p of res.same) log(`  same ${p}`);
  return ok ? 0 : 1;
}

/**
 * @param {string} repo
 * @param {ReturnType<typeof parsePluginArgs>} o
 * @param {{ log: (s: string) => void, err: (s: string) => void }} io
 */
function markCommand(repo, o, { log, err }) {
  if (o.positional.length !== 2) { err('intake: mark <batch-dir> <status>'); return 2; }
  const [dir, to] = o.positional;
  const batch = loadBatch(dir, { repo });
  const lockProblems = checkLock(batch);
  if (lockProblems.length) { err(`intake: the batch changed since review (${lockProblems.join('; ')}); validate --lock first`); return 1; }
  const from = batch.manifest.status;
  const verdict = checkBatchTransition(from, to, batch.manifest);
  if (!verdict.ok) { err(`intake: ${verdict.reason}`); return 1; }
  const raw = readFileSync(batch.manifestPath, 'utf8');
  const re = new RegExp(`("status"\\s*:\\s*)"${from}"`);
  const text = raw.replace(re, `$1"${to}"`);
  const expected = { ...batch.manifest, status: to };
  if (text === raw || JSON.stringify(JSON.parse(text)) !== JSON.stringify(expected)) { err('intake: could not rewrite the status field in place; edit it by hand'); return 1; }
  writeFileSync(batch.manifestPath, text);
  const locked = existsSync(path.join(batch.dir, 'state', 'SHA256SUMS'));
  if (locked) writeLock(loadBatch(dir, { repo }));
  writeState(batch, `mark-${to}`, { exitCode: 0, from, to });
  log(`${batch.manifest.id}: ${from} -> ${to}${locked ? ' (lock refreshed: only the status changed)' : ''}`);
  return 0;
}
