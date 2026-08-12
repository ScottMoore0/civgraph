#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBrowseSourceItems } from './lib/browse-source-index.mjs';

const ROOT = process.cwd();
const SIDE_CAR = path.join(ROOT, 'data', 'database', 'raw-source-documents.json');
const IA_MIRRORS = path.join(ROOT, 'data', 'database', 'raw-source-ia-mirrors.json');
const BROWSE_SOURCES = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARD_DIR = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');

main();

function main() {
  // data/browse is build output and is no longer tracked (2026-08-12): production
  // serves it from R2 via functions/data/browse/[[path]].js. A clean checkout has
  // none of it until `npm run build` runs, so bail out with an instruction rather
  // than an unexplained ENOENT half way through the run.
  if (!existsSync(BROWSE_SOURCES)) {
    console.log('SKIP: data/browse/sources.json is absent.');
    console.log('  Browse data is build output, not tracked in git. Generate it first:  npm run build:browse');
    return;
  }

  const sidecar = readJson(SIDE_CAR);
  assert(sidecar.schemaVersion === 1, 'raw-source-documents must use schemaVersion 1');
  assert(!containsLocalPath(sidecar), 'raw-source-documents sidecar leaks a local filesystem path');
  const sources = normalizeArray(sidecar.sources);
  assert(sources.length === 252, `expected 252 raw source-document records, found ${sources.length}`);
  const iaMirrors = existsSync(IA_MIRRORS) ? readJson(IA_MIRRORS) : null;
  const mirroredSourceIds = validateIaMirrors(iaMirrors, new Set(sources.map((source) => source.id)));

  const ids = new Set();
  for (const source of sources) {
    assert(source.id?.startsWith('raw-source:'), `raw source has invalid id: ${source.id}`);
    assert(!ids.has(source.id), `duplicate raw source id: ${source.id}`);
    ids.add(source.id);
    assert(/^raw-source-(table|document|source)$/.test(source.type), `raw source ${source.id} has invalid type ${source.type}`);
    assert(source.title, `raw source ${source.id} needs title`);
    assert(source.category, `raw source ${source.id} needs category`);
    assert(normalizeArray(source.provider).length > 0, `raw source ${source.id} needs provider`);
    assert(source.status === 'Source only', `raw source ${source.id} must have Source only status`);
    assert(normalizeArray(source.statusChips).includes('Source only'), `raw source ${source.id} needs Source only status chip`);
    assert(source.viewport?.status, `raw source ${source.id} needs viewport policy metadata`);
    assert(source.shortCitation && source.fullCitation, `raw source ${source.id} needs citation text`);
    assert(normalizeArray(source.sourceItems).length === 1, `raw source ${source.id} should preserve one source item`);
    assert(!source.sourceItems[0].dPath, `raw source ${source.id} must not expose dPath`);
    assert(!containsLocalPath(source), `raw source ${source.id} leaks a local filesystem path`);
    if (mirroredSourceIds.has(source.id)) {
      assert(source.viewport?.internetArchiveUrl, `mirrored raw source ${source.id} is missing viewport.internetArchiveUrl`);
      assert(normalizeArray(source.statusChips).includes('Mirror available'), `mirrored raw source ${source.id} needs Mirror available status chip`);
      assert(normalizeArray(source.downloads).some((download) => /archive\.org\/download\//.test(download.url || '')), `mirrored raw source ${source.id} needs IA download URLs`);
    }
  }

  const browse = readJson(BROWSE_SOURCES);
  browse.items = resolveBrowseSourceItems(browse, ROOT);
  assert(Array.isArray(browse.items), 'data/browse/sources.json must contain items');
  const browseById = new Map(browse.items.map((item) => [item.id, item]));
  const shardCache = new Map();
  let verifiedDetails = 0;
  for (const source of sources) {
    const indexItem = browseById.get(source.id);
    assert(indexItem, `missing Browse source index item for ${source.id}`);
    assert(indexItem.status === 'Source only', `Browse source ${source.id} lost Source only status`);
    assert(normalizeArray(indexItem.statusChips).includes('Source only'), `Browse source ${source.id} lost status chips`);
    assert(indexItem.viewport?.status, `Browse source ${source.id} lost viewport summary`);
    assert(indexItem.shortCitation, `Browse source ${source.id} lost short citation`);
    assert(indexItem.detailUrl, `Browse source ${source.id} has no detailUrl`);
    const detail = readDetail(indexItem.detailUrl, shardCache, source.id);
    assert(detail, `detail shard does not contain ${source.id}`);
    assert(detail.fullCitation, `detail ${source.id} lost full citation`);
    assert(detail.viewport?.status, `detail ${source.id} lost viewport metadata`);
    assert(normalizeArray(detail.sourceItems).length === 1, `detail ${source.id} lost source item`);
    assert(!containsLocalPath(detail), `detail ${source.id} leaks a local filesystem path`);
    if (mirroredSourceIds.has(source.id)) {
      assert(detail.viewport?.internetArchiveUrl, `mirrored detail ${source.id} is missing viewport.internetArchiveUrl`);
      assert(normalizeArray(detail.statusChips).includes('Mirror available'), `mirrored detail ${source.id} needs Mirror available status chip`);
      assert(normalizeArray(detail.downloads).some((download) => /archive\.org\/download\//.test(download.url || '')), `mirrored detail ${source.id} needs IA download URLs`);
    }
    verifiedDetails += 1;
  }

  console.log(`Raw source-document validation passed: ${sources.length} records, ${verifiedDetails} Browse details verified, ${mirroredSourceIds.size} IA-mirrored records, no local paths exposed.`);
}

function validateIaMirrors(iaMirrors, sourceIds) {
  if (!iaMirrors) return new Set();
  assert(iaMirrors.schemaVersion === 1, 'raw-source IA mirrors must use schemaVersion 1');
  assert(!containsLocalPath(iaMirrors), 'raw-source IA mirror sidecar leaks a local filesystem path');
  const mirrored = new Set();
  for (const source of normalizeArray(iaMirrors.sources)) {
    assert(sourceIds.has(source.sourceId), `IA mirror sidecar references unknown raw source ${source.sourceId}`);
    if (source.mirrorStatus !== 'mirrored') continue;
    assert(source.itemUrl && /archive\.org\/details\//.test(source.itemUrl), `mirrored raw source ${source.sourceId} needs archive.org item URL`);
    assert(normalizeArray(source.files).length > 0, `mirrored raw source ${source.sourceId} needs mirrored files`);
    for (const file of normalizeArray(source.files)) {
      assert(file.downloadUrl && /archive\.org\/download\//.test(file.downloadUrl), `mirrored raw source ${source.sourceId} file needs archive.org download URL`);
      assert(file.verifiedAt, `mirrored raw source ${source.sourceId} file needs verifiedAt`);
      assert(!containsLocalPath(file), `mirrored raw source ${source.sourceId} file leaks a local filesystem path`);
    }
    mirrored.add(source.sourceId);
  }
  return mirrored;
}

function readDetail(detailUrl, cache, id) {
  const shardName = detailUrl.split('/').pop();
  assert(shardName, `invalid detail URL for ${id}: ${detailUrl}`);
  if (!cache.has(shardName)) {
    cache.set(shardName, readJson(path.join(SOURCE_SHARD_DIR, shardName)));
  }
  return normalizeArray(cache.get(shardName).items).find((item) => item.id === id);
}

function readJson(filePath) {
  assert(existsSync(filePath), `missing required file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function containsLocalPath(value) {
  const text = JSON.stringify(value);
  return /[A-Z]:\\|\\\\|\/Users\/scomo|D:\s*drive|d-drive-content-blocker|local D:/i.test(text);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
