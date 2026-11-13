// A recording stand-in for @aws-sdk/client-s3: no network, ever. It keeps a bucket in memory,
// answers as R2's S3 endpoint does (sorted, paged listings; 404 NotFound on a HEAD of a missing
// key; server-side copies), and logs every command with its bucket, key, body hash and size,
// headers, metadata, copy source and list parameters. A multipart upload is logged command by
// command (each part with its size and hash), and its CompleteMultipartUpload also carries the
// object it made as `written` (key, size, SHA-256 of the whole, headers, metadata).
//
// Two ways in:
//   - in a test: createFakeS3({ state }) gives the S3Client and command classes, with `calls`;
//   - in a script run by harness.mjs (beside this file): register.mjs points every import
//     of '@aws-sdk/client-s3' here, and this module's own exports read the bucket from the JSON
//     file in S3_FAKE_STATE and append each call, one JSON line, to the file in S3_FAKE_LOG.
//
// State: { pageSize?: number, objects?: { [key]: Seed }, fail?: Failure[], deleteErrors?: DeleteError[] }
//   Seed     { body?: string, size?: number, etag?: string, contentType?, cacheControl?,
//              contentEncoding?, metadata?: {} }   (size alone: an object whose bytes are not held)
//   Failure  { op: 'PutObject' | 'HeadObject' | ..., key: string, times?: number (default 1),
//              status?: number (500), name?: string ('InternalError') }
//   DeleteError { key: string, code?: string ('AccessDenied'), message?: string ('Access Denied') }
//              a DeleteObjects request answers 200 and lists this key in its Errors, as R2
//              does for a key it could not delete; the object stays
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const LAST_MODIFIED = new Date(Date.UTC(2026, 10, 1));
/** A list this long or longer is logged as its count and hash, not item by item. */
const LONG_LIST = 50;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');

/** Body bytes and how they were given (a Buffer, other bytes, text or a stream). */
async function readBody(body) {
  if (body === undefined || body === null) return { kind: 'none', bytes: Buffer.alloc(0) };
  if (typeof body === 'string') return { kind: 'string', bytes: Buffer.from(body) };
  if (Buffer.isBuffer(body)) return { kind: 'buffer', bytes: body };
  if (body instanceof Uint8Array) return { kind: 'bytes', bytes: Buffer.from(body) };
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const hash = createHash('sha256');
    const sum = createHash('md5');
    let size = 0;
    for await (const chunk of body) { hash.update(chunk); sum.update(chunk); size += chunk.length; }
    return { kind: 'stream', digest: { size, sha256: hash.digest('hex'), md5: sum.digest('hex') } };
  }
  throw new TypeError(`s3-fake: unsupported body ${Object.prototype.toString.call(body)}`);
}

/** A command input as logged: the body as its kind, size and hash; long key lists folded. */
function loggable(input, body) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (v === undefined) continue;
    if (k === 'Body') out.Body = body;
    else if (k === 'Delete' && Array.isArray(v?.Objects) && v.Objects.length >= LONG_LIST) {
      out.Delete = { ...v, Objects: { count: v.Objects.length, sha256: sha256(JSON.stringify(v.Objects)), first: v.Objects[0], last: v.Objects.at(-1) } };
    } else out[k] = v;
  }
  return out;
}

/** The client options as logged: the settings, and only whether the credentials are the test ones. */
function loggableConfig(config = {}) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (k === 'credentials') {
      out.credentials = v && v.accessKeyId === 'test-access-key-id' && v.secretAccessKey === 'test-secret-access-key' ? 'test credentials' : 'OTHER CREDENTIALS';
    } else out[k] = v;
  }
  return out;
}

const fault = (name, status, message = name) => Object.assign(new Error(message), { name, $fault: status >= 500 ? 'server' : 'client', $metadata: { httpStatusCode: status } });

/**
 * A fake SDK over one in-memory bucket.
 * @param {{ state?: object, log?: (entry: object) => void }} [options]
 */
