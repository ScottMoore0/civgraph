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
const INTAKE_PATH = resolve(ROOT, 'render/metadata/vector-intake-report.json');
const CACHE_ROOT = resolve(ROOT, 'render/source-cache/vector-intake');
const MANIFEST_PATH = resolve(CACHE_ROOT, 'manifest.json');
const REPORT_PATH = resolve(ROOT, 'render/metadata/vector-source-download-report.json');
const VECTOR_EXTENSIONS = new Set(['.fgb', '.geojson', '.json', '.gpkg', '.shp', '.zip']);
const LIMIT = readNumberArg('--limit', Infinity);
const ONLY_IDS = new Set(readStringArg('--ids', '').split(',').map((value) => value.trim()).filter(Boolean));
const CONCURRENCY = Math.max(1, Math.min(8, readNumberArg('--concurrency', 4)));

/** @typedef {{ file?: string }} SourceFile */
/** @typedef {{ action?: string, sourceMapId: string, name?: string, category?: string, sourceFiles?: SourceFile[] }} IntakeItem */
/** @typedef {{ item: IntakeItem, sources: SourceFile[] }} Entry */
/** @typedef {{ sourceMapId: string, localPath?: string, [field: string]: unknown }} CachedSource */
/** @type {{ items?: IntakeItem[] }} */
const intake = JSON.parse(readFileSync(INTAKE_PATH, 'utf8'));
/** @type {{ sources?: CachedSource[] }} */
const existingManifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : { sources: [] };
const existingById = new Map((existingManifest.sources || []).map((source) => [source.sourceMapId, source]));
const items = (intake.items || [])
  .filter((item) => item.action === 'download-remote-source')
  .filter((item) => !ONLY_IDS.size || ONLY_IDS.has(item.sourceMapId))
  .map((item) => ({ item, sources: chooseRemoteSources(item) }))
  .filter((entry) => entry.sources.length)
  .slice(0, LIMIT);

mkdirSync(CACHE_ROOT, { recursive: true });

/** @type {CachedSource[]} */
const downloaded = [];
/** @type {CachedSource[]} */
const skipped = [];
/** @type {Array<{ sourceMapId: string, name: string | undefined, url: string, error: string }>} */
const failed = [];
let cursor = 0;

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
  while (cursor < items.length) {
    const index = cursor;
    cursor += 1;
    await processEntry(/** @type {Entry} */ (items[index]));
  }
}));

const manifestSources = mergeSources(existingManifest.sources || [], [...downloaded, ...skipped].filter((row) => row.localPath));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cacheRoot: 'render/source-cache/vector-intake',
  sources: manifestSources
};
writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  intake: 'render/metadata/vector-intake-report.json',
  cacheManifest: 'render/source-cache/vector-intake/manifest.json',
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

/** @param {Entry} entry */
async function processEntry(entry) {
  const { item, sources } = entry;
  const firstSource = /** @type {SourceFile} */ (sources[0]);
  const extension = cleanExtension(firstSource.file) || '.fgb';
  const localPath = `render/source-cache/vector-intake/${slugify(item.sourceMapId)}${extension}`;
  const absolutePath = resolve(ROOT, localPath);
  const existing = existingById.get(item.sourceMapId);
  if (existsSync(absolutePath) && statSync(absolutePath).size > 0) {
    skipped.push({
      sourceMapId: item.sourceMapId,
      name: item.name,
      url: firstSource.file,
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
  /** @type {string[]} */
  const errors = [];
  for (const source of sources) {
    try {
      const response = await fetch(/** @type {string} */ (source.file), { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      mkdirSync(dirname(absolutePath), { recursive: true });
      const tempPath = `${absolutePath}.tmp`;
      if (existsSync(tempPath)) unlinkSync(tempPath);
      await pipeline(Readable.fromWeb(/** @type {import('node:stream/web').ReadableStream} */ (response.body)), createWriteStream(tempPath));
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
      return;
    } catch (error) {
      errors.push(`${source.file}: ${/** @type {Error} */ (error).message}`);
    }
  }
  failed.push({
    sourceMapId: item.sourceMapId,
    name: item.name,
    url: sources.map((source) => source.file).join(' | '),
    error: errors.join('; ')
  });
}

/** @param {IntakeItem} item */
function chooseRemoteSources(item) {
  return uniqueSources((item.sourceFiles || [])
    .filter((source) => /^https?:\/\//i.test(source.file || '') && VECTOR_EXTENSIONS.has(cleanExtension(source.file))));
}

/** @param {string | undefined} file */
function cleanExtension(file) {
  const path = /** @type {string} */ (String(file || '').split('?')[0]).toLowerCase();
  return extname(path);
}

/** @param {CachedSource[]} existing @param {CachedSource[]} next */
function mergeSources(existing, next) {
  /** @type {Map<string, CachedSource>} */
  const merged = new Map();
  for (const source of existing) merged.set(source.sourceMapId, source);
  for (const source of next) merged.set(source.sourceMapId, source);
  return [...merged.values()].sort((a, b) => String(a.sourceMapId).localeCompare(String(b.sourceMapId)));
}

/** @param {string} name @param {number} fallback */
function readNumberArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** @param {string} name @param {string} fallback */
function readStringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

/** @param {string} value */
function slugify(value) {
  return String(value || 'layer').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** @param {SourceFile[]} sources */
function uniqueSources(sources) {
  /** @type {Map<string, SourceFile>} */
  const byFile = new Map();
  for (const source of sources) {
    const file = source.file || '';
    if (!file || byFile.has(file)) continue;
    byFile.set(file, source);
  }
  return [...byFile.values()];
}

/** @param {string} path */
function relativeReport(path) {
  return path.replace(`${ROOT}\\`, '').replace(`${ROOT}/`, '');
}
