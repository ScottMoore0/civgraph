#!/usr/bin/env node
/**
 * Upload the bulk downloads (npm run records:downloads wrote them into tmp/records/downloads/) to
 * R2 under data/downloads/, keeping every snapshot version (owner decision PG15, 13 Nov 2026).
 *
 *   node scripts/publish/r2-upload-downloads.mjs [<local-dir>] [--dry-run]
 *
 * Only with the owner's approval of that upload: R2 objects are public at data.civgraph.net.
 *
 * What it writes (packages/loader/src/downloads-guard.mjs decides):
 *   - the snapshot's versioned files, civgraph-records-<version>.sqlite.gz and
 *     manifest-<version>.json (a copy of manifest.json), each with its SHA-256 as metadata;
 *     one already there with the same content is left alone;
 *   - the files that move to each new snapshot (-latest, the graph exports), then manifest.json.
 * It refuses, before writing anything, when a versioned file is already published with
 * different content or with content it cannot confirm, when a local file does not match the
 * manifest, or when the snapshot has no version. Nothing is ever deleted.
 *
 * Credentials: .env.local at the repository root, loaded by r2-env.mjs; the environment wins.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openS3BlobStore } from '../../packages/storage/src/s3.mjs';
import { DOWNLOADS_PREFIX, isVersionedName, planDownloadsUpload, versionedManifestName } from '../../packages/loader/src/downloads-guard.mjs';
import { assertPublishable } from '../lib/r2-publication-gate.mjs';
import { r2CredentialsOrExit, s3ClientOptions } from './r2-env.mjs';

/** @typedef {import('../../packages/loader/src/downloads-guard.mjs').DownloadManifest} DownloadManifest */
/** @typedef {import('../../packages/loader/src/downloads-guard.mjs').RemoteFile} RemoteFile */

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const unknown = args.filter((a) => a.startsWith('--') && a !== '--dry-run');
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(' ')}. Usage: node scripts/publish/r2-upload-downloads.mjs [<local-dir>] [--dry-run]`);
  process.exit(2);
}
const LOCAL_DIR = args.find((a) => !a.startsWith('--')) || path.join('tmp', 'records', 'downloads');

// Moving files are revalidated within the hour, as r2-upload-tree.mjs sets for everything else;
// a versioned file never changes, so it may be kept for good.
const CACHE_MOVING = 'public, max-age=3600, stale-while-revalidate=86400';
const CACHE_VERSIONED = 'public, max-age=31536000, immutable';

const sha256 = (/** @type {Buffer} */ bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (/** @type {string} */ message) => { console.error(`FAIL: ${message}`); process.exit(1); };

const manifestPath = path.join(LOCAL_DIR, 'manifest.json');
if (!existsSync(manifestPath)) fail(`no ${manifestPath}: run npm run records:downloads first`);
const manifestBytes = readFileSync(manifestPath);
/** @type {DownloadManifest} */
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const version = typeof manifest.version === 'string' ? manifest.version : '';
const files = manifest.files || [];

// Every local file is the one the manifest describes.
/** @type {Map<string, Buffer>} */
const bodies = new Map();
for (const f of files) {
  const file = path.join(LOCAL_DIR, f.name);
  if (!existsSync(file)) fail(`${f.name} is in the manifest but not in ${LOCAL_DIR}`);
  const body = readFileSync(file);
  if (body.length !== f.bytes || sha256(body) !== f.sha256) fail(`${f.name} does not match the manifest's size and SHA-256`);
  bodies.set(f.name, body);
}
bodies.set('manifest.json', manifestBytes);
if (version) bodies.set(versionedManifestName(version), manifestBytes);

const R2 = r2CredentialsOrExit();
// Fails closed before the first request: these objects are public at data.civgraph.net.
assertPublishable([`${DOWNLOADS_PREFIX}/`]);
const store = await openS3BlobStore({ bucket: R2.bucket, clientOptions: s3ClientOptions(R2, { forcePathStyle: false, maxAttempts: 5 }) });
const keyOf = (/** @type {string} */ name) => `${DOWNLOADS_PREFIX}/${name}`;

/** @type {Map<string, RemoteFile | null>} */
const remote = new Map();
for (const name of [...files.map((f) => f.name), version ? versionedManifestName(version) : ''].filter((n) => n && isVersionedName(n, version))) {
  const head = await store.head(keyOf(name));
  remote.set(name, head ? { bytes: typeof head.size === 'number' ? head.size : null, sha256: head.metadata?.['sha256'] || null } : null);
}
const published = /** @type {DownloadManifest | null} */ (await store.json(keyOf('manifest.json')));

const plan = planDownloadsUpload(manifest, remote, published, { bytes: manifestBytes.length, sha256: sha256(manifestBytes) });
if (plan.refuse.length) {
  console.error(`REFUSED: snapshot ${JSON.stringify(manifest.version)}; nothing was uploaded.`);
  for (const r of plan.refuse) console.error(`  ${r.name}: ${r.reason}`);
  console.error('A published version is never overwritten. Rebuild with a new dataset version.');
  process.exit(1);
}
console.log(`Snapshot ${plan.version} -> s3://${R2.bucket}/${DOWNLOADS_PREFIX}/${DRY_RUN ? ' [DRY]' : ''}`);
for (const name of plan.keep) console.log(`  kept       ${name} (already published, same content)`);
for (const name of plan.upload) {
  const body = /** @type {Buffer} */ (bodies.get(name));
  const versioned = isVersionedName(name, plan.version);
  console.log(`  ${DRY_RUN ? 'would put ' : 'put       '} ${name} (${body.length} bytes${versioned ? ', versioned' : ''})`);
  if (DRY_RUN) continue;
  await store.put(keyOf(name), body, {
    contentType: name.endsWith('.json') ? 'application/json' : 'application/octet-stream',
    cacheControl: versioned ? CACHE_VERSIONED : CACHE_MOVING,
    metadata: { sha256: sha256(body) },
  });
}
console.log(DRY_RUN ? `(dry run) ${plan.upload.length} file(s) would be uploaded` : `Uploaded ${plan.upload.length} file(s); kept ${plan.keep.length}.`);
