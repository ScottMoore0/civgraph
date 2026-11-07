// @ts-check
/**
 * Ingest plugins: the produce side of the intake framework (refactor plan section 9, IP-1).
 *
 * One plugin per source, at scripts/ingest/<source>/plugin.mjs:
 *
 *   import { definePlugin } from '../../intake/lib/plugins.mjs';
 *   export default definePlugin({
 *     id: '<source>', title, kinds: ['maps'], personalData: { contains: false, handling: 'none' },
 *     sources: [{ id, title, publisher, url, rights, licence }],
 *     inputs: { gazetteDir: { env: 'CIVGRAPH_GAZETTE_DIR', description } },
 *     steps: { '<step>': { title, argv: ['python', 'scripts/ingest/<source>/x.py', '{input:gazetteDir}'],
 *                          outputs: ['data/maps/x.fgb'], network: false } },
 *     helpers: ['common.py'],        // modules the steps import
 *     research: ['probe.mjs'],       // tools that write nothing the site uses
 *   });
 *
 * A plugin produces a batch in one of three ways:
 *   - steps: the source's existing scripts, run unchanged; what they write is captured into the
 *     batch's staged/ folder and the repository put back (lib/capture.mjs), or written straight
 *     there when an argument is `{out:<repo path>}`;
 *   - produce(ctx): a function returning { staged: [{ path, content | from }], operations, notes };
 *   - command: ['python', 'scripts/ingest/<source>/run.py'], the bridge for Python: it receives
 *     the context as JSON on stdin and prints the same result as JSON on stdout.
 * Either way `intake run <plugin> <batch-dir>` writes batch.json (status draft) with a copy-files
 * operation for the staged files plus any operations the plugin adds, and the existing commands
 * (validate, plan, stage, upload, post-upload, report) take over. A new source is one folder.
 *
 * Argument placeholders: {repo} the repository root, {out:<repo path>} that path (in the batch's
 * staged/ under `intake run`, in the repository under `parity`'s old run), {input:<name>} a
 * declared input (from --input name=value, else its environment variable, else its default).
 * Network steps run only with --allow-network; nothing here fetches on its own.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changesSince, dispose, hashPaths, restore, sha256File, snapshot } from './capture.mjs';

/** @typedef {'maps' | 'elections' | 'persons' | 'parties' | 'sources' | 'catalogue' | 'census' | 'votes' | 'interests' | 'contribution' | 'research-only'} Kind */
export const KINDS = Object.freeze(['maps', 'elections', 'persons', 'parties', 'sources', 'catalogue', 'census', 'votes', 'interests', 'contribution', 'research-only']);
const RIGHTS = new Set(['OGL', 'CC-BY', 'CC-BY-SA', 'public-domain', 'facts-with-citation', 'owner-permission', 'unknown']);
const HANDLING = new Set(['none', 'names-only', 'addresses-to-census-unit', 'private-not-published']);
const PROGRAMS = new Set(['node', 'python', 'bash', 'powershell']);
const ID = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @typedef {object} Step
 * @property {string} title
 * @property {string[]} argv            program (node, python, bash or powershell) and its arguments
 * @property {string[]} [outputs]       repository paths it writes that git cannot see (gitignored); "dir/" for a folder
 * @property {boolean} [network]        it fetches from outside; refused without --allow-network
 * @property {string[]} [needs]         repository paths it reads that may be missing from a checkout (for `plugins --check`)
 * @property {Record<string, string>} [env]
 * @property {string[]} [volatile]      JSON keys that hold the run's own time (generatedAt...): parity ignores them
 * @property {string} [note]
 */

/**
 * @typedef {object} PluginSource
 * @property {string} id
 * @property {string} title
 * @property {string} [publisher]
 * @property {string} [url]
 * @property {string} [licence]
 * @property {'OGL' | 'CC-BY' | 'CC-BY-SA' | 'public-domain' | 'facts-with-citation' | 'owner-permission' | 'unknown'} [rights]
 * @property {string} [citation]
 * @property {string} [note]
 */

/**
 * @typedef {object} ProduceContext
 * @property {string} repo
 * @property {string} batchDir
 * @property {string} stagedDir
 * @property {string[]} steps
 * @property {string[]} args
 * @property {Record<string, string>} inputs
 */

