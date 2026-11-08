/**
 * The site's runtime configuration in one place: origins, the API versions, the Pages bindings
 * and the environment variables the Functions read, and the cache policies.
 *
 * REFACTOR-PLAN.md item 7 (config). This is the half that runs in Pages Functions, so it has no
 * file system, no process.env and no Node imports. scripts/lib/config.mjs is the build-time half
 * (paths and the environment variables of the scripts) and re-exports everything here.
 *
 * NOTHING IS SWITCHED OVER YET. The constants below are still also written out where they are
 * used (shell.js SITE_ORIGIN, _records.js cache headers, wrangler.toml). tests/unit/config.test.mjs
 * holds this file equal to those copies, so the later switch-over is a mechanical import change.
 *
 * Never put a secret's VALUE here: SECRETS lists names only. The repository is public.
 */

/** Public origins and identity. */
export const SITE = /* @__PURE__ */ Object.freeze({
  name: 'Civgraph',
  origin: 'https://civgraph.net',
  /** R2 public bucket boundaries-data, behind the CDN: tiles, FGBs, thumbnails, downloads. */
  dataOrigin: 'https://data.civgraph.net',
  /**
   * The User-Agent of every request this project makes to someone else's service. It names the
   * site only; never an email address or any other personal identifier.
   */
  userAgent: 'civgraph-research (+https://civgraph.net)',
});

/**
 * The public API. `/_api/*` is the original, unversioned surface and stays an alias for good;
 * `/api/v1/*` is the versioned one (functions/api/v1/[[path]].js), which delegates to the same
 * handlers. A breaking change to a contract makes a v2; v1 keeps answering.
 */
export const API = /* @__PURE__ */ Object.freeze({
  current: 'v1',
  versions: /* @__PURE__ */ Object.freeze(['v1']),
  legacyPrefix: '/_api',
  prefix: (version = 'v1') => `/api/${version}`,
});

/**
 * Every binding a Function may read, with what it is. `environments` says where wrangler.toml
 * binds it; a binding with `retiring` is on its way out and may already be gone from
 * wrangler.toml. `optional` bindings are read when present and answered 503 (or a fallback)
 * when absent, by design.
 */
export const BINDINGS = /* @__PURE__ */ Object.freeze({
  ELECTIONS_DB: /* @__PURE__ */ Object.freeze({
    kind: 'd1', name: 'civgraph-records', environments: ['production'],
    purpose: 'the records database: elections, persons, parties, sources, votes, graph, maps, layers and the catalogue',
  }),
  PRONI_DB: /* @__PURE__ */ Object.freeze({
    kind: 'd1', name: 'proni-catalogue', environments: ['production', 'preview'],
    purpose: 'the PRONI eCatalogue with its FTS5 index (kept separate: FTS5 blocks D1 export)',
  }),
  PRONI_KV: /* @__PURE__ */ Object.freeze({ kind: 'kv', environments: ['production', 'preview'], purpose: 'PRONI app cache' }),
  SPATIAL_INDEX: /* @__PURE__ */ Object.freeze({ kind: 'kv', environments: ['production'], purpose: 'names and spatial chunks for /_api/search and /_api/spatial' }),
  CIVGRAPH_CONTRIBUTION_QUEUE: /* @__PURE__ */ Object.freeze({ kind: 'kv', environments: ['production'], purpose: 'the contribution review queue' }),
  MAPS_BUCKET: /* @__PURE__ */ Object.freeze({ kind: 'r2', name: 'boundaries-data', environments: ['production'], purpose: 'the public data bucket (data.civgraph.net)' }),
  CIVGRAPH_SUBMISSIONS: /* @__PURE__ */ Object.freeze({ kind: 'r2', environments: [], optional: true, purpose: 'an alternative contribution store; not bound' }),
  CIVGRAPH_QUARANTINE: /* @__PURE__ */ Object.freeze({ kind: 'r2', environments: [], optional: true, purpose: 'private intake quarantine bucket; deliberately not bound' }),
  ASSETS: /* @__PURE__ */ Object.freeze({ kind: 'assets', environments: ['production', 'preview'], builtin: true, purpose: 'the Pages static assets' }),
});

/**
 * What each kind of binding is at run time (the runtime's types: functions/_lib/runtime.d.mts).
 * @typedef {object} BindingKinds
 * @property {D1Database} d1
 * @property {KVNamespace} kv
 * @property {R2Bucket} r2
 * @property {{ fetch(input: Request | URL | string, init?: RequestInit): Promise<Response> }} assets
 */
/**
 * A Pages Function's env, from BINDINGS and RUNTIME_VARS: every binding and variable is
 * optional, because a Function reads it through binding()/runtimeVar() and answers 503 (or a
 * fallback) when it is absent.
 * @typedef {{ [K in keyof typeof BINDINGS]?: BindingKinds[(typeof BINDINGS)[K]['kind']] }
 *   & { [K in keyof typeof RUNTIME_VARS]?: string }} Env
 */
