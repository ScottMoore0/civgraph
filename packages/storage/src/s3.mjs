/**
 * The BlobStore over an S3-compatible endpoint (packages/storage/src/blob.js): Cloudflare R2's S3
 * API, which the publish scripts upload, list, copy and delete through (storage slice ST-2,
 * REFACTOR-PLAN.md item 4). Bulk work must go through this endpoint, never the Cloudflare REST
 * API, which is rate-limited to about 1.4 requests a second (memory note feedback_r2_upload_path).
 *
 *   const store = await openS3BlobStore({ bucket: r2.bucket, clientOptions: s3ClientOptions(r2, { maxAttempts: 5 }) });
 *   await store.put('data/maps/x.fgb', readFileSync(file), { contentType: 'application/octet-stream' });
 *
 * Credentials are not read here: the scripts get them from .env.local through
 * scripts/publish/r2-env.mjs and pass the client options in, so nothing here prints or keeps them.
 *
 * Each method sends exactly one S3 command shape, the one the scripts sent before they moved here
 * (the same fields in the same order; a field the caller does not give is left out, so the
 * request is what it was). Retries, concurrency and skip-if-unchanged stay in the scripts: the
 * client's own retries are its `maxAttempts` option. The publish-s3-dry-run unit test
 * runs every moved script against a recording stand-in for the SDK and compares the calls with
 * the ones main's scripts made.
 *
 * Besides the BlobStore methods it offers what the publish chain needs and R2's bindings do not:
 * `head` (an object's size, ETag, headers and metadata), `listAll` (every entry under a prefix,
 * paging for the caller), `copy` (server side, no download), `deleteMany` (1,000 keys a
 * request) and `putMultipart` (one object in equal parts, read one at a time: large single PUTs
 * from Node fail on the owner's network with a TLS bad_record_mac error, and 8 MiB parts work).
 * The SDK is imported only when a store is opened, so a dry run that never opens one never loads
 * it.
 *
 * Node only (the SDK), so it is not part of the runtime entry (index.js).
 */
import { assertBlobStore } from './blob.js';

/** @typedef {import('@aws-sdk/client-s3').S3Client} S3Client */
/** @typedef {import('@aws-sdk/client-s3').S3ClientConfig} S3ClientConfig */
/**
 * The command classes a store sends (the SDK's, or a test's stand-ins).
 * @typedef {Pick<typeof import('@aws-sdk/client-s3'), 'GetObjectCommand' | 'PutObjectCommand' | 'HeadObjectCommand' | 'ListObjectsV2Command' | 'CopyObjectCommand' | 'DeleteObjectsCommand'
 *   | 'CreateMultipartUploadCommand' | 'UploadPartCommand' | 'CompleteMultipartUploadCommand' | 'AbortMultipartUploadCommand'>} S3Commands
 */
/**
 * A body S3 accepts: bytes (a Buffer is sent as it is), text, or a stream for a file too big to
 * hold in memory (a stream cannot be replayed, so neither the client nor a caller can retry it).
 * @typedef {string | Uint8Array | ArrayBuffer | import('node:stream').Readable} S3Body
 */
/**
 * @typedef {import('./blob.js').BlobPutOptions & {
 *   cacheControl?: string,
 *   contentEncoding?: string,
 *   contentLength?: number,
 * }} S3PutOptions  `metadata` is the object's x-amz-meta-* (string values); `contentLength` is sent when given (a stream body needs it)
 */
/**
 * What putMultipart reads an object from: its size, and its bytes a part at a time (a file
 * handle's read, say), so a large file is never held whole.
 * @typedef {object} S3PartSource
 * @property {number} size
 * @property {(offset: number, length: number) => Promise<Uint8Array>} read
 */
/**
 * @typedef {Omit<S3PutOptions, 'contentLength'> & { partSize: number }} S3MultipartOptions
 *   every part but the last is `partSize` bytes (R2 wants equal parts; S3 wants 5 MiB or more)
 */
/**
 * One object's headers, from a HEAD request.
 * @typedef {object} S3Head
 * @property {number | undefined} size            Content-Length, as the endpoint sent it
 * @property {string | null} etag                 the quoted ETag
 * @property {string | null} contentType
 * @property {string | null} cacheControl
 * @property {string | null} contentEncoding
 * @property {Record<string, string> | null} metadata  x-amz-meta-*, as the SDK returns it
 */
/**
 * What a server-side copy sets. With `metadataDirective: 'COPY'` the object's headers and
 * metadata go across unchanged; with 'REPLACE' only what is given here is kept.
 * @typedef {object} S3CopyOptions
 * @property {'COPY' | 'REPLACE'} [metadataDirective]
 * @property {string} [cacheControl]
 * @property {string} [contentType]
 * @property {string} [contentEncoding]
 * @property {Record<string, string>} [metadata]
 */
