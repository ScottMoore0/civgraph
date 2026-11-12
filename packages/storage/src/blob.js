/**
 * The blob store: one interface over the key-value and object stores the Functions read and
 * write, whatever holds them (REFACTOR-PLAN.md item 4, storage slice ST-2).
 *
 * Implementations:
 *   fromR2(bucket)            a Cloudflare R2 bucket binding (MAPS_BUCKET, CIVGRAPH_SUBMISSIONS, CIVGRAPH_QUARANTINE)
 *   fromKV(namespace)         a Workers KV namespace binding (SPATIAL_INDEX, PRONI_KV, CIVGRAPH_CONTRIBUTION_QUEUE)
 *                             (both in packages/storage/src/blob-bindings.js, with blobStore(env, name),
 *                             which picks one by the binding's kind in packages/config/src/config.js BINDINGS)
 *   memoryBlobStore(entries)  a Map in memory (tests, tools; below)
 *   fsBlobStore(dir)          a folder on disk (packages/storage/src/blob-fs.mjs; Node only)
 *
 * The interface is the part of R2 and KV the Functions use: read a key (as a body, text or
 * JSON), write a key (with a content type, metadata or an expiry), and list keys under a prefix,
 * one page at a time, optionally one "directory" level at a time (a delimiter). Each adapter
 * calls its engine exactly as the handlers called it before they moved here, so their answers
 * are byte for byte what they were. What an engine cannot do is ignored, not emulated, and said
 * so: KV has no content type, R2 has no expiry, R2 listings carry no metadata (the adapter asks
 * R2 for none, `include: []`), KV listings carry no size or upload time.
 *
 * No file system, no Node imports: this file is bundled into Pages Functions. Nothing outside
 * packages/storage/ calls an R2 or KV binding's API (tests/functions/blob-store.test.mjs).
 */

/**
 * @typedef {ReadableStream | Uint8Array | ArrayBuffer | string} BlobBody
 *
 * @typedef {object} BlobObject  one key's value
 * @property {BlobBody} body                 a stream from R2, the stored value elsewhere
 * @property {number | null} size
 * @property {string | null} etag            the HTTP (quoted) etag, when the store keeps one
 * @property {string | null} contentType
 *
 * @typedef {object} BlobEntry  one key of a listing
 * @property {string} key
 * @property {number | null} size
 * @property {string | null} uploaded        ISO 8601, when the store keeps it
 * @property {string | null} etag            the HTTP (quoted) etag, else the bare one, when kept
 * @property {Record<string, unknown> | null} metadata  KV metadata (R2 listings carry none)
 *
 * @typedef {object} BlobListing  one page of a listing
 * @property {BlobEntry[]} entries
 * @property {string[]} prefixes             with a delimiter: the child "directories", each ending in it
 * @property {boolean} truncated             more keys follow: ask again with `cursor`
 * @property {string | null} cursor
 *
 * @typedef {object} BlobListOptions
 * @property {string} [prefix]
 * @property {string} [delimiter]            '/' lists one level; KV ignores it
 * @property {string | undefined} [cursor]
 * @property {number} [limit]                the store's own ceiling applies (1,000 for R2 and KV)
 *
 * @typedef {object} BlobPutOptions
 * @property {string} [contentType]          R2, memory and file stores; KV ignores it
 * @property {Record<string, string>} [metadata]  R2 custom metadata, KV metadata
 * @property {number} [expirationTtl]        seconds; KV only, the others ignore it
 *
 * @typedef {'get' | 'put' | 'list'} BlobOperation
 *
 * @typedef {object} BlobStore
 * @property {string} kind                                  'r2' | 'kv' | 'memory' | 'fs'
 * @property {(op: BlobOperation) => boolean} supports      whether the binding offers the operation
 * @property {(key: string) => Promise<BlobObject | null>} get
 * @property {(key: string) => Promise<string | null>} text
 * @property {(key: string) => Promise<unknown>} json       the parsed value, or null when there is none
 * @property {(key: string, body: string | ArrayBuffer | Uint8Array, options?: BlobPutOptions) => Promise<void>} put
 * @property {(options?: BlobListOptions) => Promise<BlobListing>} list
 */

export const BLOB_STORE_METHODS = Object.freeze(['supports', 'get', 'text', 'json', 'put', 'list']);

