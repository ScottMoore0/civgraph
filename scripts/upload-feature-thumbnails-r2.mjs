#!/usr/bin/env node
/**
 * Upload rendered feature thumbnails to the boundaries-data R2 bucket.
 *
 * The bitmap corpus is intentionally kept out of Git/Cloudflare Pages. This
 * script syncs the ignored local render output to R2/CDN and writes a report
 * that can be used to verify publication before committing the compact asset
 * registry and manifest.
 *
 * Usage:
 *   node scripts/upload-feature-thumbnails-r2.mjs --dry-run
 *   node scripts/upload-feature-thumbnails-r2.mjs --skip-check
 *   node scripts/upload-feature-thumbnails-r2.mjs --skip-check --no-resume
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const DEFAULT_ROOT = path.join(ROOT, 'tmp/feature-thumbnails-rendered');
const DEFAULT_REPORT = path.join(ROOT, 'tmp/feature-thumbnails-rendered/_r2-upload-report.json');
const DEFAULT_BUCKET = 'boundaries-data';
const DEFAULT_ACCOUNT_ID = 'e51cbcff3bf6c7509f93f4e4ed67a394';
const SUPPORTED_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.avif']);

const args = parseArgs(process.argv.slice(2));
const LOCAL_ROOT = path.resolve(ROOT, args.root || process.env.FEATURE_THUMBNAIL_RENDERED_ROOT || DEFAULT_ROOT);
const REPORT_PATH = path.resolve(ROOT, args.report || DEFAULT_REPORT);
const BUCKET = args.bucket || process.env.R2_BUCKET || DEFAULT_BUCKET;
const ACCOUNT_ID = args.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
const KEY_PREFIX = String(args.prefix || process.env.FEATURE_THUMBNAIL_R2_PREFIX || 'data/thumbnails/features').replace(/^\/+|\/+$/g, '');
const CONCURRENCY = Math.max(1, Number(args.concurrency || process.env.FEATURE_THUMBNAIL_UPLOAD_CONCURRENCY || 10));
const DRY_RUN = Boolean(args.dryRun);
const SKIP_CHECK = Boolean(args.skipCheck);
const RESUME = !DRY_RUN && !args.noResume;
const LIMIT = Number.isFinite(Number(args.limit)) ? Math.max(0, Number(args.limit)) : Infinity;

if (!fs.existsSync(LOCAL_ROOT) || !fs.statSync(LOCAL_ROOT).isDirectory()) {
  console.error(`Rendered thumbnail directory does not exist: ${path.relative(ROOT, LOCAL_ROOT) || LOCAL_ROOT}`);
  process.exit(1);
}

const token = readWranglerToken();
if (!DRY_RUN && !token) {
  console.error('No Wrangler OAuth token found. Run `npx wrangler whoami` or set Cloudflare credentials before uploading.');
  process.exit(1);
}

const allFiles = listFiles(LOCAL_ROOT)
  .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b));
const indexedFiles = allFiles.map((file, index) => ({ file, index, key: keyFor(file) }));
const previousResults = RESUME ? readCompletedResults(REPORT_PATH) : [];
const completedKeys = new Set(previousResults.map((item) => item.key).filter(Boolean));
const uploadQueue = (Number.isFinite(LIMIT) ? indexedFiles.slice(0, LIMIT) : indexedFiles)
  .filter((item) => !completedKeys.has(item.key));
const results = [...previousResults];
const startedAt = new Date().toISOString();
let cursor = 0;

if (!allFiles.length) {
  console.error(`No rendered thumbnail files found under ${path.relative(ROOT, LOCAL_ROOT)}`);
  process.exit(1);
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Uploading ${uploadQueue.length.toLocaleString('en-IE')} of ${allFiles.length.toLocaleString('en-IE')} rendered feature thumbnails to ${BUCKET}/${KEY_PREFIX}/ with concurrency ${CONCURRENCY}.`);
if (SKIP_CHECK) console.log('Skipping R2 existence checks; objects will be overwritten if they already exist.');
if (previousResults.length) console.log(`Resuming from ${previousResults.length.toLocaleString('en-IE')} successful prior upload records in ${path.relative(ROOT, REPORT_PATH)}.`);

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uploadQueue.length) }, worker));
const report = writeReport();
console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
console.log(JSON.stringify(report.totals, null, 2));
if (report.totals.failed) process.exit(1);

async function worker() {
  while (cursor < uploadQueue.length) {
    const index = cursor;
    cursor += 1;
    const item = uploadQueue[index];
    const result = await uploadOne(item.file, item.index);
    results.push(result);
    const done = results.length;
    if (done === 1 || done % 250 === 0 || done === allFiles.length || result.status === 'upload-failed') {
      console.log(`${done.toLocaleString('en-IE')}/${allFiles.length.toLocaleString('en-IE')} ${result.status} ${result.key}`);
      writeReport();
    }
  }
}

async function uploadOne(file, index) {
  const relativePath = path.relative(LOCAL_ROOT, file).replace(/\\/g, '/');
  const key = keyFor(file);
  const bytes = fs.statSync(file).size;
  const contentType = contentTypeFor(file);
  if (DRY_RUN) return { index, file: relativePath, key, bytes, contentType, ok: true, status: 'dry-run' };
  try {
    if (!SKIP_CHECK) {
      const exists = await withRetries(() => r2Head(key), 4);
      if (exists) return { index, file: relativePath, key, bytes, contentType, ok: true, status: 'exists' };
    }
    const body = fs.readFileSync(file);
    await withRetries(() => r2Put(key, body, contentType), 5);
    return { index, file: relativePath, key, bytes, contentType, ok: true, status: 'uploaded' };
  } catch (error) {
    return { index, file: relativePath, key, bytes, contentType, ok: false, status: 'upload-failed', error: String(error.message || error).slice(0, 2000) };
  }
}

async function r2Head(key) {
  const response = await fetch(apiObjectUrl(key), { method: 'HEAD', headers: authHeaders() });
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new Error(`HEAD ${key} -> ${response.status}: ${await safeText(response)}`);
}

async function r2Put(key, body, contentType) {
  const response = await fetch(apiObjectUrl(key), {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
    body
  });
  if (!response.ok) throw new Error(`PUT ${key} -> ${response.status}: ${await safeText(response)}`);
}

function apiObjectUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
}

function authHeaders() {
  return { Authorization: `Bearer ${token}` };
}

async function safeText(response) {
  try { return (await response.text()).slice(0, 500); } catch { return ''; }
}

async function withRetries(fn, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await fn(); } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (attempt >= attempts) break;
      const delay = Math.min(1000 * attempt * attempt, 8000);
      if (/429|rate|timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(message)) await sleep(delay);
      else await sleep(Math.min(delay, 1500));
    }
  }
  throw lastError;
}

function writeReport() {
  const totals = {
    files: allFiles.length,
    processed: results.length,
    uploaded: results.filter((item) => item.status === 'uploaded').length,
    exists: results.filter((item) => item.status === 'exists').length,
    dryRun: results.filter((item) => item.status === 'dry-run').length,
    failed: results.filter((item) => !item.ok).length,
    bytes: results.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
  };
  const report = {
    schemaVersion: 1,
    startedAt,
    generatedAt: new Date().toISOString(),
    localRoot: path.relative(ROOT, LOCAL_ROOT).replace(/\\/g, '/'),
    bucket: BUCKET,
    keyPrefix: KEY_PREFIX,
    dryRun: DRY_RUN,
    skipCheck: SKIP_CHECK,
    concurrency: CONCURRENCY,
    resume: RESUME,
    totals,
    results: results.sort((a, b) => a.index - b.index)
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

function readCompletedResults(reportPath) {
  if (!fs.existsSync(reportPath)) return [];
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return Array.isArray(report.results)
      ? report.results.filter((item) => item?.ok && item.key)
      : [];
  } catch (error) {
    console.warn(`Could not read previous upload report for resume: ${String(error.message || error)}`);
    return [];
  }
}

function keyFor(file) {
  const relativePath = path.relative(LOCAL_ROOT, file).replace(/\\/g, '/');
  return `${KEY_PREFIX}/${relativePath}`;
}

function listFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(fullPath));
    else if (entry.isFile()) output.push(fullPath);
  }
  return output;
}

function contentTypeFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.avif') return 'image/avif';
  return 'application/octet-stream';
}

function readWranglerToken() {
  const candidates = [];
  if (process.env.CLOUDFLARE_API_TOKEN) candidates.push({ token: process.env.CLOUDFLARE_API_TOKEN, source: 'CLOUDFLARE_API_TOKEN' });
  const appData = process.env.APPDATA;
  const home = os.homedir();
  if (appData) candidates.push({ path: path.join(appData, 'xdg.config', '.wrangler', 'config', 'default.toml') });
  if (home) candidates.push({ path: path.join(home, '.wrangler', 'config', 'default.toml') });
  for (const candidate of candidates) {
    if (candidate.token) return candidate.token;
    if (!candidate.path || !fs.existsSync(candidate.path)) continue;
    const text = fs.readFileSync(candidate.path, 'utf8');
    const token = text.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
    if (token) return token;
  }
  return null;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--skip-check') parsed.skipCheck = true;
    else if (arg === '--no-resume') parsed.noResume = true;
    else if (arg === '--root') parsed.root = argv[++index];
    else if (arg.startsWith('--root=')) parsed.root = arg.slice('--root='.length);
    else if (arg === '--report') parsed.report = argv[++index];
    else if (arg.startsWith('--report=')) parsed.report = arg.slice('--report='.length);
    else if (arg === '--bucket') parsed.bucket = argv[++index];
    else if (arg.startsWith('--bucket=')) parsed.bucket = arg.slice('--bucket='.length);
    else if (arg === '--account-id') parsed.accountId = argv[++index];
    else if (arg.startsWith('--account-id=')) parsed.accountId = arg.slice('--account-id='.length);
    else if (arg === '--prefix') parsed.prefix = argv[++index];
    else if (arg.startsWith('--prefix=')) parsed.prefix = arg.slice('--prefix='.length);
    else if (arg === '--concurrency') parsed.concurrency = argv[++index];
    else if (arg.startsWith('--concurrency=')) parsed.concurrency = arg.slice('--concurrency='.length);
    else if (arg === '--limit') parsed.limit = argv[++index];
    else if (arg.startsWith('--limit=')) parsed.limit = arg.slice('--limit='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
