#!/usr/bin/env node
/*
 * Probe whether PRONI exposes a direct record-detail endpoint.
 *
 * This does not use search boxes. It starts from a Browse index row generated
 * by scripts/proni-browse-corpus-crawler.ps1, confirms that row through the
 * normal Browse postback path, then tests plausible direct URLs and links
 * discovered in the confirmed detail page.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function isBlocked(status, content) {
  if (status !== 200) return true;
  return /Request Rejected|support ID|Access Denied|Too Many Requests|rate limit|throttl/i.test(content);
}

function extractTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
}

function extractDetailReference(html) {
  const row = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .find((tr) => /PRONI\s+Reference/i.test(stripHtml(tr)));
  if (!row) return '';
  const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => stripHtml(cell[1])).filter(Boolean);
  return cells.length >= 2 ? cells.slice(1).join(' ').trim() : '';
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

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,en-GB;q=0.8',
      ...headers
    }
  });
  const content = await response.text();
  return { status: response.status, ok: response.ok && !isBlocked(response.status, content), content };
}

async function postBrowseDetail(row, snapshotHtml, metadata) {
  const form = parseInputs(snapshotHtml);
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
  const response = await fetch(`${BASE}BrowseSearchResults.aspx`, { method: 'POST', body: params, headers });
  const content = await response.text();
  return { status: response.status, ok: response.ok && !isBlocked(response.status, content), content };
}

function buildCandidateUrls(reference, detailHtml) {
  const encoded = encodeURIComponent(reference);
  const compact = encodeURIComponent(reference.replace(/\//g, '_'));
  const urls = new Set([
    `${BASE}RecordDetails.aspx?ref=${encoded}`,
    `${BASE}RecordDetail.aspx?ref=${encoded}`,
    `${BASE}Details.aspx?ref=${encoded}`,
    `${BASE}Detail.aspx?ref=${encoded}`,
    `${BASE}BrowseDetails.aspx?ref=${encoded}`,
    `${BASE}BrowseSearchResults.aspx?ref=${encoded}`,
    `${BASE}BrowseSearchResults.aspx?Reference=${encoded}`,
    `${BASE}BrowseSearchResults.aspx?PRONIReference=${encoded}`,
    `${BASE}SearchResultDetails.aspx?ref=${encoded}`,
    `${BASE}RecordDetails.aspx?id=${compact}`,
    `${BASE}Details.aspx?id=${compact}`
  ]);

  for (const match of detailHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = decodeHtml(match[1]);
    if (!/detail|record|searchresult|browse/i.test(href)) continue;
    try {
      urls.add(new URL(href, BASE).href);
    } catch {
      // Ignore malformed links in legacy markup.
    }
  }
  return [...urls];
}

const indexPath = getArg('index');
const outDir = path.resolve(getArg('out-dir', 'tmp/proni-direct-endpoint-probe'));
const rowNumber = getNumberArg('row', 0);
if (!indexPath) {
  console.error('Usage: node scripts/proni-direct-endpoint-probe.mjs --index records-index.jsonl --out-dir D:\\PRONI\\... [--row 0]');
  process.exit(2);
}

await mkdir(outDir, { recursive: true });
const rows = (await readJsonl(indexPath)).filter((row) => row.pageSnapshotPath && row.resultsViewName);
const row = rows[rowNumber];
if (!row) throw new Error(`No probeable row ${rowNumber} in ${indexPath}`);
const snapshotHtml = await readFile(path.resolve(row.pageSnapshotPath), 'utf8');
const metadata = await readJsonIfExists(row.pageSnapshotMetadataPath);
const browseDetail = await postBrowseDetail(row, snapshotHtml, metadata);
const confirmedReference = browseDetail.ok ? extractDetailReference(browseDetail.content) : '';
const reference = confirmedReference || row.expectedRef || '';
const candidates = buildCandidateUrls(reference, browseDetail.content || snapshotHtml);
const results = [];

for (const url of candidates) {
  const direct = await fetchText(url, metadata?.cookieHeader ? { cookie: metadata.cookieHeader } : {});
  const title = extractTitle(direct.content);
  const extractedReference = extractDetailReference(direct.content);
  const text = stripHtml(direct.content).slice(0, 500);
  results.push({
    url,
    status: direct.status,
    ok: direct.ok,
    title,
    bytes: direct.content.length,
    extractedReference,
    containsReference: Boolean(reference && direct.content.includes(reference)),
    looksDetail: /PRONI\s+Reference/i.test(direct.content) && /Repository|Description|Dates/i.test(direct.content),
    blocked: isBlocked(direct.status, direct.content),
    sample: text
  });
}

const usableDirectEndpoint = results.find((item) =>
  item.ok &&
  item.looksDetail &&
  reference &&
  (item.extractedReference === reference || item.containsReference)
) || null;

const report = {
  generatedAt: new Date().toISOString(),
  indexPath: path.resolve(indexPath),
  rowNumber,
  expectedRef: row.expectedRef || '',
  confirmedReference,
  browsePostback: {
    ok: browseDetail.ok,
    status: browseDetail.status,
    bytes: browseDetail.content.length,
    title: extractTitle(browseDetail.content)
  },
  candidateCount: candidates.length,
  usableDirectEndpoint: usableDirectEndpoint ? usableDirectEndpoint.url : '',
  results
};

const jsonPath = path.join(outDir, 'direct-endpoint-probe.json');
const csvPath = path.join(outDir, 'direct-endpoint-probe-candidates.csv');
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(csvPath, [
  'url,status,ok,looksDetail,containsReference,extractedReference,title,bytes,blocked',
  ...results.map((item) => [
    item.url,
    item.status,
    item.ok,
    item.looksDetail,
    item.containsReference,
    item.extractedReference,
    item.title,
    item.bytes,
    item.blocked
  ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
].join('\n') + '\n');

console.log(`PRONI_DIRECT_ENDPOINT_PROBE ${jsonPath}`);
if (usableDirectEndpoint) {
  console.log(`PRONI_DIRECT_ENDPOINT_FOUND ${usableDirectEndpoint.url}`);
} else {
  console.log('PRONI_DIRECT_ENDPOINT_FOUND none');
}
