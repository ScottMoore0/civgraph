#!/usr/bin/env node
/**
 * The intake CLI: one batch.json per data batch instead of a hand-written upload.ps1,
 * UPLOAD.txt, post-upload.txt and apply.py each time. See docs/intake.md.
 *
 *   node scripts/intake/intake.mjs validate    <batch-dir> [--manifest <batch.json>] [--repo <root>]
 *   node scripts/intake/intake.mjs plan        <batch-dir> [--json] [--verbose]
 *   node scripts/intake/intake.mjs stage       <batch-dir> [--write]
 *   node scripts/intake/intake.mjs upload      <batch-dir> (--dry-run | --yes)
 *   node scripts/intake/intake.mjs post-upload <batch-dir> [--write]
 *   node scripts/intake/intake.mjs report      <batch-dir> [--out <file>] [--repo-label <text>]
 *
 * stage and post-upload are dry runs unless --write. upload refuses to run without either
 * --dry-run (each script's own dry form, read-only on R2) or --yes (a real upload, allowed only
 * for a batch whose status is committed or uploaded). Nothing here pushes or deploys, and
 * nothing runs .claude/publish/: publishing needs the owner's approval in chat.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBatch, validateBatch } from './lib/batch.mjs';
import { buildPostUploadSteps, buildUploadSteps, formatStep, runSteps } from './lib/commands.mjs';
import { formatPlan, planBatch, renderReport } from './lib/plan.mjs';
import { stageBatch } from './lib/stage.mjs';

const COMMANDS = new Set(['validate', 'plan', 'stage', 'upload', 'post-upload', 'report']);
const FLAGS = new Set(['--write', '--dry-run', '--yes', '--json', '--verbose', '--manifest', '--repo', '--out', '--repo-label']);
const VALUE_FLAGS = new Set(['--manifest', '--repo', '--out', '--repo-label']);

function usage(message, err = console.error) {
  if (message) err(`intake: ${message}`);
  err('Usage: node scripts/intake/intake.mjs <validate|plan|stage|upload|post-upload|report> <batch-dir> [options]');
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

  let batch;
  try {
    batch = loadBatch(opts.positional[0], { manifest: opts.values.manifest, repo: opts.values.repo });
  } catch (e) {
    err(`intake: ${e.message}`);
    return 1;
  }

  const validation = validateBatch(batch);
  if (opts.command === 'validate') {
    printValidation(validation, log);
    log(validation.errors.length
      ? `FAIL: ${validation.errors.length} problem(s) in ${batch.manifest.id || batch.manifestPath}`
      : `PASS: ${batch.manifest.id} is valid (${batch.manifest.operations.length} operation(s), ${validation.warnings.length} warning(s))`);
    return validation.errors.length ? 1 : 0;
  }
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
      return 0;
    }
    case 'upload': {
      const dryRun = opts.flags.has('--dry-run');
      const yes = opts.flags.has('--yes');
      if (dryRun === yes) return usage('upload needs exactly one of --dry-run or --yes', err);
      if (yes && !['committed', 'uploaded'].includes(batch.manifest.status)) {
        err(`intake: status is ${batch.manifest.status}; a real upload needs the batch committed (status committed) with the owner's approval`);
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
      log(dryRun ? 'Dry run complete: nothing was sent. Run with --yes to upload.' : 'Uploads done. Next: intake post-upload.');
      return 0;
    }
    case 'post-upload': {
      const steps = buildPostUploadSteps(batch);
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
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
