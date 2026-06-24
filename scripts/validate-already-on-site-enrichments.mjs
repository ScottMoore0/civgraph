#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENRICHMENTS_PATH = path.join(ROOT, 'data', 'database', 'already-on-site-enrichments.json');
const BROWSE_SOURCES_PATH = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARD_DIR = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');

main();

function main() {
  const enrichments = readJson(ENRICHMENTS_PATH);
  assert(enrichments.schemaVersion === 1, 'already-on-site enrichments must use schemaVersion 1');
  assert(!containsLocalPath(enrichments), 'already-on-site enrichments must not expose local filesystem paths');

  const targets = normalizeArray(enrichments.targets);
  const reviewRows = normalizeArray(enrichments.reviewRows);
  const appliedSourceItemCount = targets.reduce((sum, target) => sum + normalizeArray(target.sourceItems).length, 0);
  assert(targets.length > 0, 'expected at least one applied enrichment target');
  assert(appliedSourceItemCount === 91, `expected 91 safe/high-confidence applied source rows, found ${appliedSourceItemCount}`);
  assert(reviewRows.length === 1022, `expected 1022 review-only rows, found ${reviewRows.length}`);

  for (const target of targets) {
    assert(target.sourceTargetId, 'each enrichment target needs sourceTargetId');
    assert(target.targetTitle, `target ${target.sourceTargetId} needs targetTitle`);
    assert(normalizeArray(target.sourceItems).length > 0, `target ${target.sourceTargetId} needs sourceItems`);
    for (const sourceItem of normalizeArray(target.sourceItems)) {
      assert(sourceItem.auditRowNumber, `target ${target.sourceTargetId} has a source item without auditRowNumber`);
      assert(sourceItem.title, `target ${target.sourceTargetId} has a source item without title`);
      assert(!containsLocalPath(sourceItem), `target ${target.sourceTargetId} source item leaks a local path`);
    }
  }

  const sourcesIndex = readJson(BROWSE_SOURCES_PATH);
  assert(Array.isArray(sourcesIndex.items), 'data/browse/sources.json must contain items');
  const indexById = new Map(sourcesIndex.items.map((item) => [item.id, item]));
  const shardCache = new Map();
  let verified = 0;
  for (const target of targets) {
    const sourceIndexItem = indexById.get(target.sourceTargetId) || indexById.get(`already-on-site-enrichment:${slugify(target.sourceTargetId)}`);
    assert(sourceIndexItem, `no Browse source index item found for ${target.sourceTargetId}`);
    const shardName = sourceIndexItem.detailUrl?.split('/').pop();
    assert(shardName, `source index item ${sourceIndexItem.id} has no detail shard`);
    const shard = readShard(shardName, shardCache);
    const detail = shard.items.find((item) => item.id === sourceIndexItem.id);
    assert(detail, `detail shard ${shardName} does not contain ${sourceIndexItem.id}`);
    const applied = normalizeArray(detail.alreadyOnSiteEnrichments).find((entry) => entry.sourceTargetId === target.sourceTargetId);
    assert(applied, `source detail ${sourceIndexItem.id} is missing enrichment ${target.sourceTargetId}`);
    assert(normalizeArray(applied.sourceItems).length === normalizeArray(target.sourceItems).length, `source detail ${sourceIndexItem.id} has wrong enrichment source item count`);
    assert(!containsLocalPath(detail), `source detail ${sourceIndexItem.id} leaks a local path`);
    verified += 1;
  }

  console.log(`Already-on-site enrichment validation passed: ${targets.length} targets, ${appliedSourceItemCount} applied source rows, ${reviewRows.length} review-only rows, ${verified} generated source details verified.`);
}

function readShard(name, cache) {
  if (!cache.has(name)) {
    cache.set(name, readJson(path.join(SOURCE_SHARD_DIR, name)));
  }
  return cache.get(name);
}

function readJson(filePath) {
  assert(existsSync(filePath), `missing required file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function containsLocalPath(value) {
  return /[A-Z]:\\|\\\\|\/Users\/scomo/i.test(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'item';
}
