/**
 * What feeds a publish's data, in one place: the records build (and so D1) and the Elections app's
 * R2 extracts, against code that only the push deploys.
 *
 * Three users:
 *   - the records build writes a manifest of its inputs (inputsManifest) beside the database, and
 *     the publish compares it with the inputs now (scripts/publish/records-freshness.mjs) to skip a
 *     build of exactly the same inputs;
 *   - the publish's code-only path (scripts/publish/publish-path.mjs) skips the build and the D1
 *     load when no file of the 'records' class changed since the last load;
 *   - npm run rebuild (scripts/build/rebuild-changed.mjs) runs the records chain only for 'records'
 *     changes.
 *
 * The classes:
 *   records   feeds the records build, the D1 load or the R2 extracts. Anything not listed as code
 *             is records: an unknown file costs a build, never a stale D1.
 *   code      deployed by the push alone: the site's pages and assets, the Pages Functions, the map
 *             app and UI packages, the checks, the docs, the dev tools.
 *   outside   an untracked file outside every folder the build reads (a stray download in the
 *             repository root): no code can read it, so it cannot change the data.
 *
 * Files under site/ that the build does read stay records: site/agent/ (the maps index is a
 * document of the load), site/assets/thumbnails/ (the Browse indexes read its manifest) and the
 * Elections app's config, census and embed data (the extracts and their upload read them).
 * The publish-inputs unit test walks the static imports of every records entry point and fails if
 * one of them is classed as code, and holds the data files classed as code to their only readers.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildVar, recordPaths, REPO_ROOT } from '@civgraph/config/node';

/** @typedef {'records' | 'code' | 'outside'} PublishInputClass */

/**
 * Files in the code areas below that the records build, the load or the extracts import or read:
 * records, though their folder is code. The unit test fails when an import reaches a code file not
 * listed here.
 */
export const READ_BY_BUILD = Object.freeze([
  /^packages\/map\/src\/(?:public-map\.mjs|cdn-url\.js|app\/url-compat\.mjs|ni-local-groups\.mjs|election-groups\.mjs|printed-labels\.mjs)$/,
  /^site\/pkg\//,
  /^scripts\/publish\/r2-env\.mjs$/,
]);

/** Tracked paths that only the push deploys. Everything else is records. */
export const CODE_ONLY = Object.freeze([
  // The site, less the files the build reads.
  /^site\/(?!agent\/|assets\/thumbnails\/|apps\/elections\/(?:config\.js$|census\/|embed\/|extracts\/))/,
  /^functions\//,
  /^packages\/(?:map|ui|api|types)\//,
  /^render\/src\//, /^render\/sw\.js$/,
  /^tests\//, /^docs\//, /^\.github\//, /^\.claude\//, /^tools\//,
  /^[^/]+\.md$/, /(?:^|\/)README\.md$/, /^(?:LICENSE|NOTICE|\.nvmrc|\.cfignore|eslint\.config\.mjs)$/,
  /^scripts\/check\//, /^scripts\/dev\//,
  // The publish scripts, less the Elections app's extract refresh and upload (R2).
  /^scripts\/publish\/(?!elections-app-)/,
  // Builders of the app bundle and the Pages output only.
  /^scripts\/build\/(?:app-bundle|shell-assets|promote-test2-root|site|build-site-partials|rebuild-changed|stamp-map-cache-tokens)\.mjs$/,
  // The package type-check projects (tsc -b, TS-4): only tsc reads them.
  /^packages\/[^/]+\/tsconfig\.[a-z.-]+\.json$/,
  /^config\/(?:playwright\.config\.cjs|tsconfig\.[a-z-]+\.json|architecture(?:-baseline)?\.json|boundaries\.json)$/,
  // Figures for the pages, read by nothing but their own builders (the unit test holds this).
  /^data\/database\/(?:site-stats|status)\.json$/,
]);

/** The folders the build can read: an untracked file elsewhere is 'outside'. */
export const RECORD_ROOTS = Object.freeze([
  'data/', 'render/metadata/', 'packages/', 'scripts/', 'src/', 'boundary-gazette/', 'migrations/',
  'site/agent/', 'site/assets/thumbnails/', 'site/apps/elections/',
]);

