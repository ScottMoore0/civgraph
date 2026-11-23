#!/usr/bin/env node
// @ts-check
/**
 * Is the local map mirror (data/maps/) the same as the live objects in R2? Read-only: it lists
 * the bucket (ListObjectsV2 through packages/storage/src/s3.mjs) and reads local files; it never
 * downloads, uploads or changes anything. The comparison is scripts/publish/map-mirror-parity.mjs
 * (size, then MD5 against the S3 ETag; multipart ETags recomputed at the likely part sizes).
 *
 * Which files: every file under data/maps/ in the mirror (but data/maps/_archive/), and every
 * data/maps/ key the catalogue (data/database/maps.json), the layer metadata
 * (render/metadata/maps-test.json) and the chunk indexes name. Geometry a catalogue record or
 * layer names (.fgb, .geojson, .gpkg) is "build": the builds read it, and a stale one fails the
 * run (exit 1). The rest is reported only: referenced files (images, downloads, chunk parts)
 * and unreferenced local files.
 *
 * Fast: the bucket is listed one folder at a time (a delimited listing of each folder the
 * mirror or the catalogue uses; the whole prefix holds tile pyramids and takes many minutes),
 * only same-size files are hashed, and hashes are cached by path, size and mtime in
 * tmp/map-mirror/digests.json. Unreferenced files are compared by size unless --hash-all.
 *
 * Without credentials (.env.local, see r2-env.mjs) or without the network it prints SKIPPED,
 * says the check was not done, and exits 0; --strict exits 2 instead. `npm run rebuild` runs it
 * (non-strict) before the timeline builder in a data rebuild; `npm run verify` runs it too.
 *
 *   node scripts/publish/verify-map-mirror.mjs [--root DIR] [--hash-all] [--json FILE] [--limit N] [--strict]
 *     --root DIR   the checkout whose data/maps/ is the mirror (default: this one); only read
 *     --json FILE  also write every row as JSON
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SITE, REPO_PATHS, REPO_ROOT } from '@civgraph/config/node';
import { openS3BlobStore } from '@civgraph/storage/s3.mjs';
import { mapWithConcurrency } from '@civgraph/map/election/cache.mjs';
import { r2Credentials, s3ClientOptions } from './r2-env.mjs';
import {
  MIRROR_PREFIX, collectReferences, compareMirror, createDigester, digestNeeded, exitCodeFor, foldersOf, formatReport, isLocalOnly, summarise,
} from './map-mirror-parity.mjs';

/** @typedef {import('./map-mirror-parity.mjs').LocalFile} LocalFile */
/** @typedef {import('./map-mirror-parity.mjs').RemoteObject} RemoteObject */
/** @typedef {import('./map-mirror-parity.mjs').Digest} Digest */
/** @typedef {{ size: number, mtimeMs: number } & Digest} CacheEntry */

const args = process.argv.slice(2);
/** @param {string} name */
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const MIRROR_ROOT = path.resolve(option('--root') || REPO_ROOT);
const JSON_FILE = option('--json');
const LIMIT = Number(option('--limit')) || 40;
const STRICT = args.includes('--strict');
const HASH_ALL = args.includes('--hash-all');
const CACHE_FILE = path.join(REPO_ROOT, REPO_PATHS.tmp, 'map-mirror', 'digests.json');

/** @param {string} why */
function skip(why) {
  console.log(`\n  SKIPPED: ${why}`);
  console.log('  The mirror was NOT compared with R2: stale local map files would go unnoticed by the builds.');
  process.exit(STRICT ? 2 : 0);
}

/** @param {string} file */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const started = Date.now();
console.log('Map mirror parity (local data/maps/ against R2)');
console.log(`  mirror: ${path.join(MIRROR_ROOT, MIRROR_PREFIX)}`);

// 1. The local mirror.
/** @type {Map<string, LocalFile>} */
const local = new Map();
const mirrorDir = path.join(MIRROR_ROOT, MIRROR_PREFIX);
if (!existsSync(mirrorDir)) skip(`no local mirror at ${mirrorDir} (a worktree has none: pass --root <the main checkout>)`);
/** @param {string} dir @param {string} rel */
const walk = (dir, rel) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const key = `${rel}${entry.name}`;
    if (entry.isDirectory()) { if (!isLocalOnly(`${key}/`)) walk(path.join(dir, entry.name), `${key}/`); continue; }
    if (!entry.isFile()) continue;
    const st = statSync(path.join(dir, entry.name));
    local.set(key, { size: st.size, mtimeMs: Math.round(st.mtimeMs) });
  }
};
walk(mirrorDir, MIRROR_PREFIX);

// 2. What the catalogue, the layers and the chunk indexes name.
const catalogue = readJson(path.join(REPO_ROOT, REPO_PATHS.mapsCatalogue));
const layerMeta = readJson(path.join(REPO_ROOT, REPO_PATHS.layerMetadata));
/** @type {Array<{ path: string, doc: unknown }>} */
const chunkIndexes = [];
for (const key of local.keys()) {
  if (!/chunks?[^/]*\.json$/i.test(key)) continue;
  try { chunkIndexes.push({ path: key, doc: readJson(path.join(MIRROR_ROOT, key)) }); } catch { /* not JSON: compared as a file, names nothing */ }
}
const refs = collectReferences({ maps: catalogue.maps || catalogue, layers: layerMeta.layers || [], chunkIndexes }, { dataOrigin: SITE.dataOrigin });
console.log(`  local files: ${local.size}; keys named by the catalogue, layers and chunk indexes: ${refs.size}`);