/**
 * The context a Pages Function handler receives, with civgraph's env; P names the route's
 * parameters (a [[path]] route: 'path').
 * @template {string} [P=string]
 * @typedef {PagesContext<Env, P>} FunctionContext
 */

/**
 * Environment variables the Functions read. Secrets are set with `wrangler pages secret put`
 * and never appear in the repository; flags are plain switches.
 */
export const RUNTIME_VARS = /* @__PURE__ */ Object.freeze({
  CIVGRAPH_ADMINS: { secret: true, purpose: 'contribution admins (email addresses; fail-closed when unset)' },
  CIVGRAPH_CONTRIBUTORS: { secret: true, purpose: 'contributors (email addresses; fail-closed when unset)' },
  CIVGRAPH_ACCESS_AUD: { secret: true, purpose: 'Cloudflare Access application audience' },
  CIVGRAPH_ACCESS_TEAM_DOMAIN: { secret: true, purpose: 'Cloudflare Access team domain' },
  CIVGRAPH_ALLOW_DEV_AUTH: { secret: true, purpose: 'local auth bypass; must stay unset in production' },
  CIVGRAPH_DEV_AUTH_EMAIL: { secret: true, purpose: 'local auth bypass identity; must stay unset in production' },
  CIVGRAPH_TEST_TRUST_EMAIL_HEADER: { secret: true, purpose: 'tests only; must stay unset in production' },
  CIVGRAPH_VERBOSE_ERRORS: { flag: true, purpose: 'return error detail to the caller (local debugging only)' },
  CIVGRAPH_SSR_RECORDS: { flag: true, purpose: 'record types rendered on the server (comma list)' },
  CIVGRAPH_SSR_PREVIEW: { flag: true, purpose: 'allow ?ssr=1 previews of server-rendered record pages' },
});

/** Names only. A tool that prints the configuration says whether these are set, never what to. */
export const SECRETS = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(RUNTIME_VARS).filter((k) => /** @type {Record<string, { secret?: boolean }>} */ (RUNTIME_VARS)[k].secret));

/** Cache-Control policies, by what is being served. */
export const CACHE = /* @__PURE__ */ Object.freeze({
  /** records answers (functions/_api/_records.js cachedJson): invalidated by the dataset version */
  records: 'public, max-age=300, stale-while-revalidate=86400',
  /** a records answer while a delta load is running */
  loading: 'no-store',
  /** an answer served from the last-good copy because D1 failed */
  lastGood: 'public, max-age=60',
  /** permanent redirects of renamed URLs */
  redirect: 'public, max-age=86400',
  /** any error */
  error: 'no-store',
});

/**
 * Which deployment a request is on, from its host: production (civgraph.net), preview (a Pages
 * preview, *.pages.dev) or local (localhost, 127.0.0.1, wrangler pages dev). Pages exposes no
 * branch name to a Function at request time, so the host is the reliable signal.
 * @param {string | URL | null | undefined} url
 * @returns {'production' | 'preview' | 'local' | 'unknown'}
 */
export function environmentFor(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return 'unknown'; }
  if (host === 'civgraph.net' || host === 'www.civgraph.net') return 'production';
  if (host.endsWith('.pages.dev')) return 'preview';
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) return 'local';
  return 'unknown';
}

/**
 * A binding from a Function's env, by a name this file knows. A misspelt name throws instead of
 * reading undefined and answering 503 forever; an absent binding is null.
 * @template {object} E
 * @template {keyof typeof BINDINGS} K
 * @param {E | null | undefined} env  the Function's env
 * @param {K} name
 * @returns {(K extends keyof E ? NonNullable<E[K]> : never) | null}
 */
export function binding(env, name) {
  if (!Object.hasOwn(BINDINGS, name)) throw new Error(`config.binding(): unknown binding ${name}`);
  return /** @type {(K extends keyof E ? NonNullable<E[K]> : never) | null} */ (/** @type {Partial<Record<string, unknown>> | null | undefined} */ (env)?.[name] ?? null);
}

/**
 * A runtime variable's value as a trimmed string ('' when unset), by a name this file knows.
 * @param {object | null | undefined} env  the Function's env
 * @param {keyof typeof RUNTIME_VARS} name
 * @returns {string}
 */
export function runtimeVar(env, name) {
  if (!Object.hasOwn(RUNTIME_VARS, name)) throw new Error(`config.runtimeVar(): unknown variable ${name}`);
  return String(/** @type {Partial<Record<string, unknown>> | null | undefined} */ (env)?.[name] ?? '').trim();
}
