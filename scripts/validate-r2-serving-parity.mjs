#!/usr/bin/env node
/**
 * Assert that everything the site REFERENCES under an R2-served prefix actually
 * EXISTS in the bucket.
 *
 * WHY THIS EXISTS
 *
 * Two production outages in one day had the identical shape: a file present in
 * the repo, absent from the store production actually reads, and a request that
 * looked healthy from outside.
 *
 *   FlatGeobuf runtime      repo yes / deploy no -> HTTP 200 serving HTML,
 *                           script blocked by nosniff, every FGB layer failed
 *   Catholic Dioceses chunks repo yes / R2 no    -> HTTP 404, layer broken
 *
 * Both were found by accident while doing something else. The asset-reference
 * validator added the same morning cannot catch them: it checks that referenced
 * paths exist LOCALLY, and in both cases they did. Once a Pages Function owns a
 * prefix, the repo copy is irrelevant -- proven by fetching a file present in
 * both places, where production returned the 4,300,570-byte R2 copy rather than
 * the repo's 3,422,232. So "is it in git" answers the wrong question entirely.
 *
 * WHAT IT CHECKS
 *
 * Served prefixes are discovered from functions/ rather than hardcoded, so a new
 * proxy is covered the moment it is added. References are collected from:
 *
 *   data/database/maps.json   the layer registry -- absolute data.civgraph.net
 *                             URLs and repo-relative paths, both forms in use
 *   *-chunks.json             chunk indexes, whose `file` and `zoomFiles` entries
 *                             are the individual parts. This is the case that
 *                             broke: the parts are named nowhere else.
 *
 * Fields carrying prose or templates are excluded deliberately -- sourceNotes is
 * commentary, and an xyz value contains {z}/{x}/{y} and names no single object.
 *
 * Usage:
 *   node scripts/validate-r2-serving-parity.mjs [--json] [--list-orphans]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');
const LIST_ORPHANS = process.argv.includes('--list-orphans');

/** Which prefixes does a Pages Function serve from R2? Derived, not hardcoded. */
function servedPrefixes() {
  const out = [];
  const fnRoot = path.join(ROOT, 'functions');
  const walk = (dir, parts) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), [...parts, e.name]);
      else if (/^\[\[.*\]\]\.js$/.test(e.name) && parts.length) {
        const src = readFileSync(path.join(dir, e.name), 'utf8');
        // Only count it if the handler actually reaches for R2.
        if (/R2|env\.[A-Z_]*BUCKET|\.get\(key\)/.test(src)) out.push(`${parts.join('/')}/`);
      }
    }
  };
  walk(fnRoot, []);
  return out;
}

const PREFIXES = servedPrefixes();
if (!PREFIXES.length) {
  console.log('No R2-served prefixes found under functions/. Nothing to check.');
  process.exit(0);
}

// maps.json keys whose values name a single stored object. Excluded on purpose:
// sourceNotes (prose), xyz (tile template containing {z}/{x}/{y}).
const ASSET_KEYS = new Set(['fgb', 'geojson', 'url', 'image', 'file', 'kml', 'zip', 'shapefile', 'pmtiles', 'csv']);

const referenced = new Map();   // key -> Set of "where it was referenced"

function noteRef(raw, origin) {
  if (typeof raw !== 'string' || !raw) return;
  if (raw.includes('{z}') || raw.includes('{x}') || raw.includes('{y}')) return;   // tile template
  let p = raw;
  const m = /^https?:\/\/[^/]+\/(.*)$/.exec(p);
  if (m) p = m[1];
  p = p.split('#')[0].split('?')[0].replace(/^\/+/, '');
  try { p = decodeURIComponent(p); } catch { /* leave as-is */ }
  if (!PREFIXES.some((pre) => p.startsWith(pre))) return;
  if (!referenced.has(p)) referenced.set(p, new Set());
  referenced.get(p).add(origin);
}

