#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SIDE_CAR = path.join(ROOT, 'data', 'database', 'medium-priority-publication-sources.json');
const BROWSE_SOURCES = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARD_DIR = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');
const EXPECTED_TOTAL = 2346;
const EXPECTED_READY = 1121;
const EXPECTED_REVIEW = 1225;
const EXPECTED_GROUPS = new Map([
  ['Irish election source/enrichment data', 176],
  ['Authoritative boundary variants from Tailte/OSI/Open Data NI/NISRA', 270],
  ['Open Data NI boundary and statistical-geography files', 93],
  ['Local authority planning/property/open-data layers', 1637],
  ['Transport, roads, infrastructure, public assets', 170]
]);

main();

function main() {
  const sidecar = readJson(SIDE_CAR);
  assert(sidecar.schemaVersion === 1, 'medium-priority sidecar must use schemaVersion 1');
  assert(!containsLocalPath(sidecar), 'medium-priority sidecar leaks a local filesystem path');

  const sources = normalizeArray(sidecar.sources);
  assert(sources.length === EXPECTED_TOTAL, `expected ${EXPECTED_TOTAL} medium-priority source records, found ${sources.length}`);
  assert(sidecar.summary?.byPublicationStatus?.['approved-source-record'] === EXPECTED_READY, `expected ${EXPECTED_READY} approved source records`);
  assert(sidecar.summary?.byPublicationStatus?.['source-record-with-runtime-review'] === EXPECTED_REVIEW, `expected ${EXPECTED_REVIEW} runtime-review source records`);

  const ids = new Set();
  const groupCounts = new Map();
  for (const source of sources) {
    assert(source.id?.startsWith('medium-priority:'), `invalid medium-priority source id: ${source.id}`);
    assert(!ids.has(source.id), `duplicate medium-priority source id: ${source.id}`);
    ids.add(source.id);
    assert(source.type === 'approved-medium-priority-source', `invalid medium-priority type for ${source.id}: ${source.type}`);
    assert(source.title, `medium-priority source ${source.id} needs title`);
    assert(source.category?.startsWith('Medium-priority:'), `medium-priority source ${source.id} has wrong category: ${source.category}`);
    assert(normalizeArray(source.provider).length > 0, `medium-priority source ${source.id} needs provider`);
    assert(normalizeArray(source.statusChips).includes('Source record'), `medium-priority source ${source.id} needs Source record status chip`);
    assert(source.viewport?.status, `medium-priority source ${source.id} needs viewport metadata`);
    assert(source.shortCitation && source.fullCitation, `medium-priority source ${source.id} needs citation text`);
    assert(normalizeArray(source.sourceItems).length === 1, `medium-priority source ${source.id} should preserve one source item`);
    assert(source.approval?.recommendedAction, `medium-priority source ${source.id} lost approval action`);
    assert(!containsLocalPath(source), `medium-priority source ${source.id} leaks a local filesystem path`);

    const group = source.sourceItems[0]?.groupTitle || 'Unknown';
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
    if (source.publicationStatus === 'approved-source-record') {
      assert(!normalizeArray(source.approval?.residualBlockers).length, `approved source ${source.id} still has residual blockers`);
      assert(normalizeArray(source.statusChips).includes('Approved'), `approved source ${source.id} lost Approved status chip`);
    } else {
      assert(normalizeArray(source.statusChips).includes('Runtime review pending'), `review source ${source.id} lost Runtime review pending status chip`);
    }
  }

  for (const [group, expected] of EXPECTED_GROUPS.entries()) {
    assert(groupCounts.get(group) === expected, `expected ${expected} rows for ${group}, found ${groupCounts.get(group) || 0}`);
  }

  const browse = readJson(BROWSE_SOURCES);
  assert(Array.isArray(browse.items), 'data/browse/sources.json must contain items');
  const browseById = new Map(browse.items.map((item) => [item.id, item]));
  const shardCache = new Map();
  let verifiedDetails = 0;
  for (const source of sources) {
    const indexItem = browseById.get(source.id);
    assert(indexItem, `missing Browse source index item for ${source.id}`);
    assert(indexItem?.publicationStatus === source.publicationStatus, `Browse source ${source.id} lost publication status`);
    assert(indexItem?.approval?.recommendedAction === source.approval.recommendedAction, `Browse source ${source.id} lost approval metadata`);
    assert(indexItem?.detailUrl, `Browse source ${source.id} has no detailUrl`);
    const detail = readDetail(indexItem.detailUrl, shardCache, source.id);
    assert(detail, `detail shard does not contain ${source.id}`);
    assert(detail?.fullCitation, `detail ${source.id} lost full citation`);
    assert(detail?.viewport?.status, `detail ${source.id} lost viewport metadata`);
    const detailSourceItems = normalizeArray(detail?.sourceItems);
    assert(detailSourceItems.length >= 1, `detail ${source.id} lost source item`);
    assert(
      detailSourceItems.some((item) => item.stagingId === source.approval.stagingId || item.auditRowNumber === source.sourceItems?.[0]?.auditRowNumber || item.title === source.title),
      `detail ${source.id} lost its medium-priority source item`
    );
    assert(detail?.approval?.recommendedAction === source.approval.recommendedAction, `detail ${source.id} lost approval action`);
    assert(!containsLocalPath(detail), `detail ${source.id} leaks a local filesystem path`);
    verifiedDetails += 1;
  }

  console.log(`Medium-priority publication validation passed: ${sources.length} records, ${verifiedDetails} Browse details verified, no local paths exposed.`);
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
  return /[A-Z]:\\|\\\\|\/Users\/scomo|C:\/Users\/scomo|D:\//i.test(JSON.stringify(value));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
