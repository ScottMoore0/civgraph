#!/usr/bin/env node
/**
 * Copy R2 objects to new keys, server-side, for the wave-3 renames (site-restructure
 * DESIGN.md section 5, renames.csv): data/maps/test/pmtiles/generated/<id>-vector-test.pmtiles
 * becomes data/maps/pmtiles/<id>-vector.pmtiles. R2 has no redirects, so the old object must
 * stay where it is (12 months, then one listed deletion); this only ever ADDS objects.
 *
 *   node scripts/publish/r2-copy-keys.mjs plan   [--source render/metadata/maps-test.json] [--out <manifest.json>]
 *   node scripts/publish/r2-copy-keys.mjs copy   --manifest <m.json> [--apply]
 *   node scripts/publish/r2-copy-keys.mjs verify --manifest <m.json>
 *
 * plan    offline: reads every tileUrl in the layer registry, applies the rename rule
 *         (scripts/lib/layer-renames.mjs) and writes the manifest of { from, to } pairs,
 *         one per distinct object (alias layers share their target's file).
 * copy    a dry run unless --apply: lists what it would copy. With --apply it refuses a
 *         manifest without an `approval` entry (recorded by the main session from the owner's
 *         words in chat, never by a subagent), then for each pair: HEAD the destination,
 *         skip it if it already holds the same object, refuse if it holds a different one,
 *         otherwise CopyObject (no download; metadata, Content-Type and Cache-Control copied)
 *         and HEAD it again to confirm size and ETag. Writes a receipt next to the manifest.
 * verify  read-only: HEADs both keys of every pair and reports any that differ or are missing.
 *
 * Bulk work uses the S3 endpoint (memory note feedback_r2_upload_path.md), with the R2_*
 * variables from .env.local. Credentials are read from the environment and never printed.
 * Nothing here deletes, and nothing runs from .claude/publish/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEW_PMTILES_PREFIX, OLD_PMTILES_PREFIX, renamePmtilesKey } from '../lib/layer-renames.mjs';
import { r2Credentials, s3ClientOptions } from './r2-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_SOURCE = 'render/metadata/maps-test.json';
const DEFAULT_OUT = 'tmp/r2-key-renames/pmtiles.json';
/** CopyObject copies at most 5 GiB in one request; larger objects need a multipart copy. */
export const MAX_SINGLE_COPY_BYTES = 5 * 1024 ** 3;
const ALLOWED_PREFIXES = [OLD_PMTILES_PREFIX, NEW_PMTILES_PREFIX];

/** Every tileUrl string in a JSON document, wherever it sits. */
export function collectTileUrls(doc) {
  const urls = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'tileUrl' && typeof value === 'string') urls.push(value);
        else walk(value);
      }
    }
  };
  walk(doc);
  return urls;
}

/** The manifest for a layer registry: distinct pairs, sorted, plus what was left out. */
export function planManifest(doc, { source = DEFAULT_SOURCE, today = new Date() } = {}) {
  const pairs = new Map();
  const skipped = new Map();
  for (const url of collectTileUrls(doc)) {
    const pair = renamePmtilesKey(url);
    if (pair) pairs.set(pair.from, pair.to);
    else skipped.set(url, (skipped.get(url) || 0) + 1);
  }
  const targets = new Map();
  for (const [from, to] of pairs) {
    if (targets.has(to)) throw new Error(`${from} and ${targets.get(to)} would both be copied to ${to}`);
    targets.set(to, from);
  }
  const retain = new Date(today);
  retain.setUTCFullYear(retain.getUTCFullYear() + 1);
  return {
    schemaVersion: 1,
    kind: 'r2-key-renames',
    description: 'Server-side copies of PMTiles archives to their renamed keys; the old keys stay until retainOldUntil.',
    source,
    generatedAt: today.toISOString(),
    retainOldUntil: retain.toISOString().slice(0, 10),
    approval: null,
    pairs: [...pairs].sort(([a], [b]) => a.localeCompare(b)).map(([from, to]) => ({ from, to })),
    notCovered: [...skipped].sort(([a], [b]) => a.localeCompare(b)).map(([url, count]) => ({ url, count })),
  };
}

/** Problems that make a manifest unsafe to run. */
export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.kind !== 'r2-key-renames' || manifest.schemaVersion !== 1) errors.push('not an r2-key-renames v1 manifest');
  const pairs = Array.isArray(manifest?.pairs) ? manifest.pairs : [];
  if (!pairs.length) errors.push('no pairs');
  const seenTo = new Set();
  for (const [i, p] of pairs.entries()) {
    if (!p?.from || !p?.to) { errors.push(`pair ${i}: needs from and to`); continue; }
    if (p.from === p.to) errors.push(`pair ${i}: from and to are the same key`);
    for (const key of [p.from, p.to]) {
      if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) || key.includes('..') || key.endsWith('/')) {
        errors.push(`pair ${i}: ${key} is outside ${ALLOWED_PREFIXES.join(' and ')}`);
      }
    }
    if (seenTo.has(p.to)) errors.push(`pair ${i}: ${p.to} is a destination twice`);
    seenTo.add(p.to);
  }
  return errors;
}

