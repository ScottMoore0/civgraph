#!/usr/bin/env node
/**
 * The build-time configuration: repository paths, the record build's locations, and every
 * environment variable the scripts read, resolved in one place from one environment.
 *
 * REFACTOR-PLAN.md item 7 (config). The runtime half, which Pages Functions can bundle, is
 * functions/_lib/config.js; this module re-exports it, so a script needs one import.
 *
 * It replaces the constants scattered through scripts/ (the data origin, the User-Agent,
 * CIVGRAPH_* defaults). Switched over so far: scripts/records/paths.mjs re-exports recordPaths()
 * from here (CFG-2; paths.py stays the Python twin, held equal by tests/records/paths.test.mjs),
 * and scripts/records and scripts/lib take the origins, the User-Agent and their CIVGRAPH_*
 * variables from here (CFG-4 for those folders).
 *
 *   node scripts/lib/config.mjs            the resolved configuration, as JSON
 *   node scripts/lib/config.mjs --env      the environment variables it knows, and which are set
 *
 * Neither prints a secret's value: a secret is reported as set or unset. The Python scripts can
 * read the same values with `node scripts/lib/config.mjs` until paths.py is retired.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, BINDINGS, CACHE, RUNTIME_VARS, SECRETS, SITE, binding, environmentFor, runtimeVar } from './config.js';

export { API, BINDINGS, CACHE, RUNTIME_VARS, SECRETS, SITE, binding, environmentFor, runtimeVar };

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where records:build writes unless CIVGRAPH_BUILD_DIR says otherwise. */
export const DEFAULT_BUILD_DIR = 'tmp/records';

/**
 * The environment variables of the build, ingest and publish scripts. `default` is what an unset
 * variable means; `secret` ones are read from .env.local by the scripts that need them and are
 * never printed. Dev and test knobs (TEST_*, PORT, PW_*) stay with their scripts.
 */
/** @typedef {{ default?: string, secret?: boolean, purpose: string }} VarSpec */
/** @type {Readonly<Record<string, VarSpec>>} */
export const BUILD_VARS = Object.freeze({
  CIVGRAPH_BUILD_DIR: { default: DEFAULT_BUILD_DIR, purpose: "the record build's output tree ('legacy' = the old in-tree locations)" },
  CIVGRAPH_RECORDS_DB: { default: 'tmp/records/civgraph-records.sqlite', purpose: 'the local records database the tests and tools open' },
  CIVGRAPH_VOTES_DIR: { default: '', purpose: 'the parliamentary votes dataset, kept outside the repository and pinned by checksum' },
  CIVGRAPH_GAZETTE_DIR: { default: '', purpose: 'the Belfast Gazette working folder (outside the repository)' },
  CIVGRAPH_NI_INTAKE: { default: '', purpose: 'the NI council elections intake folder' },
  CIVGRAPH_INTAKE_ROOT: { default: '', purpose: 'where intake batches live (outside the repository; the intake CLI takes the batch folder as an argument)' },
  CIVGRAPH_ARCHIVE_DIR: { default: 'archive', purpose: 'the offline copy of the retired archive/ tree' },
  CIVGRAPH_I18N_CACHE: { default: 'tmp/i18n-cache', purpose: 'the place-name crosswalk download cache' },
  CIVGRAPH_PYTHON: { default: '', purpose: 'a Python with pypdf, for the register PDFs' },
  CIVGRAPH_WRANGLER_JS: { default: '', purpose: "wrangler's entry script, when it is not the project's" },
  CIVGRAPH_SITE_URL: { default: SITE.origin, purpose: 'the deployment verify-live checks' },
  WALKER_DIR: { default: '', purpose: 'the Walker results working folder' },
  HOP_ARCHIVE: { default: '', purpose: 'the local History of Parliament archive (archive.sqlite)' },
  R2_ACCOUNT_ID: { secret: true, purpose: 'R2 S3 endpoint account (.env.local)' },
  R2_ACCESS_KEY_ID: { secret: true, purpose: 'R2 S3 key (.env.local)' },
  R2_SECRET_ACCESS_KEY: { secret: true, purpose: 'R2 S3 secret (.env.local)' },
  CLOUDFLARE_API_TOKEN: { secret: true, purpose: 'wrangler and the Pages API' },
});

/** The record build's file locations (the contract of scripts/records/paths.mjs recordPaths). */
export function recordPaths(env = process.env) {
  const value = String(env.CIVGRAPH_BUILD_DIR || '').trim() || DEFAULT_BUILD_DIR;
  const BUILD = value === 'legacy' ? null : path.resolve(REPO_ROOT, value);
  const at = (built, legacy) => (BUILD ? path.join(BUILD, built) : path.join(REPO_ROOT, legacy));
  return {
    BUILD_DIR: BUILD,
    ELECTION_BUNDLE_DIR: at('elections', 'render/metadata/elections-test2'),
    ELECTION_MANIFEST: at('elections-test2.json', 'render/metadata/elections-test2.json'),
    ELECTION_REPORT: at('elections-test2-report.json', 'render/metadata/elections-test2-report.json'),
    ELECTION_SUMMARY_DIR: at('elections-summaries', 'render/metadata/elections-test2-summaries'),
    PROVENANCE_FILE: at('election-provenance.json', 'data/database/election-provenance.json'),
    PROVENANCE_SHARD_DIR: at('election-provenance', 'render/metadata/election-provenance'),
    BROWSE_DIR: at('browse', 'data/browse'),
    GRAPH_DIR: at('graph', 'data/graph'),
    RECORDS_DB: path.join(REPO_ROOT, 'tmp/records/civgraph-records.sqlite'),
  };
}