/**
 * @typedef {import('./blob.js').BlobStore & {
 *   bucket: string,
 *   put: (key: string, body: S3Body, options?: S3PutOptions) => Promise<void>,
 *   putMultipart: (key: string, source: S3PartSource, options: S3MultipartOptions) => Promise<{ parts: number }>,
 *   head: (key: string, options?: { missing?: 'null' | 'throw' }) => Promise<S3Head | null>,
 *   listAll: (options?: Omit<import('./blob.js').BlobListOptions, 'cursor'>) => AsyncGenerator<import('./blob.js').BlobEntry>,
 *   copy: (fromKey: string, toKey: string, options?: S3CopyOptions) => Promise<void>,
 *   deleteMany: (keys: string[]) => Promise<{ errors: Array<{ key: string | null, code: string | null, message: string | null }> }>,
 * }} S3BlobStore
 */

/** DeleteObjects takes at most 1,000 keys a request. */
export const S3_DELETE_BATCH = 1000;

/**
 * The CopySource of a key in a bucket: each path segment URL-encoded, the slashes kept.
 * @param {string | undefined} bucket
 * @param {string} key
 */
export function copySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Whether an SDK error means "no such object": a 404, which the SDK names NotFound on a HEAD
 * (it has no body to name it by) and NoSuchKey on a GET.
 * @param {unknown} error
 */
export function isNotFound(error) {
  const failure = /** @type {{ $metadata?: { httpStatusCode?: number }, name?: string } | null | undefined} */ (error);
  return failure?.$metadata?.httpStatusCode === 404 || failure?.name === 'NotFound' || failure?.name === 'NoSuchKey';
}

/**
 * @param {unknown} body  a GetObject body (the SDK's stream with its transform helpers)
 * @returns {Promise<Uint8Array<ArrayBuffer>>}
 */
async function bytesOf(body) {
  const stream = /** @type {{ transformToByteArray?: () => Promise<Uint8Array> } | null | undefined} */ (body);
  if (!stream || typeof stream.transformToByteArray !== 'function') return new Uint8Array(0);
  const bytes = await stream.transformToByteArray();
  return new Uint8Array(bytes);
}

/**
 * The BlobStore over one bucket, sending through `client` (an S3Client) with `commands` (the
 * SDK's command classes): both are given, so a test can pass stand-ins and no SDK is loaded.
 * Use openS3BlobStore() to make the client from options.
 * @param {{ bucket: string, client: S3Client, commands: S3Commands }} options
 * @returns {S3BlobStore}
 */
