#!/usr/bin/env node
/**
 * The intake CLI: one batch.json per data batch instead of a hand-written upload.ps1,
 * UPLOAD.txt, post-upload.txt and apply.py each time. See docs/intake.md.
 *
 *   node scripts/intake/intake.mjs init        <batch-dir> --title <text>
 *   node scripts/intake/intake.mjs validate    <batch-dir> [--lock] [--manifest <batch.json>] [--repo <root>]
 *   node scripts/intake/intake.mjs plan        <batch-dir> [--json] [--verbose]
 *   node scripts/intake/intake.mjs stage       <batch-dir> [--write]
 *   node scripts/intake/intake.mjs upload      <batch-dir> (--dry-run | --yes)
 *   node scripts/intake/intake.mjs post-upload <batch-dir> [--write]
 *   node scripts/intake/intake.mjs report      <batch-dir> [--out <file>] [--repo-label <text>]
 *   node scripts/intake/intake.mjs status      <batch-dir>
 *   node scripts/intake/intake.mjs mark        <batch-dir> <status>
 *   node scripts/intake/intake.mjs plugins     [--check]
 *   node scripts/intake/intake.mjs run         <plugin> <batch-dir> [--step <s>]... [--input k=v]... [-- <args>]
 *   node scripts/intake/intake.mjs parity      <plugin> [--step <s>]... [-- <args>]
 *
 * stage and post-upload are dry runs unless --write. upload refuses to run without either
 * --dry-run (each script's own dry form, read-only on R2) or --yes (a real upload, allowed only
 * for a batch whose status is committed or uploaded and whose approvals record the owner's
 * approval of the upload). validate --lock records the SHA-256 of every batch input in
 * state/SHA256SUMS; after that every command refuses to run if one has changed. Nothing here pushes or deploys, and
 * nothing runs .claude/publish/: publishing needs the owner's approval in chat.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REPO, loadBatch, validateBatch } from '@civgraph/intake/batch.mjs';
import { buildPostUploadSteps, buildUploadSteps, formatStep, runSteps } from '@civgraph/intake/commands.mjs';
import { formatPlan, planBatch, renderReport } from '@civgraph/intake/plan.mjs';
import { checkLock, drift, git, readStates, scaffoldManifest, writeLock, writeState } from '@civgraph/intake/review.mjs';
import { stageBatch } from '@civgraph/intake/stage.mjs';
import { commandAllowed } from '@civgraph/intake/statuses.mjs';
import { PLUGIN_COMMANDS, pluginMain } from '@civgraph/intake/plugin-cli.mjs';

const COMMANDS = new Set(['init', 'validate', 'plan', 'stage', 'upload', 'post-upload', 'report', 'status']);
const FLAGS = new Set(['--write', '--dry-run', '--yes', '--json', '--verbose', '--lock', '--manifest', '--repo', '--out', '--repo-label', '--title']);
const VALUE_FLAGS = new Set(['--manifest', '--repo', '--out', '--repo-label', '--title']);

function usage(message, err = console.error) {
  if (message) err(`intake: ${message}`);
  err('Usage: node scripts/intake/intake.mjs <init|validate|plan|stage|upload|post-upload|report|status|mark> <batch-dir> [options]');
  err('       node scripts/intake/intake.mjs <plugins|run|parity> ... (ingest plugins)');
  err('       see docs/intake.md');
  return 2;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = { command, positional: [], flags: new Set(), values: {} };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      if (!FLAGS.has(a)) throw new Error(`unknown flag ${a}`);
      if (VALUE_FLAGS.has(a)) {
        if (rest[i + 1] === undefined) throw new Error(`${a} needs a value`);
        opts.values[a.slice(2)] = rest[i + 1];
        i += 1;
      } else opts.flags.add(a);
    } else opts.positional.push(a);
  }
  return opts;
}

function printValidation({ errors, warnings }, log) {
  for (const w of warnings) log(`warning: ${w}`);
  for (const e of errors) log(`ERROR: ${e}`);
}

/**
 * Entry point, with spawn and log injectable for tests. Returns the exit code.
 */