export function createFakeS3({ state = {}, log } = {}) {
  const calls = [];
  const record = log || ((entry) => calls.push(entry));
  const pageSize = state.pageSize || 1000;
  /** @type {Map<string, { bucket: string, bytes: Buffer | null, size: number, etag: string, contentType?: string, cacheControl?: string, contentEncoding?: string, metadata: Record<string, string> }>} */
  const objects = new Map();
  for (const [key, seed] of Object.entries(state.objects || {})) {
    const bytes = seed.body !== undefined ? Buffer.from(seed.body) : null;
    objects.set(key, {
      bytes,
      size: bytes ? bytes.length : seed.size ?? 0,
      etag: seed.etag ?? `"${bytes ? md5(bytes) : md5(key)}"`,
      contentType: seed.contentType,
      cacheControl: seed.cacheControl,
      contentEncoding: seed.contentEncoding,
      metadata: seed.metadata || {},
    });
  }
  const failures = (state.fail || []).map((f) => ({ ...f, left: f.times ?? 1 }));
  const failing = (op, key) => {
    const f = failures.find((x) => x.op === op && x.key === key && x.left > 0);
    if (!f) return null;
    f.left -= 1;
    return fault(f.name || 'InternalError', f.status || 500);
  };

  class Command {
    constructor(input) { this.input = input; }
  }
  class GetObjectCommand extends Command {}
  class PutObjectCommand extends Command {}
  class HeadObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class CopyObjectCommand extends Command {}
  class DeleteObjectsCommand extends Command {}
  class CreateMultipartUploadCommand extends Command {}
  class UploadPartCommand extends Command {}
  class CompleteMultipartUploadCommand extends Command {}
  class AbortMultipartUploadCommand extends Command {}

  // Open multipart uploads. Parts must come in order (the store sends them one at a time), so
  // the whole object's hash is kept running and no part is held.
  const uploads = new Map();
  let uploadCount = 0;

  const handlers = {
    async GetObject({ Key }) {
      const o = objects.get(Key);
      if (!o) throw fault('NoSuchKey', 404, 'The specified key does not exist.');
      const bytes = o.bytes || Buffer.alloc(o.size);
      return {
        Body: { transformToByteArray: async () => new Uint8Array(bytes), transformToString: async () => bytes.toString('utf8') },
        ContentLength: o.size, ETag: o.etag, ContentType: o.contentType, CacheControl: o.cacheControl, Metadata: { ...o.metadata },
      };
    },
    async PutObject(input, body) {
      const bytes = body.bytes || null;
      objects.set(input.Key, {
        bytes,
        size: bytes ? bytes.length : body.digest.size,
        etag: `"${bytes ? md5(bytes) : body.digest.md5}"`,
        contentType: input.ContentType,
        cacheControl: input.CacheControl,
        contentEncoding: input.ContentEncoding,
        metadata: { ...(input.Metadata || {}) },
      });
      return { ETag: objects.get(input.Key).etag };
    },
    async HeadObject({ Key }) {
      const o = objects.get(Key);
      if (!o) throw fault('NotFound', 404, 'UnknownError');
      return {
        ContentLength: o.size, ETag: o.etag, LastModified: LAST_MODIFIED, ContentType: o.contentType,
        CacheControl: o.cacheControl, ContentEncoding: o.contentEncoding, Metadata: { ...o.metadata },
      };
    },
    async ListObjectsV2({ Prefix = '', ContinuationToken, MaxKeys, Delimiter }) {
      const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix)).sort();
      const items = [];
      const seen = new Set();
      for (const key of keys) {
        const rest = key.slice(Prefix.length);
        const at = Delimiter ? rest.indexOf(Delimiter) : -1;
        if (at >= 0) {
          const p = Prefix + rest.slice(0, at + Delimiter.length);
          if (!seen.has(p)) { seen.add(p); items.push({ prefix: p }); }
        } else items.push({ key });
      }
      const start = ContinuationToken ? Number(ContinuationToken.replace(/^page-/, '')) : 0;
      const size = Math.min(MaxKeys ?? 1000, pageSize);
      const page = items.slice(start, start + size);
      const truncated = start + page.length < items.length;
      const contents = page.filter((i) => i.key).map((i) => {
        const o = objects.get(i.key);
        return { Key: i.key, LastModified: LAST_MODIFIED, ETag: o.etag, Size: o.size, StorageClass: 'STANDARD' };
      });
      const prefixes = page.filter((i) => i.prefix).map((i) => ({ Prefix: i.prefix }));
      return {
        IsTruncated: truncated,
        ...(contents.length ? { Contents: contents } : {}),
        ...(prefixes.length ? { CommonPrefixes: prefixes } : {}),
        KeyCount: page.length,
        ...(truncated ? { NextContinuationToken: `page-${start + page.length}` } : {}),
      };
    },
    async CopyObject(input) {
      const slash = input.CopySource.indexOf('/');
      const fromKey = input.CopySource.slice(slash + 1).split('/').map(decodeURIComponent).join('/');
      const source = objects.get(fromKey);
      if (!source) throw fault('NoSuchKey', 404, 'The specified key does not exist.');
      const replace = input.MetadataDirective === 'REPLACE';
      objects.set(input.Key, {
        ...source,
        ...(replace ? {
          contentType: input.ContentType, cacheControl: input.CacheControl,
          contentEncoding: input.ContentEncoding, metadata: { ...(input.Metadata || {}) },
        } : { metadata: { ...source.metadata } }),
      });
      return { CopyObjectResult: { ETag: source.etag, LastModified: LAST_MODIFIED } };
    },
    async CreateMultipartUpload(input) {
      uploadCount += 1;
      const UploadId = `upload-${uploadCount}`;
      uploads.set(UploadId, { key: input.Key, input, next: 1, size: 0, hash: createHash('sha256'), sum: createHash('md5') });
      return { Bucket: input.Bucket, Key: input.Key, UploadId };
    },
    async UploadPart(input, body) {
      const upload = uploads.get(input.UploadId);
      if (!upload || upload.key !== input.Key) throw fault('NoSuchUpload', 404, 'The specified multipart upload does not exist.');
      if (input.PartNumber !== upload.next) throw new Error(`s3-fake: part ${input.PartNumber} of ${input.Key} out of order (expected ${upload.next})`);
      upload.next += 1;
      upload.size += body.bytes.length;
      upload.hash.update(body.bytes);
      upload.sum.update(body.bytes);
      return { ETag: `"${md5(body.bytes)}"` };
    },
    async CompleteMultipartUpload(input) {
      const upload = uploads.get(input.UploadId);
      if (!upload) throw fault('NoSuchUpload', 404, 'The specified multipart upload does not exist.');
      const numbers = (input.MultipartUpload?.Parts || []).map((p) => p.PartNumber);
      if (numbers.length !== upload.next - 1 || numbers.some((n, i) => n !== i + 1)) throw new Error(`s3-fake: completing ${input.Key} with parts ${numbers.join(',')} of ${upload.next - 1}`);
      uploads.delete(input.UploadId);
      const c = upload.input;
      objects.set(input.Key, {
        bytes: null, size: upload.size, etag: `"${upload.sum.digest('hex')}-${numbers.length}"`,
        contentType: c.ContentType, cacheControl: c.CacheControl, contentEncoding: c.ContentEncoding, metadata: { ...(c.Metadata || {}) },
      });
      return { ETag: objects.get(input.Key).etag, written: { size: upload.size, sha256: upload.hash.digest('hex') } };
    },
    async AbortMultipartUpload(input) {
      uploads.delete(input.UploadId);
      return {};
    },
    async DeleteObjects({ Delete }) {
      const errors = [];
      for (const { Key } of Delete.Objects) {
        const refused = (state.deleteErrors || []).find((e) => e.key === Key);
        if (refused) errors.push({ Key, Code: refused.code ?? 'AccessDenied', Message: refused.message ?? 'Access Denied' });
        else objects.delete(Key);
      }
      return errors.length ? { Errors: errors } : {};
    },
  };

  class S3Client {
    constructor(config) {
      this.config = config;
      record({ op: 'client', config: loggableConfig(config) });
    }

    async send(command) {
      const op = command.constructor.name.replace(/Command$/, '');
      const handler = handlers[op];
      if (!handler) throw new TypeError(`s3-fake: no ${op}`);
      const input = command.input || {};
      const body = op === 'PutObject' || op === 'UploadPart' ? await readBody(input.Body) : null;
      let digest = null;
      if (body) digest = body.digest ? { kind: body.kind, size: body.digest.size, sha256: body.digest.sha256 } : { kind: body.kind, size: body.bytes.length, sha256: sha256(body.bytes) };
      const error = failing(op, input.Key);
      if (error || op !== 'CompleteMultipartUpload') {
        record({ op, input: loggable(input, digest), ...(error ? { failed: error.$metadata.httpStatusCode } : {}) });
        if (error) throw error;
        return handler(input, body);
      }
      // A completed upload is logged after it ran, with the object it made.
      const res = await handler(input, body);
      const { size, sha256: whole } = res.written;
      delete res.written;
      const made = objects.get(input.Key);
      const written = { Bucket: input.Bucket, Key: input.Key, size, sha256: whole, ContentType: made.contentType, ContentEncoding: made.contentEncoding, CacheControl: made.cacheControl, Metadata: made.metadata };
      record({ op, input: loggable(input, digest), written: JSON.parse(JSON.stringify(written)) });
      return res;
    }

    destroy() {}
  }

  return {
    calls, objects,
    S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectsCommand,
    CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  };
}

// The module's own exports (what a script gets for '@aws-sdk/client-s3' under register.mjs).
const STATE_FILE = process.env.S3_FAKE_STATE;
const LOG_FILE = process.env.S3_FAKE_LOG;
const sdk = createFakeS3({
  state: STATE_FILE ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {},
  log: LOG_FILE ? (entry) => appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`) : undefined,
});
export const {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} = sdk;