/**
 * @typedef {object} ProduceResult
 * @property {{ path: string, content?: string, from?: string }[]} [staged]
 * @property {object[]} [operations]
 * @property {string[]} [notes]
 */

/**
 * @typedef {object} PluginDefinition
 * @property {string} id
 * @property {string} title
 * @property {Kind[]} kinds
 * @property {{ contains: boolean, handling?: string, note?: string }} personalData
 * @property {PluginSource[]} sources
 * @property {Record<string, { env?: string, default?: string, description?: string }>} [inputs]
 * @property {Record<string, Step>} [steps]
 * @property {(ctx: ProduceContext) => ProduceResult | Promise<ProduceResult>} [produce]
 * @property {string[]} [command]
 * @property {string[]} [helpers]
 * @property {string[]} [research]
 * @property {string[]} [data]          non-script files kept in the folder (search lists, configs)
 * @property {string} [note]
 */

/**
 * @typedef {PluginDefinition & { file?: string, folder?: string }} Plugin
 */

/**
 * Check a plugin's shape and freeze it. Throws with every problem at once.
 * @param {PluginDefinition} def
 * @returns {Readonly<PluginDefinition>}
 */
export function definePlugin(def) {
  const problems = pluginProblems(def);
  if (problems.length) throw new Error(`plugin ${def?.id || '?'}:\n  ${problems.join('\n  ')}`);
  return Object.freeze({ ...def });
}

/** @param {any} def */
export function pluginProblems(def) {
  const p = [];
  if (!def || typeof def !== 'object') return ['not an object'];
  if (!ID.test(def.id || '')) p.push('id must be lower case letters, digits and hyphens');
  if (typeof def.title !== 'string' || def.title.length < 5) p.push('title is required');
  if (!Array.isArray(def.kinds) || !def.kinds.length) p.push('kinds is required');
  else for (const k of def.kinds) if (!KINDS.includes(k)) p.push(`unknown kind ${k}`);
  const pd = def.personalData;
  if (!pd || typeof pd.contains !== 'boolean') p.push('personalData.contains is required');
  else {
    if (pd.handling && !HANDLING.has(pd.handling)) p.push(`unknown personalData.handling ${pd.handling}`);
    if (pd.contains && (!pd.handling || pd.handling === 'none')) p.push('personalData.contains is true, so handling must say how');
  }
  if (!Array.isArray(def.sources) || !def.sources.length) p.push('at least one source is required');
  else {
    for (const s of def.sources) {
      if (!ID.test(s?.id || '')) p.push(`source id ${s?.id} is not an id`);
      if (!s?.title) p.push(`source ${s?.id}: title is required`);
      if (s?.rights && !RIGHTS.has(s.rights)) p.push(`source ${s.id}: unknown rights ${s.rights}`);
    }
  }
  const ways = ['steps', 'produce', 'command'].filter((k) => def[k] !== undefined);
  if (ways.length > 1) p.push(`give exactly one of steps, produce, command (got ${ways.join(', ')})`);
  if (!ways.length && !(Array.isArray(def.kinds) && def.kinds.length === 1 && def.kinds[0] === 'research-only')) p.push('give exactly one of steps, produce, command (a plugin with none is kinds: ["research-only"])');
  if (def.produce !== undefined && typeof def.produce !== 'function') p.push('produce must be a function');
  if (def.command !== undefined && (!Array.isArray(def.command) || !PROGRAMS.has(def.command[0]) || !def.command[1])) p.push('command must be [node|python|bash, script, ...]');
  if (def.steps !== undefined) {
    if (!def.steps || typeof def.steps !== 'object' || !Object.keys(def.steps).length) p.push('steps must name at least one step');
    else {
      for (const [name, st] of Object.entries(def.steps)) {
        if (!ID.test(name)) p.push(`step ${name}: not an id`);
        if (!st || typeof st.title !== 'string') p.push(`step ${name}: title is required`);
        if (!Array.isArray(st?.argv) || st.argv.length < 2 || !PROGRAMS.has(st.argv[0])) p.push(`step ${name}: argv must be [node|python|bash|powershell, script, ...]`);
        else if (!/^scripts\//.test(st.argv[1])) p.push(`step ${name}: the script must be under scripts/`);
        for (const o of st?.outputs || []) if (!/^(?![A-Za-z]:|\/|\\)(?!.*(^|\/)\.\.(\/|$)).+$/.test(o)) p.push(`step ${name}: output ${o} is not a repository path`);
        for (const a of st?.argv || []) {
          const m = /^\{input:([^}]+)\}$/.exec(a) || /\{input:([^}]+)\}/.exec(a);
          if (m && !def.inputs?.[m[1]]) p.push(`step ${name}: uses undeclared input ${m[1]}`);
        }
        if (/@[a-z0-9-]+\.[a-z]{2,}/i.test((st?.argv || []).join(' '))) p.push(`step ${name}: argv carries what looks like an email address`);
      }
    }
  }
  for (const k of ['helpers', 'research', 'data']) if (def[k] !== undefined && !Array.isArray(def[k])) p.push(`${k} must be a list of file names`);
  return p;
}

