#!/usr/bin/env node
// @ts-check
/**
 * Which path a publish takes (scripts/publish/publish.sh):
 *
 *   full       build the records (or reuse a build of exactly these inputs), load the delta into D1,
 *              verify it, refresh the Elections app's R2 extracts, push
 *   code-only  push only: no file that feeds the records, D1 or R2 changed since the last load, so
 *              the build, the load, the verify and the R2 refresh would all be no-ops
 *
 * The decision is conservative: it is code-only only when it knows what D1 holds (the base) and
 * every file changed since then is of the 'code' class (packages/loader/src/publish-inputs.mjs; an
 * unknown file is 'records'). Anything else, and any error, is the full path.
 *
 * The base is the commit of the last publish that loaded D1, from <work>/records-base.json, written
 * after that publish pushed (--record-load) together with the last-loaded snapshot's stamp. If that
 * snapshot has changed since (a load from elsewhere), or the file is missing, the base is
 * origin/main only when the snapshot's own git_commit is origin/main (a publish built at the commit
 * it pushed); otherwise there is none. The base must be an ancestor of HEAD.
 *
 *   node scripts/publish/publish-path.mjs [--work DIR] [--rebuild] [--downloads]
 *        prints the decision; its last line is "PATH full" or "PATH code-only"
 *   node scripts/publish/publish-path.mjs [--work DIR] --record-load
 *        records HEAD as the base (after a full publish has loaded D1 and pushed)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from '@civgraph/config/node';
import { fileStamp, LAST_LOADED, publishInputClass } from '@civgraph/loader/publish-inputs.mjs';
import { openSqliteHandle } from '@civgraph/storage/node';

/**
 * @typedef {{ path: string, tracked: boolean }} ChangedFile
 * @typedef {'full' | 'code-only'} PublishPath
 * @typedef {{ commit: string, from: string }} Base  from: where the base came from, for the log
 * @typedef {{ path: PublishPath, reasons: string[], records: string[], code: string[], outside: string[] }} Decision
 */

/** What the code-only path leaves out, and why each is safe to leave out. */
export const SKIPPED_ON_CODE_ONLY = Object.freeze([
  'records:build (no file it reads changed since the last load)',
  'the D1 load, records:deploy (D1 already holds the records of these inputs)',
  'the safe verify (nothing was loaded)',
  'the Elections app extracts and their R2 upload (built from the same records)',
]);

/**
 * The decision, from the changed files alone. Pure.
 * @param {{ base: Base | null, baseProblem?: string, changed: ChangedFile[], rebuild?: boolean, downloads?: boolean }} input
 * @returns {Decision}
 */
export function decidePublishPath({ base, baseProblem = '', changed, rebuild = false, downloads = false }) {
  /** @type {string[]} */
  const records = [];
  /** @type {string[]} */
  const code = [];
  /** @type {string[]} */
  const outside = [];
  for (const file of changed) {
    const cls = publishInputClass(file.path, { tracked: file.tracked });
    (cls === 'code' ? code : cls === 'outside' ? outside : records).push(file.path);
  }
  /** @type {string[]} */
  const reasons = [];
  if (rebuild) reasons.push('--rebuild given');
  if (downloads) reasons.push('--downloads needs the records build');
  if (!base) reasons.push(`no known base for D1${baseProblem ? `: ${baseProblem}` : ''}`);
  if (records.length) reasons.push(`${records.length} changed file(s) feed the records, D1 or R2`);
  return { path: reasons.length ? 'full' : 'code-only', reasons, records, code, outside };
}

/**
 * The lines publish.sh prints for a decision.
 * @param {Decision} decision @param {Base | null} base
 * @returns {string[]}
 */
export function describeDecision(decision, base) {
  const lines = [`publish path: ${decision.path}`];
  lines.push(base ? `  base: ${base.commit.slice(0, 10)} (${base.from})` : '  base: none');
  const list = (/** @type {string} */ label, /** @type {string[]} */ files) => {
    if (!files.length) return;
    lines.push(`  ${label}: ${files.length}`);
    for (const file of files.slice(0, 10)) lines.push(`    ${file}`);
    if (files.length > 10) lines.push(`    ... and ${files.length - 10} more`);
  };
  list('changed, feeding the records', decision.records);
  list('changed, code only', decision.code);
  list('untracked outside every folder the build reads (ignored)', decision.outside);
  if (decision.path === 'full') {
    for (const reason of decision.reasons) lines.push(`  full path because: ${reason}`);
  } else {
    lines.push('  skipped:');
    for (const skipped of SKIPPED_ON_CODE_ONLY) lines.push(`    ${skipped}`);
  }
  lines.push(`PATH ${decision.path}`);
  return lines;
}

