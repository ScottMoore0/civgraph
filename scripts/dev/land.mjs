#!/usr/bin/env node
/**
 * npm run land -- [--main <branch>] [--keep-worktree] <branch> [<branch>...]
 *
 * The landing queue: lands each branch on main in turn, so parallel streams stop rebasing over
 * one another. For each branch, in the order given:
 *
 *   1. rebase it onto main, in its worktree (a temporary one, made by worktree:new, if it has none);
 *      a conflict only in generated files (config/worktrees.json landing.generated: the language
 *      files and review lists, import-map lines and cache tokens, generated types, the v1 contract
 *      baseline) takes main's side; any other conflict aborts the rebase and stops the queue;
 *   2. regenerate what was resolved that way, and commit it;
 *   3. re-stamp the import maps and cache tokens (landing.restamp: build:import-maps,
 *      build:browse-cache), committing the re-stamp when it changes anything. This runs on the
 *      branch, before the gates, so the gates hold the stamped tree (ui-module-tokens fails on a
 *      stale map) and main then moves once, to a tree that is already stamped;
 *   4. run the gates (landing.gates: test:unit, check:i18n, check:architecture, check:boundaries,
 *      check:dir-names and the type checks) with check:fast's runner; a failure stops the queue;
 *   5. fast-forward main to the branch: `git merge --ff-only` in the checkout that has main
 *      checked out (which must have no uncommitted changes to tracked files), or update-ref when
 *      none has. If main moved meanwhile, the branch goes round again from 1;
 *   6. remove the branch's worktree with worktree:remove (junctions first), unless --keep-worktree.
 *
 * It never pushes, publishes, deploys or uploads. It refuses to start, and to move main, while a
 * publish runs (landing.publishCommand). --main <branch> lands into another branch instead: a
 * throwaway "main" for trying the queue out.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, git, listWorktrees, runNpm, runningPublishes, samePath } from './worktree/lib.mjs';
import { globToRegExp, regenerationSteps, resolveConflict } from './worktree/conflicts.mjs';
import { createWorktree } from './worktree/new.mjs';
import { removeWorktree } from './worktree/remove.mjs';

/** @typedef {import('./worktree/conflicts.mjs').Rule} Rule */

const RULES = /** @type {Rule[]} */ (CONFIG.landing.generated);
const MAX_ROUNDS = 3;

class Stop extends Error {}

/** @param {string} line */
const log = (line) => console.log(line);

function refusePublish() {
  const running = runningPublishes();
  if (running.length) throw new Stop(`a publish is running; landing waits until it has finished:\n  ${running.join('\n  ')}`);
}

/** @param {string} wt */
const rebaseInProgress = (wt) => ['rebase-merge', 'rebase-apply'].some((p) => existsSync(path.resolve(wt, git(['rev-parse', '--git-path', p], { cwd: wt }).stdout)));

/** @param {string} wt */
const trackedChanges = (wt) => git(['status', '--porcelain', '--untracked-files=no'], { cwd: wt }).stdout;

/**
 * The stages a conflicted file has in the index (2: main's side, 3: the branch's).
 * @param {string} wt
 * @param {string} file
 */
function stagesOf(wt, file) {
  const out = git(['ls-files', '-u', '--', file], { cwd: wt }).stdout;
  return new Set(out.split('\n').filter(Boolean).map((line) => Number(line.split(/\s+/)[2])));
}

/**
 * Rebase the branch in `wt` onto `onto`, resolving generated-file conflicts.
 * @param {string} wt
 * @param {string} onto
 * @returns {Rule[]} the rules whose files were resolved to main's side
 */
