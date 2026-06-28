#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_DOCS = path.join(ROOT, 'data', 'database', 'raw-source-documents.json');
const MIRRORS = path.join(ROOT, 'data', 'database', 'raw-source-ia-mirrors.json');

main();

function main() {
  if (!existsSync(MIRRORS)) {
    throw new Error(`Missing IA mirror sidecar: ${path.relative(ROOT, MIRRORS)}`);
  }
  const sourceDocs = sanitizeSourceDocs(readJson(SOURCE_DOCS));
  const mirrors = readJson(MIRRORS);
  assertNoLocalPaths(mirrors, 'raw-source IA mirror sidecar');

  const mirrorsBySource = new Map((mirrors.sources || []).map((source) => [source.sourceId, source]));
  const sources = (sourceDocs.sources || []).map((source) => applyMirror(source, mirrorsBySource.get(source.id)));
  const output = {
    ...sourceDocs,
    generatedAt: new Date().toISOString(),
    policy: {
      ...sourceDocs.policy,
      internetArchive: 'records with verified IA mirror files expose Internet Archive item/download URLs; provider dataset pages remain canonical'
    },
    summary: {
      ...sourceDocs.summary,
      withIaMirrorUrl: sources.filter((source) => source.viewport?.internetArchiveUrl).length,
      iaMirrorUrlsPending: sources.filter((source) => !source.viewport?.internetArchiveUrl).length,
      withVerifiedIaFiles: sources.filter((source) => source.iaMirror?.mirrorStatus === 'mirrored').length
    },
    sources
  };

  assertNoLocalPaths(output, 'raw-source documents output');
  mkdirSync(path.dirname(SOURCE_DOCS), { recursive: true });
  writeFileSync(SOURCE_DOCS, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Applied IA mirror metadata to ${output.summary.withIaMirrorUrl} raw source-document records.`);
}

function applyMirror(source, mirror) {
  if (!mirror || mirror.mirrorStatus !== 'mirrored' || !mirror.files?.length) return source;
  const iaReference = {
    label: `${source.title} Internet Archive source mirror`,
    url: mirror.itemUrl,
    source: 'Internet Archive',
    role: 'source-mirror',
    status: 'verified'
  };
  const iaDownloads = mirror.files.map((file) => ({
    label: `Internet Archive mirror - ${file.fileName}`,
    url: file.downloadUrl,
    type: file.format || 'source-file',
    size: file.size || null,
    sha256: file.sha256 || null,
    status: 'verified Internet Archive mirror',
    source: 'Internet Archive',
    storageMode: file.storageMode === 'raw-bytes' ? 'raw-bytes' : null,
    note: file.storageNote || null
  }));
  const firstPreview = mirror.files.find((file) => isPreviewable(file)) || mirror.files[0];
  return {
    ...source,
    references: uniqueByUrl([...(source.references || []), iaReference]),
    downloads: uniqueByUrl([...(source.downloads || []), ...iaDownloads]),
    statusChips: unique([...(source.statusChips || []), 'Mirror available']),
    viewport: {
      ...(source.viewport || {}),
      status: isPreviewable(firstPreview) ? 'mirror-preview-ready' : 'mirror-download-ready',
      internetArchiveUrl: mirror.itemUrl,
      fileUrl: firstPreview.downloadUrl,
      note: 'Internet Archive mirror files are verified for durable public view/download; provider dataset page remains the canonical source.'
    },
    sourceItems: (source.sourceItems || []).map((item) => ({
      ...item,
      mirrorPolicy: 'Internet Archive mirror verified; local mirror paths remain excluded from public output',
      internetArchiveItem: mirror.itemIdentifier,
      internetArchiveUrl: mirror.itemUrl,
      internetArchiveFileCount: mirror.files.length
    })),
    iaMirror: {
      itemIdentifier: mirror.itemIdentifier,
      itemUrl: mirror.itemUrl,
      mirrorStatus: mirror.mirrorStatus,
      verifiedAt: mirror.verifiedAt,
      fileCount: mirror.files.length
    },
    publicationStatus: appendStatus(source.publicationStatus, 'raw-source-mirrored-internet-archive'),
    keywords: unique([...(source.keywords || []), 'internet-archive-mirror', 'raw-source-mirrored'])
  };
}

function isPreviewable(file) {
  if (file.storageMode === 'raw-bytes' || /\.dat$/i.test(file.fileName || '')) return false;
  const text = `${file.fileName || ''} ${file.format || ''}`.toLowerCase();
  return /\.(pdf|csv|txt|png|jpg|jpeg|json|xlsx|xls|ods|px)\b/.test(text) || /\b(pdf|csv|txt|json|xlsx|xls|ods|px)\b/.test(text);
}

function appendStatus(value, addition) {
  return unique(String(value || '').split(';').map((part) => part.trim()).filter(Boolean).concat(addition)).join('; ');
}

function uniqueByUrl(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.url) continue;
    const key = item.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(compactObject(item));
  }
  return out;
}

function unique(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const clean = typeof value === 'string' ? value.trim() : value;
    if (!clean) continue;
    const key = String(clean).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item == null) continue;
    if (Array.isArray(item) && !item.length) continue;
    if (typeof item === 'string' && !item.trim()) continue;
    out[key] = item;
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sanitizeSourceDocs(sourceDocs) {
  const sanitized = sanitizePublicText(sourceDocs);
  if (sanitized.sourceReviewCsv) {
    delete sanitized.sourceReviewCsv;
    sanitized.sourceReview = sanitized.sourceReview || 'internal source review corpus';
  }
  return sanitized;
}

function sanitizePublicText(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicText);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/Civgraph raw source-document staging record generated from D:\s*drive audit\./gi, 'Civgraph raw source-document record.')
      .replace(/local D:\s*mirror paths?/gi, 'local operational mirror paths')
      .replace(/D:\s*drive audit/gi, 'internal source review')
      .replace(/tasks\/d-drive-content-blocker-review-2026-06-24\.csv/gi, 'internal source review corpus');
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizePublicText(item)]));
}

function assertNoLocalPaths(value, label) {
  const text = JSON.stringify(value);
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) {
    throw new Error(`${label} leaks a local filesystem path`);
  }
  if (/D:\s*drive|d-drive-content-blocker|local D:/i.test(text)) {
    throw new Error(`${label} leaks local source-review wording`);
  }
}
