#!/usr/bin/env node
// @ts-check
/**
 * Deploy the site to Cloudflare Pages straight from this computer (owner, 14 Nov 2026, speed-up
 * item 5), instead of Pages cloning the repository and building it after each push.
 *
 *   node scripts/publish/deploy-pages.mjs              production (--branch main): HEAD must be pushed
 *   node scripts/publish/deploy-pages.mjs --preview    a preview deployment (branch "preview")
 *   node scripts/publish/deploy-pages.mjs --preview --branch preview-direct
 *   node scripts/publish/deploy-pages.mjs --dry-run    everything except the upload
 *   node scripts/publish/deploy-pages.mjs --rebuild    build even when the stamp says dist/ is current
 *
 * What it does, in order:
 *   1. The source. The tracked files must be unchanged (untracked files are ignored, as in
 *      publish.sh: the build reads only the commit). For production, HEAD must equal main on
 *      GitHub (git ls-remote), so the live site always matches a pushed commit. A preview may be
 *      unpushed; it says so. A dry run reports these refusals and carries on.
 *   2. The build, exactly as Pages builds it. The stage, tmp/deploy-pages/stage, is a clean
 *      checkout of HEAD: a `git clone --shared` of this repository (not a worktree, so
 *      `git worktree remove` can never reach its node_modules link), reset with
 *      `git checkout --force --detach HEAD` and `git clean -ffdx` before each build, so no
 *      gitignored local file can reach the output. The stage has its own node_modules, installed
 *      as Pages installs it (`npm ci --ignore-scripts`) and kept between runs while it matches the
 *      commit's package-lock.json version for version. Not a link to this checkout's: esbuild
 *      names the map app's chunks from their input paths, so through a link the chunk names (and
 *      the cache tokens in sw.js and the maps pages) would differ from the Pages build's. Then
 *      `npm run build:site`, the Pages build command. A stamp (tmp/deploy-pages/stamp.json:
 *      commit, lockfile blob, Node major, file count) lets the next run reuse a dist/ already
 *      built for the same commit.
 *   3. The output: dist/ must hold index.html and _routes.json, at most site.mjs's MAX_FILES
 *      files (18,500; Cloudflare refuses a deployment of 20,000) and no file over 25 MiB.
 *   4. The upload, from the stage, so wrangler reads the commit's wrangler.toml (the D1, KV and
 *      R2 bindings, production and preview alike) and bundles the commit's functions/:
 *        wrangler pages deploy dist --project-name civgraph --branch <branch>
 *          --commit-hash <HEAD> --commit-message <subject> --commit-dirty=false
 *      wrangler hashes every file and uploads only those Pages does not already hold.
 *   5. The deployment URL, the alias URL and the time each step took; a line in
 *      tmp/deploy-pages/deploys.log.
 *
 * publish.sh calls it after the push when CIVGRAPH_DIRECT_DEPLOY=1 (stream speed-publish):
 *   node scripts/publish/deploy-pages.mjs            (and --dry-run on a dry run)
 *
 * The Pages project's own Git builds stay on until the owner pauses them in the dashboard; until
 * then each push is deployed twice, by Pages and by this script, from the same commit.
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_FILES, MAX_FILE_BYTES, OUT_DIR } from '../build/site.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PROJECT = 'civgraph';
/** The project's production branch (Pages > civgraph > Settings > Builds; read back 14 Nov 2026). */
export const PRODUCTION_BRANCH = 'main';
export const DEFAULT_PREVIEW_BRANCH = 'preview';
/** Cloudflare Pages refuses a deployment of this many files (CI's pages-build job asserts it too). */
export const PAGES_HARD_LIMIT = 20000;
/** The commit message Pages shows; the repository's subjects can run to a paragraph. */
export const MESSAGE_MAX = 200;
/** wrangler's major version, as the rest of the repository runs it (npx wrangler). */
export const WRANGLER = 'wrangler@4';

/**
 * @typedef {object} DeployOptions
 * @property {boolean} preview   a preview deployment, not production
 * @property {string} branch     the Pages branch the deployment is filed under
 * @property {boolean} dryRun    everything except the upload
 * @property {boolean} rebuild   build even when the stamp says dist/ is current
 * @property {boolean} help
 */

/**
 * The command line. Throws on an unknown or contradictory option.
 * @param {string[]} argv
 * @returns {DeployOptions}
 */