function rebase(wt, onto) {
  /** @type {Rule[]} */
  const used = [];
  const env = { GIT_EDITOR: 'true' };
  let result = git(['rebase', onto], { cwd: wt, allowFail: true, env });
  for (let guard = 0; rebaseInProgress(wt); guard += 1) {
    if (guard > 500) throw new Stop('the rebase did not finish after 500 steps');
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], { cwd: wt }).stdout.split('\n').filter(Boolean);
    const commit = git(['log', '-1', '--format=%h %s', 'REBASE_HEAD'], { cwd: wt, allowFail: true }).stdout;
    if (!conflicted.length) {
      // Stopped without a conflict: an empty commit, or a failed step.
      if (git(['diff', '--cached', '--quiet'], { cwd: wt, allowFail: true }).status === 0) {
        result = git(['rebase', '--skip'], { cwd: wt, allowFail: true, env });
        continue;
      }
      git(['rebase', '--abort'], { cwd: wt, allowFail: true });
      throw new Stop(`the rebase stopped at ${commit} without a conflict:\n${result.stderr || result.stdout}`);
    }
    /** @type {string[]} */
    const refused = [];
    /** @type {Array<() => void>} */
    const apply = [];
    for (const file of conflicted) {
      const stages = stagesOf(wt, file);
      const abs = path.join(wt, file);
      let text = null;
      if (stages.has(2) && stages.has(3) && existsSync(abs)) {
        const buf = readFileSync(abs);
        if (!buf.includes(0)) text = buf.toString('utf8');
      }
      const verdict = resolveConflict(file, text, RULES);
      if (!verdict.ok) { refused.push(`${file} (${verdict.reason})`); continue; }
      used.push(...verdict.rules.filter((rule) => !used.includes(rule)));
      apply.push(() => {
        if (verdict.whole && !stages.has(2)) git(['rm', '--quiet', '--', file], { cwd: wt });
        else if (verdict.whole) git(['checkout', '--ours', '--', file], { cwd: wt });
        else writeFileSync(abs, /** @type {string} */ (verdict.text));
        if (stages.has(2)) git(['add', '--', file], { cwd: wt });
      });
    }
    if (refused.length) {
      git(['rebase', '--abort'], { cwd: wt, allowFail: true });
      throw new Stop(`conflict at ${commit} that land does not resolve (the rebase was aborted; the branch is as it was):\n  ${refused.join('\n  ')}`);
    }
    for (const step of apply) step();
    log(`    resolved to main's side at ${commit}: ${conflicted.join(', ')}`);
    const nothingStaged = git(['diff', '--cached', '--quiet'], { cwd: wt, allowFail: true }).status === 0;
    result = git(['rebase', nothingStaged ? '--skip' : '--continue'], { cwd: wt, allowFail: true, env });
  }
  if (result.status !== 0 && !rebaseInProgress(wt)) {
    // A rebase that failed before it began (a dirty tree, an unknown ref).
    const head = git(['rev-parse', 'HEAD'], { cwd: wt }).stdout;
    if (git(['merge-base', '--is-ancestor', onto, head], { cwd: wt, allowFail: true }).status !== 0) {
      throw new Stop(`the rebase did not run:\n${result.stderr || result.stdout}`);
    }
  }
  return used;
}

/**
 * Stage what the steps changed and commit it, if anything changed.
 * @param {string} wt
 * @param {string} message
 * @param {string[]} globs untracked files matching these are added too
 */
function commitChanges(wt, message, globs = []) {
  git(['add', '-u'], { cwd: wt });
  if (globs.length) {
    const patterns = globs.map(globToRegExp);
    const untracked = git(['ls-files', '--others', '--exclude-standard'], { cwd: wt }).stdout.split('\n').filter(Boolean)
      .filter((file) => patterns.some((p) => p.test(file)));
    if (untracked.length) git(['add', '--', ...untracked], { cwd: wt });
  }
  if (git(['diff', '--cached', '--quiet'], { cwd: wt, allowFail: true }).status === 0) return false;
  git(['commit', '--quiet', '-m', message], { cwd: wt });
  return true;
}

/**
 * Run npm steps in `wt`; a failing step stops the queue unless it may fail.
 * @param {string} wt
 * @param {Array<{ npm: string, env?: Record<string, string>, allowFail?: boolean }>} steps
 */
function runSteps(wt, steps) {
  for (const step of steps) {
    const { code, tail } = runNpm(wt, step);
    log(`    ${code === 0 ? 'ok  ' : 'FAIL'} npm run ${step.npm}`);
    if (code !== 0 && !step.allowFail) throw new Stop(`npm run ${step.npm} failed in ${wt}:\n${tail}`);
  }
}

/**
 * Land one branch.
 * @param {string} branch
 * @param {{ mainRef: string, keepWorktree: boolean }} options
 */
