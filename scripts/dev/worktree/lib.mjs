/**
 * Shared parts of the worktree tools (npm run worktree:new, worktree:remove, worktree:own) and
 * the landing queue (npm run land). Settings: config/worktrees.json.
 *
 * A worktree is <parent of the main checkout>/civgraph-<name>, on its own branch. Its node_modules
 * is its own folder of junctions to the main checkout's entries, except the @civgraph workspace
 * links, which point at the worktree's own packages/ (scripts/lib/node-modules-links.mjs). Main's untracked generated artefacts reach it two ways:
 *
 *   links   folders joined by a directory junction to a SNAPSHOT: a read-only copy of main's
 *           folders, taken once and shared by every worktree (<parent>/civgraph-artefacts/<fp>/,
 *           where <fp> fingerprints main's copies, so a snapshot is reused until main rebuilds).
 *           Never main's own folders: whatever a worktree does through a junction can reach
 *           the snapshot at most. The snapshot's files are read-only, so a write that slips past
 *           the guard fails (EPERM) instead of changing what other worktrees read.
 *   copies  small files and folders copied into the worktree (ordinary builds rewrite them).
 *
 * The write guard (write-guard.cjs, preloaded into every node process that npm starts in the
 * worktree by the worktree's .npmrc) turns a linked folder into a local copy on the first write
 * into it, so a build in a worktree writes to the worktree. tmp/worktree/state.json records
 * what was linked and copied; tmp/scratch is the worktree's own scratch folder.
 *
 * Removing a worktree removes every junction in it first: `git worktree remove --force` follows a
 * junction and deletes what it points at (it once emptied main's node_modules).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_PATHS, recordPaths, REPO_ROOT } from '../../../packages/config/src/node.mjs';
import { artefactPath } from '../../lib/artefact-refs.mjs';

/** @typedef {{ records?: string, repo?: string, file?: string }} ArtefactRef */
/** @typedef {{ rel: string, mainAbs: string, wtAbs: string, state?: string }} LinkEntry */
/** @typedef {{ path: string, head?: string, branch?: string, detached?: boolean }} WorktreeInfo */

export const CONFIG = JSON.parse(readFileSync(path.join(REPO_ROOT, 'config', 'worktrees.json'), 'utf8'));

/** The worktree's own record of its artefacts and scratch, under its tmp folder. */
export const STATE_DIR = `${REPO_PATHS.tmp}/worktree`;
export const SCRATCH_DIR = `${REPO_PATHS.tmp}/scratch`;
export const GUARD_SOURCE = path.join(REPO_ROOT, 'scripts', 'dev', 'worktree', 'write-guard.cjs');

/**
 * Run git; throws with its stderr unless allowFail.
 * @param {string[]} args
 * @param {{ cwd?: string, allowFail?: boolean, env?: NodeJS.ProcessEnv }} [options]
 */
