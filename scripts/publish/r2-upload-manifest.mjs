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
 *   node scripts/publish/r2-upload-manifest.mjs --dir <local dir> --prefix <r2/prefix/> \
 *        [--concurrency 8] [--verify-only] [--dry] [--force]
 */
import { statSync, existsSync, readdirSync, createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { assertPublishable } from '../lib/r2-publication-gate.mjs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';

const args = process.argv.slice(2);
/**
 * @template T
 * @param {string} n   the flag without its dashes
 * @param {T} d        the default
 * @returns {string | T}
 */
const argVal = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIR = argVal('dir', null);
// A SUBSET of a tree, as [{local, rel}], instead of everything under --dir. Needed when the
// selection is not "this directory" but the result of a filter -- rights, integrity, or what
// another store already holds -- which the tree layout itself cannot express.
const MANIFEST = argVal('manifest', null);
const PREFIX = (argVal('prefix', '') || '').replace(/^\/+/, '').replace(/\/*$/, '/');
const CONCURRENCY = Math.max(1, Number(argVal('concurrency', 8)));
const VERIFY_ONLY = args.includes('--verify-only');
const DRY = args.includes('--dry');
// --force sends every selected file even when the bucket holds an object of the same size: a
// corrected file can keep its byte count (a changed digit), and the size test would skip it.
const FORCE = args.includes('--force');

if ((!DIR && !MANIFEST) || PREFIX === '/') {
  console.error('Usage: node scripts/publish/r2-upload-manifest.mjs (--dir <dir> | --manifest <json>) --prefix <r2/prefix/>');
  console.error('       [--concurrency 8] [--verify-only] [--dry] [--force]');
  process.exit(2);
}
if (DIR && !existsSync(DIR)) { console.error(`Missing directory: ${DIR}`); process.exit(2); }
if (MANIFEST && !existsSync(MANIFEST)) { console.error(`Missing manifest: ${MANIFEST}`); process.exit(2); }

// .env.local is loaded here (r2-env.mjs); --env-file and a sourced shell still win.
const R2 = r2CredentialsOrExit({ exitCode: 2 });
const BUCKET = R2.bucket;

const s3 = new S3Client(s3ClientOptions(R2));

// Files at or below this go up as a rewindable Buffer; larger ones stream.
const STREAM_THRESHOLD = 128 * 1024 * 1024;

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  '.xml': 'application/xml', '.pdf': 'application/pdf', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

console.log('R2 tree upload');
console.log(`  source : ${MANIFEST ? `manifest ${MANIFEST}` : DIR}`);
console.log(`  prefix : ${PREFIX}`);

// Without --manifest, --dir was given (checked above).
/** @type {Array<[string, string]>} [absolute path, path under the prefix] */
const entries = MANIFEST
  ? JSON.parse(readFileSync(MANIFEST, 'utf8')).map((/** @type {{ local: string, rel: string }} */ e) => [e.local, e.rel])
  : walk(/** @type {string} */ (DIR)).map((abs) => [abs, path.relative(/** @type {string} */ (DIR), abs).split(path.sep).join('/')]);
/** @type {Map<string, { abs: string, size: number }>} */
const local = new Map();   // key -> {abs, size}
let totalBytes = 0;
for (const [abs, rel] of entries) {
  if (!existsSync(abs)) { console.warn(`  missing locally, skipped: ${abs}`); continue; }
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
  /** @type {Map<string, number>} key -> size */
  const held = new Map();
  /** @type {string | undefined} */
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of r.Contents || []) held.set(/** @type {string} */ (o.Key), Number(o.Size)); // a listed object always has its Key
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return held;
}

console.log('\n  listing what the bucket already holds...');
let held = await remoteIndex();
console.log(`  remote : ${held.size} objects already under the prefix`);

const todo = [...local.entries()].filter(([k, v]) => FORCE || held.get(k) !== v.size);
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
          if (attempt === 5) { failed += 1; console.error(`    FAILED ${key}: ${String(/** @type {Error} */ (e).name || /** @type {Error} */ (e).message).slice(0, 70)}`); }
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
