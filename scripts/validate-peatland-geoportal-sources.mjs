#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SIDE_CAR = path.join(ROOT, 'data', 'database', 'peatland-geoportal-sources.json');
const BROWSE_SOURCES = path.join(ROOT, 'data', 'browse', 'sources.json');
const SOURCE_SHARDS = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');

main();

function main() {
  const sidecar = readJson(SIDE_CAR);
  assert(sidecar.schemaVersion === 1, 'peatland sidecar must use schemaVersion 1');
  assert(!containsLocalPath(sidecar), 'peatland sidecar must not expose local filesystem paths');
  assert(!containsGeometryPayload(sidecar), 'peatland sidecar must not contain feature geometry payloads');

  const summary = sidecar.summary || {};
  assert(summary.totalArcgisItems === 438, `expected 438 ArcGIS items, found ${summary.totalArcgisItems}`);
  assert(summary.sourceRecords === 330, `expected 330 source records, found ${summary.sourceRecords}`);
  assert(summary.existingRecordEnrichmentRows === 66, `expected 66 directly targetable enrichment rows, found ${summary.existingRecordEnrichmentRows}`);
  assert(summary.unmatchedLikelyDuplicateRows === 25, `expected 25 unmatched likely-duplicate review rows, found ${summary.unmatchedLikelyDuplicateRows}`);
  assert(summary.serviceDefinitionRows === 34, `expected 34 service definition review rows, found ${summary.serviceDefinitionRows}`);
  assert(summary.candidateConversionRows === 128, `expected 128 conversion candidates, found ${summary.candidateConversionRows}`);
  assert(summary.sourceContextRows === 88, `expected 88 source context rows, found ${summary.sourceContextRows}`);
  assert(summary.sourceDocumentRows === 45, `expected 45 source document rows, found ${summary.sourceDocumentRows}`);

  const sources = normalizeArray(sidecar.sources);
  assert(sources.length === summary.sourceRecords, 'source record count must match summary.sourceRecords');
  for (const source of sources) {
    assert(source.id?.startsWith('peatland-geoportal:'), `peatland source has unexpected id: ${source.id}`);
    assert(source.title, `peatland source ${source.id} has no title`);
    assert(normalizeArray(source.references).some((ref) => /arcgis-item-page/.test(ref.role || '')), `peatland source ${source.id} lacks ArcGIS item reference`);
    assert(normalizeArray(source.sourceItems).length === 1, `peatland source ${source.id} should carry exactly one source item`);
    assert(source.license?.status, `peatland source ${source.id} lacks licence review status`);
  }

  const sacGroup = sidecar.sacHabitatGroup || {};
  assert(sacGroup.proposedParentId === 'peatland-sac-habitat-maps', 'SAC habitat group needs stable proposed parent ID');
  assert(normalizeArray(sacGroup.children).length >= 20, 'expected a substantial SAC habitat map child group');
  for (const child of normalizeArray(sacGroup.children)) {
    assert(/SAC Habitat Map/i.test(child.title || ''), `SAC child does not look like a SAC habitat map: ${child.title}`);
  }

  const variants = normalizeArray(sidecar.variantReview);
  assert(variants.some((row) => /Purple Moor Grass and Rush Pasture/i.test(row.title || '')), 'variant review must include Purple Moor Grass and Rush Pasture');
  assert(variants.some((row) => /Grassland Habitat Network/i.test(row.title || '')), 'variant review must include Grassland Habitat Network');

  const bestSource = normalizeArray(sidecar.bestSourceReview);
  assert(bestSource.length > 0, 'expected best-source review groups');
  assert(bestSource.some((row) => /Purple Moor Grass and Rush Pasture/i.test(row.preferredTitle || '')), 'best-source review must include Purple Moor Grass and Rush Pasture');

  validateBrowseSources(sources, normalizeArray(sidecar.targets));

  console.log(`Peatland Geoportal validation passed: ${sources.length} source records, ${summary.existingRecordEnrichmentRows} enrichment rows, ${sacGroup.children.length} SAC candidates, ${variants.length} variant rows.`);
}