export function git(args, { cwd = REPO_ROOT, allowFail = false, env } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.join(' ')} (in ${cwd}) failed:\n${(result.stderr || result.stdout || '').trim()}`);
  }
  return { status: result.status ?? 1, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

/**
 * `git worktree list --porcelain`, parsed. The first entry is the main checkout.
 * @param {string} porcelain
 * @returns {WorktreeInfo[]}
 */
export function parseWorktreeList(porcelain) {
  /** @type {WorktreeInfo[]} */
  const out = [];
  /** @type {WorktreeInfo | null} */
  let current = null;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = { path: path.resolve(line.slice('worktree '.length)) };
      out.push(current);
    } else if (current && line.startsWith('HEAD ')) current.head = line.slice(5);
    else if (current && line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (current && line === 'detached') current.detached = true;
  }
  return out;
}

/** Every worktree of the repository, the main checkout first. */
export function listWorktrees() {
  return parseWorktreeList(git(['worktree', 'list', '--porcelain']).stdout);
}

/** The main checkout (the repository's first worktree). */
export function mainCheckout() {
  return listWorktrees()[0].path;
}

/** Case-insensitive on Windows. @param {string} a @param {string} b */
export const samePath = (a, b) => (process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b));

/** True when `child` is `parent` or inside it. @param {string} child @param {string} parent */
export function isInside(child, parent) {
  const norm = (/** @type {string} */ p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/** A worktree name: lower-case letters, digits and hyphens. @param {string} name */
export function checkName(name) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(name || ''))) {
    throw new Error(`worktree name "${name}": use lower-case letters, digits and hyphens`);
  }
  return name;
}

/** Where worktree <name> lives: beside the main checkout. @param {string} name */
export const worktreePath = (name) => path.join(path.dirname(mainCheckout()), `civgraph-${checkName(name)}`);

/** True when `dir` is a linked worktree (its .git is a file, not a folder). @param {string} dir */
export function isLinkedWorktree(dir) {
  try { return statSync(path.join(dir, '.git')).isFile(); } catch { return false; }
}

/**
 * The repository-relative path of an artefact reference (config/worktrees.json).
 * @param {ArtefactRef} ref
 */
export function artefactRel(ref) {
  const abs = artefactPath(ref, /** @type {Record<string, string | null>} */ (recordPaths()), REPO_ROOT);
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/**
 * The artefacts a worktree takes from main, with their places in each checkout.
 * @param {string} mainRoot
 * @param {string} wtRoot
 */
export function artefactPlan(mainRoot, wtRoot) {
  const at = (/** @type {ArtefactRef} */ ref) => {
    const rel = artefactRel(ref);
    return { rel, mainAbs: path.join(mainRoot, rel), wtAbs: path.join(wtRoot, rel) };
  };
  return {
    links: /** @type {ArtefactRef[]} */ (CONFIG.artefacts.links).map(at),
    copies: /** @type {ArtefactRef[]} */ (CONFIG.artefacts.copies).map(at),
  };
}

/**
 * The files under `dir`, as [relative path, size, mtime] rows, sorted. A link is not followed.
 * @param {string} dir
 * @returns {Array<[string, number, number]>}
 */
export function fileRows(dir) {
  /** @type {Array<[string, number, number]>} */
  const rows = [];
  const walk = (/** @type {string} */ abs, /** @type {string} */ rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) {
        const st = statSync(childAbs);
        rows.push([childRel, st.size, Math.round(st.mtimeMs)]);
      }
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * A fingerprint of main's linked folders: names, sizes and modification times of every file.
 * @param {LinkEntry[]} links
 */
export function fingerprint(links) {
  const hash = createHash('sha256');
  for (const link of links) hash.update(`${link.rel}\n${JSON.stringify(fileRows(link.mainAbs))}\n`);
  return hash.digest('hex').slice(0, 16);
}

/** Where the snapshots live. @param {string} mainRoot */
export const snapshotRoot = (mainRoot) => path.join(path.dirname(mainRoot), CONFIG.artefacts.snapshotDir);

/**
 * Copy a folder with robocopy (fast, many files). readOnly marks every copied file read-only.
 * @param {string} from
 * @param {string} to
 * @param {{ readOnly?: boolean, writable?: boolean }} [options]
 */
export function copyFolder(from, to, { readOnly = false, writable = false } = {}) {
  mkdirSync(to, { recursive: true });
  if (process.platform !== 'win32') {
    cpSync(from, to, { recursive: true });
    return;
  }
  const args = [from, to, '/E', '/MT:16', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'];
  if (readOnly) args.push('/A+:R');
  if (writable) args.push('/A-:R');
  const result = spawnSync('robocopy', args, { encoding: 'utf8' });
  // robocopy's exit codes below 8 mean success (1: files copied, 0: nothing to copy).
  if (result.status === null || result.status >= 8) throw new Error(`robocopy ${from} -> ${to} failed (${result.status}): ${(result.stdout || '').trim().slice(0, 400)}`);
}

/**
 * The snapshot of main's linked folders, made if main's copies changed since the last one.
 * Built in a .partial folder and renamed into place, so a half-made snapshot is never used.
 * @param {string} mainRoot
 * @param {LinkEntry[]} links
 * @returns {{ dir: string, made: boolean, missing: string[] }}
 */
export function ensureSnapshot(mainRoot, links) {
  const present = links.filter((link) => existsSync(link.mainAbs));
  const missing = links.filter((link) => !existsSync(link.mainAbs)).map((link) => link.rel);
  const fp = fingerprint(present);
  const root = snapshotRoot(mainRoot);
  const dir = path.join(root, fp);
  if (existsSync(path.join(dir, '.complete'))) return { dir, made: false, missing };
  const partial = `${dir}.partial-${process.pid}`;
  rmSync(partial, { recursive: true, force: true });
  for (const link of present) copyFolder(link.mainAbs, path.join(partial, link.rel), { readOnly: true });
  if (fingerprint(present) !== fp) {
    rmSync(partial, { recursive: true, force: true });
    throw new Error("main's artefacts changed while they were being copied (a build is running in the main checkout?); try again when it has finished");
  }
  writeFileSync(path.join(partial, '.complete'), `${JSON.stringify({ made: new Date().toISOString(), from: mainRoot, links: present.map((l) => l.rel) }, null, 1)}\n`);
  try {
    renameSync(partial, dir);
  } catch (error) {
    // Another worktree:new made the same snapshot at the same time: use theirs.
    rmSync(partial, { recursive: true, force: true });
    if (!existsSync(path.join(dir, '.complete'))) throw error;
  }
  return { dir, made: true, missing };
}

/**
 * Join `linkPath` to `target` by a directory junction.
 * @param {string} target
 * @param {string} linkPath
 */
export function junction(target, linkPath) {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, 'junction');
}

/** True when `p` is a junction or symbolic link. @param {string} p */
export function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/**
 * Every junction and symbolic link under `root` (not followed into), .git excepted.
 * @param {string} root
 * @returns {string[]}
 */
export function findLinks(root) {
  /** @type {string[]} */
  const found = [];
  const walk = (/** @type {string} */ dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) found.push(abs);
      else if (entry.isDirectory() && !(dir === root && entry.name === '.git')) walk(abs);
    }
  };
  walk(root);
  return found;
}

/**
 * Remove a junction or symbolic link, never what it points at.
 * @param {string} p
 */
export function removeLink(p) {
  if (!isLink(p)) throw new Error(`${p} is not a link; refusing to remove it`);
  try { rmdirSync(p); } catch { unlinkSync(p); }
  if (existsSync(p) || isLink(p)) throw new Error(`could not remove the link ${p}`);
}

/** The number of entries in a folder (0 when it is absent). @param {string} dir */
export function countEntries(dir) {
  try { return readdirSync(dir).length; } catch { return 0; }
}

/**
 * Read a worktree's state (tmp/worktree/state.json), or null.
 * @param {string} wtRoot
 */
export function readState(wtRoot) {
  const file = path.join(wtRoot, STATE_DIR, 'state.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * @param {string} wtRoot
 * @param {object} state
 */
export function writeState(wtRoot, state) {
  const dir = path.join(wtRoot, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(state, null, 1)}\n`);
}

