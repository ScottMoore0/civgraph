#!/usr/bin/env node
/**
 * Keep CI the CI tier of CHECKS.md: everything runs, nothing reaches production.
 *
 *   node scripts/check/rules/ci-workflow.mjs        (npm run check:ci-workflow, part of `check`)
 *
 * WHY
 *
 * Four ways CI has gone wrong here, each found late:
 *
 *   - Path filters left validators dead. A check whose inputs fell outside its workflow's
 *     `paths:` never ran on the edits it exists for: docs/** and root *.md were missing from
 *     data-readiness, so check:doc-status and check:doc-paths could not be triggered by the
 *     documents they validate (closed 2026-09-20; memory note
 *     project_clean_checkout_gate_harness.md). ci.yml has no filters; this keeps it so.
 *   - A nightly job tested production and failed on timing (2 and 4 November 2026). Checks
 *     against the deployed site are the opt-in remote tier (npm run verify, verify:public),
 *     run by hand, never by CI: a push must not depend on, or load, the live site.
 *   - The records build needs about 10.8 GB on a runner that guarantees 14 GB; without the
 *     disk-freeing step first the check job dies on ENOSPC.
 *   - Pushing a branch makes a public Pages preview; CI must never need deploy credentials.
 *
 * WHAT IT ASSERTS, per workflow under .github/workflows/
 *
 *   - no `paths:` / `paths-ignore:` filter on any trigger, and no `schedule:` trigger;
 *   - no `secrets.` reference, no production host (civgraph.net, *.pages.dev,
 *     data.civgraph.net), no PARITY_BASE_URL, no `--remote`, no wrangler or verify step;
 *   - ci.yml exists and, in its check job, frees disk before `npm run check:ci`, and runs
 *     the browser specs (test:browser:maps) after it, in the same job, because they read
 *     the records build;
 *   - every npm script ci.yml names exists in package.json;
 *   - the build steps scripts/check/clean.mjs runs are what `check:ci` runs (same module),
 *     and none of them is remote;
 *   - CHECKS.md names every check, test, verify, lint, audit, monitor and smoke script in
 *     package.json, so each one has a tier someone wrote down (a new one fails until it is).
 *
 * It reads the YAML as text with indentation, which is all these assertions need; the
 * repository has no YAML parser dependency and this does not add one.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_STEPS } from '../clean.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/**
 * The lines of a workflow with comments stripped (a # after whitespace or at the start).
 * @param {string} text
 * @returns {string[]}
 */
export function codeLines(text) {
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/(^|\s)#/);
    return match ? line.slice(0, match.index) : line;
  });
}

/**
 * The steps of one job: the text of each `- ...` item under `steps:`, in order.
 * @param {string[]} lines
 * @param {string} jobName
 * @returns {string[] | null}
 */