/** Fixed repository locations (relative to REPO_ROOT, forward slashes). */
export const REPO_PATHS = Object.freeze({
  functions: 'functions',
  migrations: 'packages/schema/migrations',
  routesManifest: '_routes.json',
  wranglerToml: 'wrangler.toml',
  tmp: 'tmp',
  appBuild: 'app/build',
  uiTokens: 'packages/ui/assets', // served at /assets/ui/ (packages/served.json)
  electionsSource: 'data/elections-source/data/elections',
  electionsData: 'data/elections',
  mapsCatalogue: 'data/database/maps.json',
  layerMetadata: 'render/metadata/maps-test.json',
  catalogueSource: 'data/catalogue/catalogue.source.json',
  intakeReceipts: 'data/intake',
  intakeSchema: 'scripts/intake/batch.schema.json',
  envFile: '.env.local',
});

/** Absolute path of a REPO_PATHS entry or of any repository-relative path. */
export function repoPath(nameOrRelative) {
  const rel = Object.hasOwn(REPO_PATHS, nameOrRelative) ? REPO_PATHS[nameOrRelative] : nameOrRelative;
  return path.join(REPO_ROOT, ...String(rel).split('/'));
}

/**
 * One BUILD_VARS variable as set, or its default when it is unset or blank. A name BUILD_VARS
 * does not list throws, so a misspelt variable fails where it is read instead of reading as unset.
 * @param {string} name
 * @param {NodeJS.ProcessEnv | Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function buildVar(name, env = process.env) {
  if (!Object.hasOwn(BUILD_VARS, name)) throw new Error(`unknown build variable ${name} (scripts/lib/config.mjs BUILD_VARS)`);
  return String(env[name] ?? '').trim() || BUILD_VARS[name].default || '';
}

const isSecret = (name) => Boolean(BUILD_VARS[name]?.secret || RUNTIME_VARS[name]?.secret);

/**
 * The whole configuration for one environment. Pure: everything comes from `env`, so a test can
 * resolve any combination without touching process.env.
 */
export function loadConfig(env = process.env) {
  const get = (/** @type {string} */ name) => buildVar(name, env);
  const abs = (p) => (p ? path.resolve(REPO_ROOT, p) : null);
  return {
    site: SITE,
    api: { current: API.current, versions: [...API.versions], legacyPrefix: API.legacyPrefix, prefix: API.prefix(API.current) },
    bindings: BINDINGS,
    cache: CACHE,
    repoRoot: REPO_ROOT,
    records: recordPaths(env),
    recordsDb: abs(get('CIVGRAPH_RECORDS_DB')),
    votesDir: abs(get('CIVGRAPH_VOTES_DIR')),
    gazetteDir: abs(get('CIVGRAPH_GAZETTE_DIR')),
    niIntakeDir: abs(get('CIVGRAPH_NI_INTAKE')),
    intakeRoot: abs(get('CIVGRAPH_INTAKE_ROOT')),
    archiveDir: abs(get('CIVGRAPH_ARCHIVE_DIR')),
    i18nCache: abs(get('CIVGRAPH_I18N_CACHE')),
    verifySite: get('CIVGRAPH_SITE_URL').replace(/\/+$/, ''),
    paths: Object.fromEntries(Object.keys(REPO_PATHS).map((k) => [k, repoPath(k)])),
  };
}

/** Every known variable with whether it is set; values only for non-secrets. */
export function describeEnv(env = process.env) {
  const rows = [];
  for (const [name, spec] of [...Object.entries(BUILD_VARS), ...Object.entries(RUNTIME_VARS)]) {
    const set = String(env[name] ?? '').trim() !== '';
    rows.push({
      name,
      scope: Object.hasOwn(BUILD_VARS, name) ? 'build' : 'runtime',
      set,
      value: isSecret(name) ? (set ? '(set)' : '') : (set ? String(env[name]) : ''),
      default: /** @type {VarSpec} */ (spec).default ?? '',
      purpose: spec.purpose,
    });
  }
  return rows;
}

// Run directly, or through the one-month re-export at scripts/lib/config.mjs.
const invokedDirectly = process.argv[1] && /[\\/](scripts[\\/]lib[\\/]config|packages[\\/]config[\\/]src[\\/]node)\.mjs$/.test(path.resolve(process.argv[1]));
if (invokedDirectly) {
  if (process.argv.includes('--env')) {
    for (const r of describeEnv()) console.log(`${r.set ? '*' : ' '} ${r.name.padEnd(32)} ${r.scope.padEnd(8)} ${r.value || (r.default ? `(default ${r.default})` : '')}`);
  } else {
    const { bindings: _b, ...rest } = loadConfig();
    console.log(JSON.stringify(rest, null, 2));
  }
}
