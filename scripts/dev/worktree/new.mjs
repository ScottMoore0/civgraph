#!/usr/bin/env node
/**
 * npm run worktree:new -- <name> [--from <ref>] [--branch <branch>] [--existing] [--no-artefacts]
 *
 * Make an agent's worktree, ready for check:fast and test:unit:
 *   - <parent of the main checkout>/civgraph-<name>, on a new branch <name> (or --branch) from main
 *     (or --from <ref>); --existing checks out a branch that already exists instead;
 *   - node_modules: its own folder of junctions to the main checkout's entries, except the
 *     @civgraph workspace links, which point at THIS worktree's packages/ (code imports the
 *     packages by name; scripts/lib/node-modules-links.mjs);
 *   - main's generated artefacts (config/worktrees.json artefacts): the big folders joined to the
 *     shared read-only snapshot, the small ones copied (scripts/dev/worktree/lib.mjs says how a
 *     write is kept off main's copies and the snapshot);
 *   - .npmrc, which preloads the write guard into every node process npm starts here;
 *   - tmp/scratch, the worktree's own scratch folder (tmp/ is gitignored), and tmp/worktree/env.sh
 *     to `source` for a direct `node` run with the guard and CIVGRAPH_SCRATCH set.
 *
 * It reads the main checkout and never writes there. Remove a worktree with npm run worktree:remove.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GUARD_SOURCE, SCRATCH_DIR, STATE_DIR, artefactPlan, checkName, ensureSnapshot, git, junction,
  mainCheckout, pruneSnapshots, worktreePath, writeState,
} from './lib.mjs';
import { makeShadow } from '../../lib/node-modules-links.mjs';

/**
 * Make a worktree. Returns its path and what it was given.
 * @param {{ name: string, branch?: string, from?: string, existing?: boolean, artefacts?: boolean, log?: (line: string) => void }} options
 */
export function createWorktree({ name, branch = name, from = 'main', existing = false, artefacts = true, log = console.log }) {
  checkName(name);
  const mainRoot = mainCheckout();
  const wt = worktreePath(name);
  if (existsSync(wt)) throw new Error(`${wt} already exists`);
  const branchExists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true }).status === 0;
  if (existing && !branchExists) throw new Error(`--existing: there is no branch ${branch}`);
  if (!existing && branchExists) throw new Error(`branch ${branch} already exists (use --existing to check it out)`);
  git(existing ? ['worktree', 'add', wt, branch] : ['worktree', 'add', '-b', branch, wt, from], { cwd: mainRoot });
  log(`worktree ${wt} on ${branch}${existing ? '' : ` (from ${from})`}`);

  const modules = makeShadow(path.join(mainRoot, 'node_modules'), wt);
  log(`  node_modules  ${modules.linked} junctions to the main checkout's entries; ${modules.packages.length} @civgraph links to this worktree's packages/`);

  const stateDir = path.join(wt, STATE_DIR);
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(path.join(wt, SCRATCH_DIR), { recursive: true });

  /** @type {{ rel: string, wtAbs: string, target: string, state: string }[]} */
  const links = [];
  /** @type {string[]} */
  const copies = [];
  /** @type {string[]} */
  const absent = [];
  let snapshot = null;
  if (artefacts) {
    const plan = artefactPlan(mainRoot, wt);
    const snap = ensureSnapshot(mainRoot, plan.links);
    snapshot = snap.dir;
    log(`  snapshot      ${snap.dir}${snap.made ? ' (made now from main\'s copies)' : ' (shared)'}`);
    for (const link of plan.links) {
      const target = path.join(snap.dir, link.rel);
      if (!existsSync(target)) { absent.push(link.rel); continue; }
      junction(target, link.wtAbs);
      links.push({ rel: link.rel, wtAbs: link.wtAbs, target, state: 'linked' });
      log(`  ${link.rel.padEnd(13)} junction to the snapshot (read-only; local on first write)`);
    }
    for (const copy of plan.copies) {
      if (!existsSync(copy.mainAbs)) { absent.push(copy.rel); continue; }
      mkdirSync(path.dirname(copy.wtAbs), { recursive: true });
      if (statSync(copy.mainAbs).isDirectory()) cpSync(copy.mainAbs, copy.wtAbs, { recursive: true });
      else copyFileSync(copy.mainAbs, copy.wtAbs);
      copies.push(copy.rel);
      log(`  ${copy.rel.padEnd(13)} copied`);
    }
    for (const rel of absent) log(`  ${rel.padEnd(13)} absent in the main checkout: not provided (check:fast skips what needs it)`);
  }

  const guard = path.join(stateDir, 'write-guard.cjs');
  copyFileSync(GUARD_SOURCE, guard);
  const guardArg = `--require ${guard.split(path.sep).join('/')}`;
  // ${NODE_OPTIONS?} keeps options the caller set (npm otherwise replaces them).
  writeFileSync(path.join(wt, '.npmrc'), `node-options=${guardArg} \${NODE_OPTIONS?}\n`);
  const scratch = path.join(wt, SCRATCH_DIR);
  writeFileSync(path.join(stateDir, 'env.sh'), [
    '# source this for a direct `node` run in this worktree (npm run already loads the guard)',
    `export CIVGRAPH_SCRATCH='${scratch.split(path.sep).join('/')}'`,
    `export NODE_OPTIONS="${guardArg} \${NODE_OPTIONS:-}"`,
    '',
  ].join('\n'));
  writeState(wt, { name, branch, from: existing ? null : from, made: new Date().toISOString(), main: mainRoot, snapshot, links, copies, absent, scratch });
  log(`  scratch       ${scratch}`);
  log('  write guard   .npmrc preloads it for npm run; for a direct node run: source tmp/worktree/env.sh');
  const pruned = pruneSnapshots(mainRoot);
  if (pruned.length) log(`  pruned ${pruned.length} unused snapshot(s)`);
  return { path: wt, branch, links, copies, absent, scratch };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (/** @type {string} */ flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const name = args.find((a, i) => !a.startsWith('--') && !['--from', '--branch'].includes(args[i - 1]));
  if (!name) {
    console.error('usage: npm run worktree:new -- <name> [--from <ref>] [--branch <branch>] [--existing] [--no-artefacts]');
    process.exit(2);
  }
  try {
    createWorktree({ name, branch: value('--branch') || name, from: value('--from') || 'main', existing: args.includes('--existing'), artefacts: !args.includes('--no-artefacts') });
  } catch (error) {
    console.error(`FAIL: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
