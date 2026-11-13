// The S3 blob store (packages/storage/src/s3.mjs, storage slice ST-2's s3.mjs): the commands each
// method sends, over the recording SDK stand-in (the s3-fake fixture's client-s3.mjs). No
// network: the stand-in keeps the bucket in memory. The conformance suite every BlobStore passes
// is the Functions' blob-store.test.mjs; the scripts that use this store are compared with their
// earlier selves in publish-s3-dry-run.test.mjs, beside this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { copySource, isNotFound, s3BlobStore, S3_DELETE_BATCH } from '../../packages/storage/src/s3.mjs';
import { createFakeS3 } from '../fixtures/s3-fake/client-s3.mjs';

/** A store over a fresh stand-in bucket; `sdk.calls` lists what it sent. */
function make(state = {}) {
  const sdk = createFakeS3({ state });
  const store = s3BlobStore({ bucket: 'boundaries-data', client: /** @type {any} */ (new sdk.S3Client({})), commands: /** @type {any} */ (sdk) });
  sdk.calls.length = 0;
  return { sdk, store };
}
const sent = (sdk) => sdk.calls.map((c) => ({ op: c.op, ...c.input }));

test('put sends one PutObject with only the fields given, in the scripts\' order', async () => {
  const { sdk, store } = make();
  await store.put('data/maps/a.fgb', Buffer.from('abc'), { contentType: 'application/octet-stream' });
  await store.put('data/x/b.json', Buffer.from('{}'), { contentLength: 2, contentType: 'application/json', cacheControl: 'public, max-age=300', metadata: { sha256: 'h' } });
  const [first, second] = sent(sdk);
  assert.deepEqual(Object.keys(first), ['op', 'Bucket', 'Key', 'Body', 'ContentType']);
  assert.deepEqual(Object.keys(second), ['op', 'Bucket', 'Key', 'Body', 'ContentLength', 'ContentType', 'CacheControl', 'Metadata']);
  assert.equal(first.Body.kind, 'buffer', 'a Buffer goes as it is');
  assert.deepEqual(second.Metadata, { sha256: 'h' });
});

test('put streams a stream body with its length', async () => {
  const { sdk, store } = make();
  await store.put('big/file.pdf', Readable.from([Buffer.from('part one, '), Buffer.from('part two')]), { contentLength: 18, contentType: 'application/pdf' });
  const [put] = sent(sdk);
  assert.equal(put.Body.kind, 'stream');
  assert.equal(put.Body.size, 18);
  assert.equal(put.ContentLength, 18);
  assert.equal((await store.head('big/file.pdf')).size, 18);
});

test('head returns the headers, null for a missing key, and throws anything else (or a 404 when asked)', async () => {
  const { sdk, store } = make({
    objects: { 'k/a.br': { body: 'x', contentType: 'application/octet-stream', cacheControl: 'public', contentEncoding: 'br', metadata: { sha256: 's' } }, 'k/denied': { body: 'y' } },
    fail: [{ op: 'HeadObject', key: 'k/denied', status: 403, name: 'Forbidden' }],
  });
  assert.deepEqual(await store.head('k/a.br'), { size: 1, etag: '"9dd4e461268c8034f5c8564e155c67a6"', contentType: 'application/octet-stream', cacheControl: 'public', contentEncoding: 'br', metadata: { sha256: 's' } });
  assert.equal(await store.head('k/none'), null);
  await assert.rejects(store.head('k/none', { missing: 'throw' }), { name: 'NotFound' });
  await assert.rejects(store.head('k/denied'), { name: 'Forbidden' });
  assert.deepEqual(sent(sdk).map((c) => [c.op, c.Key]), [['HeadObject', 'k/a.br'], ['HeadObject', 'k/none'], ['HeadObject', 'k/none'], ['HeadObject', 'k/denied']]);
});

