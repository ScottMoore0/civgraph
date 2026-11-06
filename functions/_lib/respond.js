/**
 * HTML responses for server-rendered pages: Content-Type, Cache-Control, a strong ETag over
 * the body and a 304 for a matching If-None-Match.
 *
 * The HTML twin of the data design's cachedJson wrapper (functions/_api/_records.js, D2).
 * The ETag folds in the template version and, once D2 writes it, the dataset version, so a
 * template change or a publish gives every page a new tag. The edge Cache API (cache key =
 * URL + code version + dataset version, no put while dataset.loading is set, last-good copy
 * on D1 errors) arrives with that wrapper; until then pages carry the same browser caching
 * the head-only Browse pages always had.
 */

/** Bump when a record template changes what it renders. */
export const TEMPLATE_VERSION = 'records-1';

let datasetCache = { at: 0, value: null };

/**
 * The loaded dataset's version from D1's `dataset` table (data design 3.2), read at most
 * once a minute per isolate; null while the table does not exist (before D2).
 */
export async function datasetVersion(db, now = Date.now()) {
  if (!db) return null;
  if (now - datasetCache.at < 60_000) return datasetCache.value;
  let value = null;
  try {
    const row = await db.prepare("SELECT value FROM dataset WHERE key = 'version'").first();
    value = row?.value ?? null;
  } catch {
    value = null;
  }
  datasetCache = { at: now, value };
  return value;
}

/** For tests: forget the cached dataset version. */
export function resetDatasetVersionCache() {
  datasetCache = { at: 0, value: null };
}

async function sha1Hex(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

/**
 * @param {Request} request
 * @param {string} body
 * @param {object} [options]
 * @param {number} [options.status]
 * @param {string} [options.cacheControl]
 * @param {string|null} [options.datasetVersion]
 */
export async function htmlResponse(request, body, { status = 200, cacheControl = 'public, max-age=300', datasetVersion: dv = null } = {}) {
  const etag = `"${TEMPLATE_VERSION}-${dv || 'files'}-${await sha1Hex(body)}"`;
  const headers = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  const match = request.headers.get('If-None-Match');
  if (status === 200 && match && match.split(/\s*,\s*/).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status, headers });
}