export function parseArgs(argv) {
  /** @type {DeployOptions} */
  const opts = { preview: false, branch: '', dryRun: false, rebuild: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} i is within argv */ (argv[i]);
    if (a === '--preview') opts.preview = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--rebuild') opts.rebuild = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--branch' || a.startsWith('--branch=')) {
      const value = a === '--branch' ? argv[++i] : a.slice('--branch='.length);
      if (!value || value.startsWith('--')) throw new Error('--branch needs a name');
      opts.branch = value;
    } else throw new Error(`unknown option: ${a}`);
  }
  if (!opts.preview && opts.branch && opts.branch !== PRODUCTION_BRANCH) {
    throw new Error(`--branch ${opts.branch} is a preview: add --preview (production is always --branch ${PRODUCTION_BRANCH})`);
  }
  if (opts.preview && opts.branch === PRODUCTION_BRANCH) {
    throw new Error(`--preview cannot use the production branch (${PRODUCTION_BRANCH})`);
  }
  if (opts.branch && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,60}$/.test(opts.branch)) {
    throw new Error(`--branch ${opts.branch}: use letters, digits, dot, dash, slash or underscore`);
  }
  if (!opts.branch) opts.branch = opts.preview ? DEFAULT_PREVIEW_BRANCH : PRODUCTION_BRANCH;
  return opts;
}

/**
 * @typedef {object} SourceFacts
 * @property {string[]} dirty            tracked files with uncommitted changes (git status, untracked excluded)
 * @property {string} head               the commit to deploy
 * @property {string | null} remoteMain  main on GitHub, or null when it could not be read
 */

/**
 * Whether the commit may be deployed. Refusals are errors; a dry run reports them as warnings
 * ("a real deploy would refuse"), since a dry run of publish.sh runs before anything is pushed.
 * @param {Pick<DeployOptions, 'preview' | 'dryRun'>} opts
 * @param {SourceFacts} facts
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkSource(opts, facts) {
  /** @type {string[]} */
  const refusals = [];
  /** @type {string[]} */
  const warnings = [];
  if (facts.dirty.length) {
    const shown = facts.dirty.slice(0, 5).join(', ') + (facts.dirty.length > 5 ? ', ...' : '');
    refusals.push(`${facts.dirty.length} tracked file(s) have uncommitted changes (${shown}); commit first, so the deployment is a commit`);
  }
  if (!/^[0-9a-f]{40}$/.test(facts.head)) refusals.push(`HEAD is not a commit hash: ${facts.head}`);
  const pushed = facts.remoteMain !== null && facts.remoteMain === facts.head;
  if (!opts.preview && !pushed) {
    refusals.push(facts.remoteMain === null
      ? 'could not read main on GitHub (git ls-remote origin); production deploys only a pushed commit'
      : `HEAD ${facts.head.slice(0, 10)} is not main on GitHub (${facts.remoteMain.slice(0, 10)}); push first, so the live site matches a pushed commit`);
  }
  if (opts.preview && !pushed) {
    warnings.push(`HEAD ${facts.head.slice(0, 10)} is not main on GitHub: this preview is of an unpushed commit, and a preview URL opens for anyone who has it`);
  }
  if (opts.dryRun) return { errors: [], warnings: [...refusals.map((r) => `a real deploy would refuse: ${r}`), ...warnings] };
  return { errors: refusals, warnings };
}

/**
 * @typedef {object} Stamp
 * @property {string} head       the commit dist/ was built from
 * @property {string} lockHash   the git blob id of that commit's package-lock.json
 * @property {string} node       the Node major version that built it
 * @property {number} files      the files written to dist/
 * @property {string} builtAt
 */

/**
 * Whether dist/ in the stage can be reused for this commit.
 * @param {{ head: string, lockHash: string, node: string, rebuild: boolean, stamp: Stamp | null, stageHead: string | null, distFiles: number | null }} input
 * @returns {{ reuse: boolean, reason: string }}
 */
export function planBuild(input) {
  if (input.rebuild) return { reuse: false, reason: '--rebuild' };
  const s = input.stamp;
  if (!s) return { reuse: false, reason: 'no earlier build' };
  if (s.head !== input.head) return { reuse: false, reason: `dist/ was built for ${s.head.slice(0, 10)}` };
  if (input.stageHead !== input.head) return { reuse: false, reason: 'the stage holds another commit' };
  if (s.lockHash !== input.lockHash) return { reuse: false, reason: 'package-lock.json changed' };
  if (s.node !== input.node) return { reuse: false, reason: `built with Node ${s.node}, running ${input.node}` };
  if (input.distFiles === null) return { reuse: false, reason: 'dist/ is missing' };
  if (input.distFiles !== s.files) return { reuse: false, reason: `dist/ holds ${input.distFiles} files, the build wrote ${s.files}` };
  return { reuse: true, reason: `dist/ was built for this commit at ${s.builtAt}` };
}