function validateBrowseSources(peatlandSources, peatlandTargets) {
  const browse = readJson(BROWSE_SOURCES);
  assert(Array.isArray(browse.items), 'Browse sources index must contain items');
  const indexById = new Map(browse.items.map((item) => [item.id, item]));
  const shardCache = new Map();

  for (const source of peatlandSources) {
    const indexItem = indexById.get(source.id);
    assert(indexItem, `Browse source index is missing peatland source ${source.id}`);
    const detail = readDetail(indexItem, shardCache);
    assert(detail, `Browse source detail is missing peatland source ${source.id}`);
    assert(!containsLocalPath(detail), `Browse source detail ${source.id} leaks local path`);
    assert(!containsGeometryPayload(detail), `Browse source detail ${source.id} contains geometry payload`);
    assert(normalizeArray(detail.sourceItems).length === 1, `Browse detail ${source.id} lost sourceItems`);
  }

  for (const target of peatlandTargets) {
    const indexItem = indexById.get(target.sourceTargetId) || indexById.get(`already-on-site-enrichment:${slugify(target.sourceTargetId)}`);
    assert(indexItem, `Browse source index is missing peatland enrichment target ${target.sourceTargetId}`);
    const detail = readDetail(indexItem, shardCache);
    assert(detail, `Browse source detail is missing enrichment target ${target.sourceTargetId}`);
    const expectedItemIds = normalizeArray(target.sourceItems).map((item) => item.arcgisItemId).filter(Boolean);
    const enrichment = normalizeArray(detail.alreadyOnSiteEnrichments).find((item) => {
      if (item.sourceTargetId !== target.sourceTargetId) return false;
      const actualItemIds = new Set(normalizeArray(item.sourceItems).map((sourceItem) => sourceItem.arcgisItemId).filter(Boolean));
      return expectedItemIds.every((itemId) => actualItemIds.has(itemId));
    });
    assert(enrichment, `Browse detail ${indexItem.id} does not include peatland enrichment ${target.sourceTargetId}`);
    assert(normalizeArray(enrichment.sourceItems).length === normalizeArray(target.sourceItems).length, `Browse detail ${indexItem.id} has wrong peatland enrichment count`);
    assert(expectedItemIds.length > 0, `Peatland enrichment target ${target.sourceTargetId} has no ArcGIS item IDs`);
    assert(normalizeArray(enrichment.arcgisItemIds).length >= expectedItemIds.length, `Browse detail ${indexItem.id} lost peatland ArcGIS item IDs`);
    assert(/ArcGIS/i.test(enrichment.provenanceSummary || ''), `Browse detail ${indexItem.id} lost peatland ArcGIS provenance summary`);
    const refs = normalizeArray(detail.references);
    assert(refs.some((ref) => ref.role === 'arcgis-item-page'), `Browse detail ${indexItem.id} lacks peatland ArcGIS item-page reference`);
    if (normalizeArray(target.sourceItems).some((item) => item.serviceUrl)) {
      assert(refs.some((ref) => ref.role === 'arcgis-service-url'), `Browse detail ${indexItem.id} lacks peatland ArcGIS service reference`);
    }
  }
}

function readDetail(indexItem, cache) {
  const shardName = indexItem.detailUrl?.split('/').pop();
  assert(shardName, `source index item ${indexItem.id} has no detail shard`);
  if (!cache.has(shardName)) {
    cache.set(shardName, readJson(path.join(SOURCE_SHARDS, shardName)));
  }
  return normalizeArray(cache.get(shardName).items).find((item) => item.id === indexItem.id);
}

function readJson(filePath) {
  assert(existsSync(filePath), `missing file: ${path.relative(ROOT, filePath)}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function containsLocalPath(value) {
  return /[A-Z]:\\|\\\\|\/Users\/scomo/i.test(JSON.stringify(value));
}

function containsGeometryPayload(value) {
  return /"features"\s*:\s*\[|"geometry"\s*:\s*\{|"coordinates"\s*:\s*\[/i.test(JSON.stringify(value));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'item';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