test('list sends the prefix and continuation token, MaxKeys and Delimiter only when given; listAll pages', async () => {
  /** @type {Record<string, { body: string }>} */
  const objects = {};
  for (const k of ['p/a', 'p/b', 'p/c', 'p/d', 'p/e', 'q/z']) objects[k] = { body: k };
  const { sdk, store } = make({ pageSize: 2, objects });
  const keys = [];
  for await (const e of store.listAll({ prefix: 'p/' })) keys.push(e.key);
  assert.deepEqual(keys, ['p/a', 'p/b', 'p/c', 'p/d', 'p/e']);
  assert.deepEqual(sent(sdk), [
    { op: 'ListObjectsV2', Bucket: 'boundaries-data', Prefix: 'p/' },
    { op: 'ListObjectsV2', Bucket: 'boundaries-data', Prefix: 'p/', ContinuationToken: 'page-2' },
    { op: 'ListObjectsV2', Bucket: 'boundaries-data', Prefix: 'p/', ContinuationToken: 'page-4' },
  ]);
  sdk.calls.length = 0;
  const page = await store.list({ prefix: 'p/', limit: 1000 });
  assert.deepEqual(sent(sdk), [{ op: 'ListObjectsV2', Bucket: 'boundaries-data', Prefix: 'p/', MaxKeys: 1000 }]);
  assert.deepEqual(page.entries[0], { key: 'p/a', size: 3, uploaded: '2026-11-01T00:00:00.000Z', etag: page.entries[0]?.etag, metadata: null });
  assert.match(String(page.entries[0]?.etag), /^"[0-9a-f]{32}"$/);
  assert.equal(page.truncated, true);
  assert.equal(page.cursor, 'page-2');
});

test('copy is server side, with the CopySource encoded per segment and only the headers given', async () => {
  const { sdk, store } = make({ objects: { 'a/b c+d.pmtiles': { body: 'x', contentType: 'application/vnd.pmtiles' } } });
  await store.copy('a/b c+d.pmtiles', 'n/e.pmtiles', { metadataDirective: 'COPY' });
  await store.copy('a/b c+d.pmtiles', 'a/b c+d.pmtiles', { metadataDirective: 'REPLACE', cacheControl: 'public, max-age=3600', contentType: 'application/octet-stream', contentEncoding: 'br', metadata: { m: '1' } });
  assert.deepEqual(sent(sdk), [
    { op: 'CopyObject', Bucket: 'boundaries-data', Key: 'n/e.pmtiles', CopySource: 'boundaries-data/a/b%20c%2Bd.pmtiles', MetadataDirective: 'COPY' },
    { op: 'CopyObject', Bucket: 'boundaries-data', Key: 'a/b c+d.pmtiles', CopySource: 'boundaries-data/a/b%20c%2Bd.pmtiles', MetadataDirective: 'REPLACE', CacheControl: 'public, max-age=3600', ContentType: 'application/octet-stream', ContentEncoding: 'br', Metadata: { m: '1' } },
  ]);
  assert.equal((await store.head('n/e.pmtiles'))?.contentType, 'application/vnd.pmtiles');
  assert.equal((await store.head('a/b c+d.pmtiles'))?.cacheControl, 'public, max-age=3600');
});

test('copySource matches both ways the scripts encoded it', () => {
  for (const key of ['data/maps/a b+c.pmtiles', 'x/é/ü?.fgb', 'plain/key.fgb', 'a/%2F/b']) {
    assert.equal(copySource('b', key), `b/${encodeURIComponent(key).replace(/%2F/g, '/')}`, key);
  }
});

test('deleteMany sends quiet DeleteObjects of at most 1,000 keys each', async () => {
  const keys = Array.from({ length: S3_DELETE_BATCH * 2 + 1 }, (_, i) => `d/${i}`);
  const { sdk, store } = make({ objects: Object.fromEntries(keys.map((k) => [k, { body: k }])) });
  assert.deepEqual(await store.deleteMany(keys), { errors: [] });
  const calls = sent(sdk);
  assert.deepEqual(calls.map((c) => [c.op, c.Delete.Quiet, c.Delete.Objects.count ?? c.Delete.Objects.length]), [['DeleteObjects', true, 1000], ['DeleteObjects', true, 1000], ['DeleteObjects', true, 1]]);
  assert.equal(sdk.objects.size, 0);
});

test('isNotFound: a 404, NotFound or NoSuchKey; nothing else', () => {
  assert.equal(isNotFound({ $metadata: { httpStatusCode: 404 } }), true);
  assert.equal(isNotFound({ name: 'NotFound' }), true);
  assert.equal(isNotFound({ name: 'NoSuchKey' }), true);
  assert.equal(isNotFound({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } }), false);
  assert.equal(isNotFound(null), false);
});

