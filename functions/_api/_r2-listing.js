/**
 * Shared R2 listing, used by both the gated and the public index.
 *
 * WHY A LISTING ENDPOINT EXISTS AT ALL
 *
 * R2 public buckets cannot list. Neither r2.dev nor a custom domain exposes ListObjects, so
 * https://data.civgraph.net/ and /data/ both 404 identically -- the bucket is readable by
 * key and not enumerable. That is not a setting that can be turned on; enumeration has to
 * be served by something holding the bucket binding, which is this.
 *
 * DELIMITED, NEVER FLAT
 *
 * The bucket holds about 1.93 million objects, most of them feature thumbnails and
 * point-cloud tiles. A flat listing would be hundreds of megabytes, useless to a reader,
 * and would exhaust the request before finishing. Every call therefore passes
 * delimiter: '/', so one request describes one directory level: its immediate child
 * prefixes and the objects sitting directly in it.
 *
 * PAGINATION IS NOT OPTIONAL. R2 list() returns at most 1,000 entries per call and sets
 * truncated with a cursor. A prefix with 100k objects is 100 round trips, so the cursor is
 * surfaced to the caller rather than looped here: looping would move the timeout from the
 * client to the edge, where it fails less visibly.
 *
 * COST. list is a Class A operation, the more expensive tier. A person browsing is
 * negligible; an unattended crawler is not, which is why the public route caches and the
 * gated route sits behind Access.
 */

/** Hard ceiling per request. R2 itself caps at 1000; asking for more is silently clamped. */
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

/** Normalise a caller-supplied prefix: no leading slash, no traversal, no wildcards. */
export function normalisePrefix(raw) {
  const value = String(raw || '').replace(/^\/+/, '');
  if (!value) return '';
  if (value.includes('..') || value.includes('\0')) return null;
  return value;
}

export function parseLimit(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * List one directory level of the bucket.
 *
 * @param {R2Bucket} bucket
 * @param {{prefix?: string, cursor?: string, limit?: number}} options
 */
export async function listLevel(bucket, { prefix = '', cursor, limit = DEFAULT_LIMIT } = {}) {
  const listing = await bucket.list({
    prefix,
    delimiter: '/',
    cursor: cursor || undefined,
    limit,
    // Custom metadata and http metadata are not needed for an index and cost payload size.
    include: [],
  });

  const folders = (listing.delimitedPrefixes || []).map((value) => ({
    prefix: value,
    name: value.slice(prefix.length).replace(/\/$/, ''),
  }));

  const files = (listing.objects || [])
    // An object whose key IS the prefix is the folder placeholder, not a file in it.
    .filter((object) => object.key !== prefix)
    .map((object) => ({
      key: object.key,
      name: object.key.slice(prefix.length),
      size: object.size,
      uploaded: object.uploaded instanceof Date ? object.uploaded.toISOString() : object.uploaded,
      etag: object.httpEtag || object.etag || null,
    }));

  return {
    prefix,
    folders,
    files,
    truncated: Boolean(listing.truncated),
    cursor: listing.truncated ? listing.cursor : null,
  };
}

/** Public URL for a key on the R2 custom domain. */
export function publicUrl(key) {
  return `https://data.civgraph.net/${String(key).replace(/^\/+/, '')}`;
}
