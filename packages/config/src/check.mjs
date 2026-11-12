#!/usr/bin/env node
/**
 * `config --check`: the preflight of the configuration and the environment a build, a records
 * load, an upload or a deploy needs (REFACTOR-PLAN.md item 7, CFG-5). It reads; it changes
 * nothing, calls no remote service and never prints a secret's value: a secret is reported as
 * set or unset, and only its name ever appears.
 *
 *   npm run config:check                       the configuration itself (what CI can check)
 *   npm run config:check -- --for deploy       + what `wrangler pages deploy` needs
 *   npm run config:check -- --for upload       + the R2 S3 keys the upload scripts read
 *   npm run config:check -- --for records      + the records build's inputs
 *   npm run config:check -- --for publish      records + deploy + upload (.claude/publish/publish.sh)
 *   npm run config:check -- --json             the findings as JSON
 *   node packages/config/src/node.mjs --check  the same
 *
 * Exit code 1 when a finding is a failure; warnings are reported and pass.
 *
 * What it checks:
 *   - Node satisfies package.json `engines`;
 *   - config.js BINDINGS: known kinds and environments, and equal to wrangler.toml's bindings per
 *     environment in both directions (a binding missing from wrangler.toml disappears from
 *     production on the next deploy);
 *   - wrangler.toml holds no value for a secret or a dev/test-only variable, and every environment
 *     has the same compatibility date;
 *   - the repository locations REPO_PATHS names exist;
 *   - the environment: every CIVGRAPH_* variable set is one the config knows (a misspelt one is
 *     silently ignored by the scripts otherwise); the site URL is an https URL; a path variable
 *     that is set points at something;
 *   - .env.local, when present, is ignored by git, and holds only names the config knows;
 *   - per purpose (--for), the variables and files that step needs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BINDINGS, BUILD_VARS, REPO_PATHS, REPO_ROOT, RUNTIME_VARS, buildVar } from './node.mjs';

/** @typedef {'ok' | 'warn' | 'fail'} Level */
/** @typedef {{ id: string, level: Level, message: string }} Finding */
/** @typedef {'check' | 'records' | 'deploy' | 'upload' | 'publish'} Purpose */

export const PURPOSES = /** @type {readonly Purpose[]} */ (Object.freeze(['check', 'records', 'deploy', 'upload', 'publish']));

const BINDING_KINDS = new Set(['d1', 'kv', 'r2', 'assets']);
const ENVIRONMENTS = new Set(['production', 'preview']);
/** Runtime variables that must never be configured for a deployment (config.js says so in their purpose). */
const DEV_ONLY = new Set(['CIVGRAPH_ALLOW_DEV_AUTH', 'CIVGRAPH_DEV_AUTH_EMAIL', 'CIVGRAPH_TEST_TRUST_EMAIL_HEADER']);
/** REPO_PATHS entries a fresh checkout does not have until something writes them. */
const GENERATED_PATHS = new Set(['tmp', 'appBuild', 'envFile', 'intakeReceipts']);
/** BUILD_VARS that name a folder or file. */
const PATH_VARS = ['CIVGRAPH_RECORDS_DB', 'CIVGRAPH_VOTES_DIR', 'CIVGRAPH_GAZETTE_DIR', 'CIVGRAPH_NI_INTAKE', 'CIVGRAPH_INTAKE_ROOT', 'CIVGRAPH_ARCHIVE_DIR', 'CIVGRAPH_PYTHON', 'CIVGRAPH_WRANGLER_JS', 'WALKER_DIR', 'HOP_ARCHIVE'];
const R2_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/**
 * wrangler.toml's bindings per environment, its [vars] names per environment, and its
 * compatibility dates. A small reader for the parts this file uses, not a TOML parser.
 * @param {string} text
 */
