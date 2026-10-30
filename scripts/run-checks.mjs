#!/usr/bin/env node
/**
 * Run the `npm run check` chain in parallel.
 *
 * `check` is 61 independent validators joined with &&, so they ran one after another and a
 * full check took minutes even on a 32-core machine. Each step only reads the tree, so they
 * can run side by side; this runs them a few at a time, keeps each step's output to itself,
 * and prints only the failures in full.
 *
 *   node scripts/run-checks.mjs                     every step of `check`, then check:test2
 *   node scripts/run-checks.mjs --skip a,b          leave steps out (e.g. check:elections-d1,
 *                                                   which compares against the LIVE database
 *                                                   and so fails until the next deploy)
 *   node scripts/run-checks.mjs --only a,b          just these steps
 *   node scripts/run-checks.mjs --jobs 8            concurrency (default: half the cores, max 12)
 *   node scripts/run-checks.mjs --serial            one at a time, in order, as `npm run check`
 *
 * Steps in SERIAL_ONLY write shared scratch files or lean on the network, and run one at a
 * time after the parallel batch so they cannot collide with each other.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const SERIAL_ONLY = new Set([
  'test:scoped-writes',
  'check:r2-parity',
  'check:external-sources',
  'check:elections-d1',
  'lint',
  'lint:functions-strict'
]);

const args = process.argv.slice(2);
const listArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const serial = args.includes('--serial');
const jobsArg = Number(listArg('--jobs')[0]);
const jobs = serial ? 1 : (Number.isFinite(jobsArg) && jobsArg > 0 ? jobsArg : Math.max(2, Math.min(12, Math.floor(os.cpus().length / 2))));
const skip = new Set(listArg('--skip'));
const only = listArg('--only');

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
let steps = only.length
  ? only
  : [...scripts.check.split('&&').map((s) => s.trim().replace(/^npm run (-s )?/, '')), 'check:test2'];
steps = steps.filter((step) => !skip.has(step));
for (const step of steps) {
  if (!scripts[step]) {
    console.error(`FAIL: no npm script named ${step}`);
    process.exit(1);
  }
}

// Slowest first, from the last run's timings, so one long step does not start last and
// leave the other workers idle while it runs alone.
const TIMINGS = 'tmp/check-timings.json';
const lastTimings = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, 'utf8')) : {};
if (!serial) steps.sort((a, b) => (lastTimings[b] || 0) - (lastTimings[a] || 0));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function runStep(step) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(npm, ['run', '-s', step], { shell: process.platform === 'win32', env: process.env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (code) => resolve({ step, code, output, seconds: (Date.now() - started) / 1000 }));
  });
}

async function pool(list, width) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, async () => {
    while (next < list.length) {
      const step = list[next++];
      const result = await runStep(step);
      results.push(result);
      console.log(`${result.code === 0 ? 'ok  ' : 'FAIL'} ${result.seconds.toFixed(1).padStart(6)}s  ${step}`);
    }
  }));
  return results;
}

const started = Date.now();
const parallelSteps = serial ? steps : steps.filter((step) => !SERIAL_ONLY.has(step));
const serialSteps = serial ? [] : steps.filter((step) => SERIAL_ONLY.has(step));
const results = [
  ...(await pool(parallelSteps, jobs)),
  ...(await pool(serialSteps, 1))
];
const failed = results.filter((result) => result.code !== 0);
mkdirSync('tmp', { recursive: true });
const timings = { ...lastTimings };
for (const result of results) timings[result.step] = Math.round(result.seconds * 10) / 10;
writeFileSync(TIMINGS, `${JSON.stringify(timings, null, 1)}\n`);
const serialSeconds = results.reduce((sum, result) => sum + result.seconds, 0).toFixed(0);
for (const result of failed) {
  console.log(`\n--- ${result.step} (exit ${result.code}) ---`);
  console.log(result.output.trim().split(/\r?\n/).slice(-25).join('\n'));
}
const seconds = ((Date.now() - started) / 1000).toFixed(0);
if (failed.length) {
  console.log(`\nCHECKS FAILED: ${failed.length} of ${results.length} (${seconds}s, ${jobs} at a time)`);
  process.exit(1);
}
console.log(`\nCHECKS OK: ${results.length} steps in ${seconds}s (${jobs} at a time; ${serialSeconds}s one after another)`);
