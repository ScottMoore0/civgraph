#!/usr/bin/env node
/**
 * Give R2 objects an explicit Cache-Control, because absent is the worst value.
 *
 * THE FAILURE THIS FIXES
 *
 * data.civgraph.net served every map object with NO Cache-Control header --
 * only ETag and Last-Modified. That is not "no caching"; it hands the decision
 * to the browser's heuristic, which RFC 9111 4.2.2 suggests be a fraction of the
 * document's age, commonly 10%. Sampled across the bucket on 2026-08-16, map
 * objects carried Last-Modified dates in early April, roughly 133 days back,
 * which buys about THIRTEEN DAYS of freshness during which a browser does not
 * even revalidate.
 *
 * That is how five corrected Local Authority layers went live on 2026-08-16,
 * byte-verified at the edge, and stayed invisible to the contributor who
 * supplied them.
 *
 * Read the shape of that failure carefully: staleness scales with the age of the
 * file, so the longer a layer has sat unchanged, the longer a correction to it
 * takes to arrive. The cache behaves worst precisely where the data is most
 * established and a correction matters most.
 *
 * WHY max-age=3600 AND NOT THE 86400 USED BY THE PAGES PROXY
 *
 * functions/data/maps/[[path]].js sends max-age=86400 with a week of
 * stale-while-revalidate, and its comment explains why it moved there from
 * `immutable, max-age=31536000`: a re-upload to an existing key was not being
 * picked up. This is the same argument carried one step further by evidence. A
 * day of hard freshness on a key that gets corrected in place is a day of
 * serving known-wrong geometry with no way to intervene, and that day has now
 * actually cost something.
 *
 * An hour of freshness covers the repeat fetches within a browsing session,
 * which is what caching is for here. After that, stale-while-revalidate=86400
 * means the visitor still gets an instant answer from cache while the refresh
 * happens behind them, so the cost of the shorter window is one background
 * conditional request, not a slower page. Against an 8 MB body a 304 is free.
 *
 * NOTE THE INTERACTION WITH CACHE TOKENS
 *
 * Rewriting metadata is a CopyObject, and scripts/stamp-map-cache-tokens.mjs
 * derives its `?v=` token from the object's ETag. If a copy changed the ETag,
 * every token in the catalogue would silently stop matching the file it names.
 *
 * MEASURED on the 2026-08-16 run: R2 preserved the ETag across all 10,917
 * copies -- for a simple (non-multipart) copy it stays the content MD5, so no
 * restamping was needed. That is an observation about today's R2, not a promise.
 * Run this after any future backfill:
 *
 *   npm run verify:map-tokens
 *
 * and if it fails, the fix is:
 *
 *   node scripts/stamp-map-cache-tokens.mjs --write
 *   npm run build:catalogue-d1   (and load it into D1)
 *
 * WHY THIS DOES NOT TOUCH THE WHOLE PREFIX
 *
 * data/maps/ holds 1,221,020 objects and 48.2 GB. 1,207,367 of them are PNG
 * raster tiles; only 6,489 are FGB. Rewriting metadata on all of them is roughly
 * 2.4 million API calls and many hours, and it would be the wrong thing anyway:
 * a tile pyramid is regenerated wholesale rather than corrected in place, so
 * tiles want LONGER caching, not shorter. They are not the class that failed.
 *
 * So the default is the catalogue geometry family -- fgb and its precompressed
 * .gz/.br siblings, which the Pages proxy serves in its place and which would go
 * stale identically. About 11,000 objects. Everything skipped is counted and
 * reported by extension, because a scope limit nobody can see reads as coverage
 * nobody has.
 *
 * A Cloudflare Cache Rule with a Browser TTL would cover all 1.2M at once
 * without any R2 operations, and is the better long-term answer for the tiles.
 * It lives in the dashboard rather than the repo, so it is a decision to take
 * deliberately and record in docs/cloudflare-inventory.md, not something to do
 * from a script.
 *
 * Usage:
 *   set -a; . ./.env.local; set +a
 *   node scripts/set-r2-cache-control.mjs                        # dry run
 *   node scripts/set-r2-cache-control.mjs --apply
 *   node scripts/set-r2-cache-control.mjs --ext png --apply      # widen if wanted
 *   node scripts/set-r2-cache-control.mjs --ext '*' --apply      # everything
 */
import {
  S3Client, ListObjectsV2Command, HeadObjectCommand, CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { assertPublishable } from './lib/r2-publication-gate.mjs';

const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';

// Simple CopyObject has a hard ceiling; anything larger needs a multipart copy,
// which is a different and much more expensive operation. Nothing under
// data/maps/ is near this, so such an object is reported rather than handled.
const MAX_COPY_BYTES = 4.9 * 1024 * 1024 * 1024;

// Metadata rewrites are one round trip each, and 11,000 of them serially is
// half an hour of waiting for no reason. R2 handles this level of concurrency
// comfortably; the SDK retries on the rare 429.
const CONCURRENCY = 24;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const prefixArg = argv[argv.indexOf('--prefix') + 1];
const PREFIX = argv.includes('--prefix') && prefixArg ? prefixArg : 'data/maps/';
const extArg = argv.includes('--ext') ? String(argv[argv.indexOf('--ext') + 1] || '') : 'fgb,gz,br';
const EXTENSIONS = extArg === '*' ? null : new Set(extArg.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

function extensionOf(key) {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_S3_ENDPOINT, R2_BUCKET } = process.env;
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_S3_ENDPOINT || !R2_BUCKET) {
  console.error('FAIL: R2 credentials are not in the environment.');
  console.error('  set -a; . ./.env.local; set +a');
  process.exit(1);
}

// This only ever rewrites metadata on objects that are ALREADY public, so it
// cannot publish anything new. The gate is still asserted, because "it cannot
// publish" is a property of today's code and the check costs nothing.
assertPublishable([PREFIX]);

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_S3_ENDPOINT,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  maxAttempts: 5,
});

