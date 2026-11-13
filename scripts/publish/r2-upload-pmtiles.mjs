#!/usr/bin/env node
/**
 * Upload /test PMTiles archives (and MVT tile directories) from the CDN manifest to Cloudflare R2,
 * one object at a time in manifest order, through the S3 blob store (packages/storage/src/s3.mjs)
 * and R2's S3 endpoint. A file over 8 MiB goes up as a multipart upload in 8 MiB parts: large
 * single PUTs from Node fail on the owner's network with a TLS bad_record_mac error.
 *
 * Until 13 Nov 2026 (stream rf9-s3b) each object went up with `npx wrangler r2 object put`, the
 * Cloudflare REST API, which is rate-limited to about 1.4 requests a second and takes no file
 * over 300 MiB. The objects written are the same (key, bytes, Content-Type, Content-Encoding; no
 * Cache-Control or metadata, as before); the publish-s3-dry-run unit test holds that against
 * recordings of the wrangler version.
 *
 * Credentials: the R2 S3 keys (R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), from the
 * environment or the repository's .env.local (scripts/publish/r2-env.mjs), read at the first
 * upload; a dry run, or a run with nothing to send, needs none.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { openS3BlobStore } from '../../packages/storage/src/s3.mjs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';

/**
 * Each object's upload result (state-machine catalogue PL-L, light: a closed result set). The
 * switch reads 'uploaded-directory' (layer-lifecycle.mjs mvtDirectoryState); 'dry-run' is ok but
 * uploads nothing.
 * @typedef {'uploaded' | 'dry-run' | 'missing-local-file' | 'upload-failed' | 'missing-local-directory'
 *   | 'uploaded-directory' | 'partial-directory-upload'} UploadStatus
 */
export const UPLOAD_STATUSES = Object.freeze(['uploaded', 'dry-run', 'missing-local-file', 'upload-failed', 'missing-local-directory', 'uploaded-directory', 'partial-directory-upload']);

/**
 * One line of render/metadata/cdn-upload-report.json `results`: an archive (targetKey), a
 * whole tile directory (targetPrefix, with its file counts) or one failed tile of a directory.
 * @typedef {object} UploadResult
 * @property {string} layerId
 * @property {string} [targetKey]
 * @property {string} [targetPrefix]
 * @property {boolean} ok
 * @property {UploadStatus} status
 * @property {number} [bytes]
 * @property {string} [output]     the tail of wrangler's output (reports written before the move to the S3 store only)
 * @property {string} [error]
 * @property {number} [files]
 * @property {number} [uploaded]
 * @property {number} [failed]
 */
/** @typedef {import('./r2-manifest.mjs').CdnUploadAsset} CdnUploadAsset */

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(ROOT, 'render/metadata/cdn-upload-manifest.json');
const REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-upload-report.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-range-report.json');
const BUCKET = process.env.TEST_R2_BUCKET || 'boundaries-data';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_IDS = new Set([
  ...(process.env.TEST_UPLOAD_LAYER_IDS || '').split(','),
  ...readArgList('--ids')
].map((value) => value.trim()).filter(Boolean));
/** Bytes in each part of a multipart upload; a file no bigger goes up in one PUT. */
const PART_SIZE = 8 * 1024 * 1024;
const PMTILES_HEADERS = Object.freeze({ contentType: 'application/octet-stream' });
const MVT_HEADERS = Object.freeze({ contentType: 'application/x-protobuf', contentEncoding: 'gzip' });
/** The S3 store, once the first upload has opened it (s3Store()). @type {Promise<import('../../packages/storage/src/s3.mjs').S3BlobStore> | null} */
let storeOpening = null;

