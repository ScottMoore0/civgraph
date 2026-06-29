#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENRICHMENTS_PATH = path.join(ROOT, 'data', 'database', 'already-on-site-enrichments.json');
const BROWSE_SOURCES_PATH = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARD_DIR = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');
const APPROVED_TAILTE_OSI_ROWS = [
  21, 23, 24, 25, 26, 27, 28, 30, 31, 51, 52, 53, 88, 89, 90, 91,
  93, 94, 95, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169,
  174, 175, 176, 177, 178, 179, 180, 181, 183, 184, 185, 186, 187, 188,
  189, 239, 240, 263, 290, 291, 292, 293, 702, 703, 704, 705, 706,
  707, 708, 709, 714, 715, 716, 717, 718, 719, 720, 721, 722, 723,
  724, 725, 726, 727, 728, 729, 730, 731, 732, 733, 736, 737, 738, 739,
  740, 741, 744, 745, 746, 747, 748, 749, 750, 751, 752, 753, 754, 755,
  756, 757, 758, 759, 966
];
const NON_STATUTORY_TAILTE_OSI_ROWS = new Set([26, 51, 52]);

main();

function main() {
  const enrichments = readJson(ENRICHMENTS_PATH);
  assert(enrichments.schemaVersion === 1, 'already-on-site enrichments must use schemaVersion 1');
  assert(!containsLocalPath(enrichments), 'already-on-site enrichments must not expose local filesystem paths');

  const targets = normalizeArray(enrichments.targets);
  const reviewRows = normalizeArray(enrichments.reviewRows);
  const appliedSourceItemCount = targets.reduce((sum, target) => sum + normalizeArray(target.sourceItems).length, 0);
  assert(targets.length > 0, 'expected at least one applied enrichment target');
  assert(appliedSourceItemCount === 317, `expected 317 applied source rows, found ${appliedSourceItemCount}`);
  assert(reviewRows.length === 794, `expected 794 public review-only rows, found ${reviewRows.length}`);
  assert(enrichments.summary?.inputRows === 1113, 'expected 1113 original review rows including withheld sensitive input');
  assert(enrichments.summary?.trackedInputRows === 1112, 'expected 1112 tracked sanitized input rows');
  assert(enrichments.summary?.internalReviewRows === 795, 'expected 795 internal review rows before sensitive redaction');
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
  for (const approvedRow of APPROVED_TAILTE_OSI_ROWS) {
    assert(appliedRowNumbers.has(approvedRow), `approved Tailte/OSI row ${approvedRow} must be applied`);
  }
  for (const approvedRow of [521, 1005]) {
    assert(appliedRowNumbers.has(approvedRow), `approved row ${approvedRow} must be applied`);
  }
  const statutoryFamily = targets.find((target) => target.sourceTargetId === 'already-on-site-family:tailte-osi-2019-statutory-boundaries');
  assert(statutoryFamily, 'Tailte/OSI statutory-boundary source family target must exist');
  const statutoryRows = new Set(normalizeArray(statutoryFamily.sourceItems).map((item) => Number(item.auditRowNumber)));
  const expectedStatutoryRows = APPROVED_TAILTE_OSI_ROWS.filter((row) => !NON_STATUTORY_TAILTE_OSI_ROWS.has(row));
  for (const row of expectedStatutoryRows) {
    assert(statutoryRows.has(row), `approved boundary-variant row ${row} must route to statutory-boundary family`);
  }
  for (const row of NON_STATUTORY_TAILTE_OSI_ROWS) {
    assert(!statutoryRows.has(row), `non-boundary census/statistical row ${row} must not route to statutory-boundary family`);
  }

  // Newly approved batches: government/electoral-boundary + geology source families, and OPW/hydro matched-record enrichment.
  const GOV_ELECTORAL_ROWS = [16, 17, 18, 19, 20, 34, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 55, 56, 57, 58, 59, 60, 61, 62, 63, 71, 72, 73, 77, 81, 82, 83, 84, 85, 87, 171, 172, 173, 226, 712];
  const GEOLOGY_ROWS = [790, 791, 829, 830, 831, 833, 837, 839, 860, 883, 884, 896, 897];
  const OPW_MATCHED_ROWS = [4, 135, 262, 538, 544, 545, 799, 854, 855, 856, 857, 863, 1033, 1034, 1090];
  for (const row of [...GOV_ELECTORAL_ROWS, ...GEOLOGY_ROWS, ...OPW_MATCHED_ROWS]) {
    assert(appliedRowNumbers.has(row), `approved row ${row} must be applied`);
  }
  const govFamily = targets.find((target) => target.sourceTargetId === 'already-on-site-family:tailte-osi-government-electoral-boundaries');
  assert(govFamily, 'government/electoral-boundary source family target must exist');
  const govRows = new Set(normalizeArray(govFamily.sourceItems).map((item) => Number(item.auditRowNumber)));
  for (const row of GOV_ELECTORAL_ROWS) assert(govRows.has(row), `gov/electoral row ${row} must route to its source family`);
  const geoFamily = targets.find((target) => target.sourceTargetId === 'already-on-site-family:gsi-gsni-geology-sources');
  assert(geoFamily, 'geology source family target must exist');
  const geoRows = new Set(normalizeArray(geoFamily.sourceItems).map((item) => Number(item.auditRowNumber)));
  for (const row of GEOLOGY_ROWS) assert(geoRows.has(row), `geology row ${row} must route to its source family`);
  const familyRowNumbers = new Set(targets.filter((target) => String(target.sourceTargetId).startsWith('already-on-site-family:')).flatMap((target) => normalizeArray(target.sourceItems).map((item) => Number(item.auditRowNumber))));
  for (const row of OPW_MATCHED_ROWS) assert(!familyRowNumbers.has(row), `OPW row ${row} must attach to its matched record, not a neutral family`);
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