/** @param {string} repo */
export const ingestRoot = (repo) => path.join(repo, 'scripts', 'ingest');

/**
 * Every plugin under scripts/ingest/*\/plugin.mjs, loaded. Folders without one are listed too.
 * @param {string} repo
 * @returns {Promise<{ plugins: Plugin[], without: string[], errors: string[] }>}
 */
export async function discoverPlugins(repo) {
  const root = ingestRoot(repo);
  const plugins = [];
  const without = [];
  const errors = [];
  for (const name of readdirSync(root).sort()) {
    const folder = path.join(root, name);
    if (!statSync(folder).isDirectory()) continue;
    const file = path.join(folder, 'plugin.mjs');
    if (!existsSync(file)) { without.push(name); continue; }
    try {
      plugins.push(await loadPluginFile(file));
    } catch (e) {
      errors.push(`${name}: ${/** @type {Error} */ (e).message}`);
    }
  }
  return { plugins, without, errors };
}

/** @param {string} file @returns {Promise<Plugin>} */
async function loadPluginFile(file) {
  const mod = await import(pathToFileURL(file).href);
  const def = mod.default;
  const problems = pluginProblems(def);
  const folder = path.basename(path.dirname(file));
  if (def && def.id !== folder) problems.push(`id ${def.id} differs from its folder ${folder}`);
  if (problems.length) throw new Error(problems.join('; '));
  return { ...def, file, folder: path.dirname(file) };
}

/**
 * @param {string} repo
 * @param {string} id
 * @returns {Promise<Plugin>}
 */
export async function loadPlugin(repo, id) {
  if (!ID.test(id)) throw new Error(`${id} is not a plugin id`);
  const file = path.join(ingestRoot(repo), id, 'plugin.mjs');
  if (!existsSync(file)) throw new Error(`no plugin at scripts/ingest/${id}/plugin.mjs`);
  return loadPluginFile(file);
}

/**
 * Files in a source folder no step, helper, research or data entry accounts for.
 * Sub-folders are accounted for as "name/".
 * @param {Plugin} plugin
 */
export function unaccountedFiles(plugin) {
  if (!plugin.folder) return [];
  const named = new Set(['plugin.mjs', ...(plugin.helpers || []), ...(plugin.research || []), ...(plugin.data || [])]);
  for (const st of Object.values(plugin.steps || {})) for (const a of st.argv) {
    const m = /^scripts\/ingest\/[^/]+\/(.+)$/.exec(a);
    if (m) named.add(m[1].includes('/') ? `${m[1].split('/')[0]}/` : m[1]);
  }
  if (plugin.command) { const m = /^scripts\/ingest\/[^/]+\/(.+)$/.exec(plugin.command[1]); if (m) named.add(m[1]); }
  const out = [];
  for (const name of readdirSync(plugin.folder).sort()) {
    if (name === '__pycache__' || name === 'README.md') continue;
    const isDir = statSync(path.join(plugin.folder, name)).isDirectory();
    if (!named.has(isDir ? `${name}/` : name)) out.push(isDir ? `${name}/` : name);
  }
  return out;
}