/**
 * Packages whose installed version differs from the lockfile's (npm's node_modules/.package-lock.json
 * against package-lock.json). An optional package (a platform build) may be absent.
 * @param {Record<string, { version?: string, optional?: boolean }>} locked     package-lock.json `packages`
 * @param {Record<string, { version?: string }>} installed                    node_modules/.package-lock.json `packages`
 * @returns {string[]}
 */
export function lockMismatches(locked, installed) {
  /** @type {string[]} */
  const out = [];
  for (const [key, entry] of Object.entries(locked)) {
    if (!key.startsWith('node_modules/')) continue;
    const have = installed[key];
    if (!have) {
      if (!entry.optional) out.push(`${key.slice('node_modules/'.length)}: not installed`);
    } else if (have.version !== entry.version) {
      out.push(`${key.slice('node_modules/'.length)}: ${have.version} installed, ${entry.version} locked`);
    }
  }
  return out;
}

/**
 * What must hold of dist/ before it is uploaded.
 * @param {{ files: number, oversized: string[], hasIndex: boolean, hasRoutes: boolean }} dist
 * @param {number} [maxFiles]
 * @returns {string[]}
 */
export function checkDist(dist, maxFiles = MAX_FILES) {
  /** @type {string[]} */
  const errors = [];
  if (dist.files >= PAGES_HARD_LIMIT) errors.push(`${dist.files} files in dist/; Cloudflare Pages refuses ${PAGES_HARD_LIMIT}`);
  else if (dist.files > maxFiles) errors.push(`${dist.files} files in dist/ is over the ${maxFiles}-file guardrail`);
  for (const f of dist.oversized) errors.push(`${f} is over 25 MiB, Cloudflare's per-file limit`);
  if (!dist.hasIndex) errors.push('dist/index.html is missing');
  if (!dist.hasRoutes) errors.push('dist/_routes.json is missing (the Functions would answer every path)');
  return errors;
}

/**
 * The commit subject as Pages shows it: one line, no shell metacharacters, at most MESSAGE_MAX.
 * @param {string} subject
 */