export function jobSteps(lines, jobName) {
  const start = lines.findIndex((line) => new RegExp(`^  ${jobName}:\\s*$`).test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && /^  \S/.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const stepsAt = body.findIndex((line) => /^\s+steps:\s*$/.test(line));
  if (stepsAt < 0) return [];
  const indent = body[stepsAt + 1]?.match(/^(\s*)-/)?.[1] ?? '';
  /** @type {string[]} */
  const steps = [];
  for (const line of body.slice(stepsAt + 1)) {
    if (line.startsWith(`${indent}- `)) steps.push(line);
    else if (steps.length && line.trim()) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/**
 * @param {string} name
 * @param {string} text
 * @returns {string[]}
 */
export function validateWorkflow(name, text) {
  /** @type {string[]} */
  const errors = [];
  const lines = codeLines(text);
  const code = lines.join('\n');
  if (/^\s+(paths|paths-ignore):/m.test(code)) {
    errors.push(`${name}: a paths/paths-ignore filter. A validator whose inputs fall outside it never runs; CI runs on every change.`);
  }
  if (/^\s+schedule:/m.test(code)) {
    errors.push(`${name}: a schedule trigger. Scheduled jobs here tested production; that is the opt-in remote tier (npm run verify).`);
  }
  /** @type {[RegExp, string][]} */
  const forbidden = [
    [/\bsecrets\./, 'a secret: CI needs no credentials (no remote D1, no R2, no deploy)'],
    [/civgraph\.net|\.pages\.dev/i, 'a production host: CI queries nothing in production'],
    [/PARITY_BASE_URL|VERIFY_SITE|VERIFY_ORIGIN/, 'a production base URL for the specs: that is npm run verify:browser'],
    [/--remote\b/, 'a --remote step: remote D1 is never touched from CI'],
    [/\bwrangler\b/, 'wrangler: CI neither deploys nor reads D1'],
    [/npm run (-s )?verify\b|npm run (-s )?verify:/, 'a verify step: verify is the opt-in remote tier'],
  ];
  for (const [re, why] of forbidden) {
    const hit = lines.findIndex((line) => re.test(line));
    if (hit >= 0) errors.push(`${name}:${hit + 1}: ${why}: ${lines[hit].trim()}`);
  }
  return errors;
}

/**
 * @param {string} text
 * @param {Record<string, string>} scripts package.json's scripts
 * @returns {string[]}
 */
export function validateCi(text, scripts) {
  /** @type {string[]} */
  const errors = [];
  const lines = codeLines(text);
  const steps = jobSteps(lines, 'check');
  if (!steps) return ['ci.yml: no `check` job.'];
  /** @param {RegExp} re */
  const at = (re) => steps.findIndex((step) => re.test(step));
  const freeDisk = at(/rm -rf[^\n]*\/usr\/share\/dotnet/);
  const checkCi = at(/npm run check:ci\s*$/m);
  const browser = at(/npm run test:browser:maps\b/);
  if (checkCi < 0) errors.push('ci.yml: the check job does not run `npm run check:ci`.');
  if (freeDisk < 0) errors.push('ci.yml: the check job does not free disk (the records build writes about 10.8 GB).');
  else if (checkCi >= 0 && freeDisk > checkCi) errors.push('ci.yml: the check job frees disk only after `npm run check:ci`.');
  if (browser < 0) errors.push('ci.yml: the check job does not run the map app browser specs (npm run test:browser:maps).');
  else if (checkCi >= 0 && browser < checkCi) errors.push('ci.yml: the browser specs run before `npm run check:ci` built the app and the records they read.');
  if (!/^on:\s*$[\s\S]*?^\s+pull_request:/m.test(lines.join('\n'))) errors.push('ci.yml: does not run on pull requests.');
  if (!/^\s+branches:\s*\[\s*main\s*\]/m.test(lines.join('\n'))) errors.push('ci.yml: does not run on pushes to main.');
  for (const match of lines.join('\n').matchAll(/npm run (?:-s )?([\w:.-]+)/g)) {
    if (!scripts[match[1]]) errors.push(`ci.yml names npm run ${match[1]}, which package.json does not define.`);
  }
  if (scripts['check:ci'] !== 'node scripts/check/clean.mjs --in-place') {
    errors.push('package.json: check:ci is no longer `node scripts/check/clean.mjs --in-place`, so CI and check:clean can drift.');
  }
  // each build step is a [command, arguments] pair
  for (const [cmd, args] of /** @type {[string, string[]][]} */ (BUILD_STEPS)) {
    const shown = `${cmd} ${args.join(' ')}`;
    if (args.includes('--remote') || /verify|deploy|wrangler/.test(shown)) errors.push(`check-clean.mjs BUILD_STEPS: ${shown} is remote; CI must stay offline.`);
  }
  return errors;
}

/** The check-like npm scripts: the ones CHECKS.md must place in a tier. */
export const CHECK_SCRIPT = /^(check|test|verify|lint|smoke|audit|monitor)(:|$)|^records:(check|verify)$|^catalogue:check$/;

/**
 * @param {string} markdown
 * @param {Record<string, string>} scripts package.json's scripts
 * @returns {string[]}
 */
export function validateChecksDoc(markdown, scripts) {
  /** @param {string} name */
  const named = (name) => markdown.includes(`\`${name}\``) || markdown.includes(`npm run ${name}\``);
  return Object.keys(scripts).filter((name) => CHECK_SCRIPT.test(name) && !named(name))
    .map((name) => `CHECKS.md does not name the npm script ${name}: put it in a tier (or under "Outside the tiers").`);
}

function main() {
  /** @type {string[]} */
  const errors = [];
  if (!existsSync(path.join(WORKFLOWS, 'ci.yml'))) errors.push('.github/workflows/ci.yml is missing.');
  /** @type {Record<string, string>} */
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  const files = existsSync(WORKFLOWS) ? readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  for (const file of files) {
    const text = readFileSync(path.join(WORKFLOWS, file), 'utf8');
    errors.push(...validateWorkflow(file, text));
    if (file === 'ci.yml') errors.push(...validateCi(text, scripts));
  }
  const checksDoc = path.join(ROOT, 'CHECKS.md');
  if (!existsSync(checksDoc)) errors.push('CHECKS.md is missing.');
  else errors.push(...validateChecksDoc(readFileSync(checksDoc, 'utf8'), scripts));
  if (errors.length) {
    console.error(`FAIL: CI workflows (${files.length} checked)`);
    for (const error of errors) console.error(`  - ${error}`);
    console.error('See CHECKS.md (the CI tier).');
    return 1;
  }
  console.log(`OK: ${files.length} workflow(s): no path filters, no schedule, no secrets, nothing remote; ci.yml frees disk, runs check:ci, then the browser specs; CHECKS.md names every check script.`);
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
