#!/usr/bin/env node
/**
 * npm run worktree:remove -- <name | path> [--force]
 *
 * Remove a worktree without touching what its junctions point at:
 *   1. refuse the main checkout, a path git does not list as a worktree, and (unless --force) a
 *      worktree with uncommitted changes to tracked files;
 *   2. count the entries of the main checkout's node_modules and of each artefact folder of main's
 *      that the worktree takes (config/worktrees.json);
 *   3. remove every junction and symbolic link in the worktree (node_modules, the snapshot links,
 *      any an agent made by hand), and check none is left;
 *   4. git worktree remove --force;
 *   5. count again: a changed count fails loudly;
 *   6. delete the snapshots no worktree links to any more.
 *
 * `git worktree remove --force` on its own follows a junction and deletes what it points at; it
 * once emptied main's node_modules (memory: feedback_worktree_junction.md).
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artefactPlan, countEntries, findLinks, git, isInside, listWorktrees, pruneSnapshots, removeLink,
  samePath, worktreePath,
} from './lib.mjs';

/**
 * @param {{ target: string, force?: boolean, log?: (line: string) => void }} options
 */
export function removeWorktree({ target, force = false, log = console.log }) {
  const all = listWorktrees();
  const mainRoot = all[0].path;
  const wt = /[\\/]/.test(target) ? path.resolve(target) : worktreePath(target);
  if (samePath(wt, mainRoot)) throw new Error('refusing to remove the main checkout');
  if (!all.some((w) => samePath(w.path, wt))) throw new Error(`${wt} is not a worktree of this repository`);
  if (isInside(process.cwd(), wt)) throw new Error(`run this from outside ${wt}`);
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd: wt }).stdout;
  if (dirty && !force) throw new Error(`${wt} has uncommitted changes to tracked files (--force to remove it anyway):\n${dirty.split('\n').slice(0, 10).join('\n')}`);

  const watched = [path.join(mainRoot, 'node_modules'), ...artefactPlan(mainRoot, wt).links.map((l) => l.mainAbs)];
  const before = watched.map(countEntries);

  const links = findLinks(wt);
  for (const link of links) removeLink(link);
  const left = findLinks(wt);
  if (left.length) throw new Error(`links still in ${wt} after removing them: ${left.join(', ')}; not removing the worktree`);
  log(`removed ${links.length} junction(s)/link(s) from ${wt}`);

  git(['worktree', 'remove', '--force', wt], { cwd: mainRoot });
  // A file a process still holds open can leave the folder behind on Windows.
  if (existsSync(wt)) rmSync(wt, { recursive: true, force: true, maxRetries: 3 });
  log(`removed worktree ${wt}`);

  const after = watched.map(countEntries);
  if (after[0] !== before[0]) throw new Error(`main's node_modules had ${before[0]} entries and has ${after[0]}: restore it (npm ci in the main checkout)`);
  log(`main's node_modules: ${after[0]} entries, unchanged`);
  // The worktree links only to the snapshot, never to these, so a change here is a build running
  // in the main checkout, not this removal: reported, not failed.
  for (let i = 1; i < watched.length; i += 1) {
    if (after[i] !== before[i]) log(`note: ${watched[i]} went from ${before[i]} to ${after[i]} entries meanwhile (a build in the main checkout?)`);
  }
  const pruned = pruneSnapshots(mainRoot);
  if (pruned.length) log(`pruned ${pruned.length} unused snapshot(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: npm run worktree:remove -- <name | path> [--force]');
    process.exit(2);
  }
  try {
    removeWorktree({ target, force: args.includes('--force') });
  } catch (error) {
    console.error(`FAIL: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