export function copySource(bucket, key) {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function head(client, commands, bucket, key) {
  try {
    const res = await client.send(new commands.HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(res.ContentLength), etag: res.ETag || null };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return null;
    throw error;
  }
}

const sameObject = (a, b) => Boolean(a && b && a.size === b.size && (!a.etag || !b.etag || a.etag === b.etag));

/**
 * Copy (or, without apply, plan) every pair. `client` is an S3Client; `commands` holds the
 * command classes, injected so tests need no network. Returns per-pair results.
 */
export async function copyPairs(pairs, { client, commands, bucket, apply = false, log = console.log }) {
  const results = [];
  for (const { from, to } of pairs) {
    if (!apply) {
      log(`would copy ${from} -> ${to}`);
      results.push({ from, to, status: 'planned' });
      continue;
    }
    const source = await head(client, commands, bucket, from);
    if (!source) { results.push({ from, to, status: 'error', detail: 'source missing' }); continue; }
    if (source.size > MAX_SINGLE_COPY_BYTES) { results.push({ from, to, status: 'error', detail: `source is ${source.size} bytes; needs a multipart copy` }); continue; }
    const existing = await head(client, commands, bucket, to);
    if (existing) {
      results.push(sameObject(source, existing)
        ? { from, to, status: 'already-copied', size: source.size }
        : { from, to, status: 'error', detail: 'destination exists with different content; not overwritten' });
      continue;
    }
    await client.send(new commands.CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: copySource(bucket, from), MetadataDirective: 'COPY' }));
    const copied = await head(client, commands, bucket, to);
    results.push(sameObject(source, copied)
      ? { from, to, status: 'copied', size: source.size }
      : { from, to, status: 'error', detail: 'copy does not match its source' });
    log(`copied ${from} -> ${to}`);
  }
  return results;
}

/** Read-only comparison of every pair. */
export async function verifyPairs(pairs, { client, commands, bucket }) {
  const results = [];
  for (const { from, to } of pairs) {
    const [a, b] = [await head(client, commands, bucket, from), await head(client, commands, bucket, to)];
    let status = 'ok';
    if (!a) status = 'old-missing';
    else if (!b) status = 'new-missing';
    else if (!sameObject(a, b)) status = 'differ';
    results.push({ from, to, status });
  }
  return results;
}

async function s3FromEnv() {
  // Loads .env.local; throws R2CredentialsError (names only) when a variable is still missing.
  const r2 = r2Credentials();
  const sdk = await import('@aws-sdk/client-s3');
  const client = new sdk.S3Client(s3ClientOptions(r2));
  return { client, commands: sdk, bucket: r2.bucket };
}

function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function summarise(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
}

export async function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  if (command === 'plan') {
    const source = argValue(argv, '--source') || DEFAULT_SOURCE;
    const out = path.resolve(ROOT, argValue(argv, '--out') || DEFAULT_OUT);
    const manifest = planManifest(JSON.parse(readFileSync(path.resolve(ROOT, source), 'utf8')), { source });
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${manifest.pairs.length} object(s) to copy, ${manifest.notCovered.length} tileUrl(s) not covered by the rename; wrote ${path.relative(ROOT, out)}`);
    return 0;
  }
  if (command !== 'copy' && command !== 'verify') {
    console.error('Usage: r2-copy-keys.mjs <plan|copy|verify> [--manifest <file>] [--apply]');
    return 2;
  }
  const manifestPath = argValue(argv, '--manifest');
  if (!manifestPath || !existsSync(manifestPath)) {
    console.error('r2-copy-keys: --manifest <file> is required (make one with plan)');
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = validateManifest(manifest);
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    return 1;
  }
  const apply = argv.includes('--apply');
  if (command === 'copy' && !apply) {
    await copyPairs(manifest.pairs, { apply: false });
    console.log(`DRY RUN: ${manifest.pairs.length} copy(ies) planned; nothing was sent. --apply copies (needs the manifest's approval entry).`);
    return 0;
  }
  if (command === 'copy' && !(manifest.approval?.date && manifest.approval?.note)) {
    console.error('r2-copy-keys: the manifest has no approval {date, note}; an R2 upload needs the owner\'s approval in chat, recorded by the main session.');
    return 1;
  }
  const s3 = await s3FromEnv();
  if (command === 'verify') {
    const results = await verifyPairs(manifest.pairs, s3);
    for (const r of results.filter((x) => x.status !== 'ok')) console.log(`${r.status}: ${r.from} -> ${r.to}`);
    console.log(`verify: ${summarise(results)}`);
    return results.every((r) => r.status === 'ok') ? 0 : 1;
  }
  const results = await copyPairs(manifest.pairs, { ...s3, apply: true });
  const receipt = manifestPath.replace(/\.json$/, '') + '.receipt.json';
  writeFileSync(receipt, `${JSON.stringify({ manifest: path.basename(manifestPath), finishedAt: new Date().toISOString(), results }, null, 2)}\n`);
  for (const r of results.filter((x) => x.status === 'error')) console.error(`ERROR ${r.from}: ${r.detail}`);
  console.log(`copy: ${summarise(results)}; receipt ${receipt}`);
  return results.some((r) => r.status === 'error') ? 1 : 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().then((code) => { process.exitCode = code; }, (error) => { console.error(`r2-copy-keys: ${error.message}`); process.exitCode = 1; });
