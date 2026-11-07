// @ts-check
/**
 * Working-tree capture for ingest plugins: run an existing script as it has always run (in
 * the repository, writing where it always wrote), then take what it changed into a batch's
 * staged/ folder and put the repository back as it was. The script is untouched; the intake
 * CLI's `stage --write` puts the captured files back. So a plugin's batch holds exactly what
 * the old script wrote.
 *
 * What counts as changed:
 *   - every path `git status` reports after the run that it did not report before, or whose
 *     bytes differ from before (tracked edits and new untracked files, found automatically);
 *   - every declared output (gitignored files git cannot see: FGBs, data/census/derived/...)
 *     whose bytes differ from before or which is new. A declared output ending in "/" is a
 *     folder: every file under it.
 * Deletions are reported, never captured (a batch cannot express them).
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @param {string} file */
export const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * @param {string} repo
 * @param {string[]} args
 */
function gitOut(repo, args) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout;
}

/**
 * Paths `git status` reports (tracked changes and untracked files, one by one).
 * @param {string} repo
 * @returns {Set<string>}
 */
export function dirtyPaths(repo) {
  const out = new Set();
  const parts = gitOut(repo, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames']).split('\0');
  for (const entry of parts) {
    if (entry.length < 4) continue;
    out.add(entry.slice(3));
  }
  return out;
}

/**
 * Files a declared output names, repository-relative and POSIX.
 * @param {string} repo
 * @param {string[]} outputs
 */
export function expandOutputs(repo, outputs) {
  const files = new Set();
  for (const o of outputs) {
    const full = path.join(repo, o);
    if (o.endsWith('/')) {
      if (!existsSync(full)) continue;
      /** @param {string} d */
      const walk = (d) => {
        for (const name of readdirSync(d)) {
          const f = path.join(d, name);
          if (statSync(f).isDirectory()) walk(f);
          else files.add(path.relative(repo, f).split(path.sep).join('/'));
        }
      };
      walk(full);
    } else files.add(o);
  }
  return files;
}

/**
 * @typedef {object} Snapshot
 * @property {string} repo
 * @property {string[]} outputs
 * @property {Set<string>} dirty          what git reported before the run
 * @property {Map<string, string | null>} saved   path -> copy of its bytes before the run, or null when absent
 * @property {string} tmp
 */

/**
 * Record the state a run will be compared with and restored to.
 * @param {string} repo
 * @param {{ outputs?: string[] }} [options]
 * @returns {Snapshot}
 */
export function snapshot(repo, { outputs = [] } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'intake-capture-'));
  const dirty = dirtyPaths(repo);
  /** @type {Map<string, string | null>} */
  const saved = new Map();
  let n = 0;
  /** @param {string} rel */
  const save = (rel) => {
    if (saved.has(rel)) return;
    const full = path.join(repo, rel);
    if (existsSync(full) && statSync(full).isFile()) {
      const copy = path.join(tmp, String(n += 1));
      copyFileSync(full, copy);
      saved.set(rel, copy);
    } else saved.set(rel, null);
  };
  for (const rel of dirty) save(rel);
  for (const rel of expandOutputs(repo, outputs)) save(rel);
  return { repo, outputs, dirty, saved, tmp };
}

/**
 * What a run changed since the snapshot.
 * @param {Snapshot} snap
 * @returns {{ changed: string[], deleted: string[] }}
 */
export function changesSince(snap) {
  const { repo } = snap;
  const candidates = new Set([...dirtyPaths(repo), ...snap.dirty, ...expandOutputs(repo, snap.outputs), ...snap.saved.keys()]);
  const changed = [];
  const deleted = [];
  for (const rel of [...candidates].sort()) {
    const full = path.join(repo, rel);
    const nowExists = existsSync(full) && statSync(full).isFile();
    const before = snap.saved.get(rel);
    if (before === undefined) {
      // Not dirty before and not a declared output: git sees it now, so the run made it dirty.
      if (nowExists) changed.push(rel);
      else deleted.push(rel);
      continue;
    }
    if (before === null) { if (nowExists) changed.push(rel); continue; }
    if (!nowExists) { deleted.push(rel); continue; }
    if (sha256File(before) !== sha256File(full)) changed.push(rel);
  }
  return { changed, deleted };
}

/**
 * Put every path a run touched back as the snapshot found it.
 * @param {Snapshot} snap
 * @param {string[]} paths
 */
export function restore(snap, paths) {
  const { repo } = snap;
  const fromIndex = [];
  for (const rel of paths) {
    const full = path.join(repo, rel);
    const before = snap.saved.get(rel);
    if (typeof before === 'string') {
      mkdirSync(path.dirname(full), { recursive: true });
      copyFileSync(before, full);
    } else if (before === null) {
      if (existsSync(full)) unlinkSync(full);
    } else fromIndex.push(rel);
  }
  if (fromIndex.length) {
    const tracked = new Set(gitOut(repo, ['ls-files', '-z', '--', ...fromIndex]).split('\0').filter(Boolean));
    const checkout = fromIndex.filter((p) => tracked.has(p));
    for (let i = 0; i < checkout.length; i += 200) gitOut(repo, ['checkout', '--', ...checkout.slice(i, i + 200)]);
    for (const rel of fromIndex) if (!tracked.has(rel) && existsSync(path.join(repo, rel))) unlinkSync(path.join(repo, rel));
  }
}

/** @param {Snapshot} snap */
export function dispose(snap) {
  rmSync(snap.tmp, { recursive: true, force: true });
}

/**
 * Hashes of the given repository paths as they are now ('absent' when missing).
 * @param {string} repo
 * @param {Iterable<string>} paths
 */
export function hashPaths(repo, paths) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const rel of paths) {
    const full = path.join(repo, rel);
    out.set(rel, existsSync(full) && statSync(full).isFile() ? sha256File(full) : 'absent');
  }
  return out;
}
