/**
 * The BlobStore over the Cloudflare bindings (packages/storage/src/blob.js): R2 buckets and
 * Workers KV namespaces, as d1.js is the RecordStore over D1.
 *
 *   const store = blobStore(context.env, 'MAPS_BUCKET');   // null when the binding is absent
 *   const object = await store?.get('data/maps/x.fgb');
 *
 * Each adapter calls its binding exactly as the handlers called it before they moved here (the
 * same method, arguments and option objects), so their answers are what they were.
 */
import { BINDINGS, binding } from '../../config/src/config.js';
import { assertBlobStore } from './blob.js';

/**
 * The operations a binding object offers (a test's stand-in may offer only some).
 * @param {object} target
 * @returns {(op: import('./blob.js').BlobOperation) => boolean}
 */
const offers = (target) => (op) => typeof /** @type {Record<string, unknown>} */ (target)[op] === 'function';

/**
 * The BlobStore over an R2 bucket binding.
 * @param {R2Bucket} bucket
 * @returns {import('./blob.js').BlobStore}
 */
export function fromR2(bucket) {
  if (!bucket || typeof bucket !== 'object') throw new TypeError('fromR2(): not an R2 binding');
  return assertBlobStore({
    kind: 'r2',
    supports: offers(bucket),
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return {
        body: object.body,
        size: typeof object.size === 'number' ? object.size : null,
        etag: object.httpEtag || null,
        contentType: object.httpMetadata?.contentType ?? null,
      };
    },
    async text(key) {
      const object = await bucket.get(key);
      return object ? object.text() : null;
    },
    async json(key) {
      const object = await bucket.get(key);
      return object ? object.json() : null;
    },
    async put(key, body, { contentType, metadata } = {}) {
      /** @type {Record<string, unknown>} */
      const options = {};
      if (contentType !== undefined) options['httpMetadata'] = { contentType };
      if (metadata !== undefined) options['customMetadata'] = metadata;
      await bucket.put(key, body, options);
    },
    async list({ prefix = '', delimiter, cursor, limit } = {}) {
      /** @type {Parameters<R2Bucket['list']>[0] & {}} */
      const options = { prefix };
      if (delimiter !== undefined) options.delimiter = delimiter;
      options.cursor = cursor || undefined;
      if (limit !== undefined) options.limit = limit;
      // Custom metadata and http metadata are not needed for a listing and cost payload size.
      options.include = [];
      const listing = await bucket.list(options);
      return {
        entries: (listing.objects || []).map((object) => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded instanceof Date ? object.uploaded.toISOString() : (object.uploaded ?? null),
          etag: object.httpEtag || object.etag || null,
          metadata: null,
        })),
        prefixes: listing.delimitedPrefixes || [],
        truncated: Boolean(listing.truncated),
        cursor: listing.truncated ? (listing.cursor || null) : null,
      };
    },
  });
}

/**
 * The BlobStore over a Workers KV namespace binding.
 * @param {KVNamespace} namespace
 * @returns {import('./blob.js').BlobStore}
 */
export function fromKV(namespace) {
  if (!namespace || typeof namespace !== 'object') throw new TypeError('fromKV(): not a KV binding');
  return assertBlobStore({
    kind: 'kv',
    supports: offers(namespace),
    async get(key) {
      const value = /** @type {string | null} */ (await namespace.get(key));
      return value === null || value === undefined ? null : { body: value, size: null, etag: null, contentType: null };
    },
    async text(key) {
      return /** @type {string | null} */ ((await namespace.get(key)) ?? null);
    },
    async json(key) {
      return (await namespace.get(key, 'json')) ?? null;
    },
    async put(key, body, { metadata, expirationTtl } = {}) {
      /** @type {{ metadata?: unknown, expirationTtl?: number }} */
      const options = {};
      if (metadata !== undefined) options.metadata = metadata;
      if (expirationTtl !== undefined) options.expirationTtl = expirationTtl;
      await namespace.put(key, body instanceof Uint8Array ? /** @type {ArrayBuffer} */ (body.slice().buffer) : body, options);
    },
    async list({ prefix = '', cursor, limit } = {}) {
      /** @type {{ prefix: string, limit?: number, cursor?: string | undefined }} */
      const options = { prefix };
      if (limit !== undefined) options.limit = limit;
      options.cursor = cursor;
      const listing = await namespace.list(options);
      return {
        entries: (listing.keys || []).map((key) => ({
          key: key.name,
          size: null,
          uploaded: null,
          etag: null,
          metadata: /** @type {Record<string, unknown> | null} */ (key.metadata ?? null),
        })),
        prefixes: [],
        truncated: !listing.list_complete,
        cursor: listing.list_complete ? null : (listing.cursor || null),
      };
    },
  });
}

/**
 * The BlobStore over a binding of the Function's env, by its name in config.js BINDINGS: an R2
 * bucket or a KV namespace by the binding's kind. Null when the binding is absent.
 * @param {object | null | undefined} env
 * @param {keyof typeof BINDINGS} name
 * @returns {import('./blob.js').BlobStore | null}
 */
export function blobStore(env, name) {
  const kind = BINDINGS[name]?.kind;
  if (kind !== 'r2' && kind !== 'kv') throw new Error(`blobStore(): ${name} is not an R2 or KV binding`);
  const bound = /** @type {object | null} */ (binding(env, name));
  if (!bound) return null;
  return kind === 'r2' ? fromR2(/** @type {R2Bucket} */ (bound)) : fromKV(/** @type {KVNamespace} */ (bound));
}