/**
 * Resolve a plugin's inputs: --input values, then each input's environment variable, then its default.
 * @param {Plugin} plugin
 * @param {Record<string, string>} given
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveInputs(plugin, given = {}, env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of Object.keys(given)) if (!plugin.inputs?.[k]) throw new Error(`${plugin.id} has no input ${k}`);
  for (const [k, spec] of Object.entries(plugin.inputs || {})) {
    const v = given[k] ?? (spec.env ? env[spec.env] : undefined) ?? spec.default;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The argv a step runs, placeholders resolved.
 * @param {Step} step
 * @param {{ repo: string, outRoot: string, inputs: Record<string, string>, args?: string[] }} where
 */
export function resolveArgv(step, { repo, outRoot, inputs, args = [] }) {
  const sub = (/** @type {string} */ a) => a
    .replace(/\{repo\}/g, repo.split(path.sep).join('/'))
    .replace(/\{out:([^}]+)\}/g, (_, rel) => path.join(outRoot, rel).split(path.sep).join('/'))
    .replace(/\{input:([^}]+)\}/g, (_, k) => {
      if (inputs[k] === undefined) throw new Error(`input ${k} is not set (give --input ${k}=<value>)`);
      return inputs[k];
    });
  return [...step.argv.map(sub), ...args];
}

/** Repository paths a step names with {out:...}. @param {Step} step */
export function redirectedOutputs(step) {
  const out = [];
  for (const a of step.argv) for (const m of a.matchAll(/\{out:([^}]+)\}/g)) out.push(m[1]);
  return out;
}

/**
 * @param {string[]} argv
 * @param {{ cwd: string, env?: Record<string, string>, stdio?: any, input?: string }} options
 */
