#!/usr/bin/env node
/**
 * Run the checks on a clean export, so local equals CI (site-restructure DESIGN.md 4.2, C1).
 *
 * `npm run check` passing on this disk proves little: many validators read gitignored build
 * output that exists here and on no clean checkout, and on 2026-09-19 five such failures
 * surfaced in CI one at a time. This reproduces CI's job instead:
 *
 *   1. export `git ls-files -co --exclude-standard` (tracked files plus new, non-ignored
 *      files: exactly what a commit would contain) into a temporary directory;
 *      and make it a one-commit git repository, as CI's checkout is (initExportRepo);
 *   2. give it a node_modules of links to this one's (junctions on Windows), rather than
 *      reinstalling, with the @civgraph workspace links pointing at the export's packages/;
 *   3. run the derived inputs CI builds (`npm run build`, the Pages build, the catalogue D1
 *      import and the records database with its tests), then the offline check chain
 *      (scripts/check/run.mjs, with any arguments given here passed through);
 *   4. remove those links BEFORE deleting the directory, so the delete can never reach
 *      the real node_modules through a link (memory note feedback_worktree_junction.md).
 *
 *   node scripts/check/clean.mjs                    build, then every offline check
 *   node scripts/check/clean.mjs --only check:dir-names,check:doc-paths
 *   node scripts/check/clean.mjs --keep             leave the export for inspection
 *   node scripts/check/clean.mjs --no-build         skip step 3's builds
 *   node scripts/check/clean.mjs --in-place         steps 3 only, in this tree: for CI, whose
 *                                                   checkout is already clean (npm run check:ci)
 *
 * Offline, like `npm run check`; network checks are under `npm run verify`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeShadow, removeShadow } from '../lib/node-modules-links.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The builds CI runs before the checks, in order. Keep in step with .github/workflows/ci.yml. */
export const BUILD_STEPS = [
  ['npm', ['run', 'build']],
  // The records database (data design phase 2): the election, Browse and graph trees the
  // checks read are no longer tracked; this writes them to tmp/records, then records:check
  // tests the database itself. Without CIVGRAPH_VOTES_DIR the votes tables stay empty.
  ['npm', ['run', 'records:build', '--', '--no-source-checks']],
  ['npm', ['run', 'records:check']],
];

export function parseArgs(argv) {
  const opts = { keep: false, build: true, inPlace: false, passthrough: [] };
  for (const a of argv) {
    if (a === '--keep') opts.keep = true;
    else if (a === '--no-build') opts.build = false;
    else if (a === '--in-place') opts.inPlace = true;
    else opts.passthrough.push(a);
  }
  return opts;
}

/** What a commit would contain: tracked plus untracked-but-not-ignored paths that exist. */
export function listExportFiles(root) {
  const res = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 1 << 28 });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return res.stdout.toString('utf8').split('\0').filter(Boolean)
    .filter((rel) => !rel.startsWith('node_modules/'))
    .filter((rel) => existsSync(path.join(root, rel)));
}

export function exportTree(root, dest, files) {
  for (const rel of files) {
    const target = path.join(dest, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, rel), target);
  }
}

/**
 * Make the export a git repository holding exactly the exported files in one commit, as CI's
 * checkout is: records:build hashes its inputs with git ls-files and records the commit, and
 * check:pages-assets (scripts/build/site.mjs) asks git which files are tracked. Without this every git call in
 * the chain fails with "not a git repository" (exit 128), which CI never sees.
 */
export function initExportRepo(dest) {
  const git = (gitArgs) => {
    const res = spawnSync('git', gitArgs, { cwd: dest, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (res.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed in the export: ${res.stderr}`);
  };
  git(['init', '-q']);
  git(['-c', 'core.autocrlf=false', 'add', '-A']);
  git(['-c', 'user.name=check-clean', '-c', 'user.email=check-clean@localhost', 'commit', '-q', '-m', 'clean export']);
}

/**
 * Give the export its own node_modules: links to `source`'s entries, with the @civgraph workspace
 * links pointing at the EXPORT's packages/ (scripts/lib/node-modules-links.mjs), so the checks run
 * the exported packages, not this checkout's. Returns the export's node_modules folder.
 * @param {string} source
 * @param {string} dest
 */
export function linkNodeModules(source, dest) {
  return makeShadow(source, dest).dir;
}

/**
 * Remove the export's node_modules: its links first, never what they point at. Refuses a folder
 * holding a real subfolder (only links and copied files are expected).
 * @param {string} link  the export's node_modules folder
 */
export function unlinkNodeModules(link) {
  removeShadow(path.dirname(link));
  if (existsSync(link)) throw new Error(`${link} is still there after unlinking`);
}

function run(cmd, args, cwd) {
  const shown = `${cmd} ${args.join(' ')}`;
  console.log(`\n$ ${shown}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return res.status === 0;
}

/** Steps 3: the builds, then the offline checks, in `cwd`. */
function buildAndCheck(cwd, opts) {
  if (opts.build) {
    for (const [cmd, args] of BUILD_STEPS) if (!run(cmd, args, cwd)) return false;
  }
  return run('node', ['scripts/check/run.mjs', ...opts.passthrough], cwd);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.inPlace) {
    const ok = buildAndCheck(ROOT, opts);
    console.log(ok ? '\nCHECKS OK (in place)' : '\nCHECKS FAILED (in place)');
    return ok ? 0 : 1;
  }
  const modules = path.join(ROOT, 'node_modules');
  if (!existsSync(modules)) {
    console.error('check-clean: no node_modules here; run npm ci first.');
    return 1;
  }
  const dest = mkdtempSync(path.join(os.tmpdir(), 'civgraph-check-clean-'));
  let link = null;
  let ok = false;
  try {
    const files = listExportFiles(ROOT);
    console.log(`Exporting ${files.length} files to ${dest}`);
    exportTree(ROOT, dest, files);
    initExportRepo(dest);
    link = linkNodeModules(modules, dest);
    ok = buildAndCheck(dest, opts);
  } finally {
    if (link) unlinkNodeModules(link);
    if (opts.keep) console.log(`\nKept the export at ${dest} (node_modules unlinked).`);
    else rmSync(dest, { recursive: true, force: true });
  }
  console.log(ok ? '\nCLEAN-EXPORT CHECKS OK' : '\nCLEAN-EXPORT CHECKS FAILED');
  return ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
