// The dry-run comparison for the publish chain's S3 scripts (stream rf9-s3): every case in the
// s3-fake fixture's harness.mjs runs a script from scripts/publish/ in a throwaway copy of
// the repository, with '@aws-sdk/client-s3' replaced by a recording stand-in and the network
// shut off, and must give exactly what golden/<case>.json holds: the S3 calls in order (bucket,
// key, body size and SHA-256, Content-Type, Cache-Control, metadata, copy source, list
// parameters), the exit code, stdout and stderr, and any file the script wrote.
//
// The golden files were recorded from main's scripts (8a5065b547) before they moved onto the S3
// blob store (packages/storage/src/s3.mjs), so this holds the moved scripts to the old behaviour.
// Two cases record an owner-approved change instead (13 Nov 2026, stream rf9-s3b), from the
// working tree: orphans-delete-fails and orphans-delete-batches-fails, where r2-orphans prints
// each key the bucket refused to delete, counts them and exits 1 (it used to say "Deleted N."
// and exit 0); their S3 calls are the same as before.
//
// r2-upload-pmtiles (stream rf9-s3b) uploaded with wrangler, not the S3 client, before it moved
// onto the store, so its cases (compare: 'objects') are held twice: to golden/ call by call, like
// every other case (recorded from the moved script), and to golden-before/ (recorded from main's
// wrangler version at a36887c3fb) at the level of the objects written: key, size, SHA-256,
// Content-Type, Content-Encoding, Cache-Control and metadata, with the exit code, output and
// upload report. Two of them differ on purpose, and assert how (`intended`).
//
// r2-upload-files sends a file over 8 MiB as a multipart upload since stream s3-multipart-files
// (13 Nov 2026). Its three cases with such files (upload-files-small, -large, -part-fails) are
// held the same way, with golden-before/ recorded from the single-PUT version at rf9-s3b
// (4776154b0e): the same objects (key, size, SHA-256, headers), exit code and output.
//
// To see the comparison against any revision directly:
//
//   node ../fixtures/s3-fake/harness.mjs --compare <rev>     (from this folder)
//
// Nothing here can reach R2: the stand-in answers from memory, register.mjs refuses the real SDK,
// fetch and sockets, and each run gets made-up credentials and none of the caller's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CASES, GOLDEN, GOLDEN_BEFORE, TEST_ENV, goldenBeforeFile, goldenFile, objectsView, objectsWritten, runCase } from '../fixtures/s3-fake/harness.mjs';

const golden = (/** @type {string} */ id) => JSON.parse(readFileSync(goldenFile(id), 'utf8'));
const goldenBefore = (/** @type {string} */ id) => JSON.parse(readFileSync(goldenBeforeFile(id), 'utf8'));

test('every case has a golden file, and every golden file a case', () => {
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(files, CASES.map((c) => c.id).sort());
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, 'case ids are unique');
  const before = readdirSync(GOLDEN_BEFORE).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(before, CASES.filter((c) => c.compare === 'objects').map((c) => c.id).sort(), 'golden-before/ holds exactly the objects-level cases');
});

test('the wrangler recordings are what the objects-level cases claim', () => {
  const objectCases = CASES.filter((c) => c.compare === 'objects' && c.script === 'r2-upload-pmtiles');
  assert.deepEqual([...new Set(CASES.filter((c) => c.compare === 'objects').map((c) => c.script))].sort(), ['r2-upload-files', 'r2-upload-pmtiles']);
  const before = objectCases.flatMap((c) => goldenBefore(c.id).calls);
  assert.ok(before.length && before.every((/** @type {{ op: string }} */ call) => call.op === 'wrangler'), 'the earlier version only ever ran wrangler');
  const sizes = objectCases.flatMap((c) => objectsWritten(golden(c.id).calls).map((o) => o.size));
  assert.ok(sizes.some((n) => n > 128 * 1024 * 1024), 'a file over 128 MiB is among the objects written');
});