/**
 * Throws unless `store` has every BlobStore method; returns it.
 * @template {BlobStore} S
 * @param {S} store
 * @returns {S}
 */
export function assertBlobStore(store) {
  const missing = BLOB_STORE_METHODS.filter((m) => typeof /** @type {Record<string, unknown> | null | undefined} */ (/** @type {unknown} */ (store))?.[m] !== 'function');
  if (missing.length || typeof store?.kind !== 'string') {
    throw new TypeError(`not a BlobStore: missing ${missing.length ? missing.join(', ') : 'kind'}`);
  }
  return store;
}

/** @param {string | ArrayBuffer | Uint8Array} body */
const toBytes = (body) => (typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body.slice() : new Uint8Array(body.slice(0)));

/**
 * Keys under a prefix as one listing page, sorted, with delimited prefixes folded: the listing
 * rules R2 applies, shared by the memory and file stores.
 * @param {string[]} keys
 * @param {BlobListOptions} options
 * @param {(key: string) => BlobEntry} entry
 * @returns {BlobListing}
 */
export function listPage(keys, { prefix = '', delimiter, cursor, limit = 1000 }, entry) {
  /** @type {Array<{ key: string, prefix: boolean }>} */
  const items = [];
  const seen = new Set();
  for (const key of [...keys].filter((k) => k.startsWith(prefix)).sort()) {
    const rest = key.slice(prefix.length);
    const at = delimiter ? rest.indexOf(delimiter) : -1;
    if (delimiter && at >= 0) {
      const child = prefix + rest.slice(0, at + delimiter.length);
      if (!seen.has(child)) { seen.add(child); items.push({ key: child, prefix: true }); }
    } else {
      items.push({ key, prefix: false });
    }
  }
  const start = cursor ? Number(cursor) || 0 : 0;
  const size = Math.max(1, Math.min(1000, Math.floor(limit)));
  const page = items.slice(start, start + size);
  const next = start + page.length;
  const truncated = next < items.length;
  return {
    entries: page.filter((i) => !i.prefix).map((i) => entry(i.key)),
    prefixes: page.filter((i) => i.prefix).map((i) => i.key),
    truncated,
    cursor: truncated ? String(next) : null,
  };
}

/**
 * A BlobStore in memory: for tests and tools. `entries` seeds it (a string or bytes per key).
 * @param {Record<string, string | Uint8Array>} [entries]
 * @returns {BlobStore & { keys: () => string[] }}
 */
export function memoryBlobStore(entries = {}) {
  /** @type {Map<string, { bytes: Uint8Array, contentType: string | null, metadata: Record<string, string> | null, uploaded: string }>} */
  const map = new Map();
  const now = () => new Date().toISOString();
  for (const [key, value] of Object.entries(entries)) map.set(key, { bytes: toBytes(value), contentType: null, metadata: null, uploaded: now() });
  const decode = (/** @type {Uint8Array} */ bytes) => new TextDecoder().decode(bytes);
  const store = {
    kind: 'memory',
    keys: () => [...map.keys()].sort(),
    supports: () => true,
    /** @param {string} key */
    async get(key) {
      const item = map.get(key);
      return item ? { body: item.bytes.slice(), size: item.bytes.byteLength, etag: null, contentType: item.contentType } : null;
    },
    /** @param {string} key */
    async text(key) {
      const item = map.get(key);
      return item ? decode(item.bytes) : null;
    },
    /** @param {string} key */
    async json(key) {
      const item = map.get(key);
      return item ? JSON.parse(decode(item.bytes)) : null;
    },
    /**
     * @param {string} key
     * @param {string | ArrayBuffer | Uint8Array} body
     * @param {BlobPutOptions} [options]
     */
    async put(key, body, { contentType, metadata } = {}) {
      map.set(key, { bytes: toBytes(body), contentType: contentType ?? null, metadata: metadata ?? null, uploaded: now() });
    },
    /** @param {BlobListOptions} [options] */
    async list(options = {}) {
      return listPage([...map.keys()], options, (key) => {
        const item = /** @type {{ bytes: Uint8Array, metadata: Record<string, string> | null, uploaded: string }} */ (map.get(key));
        return { key, size: item.bytes.byteLength, uploaded: item.uploaded, etag: null, metadata: item.metadata };
      });
    },
  };
  return assertBlobStore(store);
}