// 3. The bucket, one folder at a time.
const creds = r2Credentials({ required: false });
if (!creds.ok) skip(`no R2 credentials (${creds.missing.join(', ')} not set; ${REPO_PATHS.envFile} holds them in the main checkout)`);
const store = await openS3BlobStore({ bucket: creds.bucket, clientOptions: s3ClientOptions(creds, { maxAttempts: 3 }) });
const folders = foldersOf([...local.keys(), ...refs.keys()]);
/** @type {Map<string, RemoteObject>} */
const remote = new Map();
try {
  await mapWithConcurrency(folders, 8, async (prefix) => {
    /** @type {string | undefined} */
    let cursor;
    do {
      const page = await store.list({ prefix, delimiter: '/', cursor });
      for (const o of page.entries) remote.set(o.key, { size: o.size, etag: o.etag, uploaded: o.uploaded });
      cursor = page.cursor || undefined;
    } while (cursor);
  });
} catch (error) {
  const e = /** @type {{ name?: string, code?: string, message?: string }} */ (error);
  const what = `${e.code || e.name || 'error'}: ${String(e.message || '').slice(0, 120)}`;
  // No network is a skip; the bucket refusing the keys (or anything else) is a failure to fix.
  if (/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|TimeoutError)$/.test(String(e.code || e.name))) skip(`the bucket could not be reached (${what})`);
  console.error(`\n  FAIL: listing the bucket failed (${what}).`);
  process.exit(2);
}
console.log(`  bucket: ${folders.length} folder(s) listed, ${remote.size} object(s)`);

// 4. Hash what needs it, from the cache when the file is unchanged.
/** @type {Record<string, CacheEntry>} */
let cache = {};
try { cache = readJson(CACHE_FILE).entries || {}; } catch { cache = {}; }
/** @type {Map<string, Digest>} */
const digests = new Map();
let hashedBytes = 0;
let hashedFiles = 0;
const toHash = [...local.entries()].filter(([key]) => HASH_ALL || refs.has(key));
await mapWithConcurrency(toHash, 4, async ([key, file]) => {
  const object = remote.get(key) || null;
  const abs = path.join(MIRROR_ROOT, key);
  const prior = cache[abs];
  /** @type {CacheEntry} */
  const fresh = prior && prior.size === file.size && prior.mtimeMs === file.mtimeMs ? prior : { size: file.size, mtimeMs: file.mtimeMs };
  // At most two passes: the likely part sizes, then (no match) every other candidate.
  for (let pass = 0; pass < 2; pass += 1) {
    const need = digestNeeded(file, object, fresh);
    if (!need.md5 && !need.partSizes.length) break;
    const digester = createDigester(need);
    for await (const chunk of createReadStream(abs, { highWaterMark: 4 * 1024 * 1024 })) digester.update(/** @type {Buffer} */ (chunk));
    const got = digester.result();
    if (got.md5) fresh.md5 = got.md5;
    if (got.multipart) fresh.multipart = { ...fresh.multipart, ...got.multipart };
    hashedBytes += file.size;
    hashedFiles += 1;
  }
  if (fresh.md5 || fresh.multipart) {
    cache[abs] = fresh;
    /** @type {Digest} */
    const known = {};
    if (fresh.md5) known.md5 = fresh.md5;
    if (fresh.multipart) known.multipart = fresh.multipart;
    digests.set(key, known);
  }
});
mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
writeFileSync(CACHE_FILE, `${JSON.stringify({ version: 1, entries: cache })}\n`);
console.log(`  hashed: ${hashedFiles} pass(es), ${(hashedBytes / 1e9).toFixed(2)} GB (the rest from ${path.relative(REPO_ROOT, CACHE_FILE)} or not needed)`);

// 5. The report.
const rows = compareMirror({ refs, local, remote, digests });
for (const line of formatReport(rows, { limit: LIMIT })) console.log(line);
if (JSON_FILE) writeFileSync(JSON_FILE, `${JSON.stringify({ at: new Date().toISOString(), mirror: mirrorDir, counts: summarise(rows), rows }, null, 1)}\n`);
const code = exitCodeFor(rows);
const seconds = ((Date.now() - started) / 1000).toFixed(0);
if (code) {
  // Again at the end, where a caller that shows only the tail (npm run rebuild) sees it.
  const stale = rows.filter((row) => row.scope === 'build' && row.verdict === 'stale').map((row) => row.key);
  console.error(`\n  FAIL: ${stale.length} local map file(s) the builds read differ from R2 (${seconds}s):`);
  for (const key of stale.slice(0, 10)) console.error(`    ${key}`);
  if (stale.length > 10) console.error(`    ... and ${stale.length - 10} more (listed above)`);
  console.error('  Refresh them from the bucket (an R2 download: the owner approves it) before building.');
} else {
  console.log(`\n  PASS: no file the builds read differs from R2 (${seconds}s).`);
}
process.exit(code);