export function commitMessage(subject) {
  const line = /** @type {string} split gives at least one part */ (subject.split(/\r?\n/)[0]).replace(/["%^!`$\\<>|&]/g, '').replace(/\s+/g, ' ').trim();
  return line.length > MESSAGE_MAX ? `${line.slice(0, MESSAGE_MAX - 3).trimEnd()}...` : line;
}

/**
 * The wrangler arguments (after `npx wrangler@4`).
 * @param {{ branch: string, head: string, message: string }} input
 */
export function wranglerArgs({ branch, head, message }) {
  return ['pages', 'deploy', OUT_DIR, '--project-name', PROJECT, '--branch', branch,
    '--commit-hash', head, '--commit-message', message, '--commit-dirty=false'];
}

/**
 * The URLs and upload counts in wrangler's output.
 * @param {string} text
 * @returns {{ url: string | null, alias: string | null, uploaded: number | null, alreadyUploaded: number | null }}
 */
export function parseWranglerOutput(text) {
  const url = /Deployment complete!.*?(https:\/\/\S+)/.exec(text)?.[1] ?? null;
  const alias = /alias URL:\s*(https:\/\/\S+)/i.exec(text)?.[1] ?? null;
  const up = /Uploaded (\d+) files?(?: \((\d+) already uploaded\))?/.exec(text);
  return { url, alias, uploaded: up ? Number(up[1]) : null, alreadyUploaded: up?.[2] ? Number(up[2]) : (up ? 0 : null) };
}

/** @param {number} ms */
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

/** npm's own CLI scripts beside this Node, so arguments pass without a shell; null if not found. */
function npmScript(/** @type {'npm' | 'npx'} */ name) {
  const dir = path.dirname(process.execPath);
  for (const p of [path.join(dir, 'node_modules', 'npm', 'bin', `${name}-cli.js`), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', `${name}-cli.js`)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Run npm or npx with the arguments, without a shell where possible. Resolves with the exit code
 * and the output; `echo` decides which lines are shown as they come.
 * @param {'npm' | 'npx'} tool
 * @param {string[]} args
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, echo: (line: string) => boolean }} o
 * @returns {Promise<{ code: number, output: string }>}
 */
function run(tool, args, o) {
  const script = npmScript(tool);
  const child = script
    ? spawn(process.execPath, [script, ...args], { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn([tool, ...args.map((x) => `"${x}"`)].join(' '), { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  let output = '';
  let pending = '';
  /** @param {Buffer} chunk */
  const onData = (chunk) => {
    const s = chunk.toString('utf8');
    output += s;
    pending += s;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) if (o.echo(line)) console.log(`    ${line}`);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  return new Promise((resolve) => {
    child.on('close', (code) => {
      if (pending && o.echo(pending)) console.log(`    ${pending}`);
      resolve({ code: code ?? 1, output });
    });
  });
}

/** @param {string} dir */
function countFiles(dir) {
  let files = 0;
  /** @type {string[]} */
  const oversized = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else if (e.isFile()) {
        files++;
        if (statSync(path.join(dir, child)).size > MAX_FILE_BYTES) oversized.push(child);
      }
    }
  };
  walk('');
  return { files, oversized };
}

/** @param {string} file */
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * The stage: a shared clone of this repository, checked out clean at HEAD (its node_modules kept).
 * @param {string} stage
 * @param {string} head
 */
function prepareStage(stage, head) {
  if (!existsSync(path.join(stage, '.git'))) {
    if (existsSync(stage) && readdirSync(stage).length) throw new Error(`${stage} exists but is not a clone; remove it`);
    mkdirSync(path.dirname(stage), { recursive: true });
    git(REPO_ROOT, ['clone', '--quiet', '--shared', '--no-checkout', REPO_ROOT, stage]);
  }
  const modules = path.join(stage, 'node_modules');
  // A link here would let a clean or a removal of the stage reach the tree it points at.
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) {
    throw new Error(`${modules} is a link; remove the link itself (rmdir on Windows) and rerun`);
  }
  git(stage, ['checkout', '--quiet', '--force', '--detach', head]);
  git(stage, ['clean', '-ffdxq', '-e', '/node_modules']);
}

/** @param {string[]} argv */
export async function main(argv) {
  /** @type {DeployOptions} */
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`deploy-pages: ${/** @type {Error} */ (e).message}`);
    return 2;
  }
  if (opts.help) {
    console.log('usage: node scripts/publish/deploy-pages.mjs [--preview [--branch <name>]] [--dry-run] [--rebuild]');
    return 0;
  }
  const t0 = Date.now();
  const work = path.join(REPO_ROOT, 'tmp', 'deploy-pages');
  const stage = path.join(work, 'stage');
  const stampFile = path.join(work, 'stamp.json');
  mkdirSync(work, { recursive: true });
  const target = opts.preview ? `preview (branch ${opts.branch})` : `PRODUCTION (branch ${opts.branch})`;
  console.log(`deploy-pages: ${target}${opts.dryRun ? ', dry run' : ''}`);

  // 1. The source.
  const head = git(REPO_ROOT, ['rev-parse', 'HEAD']);
  const subject = git(REPO_ROOT, ['log', '-1', '--format=%s', head]);
  const dirty = git(REPO_ROOT, ['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).map((l) => l.slice(3));
  /** @type {string | null} */
  let remoteMain = null;
  try {
    remoteMain = git(REPO_ROOT, ['ls-remote', 'origin', `refs/heads/${PRODUCTION_BRANCH}`]).split(/\s+/)[0] || null;
  } catch { /* reported by checkSource */ }
  const source = checkSource(opts, { dirty, head, remoteMain });
  for (const w of source.warnings) console.log(`  WARNING: ${w}`);
  if (source.errors.length) {
    for (const e of source.errors) console.error(`  REFUSED: ${e}`);
    return 1;
  }
  console.log(`  commit ${head.slice(0, 10)} ${commitMessage(subject).slice(0, 80)}`);

  // 2. The build.
  const tBuild = Date.now();
  const stageHead = existsSync(path.join(stage, '.git')) ? git(stage, ['rev-parse', 'HEAD']) : null;
  const lockHash = git(REPO_ROOT, ['rev-parse', `${head}:package-lock.json`]);
  const node = /** @type {string} split gives at least one part */ (process.versions.node.split('.')[0]);
  const distDir = path.join(stage, OUT_DIR);
  const plan = planBuild({ head, lockHash, node, rebuild: opts.rebuild, stamp: readJson(stampFile), stageHead, distFiles: existsSync(distDir) ? countFiles(distDir).files : null });
  if (plan.reuse) {
    console.log(`  build: reused (${plan.reason})`);
  } else {
    console.log(`  build: npm run build:site in a clean checkout (${plan.reason})`);
    writeFileSync(stampFile, 'null\n');
    prepareStage(stage, head);
    const locked = readJson(path.join(stage, 'package-lock.json'));
    const installed = readJson(path.join(stage, 'node_modules', '.package-lock.json'));
    const mismatches = installed && locked ? lockMismatches(locked.packages ?? {}, installed.packages ?? {}) : ['no node_modules yet'];
    if (mismatches.length) {
      console.log(`  install: npm ci --ignore-scripts, as Pages installs (${mismatches[0]}${mismatches.length > 1 ? `, and ${mismatches.length - 1} more` : ''})`);
      const ci = await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, echo: (l) => /^npm (error|ERR)/.test(l) });
      if (ci.code !== 0) {
        writeFileSync(path.join(work, 'install.log'), ci.output);
        console.error(`  FAILED: npm ci exited ${ci.code}; the output is in tmp/deploy-pages/install.log`);
        return 1;
      }
    }
    const built = await run('npm', ['run', 'build:site'], { cwd: stage, echo: (l) => /^Pages output|^FAIL|error/i.test(l) });
    if (built.code !== 0) {
      writeFileSync(path.join(work, 'build.log'), built.output);
      console.error(`  FAILED: npm run build:site exited ${built.code}; the output is in tmp/deploy-pages/build.log`);
      console.error(built.output.split(/\r?\n/).slice(-15).join('\n'));
      return 1;
    }
    const changed = git(stage, ['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).length;
    if (changed) console.log(`  note: the build rewrote ${changed} tracked file(s), as the Pages build of this commit does`);
  }
  const buildMs = Date.now() - tBuild;

  // 3. The output.
  const counted = countFiles(distDir);
  const distErrors = checkDist({ ...counted, hasIndex: existsSync(path.join(distDir, 'index.html')), hasRoutes: existsSync(path.join(distDir, '_routes.json')) });
  if (distErrors.length) {
    for (const e of distErrors) console.error(`  REFUSED: ${e}`);
    return 1;
  }
  if (!plan.reuse) {
    /** @type {Stamp} */
    const stamp = { head, lockHash, node, files: counted.files, builtAt: new Date().toISOString() };
    writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`);
  }
  console.log(`  dist/: ${counted.files} files (guardrail ${MAX_FILES}, Cloudflare limit ${PAGES_HARD_LIMIT}); build ${secs(buildMs)}`);

  // 4. The upload.
  const args = wranglerArgs({ branch: opts.branch, head, message: commitMessage(subject) });
  if (opts.dryRun) {
    console.log(`  (dry run) would run in tmp/deploy-pages/stage: npx ${WRANGLER} ${args.join(' ')}`);
    console.log(`deploy-pages: dry run done in ${secs(Date.now() - t0)}`);
    return 0;
  }
  const tDeploy = Date.now();
  const env = { ...process.env };
  for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_S3_ENDPOINT']) delete env[k];
  const deployed = await run('npx', ['--yes', WRANGLER, ...args], { cwd: stage, env, echo: (l) => /Uploaded|Compiled|Deployment|alias|https:\/\/|ERROR|✘/i.test(l) });
  const deployMs = Date.now() - tDeploy;
  const result = parseWranglerOutput(deployed.output);
  if (deployed.code !== 0 || !result.url) {
    writeFileSync(path.join(work, 'deploy.log'), deployed.output);
    console.error(`  FAILED: wrangler exited ${deployed.code}; the output is in tmp/deploy-pages/deploy.log`);
    return 1;
  }

  // 5. The result.
  const total = Date.now() - t0;
  console.log(`deploy-pages: deployed ${head.slice(0, 10)} to ${target}`);
  console.log(`  URL:   ${result.url}`);
  if (result.alias) console.log(`  alias: ${result.alias}`);
  if (result.uploaded !== null) console.log(`  files uploaded: ${result.uploaded} (${result.alreadyUploaded} already held by Pages)`);
  console.log(`  time: build ${secs(buildMs)}, upload ${secs(deployMs)}, total ${secs(total)}`);
  appendFileSync(path.join(work, 'deploys.log'), `${new Date().toISOString()} ${opts.branch} ${head.slice(0, 10)} ${result.url} build=${secs(buildMs)} upload=${secs(deployMs)} total=${secs(total)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
