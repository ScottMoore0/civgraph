/**
 * The worktree write guard: preloaded (node --require) into every node process npm starts in a
 * worktree made by npm run worktree:new, whose .npmrc names this file's copy in tmp/worktree/.
 *
 * Some of a worktree's folders are junctions to a shared, read-only snapshot of main's generated
 * artefacts (scripts/dev/worktree/lib.mjs). The first time a process writes, creates, renames or
 * deletes anything inside one of them, this turns that folder into a local copy (the snapshot's
 * files copied in, writable) before the call goes ahead, so the write lands in the worktree and
 * neither main's artefacts nor the snapshot other worktrees read is changed. The folder stays
 * local from then on (tmp/worktree/state.json records it).
 *
 * Outside a worktree made that way (no state.json beside this file) it does nothing. A process
 * started without it (node run directly, not through npm) is still kept off the snapshot by its
 * read-only files; `npm run worktree:own -- <folder>` makes a folder local by hand.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fileURLToPath } = require('node:url');

/** @typedef {{ rel: string, wtAbs: string, state?: string }} LinkState */
/** @typedef {{ links?: LinkState[] }} WorktreeState */
/** @typedef {(...args: unknown[]) => unknown} AnyFunction */

const STATE_FILE = path.join(__dirname, 'state.json');
// The unwrapped functions, for the guard's own writes.
const original = {
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  rmdirSync: fs.rmdirSync,
  renameSync: fs.renameSync,
};

/** @returns {WorktreeState | null} */
function readState() {
  try { return JSON.parse(original.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

const isWin = process.platform === 'win32';
/** @param {string} p */
const norm = (p) => (isWin ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * The path argument as a string, or null (a file descriptor or something else).
 * @param {unknown} p
 */
function asPath(p) {
  if (typeof p === 'string') return p;
  if (Buffer.isBuffer(p)) return p.toString();
  if (p instanceof URL && p.protocol === 'file:') return fileURLToPath(p);
  return null;
}

/** @param {string} p */
function isJunction(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** @param {number} ms */
const sleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * Copy a folder's files, writable, with robocopy (cpSync elsewhere).
 * @param {string} from
 * @param {string} to
 */
function copyWritable(from, to) {
  if (!isWin) {
    fs.cpSync(from, to, { recursive: true });
    for (const entry of fs.readdirSync(to, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) fs.chmodSync(path.join(entry.parentPath, entry.name), 0o644);
    }
    return;
  }
  const result = spawnSync('robocopy', [from, to, '/E', '/MT:16', '/A-:R', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'], { encoding: 'utf8' });
  if (result.status === null || result.status >= 8) throw new Error(`worktree write guard: copying ${from} failed (robocopy ${result.status})`);
}

/**
 * Turn a linked folder into a local copy, once, even with other processes racing for it.
 * @param {LinkState} link
 */
function makeLocal(link) {
  if (!isJunction(link.wtAbs)) return;
  const lock = `${link.wtAbs}.making-local`;
  try {
    original.mkdirSync(lock);
  } catch {
    // Another process is making it local: wait for it.
    for (let waited = 0; waited < 600_000 && isJunction(link.wtAbs) && fs.existsSync(lock); waited += 200) sleep(200);
    return;
  }
  try {
    if (!isJunction(link.wtAbs)) return;
    const target = fs.readlinkSync(link.wtAbs);
    const staging = `${link.wtAbs}.local-${process.pid}`;
    copyWritable(target, staging);
    original.rmdirSync(link.wtAbs); // removes the junction only
    original.renameSync(staging, link.wtAbs);
    const state = readState();
    if (state) {
      for (const entry of state.links || []) if (norm(entry.wtAbs) === norm(link.wtAbs)) entry.state = 'local';
      original.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 1)}\n`);
    }
    process.stderr.write(`[worktree] ${link.rel} is now a local folder of this worktree (copied from the shared read-only snapshot), because this process writes into it.\n`);
  } finally {
    try { original.rmdirSync(lock); } catch { /* already gone */ }
  }
}

/** The functions that change files, by name, with the positions of their path arguments. */
const PATH_ARGS = Object.freeze({
  writeFile: [0], appendFile: [0], copyFile: [1], cp: [1], rename: [0, 1], mkdir: [0], rm: [0], rmdir: [0],
  unlink: [0], truncate: [0], utimes: [0], chmod: [0], link: [1], symlink: [1],
});

function install() {
  const state = readState();
  if (!state || !Array.isArray(state.links) || !state.links.length) return;
  const links = state.links.map((link) => ({ ...link, key: norm(link.wtAbs) }));

  /**
   * Before a call that changes `p`: make the linked folder holding it local.
   * @param {unknown} p
   */
  const guard = (p) => {
    const str = asPath(p);
    if (str === null) return;
    const abs = norm(str);
    for (const link of links) {
      if (abs.startsWith(link.key + path.sep)) makeLocal(link);
    }
  };

  const WRITE_FLAGS = /[wa+]/;
  const O_WRITE = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
  /** @param {unknown[]} args */
  const opensForWriting = (args) => {
    const flags = args[1];
    return typeof flags === 'string' ? WRITE_FLAGS.test(flags) : typeof flags === 'number' ? (flags & O_WRITE) !== 0 : false;
  };

  /**
   * Replace target[name] with a function that guards the path arguments first.
   * @param {object} target
   * @param {string} name
   * @param {readonly number[]} argIndexes
   * @param {(args: unknown[]) => boolean} [when]
   */
  const wrap = (target, name, argIndexes, when) => {
    const table = /** @type {Record<string, unknown>} */ (target);
    const fn = table[name];
    if (typeof fn !== 'function') return;
    const call = /** @type {AnyFunction} */ (fn);
    /** @this {unknown} @param {unknown[]} args */
    const wrapped = function (...args) {
      if (!when || when(args)) for (const i of argIndexes) guard(args[i]);
      return call.apply(this, args);
    };
    Object.defineProperties(wrapped, Object.getOwnPropertyDescriptors(fn));
    table[name] = wrapped;
  };

  for (const [name, argIndexes] of Object.entries(PATH_ARGS)) {
    wrap(fs, name, argIndexes);
    wrap(fs, `${name}Sync`, argIndexes);
    wrap(fs.promises, name, argIndexes);
  }
  wrap(fs, 'open', [0], opensForWriting);
  wrap(fs, 'openSync', [0], opensForWriting);
  wrap(fs.promises, 'open', [0], opensForWriting);
  wrap(fs, 'createWriteStream', [0]);

  // ES modules import node:fs's named exports as live bindings of the CommonJS object.
  require('node:module').syncBuiltinESMExports();
}

// One guard per state file: a process may carry two (a test of the guard run inside a worktree).
const MARK = Symbol.for(`civgraph.worktreeWriteGuard:${norm(STATE_FILE)}`);
const registry = /** @type {Record<symbol, boolean>} */ (/** @type {unknown} */ (globalThis));
if (!registry[MARK]) {
  registry[MARK] = true;
  try {
    install();
  } catch (error) {
    process.stderr.write(`[worktree] the write guard could not start: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