export function spawnArgv(argv, { cwd, env = {}, stdio = 'inherit', input }) {
  const [prog, ...given] = argv;
  const exe = prog === 'node' ? process.execPath : prog;
  // A PowerShell script runs as `powershell -NoProfile -File <script> ...`, under the machine's
  // own execution policy.
  const rest = prog === 'powershell' ? ['-NoProfile', '-File', ...given] : given;
  const res = spawnSync(exe, rest, { cwd, env: { ...process.env, ...env }, stdio: input !== undefined ? ['pipe', 'pipe', 'inherit'] : stdio, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  return res;
}

/**
 * Run the old command lines directly in the repository, as the scripts have always run.
 * @param {Plugin} plugin
 * @param {string[]} stepIds
 * @param {{ repo: string, inputs: Record<string, string>, args?: string[], stdio?: any, env?: Record<string, string> }} options
 */
export function runStepsDirect(plugin, stepIds, { repo, inputs, args = [], stdio = 'inherit', env = {} }) {
  for (const id of stepIds) {
    const step = /** @type {Record<string, Step>} */ (plugin.steps)[id];
    const argv = resolveArgv(step, { repo, outRoot: repo, inputs, args });
    const res = spawnArgv(argv, { cwd: repo, env: { ...env, ...step.env }, stdio });
    if (res.status !== 0) throw new Error(`${plugin.id}/${id} exited ${res.status}${res.error ? ` (${res.error.message})` : ''}: ${argv.join(' ')}`);
  }
}

/**
 * Which steps a run uses: the named ones, else the only one, else an error listing them.
 * @param {Plugin} plugin
 * @param {string[]} named
 * @param {{ all?: boolean, allowNetwork?: boolean }} [options]
 */
export function selectSteps(plugin, named, { all = false, allowNetwork = false } = {}) {
  if (!plugin.steps) throw new Error(`${plugin.id} has no steps (it is ${plugin.produce || plugin.command ? 'a produce or bridge plugin' : 'research only'})`);
  const steps = plugin.steps;
  const ids = Object.keys(steps);
  let chosen = named.length ? named : all ? ids.filter((i) => !steps[i].network || allowNetwork) : ids.length === 1 ? ids : null;
  if (!chosen) throw new Error(`${plugin.id} has ${ids.length} steps; name them with --step (${ids.join(', ')}) or give --all`);
  for (const s of chosen) {
    if (!steps[s]) throw new Error(`${plugin.id} has no step ${s} (${ids.join(', ')})`);
    if (steps[s].network && !allowNetwork) throw new Error(`${plugin.id}/${s} fetches from outside; it runs only with --allow-network`);
  }
  return chosen;
}

/**
 * Run a plugin and return what it produced, without writing batch.json.
 * Steps-plugins leave the repository as they found it.
 * @param {Plugin} plugin
 * @param {{ repo: string, batchDir: string, steps?: string[], all?: boolean, allowNetwork?: boolean, args?: string[], inputs?: Record<string, string>, stdio?: any, env?: Record<string, string> }} options
 * @returns {Promise<{ staged: string[], operations: object[], notes: string[], deleted: string[], steps: string[] }>}
 */
export async function producePlugin(plugin, { repo, batchDir, steps = [], all = false, allowNetwork = false, args = [], inputs = {}, stdio = 'inherit', env = {} }) {
  const stagedDir = path.join(batchDir, 'staged');
  mkdirSync(stagedDir, { recursive: true });
  const resolved = resolveInputs(plugin, inputs);
  /** @type {ProduceContext} */
  const ctx = { repo, batchDir, stagedDir, steps, args, inputs: resolved };

  if (plugin.steps) {
    const chosen = selectSteps(plugin, steps, { all, allowNetwork });
    const declared = chosen.flatMap((s) => /** @type {Record<string, Step>} */ (plugin.steps)[s].outputs || []);
    const snap = snapshot(repo, { outputs: declared });
    let changed = [];
    let deleted = [];
    try {
      try {
        for (const id of chosen) {
          const step = plugin.steps[id];
          for (const rel of redirectedOutputs(step)) mkdirSync(path.dirname(path.join(stagedDir, rel)), { recursive: true });
          const argv = resolveArgv(step, { repo, outRoot: stagedDir, inputs: resolved, args });
          const res = spawnArgv(argv, { cwd: repo, env: { ...env, ...step.env }, stdio });
          if (res.status !== 0) throw new Error(`${plugin.id}/${id} exited ${res.status}${res.error ? ` (${res.error.message})` : ''}: ${argv.join(' ')}`);
        }
      } finally {
        ({ changed, deleted } = changesSince(snap));
        for (const rel of changed) {
          const dest = path.join(stagedDir, rel);
          mkdirSync(path.dirname(dest), { recursive: true });
          copyFileSync(path.join(repo, rel), dest);
        }
        restore(snap, [...changed, ...deleted]);
      }
    } finally {
      dispose(snap);
    }
    const staged = [...new Set([...changed, ...listStaged(stagedDir)])].sort();
    return { staged, operations: [], notes: [], deleted, steps: chosen };
  }

  if (!plugin.produce && !plugin.command) throw new Error(`${plugin.id} is research only: it has nothing to run`);
  /** @type {ProduceResult} */
  let result;
  if (plugin.produce) result = await plugin.produce(ctx);
  else {
    const command = /** @type {string[]} */ (plugin.command);
    const res = spawnArgv([...command, ...args], { cwd: repo, input: JSON.stringify({ schemaVersion: 1, plugin: plugin.id, ...ctx }) });
    if (res.status !== 0) throw new Error(`${plugin.id}: ${command.join(' ')} exited ${res.status}`);
    try {
      result = JSON.parse(res.stdout);
    } catch {
      throw new Error(`${plugin.id}: ${command.join(' ')} did not print a JSON result on stdout`);
    }
  }
  for (const s of result.staged || []) {
    if (!/^(?![A-Za-z]:|\/|\\)(?!.*(^|\/)\.\.(\/|$)).+$/.test(s.path)) throw new Error(`${plugin.id}: staged path ${s.path} is not a repository path`);
    const dest = path.join(stagedDir, s.path);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (s.content !== undefined) writeFileSync(dest, s.content);
    else if (s.from && path.resolve(s.from) !== path.resolve(dest)) copyFileSync(s.from, dest);
    else if (!existsSync(dest)) throw new Error(`${plugin.id}: staged ${s.path} has neither content nor a file`);
  }
  return { staged: listStaged(stagedDir), operations: result.operations || [], notes: result.notes || [], deleted: [], steps };
}

/** @param {string} stagedDir */
function listStaged(stagedDir) {
  const out = [];
  /** @param {string} d */
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const f = path.join(d, name);
      if (statSync(f).isDirectory()) walk(f);
      else out.push(path.relative(stagedDir, f).split(path.sep).join('/'));
    }
  };
  walk(stagedDir);
  return out.sort();
}

