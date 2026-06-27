#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_SIDECAR = path.join(ROOT, 'data', 'database', 'ni-register-sources.json');
const INTEREST_INDEX = path.join(ROOT, 'data', 'database', 'ni-register-interests.json');
const BROWSE_SOURCES = path.join(ROOT, 'data', 'browse', 'sources.json');
const BROWSE_REGISTER_INTERESTS = path.join(ROOT, 'data', 'browse', 'register-interests.json');
const SOURCE_SHARDS = path.join(ROOT, 'data', 'browse', 'details', 'source-shards');

main();

function main() {
  const sourceSidecar = readJson(SOURCE_SIDECAR);
  const interestIndex = readJson(INTEREST_INDEX);

  assert(sourceSidecar.schemaVersion === 1, 'NI register source sidecar must use schemaVersion 1');
  assert(interestIndex.schemaVersion === 1, 'NI register interest index must use schemaVersion 1');
  assert(!containsLocalPath(sourceSidecar), 'NI register source sidecar must not expose local filesystem paths');
  assert(!containsLocalPath(interestIndex), 'NI register interest index must not expose local filesystem paths');

  const sources = normalizeArray(sourceSidecar.sources);
  assert(sourceSidecar.summary?.scrapedAssemblySourceCount === 75, `expected 75 scraped Assembly source records, found ${sourceSidecar.summary?.scrapedAssemblySourceCount}`);
  assert(sources.length === sourceSidecar.summary?.sourceRecordCount, 'NI register source count must match source sidecar summary');
  assert(sources.length === 80, `expected 80 NI register source records including parent/source datasets, found ${sources.length}`);
  assert(sources.filter((source) => String(source.id || '').startsWith('ni-register:assembly:')).length === 76, 'expected 76 NI Assembly source records including collection parent');
  assert(sources.filter((source) => String(source.id || '').startsWith('ni-register:mp:')).length === 4, 'expected 4 NI MP source records including collection parent');
  assert(countSourceItemsByKind(sources, 'pdf') === 38, 'expected 38 NI Assembly PDF source records');
  assert(countSourceItemsByKind(sources, 'html') === 32, 'expected 32 NI Assembly HTML source records');
  assert(countSourceItemsByKind(sources, 'landing-html') === 2, 'expected 2 NI Assembly landing HTML source records');
  assert(countSourceItemsByKind(sources, 'json') === 2, 'expected 2 NI Assembly JSON source records');
  assert(countSourceItemsByKind(sources, 'xml') === 1, 'expected 1 NI Assembly XML source record');

  const sourceIds = new Set(sources.map((source) => source.id));
  assert(sourceIds.has('ni-register:assembly:collection'), 'missing NI Assembly register collection source');
  assert(sourceIds.has('ni-register:mp:collection'), 'missing NI MP register collection source');
  assert(sources.some((source) => /GetAllRegisteredInterests_JSON/i.test(source.url || '')), 'missing NI Assembly current JSON API source');

  assert(interestIndex.detailLayout === 'sharded', 'NI register interest data must use sharded layout');
  assert(interestIndex.canonicalLayout === 'sharded', 'NI register canonical interest data must use sharded layout');
  assert(interestIndex.summary?.totalSourceRows === 75908, `expected 75,908 source rows, found ${interestIndex.summary?.totalSourceRows}`);
  assert(interestIndex.summary?.totalCanonicalInterests === 8289, `expected 8,289 canonical Browse interests, found ${interestIndex.summary?.totalCanonicalInterests}`);
  assert(interestIndex.summary?.duplicateSourceRowsMerged === 67619, `expected 67,619 duplicate source rows merged, found ${interestIndex.summary?.duplicateSourceRowsMerged}`);
  assert(interestIndex.summary?.assemblyCurrentApiInterests === 424, `expected 424 current MLA API rows, found ${interestIndex.summary?.assemblyCurrentApiInterests}`);
  assert(interestIndex.summary?.mpInterests === 1622, `expected 1,622 deduplicated NI MP rows, found ${interestIndex.summary?.mpInterests}`);
  assert(interestIndex.summary?.assemblyHistoricalHtmlInterests === 34565, `expected 34,565 historical MLA HTML rows, found ${interestIndex.summary?.assemblyHistoricalHtmlInterests}`);
  assert(interestIndex.summary?.assemblyHistoricalPdfInterests === 39297, `expected 39,297 historical MLA PDF rows, found ${interestIndex.summary?.assemblyHistoricalPdfInterests}`);
  assert(interestIndex.summary?.totalInterests === interestIndex.summary?.assemblyCurrentApiInterests + interestIndex.summary?.assemblyHistoricalHtmlInterests + interestIndex.summary?.assemblyHistoricalPdfInterests + interestIndex.summary?.mpInterests, 'NI register interest summary totals do not add up');
  assert(interestIndex.summary?.totalInterests === interestIndex.summary?.totalSourceRows, 'NI register source row total must match totalInterests for audit compatibility');

  const shards = normalizeArray(interestIndex.shards);
  assert(shards.length > 0, 'NI register interest index must list shards');
  let totalShardRows = 0;
  let currentMlaRows = 0;
  let historicalMlaRows = 0;
  let historicalPdfRows = 0;
  let mpRows = 0;
  const sourceRecordIds = new Set();
  const pdfSourceRecordIds = new Set();
  for (const shard of shards) {
    assert(shard.url && /^\/data\/database\/ni-register-interests\//.test(shard.url), `unexpected NI register shard URL: ${shard.url}`);
    const shardData = readJson(publicUrlToLocalPath(shard.url));
    assert(shardData.schemaVersion === 1, `NI register interest shard ${shard.name} must use schemaVersion 1`);
    assert(!containsLocalPath(shardData), `NI register interest shard ${shard.name} must not expose local filesystem paths`);
    const rows = normalizeArray(shardData.interests);
    assert(rows.length === shard.count, `NI register interest shard ${shard.name} count mismatch`);
    assert(rows.length <= interestIndex.shardSize, `NI register interest shard ${shard.name} exceeds shard size`);
    totalShardRows += rows.length;
    for (const row of rows) {
      assert(row.id && row.memberName && row.category, `NI register row missing id/member/category in ${shard.name}`);
      assert(row.jurisdiction === 'Northern Ireland', `NI register row has non-NI jurisdiction: ${row.id}`);
      assert(sourceIds.has(row.sourceRecordId), `NI register row ${row.id} references unknown source ${row.sourceRecordId}`);
      sourceRecordIds.add(row.sourceRecordId);
      if (row.memberType === 'MP') {
        mpRows += 1;
        assert(row.chamber === 'House of Commons of the United Kingdom', `NI MP row has unexpected chamber: ${row.id}`);
        assert(normalizeArray(row.constituencies).length > 0, `NI MP row missing NI constituency evidence: ${row.id}`);
      } else if (row.sourceKind === 'current-provider-json-api') {
        currentMlaRows += 1;
        assert(row.extractionConfidence === 'high', `current MLA API row should be high confidence: ${row.id}`);
      } else if (row.sourceKind === 'historical-html-register') {
        historicalMlaRows += 1;
        assert(row.extractionConfidence === 'medium', `historical MLA HTML row should be medium confidence: ${row.id}`);
        assert(!/^(find mlas|accessibility)$/i.test(row.category || ''), `historical MLA row has navigation category: ${row.id}`);
      } else if (row.sourceKind === 'historical-pdf-register') {
        historicalPdfRows += 1;
        pdfSourceRecordIds.add(row.sourceRecordId);
        assert(row.extractionConfidence === 'medium', `historical MLA PDF row should be medium confidence: ${row.id}`);
        assert(row.extractionMethod === 'pdf-text-heading-parser', `historical MLA PDF row has unexpected extraction method: ${row.id}`);
        assert(row.sourcePageStart, `historical MLA PDF row missing source page: ${row.id}`);
        assert(!/^(visits none|find mlas|accessibility|minister for|hectares of land|chairman,)/i.test(row.category || ''), `historical MLA PDF row has non-category heading: ${row.id}`);
      } else {
        throw new Error(`unexpected NI register source kind ${row.sourceKind} on ${row.id}`);
      }
    }
  }
  assert(totalShardRows === interestIndex.summary.totalInterests, `NI register shard row total ${totalShardRows} does not match summary ${interestIndex.summary.totalInterests}`);
  assert(currentMlaRows === 424, `expected 424 current MLA API shard rows, found ${currentMlaRows}`);
  assert(mpRows === 1622, `expected 1,622 NI MP shard rows, found ${mpRows}`);
  assert(historicalMlaRows === interestIndex.summary.assemblyHistoricalHtmlInterests, 'historical MLA shard row count mismatch');
  assert(historicalPdfRows === 39297, `expected 39,297 historical MLA PDF shard rows, found ${historicalPdfRows}`);
  assert(pdfSourceRecordIds.size === 38, `expected structured PDF rows for all 38 PDFs, found ${pdfSourceRecordIds.size}`);
  assert(sourceRecordIds.has('ni-register:assembly:collection') === false, 'interest rows should reference concrete Assembly source records, not the collection parent');
  validateCanonicalInterests(interestIndex);

  validateBrowseSources(sources);
  validateBrowseRegisterInterests(interestIndex);

  console.log(`NI register validation passed: ${sources.length} source records, ${totalShardRows} interest rows, ${currentMlaRows} current MLA API rows, ${historicalMlaRows} historical MLA HTML rows, ${historicalPdfRows} historical MLA PDF rows, ${mpRows} NI MP rows.`);
}

function validateCanonicalInterests(interestIndex) {
  const canonicalRows = loadCanonicalInterestRows(interestIndex);
  assert(canonicalRows.length === interestIndex.summary.totalCanonicalInterests, `canonical row count ${canonicalRows.length} does not match summary ${interestIndex.summary.totalCanonicalInterests}`);
  assert(canonicalRows.length < interestIndex.summary.totalSourceRows, 'canonical Browse rows must be fewer than source-specific extraction rows');
  const keys = new Set();
  let sourceRefTotal = 0;
  let htmlPdfRefs = 0;
  for (const row of canonicalRows) {
    assert(row.id?.startsWith('ni-register-canonical-interest:'), `canonical row has unexpected id: ${row.id}`);
    assert(row.memberName && row.category && row.interestText, `canonical row missing member/category/text: ${row.id}`);
    assert(row.sourceCount === normalizeArray(row.sourceRefs).length, `canonical row ${row.id} sourceCount does not match sourceRefs`);
    assert(row.sourceCount >= 1, `canonical row ${row.id} has no source references`);
    sourceRefTotal += row.sourceCount;
    const key = row.canonicalKey || `${row.memberType}|${row.jurisdiction}|${row.memberName}|${row.category}|${row.interestText}`.toLowerCase();
    assert(!keys.has(key), `duplicate canonical Browse key: ${row.id}`);
    keys.add(key);
    const kinds = new Set(normalizeArray(row.sourceKinds));
    if (kinds.has('historical-html-register') && kinds.has('historical-pdf-register')) htmlPdfRefs += 1;
    assert(!/^(commercial premises|minister for|hectares of land|chairman,|board of governors|i employ|find mlas|accessibility)/i.test(row.category || ''), `canonical row has non-category heading: ${row.id}`);
  }
  assert(sourceRefTotal === interestIndex.summary.totalSourceRows, `canonical sourceRefs cover ${sourceRefTotal} source rows, expected ${interestIndex.summary.totalSourceRows}`);
  assert(htmlPdfRefs >= 2000, `expected substantial HTML/PDF merged evidence rows, found ${htmlPdfRefs}`);
}

function loadCanonicalInterestRows(interestIndex) {
  return normalizeArray(interestIndex.canonicalShards).flatMap((shard) => {
    assert(shard.url && /^\/data\/database\/ni-register-canonical-interests\//.test(shard.url), `unexpected canonical NI register shard URL: ${shard.url}`);
    const shardData = readJson(publicUrlToLocalPath(shard.url));
    assert(shardData.schemaVersion === 1, `canonical NI register interest shard ${shard.name} must use schemaVersion 1`);
    assert(!containsLocalPath(shardData), `canonical NI register interest shard ${shard.name} must not expose local filesystem paths`);
    const rows = normalizeArray(shardData.interests);
    assert(rows.length === shard.count, `canonical NI register interest shard ${shard.name} count mismatch`);
    return rows;
  });
}

function validateBrowseSources(expectedSources) {
  const browse = readJson(BROWSE_SOURCES);
  const browseItems = normalizeArray(browse.items);
  const byId = new Map(browseItems.map((item) => [item.id, item]));
  const shardCache = new Map();
  for (const source of expectedSources) {
    const indexItem = byId.get(source.id);
    assert(indexItem, `Browse sources index missing NI register source ${source.id}`);
    const detail = readSourceDetail(indexItem, shardCache);
    assert(detail, `Browse source detail missing NI register source ${source.id}`);
    assert(!containsLocalPath(detail), `Browse source detail leaks local path for ${source.id}`);
    assert(normalizeArray(detail.sourceItems).length > 0, `Browse source detail lost sourceItems for ${source.id}`);
  }
}

function validateBrowseRegisterInterests(interestIndex) {
  const browse = readJson(BROWSE_REGISTER_INTERESTS);
  assert(browse.schemaVersion === 1, 'Browse register interest index must use schemaVersion 1');
  assert(browse.total === interestIndex.summary.totalCanonicalInterests, `Browse register interest total ${browse.total} does not match canonical total ${interestIndex.summary.totalCanonicalInterests}`);
  assert(!containsLocalPath(browse), 'Browse register interest index must not expose local filesystem paths');
  assert(browse.indexLayout === 'sharded', 'Browse register interest index must use sharded layout');
  const items = loadBrowseRegisterInterestItems(browse);
  assert(items.length === browse.total, 'Browse register interest item count must match total');
  assert(items.every((item) => item.detailUrl), 'every Browse register interest row must carry a detail shard URL');
  assert(items.every((item) => !Object.hasOwn(item, 'interestText')), 'Browse register interest compact index must not duplicate full interest text');
  assert(items.every((item) => item.sourceCount >= 1), 'every Browse register interest row must expose canonical sourceCount');
  assert(items.some((item) => item.memberType === 'MLA'), 'Browse register interest index must include MLA rows');
  assert(items.some((item) => item.memberType === 'MP'), 'Browse register interest index must include NI MP rows');
  const sampleMp = items.find((item) => item.memberType === 'MP');
  assert(sampleMp?.constituency || normalizeArray(sampleMp?.constituencies).length > 0, 'Browse NI MP sample must include constituency evidence');
  const sample = items.find((item) => item.sourceKind === 'current-provider-json-api') || items[0];
  const detailShard = readJson(publicUrlToLocalPath(sample.detailUrl));
  const detailRows = normalizeArray(detailShard.items || detailShard.interests);
  assert(detailRows.some((row) => row.id === sample.id), `Browse register interest detail shard does not contain sample ${sample.id}`);
  const detailSample = detailRows.find((row) => row.id === sample.id);
  assert(normalizeArray(detailSample?.sourceRefs).length === detailSample?.sourceCount, `canonical detail ${sample.id} lost sourceRefs`);
}

function loadBrowseRegisterInterestItems(browse) {
  return normalizeArray(browse.shards).flatMap((shard) => {
    assert(shard.url && /^\/data\/browse\/register-interest-shards\//.test(shard.url), `unexpected Browse register interest shard URL: ${shard.url}`);
    const shardData = readJson(publicUrlToLocalPath(shard.url));
    assert(shardData.schemaVersion === 1, `Browse register interest shard ${shard.name} must use schemaVersion 1`);
    assert(!containsLocalPath(shardData), `Browse register interest shard ${shard.name} must not expose local filesystem paths`);
    const items = normalizeArray(shardData.items);
    assert(items.length === shard.count, `Browse register interest shard ${shard.name} count mismatch`);
    assert(items.every((item) => !Object.hasOwn(item, 'interestText')), `Browse register interest shard ${shard.name} must not duplicate full interest text`);
    return items;
  });
}

function countSourceItemsByKind(sources, kind) {
  return sources.filter((source) => normalizeArray(source.sourceItems).some((item) => item.kind === kind)).length;
}

function readSourceDetail(indexItem, cache) {
  const shardName = indexItem.detailUrl?.split('/').pop();
  assert(shardName, `source index item ${indexItem.id} has no detail shard`);
  if (!cache.has(shardName)) {
    cache.set(shardName, readJson(path.join(SOURCE_SHARDS, shardName)));
  }
  return normalizeArray(cache.get(shardName).items).find((item) => item.id === indexItem.id);
}

function publicUrlToLocalPath(url) {
  const pathname = String(url || '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  return path.join(ROOT, ...pathname.split('/'));
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
  return /[A-Z]:\\|\\\\|\/Users\/scomo|\/home\/|tmp\/ni-assembly-registers|Downloads\\/i.test(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
