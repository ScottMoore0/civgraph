#!/usr/bin/env node
/*
 * Async detail-fetch runtime for PRONI Browse index snapshots.
 *
 * This is intentionally a fetch-phase runtime: the authoritative corpus
 * traversal remains scripts/proni-browse-corpus-crawler.ps1, which indexes via
 * Browse links and records page snapshots/postback metadata. This script then
 * reuses those snapshots with bounded async concurrency.
 */

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const BASE = 'https://apps.proni.gov.uk/eCatNI_IE/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36';

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1];
  return fallback;
}

function getNumberArg(name, fallback) {
  const value = Number(getArg(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html = '') {
  return decodeHtml(String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getTagAttribute(tag, name) {
  const doubleQuoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (doubleQuoted) return decodeHtml(doubleQuoted[1]);
  const singleQuoted = tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'));
  if (singleQuoted) return decodeHtml(singleQuoted[1]);
  return '';
}

function parseInputs(html) {
  const body = new Map();
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = getTagAttribute(tag, 'name');
    if (!name) continue;
    const type = (getTagAttribute(tag, 'type') || 'text').toLowerCase();
    if (['submit', 'image', 'button'].includes(type)) continue;
    if (!body.has(name)) body.set(name, getTagAttribute(tag, 'value'));
  }
  for (const key of ['__LASTFOCUS', '__EVENTTARGET', '__EVENTARGUMENT']) {
    if (body.has(key)) body.set(key, '');
  }
  if (body.has('__SCROLLPOSITIONX')) body.set('__SCROLLPOSITIONX', '0');
  if (body.has('__SCROLLPOSITIONY')) body.set('__SCROLLPOSITIONY', '0');
  return body;
}

function addRawAttribute(attributes, key, value) {
  if (!key) return;
  if (!(key in attributes)) {
    attributes[key] = value;
  } else if (Array.isArray(attributes[key])) {
    attributes[key].push(value);
  } else {
    attributes[key] = [attributes[key], value];
  }
}

function extractDetailFields(html) {
  const wanted = ['Repository', 'PRONI Reference', 'Level', 'Access', 'Title', 'Dates', 'Description', 'Digital Record'];
  const result = Object.fromEntries(wanted.map((key) => [key, '']));
  const canonicalByLower = new Map(wanted.map((key) => [key.toLowerCase(), key]));
  const rawAttributes = {};

  for (const rowMatch of html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
    const rowHtml = rowMatch[0];
    const labelMatch = rowHtml.match(/<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (!labelMatch) continue;
    const key = stripHtml(labelMatch[1]).replace(/:$/, '').trim();
    if (!key) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => stripHtml(cell[1]))
      .filter(Boolean);
    const value = cells.length >= 2 ? cells.slice(1).join(' ').trim() : '';
    addRawAttribute(rawAttributes, key, value);
    const canonical = canonicalByLower.get(key.toLowerCase());
    if (canonical) result[canonical] = value;
  }

  if (/^\[?\d+\s*-/.test(result['Digital Record'] || '')) {
    result['Digital Record'] = '';
    if ('Digital Record' in rawAttributes) rawAttributes['Digital Record'] = '';
  }

  return {
    ...result,
    rawAttributes,
    attributeKeys: Object.keys(rawAttributes),
    rawAttributeCount: Object.keys(rawAttributes).length
  };
}

async function readJsonl(file) {
  const raw = await readFile(file, 'utf8');
  return raw.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readJsonIfExists(file) {
  if (!file) return null;
  try {
    const raw = await readFile(path.resolve(file), 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function isBlocked(status, content) {
  if (status !== 200) return true;
  return /Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl/i.test(content);
}

function failureReason(status, content, error = '') {
  if (error) return error;
  if (status !== 200) return `http ${status}`;
  if (/Request Rejected|support ID/i.test(content)) return 'waf request rejected';
  if (/Access Denied/i.test(content)) return 'access denied text';
  if (/Too Many Requests|rate limit|throttl/i.test(content)) return 'rate-limit text';
  return 'blocked response text';
}

function classifyHtml(content = '') {
  if (/PRONI Reference/i.test(content)) return 'detail-like';
  if (/Browse Search Results|GridView1|ResultsView/i.test(content)) return 'browse-results-like';
  if (/SearchPage|Search Page|BrowseSearchPage/i.test(content)) return 'search-or-browse-start-like';
  if (/Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl/i.test(content)) return 'blocked-like';
  return 'unknown';
}

function makeLimiter(rps) {
  let nextAt = 0;
  const gap = rps > 0 ? 1000 / rps : 0;
  return async function waitTurn() {
    if (!gap) return;
    const now = performance.now();
    const wait = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + gap;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}

async function postDetailFromSnapshot(row, html, limiter, metadata = null) {
  if (!row.resultsViewName) throw new Error(`index row ${row.branchKey} page ${row.page} ${row.ctl} has no resultsViewName`);
  const form = parseInputs(html);
  form.set(row.resultsViewName, row.resultsViewValue || '');
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) params.append(key, value);
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9,en-GB;q=0.8',
    referer: `${BASE}BrowseSearchResults.aspx`,
    'content-type': 'application/x-www-form-urlencoded'
  };
  if (metadata?.cookieHeader) headers.cookie = metadata.cookieHeader;
  await limiter();
  const started = performance.now();
  const response = await fetch(`${BASE}BrowseSearchResults.aspx`, {
    method: 'POST',
    body: params,
    headers
  });
  const content = await response.text();
  return {
    ok: response.ok && !isBlocked(response.status, content),
    status: response.status,
    content,
    ms: performance.now() - started,
    reason: response.ok ? failureReason(response.status, content) : `http ${response.status}`
  };
}

async function runConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async (_, workerId) => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item, workerId + 1);
    }
  });
  await Promise.all(workers);
}

function groupRowsBySnapshot(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.pageSnapshotMetadataPath || row.pageSnapshotPath || `${row.branchKey}|${row.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()];
}

const indexPath = getArg('index');
const outDir = path.resolve(getArg('out-dir', 'tmp/proni-async-fetch'));
const maxRecords = getNumberArg('max-records', 100);
const concurrency = getNumberArg('concurrency', 8);
const globalRps = getNumberArg('global-rps', 12);
const stopOnBlocked = hasFlag('stop-on-blocked');
const debugHtmlDirArg = getArg('debug-html-dir', '');
const debugHtmlDir = debugHtmlDirArg ? path.resolve(debugHtmlDirArg) : '';
let debugHtmlSaved = 0;

if (!indexPath) {
  console.error('Usage: node scripts/proni-browse-async-fetch.mjs --index records-index.jsonl --out-dir D:\\PRONI\\... [--max-records 100] [--concurrency 8] [--global-rps 12]');
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
if (debugHtmlDir) await mkdir(debugHtmlDir, { recursive: true });
const detailsPath = path.join(outDir, 'records-details-async.jsonl');
const failuresPath = path.join(outDir, 'failures-async.jsonl');
const summaryPath = path.join(outDir, 'summary-async.json');
await rm(detailsPath, { force: true });
await rm(failuresPath, { force: true });

const rows = (await readJsonl(indexPath))
  .filter((row) => row.pageSnapshotPath && row.resultsViewName)
  .slice(0, maxRecords > 0 ? maxRecords : undefined);

const snapshotCache = new Map();
const metadataCache = new Map();
const limiter = makeLimiter(globalRps);
const summary = {
  startedAt: new Date().toISOString(),
  indexPath: path.resolve(indexPath),
  outDir,
  maxRecords,
  concurrency,
  globalRps,
  indexedRows: rows.length,
  detailsFetched: 0,
  failures: 0,
  mismatches: 0,
  blockedResponses: 0,
  snapshotReads: 0,
  snapshotCacheHits: 0,
  snapshotMetadataReads: 0,
  snapshotMetadataCacheHits: 0,
  snapshotGroups: 0
};

async function getSnapshot(snapshotPath) {
  const resolved = path.resolve(snapshotPath);
  if (snapshotCache.has(resolved)) {
    summary.snapshotCacheHits += 1;
    return snapshotCache.get(resolved);
  }
  const html = await readFile(resolved, 'utf8');
  snapshotCache.set(resolved, html);
  summary.snapshotReads += 1;
  return html;
}

async function getSnapshotMetadata(metadataPath) {
  if (!metadataPath) return null;
  const resolved = path.resolve(metadataPath);
  if (metadataCache.has(resolved)) {
    summary.snapshotMetadataCacheHits += 1;
    return metadataCache.get(resolved);
  }
  const metadata = await readJsonIfExists(resolved);
  metadataCache.set(resolved, metadata);
  if (metadata) summary.snapshotMetadataReads += 1;
  return metadata;
}

async function fetchRow(row, workerId) {
  try {
    const html = await getSnapshot(row.pageSnapshotPath);
    const metadata = await getSnapshotMetadata(row.pageSnapshotMetadataPath);
    const response = await postDetailFromSnapshot(row, html, limiter, metadata);
    if (!response.ok) {
      summary.failures += 1;
      summary.blockedResponses += isBlocked(response.status, response.content) ? 1 : 0;
      await appendFile(failuresPath, `${JSON.stringify({
        at: new Date().toISOString(),
        workerId,
        type: 'request-failed',
        branchKey: row.branchKey,
        page: row.page,
        ctl: row.ctl,
        expectedRef: row.expectedRef || '',
        status: response.status,
        ms: Math.round(response.ms * 1000) / 1000,
        reason: response.reason
      })}\n`);
      if (stopOnBlocked) throw new Error(response.reason);
      return;
    }

    const fields = extractDetailFields(response.content);
    const actual = String(fields['PRONI Reference'] || '');
    const expected = String(row.expectedRef || '');
    const mismatch = Boolean(expected && expected !== actual);
    if (mismatch) summary.mismatches += 1;
    const responseClass = classifyHtml(response.content);
    if (mismatch && debugHtmlDir && debugHtmlSaved < 4) {
      debugHtmlSaved += 1;
      const safeRef = expected.replace(/[^A-Za-z0-9_.-]+/g, '_') || `row-${debugHtmlSaved}`;
      await writeFile(path.join(debugHtmlDir, `${String(debugHtmlSaved).padStart(2, '0')}-${safeRef}.html`), response.content);
    }
    const record = {
      at: new Date().toISOString(),
      workerId,
      branchKey: row.branchKey,
      letter: row.letter,
      path: row.path || [],
      page: row.page,
      ctl: row.ctl,
      expectedRef: expected,
      extractedRef: actual,
      mismatch,
      repository: fields.Repository,
      proniReference: fields['PRONI Reference'],
      level: fields.Level,
      access: fields.Access,
      title: fields.Title,
      dates: fields.Dates,
      description: fields.Description,
      digitalRecord: fields['Digital Record'],
      rawAttributeCount: fields.rawAttributeCount,
      attributeKeys: fields.attributeKeys,
      rawAttributes: fields.rawAttributes,
      requestMs: Math.round(response.ms * 1000) / 1000,
      responseClass,
      sourceRuntime: 'async-snapshot-fetch'
    };
    await appendFile(detailsPath, `${JSON.stringify(record)}\n`);
    summary.detailsFetched += 1;
  } catch (error) {
    summary.failures += 1;
    await appendFile(failuresPath, `${JSON.stringify({
      at: new Date().toISOString(),
      workerId,
      type: 'detail-fetch-failed',
      branchKey: row.branchKey,
      page: row.page,
      ctl: row.ctl,
      expectedRef: row.expectedRef || '',
      error: error.message
    })}\n`);
    if (stopOnBlocked) throw error;
  }
}

const rowGroups = groupRowsBySnapshot(rows);
summary.snapshotGroups = rowGroups.length;
await runConcurrent(rowGroups, concurrency, async (group, workerId) => {
  for (const row of group) {
    await fetchRow(row, workerId);
  }
});

summary.finishedAt = new Date().toISOString();
summary.elapsedSeconds = (Date.parse(summary.finishedAt) - Date.parse(summary.startedAt)) / 1000;
summary.recordsPerSecond = summary.elapsedSeconds > 0
  ? Math.round((summary.detailsFetched / summary.elapsedSeconds) * 1000) / 1000
  : 0;
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`PRONI_ASYNC_FETCH_SUMMARY ${summaryPath}`);