/**
 * The batch.json a plugin run becomes.
 * @param {Plugin} plugin
 * @param {{ id: string, baseCommit: string | null, produced: { staged: string[], operations: object[], notes: string[], steps: string[] }, stagedDir: string, today?: Date }} p
 */
export function pluginManifest(plugin, { id, baseCommit, produced, stagedDir, today = new Date() }) {
  const sourceIds = plugin.sources.map((s) => s.id);
  const operations = [];
  if (produced.staged.length) {
    operations.push({
      id: `${plugin.id}-files`,
      type: 'copy-files',
      note: `What ${produced.steps.length ? `the step(s) ${produced.steps.join(', ')}` : 'the plugin'} produced, at its repository paths.`,
      sources: sourceIds,
      files: produced.staged.map((rel) => ({ from: `staged/${rel}`, to: rel, sha256: sha256File(path.join(stagedDir, rel)) })),
    });
  }
  operations.push(...produced.operations);
  return {
    schemaVersion: 1,
    id,
    title: `${plugin.title}${produced.steps.length ? `: ${produced.steps.join(', ')}` : ''}`,
    date: today.toISOString().slice(0, 10),
    status: 'draft',
    summary: `Produced by the ${plugin.id} ingest plugin (scripts/ingest/${plugin.id}/plugin.mjs) with intake run.`,
    preparedBy: `intake run ${plugin.id}`,
    kinds: [...plugin.kinds],
    repo: { baseCommit: baseCommit || '' },
    sources: plugin.sources.map((s) => ({ ...s })),
    personalData: { ...plugin.personalData, handling: plugin.personalData.handling || 'none' },
    operations,
    expectedChecks: { beforeUpload: [], afterPostUpload: [] },
    notes: produced.notes,
  };
}

/**
 * Parity: run the old command lines directly, then the plugin and the intake stage, from the
 * same starting tree, and compare every path either touched. The tree is put back after each.
 * @param {Plugin} plugin
 * @param {{ repo: string, steps: string[], args?: string[], inputs?: Record<string, string>, scratch: string, stdio?: any, stageWrite: (batchDir: string) => void, frozenClock?: boolean }} options
 * @returns {Promise<{ same: string[], differ: { path: string, old: string, new: string }[], oldDeleted: string[], newDeleted: string[], sameIgnoringVolatile: string[] }>}
 */