export function readWrangler(text) {
  const kinds = /** @type {Record<string, string>} */ ({ d1_databases: 'd1', kv_namespaces: 'kv', r2_buckets: 'r2' });
  /** @type {{ bindings: Record<string, Map<string, string>>, vars: Record<string, Set<string>>, compatibilityDates: Record<string, string> }} */
  const out = {
    bindings: { production: new Map(), preview: new Map() },
    vars: { production: new Set(), preview: new Set() },
    compatibilityDates: {},
  };
  /** @type {{ env: string, kind: string | null, vars: boolean }} */
  let current = { env: 'production', kind: null, vars: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s#.*$|^#.*$/, '');
    const array = line.match(/^\s*\[\[(?:env\.(\w+)\.)?(\w+)\]\]/);
    if (array) { current = { env: array[1] || 'production', kind: kinds[array[2] || ''] ?? null, vars: false }; continue; }
    const table = line.match(/^\s*\[(?:env\.(\w+))?\.?(\w*)\]/);
    if (table) { current = { env: table[1] || 'production', kind: null, vars: table[2] === 'vars' }; continue; }
    const pair = line.match(/^\s*([A-Za-z_][\w-]*)\s*=\s*(.*)$/);
    if (!pair) continue;
    const [, key = '', value = ''] = pair;
    if (current.kind && key === 'binding') {
      const name = value.trim().replace(/^"|"$/g, '');
      (out.bindings[current.env] ??= new Map()).set(name, current.kind);
    } else if (current.vars) {
      (out.vars[current.env] ??= new Set()).add(key);
    } else if (!current.kind && key === 'compatibility_date') {
      out.compatibilityDates[current.env] = value.trim().replace(/^"|"$/g, '');
    }
  }
  return out;
}

/**
 * The names a dotenv file sets (KEY=value lines); the values are never kept.
 * @param {string} text
 * @returns {string[]}
 */
export function envFileNames(text) {
  /** @type {string[]} */
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\S/);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

/**
 * Whether `version` (like v24.11.0) satisfies a `>=N[.M[.P]]` range; true for any other range form.
 * @param {string} version
 * @param {string} range
 */
export function satisfiesMinimum(version, range) {
  const want = String(range).match(/^\s*>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/);
  if (!want) return true;
  const have = String(version).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const h = have[i] ?? 0;
    const w = Number(want[i + 1] ?? 0);
    if (h !== w) return h > w;
  }
  return true;
}

/**
 * Every finding for one purpose. Pure apart from reading the repository (and asking git whether
 * .env.local is ignored), so a test can pass any environment.
 * @param {{ purpose?: Purpose, env?: Record<string, string | undefined>, root?: string, nodeVersion?: string, gitIgnored?: (file: string) => boolean | null }} [options]
 * @returns {Finding[]}
 */