test('r2-upload-files: the single-PUT recordings hold one PutObject per file; the multipart ones split only the file over 8 MiB', () => {
  const MIB = 1024 * 1024;
  const cases = CASES.filter((c) => c.compare === 'objects' && c.script === 'r2-upload-files');
  assert.deepEqual(cases.map((c) => c.id), ['upload-files-small', 'upload-files-large', 'upload-files-part-fails']);
  for (const c of cases) {
    const ops = (/** @type {{ calls: { op: string }[] }} */ run) => run.calls.map((call) => call.op).filter((op) => op !== 'client');
    assert.ok(ops(goldenBefore(c.id)).every((op) => op === 'PutObject'), `${c.id}: the earlier version only sent single PUTs`);
    const after = golden(c.id).calls;
    for (const call of /** @type {Array<{ op: string, input?: { Body?: { size: number } } }>} */ (after)) {
      if (call.op === 'PutObject') assert.ok(/** @type {{ size: number }} */ (call.input?.Body).size <= 8 * MIB, `${c.id}: a PUT of 8 MiB or less`);
      if (call.op === 'UploadPart') assert.ok(/** @type {{ size: number }} */ (call.input?.Body).size <= 8 * MIB, `${c.id}: parts of 8 MiB at most`);
    }
  }
  const large = golden('upload-files-large').calls.map((/** @type {{ op: string }} */ call) => call.op);
  assert.equal(large.filter((op) => op === 'UploadPart').length, 6);
  assert.equal(large.filter((op) => op === 'CompleteMultipartUpload').length, 1);
  const fails = golden('upload-files-part-fails').calls.map((/** @type {{ op: string, failed?: number }} */ call) => `${call.op}${call.failed ? ' failed' : ''}`);
  assert.deepEqual(fails.slice(-4), ['CreateMultipartUpload', 'UploadPart', 'UploadPart failed', 'AbortMultipartUpload']);
});

test('the scripts cover the operations the comparison promises', () => {
  const ops = new Set(CASES.flatMap((c) => golden(c.id).calls.map((/** @type {{ op: string }} */ call) => call.op)));
  for (const op of ['client', 'PutObject', 'HeadObject', 'ListObjectsV2', 'CopyObject', 'DeleteObjects', 'sleep']) assert.ok(ops.has(op), op);
  const bodies = new Set(CASES.flatMap((c) => golden(c.id).calls.filter((/** @type {{ op: string }} */ call) => call.op === 'PutObject').map((/** @type {{ input: { Body: { kind: string } } }} */ call) => call.input.Body.kind)));
  assert.deepEqual([...bodies].sort(), ['buffer', 'stream']);
  const scripts = new Set(CASES.map((c) => c.script));
  assert.deepEqual([...scripts].sort(), ['elections-app-r2-upload', 'r2-cache-control', 'r2-copy-keys', 'r2-orphans', 'r2-upload-files', 'r2-upload-manifest', 'r2-upload-pmtiles', 'r2-upload-tree', 'verify-r2-parity']);
  for (const op of ['CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload', 'AbortMultipartUpload']) assert.ok(ops.has(op), op);
});

for (const c of CASES) {
  test(`${c.script}: ${c.id} makes the same calls and says the same as before`, () => {
    const want = golden(c.id);
    const got = runCase(c);
    for (const call of got.calls.filter((/** @type {{ op: string }} */ x) => x.op === 'client')) {
      assert.equal(call.config.credentials, 'test credentials', 'a client only ever gets the made-up credentials');
      assert.equal(call.config.endpoint, TEST_ENV.R2_S3_ENDPOINT);
    }
    assert.equal(got.exit, want.exit, 'exit code');
    assert.equal(got.stdout, want.stdout, 'stdout');
    assert.equal(got.stderr, want.stderr, 'stderr');
    assert.deepEqual(got.files, want.files, 'files written');
    assert.deepEqual(got.calls, want.calls, 'S3 calls, in order');
    if (c.compare !== 'objects') return;
    const before = objectsView(goldenBefore(c.id));
    const after = objectsView(got);
    if (c.intended) c.intended(before, after);
    else assert.deepEqual(after, before, 'the same objects written, exit code, output and report as the wrangler version');
  });
}