// `--ids ""` MUST NOT MEAN "everything".
//
// On 2026-08-21 a shell substitution produced an empty --ids value here. ONLY_IDS came
// out empty, empty means unscoped, and this began uploading all 817 archives; 252 went
// to R2 before it was stopped. The operator had asked for 41.
//
// This is the same fail-open that switch-test-pmtiles-to-cdn.mjs was fixed for two days
// earlier -- the fix was applied there and not here, because the bug was recorded as
// "that tool ignores --ids" rather than as a shape that any scoped tool can have. It is
// the shape that matters: an explicit narrowing that silently widens is the most
// dangerous default a publishing tool can have, because the operator's own intent is
// the thing being discarded.
if (process.argv.includes('--ids') && !ONLY_IDS.size) {
  console.error('FAIL: --ids was given with no layer ids. Refusing to fall back to all layers.');
  console.error('  This publishes to R2. An empty scope here means "everything", which is');
  console.error('  never what --ids was typed to mean.');
  process.exit(2);
}

if (process.argv.includes('--failed-range-report')) {
  if (!existsSync(RANGE_REPORT_PATH)) {
    console.error('No CDN range report found. Run `npm run verify:test:pmtiles-cdn` first.');
    process.exit(1);
  }
  /** @type {{ results?: import('./verify-pmtiles-cdn.mjs').RangeCheck[] }} */
  const rangeReport = JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'));
  for (const item of rangeReport.results || []) {
    if (!item.ok && item.layerId) ONLY_IDS.add(item.layerId);
  }
  if (!ONLY_IDS.size) {
    console.log('No failed CDN range-report entries to upload.');
    process.exit(0);
  }
}

/** @type {{ assets?: CdnUploadAsset[] }} */
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const assets = (manifest.assets || [])
  .filter((asset) => asset.kind === 'pmtiles' || asset.kind === 'mvt-directory')
  .filter((asset) => !ONLY_IDS.size || ONLY_IDS.has(asset.layerId));
/** @type {UploadResult[]} */
const results = [];

if (!assets.length) {
  console.error(ONLY_IDS.size
    ? `No PMTiles assets matched: ${Array.from(ONLY_IDS).join(', ')}`
    : 'No PMTiles assets found in CDN upload manifest.');
  process.exit(1);
}

for (const [index, asset] of assets.entries()) {
  if (asset.kind === 'mvt-directory') {
    await uploadMvtDirectory(asset, index, assets.length);
    continue;
  }
  const filePath = resolve(ROOT, asset.localPath || '');
  if (!existsSync(filePath)) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: false, status: 'missing-local-file' });
    continue;
  }
  const bytes = statSync(filePath).size;
  console.log(`[${index + 1}/${assets.length}] ${asset.targetKey} (${formatBytes(bytes)})`);
  if (DRY_RUN) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: true, status: 'dry-run', bytes });
    continue;
  }
  try {
    await putFile(asset.targetKey, filePath, bytes, PMTILES_HEADERS);
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: true, status: 'uploaded', bytes });
  } catch (err) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: false, status: 'upload-failed', bytes, error: errorText(err) });
  }
  writeReport();
}

const report = writeReport();
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
if (report.totals.failed) process.exit(1);

/**
 * @param {import('./r2-manifest.mjs').MvtDirectoryAsset} asset
 * @param {number} assetIndex
 * @param {number} assetCount
 */