export function preflight({ purpose = 'check', env = process.env, root = REPO_ROOT, nodeVersion = process.version, gitIgnored = isGitIgnored } = {}) {
  if (!PURPOSES.includes(purpose)) throw new Error(`config --check: unknown purpose ${purpose} (one of ${PURPOSES.join(', ')})`);
  /** @type {Finding[]} */
  const findings = [];
  const add = (/** @type {string} */ id, /** @type {Level} */ level, /** @type {string} */ message) => { findings.push({ id, level, message }); };
  const at = (/** @type {string} */ rel) => path.join(root, ...rel.split('/'));

  // Node
  /** @type {{ engines?: { node?: string } }} */
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  const range = pkg.engines?.node || '';
  add('node', range && !satisfiesMinimum(nodeVersion, range) ? 'fail' : 'ok', `Node ${nodeVersion}${range ? ` (package.json engines: ${range})` : ''}`);

  // config.js BINDINGS against wrangler.toml
  const wranglerFile = at(REPO_PATHS.wranglerToml);
  if (!existsSync(wranglerFile)) {
    add('wrangler', 'fail', `${REPO_PATHS.wranglerToml} is missing`);
  } else {
    const wrangler = readWrangler(readFileSync(wranglerFile, 'utf8'));
    let bindingProblems = 0;
    for (const [name, spec] of Object.entries(BINDINGS)) {
      const s = /** @type {{ kind: string, environments: readonly string[], builtin?: boolean, retiring?: boolean }} */ (spec);
      if (!BINDING_KINDS.has(s.kind)) { add('bindings', 'fail', `${name}: unknown kind ${s.kind}`); bindingProblems += 1; }
      for (const e of s.environments) if (!ENVIRONMENTS.has(e)) { add('bindings', 'fail', `${name}: unknown environment ${e}`); bindingProblems += 1; }
    }
    for (const envName of ENVIRONMENTS) {
      for (const [name, kind] of wrangler.bindings[envName] ?? new Map()) {
        const spec = /** @type {Record<string, { kind: string, environments: readonly string[] } | undefined>} */ (BINDINGS)[name];
        if (!spec) { add('bindings', 'fail', `${name}: wrangler.toml binds it (${envName}) but config.js BINDINGS does not list it`); bindingProblems += 1; continue; }
        if (spec.kind !== kind) { add('bindings', 'fail', `${name}: wrangler.toml binds a ${kind}, config.js says ${spec.kind}`); bindingProblems += 1; }
        if (!spec.environments.includes(envName)) { add('bindings', 'fail', `${name}: wrangler.toml binds it in ${envName}, config.js does not list that environment`); bindingProblems += 1; }
      }
      for (const [name, spec] of Object.entries(BINDINGS)) {
        const s = /** @type {{ environments: readonly string[], builtin?: boolean, retiring?: boolean }} */ (spec);
        if (s.builtin || !s.environments.includes(envName) || wrangler.bindings[envName]?.has(name)) continue;
        if (s.retiring) add('bindings', 'warn', `${name}: retiring, and no longer bound in ${envName}`);
        else { add('bindings', 'fail', `${name}: config.js expects it in ${envName} but wrangler.toml does not bind it (a deploy would drop it)`); bindingProblems += 1; }
      }
    }
    if (!bindingProblems) add('bindings', 'ok', `${Object.keys(BINDINGS).length} bindings, equal to wrangler.toml for production and preview`);

    let varProblems = 0;
    for (const [envName, names] of Object.entries(wrangler.vars)) {
      for (const name of names) {
        const spec = /** @type {Record<string, { secret?: boolean } | undefined>} */ (RUNTIME_VARS)[name];
        if (spec?.secret || DEV_ONLY.has(name)) { add('wrangler-vars', 'fail', `${name}: wrangler.toml [vars] (${envName}) sets it; it is a secret or dev-only and must not be in the repository`); varProblems += 1; }
      }
    }
    if (!varProblems) add('wrangler-vars', 'ok', 'wrangler.toml sets no secret or dev-only variable');

    const dates = new Set(Object.values(wrangler.compatibilityDates));
    if (!dates.size) add('compatibility-date', 'fail', 'wrangler.toml has no compatibility_date');
    else add('compatibility-date', dates.size === 1 ? 'ok' : 'warn', dates.size === 1 ? `compatibility_date ${[...dates][0]} in every environment` : `environments differ: ${JSON.stringify(wrangler.compatibilityDates)}`);
  }

  // repository locations
  const missing = Object.entries(REPO_PATHS).filter(([name, rel]) => !GENERATED_PATHS.has(name) && !existsSync(at(rel))).map(([name, rel]) => `${name} (${rel})`);
  add('repo-paths', missing.length ? 'fail' : 'ok', missing.length ? `missing: ${missing.join(', ')}` : `${Object.keys(REPO_PATHS).length - GENERATED_PATHS.size} repository locations present`);

  // the environment
  const known = new Set([...Object.keys(BUILD_VARS), ...Object.keys(RUNTIME_VARS)]);
  const unknown = Object.keys(env).filter((name) => /^CIVGRAPH_/.test(name) && !known.has(name) && String(env[name] ?? '').trim() !== '').sort();
  add('env-names', unknown.length ? 'warn' : 'ok', unknown.length ? `set but unknown to the config (misspelt?): ${unknown.join(', ')}` : 'every CIVGRAPH_* variable set is one the config knows');

  const site = buildVar('CIVGRAPH_SITE_URL', env);
  let siteOk = false;
  try { siteOk = new URL(site).protocol === 'https:'; } catch { siteOk = false; }
  add('site-url', siteOk ? 'ok' : 'fail', siteOk ? `CIVGRAPH_SITE_URL ${site}` : 'CIVGRAPH_SITE_URL is not an https URL');

  const dangling = PATH_VARS.filter((name) => String(env[name] ?? '').trim() !== '' && !existsSync(path.resolve(root, String(env[name]).trim())));
  add('env-paths', dangling.length ? 'warn' : 'ok', dangling.length ? `set but pointing at nothing: ${dangling.join(', ')}` : 'every path variable that is set points at something');

  // .env.local: ignored by git, names only
  const envFile = at(REPO_PATHS.envFile);
  /** @type {Set<string>} */
  let localNames = new Set();
  if (existsSync(envFile)) {
    localNames = new Set(envFileNames(readFileSync(envFile, 'utf8')));
    const ignored = gitIgnored(envFile);
    if (ignored === false) add('env-file', 'fail', `${REPO_PATHS.envFile} is not ignored by git: it holds secrets and must never be committed`);
    else {
      const strange = [...localNames].filter((n) => !known.has(n) && !/^(CLOUDFLARE_|R2_|DEEPSEEK_|ANTHROPIC_|OPENAI_|GITHUB_|NPM_)/.test(n));
      add('env-file', strange.length ? 'warn' : 'ok', `${REPO_PATHS.envFile}: ${localNames.size} names${ignored === null ? ' (git not asked)' : ', ignored by git'}${strange.length ? `; unknown to the config: ${strange.join(', ')}` : ''}`);
    }
  }
  const isSet = (/** @type {string} */ name) => String(env[name] ?? '').trim() !== '' || localNames.has(name);

  // per purpose
  const wants = (/** @type {Purpose} */ p) => purpose === p || (purpose === 'publish' && p !== 'check');
  if (wants('records')) {
    const db = path.resolve(root, buildVar('CIVGRAPH_RECORDS_DB', env));
    add('records-db', existsSync(db) ? 'ok' : (purpose === 'publish' ? 'fail' : 'warn'), existsSync(db) ? 'the local records database exists' : `no local records database at ${path.relative(root, db) || db} (npm run records:build)`);
    add('migrations', existsSync(at(REPO_PATHS.migrations)) ? 'ok' : 'fail', `${REPO_PATHS.migrations}${existsSync(at(REPO_PATHS.migrations)) ? '' : ' is missing'}`);
  }
  if (wants('deploy')) {
    add('cloudflare-token', isSet('CLOUDFLARE_API_TOKEN') ? 'ok' : 'warn', isSet('CLOUDFLARE_API_TOKEN') ? 'CLOUDFLARE_API_TOKEN is set' : 'CLOUDFLARE_API_TOKEN is not set (wrangler falls back to its own login)');
    const devSet = [...DEV_ONLY].filter((n) => String(env[n] ?? '').trim() !== '');
    add('dev-auth', devSet.length ? 'fail' : 'ok', devSet.length ? `dev/test-only variables set in this shell: ${devSet.join(', ')}; unset them before deploying` : 'no dev/test-only variable set');
  }
  if (wants('upload')) {
    const absent = R2_KEYS.filter((n) => !isSet(n));
    add('r2-keys', absent.length ? 'fail' : 'ok', absent.length ? `not set (environment or ${REPO_PATHS.envFile}): ${absent.join(', ')}` : `the R2 S3 keys are set (${R2_KEYS.join(', ')})`);
  }
  return findings;
}

