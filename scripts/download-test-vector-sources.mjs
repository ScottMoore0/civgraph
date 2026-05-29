#!/usr/bin/env node
/**
 * Download remote vector sources from the /test intake queue into a repo-local
 * cache. This does not mutate source metadata or delete existing source files.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(process.cwd());
const INTAKE_PATH = resolve(ROOT, 'test/metadata/vector-intake-report.json');
const CACHE_ROOT = resolve(ROOT, 'test/source-cache/vector-intake');
const MANIFEST_PATH = resolve(CACHE_ROOT, 'manifest.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/vector-source-download-report.json');
const VECTOR_EXTENSIONS = new Set(['.fgb', '.geojson', '.json', '.gpkg', '.shp', '.zip']);
const LIMIT = readNumberArg('--limit', Infinity);
const ONLY_IDS = new Set(readStringArg('--ids', '').split(',').map((value) => value.trim()).filter(Boolean));
const CONCURRENCY = Math.max(1, Math.min(8, readNumberArg('--concurrency', 4)));

const intake = JSON.parse(readFileSync(INTAKE_PATH, 'utf8'));
const existingManifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : { sources: [] };
const existingById = new Map((existingManifest.sources || []).map((source) => [source.sourceMapId, source]));
const items = (intake.items || [])
  .filter((item) => item.action === 'download-remote-source')
  .filter((item) => !ONLY_IDS.size || ONLY_IDS.has(item.sourceMapId))
  .map((item) => ({ item, source: chooseRemoteSource(item) }))
  .filter((entry) => entry.source)
  .slice(0, LIMIT);

mkdirSync(CACHE_ROOT, { recursive: true });

const downloaded = [];
const skipped = [];
const failed = [];
let cursor = 0;

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
  while (cursor < items.length) {
    const index = cursor;
    cursor += 1;
    await processEntry(items[index], index);
  }
}));

const manifestSources = mergeSources(existingManifest.sources || [], [...downloaded, ...skipped].filter((row) => row.localPath));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cacheRoot: 'test/source-cache/vector-intake',
  sources: manifestSources
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  intake: 'test/metadata/vector-intake-report.json',
  cacheManifest: 'test/source-cache/vector-intake/manifest.json',
  totals: {
    selected: items.length,
    downloaded: downloaded.length,
    skipped: skipped.length,
    failed: failed.length,
    cachedSources: manifestSources.length
  },
  downloaded,
  skipped,
  failed
};
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Downloaded: ${downloaded.length}`);
console.log(`Skipped existing: ${skipped.length}`);
console.log(`Failed: ${failed.length}`);
console.log(`Cached sources: ${manifestSources.length}`);
console.log(`Wrote ${relativeReport(REPORT_PATH)}`);
if (failed.length) process.exit(1);

async function processEntry(entry) {
  const { item, source } = entry;
  const extension = cleanExtension(source.file) || '.fgb';
  const localPath = `test/source-cache/vector-intake/${slugify(item.sourceMapId)}${extension}`;
  const absolutePath = resolve(ROOT, localPath);
  const existing = existingById.get(item.sourceMapId);
  if (existsSync(absolutePath) && statSync(absolutePath).size > 0) {
    skipped.push({
      sourceMapId: item.sourceMapId,
      name: item.name,
      url: source.file,
      localPath,
      bytes: statSync(absolutePath).size,
      reason: 'already cached'
    });
    return;
  }
  if (existing?.localPath && existsSync(resolve(ROOT, existing.localPath))) {
    skipped.push({ ...existing, reason: 'already cached in manifest' });
    return;
  }
  try {
    const response = await fetch(source.file, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    mkdirSync(dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.tmp`;
    if (existsSync(tempPath)) unlinkSync(tempPath);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
    renameSync(tempPath, absolutePath);
    downloaded.push({
      sourceMapId: item.sourceMapId,
      name: item.name,
      category: item.category,
      url: source.file,
      localPath,
      bytes: statSync(absolutePath).size,
      contentType: response.headers.get('content-type') || null
    });
  } catch (error) {
    failed.push({
      sourceMapId: item.sourceMapId,
      name: item.name,
      url: source.file,
      error: error.message
    });
  }
}

function chooseRemoteSource(item) {
  return (item.sourceFiles || []).find((source) => /^https?:\/\//i.test(source.file || '') && VECTOR_EXTENSIONS.has(cleanExtension(source.file)));
}

function cleanExtension(file) {
  const path = String(file || '').split('?')[0].toLowerCase();
  return extname(path);
}

function mergeSources(existing, next) {
  const merged = new Map();
  for (const source of existing) merged.set(source.sourceMapId, source);
  for (const source of next) merged.set(source.sourceMapId, source);
  return [...merged.values()].sort((a, b) => String(a.sourceMapId).localeCompare(String(b.sourceMapId)));
}

function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function relativeReport(path) {
  return path.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '');
}