/**
 * The class of one repository-relative path (forward slashes).
 * @param {string} file
 * @param {{ tracked?: boolean }} [options]  tracked: false for an untracked file
 * @returns {PublishInputClass}
 */
export function publishInputClass(file, { tracked = true } = {}) {
  const f = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!READ_BY_BUILD.some((re) => re.test(f)) && CODE_ONLY.some((re) => re.test(f))) return 'code';
  if (!tracked && !RECORD_ROOTS.some((root) => f.startsWith(root))) return 'outside';
  return 'records';
}

/**
 * @typedef {{ path: string, blob: string, tracked: boolean }} InputFile  a path and its content's git blob id
 * @typedef {{ votes: 'built' | 'carried', seed: string }} BuildContext
 *   votes: built from CIVGRAPH_VOTES_DIR (checked against its committed pin) or carried over;
 *   seed: the stable-order seed's identity (the last-loaded snapshot's size and time), '' for none
 * @typedef {{ schema: 1, hash: string, files: number, votes: string, seed: string }} InputsManifest
 */

/**
 * The manifest of a build's inputs: a hash of every records-class file's content (by path), and
 * the context that changes the output without a file changing. It is content-addressed, so a
 * commit of the same working tree leaves it equal.
 * @param {InputFile[]} files
 * @param {BuildContext} context
 * @returns {InputsManifest}
 */
export function inputsManifest(files, context) {
  const kept = files.filter((f) => publishInputClass(f.path, { tracked: f.tracked }) === 'records').sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  for (const f of kept) h.update(`${f.path}\0${f.blob}\n`);
  return { schema: 1, hash: h.digest('hex').slice(0, 32), files: kept.length, votes: context.votes, seed: context.seed };
}

/**
 * Why two manifests differ, or [] when a build of the one serves the other.
 * @param {InputsManifest | null | undefined} built  the manifest the build wrote
 * @param {InputsManifest} now
 * @returns {string[]}
 */
export function manifestDifferences(built, now) {
  if (!built || built.schema !== now.schema) return ['no input manifest from the last build'];
  /** @type {string[]} */
  const out = [];
  if (built.hash !== now.hash) out.push(`the inputs changed (${built.files} -> ${now.files} records files, hash ${built.hash.slice(0, 8)} -> ${now.hash.slice(0, 8)})`);
  if (built.votes !== now.votes) out.push(`the votes were ${built.votes}, now they would be ${now.votes}`);
  if (built.seed !== now.seed) out.push('the stable-order seed (the last-loaded snapshot) changed since the build');
  return out;
}

// ------------------------------------------------------------------ the working tree

/**
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 */
function git(args, { cwd = REPO_ROOT, input } = {}) {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
}
const nulList = (/** @type {string} */ text) => text.split('\0').filter(Boolean);

/**
 * Every file of the working tree with its content's blob id: tracked files from the index, those
 * changed since (and untracked ones git does not ignore) hashed as they are on disk, deleted ones
 * left out. The same content gives the same list whether or not it is committed.
 * @param {string} [cwd]
 * @returns {InputFile[]}
 */