function landBranch(branch, { mainRef, keepWorktree }) {
  if (branch === mainRef) throw new Stop(`${branch} is the branch being landed into`);
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }).status !== 0) throw new Stop(`there is no branch ${branch}`);
  let wtInfo = listWorktrees().find((w) => w.branch === branch);
  let temporary = false;
  if (!wtInfo) {
    const name = `land-${branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 60);
    log(`  ${branch} has no worktree: making a temporary one`);
    // The gates read no generated artefact, so the temporary worktree goes without them.
    createWorktree({ name, branch, existing: true, artefacts: false, log: (line) => log(`    ${line}`) });
    wtInfo = listWorktrees().find((w) => w.branch === branch);
    temporary = true;
  }
  const wt = /** @type {{ path: string }} */ (wtInfo).path;
  if (rebaseInProgress(wt)) throw new Stop(`a rebase is already in progress in ${wt}`);
  const dirty = trackedChanges(wt);
  if (dirty) throw new Stop(`${wt} has uncommitted changes to tracked files:\n${dirty.split('\n').slice(0, 10).join('\n')}`);

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const mainSha = git(['rev-parse', `refs/heads/${mainRef}`]).stdout;
    log(`  round ${round}: rebase ${branch} onto ${mainRef} (${mainSha.slice(0, 10)}) in ${wt}`);
    const used = rebase(wt, mainSha);
    if (used.length) {
      const steps = regenerationSteps(used, RULES);
      log(`    regenerating ${used.map((r) => r.name).join(', ')}`);
      for (const rule of used) if (rule.note) log(`    note: ${rule.name}: ${rule.note}`);
      runSteps(wt, steps);
      if (commitChanges(wt, `Regenerated ${used.map((r) => r.name).join(', ')} after the rebase onto ${mainRef}, where both sides had changed them.`, used.flatMap((r) => r.files))) {
        log('    committed the regeneration');
      }
    }
    runSteps(wt, CONFIG.landing.restamp);
    if (commitChanges(wt, `Re-stamped the import maps and cache tokens after the rebase onto ${mainRef}.`)) log('    committed the re-stamp');

    log(`    gates: ${CONFIG.landing.gates.length} steps`);
    const gates = runNpmGates(wt);
    if (gates.code !== 0) throw new Stop(`the gates failed on ${branch} (it is rebased in ${wt}; main has not moved):\n${gates.tail}`);
    log('    gates ok');

    refusePublish();
    const nowMain = git(['rev-parse', `refs/heads/${mainRef}`]).stdout;
    if (nowMain !== mainSha) { log(`    ${mainRef} moved during the gates (now ${nowMain.slice(0, 10)}): going round again`); continue; }
    const branchSha = git(['rev-parse', 'HEAD'], { cwd: wt }).stdout;
    if (git(['merge-base', '--is-ancestor', mainSha, branchSha], { allowFail: true }).status !== 0) throw new Stop(`${branch} does not contain ${mainRef} after the rebase`);
    const mainWt = listWorktrees().find((w) => w.branch === mainRef);
    if (mainWt) {
      const mainDirty = trackedChanges(mainWt.path);
      if (mainDirty) throw new Stop(`${mainWt.path} (${mainRef}) has uncommitted changes to tracked files; main was not moved:\n${mainDirty.split('\n').slice(0, 10).join('\n')}`);
      git(['merge', '--ff-only', '--quiet', branchSha], { cwd: mainWt.path });
    } else {
      git(['update-ref', `refs/heads/${mainRef}`, branchSha, mainSha]);
    }
    if (git(['rev-parse', `refs/heads/${mainRef}`]).stdout !== branchSha) throw new Stop(`${mainRef} did not move to ${branchSha}`);
    log(`    ${mainRef} fast-forwarded to ${branchSha.slice(0, 10)}${mainWt ? ` in ${mainWt.path}` : ''}`);

    if (!keepWorktree || temporary) {
      if (samePath(process.cwd(), wt)) log(`    worktree kept: land runs inside it (${wt})`);
      else removeWorktree({ target: wt, log: (line) => log(`    ${line}`) });
    }
    return branchSha;
  }
  throw new Stop(`${mainRef} kept moving: ${branch} was not landed after ${MAX_ROUNDS} rounds`);
}

/** The gates, through check:fast's runner in the branch's worktree. @param {string} wt */
function runNpmGates(wt) {
  return runNpm(wt, { npm: 'check:fast', args: ['--only', CONFIG.landing.gates.join(',')] });
}

const args = process.argv.slice(2);
const mainIndex = args.indexOf('--main');
const mainRef = mainIndex >= 0 ? args[mainIndex + 1] : 'main';
const keepWorktree = args.includes('--keep-worktree');
const branches = args.filter((a, i) => !a.startsWith('--') && !(mainIndex >= 0 && i === mainIndex + 1));
if (!branches.length || !mainRef) {
  console.error('usage: npm run land -- [--main <branch>] [--keep-worktree] <branch> [<branch>...]');
  process.exit(2);
}

/** @type {string[]} */
const landed = [];
try {
  if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${mainRef}`], { allowFail: true }).status !== 0) throw new Stop(`there is no branch ${mainRef}`);
  refusePublish();
  for (const branch of branches) {
    log(`landing ${branch} into ${mainRef}`);
    const sha = landBranch(branch, { mainRef, keepWorktree });
    landed.push(`${branch} (${sha.slice(0, 10)})`);
  }
  log(`\nLANDED ${landed.length} of ${branches.length} into ${mainRef}: ${landed.join(', ')}. Nothing was pushed.`);
} catch (error) {
  const message = /** @type {Error} */ (error).message;
  console.error(`\nSTOPPED: ${message}`);
  console.error(`Landed before the stop: ${landed.length ? landed.join(', ') : 'none'}. Not started: ${branches.slice(landed.length + 1).join(', ') || 'none'}. Nothing was pushed.`);
  process.exit(1);
}
