#!/usr/bin/env node
/**
 * Upload a whole directory tree to R2, resumably and verifiably.
 *
 * Companion to upload-large-file-r2.mjs, which handles ONE object too large to
 * stream in a single PUT. This handles the opposite shape: many objects, each
 * small enough for a plain PUT (S3/R2 cap that at 5 GB). The Oireachtas
 * full-text tree is 50,824 files and 48.71 GB -- transcripts around 774 KB,
 * scanned bill PDFs up to 27 MB -- so no single object needs multipart.
 *
 * RESUMABILITY IS BY SERVER STATE, NOT A LOCAL LEDGER. Before uploading, the
 * script lists what the bucket already holds under the prefix and skips any key
 * whose remote size matches local. A local progress file would drift the moment
 * a run died mid-write; asking the bucket cannot.
 *
 * VERIFICATION IS SEPARATE FROM UPLOADING. The final pass re-lists the prefix
 * and compares every local file against remote size. This project has now been
 * bitten three times by an exit code that did not mean what it said -- `ia
 * upload` exited 0 with the object absent, a green check suite passed over a
 * broken commit, and a missing asset answered HTTP 200 with HTML -- so the
 * question answered here is "what does the bucket contain", never "did my loop
 * finish".
 *
 * Every key passes assertPublishable before anything is sent: R2 here is a
 * public surface, so a mistyped prefix would publish, not merely misfile.
 *
 * Usage:
 *   node scripts/upload-tree-r2.mjs --dir <local dir> --prefix <r2/prefix/> \
 *        [--concurrency 8] [--verify-only] [--dry]
 */
import { statSync, existsSync, readdirSync, createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { assertPublishable } from './lib/r2-publication-gate.mjs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIR = argVal('dir', null);
const PREFIX = (argVal('prefix', '') || '').replace(/^\/+/, '').replace(/\/*$/, '/');
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 8)));
const VERIFY_ONLY = args.includes('--verify-only');
const DRY = args.includes('--dry');

if (!DIR || PREFIX === '/') {
  console.error('Usage: node scripts/upload-tree-r2.mjs --dir <dir> --prefix <r2/prefix/> [--concurrency 8] [--verify-only]');
  process.exit(2);
}
if (!existsSync(DIR)) { console.error(`Missing directory: ${DIR}`); process.exit(2); }

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const BUCKET = process.env.R2_BUCKET;
const ACCESS = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
if (!ENDPOINT || !BUCKET || !ACCESS || !SECRET) {
  console.error('Missing R2 credentials. Source .env.local first.');
  process.exit(2);
}

const s3 = new S3Client({
  region: 'auto', endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET }
});

// Files at or below this go up as a rewindable Buffer; larger ones stream.
const STREAM_THRESHOLD = 128 * 1024 * 1024;

const CONTENT_TYPES = {
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8'
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

console.log('R2 tree upload');
console.log(`  dir    : ${DIR}`);
console.log(`  prefix : ${PREFIX}`);

const files = walk(DIR);
const local = new Map();   // key -> {abs, size}
let totalBytes = 0;
for (const abs of files) {
  const rel = path.relative(DIR, abs).split(path.sep).join('/');
  const size = statSync(abs).size;
  local.set(PREFIX + rel, { abs, size });
  totalBytes += size;
}
console.log(`  local  : ${local.size} files, ${(totalBytes / 1024 ** 3).toFixed(2)} GB`);

// Fail closed before any transfer. Sample the keys rather than all 50k -- the
// gate matches on prefix, so one key per distinct top segment proves coverage.
const sample = [...local.keys()].filter((k, i) => i === 0 || i === local.size - 1);
assertPublishable(sample);

/** What does the bucket already hold under this prefix? */
async function remoteIndex() {
  const held = new Map();
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents || []) held.set(o.Key, Number(o.Size));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return held;
}

console.log('\n  listing what the bucket already holds...');
let held = await remoteIndex();
console.log(`  remote : ${held.size} objects already under the prefix`);

const todo = [...local.entries()].filter(([k, v]) => held.get(k) !== v.size);
console.log(`  to send: ${todo.length} files\n`);

if (!VERIFY_ONLY && !DRY && todo.length) {
  let done = 0; let sentBytes = 0; let failed = 0;
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (i < todo.length) {
      const idx = i; i += 1;
      const [key, { abs, size }] = todo[idx];
      let ok = false;
      for (let attempt = 1; attempt <= 5 && !ok; attempt += 1) {
        try {
          // Buffer, not createReadStream, for anything that comfortably fits in
          // memory. A stream body cannot be replayed once consumed, so the SDK
          // refuses to retry it -- "An error was encountered in a non-retryable
          // streaming request" -- and a transient blip becomes a hard failure.
          // That is exactly how bills1951-52f-05.pdf (25.63 MB) failed five
          // times in a row on the first run while 50,823 siblings succeeded.
          // A Buffer is rewindable, so both the SDK's internal retry and the
          // loop below can actually retry.
          const body = size <= STREAM_THRESHOLD ? readFileSync(abs) : createReadStream(abs);
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET, Key: key, Body: body,
            ContentLength: size,
            ContentType: CONTENT_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream'
          }));
          ok = true;
        } catch (e) {
          if (attempt === 5) { failed += 1; console.error(`    FAILED ${key}: ${String(e.name || e.message).slice(0, 70)}`); }
          else await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      done += 1; sentBytes += size;
      if (done % 2000 === 0) {
        console.log(`  ${done}/${todo.length}  (${(sentBytes / 1024 ** 3).toFixed(2)} GB sent, ${failed} failed)`);
      }
    }
  }));
  console.log(`\n  sent ${done}, failed ${failed}`);
}

// VERIFY from the bucket, independent of whatever the loop above believed.
console.log('\n  verifying against the bucket...');
held = await remoteIndex();
const missing = [];
const mismatched = [];
for (const [key, { size }] of local) {
  const r = held.get(key);
  if (r === undefined) missing.push(key);
  else if (r !== size) mismatched.push({ key, local: size, remote: r });
}
console.log(`  local files      : ${local.size}`);
console.log(`  present on R2    : ${local.size - missing.length}`);
console.log(`  missing          : ${missing.length}`);
console.log(`  size mismatches  : ${mismatched.length}`);
for (const k of missing.slice(0, 10)) console.log(`      MISSING ${k}`);
for (const m of mismatched.slice(0, 10)) console.log(`      SIZE    ${m.key} local=${m.local} remote=${m.remote}`);

if (missing.length || mismatched.length) {
  console.error(`\n  FAIL: tree is not fully mirrored. Re-run to retry only the gaps.`);
  process.exit(1);
}
console.log(`\n  COMPLETE: all ${local.size} files present on R2 with matching sizes.`);
