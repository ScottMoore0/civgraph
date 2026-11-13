// The dry-run comparison for the publish chain's S3 scripts (stream rf9-s3): every case in
// tests/fixtures/s3-fake/harness.mjs runs a script from scripts/publish/ in a throwaway copy of
// the repository, with '@aws-sdk/client-s3' replaced by a recording stand-in and the network
// shut off, and must give exactly what golden/<case>.json holds: the S3 calls in order (bucket,
// key, body size and SHA-256, Content-Type, Cache-Control, metadata, copy source, list
// parameters), the exit code, stdout and stderr, and any file the script wrote.
//
// The golden files were recorded from main's scripts (8a5065b547) before they moved onto the S3
// blob store (packages/storage/src/s3.mjs), so this holds the moved scripts to the old behaviour.
// To see the comparison against any revision directly:
//
//   node tests/fixtures/s3-fake/harness.mjs --compare <rev>
//
// Nothing here can reach R2: the stand-in answers from memory, register.mjs refuses the real SDK,
// fetch and sockets, and each run gets made-up credentials and none of the caller's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CASES, GOLDEN, TEST_ENV, goldenFile, runCase } from '../fixtures/s3-fake/harness.mjs';

const golden = (/** @type {string} */ id) => JSON.parse(readFileSync(goldenFile(id), 'utf8'));

test('every case has a golden file, and every golden file a case', () => {
  const files = readdirSync(GOLDEN).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
  assert.deepEqual(files, CASES.map((c) => c.id).sort());
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, 'case ids are unique');
});

test('the scripts cover the operations the comparison promises', () => {
  const ops = new Set(CASES.flatMap((c) => golden(c.id).calls.map((/** @type {{ op: string }} */ call) => call.op)));
  for (const op of ['client', 'PutObject', 'HeadObject', 'ListObjectsV2', 'CopyObject', 'DeleteObjects', 'sleep']) assert.ok(ops.has(op), op);
  const bodies = new Set(CASES.flatMap((c) => golden(c.id).calls.filter((/** @type {{ op: string }} */ call) => call.op === 'PutObject').map((/** @type {{ input: { Body: { kind: string } } }} */ call) => call.input.Body.kind)));
  assert.deepEqual([...bodies].sort(), ['buffer', 'stream']);
  const scripts = new Set(CASES.map((c) => c.script));
  assert.deepEqual([...scripts].sort(), ['elections-app-r2-upload', 'r2-cache-control', 'r2-copy-keys', 'r2-orphans', 'r2-upload-files', 'r2-upload-manifest', 'r2-upload-tree', 'verify-r2-parity']);
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
  });
}
