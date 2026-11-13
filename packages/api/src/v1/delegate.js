/**
 * Serving a versioned API path by delegating to an existing handler, unchanged.
 *
 * REFACTOR-PLAN.md item 5. A version (packages/api/src/v1/v1.js) is a table of routes; each names
 * the handler module of the original `/_api/*` route and that route's path. A request for
 * `/api/v1/<route>[/<rest>]?<query>` is handed to that module as a GET of
 * `/_api/<route>[/<rest>]?<query>`, so:
 *   - the answer is the legacy answer, byte for byte (tests/functions/api-v1.test.mjs);
 *   - the records cache (packages/api/src/handlers/_records.js, keyed on the request URL) is shared by both
 *     spellings, and D1 is read once for either;
 *   - a redirect to another legacy API path comes back as the versioned path.
 *
 * Every versioned route is read-only: GET and HEAD. Anything else is 405 here, before any
 * handler runs, so a version can never expose a write the table did not mean to.
 */
import { CACHE } from '../../../config/src/config.js';

export const ALLOW = 'GET, HEAD';

/**
 * A version's status (refactor FN-L), from its own fields: 'stable' while it is current,
 * 'superseded' once a successor exists, 'sunset' once the owner has set a sunset date.
 * @typedef {'stable' | 'superseded' | 'sunset'} VersionStatus
 */
export const VERSION_STATUSES = Object.freeze(/** @type {VersionStatus[]} */ (['stable', 'superseded', 'sunset']));

/**
 * @param {{ successor?: unknown, sunset?: string | null }} api
 * @returns {VersionStatus}
 */
export function versionStatus(api) {
  if (api.sunset) return 'sunset';
  return api.successor ? 'superseded' : 'stable';
}

/** @typedef {import('../types.js').ApiContext} ApiContext */
/** @typedef {Readonly<import('./v1.js').V1Route>} Route */
/** @typedef {Readonly<Record<string, Route>>} Routes a version's routes, by their path under the version */
/**
 * A version of the API, as delegate() serves it (v1.js V1).
 * @typedef {object} VersionApi
 * @property {string} version
 * @property {string} prefix
 * @property {string} [legacyPrefix]
 * @property {Routes} routes
 * @property {(context: ApiContext) => Response} index the version's index document
 * @property {Readonly<Record<string, (context: ApiContext) => Response>>} [documents] served at <prefix>/<name> before any route
 * @property {{ prefix: string, routes: Record<string, unknown> } | null} [successor]
 * @property {string | null} [sunset]
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

/**
 * @param {unknown} payload
 * @param {number} [status]
 * @param {Record<string, string>} [extra] more headers
 */
export function jsonAnswer(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload, null, status === 200 ? 2 : 0), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': status === 200 ? 'public, max-age=300' : CACHE.error, ...extra },
  });
}

export const notFound = (/** @type {Record<string, unknown>} */ detail) => jsonAnswer({ ok: false, error: 'Not found', ...detail }, 404);

/** @param {string} method */
export function methodNotAllowed(method) {
  return jsonAnswer({ ok: false, error: `Method ${method} is not allowed; this API is read-only.` }, 405, { Allow: ALLOW });
}

/**
 * The path segments of a catch-all route's params, whatever shape the runtime gives them.
 * @param {string | string[] | null | undefined} path
 * @returns {string[]}
 */
export function segments(path) {
  const list = Array.isArray(path) ? path : String(path ?? '').split('/');
  return list.map((s) => String(s)).filter((s) => s !== '');
}

/**
 * The route for a list of segments under a version: an exact route ('proni/node'), or a
 * catch-all route ('layers') with the segments after it. null when nothing matches.
 * @param {Routes} routes
 * @param {string[]} segs
 * @returns {{ key: string, route: Route, rest: string[] } | null}
 */
export function matchRoute(routes, segs) {
  for (let n = segs.length; n > 0; n -= 1) {
    const key = segs.slice(0, n).join('/');
    const route = routes[key];
    if (!route) continue;
    const rest = segs.slice(n);
    if (rest.length && !route.catchAll) return null;
    return { key, route, rest };
  }
  return null;
}

/**
 * Rewrite a Location that points at a legacy API path into the versioned one, when the version
 * has a route for it; anything else is left as it is.
 * @param {string} location
 * @param {string} requestUrl
 * @param {Routes} routes
 * @param {string} prefix the version's prefix (/api/v1)
 * @param {string} [legacyPrefix]
 * @returns {string}
 */