export function main(argv, { spawn, log = console.log, err = console.error } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    return usage(e.message, err);
  }
  if (!COMMANDS.has(opts.command)) return usage(opts.command ? `unknown command ${opts.command}` : 'no command', err);
  if (opts.positional.length !== 1) return usage('give exactly one batch folder', err);

  if (opts.command === 'init') {
    const dir = path.resolve(opts.positional[0]);
    const manifestPath = path.join(dir, 'batch.json');
    if (existsSync(manifestPath)) { err(`intake: ${manifestPath} already exists`); return 1; }
    if (!opts.values.title) return usage('init needs --title', err);
    const id = path.basename(dir).toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) { err(`intake: the folder name ${id} is not a batch id (lower case, digits, dots, hyphens)`); return 1; }
    mkdirSync(dir, { recursive: true });
    const manifest = scaffoldManifest({ id, title: opts.values.title, baseCommit: git(opts.values.repo || DEFAULT_REPO, ['rev-parse', '--short=10', 'HEAD']) });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    log(`Wrote ${manifestPath}: add its sources and operations, then run validate.`);
    return 0;
  }

  let batch;
  try {
    batch = loadBatch(opts.positional[0], { manifest: opts.values.manifest, repo: opts.values.repo });
  } catch (e) {
    err(`intake: ${e.message}`);
    return 1;
  }

  if (opts.command === 'status') {
    const states = readStates(batch);
    const targets = batch.manifest.operations?.flatMap((op) => (op.files || []).map((f) => f.to).concat(op.target ? [op.target] : [])) || [];
    const d = drift(batch, targets.filter((t) => typeof t === 'string'));
    log(`${batch.manifest.id}: status ${batch.manifest.status}`);
    log(`  HEAD ${d.head || '?'}; base ${d.base || 'not recorded'}${d.commits !== null ? `, ${d.commits} commit(s) since` : d.base ? ' (not in this repository)' : ''}`);
    if (d.changedTargets.length) log(`  changed since base in files this batch writes: ${d.changedTargets.join(', ')}`);
    const lock = checkLock(batch);
    log(existsSync(path.join(batch.dir, 'state', 'SHA256SUMS')) ? `  lock: ${lock.length ? `${lock.length} change(s) since review` : 'inputs unchanged since review'}` : '  lock: none (validate --lock records one)');
    for (const s of states) log(`  ran ${s.command} at ${s.at || '?'} on ${s.head || '?'}${s.exitCode !== undefined ? `, exit ${s.exitCode}` : ''}`);
    log(`  approvals: ${(batch.manifest.approvals || []).map((a) => `${a.step} ${a.date}`).join(', ') || 'none recorded'}`);
    return 0;
  }

  const validation = validateBatch(batch);
  if (opts.command === 'validate') {
    printValidation(validation, log);
    if (!validation.errors.length && opts.flags.has('--lock')) {
      const n = writeLock(batch);
      log(`Locked ${n} file(s) in state/SHA256SUMS; later commands refuse to run if any changes.`);
    } else if (!opts.flags.has('--lock')) {
      for (const p of checkLock(batch)) validation.errors.push(`lock: ${p}; re-review, then validate --lock`);
      if (validation.errors.length) printValidation({ errors: validation.errors.filter((e) => e.startsWith('lock:')), warnings: [] }, log);
    }
    log(validation.errors.length
      ? `FAIL: ${validation.errors.length} problem(s) in ${batch.manifest.id || batch.manifestPath}`
      : `PASS: ${batch.manifest.id} is valid (${batch.manifest.operations.length} operation(s), ${validation.warnings.length} warning(s))`);
    return validation.errors.length ? 1 : 0;
  }
  for (const p of checkLock(batch)) validation.errors.push(`lock: ${p}; re-review, then validate --lock`);
  if (validation.errors.length) {
    printValidation(validation, err);
    err(`intake: ${batch.manifest.id || batch.manifestPath} does not validate; fix it before ${opts.command}`);
    return 1;
  }

  switch (opts.command) {
    case 'plan': {
      const plan = planBatch(batch);
      log(opts.flags.has('--json') ? JSON.stringify(plan, null, 2) : formatPlan(plan, { verbose: opts.flags.has('--verbose') }));
      return plan.stage.errors.length || plan.stage.conflicts.length ? 1 : 0;
    }
    case 'stage': {
      const write = opts.flags.has('--write');
      if (write && !commandAllowed('stage --write', batch.manifest.status)) {
        err(`intake: status is ${batch.manifest.status}; stage --write never runs on a published or abandoned batch`);
        return 1;
      }
      const res = stageBatch(batch, { write });
      for (const c of res.changes) log(c.action === 'edit' ? `  ${c.path}: ${c.detail}` : `  ${c.action} ${c.path}`);
      for (const c of res.conflicts) log(`  CONFLICT ${c.path}: ${c.reason}`);
      for (const e of res.errors) log(`  ERROR ${e}`);
      for (const w of res.warnings) log(`  warning: ${w}`);
      for (const n of res.notes) log(`  note: ${n}`);
      if (res.errors.length || res.conflicts.length) {
        log(`${write ? 'NOT WRITTEN' : 'DRY RUN'}: ${res.errors.length} error(s), ${res.conflicts.length} conflict(s); nothing was written`);
        return 1;
      }
      log(`${write ? 'WRITTEN' : 'DRY RUN'}: ${res.changes.length} change(s), ${res.unchanged} already in place${!write && res.changes.length ? ' (re-run with --write to apply)' : ''}${res.changes.length ? '' : ' -- nothing to do'}`);
      if (write) writeState(batch, 'stage', { exitCode: 0, changes: res.changes.map((c) => `${c.action} ${c.path}`) });
      return 0;
    }
    case 'upload': {
      const dryRun = opts.flags.has('--dry-run');
      const yes = opts.flags.has('--yes');
      if (dryRun === yes) return usage('upload needs exactly one of --dry-run or --yes', err);
      if (yes && !commandAllowed('upload --yes', batch.manifest.status)) {
        err(`intake: status is ${batch.manifest.status}; a real upload needs the batch committed (status committed) with the owner's approval`);
        return 1;
      }
      if (yes && !(batch.manifest.approvals || []).some((a) => a.step === 'upload')) {
        err("intake: no approvals entry for upload; the main session records the owner's approval from chat before a real upload");
        return 1;
      }
      const steps = buildUploadSteps(batch, { dryRun });
      if (!steps.length) { log('No upload operations in this batch.'); return 0; }
      try {
        runSteps(steps, { cwd: batch.repo, dryRun, spawn, log });
      } catch (e) {
        err(`intake: ${e.message}`);
        return 1;
      }
      writeState(batch, dryRun ? 'upload-dry-run' : 'upload', { exitCode: 0, steps: steps.map(formatStep) });
      log(dryRun ? 'Dry run complete: nothing was sent. Run with --yes to upload.' : 'Uploads done. Next: intake post-upload.');
      return 0;
    }
    case 'post-upload': {
      const steps = buildPostUploadSteps(batch);
      if (opts.flags.has('--write')) {
        if (!commandAllowed('post-upload --write', batch.manifest.status)) {
          err(`intake: status is ${batch.manifest.status}; post-upload --write runs only after this batch's upload (status committed or uploaded)`);
          return 1;
        }
        const uploaded = readStates(batch).find((st) => st.command === 'upload');
        if (!uploaded || uploaded.exitCode !== 0) {
          err('intake: no recorded upload for this batch (state/upload.json); post-upload --write would switch layers to CDN URLs it never uploaded. Run upload --yes first');
          return 1;
        }
      }
      if (!opts.flags.has('--write')) {
        for (const s of steps) log(`would run: ${formatStep(s)}`);
        log(`DRY RUN: ${steps.length} step(s); --write runs them`);
        return 0;
      }
      try {
        runSteps(steps, { cwd: batch.repo, dryRun: false, spawn, log });
      } catch (e) {
        err(`intake: ${e.message}`);
        return 1;
      }
      writeState(batch, 'post-upload', { exitCode: 0, steps: steps.map(formatStep) });
      log('Post-upload steps done. Commit what they changed, then ask the owner before publishing.');
      return 0;
    }
    case 'report': {
      const plan = planBatch(batch);
      const out = path.resolve(opts.values.out || path.join(batch.dir, 'REPORT.md'));
      writeFileSync(out, renderReport(plan, batch.manifest, { manifestLabel: path.basename(batch.manifestPath), repoLabel: opts.values['repo-label'] }));
      log(`Wrote ${out}`);
      return 0;
    }
    default:
      return usage(undefined, err);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  if (PLUGIN_COMMANDS.has(argv[0])) pluginMain(argv).then((code) => { process.exitCode = code; });
  else process.exitCode = main(argv);
}