/**
 * Whether git ignores `file`: true, false, or null when git cannot be asked.
 * @param {string} file
 * @returns {boolean | null}
 */
export function isGitIgnored(file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch (error) {
    const status = /** @type {{ status?: number | null }} */ (error).status;
    return status === 1 ? false : null;
  }
}

/**
 * The findings as text, one per line, failures first.
 * @param {Finding[]} findings
 */
export function formatFindings(findings) {
  const order = { fail: 0, warn: 1, ok: 2 };
  return [...findings].sort((a, b) => order[a.level] - order[b.level])
    .map((f) => `${f.level === 'ok' ? 'ok  ' : f.level === 'warn' ? 'WARN' : 'FAIL'} ${f.id.padEnd(18)} ${f.message}`)
    .join('\n');
}

/** @param {string[]} argv */
export function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--for');
  const purpose = /** @type {Purpose} */ (at >= 0 ? argv[at + 1] || '' : 'check');
  if (!PURPOSES.includes(purpose)) {
    console.error(`config --check: --for takes one of ${PURPOSES.join(', ')}`);
    return 2;
  }
  const findings = preflight({ purpose });
  const failed = findings.filter((f) => f.level === 'fail').length;
  const warned = findings.filter((f) => f.level === 'warn').length;
  if (argv.includes('--json')) console.log(JSON.stringify({ purpose, failed, warned, findings }, null, 2));
  else {
    console.log(formatFindings(findings));
    console.log(`${failed ? 'FAIL' : 'PASS'}: config --check${purpose === 'check' ? '' : ` --for ${purpose}`}: ${failed} failed, ${warned} warnings, ${findings.length - failed - warned} ok`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && /[\\/]packages[\\/]config[\\/]src[\\/]check\.mjs$/.test(path.resolve(process.argv[1]))) process.exitCode = main();