export function rewriteLocation(location, requestUrl, routes, prefix, legacyPrefix = '/_api') {
  if (!location) return location;
  let target;
  try { target = new URL(location, requestUrl); } catch { return location; }
  const origin = new URL(requestUrl).origin;
  if (target.origin !== origin || !target.pathname.startsWith(`${legacyPrefix}/`)) return location;
  const segs = segments(target.pathname.slice(legacyPrefix.length));
  // The route whose legacy path is the longest prefix of the target's.
  /** @type {{ key: string, route: Route, length: number } | null} */
  let best = null;
  for (const [key, route] of Object.entries(routes)) {
    const legacySegs = segments(route.legacy.slice(legacyPrefix.length));
    const prefixes = legacySegs.every((s, i) => segs[i] === s);
    if (prefixes && (!best || legacySegs.length > best.length)) best = { key, route, length: legacySegs.length };
  }
  if (!best) return location;
  const { key, route } = best;
  const rest = segs.slice(best.length);
  if (rest.length && !route.catchAll) return location;
  const rewritten = new URL(`${prefix}/${[key, ...rest].join('/')}${target.search}${target.hash}`, origin);
  // Keep the form the handler used: absolute stays absolute, a path stays a path.
  return /^[a-z][a-z0-9+.-]*:/i.test(location) ? rewritten.toString() : `${rewritten.pathname}${rewritten.search}${rewritten.hash}`;
}

/**
 * A path segment in URL form, whether the runtime handed it over decoded or not.
 * @param {string} segment
 */
function pathSegment(segment) {
  try { return encodeURIComponent(decodeURIComponent(segment)); } catch { return encodeURIComponent(segment); }
}

/**
 * The successor-version and sunset headers of a versioned answer (REFACTOR-PLAN.md API-5).
 * A route the successor also serves points at its successor path, the same subpath and query;
 * a route the successor dropped gets no Link. Sunset only when the version names a date.
 * @param {{ successor?: { prefix: string, routes: Record<string, unknown> } | null, sunset?: string | null }} api
 * @param {string} key          the route's key in this version
 * @param {string[]} rest       the subpath after it
 * @param {string} search       the request's query string, with its '?'
 * @returns {Record<string, string>}
 */
export function lifecycleHeaders(api, key, rest, search) {
  /** @type {Record<string, string>} */
  const out = {};
  const next = api.successor;
  if (next && Object.hasOwn(next.routes, key)) {
    out['Link'] = `<${next.prefix}/${[key, ...rest.map(pathSegment)].join('/')}${search}>; rel="successor-version"`;
  }
  if (api.sunset) out['Sunset'] = api.sunset;
  return out;
}

/**
 * Answer one versioned request.
 * @param {ApiContext} context  the Pages Function context
 * @param {VersionApi} api
 * @param {string[]} segs       the segments after the version
 * @returns {Promise<Response>}
 */
export async function delegate(context, api, segs) {
  const { request } = context;
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(method);
  const head = method === 'HEAD';
  const strip = (/** @type {Response} */ res) => (head ? new Response(null, res) : res);

  if (!segs.length) return strip(api.index(context));
  const document = segs.length === 1 && api.documents && Object.hasOwn(api.documents, /** @type {string} */ (segs[0])) ? api.documents[/** @type {string} */ (segs[0])] : null;
  if (document) return strip(document(context));

  const match = matchRoute(api.routes, segs);
  if (!match) return notFound({ path: new URL(request.url).pathname, see: `${api.prefix}/` });
  const { route, rest } = match;
  const handler = route.module.onRequestGet || route.module.onRequest;
  if (typeof handler !== 'function') return notFound({ path: new URL(request.url).pathname });

  const url = new URL(request.url);
  const legacy = new URL(`${route.legacy}${rest.length ? `/${rest.map(pathSegment).join('/')}` : ''}${url.search}`, url.origin);
  const headers = new Headers(request.headers);
  const legacyRequest = new Request(legacy.toString(), { method: 'GET', headers });
  const params = route.catchAll ? { path: rest } : {};
  /** @type {ApiContext} */
  const ctx = {
    request: legacyRequest,
    env: context.env,
    params,
    data: context.data ?? {},
    functionPath: route.legacy,
    waitUntil: (promise) => context.waitUntil?.(promise),
    passThroughOnException: () => context.passThroughOnException?.(),
    next: (input, init) => context.next(input, init),
  };

  const res = await handler(ctx);
  const out = new Response(head ? null : res.body, res);
  out.headers.set('API-Version', api.version);
  for (const [name, value] of Object.entries(lifecycleHeaders(api, match.key, rest, url.search))) out.headers.set(name, value);
  const location = out.headers.get('Location');
  if (location) out.headers.set('Location', rewriteLocation(location, request.url, api.routes, api.prefix, api.legacyPrefix));
  return out;
}
