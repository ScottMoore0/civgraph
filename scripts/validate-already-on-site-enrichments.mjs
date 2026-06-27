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
  assert(appliedSourceItemCount === 148, `expected 148 applied source rows, found ${appliedSourceItemCount}`);
  assert(reviewRows.length === 964, `expected 964 public review-only rows, found ${reviewRows.length}`);
  assert(enrichments.summary?.internalReviewRows === 965, 'expected 965 internal review rows before sensitive redaction');
  assert(enrichments.summary?.withheldSensitiveReviewRows === 1, 'expected 1 sensitive review row to be withheld from public output');
  assert(enrichments.policy?.withheldSensitiveReviewRows === 1, 'policy must record the sensitive withheld-row count without exposing row details');
  const reviewRowNumbers = new Set(reviewRows.map((row) => Number(row.auditRowNumber)));
  assert(!reviewRowNumbers.has(555), 'sensitive held row 555 must be withheld from public reviewRows');
  for (const heldRow of [945]) {
    assert(reviewRowNumbers.has(heldRow), `held row ${heldRow} must remain review-only`);
  }
  const sensitiveSchemaToken = String.fromCharCode(85, 80, 82, 78);
  assert(!JSON.stringify(enrichments).includes(sensitiveSchemaToken), 'public already-on-site output must not mention sensitive address-source schema');
  const appliedSourceItems = targets.flatMap((target) => normalizeArray(target.sourceItems));
  const appliedRowNumbers = new Set(appliedSourceItems.map((item) => Number(item.auditRowNumber)));
  for (const approvedRow of [521, 1005]) {
    assert(appliedRowNumbers.has(approvedRow), `approved row ${approvedRow} must be applied`);
  }
  assert(
    appliedSourceItems.some((item) => Number(item.auditRowNumber) === 521
      && item.providerDatasetUrl === 'https://data.gov.ie/dataset/local-authorities-national-statutory-boundaries-ungeneralised-20241'),
    'row 521 must use the resolved Tailte Eireann 2024 local-authorities package URL'
  );
  assert(
    appliedSourceItems.some((item) => Number(item.auditRowNumber) === 1005
      && item.providerDatasetUrl === 'https://data.gov.ie/dataset/cycle-parking-dcc'),
    'row 1005 must use the live DCC cycle-parking package URL'
  );

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
