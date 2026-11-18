#!/usr/bin/env node
/**
 * npm run worktree:links -- <name | path> [...] | --all
 *
 * Give a worktree made before 18 Nov 2026 (rf-final) its own @civgraph workspace links. Such a
 * worktree joined node_modules as a whole to the main checkout's, so an import by package name
 * (`@civgraph/core/...`) would run the MAIN checkout's packages. This replaces that one junction
 * by a folder of junctions to the main checkout's entries whose @civgraph links point at the
 * worktree's own packages/ (scripts/lib/node-modules-links.mjs), as worktree:new now makes it.
 * Nothing is installed or downloaded; a worktree already converted is left alone. land runs it
 * on each branch's worktree before the gates.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureOwnPackageLinks } from '../../lib/node-modules-links.mjs';
import { listWorktrees, samePath, worktreePath } from './lib.mjs';

/**
 * @param {string[]} targets  worktree names or paths; empty with all=true for every worktree
 * @param {{ all?: boolean, log?: (line: string) => void }} [options]
 * @returns {number} how many failed
 */
export function linkWorktrees(targets, { all = false, log = console.log } = {}) {
  const worktrees = listWorktrees();
  const mainRoot = worktrees[0]?.path ?? '';
  const paths = all
    ? worktrees.slice(1).map((w) => w.path)
    : targets.map((t) => (/[\\/]/.test(t) ? path.resolve(t) : worktreePath(t)));
  let failed = 0;
  for (const wt of paths) {
    if (samePath(wt, mainRoot)) { log(`skip ${wt}: the main checkout has its own npm install`); continue; }
    if (!worktrees.some((w) => samePath(w.path, wt))) { log(`FAIL: ${wt} is not a worktree of this repository`); failed += 1; continue; }
    try {
      const result = ensureOwnPackageLinks(wt);
      log(`${wt}: ${result === 'own' ? 'already has its own @civgraph links' : 'node_modules converted; @civgraph links now point at its packages/'}`);
    } catch (error) {
      log(`FAIL: ${wt}: ${/** @type {Error} */ (error).message}`);
      failed += 1;
    }
  }
  return failed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (!all && !targets.length) {
    console.error('usage: npm run worktree:links -- <name | path> [...] | --all');
    process.exit(2);
  }
  process.exit(linkWorktrees(targets, { all }) ? 1 : 0);
}