export function workingTreeFiles(cwd = REPO_ROOT) {
  /** @type {Map<string, InputFile>} */
  const files = new Map();
  for (const entry of nulList(git(['ls-files', '-s', '-z'], { cwd }))) {
    const tab = entry.indexOf('\t');
    const [, blob] = entry.slice(0, tab).split(' ');
    files.set(entry.slice(tab + 1), { path: entry.slice(tab + 1), blob: blob || '', tracked: true });
  }
  // One pass over the tree's stat data: D (deleted) or M/T (changed since the index), as status\0path.
  const changed = nulList(git(['diff-files', '--name-status', '-z'], { cwd }));
  /** @type {string[]} */
  const modified = [];
  for (let i = 0; i + 1 < changed.length; i += 2) {
    const [status, file] = /** @type {[string, string]} i + 1 is within changed */ ([changed[i], changed[i + 1]]);
    if (status === 'D') files.delete(file);
    else if (files.has(file)) modified.push(file);
  }
  const untracked = nulList(git(['ls-files', '-o', '--exclude-standard', '-z'], { cwd }));
  const all = [...new Set([...modified, ...untracked])];
  // hash-object reads one path per line; a name with a line break (none today) counts as changed.
  const toHash = all.filter((file) => !/[\r\n]/.test(file));
  const blobs = toHash.length ? git(['hash-object', '--stdin-paths'], { cwd, input: `${toHash.join('\n')}\n` }).trim().split(/\r?\n/) : [];
  const blobOf = new Map(toHash.map((file, i) => [file, blobs[i] || '']));
  for (const file of all) files.set(file, { path: file, blob: blobOf.get(file) || `unhashed:${Date.now()}`, tracked: files.has(file) });
  return [...files.values()];
}

/** The last-loaded snapshot of the remote publish: what D1 holds, and the build's order seed. */
export const LAST_LOADED = path.join(REPO_ROOT, '.claude', 'publish', 'work', 'last-loaded.sqlite');

/**
 * The identity of a file by size and modification time ('' when it is missing).
 * @param {string} file
 */
export function fileStamp(file) {
  if (!existsSync(file)) return '';
  const st = statSync(file);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

/**
 * The build context now: where the votes would come from and the order seed.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {BuildContext}
 */
export function buildContext(env = process.env) {
  return { votes: buildVar('CIVGRAPH_VOTES_DIR', env) ? 'built' : 'carried', seed: fileStamp(LAST_LOADED) };
}

/** The manifest of the inputs as they are now. @param {NodeJS.ProcessEnv} [env] */
export function currentInputsManifest(env = process.env) {
  return inputsManifest(workingTreeFiles(), buildContext(env));
}

/**
 * Where the records build keeps the manifest of the inputs it was built from.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function manifestFile(env = process.env) {
  const dir = recordPaths(env).BUILD_DIR;
  return dir ? path.join(dir, 'inputs-manifest.json') : null;
}

/**
 * @typedef {InputsManifest & { db: string, builtAt: string }} BuiltManifest
 *   db: the database file's stamp (fileStamp) when the manifest was written
 */

/** @param {NodeJS.ProcessEnv} [env] @returns {BuiltManifest | null} */
export function readBuiltManifest(env = process.env) {
  const file = manifestFile(env);
  if (!file || !existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Record that the database at `dbFile` was built from `manifest` (written after the database is in
 * place, through a rename, so a crash leaves the old manifest or none).
 * @param {InputsManifest} manifest @param {string} dbFile @param {NodeJS.ProcessEnv} [env]
 */
export function writeBuiltManifest(manifest, dbFile, env = process.env) {
  const file = manifestFile(env);
  if (!file) return;
  /** @type {BuiltManifest} */
  const built = { ...manifest, db: fileStamp(dbFile), builtAt: new Date().toISOString() };
  writeFileSync(`${file}.next`, `${JSON.stringify(built, null, 2)}\n`);
  renameSync(`${file}.next`, file);
}

/**
 * Whether the records build in place was built from exactly the inputs now: [] when it was, else
 * the reasons it was not.
 * @param {{ env?: NodeJS.ProcessEnv, dbFile: string, now?: InputsManifest }} options
 */
export function staleReasons({ env = process.env, dbFile, now = currentInputsManifest(env) }) {
  if (!existsSync(dbFile)) return ['no records build'];
  const built = readBuiltManifest(env);
  const reasons = manifestDifferences(built, now);
  if (built && !reasons.length && built.db !== fileStamp(dbFile)) reasons.push('the database file changed after the manifest was written');
  return reasons;
}

/** Remove the manifest (before the database it describes is replaced). @param {NodeJS.ProcessEnv} [env] */
export function clearBuiltManifest(env = process.env) {
  const file = manifestFile(env);
  if (file && existsSync(file)) rmSync(file, { force: true });
}
