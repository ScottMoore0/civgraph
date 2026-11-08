/**
 * Types the API handlers share, for JSDoc only (functions/tsconfig.check.json). Nothing imports
 * this file at run time: a `.d.ts`, so neither esbuild nor the Pages route table ever reads it.
 *
 *   /** @typedef {import('../types.js').ApiContext} ApiContext *\/
 *
 * The bindings and variables mirror BINDINGS and RUNTIME_VARS in packages/config/src/config.js;
 * every one is optional because a handler reads it through config.binding()/runtimeVar() and
 * answers 503 (or a fallback) when it is absent.
 */
export {};

/** The static-assets binding (ASSETS). */
export interface AssetsBinding {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

/** A Pages Function's env, as the API handlers read it. */
export interface ApiEnv {
  ELECTIONS_DB?: D1Database;
  PRONI_DB?: D1Database;
  PRONI_KV?: KVNamespace;
  SPATIAL_INDEX?: KVNamespace;
  CIVGRAPH_CONTRIBUTION_QUEUE?: KVNamespace;
  MAPS_BUCKET?: R2Bucket;
  CIVGRAPH_SUBMISSIONS?: R2Bucket;
  CIVGRAPH_QUARANTINE?: R2Bucket;
  ASSETS?: AssetsBinding;
  CIVGRAPH_ADMINS?: string;
  CIVGRAPH_CONTRIBUTORS?: string;
  CIVGRAPH_ACCESS_AUD?: string;
  CIVGRAPH_ACCESS_TEAM_DOMAIN?: string;
  CIVGRAPH_ALLOW_DEV_AUTH?: string;
  CIVGRAPH_DEV_AUTH_EMAIL?: string;
  CIVGRAPH_TEST_TRUST_EMAIL_HEADER?: string;
  CIVGRAPH_VERBOSE_ERRORS?: string;
  CIVGRAPH_SSR_RECORDS?: string;
  CIVGRAPH_SSR_PREVIEW?: string;
}

/** The context an API handler receives (Pages' EventContext, as runtime.d.mts names it). */
export type ApiContext<Params extends string = string> = PagesContext<ApiEnv, Params>;

/** A Pages handler: what onRequest / onRequestGet / onRequestPost export. */
export type ApiHandler<Params extends string = string> = (context: ApiContext<Params>) => Promise<Response>;