// 1. The layer registry.
const mapsPath = path.join(ROOT, 'data/database/maps.json');
if (existsSync(mapsPath)) {
  const db = JSON.parse(readFileSync(mapsPath, 'utf8'));
  const maps = db.maps || db;
  const walkValue = (node, key) => {
    if (Array.isArray(node)) { for (const v of node) walkValue(v, key); return; }
    if (node && typeof node === 'object') { for (const [k, v] of Object.entries(node)) walkValue(v, k); return; }
    if (typeof node === 'string' && ASSET_KEYS.has(key)) noteRef(node, 'maps.json');
  };
  for (const m of maps) walkValue(m, null);
}

// 2. Chunk indexes. Their `file` / `zoomFiles` entries are the only place the
//    individual parts are named -- exactly what was missing for Catholic Dioceses.
function findChunkIndexes(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...findChunkIndexes(p));
    else if (/chunks?.*\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}
for (const pre of PREFIXES) {
  for (const idx of findChunkIndexes(path.join(ROOT, pre))) {
    let doc;
    try { doc = JSON.parse(readFileSync(idx, 'utf8')); } catch { continue; }
    const rel = path.relative(ROOT, idx).split(path.sep).join('/');
    noteRef(rel, 'on-disk chunk index');
    for (const c of doc.chunks || []) {
      noteRef(c.file, rel);
      for (const zf of Object.values(c.zoomFiles || {})) noteRef(zf, rel);
    }
  }
}

console.log('R2 serving parity');
console.log(`  served prefixes : ${PREFIXES.join(', ')}`);
console.log(`  references found: ${referenced.size}`);

const ENDPOINT = process.env.R2_S3_ENDPOINT;
const BUCKET = process.env.R2_BUCKET;
if (!ENDPOINT || !BUCKET || !process.env.R2_ACCESS_KEY_ID) {
  // Skip rather than fail: a contributor without R2 credentials should still be
  // able to run npm run check. But say so loudly and in the language of what was
  // NOT established -- a silent pass here would recreate the exact failure this
  // script exists to catch, where absence of evidence read as evidence of health.
  console.log('\n  SKIPPED — no R2 credentials in the environment.');
  console.log('  This check was NOT performed. Referenced objects may be missing from the');
  console.log('  bucket and this run cannot tell you. Source .env.local and re-run to verify.');
  process.exit(0);
}

const s3 = new S3Client({
  region: 'auto', endpoint: ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});

const held = new Set();
for (const pre of PREFIXES) {
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: pre, ContinuationToken: token }));
    for (const o of r.Contents || []) held.add(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
}
console.log(`  objects in bucket: ${held.size}`);

const missing = [...referenced.entries()].filter(([k]) => !held.has(k));
console.log(`  referenced but ABSENT from R2: ${missing.length}`);

for (const [k, origins] of missing.slice(0, 25)) {
  console.log(`\n  MISSING  ${k}`);
  console.log(`      referenced by : ${[...origins].join(', ')}`);
  const localCopy = path.join(ROOT, k);
  console.log(`      in repo       : ${existsSync(localCopy) ? 'yes — present locally but NOT served' : 'no'}`);
}
if (missing.length > 25) console.log(`\n  ... and ${missing.length - 25} more`);

if (LIST_ORPHANS) {
  const orphan = [...held].filter((k) => !referenced.has(k));
  console.log(`\n  on R2 but unreferenced: ${orphan.length} (informational, not a failure)`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ prefixes: PREFIXES, referenced: referenced.size, held: held.size, missing: missing.map(([k]) => k) }, null, 2));
}

if (missing.length) {
  console.error(`\n  FAIL: ${missing.length} referenced object(s) do not exist in R2.`);
  console.error('  Production reads the bucket, not the repo, so these requests 404 (or worse,');
  console.error('  return a fallback with HTTP 200) no matter what the working tree contains.');
  process.exit(1);
}
console.log('\n  PASS: every referenced object exists in the bucket.');