test('s3BlobStore refuses something that is not a client', () => {
  assert.throws(() => s3BlobStore({ bucket: 'b', client: /** @type {any} */ ({}), commands: /** @type {any} */ ({}) }), /not an S3 client/);
});

test('put sends Content-Encoding only when given, after the Content-Type', async () => {
  const { sdk, store } = make();
  await store.put('t/0/0/0.pbf', Buffer.from('tile'), { contentType: 'application/x-protobuf', contentEncoding: 'gzip' });
  const [put] = sent(sdk);
  assert.deepEqual(Object.keys(put), ['op', 'Bucket', 'Key', 'Body', 'ContentType', 'ContentEncoding']);
  assert.equal(put.ContentEncoding, 'gzip');
  assert.equal((await store.head('t/0/0/0.pbf')).contentEncoding, 'gzip');
});

/** A part source over `bytes`, counting what was read. */
function source(bytes) {
  const reads = [];
  return { reads, size: bytes.length, read: async (offset, length) => { reads.push([offset, length]); return bytes.subarray(offset, offset + length); } };
}

test('putMultipart sends equal parts in order, reading each when it is sent, and completes', async () => {
  const { sdk, store } = make();
  const bytes = Buffer.from('abcdefghijklmnopqrstuvwxyz');
  const src = source(bytes);
  assert.deepEqual(await store.putMultipart('big/a.pmtiles', src, { partSize: 10, contentType: 'application/octet-stream', cacheControl: 'public' }), { parts: 3 });
  assert.deepEqual(src.reads, [[0, 10], [10, 10], [20, 6]]);
  const calls = sent(sdk);
  assert.deepEqual(calls.map((c) => [c.op, c.PartNumber ?? null, c.ContentLength ?? null]), [
    ['CreateMultipartUpload', null, null], ['UploadPart', 1, 10], ['UploadPart', 2, 10], ['UploadPart', 3, 6], ['CompleteMultipartUpload', null, null],
  ]);
  assert.deepEqual(Object.keys(calls[0]), ['op', 'Bucket', 'Key', 'ContentType', 'CacheControl'], 'only the headers given, on the create');
  assert.deepEqual(calls[4].MultipartUpload.Parts.map((p) => p.PartNumber), [1, 2, 3]);
  assert.ok(calls[4].MultipartUpload.Parts.every((p) => /^"[0-9a-f]{32}"$/.test(p.ETag)), 'each part\'s ETag goes back in the completion');
  const done = sdk.calls.at(-1).written;
  assert.equal(done.size, 26);
  assert.equal(done.sha256, createHash('sha256').update(bytes).digest('hex'));
  const head = await store.head('big/a.pmtiles');
  assert.equal(head.size, 26);
  assert.equal(head.contentType, 'application/octet-stream');
  assert.equal(head.cacheControl, 'public');
});

test('putMultipart aborts the upload when a part fails, and throws the part\'s error', async () => {
  const { sdk, store } = make({ fail: [{ op: 'UploadPart', key: 'big/b.pmtiles', status: 503, name: 'SlowDown' }] });
  await assert.rejects(store.putMultipart('big/b.pmtiles', source(Buffer.alloc(25)), { partSize: 10 }), { name: 'SlowDown' });
  assert.deepEqual(sent(sdk).map((c) => c.op), ['CreateMultipartUpload', 'UploadPart', 'AbortMultipartUpload']);
  assert.equal(sent(sdk)[2].UploadId, sent(sdk)[1].UploadId);
  assert.equal(await store.head('big/b.pmtiles'), null, 'nothing was written');
});

test('putMultipart refuses a short read, an empty source and a bad part size', async () => {
  const { sdk, store } = make();
  const short = { size: 30, read: async (offset, length) => Buffer.alloc(offset === 10 ? length - 1 : length) };
  await assert.rejects(store.putMultipart('big/c', short, { partSize: 10 }), /read 9 of 10 bytes at 10/);
  assert.deepEqual(sent(sdk).map((c) => c.op), ['CreateMultipartUpload', 'UploadPart', 'AbortMultipartUpload']);
  await assert.rejects(store.putMultipart('big/d', { size: 0, read: async () => Buffer.alloc(0) }, { partSize: 10 }), RangeError);
  await assert.rejects(store.putMultipart('big/e', source(Buffer.alloc(5)), { partSize: 0 }), RangeError);
});
