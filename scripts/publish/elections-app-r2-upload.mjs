#!/usr/bin/env node
/**
 * Upload the Civgraph Elections app's R2 files: the pivot extracts and DuckDB's WebAssembly.
 * PUBLISHES: the bucket is public at https://data.civgraph.net the moment an object lands. Run it
 * ONLY with the owner's approval in chat, after the go-public change set has added the
 * data/elections-app/ prefix to data/database/r2-publication-allowlist.json (until then the
 * publication gate refuses every key, so a premature run sends nothing).
 *
 *   node scripts/publish/elections-app-r2-upload.mjs              the plan only (a dry run)
 *   node scripts/publish/elections-app-r2-upload.mjs --upload     check, then upload
 *
 * What it sends (keys under R2_PREFIX, site/apps/elections/config.js):
 *
 *   duckdb-wasm-1.29.0/duckdb-{eh,mvp}.wasm   application/wasm, immutable (src/libs/elections-app-vendor.json)
 *   extracts/<body>-<sha256:12>.parquet       immutable: named by content (extracts/manifest.json)
 *   extracts/manifest.json, extracts/index.json   short cache, sent LAST, so a reader never gets
 *                                                 an index naming a file that is not there yet
 *
 * Before anything is sent it requires: the vendored files match their manifest and the two
 * WebAssembly files are built locally (node scripts/build/elections-app/vendor.mjs); the extracts
 * are current against the records build, publishable columns only, no private values
 * (data.mjs --check --strict); every key passes the publication gate. An object already in the
 * bucket with the same SHA-256 (its x-amz-meta-sha256) and size is skipped, so a re-run after a
 * records rebuild sends only the bodies that changed and the two JSON files. Old extract files are
 * left in place (each is about 25 KB); nothing is deleted.
 *
 * Credentials: the R2 S3 keys from .env.local (scripts/publish/r2-env.mjs); never printed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../packages/config/src/node.mjs';
import { R2_PREFIX, SOURCES } from '../../site/apps/elections/config.js';
import { MANIFEST as VENDOR_MANIFEST, checkVendor, sha256 } from '../build/elections-app/vendor.mjs';
import { assertPublishable } from '../lib/r2-publication-gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const UPLOAD = process.argv.includes('--upload');
const EXTRACTS_DIR = path.join(REPO, 'site/apps/elections/extracts');

export const CACHE = Object.freeze({
  immutable: 'public, max-age=31536000, immutable',
  // The index and manifest change with each records rebuild: five minutes, then revalidate.
  index: 'public, max-age=300, must-revalidate',
});

/**
 * Every object to send, in the order to send it.
 * @returns {Array<{ file: string, key: string, contentType: string, cacheControl: string }>}
 */
export function plan(root = REPO) {
  const vendor = JSON.parse(readFileSync(path.join(root, VENDOR_MANIFEST), 'utf8'));
  const extracts = JSON.parse(readFileSync(path.join(root, 'site/apps/elections/extracts/manifest.json'), 'utf8'));
  const out = [];
  for (const f of vendor.files.filter((/** @type {any} */ x) => x.host === 'r2')) {
    out.push({ file: f.path, key: f.r2Key, contentType: f.contentType || 'application/wasm', cacheControl: CACHE.immutable });
  }
  const json = [];
  for (const f of extracts.files) {
    const entry = { file: `site/apps/elections/extracts/${f.name}`, key: `${R2_PREFIX}extracts/${f.name}` };
    if (f.name.endsWith('.json')) json.push({ ...entry, contentType: 'application/json; charset=utf-8', cacheControl: CACHE.index });
    else out.push({ ...entry, contentType: f.name.endsWith('.parquet') ? 'application/vnd.apache.parquet' : 'text/csv; charset=utf-8', cacheControl: CACHE.immutable });
  }
  out.push({ file: 'site/apps/elections/extracts/manifest.json', key: `${R2_PREFIX}extracts/manifest.json`, contentType: 'application/json; charset=utf-8', cacheControl: CACHE.index });
  // index.json last: it is what makes the new files visible to the app.
  out.push(...json.filter((j) => j.key.endsWith('/index.json')));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 1. The files are what their manifests say, and current.
  const { problems, missingLocal } = checkVendor();
  if (problems.length || missingLocal.length) {
    console.error(`FAIL: vendored libraries: ${[...problems, ...missingLocal.map((f) => `${f} not built locally (node scripts/build/elections-app/vendor.mjs)`)].join('; ')}`);
    process.exit(1);
  }
  try {
    execFileSync(process.execPath, [path.join(REPO, 'scripts/build/elections-app/data.mjs'), '--check', '--strict', '--out-dir', EXTRACTS_DIR], { stdio: 'inherit' });
  } catch {
    console.error('FAIL: the extracts are not current or not publishable (above); nothing sent.');
    process.exit(1);
  }
  const objects = plan();
  const total = objects.reduce((n, o) => n + readFileSync(path.join(REPO, o.file)).length, 0);
  console.log(`${objects.length} objects, ${(total / 1048576).toFixed(1)} MiB, to ${SOURCES.r2.extracts.replace(/extracts\/$/, '')}`);
  for (const o of objects) console.log(`  ${o.key}  (${o.contentType}; ${o.cacheControl})`);

  // 2. The publication gate: refuses (throws) unless the allowlist covers every key.
  try {
    assertPublishable(objects.map((o) => o.key));
  } catch (err) {
    console.error(`FAIL: ${/** @type {Error} */ (err).message}\n(The go-public change set, docs/tasks/elections-go-public.patch, adds the prefix.) Nothing sent.`);
    process.exit(1);
  }
  if (!UPLOAD) {
    console.log('Dry run: nothing sent. With the owner\'s approval: node scripts/publish/elections-app-r2-upload.mjs --upload');
    process.exit(0);
  }

  // 3. Send, skipping objects already there with the same content.
  const { r2CredentialsOrExit, s3ClientOptions } = await import('./r2-env.mjs');
  const R2 = r2CredentialsOrExit();
  const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client(s3ClientOptions(R2, { maxAttempts: 5 }));
  let sent = 0;
  let skipped = 0;
  for (const o of objects) {
    const body = readFileSync(path.join(REPO, o.file));
    const sha = sha256(body);
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: R2.bucket, Key: o.key }));
      if (head.ContentLength === body.length && head.Metadata?.sha256 === sha && head.CacheControl === o.cacheControl) { skipped += 1; continue; }
    } catch (err) {
      if (/** @type {any} */ (err)?.$metadata?.httpStatusCode !== 404) throw err;
    }
    await s3.send(new PutObjectCommand({ Bucket: R2.bucket, Key: o.key, Body: body, ContentType: o.contentType, CacheControl: o.cacheControl, Metadata: { sha256: sha } }));
    sent += 1;
    console.log(`  sent ${o.key} ${(body.length / 1048576).toFixed(2)} MiB`);
  }
  console.log(`Uploaded ${sent}, unchanged ${skipped}. Check: curl -sI -H "Origin: ${SITE.origin}" ${SOURCES.r2.extracts}index.json`);
}