// ------------------------------------------------------------------ git and the work folder

/** @param {string[]} args */
function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** @param {string} commit */
function isAncestorOfHead(commit) {
  try { git(['merge-base', '--is-ancestor', commit, 'HEAD']); return true; } catch { return false; }
}

/** The git_commit the last-loaded snapshot was built at, or '' when unreadable. */
function lastLoadedCommit() {
  if (!existsSync(LAST_LOADED)) return '';
  try {
    const db = openSqliteHandle(LAST_LOADED, { readOnly: true });
    try {
      const row = /** @type {{ value?: string } | undefined} */ (db.prepare("SELECT value FROM dataset WHERE key = 'git_commit'").get());
      return String(row?.value || '');
    } finally { db.close(); }
  } catch { return ''; }
}

/**
 * The base, or the reason there is none.
 * @param {string} work
 * @returns {{ base: Base | null, problem: string }}
 */
export function resolveBase(work) {
  const stampFile = path.join(work, 'records-base.json');
  const loaded = fileStamp(LAST_LOADED);
  if (!loaded) return { base: null, problem: 'no last-loaded snapshot' };
  /** @type {{ commit?: string, lastLoaded?: string } | null} */
  let stamp = null;
  try { stamp = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : null; } catch { stamp = null; }
  /** @type {Base | null} */
  let base = null;
  let problem = '';
  if (stamp?.commit && stamp.lastLoaded === loaded) base = { commit: stamp.commit, from: 'records-base.json, the last publish that loaded D1' };
  else {
    problem = stamp ? 'the last-loaded snapshot changed after records-base.json was written' : 'no records-base.json yet';
    let origin = '';
    try { origin = git(['rev-parse', 'origin/main']); } catch { origin = ''; }
    const built = lastLoadedCommit();
    if (origin && built === origin) base = { commit: origin, from: 'origin/main, which the last-loaded snapshot was built at' };
    else return { base: null, problem: `${problem}, and the last-loaded snapshot was built at ${built.slice(0, 10) || 'an unknown commit'}, not origin/main` };
  }
  if (!isAncestorOfHead(base.commit)) return { base: null, problem: `${base.commit.slice(0, 10)} (${base.from}) is not an ancestor of HEAD` };
  return { base, problem: '' };
}

/**
 * Every file changed since the base: committed (renames as both names), uncommitted, untracked.
 * @param {string} commit
 * @returns {ChangedFile[]}
 */
export function changedSince(commit) {
  const lines = (/** @type {string} */ text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const tracked = new Set([...lines(git(['diff', '--name-only', '--no-renames', commit, 'HEAD'])), ...lines(git(['diff', '--name-only', '--no-renames', 'HEAD']))]);
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard']));
  return [...[...tracked].map((p) => ({ path: p, tracked: true })), ...untracked.map((p) => ({ path: p, tracked: false }))];
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const at = argv.indexOf('--work');
  const work = path.resolve(REPO_ROOT, at >= 0 ? argv[at + 1] || '' : path.join('.claude', 'publish', 'work'));
  if (argv.includes('--record-load')) {
    const head = git(['rev-parse', 'HEAD']);
    writeFileSync(path.join(work, 'records-base.json'), `${JSON.stringify({ commit: head, lastLoaded: fileStamp(LAST_LOADED), at: new Date().toISOString() }, null, 2)}\n`);
    console.log(`records base: ${head.slice(0, 10)} (D1 holds the records of this commit)`);
    return 0;
  }
  const { base, problem } = resolveBase(work);
  const changed = base ? changedSince(base.commit) : [];
  const decision = decidePublishPath({ base, baseProblem: problem, changed, rebuild: argv.includes('--rebuild'), downloads: argv.includes('--downloads') });
  for (const line of describeDecision(decision, base)) console.log(line);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.log(`publish path: the decision failed (${/** @type {Error} */ (error).message.split('\n')[0]})`);
    console.log('PATH full');
  }
}
