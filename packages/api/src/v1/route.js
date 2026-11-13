/**
 * The versioned public API: /api/<version>/*.
 *
 *   GET /api/                  the versions
 *   GET /api/v1/               the v1 index (packages/api/src/v1/v1.js)
 *   GET /api/v1/<route>?...    the /_api/<route> answer, by the same handler (delegate.js)
 *
 * /_api/* keeps answering for good; it is what the site's own pages call. REFACTOR-PLAN.md item 5.
 */
import { V1 } from './v1.js';
import { delegate, jsonAnswer, methodNotAllowed, notFound, segments, versionStatus } from './delegate.js';

/** @type {Readonly<Record<string, import('./delegate.js').VersionApi>>} */
export const VERSIONS = Object.freeze({ v1: V1 });

/** @param {import('../types.js').ApiContext} context */
export async function onRequest(context) {
  const segs = segments(context.params?.['path']);
  if (!segs.length) {
    const method = context.request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(method);
    const res = jsonAnswer({
      api: 'Civgraph',
      current: 'v1',
      versions: Object.values(VERSIONS).map((v) => ({ version: v.version, index: `${v.prefix}/`, status: versionStatus(v) })),
      legacy: { prefix: '/_api', status: 'kept as an alias of the current version\'s routes' },
    });
    return method === 'HEAD' ? new Response(null, res) : res;
  }
  const [version, ...rest] = segs;
  const api = version === undefined ? undefined : VERSIONS[version];
  if (!api) return notFound({ path: new URL(context.request.url).pathname, see: '/api/' });
  return delegate(context, api, rest);
}