async function* listAll(prefix) {
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000,
    }));
    for (const obj of page.Contents || []) yield obj;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

const stats = { listed: 0, considered: 0, alreadySet: 0, updated: 0, tooLarge: 0, failed: 0 };
const skippedByExt = new Map();
const problems = [];

console.log(`${APPLY ? 'Setting' : 'Checking (dry run)'} Cache-Control on s3://${R2_BUCKET}/${PREFIX}`);
console.log(`  value      : ${CACHE_CONTROL}`);
console.log(`  extensions : ${EXTENSIONS ? [...EXTENSIONS].join(', ') : 'ALL'}\n`);

async function handle(obj) {
  let head;
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key }));
  } catch (error) {
    stats.failed += 1;
    problems.push(`${obj.Key}: HEAD failed (${error.name})`);
    return;
  }

  if (head.CacheControl === CACHE_CONTROL) { stats.alreadySet += 1; return; }
  if ((obj.Size || 0) > MAX_COPY_BYTES) {
    stats.tooLarge += 1;
    problems.push(`${obj.Key}: ${(obj.Size / 1e9).toFixed(1)} GB, too large for a simple copy`);
    return;
  }

  if (!APPLY) {
    stats.updated += 1;
    if (stats.updated <= 8) console.log(`  would set: ${obj.Key}  (currently ${head.CacheControl || 'ABSENT'})`);
    return;
  }

  try {
    // REPLACE discards everything not restated here, so ContentType, any
    // Content-Encoding and any custom metadata are carried across explicitly.
    // Losing the Content-Encoding on a .br sibling would be a worse bug than
    // the one being fixed -- the browser would be handed brotli as plain bytes.
    await s3.send(new CopyObjectCommand({
      Bucket: R2_BUCKET,
      Key: obj.Key,
      CopySource: `${R2_BUCKET}/${encodeURIComponent(obj.Key).replace(/%2F/g, '/')}`,
      MetadataDirective: 'REPLACE',
      CacheControl: CACHE_CONTROL,
      ContentType: head.ContentType || 'application/octet-stream',
      ...(head.ContentEncoding ? { ContentEncoding: head.ContentEncoding } : {}),
      ...(head.Metadata && Object.keys(head.Metadata).length ? { Metadata: head.Metadata } : {}),
    }));
    stats.updated += 1;
    if (stats.updated % 500 === 0) console.log(`  ${stats.updated} updated...`);
  } catch (error) {
    stats.failed += 1;
    problems.push(`${obj.Key}: copy failed (${error.name}: ${error.message})`);
  }
}

let inFlight = [];
for await (const obj of listAll(PREFIX)) {
  stats.listed += 1;
  const ext = extensionOf(obj.Key);
  if (EXTENSIONS && !EXTENSIONS.has(ext)) {
    skippedByExt.set(ext || '(none)', (skippedByExt.get(ext || '(none)') || 0) + 1);
    continue;
  }
  stats.considered += 1;
  inFlight.push(handle(obj));
  if (inFlight.length >= CONCURRENCY) { await Promise.all(inFlight); inFlight = []; }
}
await Promise.all(inFlight);

console.log('\nDone.');
console.log(`  objects listed    : ${stats.listed}`);
console.log(`  in scope          : ${stats.considered}`);
console.log(`  already correct   : ${stats.alreadySet}`);
console.log(`  ${APPLY ? 'updated         ' : 'would update    '}  : ${stats.updated}`);
if (stats.tooLarge) console.log(`  too large to copy : ${stats.tooLarge}`);
if (stats.failed) console.log(`  failed            : ${stats.failed}`);

// Say what was left out. A scope limit nobody can see reads as coverage.
if (skippedByExt.size) {
  const top = [...skippedByExt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('\n  SKIPPED, still with no Cache-Control:');
  for (const [ext, n] of top) console.log(`    .${ext.padEnd(8)} ${n}`);
  const total = [...skippedByExt.values()].reduce((a, b) => a + b, 0);
  console.log(`    ${total} objects in total. Widen with --ext, or set a Cloudflare Cache Rule.`);
}

if (problems.length) {
  console.log('\nProblems:');
  for (const line of problems.slice(0, 25)) console.log(`  - ${line}`);
  if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more`);
}

if (APPLY && stats.updated) {
  console.log('\nNEXT, and not optional:');
  console.log('  node scripts/stamp-map-cache-tokens.mjs --write   # ETags may have changed');
  console.log('  npm run build:catalogue-d1                        # then load it into D1');
  console.log('  npm run verify:map-tokens                         # proves the tokens still match');
}

process.exit(stats.failed ? 1 : 0);
