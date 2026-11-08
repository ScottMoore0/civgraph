/**
 * Types the API handlers share, for JSDoc only (functions/tsconfig.check.json). Nothing imports
 * this file at run time: a `.d.ts`, so neither esbuild nor the Pages route table ever reads it.
 *
 *   /** @typedef {import('../types.js').ApiContext} ApiContext *\/
 *
 * The bindings and variables are BINDINGS and RUNTIME_VARS of packages/config/src/config.js (ApiEnv);
 * every one is optional because a handler reads it through config.binding()/runtimeVar() and
 * answers 503 (or a fallback) when it is absent.
 */
export {};

/** The static-assets binding (ASSETS). */
export interface AssetsBinding {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
}

/**
 * A Pages Function's env, as the API handlers read it: CivgraphEnv (functions/_lib/runtime.d.mts),
 * derived from config.js BINDINGS and RUNTIME_VARS, so the list of bindings lives once.
 */
export type ApiEnv = CivgraphEnv;

/** The context an API handler receives (Pages' EventContext, as runtime.d.mts names it). */
export type ApiContext<Params extends string = string> = PagesContext<ApiEnv, Params>;

/** A Pages handler: what onRequest / onRequestGet / onRequestPost export. */
export type ApiHandler<Params extends string = string> = (context: ApiContext<Params>) => Promise<Response>;