async function uploadMvtDirectory(asset, assetIndex, assetCount) {
  const directory = resolve(ROOT, asset.localPath || '');
  if (!existsSync(directory)) {
    results.push({ layerId: asset.layerId, targetPrefix: asset.targetPrefix, ok: false, status: 'missing-local-directory' });
    writeReport();
    return;
  }
  const files = listFiles(directory).filter((file) => file.endsWith('.pbf'));
  let uploaded = 0;
  let failed = 0;
  let bytes = 0;
  console.log(`[${assetIndex + 1}/${assetCount}] ${asset.targetPrefix} (${files.length} MVT files)`);
  for (const [fileIndex, file] of files.entries()) {
    const rel = relative(directory, file).replaceAll('\\', '/');
    const targetKey = `${asset.targetPrefix}/${rel}`;
    const fileBytes = statSync(file).size;
    bytes += fileBytes;
    if ((fileIndex + 1) % 250 === 0 || fileIndex === 0 || fileIndex === files.length - 1) {
      console.log(`  ${fileIndex + 1}/${files.length} ${rel}`);
    }
    if (DRY_RUN) {
      uploaded += 1;
      continue;
    }
    try {
      await putFile(targetKey, file, fileBytes, MVT_HEADERS);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      results.push({
        layerId: asset.layerId,
        targetKey,
        ok: false,
        status: 'upload-failed',
        bytes: fileBytes,
        error: errorText(err)
      });
    }
    if ((fileIndex + 1) % 50 === 0) writeReport();
  }
  results.push({
    layerId: asset.layerId,
    targetPrefix: asset.targetPrefix,
    ok: failed === 0,
    status: failed === 0 ? (DRY_RUN ? 'dry-run' : 'uploaded-directory') : 'partial-directory-upload',
    files: files.length,
    uploaded,
    failed,
    bytes
  });
  writeReport();
}

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listFiles(directory) {
  /** @type {string[]} */
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function writeReport() {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    dryRun: DRY_RUN,
    selectedIds: Array.from(ONLY_IDS),
    totals: {
      assets: assets.length,
      processed: results.length,
      ok: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      bytes: results.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
    },
    results
  };
  // The report is rewritten after every upload; on Windows a scanner can briefly hold the
  // file, so a failed write is retried and finally skipped rather than ending the run.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
      break;
    } catch (err) {
      if (attempt === 5) console.warn(`could not write ${REPORT_PATH}: ${/** @type {NodeJS.ErrnoException} */ (err).code || /** @type {Error} */ (err).message}`);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
    }
  }
  return report;
}

/**
 * The S3 store over BUCKET, opened at the first upload (so a dry run, or a run with nothing to
 * send, needs no credentials). Without the R2 S3 keys this prints which are missing and exits 1.
 */
function s3Store() {
  if (!storeOpening) {
    const R2 = r2CredentialsOrExit();
    storeOpening = openS3BlobStore({ bucket: BUCKET, clientOptions: s3ClientOptions(R2, { maxAttempts: 5 }) });
  }
  return storeOpening;
}

/**
 * Write one local file to `key`: one PUT for a file of PART_SIZE bytes or fewer, else a multipart
 * upload that reads one part at a time (aborted if any part fails; the client resends a failed
 * request up to its maxAttempts).
 * @param {string} key
 * @param {string} filePath
 * @param {number} bytes  the file's size
 * @param {{ contentType: string, contentEncoding?: string }} headers
 */
async function putFile(key, filePath, bytes, headers) {
  const store = await s3Store();
  if (bytes <= PART_SIZE) {
    await store.put(key, readFileSync(filePath), headers);
    return;
  }
  const handle = await open(filePath, 'r');
  try {
    const read = async (/** @type {number} */ offset, /** @type {number} */ length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    await store.putMultipart(key, { size: bytes, read }, { ...headers, partSize: PART_SIZE });
  } finally {
    await handle.close();
  }
}

/**
 * A failed upload's error for the report: the S3 error's name and HTTP status with its message.
 * @param {unknown} err
 */
function errorText(err) {
  const error = /** @type {{ name?: string, message?: string, $metadata?: { httpStatusCode?: number } }} */ (err);
  const status = error?.$metadata?.httpStatusCode;
  const label = [error?.name, status ? `(HTTP ${status})` : ''].filter(Boolean).join(' ');
  return `${label ? `${label}: ` : ''}${error?.message ?? String(err)}`.slice(0, 2000);
}

/**
 * @param {number} bytes
 */
function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The comma-separated values of every `name <list>` / `name=<list>` in argv.
 * @param {string} name
 * @returns {string[]}
 */
function readArgList(name) {
  /** @type {string[]} */
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(...process.argv[index + 1].split(','));
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(...arg.slice(name.length + 1).split(','));
    }
  }
  return values;
}