export function s3BlobStore({ bucket, client, commands }) {
  if (!client || typeof client.send !== 'function') throw new TypeError('s3BlobStore(): not an S3 client');
  /** @param {string} key */
  const get = async (key) => {
    try {
      return await client.send(new commands.GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };
  /** @param {import('./blob.js').BlobListOptions} [options] */
  const list = async ({ prefix = '', delimiter, cursor, limit } = {}) => {
    /** @type {import('@aws-sdk/client-s3').ListObjectsV2CommandInput} */
    const input = { Bucket: bucket, Prefix: prefix, ContinuationToken: cursor || undefined };
    if (limit !== undefined) input.MaxKeys = limit;
    if (delimiter !== undefined) input.Delimiter = delimiter;
    const page = await client.send(new commands.ListObjectsV2Command(input));
    const truncated = Boolean(page.IsTruncated);
    return {
      // A listed object always has its Key.
      entries: (page.Contents || []).map((o) => ({
        key: /** @type {string} */ (o.Key),
        size: typeof o.Size === 'number' ? o.Size : null,
        uploaded: o.LastModified instanceof Date ? o.LastModified.toISOString() : null,
        etag: o.ETag || null,
        metadata: null,
      })),
      prefixes: (page.CommonPrefixes || []).map((p) => String(p.Prefix)),
      truncated,
      cursor: truncated ? page.NextContinuationToken || null : null,
    };
  };
  /** @type {S3BlobStore} */
  const store = {
    kind: 's3',
    bucket,
    supports: () => true,
    async get(key) {
      const res = await get(key);
      if (!res) return null;
      const body = await bytesOf(res.Body);
      return { body, size: body.byteLength, etag: res.ETag || null, contentType: res.ContentType || null };
    },
    async text(key) {
      const res = await get(key);
      return res ? new TextDecoder().decode(await bytesOf(res.Body)) : null;
    },
    async json(key) {
      const res = await get(key);
      return res ? JSON.parse(new TextDecoder().decode(await bytesOf(res.Body))) : null;
    },
    /**
     * @param {string} key
     * @param {S3Body} body
     * @param {S3PutOptions} [options]
     */
    async put(key, body, { contentType, contentEncoding, cacheControl, metadata, contentLength } = {}) {
      /** @type {import('@aws-sdk/client-s3').PutObjectCommandInput} */
      const input = { Bucket: bucket, Key: key, Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body };
      if (contentLength !== undefined) input.ContentLength = contentLength;
      if (contentType !== undefined) input.ContentType = contentType;
      if (contentEncoding !== undefined) input.ContentEncoding = contentEncoding;
      if (cacheControl !== undefined) input.CacheControl = cacheControl;
      if (metadata !== undefined) input.Metadata = /** @type {Record<string, string>} */ (metadata);
      await client.send(new commands.PutObjectCommand(input));
    },
    /**
     * One object in parts: CreateMultipartUpload (with the headers given), an UploadPart per
     * part in order, each read from `source` when it is sent, then CompleteMultipartUpload. If
     * anything fails the upload is aborted (an abort that fails too is left for the bucket's
     * own expiry) and the error is thrown; the object is then as it was before. The client's
     * own retries (its maxAttempts) cover each part, whose body is bytes and so can be resent.
     * @param {string} key
     * @param {S3PartSource} source
     * @param {S3MultipartOptions} options
     */
    async putMultipart(key, { size, read }, { partSize, contentType, contentEncoding, cacheControl, metadata }) {
      if (!(Number.isInteger(partSize) && partSize > 0)) throw new RangeError(`putMultipart(): partSize must be a positive whole number of bytes, not ${partSize}`);
      if (!(Number.isInteger(size) && size > 0)) throw new RangeError(`putMultipart(): ${key} has no bytes to send (size ${size})`);
      /** @type {import('@aws-sdk/client-s3').CreateMultipartUploadCommandInput} */
      const create = { Bucket: bucket, Key: key };
      if (contentType !== undefined) create.ContentType = contentType;
      if (contentEncoding !== undefined) create.ContentEncoding = contentEncoding;
      if (cacheControl !== undefined) create.CacheControl = cacheControl;
      if (metadata !== undefined) create.Metadata = /** @type {Record<string, string>} */ (metadata);
      const { UploadId } = await client.send(new commands.CreateMultipartUploadCommand(create));
      if (!UploadId) throw new Error(`putMultipart(): no UploadId for ${key}`);
      /** @type {Array<{ ETag: string | undefined, PartNumber: number }>} */
      const parts = [];
      try {
        for (let offset = 0, partNumber = 1; offset < size; offset += partSize, partNumber += 1) {
          const length = Math.min(partSize, size - offset);
          const body = await read(offset, length);
          if (body.byteLength !== length) throw new Error(`putMultipart(): read ${body.byteLength} of ${length} bytes at ${offset} of ${key}`);
          const res = await client.send(new commands.UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber: partNumber, Body: body, ContentLength: length }));
          parts.push({ ETag: res.ETag, PartNumber: partNumber });
        }
        await client.send(new commands.CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
      } catch (error) {
        try {
          await client.send(new commands.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId }));
        } catch {
          // Left for the bucket to expire; the first error is the one to report.
        }
        throw error;
      }
      return { parts: parts.length };
    },
    list,
    async *listAll(options = {}) {
      /** @type {string | undefined} */
      let cursor;
      do {
        const page = await list({ ...options, cursor });
        for (const entry of page.entries) yield entry;
        cursor = page.cursor || undefined;
      } while (cursor);
    },
    async head(key, { missing = 'null' } = {}) {
      try {
        const res = await client.send(new commands.HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          size: res.ContentLength,
          etag: res.ETag || null,
          contentType: res.ContentType || null,
          cacheControl: res.CacheControl || null,
          contentEncoding: res.ContentEncoding || null,
          metadata: res.Metadata || null,
        };
      } catch (error) {
        if (missing === 'null' && isNotFound(error)) return null;
        throw error;
      }
    },
    async copy(fromKey, toKey, { metadataDirective, cacheControl, contentType, contentEncoding, metadata } = {}) {
      /** @type {import('@aws-sdk/client-s3').CopyObjectCommandInput} */
      const input = { Bucket: bucket, Key: toKey, CopySource: copySource(bucket, fromKey) };
      if (metadataDirective !== undefined) input.MetadataDirective = metadataDirective;
      if (cacheControl !== undefined) input.CacheControl = cacheControl;
      if (contentType !== undefined) input.ContentType = contentType;
      if (contentEncoding !== undefined) input.ContentEncoding = contentEncoding;
      if (metadata !== undefined) input.Metadata = metadata;
      await client.send(new commands.CopyObjectCommand(input));
    },
    async deleteMany(keys) {
      /** @type {Array<{ key: string | null, code: string | null, message: string | null }>} */
      const errors = [];
      for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
        const chunk = keys.slice(i, i + S3_DELETE_BATCH);
        const res = await client.send(new commands.DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
        for (const e of res.Errors || []) errors.push({ key: e.Key ?? null, code: e.Code ?? null, message: e.Message ?? null });
      }
      return { errors };
    },
  };
  return assertBlobStore(store);
}

/**
 * Open the store over `bucket` with a new S3Client made from `clientOptions` (region, endpoint,
 * credentials and client settings such as maxAttempts: scripts/publish/r2-env.mjs
 * s3ClientOptions). The SDK is imported here, on first use.
 * @param {{ bucket: string, clientOptions: S3ClientConfig }} options
 * @returns {Promise<S3BlobStore>}
 */
export async function openS3BlobStore({ bucket, clientOptions }) {
  const sdk = await import('@aws-sdk/client-s3');
  return s3BlobStore({ bucket, client: new sdk.S3Client(clientOptions), commands: sdk });
}
