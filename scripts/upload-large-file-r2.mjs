#!/usr/bin/env node
/**
 * Upload one large file to R2 via resumable multipart.
 *
 * WHY MULTIPART, AND WHY RESUMABLE
 *
 * The same file failed to reach the Internet Archive after a 5.5-hour transfer:
 * a single stream at ~1 MiB/s was reset by the remote host
 * (ConnectionResetError 10054) with nothing to resume from, so --retries=20
 * simply restarted at zero each time. Worse, `ia upload` exited 0 while the
 * object was absent, so the failure reported as success.
 *
 * Multipart fixes the mechanism rather than the odds: each part is an
 * independent request, a reset costs one part instead of the whole file, and
 * ListParts lets a re-run skip everything already stored server-side. S3 and R2
 * also cap a single PUT at 5 GB, so a 48.5 GB object REQUIRES multipart
 * regardless.
 *
 * Verification is by ETag per part and a HeadObject size check at the end,
 * because "the command exited 0" has now been shown three times in this project
 * to be independent of whether the thing actually happened.
 *
 * Uploads are gated: every key goes through assertPublishable, so a typo in a
 * destination cannot quietly publish something to the public bucket.
 *
 * Usage:
 *   node scripts/upload-large-file-r2.mjs --file <path> --key <r2/key> [--part-mb 128] [--dry]
 */
import { createReadStream, statSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  S3Client, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  ListPartsCommand, ListMultipartUploadsCommand, HeadObjectCommand
} from '@aws-sdk/client-s3';
import { assertPublishable } from './lib/r2-publication-gate.mjs';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const FILE = argVal('file', null);
const KEY = argVal('key', null);
const PART_MB = Math.max(5, Number(argVal('part-mb', 128)));
const DRY = args.includes('--dry');

if (!FILE || !KEY) {
  console.error('Usage: node scripts/upload-large-file-r2.mjs --file <path> --key <r2/key> [--part-mb 128]');
  process.exit(2);
}
if (!existsSync(FILE)) { console.error(`Missing file: ${FILE}`); process.exit(2); }

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const BUCKET = process.env.R2_BUCKET;
const ACCESS = process.env.R2_ACCESS_KEY_ID;
const SECRET = process.env.R2_SECRET_ACCESS_KEY;
if (!ENDPOINT || !BUCKET || !ACCESS || !SECRET) {
  console.error('Missing R2 credentials. Source .env.local first (R2_S3_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).');
  process.exit(2);
}

// Fail closed before a single byte moves.
assertPublishable([KEY]);

const size = statSync(FILE).size;
const PART = PART_MB * 1024 * 1024;
const partCount = Math.ceil(size / PART);

console.log('R2 large-file upload');
console.log(`  file      : ${FILE}`);
console.log(`  size      : ${(size / 1024 ** 3).toFixed(2)} GB`);
console.log(`  key       : ${KEY}`);
console.log(`  part size : ${PART_MB} MB  ->  ${partCount} parts`);
if (DRY) { console.log('  (dry run — nothing sent)'); process.exit(0); }

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET }
});

/** Reuse an in-flight multipart upload for this key if one exists. */
async function findExistingUpload() {
  try {
    const r = await s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: KEY }));
    const match = (r.Uploads || []).find((u) => u.Key === KEY);
    return match ? match.UploadId : null;
  } catch { return null; }
}

let uploadId = await findExistingUpload();
const done = new Map();   // partNumber -> ETag

if (uploadId) {
  console.log(`\n  resuming existing upload ${uploadId.slice(0, 24)}...`);
  let marker;
  do {
    const r = await s3.send(new ListPartsCommand({ Bucket: BUCKET, Key: KEY, UploadId: uploadId, PartNumberMarker: marker }));
    for (const p of r.Parts || []) done.set(p.PartNumber, p.ETag);
    marker = r.NextPartNumberMarker;
  } while (marker);
  console.log(`  ${done.size}/${partCount} parts already stored server-side — skipping them`);
} else {
  const r = await s3.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET, Key: KEY, ContentType: 'application/geopackage+sqlite3'
  }));
  uploadId = r.UploadId;
  console.log(`\n  started upload ${uploadId.slice(0, 24)}...`);
}

const fh = await open(FILE, 'r');
let sent = 0;
try {
  for (let n = 1; n <= partCount; n += 1) {
    if (done.has(n)) { sent += 1; continue; }
    const start = (n - 1) * PART;
    const len = Math.min(PART, size - start);
    const buf = Buffer.allocUnsafe(len);
    await fh.read(buf, 0, len, start);

    let ok = false;
    for (let attempt = 1; attempt <= 6 && !ok; attempt += 1) {
      try {
        const r = await s3.send(new UploadPartCommand({
          Bucket: BUCKET, Key: KEY, UploadId: uploadId, PartNumber: n, Body: buf
        }));
        done.set(n, r.ETag);
        ok = true;
      } catch (e) {
        // A reset costs this part only. That is the whole point of multipart
        // here -- the IA attempt lost 5.5 hours to one reset because a single
        // stream has nothing to fall back to.
        const wait = 2000 * attempt;
        console.error(`    part ${n} attempt ${attempt} failed (${String(e.name || e.message).slice(0, 60)}) — retrying in ${wait / 1000}s`);
        await new Promise((r2) => setTimeout(r2, wait));
      }
    }
    if (!ok) {
      console.error(`\n  FAIL: part ${n} did not upload after 6 attempts.`);
      console.error(`  The multipart upload is left OPEN so a re-run resumes from here.`);
      process.exit(1);
    }
    sent += 1;
    if (sent % 20 === 0 || sent === partCount) {
      const gb = (sent * PART) / 1024 ** 3;
      console.log(`  ${sent}/${partCount} parts  (~${Math.min(gb, size / 1024 ** 3).toFixed(2)} GB)`);
    }
  }
} finally {
  await fh.close();
}

const parts = [...done.entries()].sort((a, b) => a[0] - b[0]).map(([PartNumber, ETag]) => ({ PartNumber, ETag }));
await s3.send(new CompleteMultipartUploadCommand({
  Bucket: BUCKET, Key: KEY, UploadId: uploadId, MultipartUpload: { Parts: parts }
}));

// Verify from the server, not from our own exit status.
const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: KEY }));
console.log(`\n  completed. remote size ${head.ContentLength} bytes`);
if (Number(head.ContentLength) !== size) {
  console.error(`  FAIL: remote size ${head.ContentLength} != local ${size}`);
  process.exit(1);
}
console.log(`  MATCH: remote size equals local (${(size / 1024 ** 3).toFixed(2)} GB)`);
console.log(`  https://data.civgraph.net/${KEY}`);