export async function parity(plugin, { repo, steps, args = [], inputs = {}, scratch, stdio = 'inherit', stageWrite, frozenClock = true }) {
  const resolved = resolveInputs(plugin, inputs);
  const env = frozenClock ? frozenClockEnv() : {};
  const declared = steps.flatMap((s) => [...(/** @type {Record<string, Step>} */ (plugin.steps)[s].outputs || []), ...redirectedOutputs(plugin.steps[s])]);

  const volatile = steps.flatMap((s) => /** @type {Record<string, Step>} */ (plugin.steps)[s].volatile || []);
  const oldCopies = path.join(scratch, `parity-${plugin.id}-old`);
  const newCopies = path.join(scratch, `parity-${plugin.id}-new`);
  for (const d of [oldCopies, newCopies]) rmSync(d, { recursive: true, force: true });
  const s1 = snapshot(repo, { outputs: declared });
  /** @type {Map<string, string>} */
  let oldHashes;
  let oldDeleted;
  try {
    try {
      runStepsDirect(plugin, steps, { repo, inputs: resolved, args, stdio, env });
    } finally {
      const { changed, deleted } = changesSince(s1);
      oldHashes = hashPaths(repo, changed);
      oldDeleted = deleted;
      if (volatile.length) for (const p of changed) if (p.endsWith('.json')) keepCopy(repo, p, oldCopies);
      restore(s1, [...changed, ...deleted]);
    }
  } finally {
    dispose(s1);
  }

  const batchDir = path.join(scratch, `parity-${plugin.id}`);
  rmSync(batchDir, { recursive: true, force: true });
  mkdirSync(batchDir, { recursive: true });
  const produced = await producePlugin(plugin, { repo, batchDir, steps, args, inputs, stdio, allowNetwork: false, env });
  const manifest = pluginManifest(plugin, { id: `parity-${plugin.id}`, baseCommit: null, produced, stagedDir: path.join(batchDir, 'staged') });
  writeFileSync(path.join(batchDir, 'batch.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const s2 = snapshot(repo, { outputs: [...declared, ...produced.staged] });
  /** @type {Map<string, string>} */
  let newHashes;
  try {
    try {
      if (produced.staged.length) stageWrite(batchDir);
    } finally {
      const { changed, deleted } = changesSince(s2);
      newHashes = hashPaths(repo, new Set([...changed, ...oldHashes.keys()]));
      if (volatile.length) for (const p of changed) if (p.endsWith('.json')) keepCopy(repo, p, newCopies);
      restore(s2, [...changed, ...deleted]);
    }
  } finally {
    dispose(s2);
  }
  // A path the old run changed and the plugin path left unchanged is "absent" or its old bytes
  // in newHashes; compare over the union.
  const all = new Set([...oldHashes.keys(), ...newHashes.keys()]);
  const same = [];
  const differ = [];
  /** @type {string[]} */
  const sameIgnoringVolatile = [];
  const baseline = hashPaths(repo, all);
  for (const p of [...all].sort()) {
    const o = oldHashes.get(p) ?? baseline.get(p) ?? 'absent';
    const n = newHashes.get(p) ?? baseline.get(p) ?? 'absent';
    if (o === n) same.push(p);
    else if (volatile.length && sameIgnoring(path.join(oldCopies, p), path.join(newCopies, p), volatile)) { same.push(p); sameIgnoringVolatile.push(p); }
    else differ.push({ path: p, old: o, new: n });
  }
  return { same, differ, oldDeleted, newDeleted: produced.deleted, sameIgnoringVolatile };
}

/** @param {string} repo @param {string} rel @param {string} dir */
function keepCopy(repo, rel, dir) {
  const dest = path.join(dir, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(repo, rel), dest);
}

/**
 * Two JSON files equal once every key named in `keys` is removed at any depth.
 * @param {string} a @param {string} b @param {string[]} keys
 */
export function sameIgnoring(a, b, keys) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const drop = new Set(keys);
  /** @param {any} v @returns {any} */
  const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, strip(x)])) : v);
  try {
    return JSON.stringify(strip(JSON.parse(readFileSync(a, 'utf8')))) === JSON.stringify(strip(JSON.parse(readFileSync(b, 'utf8'))));
  } catch {
    return false;
  }
}

const CLOCK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frozen-clock');

/**
 * The environment that gives every Node step of a parity run the same wall clock
 * (frozen-clock/clock.mjs by --import), and every Python step the same time.time()
 * (frozen-clock/sitecustomize.py on PYTHONPATH; datetime.now is left alone, see that file).
 * @returns {Record<string, string>}
 */
export function frozenClockEnv() {
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(path.join(CLOCK_DIR, 'clock.mjs')).href}`].filter(Boolean).join(' ');
  const pythonPath = [CLOCK_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return { NODE_OPTIONS: nodeOptions, PYTHONPATH: pythonPath, INTAKE_FROZEN_CLOCK: '2026-01-01T00:00:00.000Z' };
}

/**
 * Steps whose `needs` are missing from this checkout (they cannot run here).
 * @param {Plugin} plugin
 * @param {string} repo
 */
export function missingNeeds(plugin, repo) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [id, st] of Object.entries(plugin.steps || {})) {
    const miss = (st.needs || []).filter((n) => !existsSync(path.isAbsolute(n) ? n : path.join(repo, n)));
    if (miss.length) out[id] = miss;
  }
  return out;
}

/** @param {string} file */
export const readJsonFile = (file) => JSON.parse(readFileSync(file, 'utf8'));
