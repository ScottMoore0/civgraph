#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SIDE_CAR = path.join(ROOT, 'data', 'database', 'raw-source-documents.json');
const BROWSE_SOURCES = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARD_DIR = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');

main();

function main() {
  const sidecar = readJson(SIDE_CAR);
  assert(sidecar.schemaVersion === 1, 'raw-source-documents must use schemaVersion 1');
  assert(!containsLocalPath(sidecar), 'raw-source-documents sidecar leaks a local filesystem path');
  const sources = normalizeArray(sidecar.sources);
  assert(sources.length === 252, `expected 252 raw source-document records, found ${sources.length}`);

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
  }

  const browse = readJson(BROWSE_SOURCES);
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
    verifiedDetails += 1;
  }

  console.log(`Raw source-document validation passed: ${sources.length} records, ${verifiedDetails} Browse details verified, no local paths exposed.`);
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
  return /[A-Z]:\\|\\\\|\/Users\/scomo/i.test(JSON.stringify(value));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