/**
 * Delete the snapshots no worktree links to any more, keeping the newest.
 * @param {string} mainRoot
 * @returns {string[]} the snapshots removed
 */
export function pruneSnapshots(mainRoot) {
  const root = snapshotRoot(mainRoot);
  if (!existsSync(root)) return [];
  const inUse = new Set();
  for (const wt of listWorktrees()) {
    const state = readState(wt.path);
    if (state?.snapshot) inUse.add(path.resolve(state.snapshot).toLowerCase());
  }
  const snaps = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ dir: path.join(root, e.name), mtime: statSync(path.join(root, e.name)).mtimeMs, partial: e.name.includes('.partial-') }))
    .sort((a, b) => b.mtime - a.mtime);
  const newest = snaps.find((s) => !s.partial);
  /** @type {string[]} */
  const removed = [];
  for (const snap of snaps) {
    if (snap === newest || inUse.has(snap.dir.toLowerCase())) continue;
    // A partial snapshot younger than an hour may still be being made.
    if (snap.partial && Date.now() - snap.mtime < 3600_000) continue;
    rmSync(snap.dir, { recursive: true, force: true });
    removed.push(snap.dir);
  }
  return removed;
}

/**
 * The publish runs now: processes whose command line runs publish.sh (config/worktrees.json
 * landing.publishCommand). Only this process's own command line is left out.
 * @returns {string[]} "pid command" lines
 */
export function runningPublishes() {
  const pattern = new RegExp(CONFIG.landing.publishCommand);
  /** @type {Array<{ pid: number, cmd: string }>} */
  let rows = [];
  if (process.platform === 'win32') {
    const ps = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (ps.status !== 0) throw new Error(`could not list processes to look for a running publish: ${(ps.stderr || '').trim()}`);
    rows = ps.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      return { pid: Number(line.slice(0, tab)), cmd: line.slice(tab + 1) };
    });
  } else {
    const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    rows = ps.stdout.split('\n').filter(Boolean).map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      return { pid: Number(m?.[1]), cmd: m?.[2] || '' };
    });
  }
  return rows.filter((row) => row.pid !== process.pid && row.pid !== process.ppid && pattern.test(row.cmd))
    .map((row) => `${row.pid} ${row.cmd.slice(0, 160)}`);
}

/**
 * Run an npm script in a checkout; returns its exit code and the tail of its output.
 * @param {string} cwd
 * @param {{ npm: string, env?: Record<string, string>, args?: string[] }} step
 */
export function runNpm(cwd, step) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // One command string: npm.cmd needs a shell on Windows, and the words come from config/worktrees.json.
  const command = [npm, 'run', '-s', step.npm, ...(step.args?.length ? ['--', ...step.args] : [])].join(' ');
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true, env: { ...process.env, ...(step.env || {}) }, maxBuffer: 256 * 1024 * 1024 });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { code: result.status ?? 1, tail: output.split(/\r?\n/).slice(-30).join('\n') };
}
