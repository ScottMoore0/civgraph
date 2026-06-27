#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const SCRATCH_DIR = path.join(ROOT, 'tmp', 'ni-assembly-registers');
const INVENTORY_PATH = path.join(SCRATCH_DIR, 'register-document-inventory.json');
const OUTPUT_SOURCE_PATH = path.join(ROOT, 'data', 'database', 'ni-register-sources.json');
const OUTPUT_INTEREST_PATH = path.join(ROOT, 'data', 'database', 'ni-register-interests.json');
const OUTPUT_INTEREST_SHARD_DIR = path.join(ROOT, 'data', 'database', 'ni-register-interests');
const OUTPUT_CANONICAL_INTEREST_SHARD_DIR = path.join(ROOT, 'data', 'database', 'ni-register-canonical-interests');
const PDF_TEXT_SCRIPT = path.join(ROOT, 'scripts', 'extract-pdf-text.py');
const STRUCTURED_DATA_URL = '/data/database/ni-register-interests.json';
const GENERATED_AT = new Date().toISOString();
const INTEREST_SHARD_SIZE = 1000;
const PDF_EMPTY_INTEREST_TEXT = 'No registrable interests included under this category in the PDF text.';

const START_PAGES = {
  current: 'https://www.niassembly.gov.uk/your-mlas/register-of-interests/',
  archive: 'https://archive.niassembly.gov.uk/members/expenses/register_home.htm'
};

const MP_EXTRACTS = [
  {
    id: 'full-csv',
    title: 'Northern Ireland MPs extracted from supplied Westminster register CSV',
    sourceFile: 'register_of_interests.csv',
    path: path.join(SCRATCH_DIR, 'register-of-interests-ni-mps.csv'),
    summaryPath: path.join(SCRATCH_DIR, 'register-of-interests-ni-mps-summary.json')
  },
  {
    id: 'recent-csv-1',
    title: 'Northern Ireland MPs extracted from supplied Westminster register CSV 1',
    sourceFile: 'register_of_interests (1).csv',
    path: path.join(SCRATCH_DIR, 'register-of-interests-1-ni-mps.csv'),
    summaryPath: path.join(SCRATCH_DIR, 'register-of-interests-1-ni-mps-summary.json')
  },
  {
    id: 'recent-csv-2',
    title: 'Northern Ireland MPs extracted from supplied Westminster register CSV 2',
    sourceFile: 'register_of_interests (2).csv',
    path: path.join(SCRATCH_DIR, 'register-of-interests-2-ni-mps.csv'),
    summaryPath: path.join(SCRATCH_DIR, 'register-of-interests-2-ni-mps-summary.json')
  }
];

main();

function main() {
  if (!existsSync(INVENTORY_PATH)) {
    throw new Error(`Missing ${path.relative(ROOT, INVENTORY_PATH)}. Run the NI Assembly register scraper before building this sidecar.`);
  }

  const inventory = readJson(INVENTORY_PATH);
  const inventoryRecords = normalizeArray(inventory.records);
  const sourceIdByInventoryUrl = new Map();
  const sources = buildSourceRecords(inventory, inventoryRecords, sourceIdByInventoryUrl);
  const currentAssemblyInterests = buildCurrentAssemblyInterests(inventoryRecords, sourceIdByInventoryUrl);
  const historicalAssemblyInterests = buildHistoricalAssemblyHtmlInterests(inventoryRecords, sourceIdByInventoryUrl);
  const historicalAssemblyPdfInterests = buildHistoricalAssemblyPdfInterests(inventoryRecords, sourceIdByInventoryUrl);
  const mpInterests = buildMpInterests();
  const interests = [
    ...currentAssemblyInterests,
    ...historicalAssemblyInterests,
    ...historicalAssemblyPdfInterests,
    ...mpInterests
  ].sort(sortInterests);

  const interestShards = writeInterestShards(interests);
  const canonicalInterests = buildCanonicalInterests(interests).sort(sortInterests);
  const canonicalInterestShards = writeCanonicalInterestShards(canonicalInterests);
  const sourcePayload = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    title: 'Northern Ireland register of interests source records',
    summary: compactObject({
      scrapedAssemblySourceCount: inventoryRecords.length,
      sourceRecordCount: sources.length,
      assemblyCurrentSourceUrl: START_PAGES.current,
      assemblyArchiveSourceUrl: START_PAGES.archive,
      mpExtractCount: MP_EXTRACTS.length
    }),
    sources
  };

  const interestPayload = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    title: 'Northern Ireland register of interests structured data',
    detailLayout: 'sharded',
    shardSize: INTEREST_SHARD_SIZE,
    shardDir: '/data/database/ni-register-interests',
    canonicalLayout: 'sharded',
    canonicalShardSize: INTEREST_SHARD_SIZE,
    canonicalShardDir: '/data/database/ni-register-canonical-interests',
    summary: compactObject({
      totalInterests: interests.length,
      totalSourceRows: interests.length,
      totalCanonicalInterests: canonicalInterests.length,
      duplicateSourceRowsMerged: interests.length - canonicalInterests.length,
      assemblyCurrentApiInterests: currentAssemblyInterests.length,
      assemblyHistoricalHtmlInterests: historicalAssemblyInterests.length,
      assemblyHistoricalPdfInterests: historicalAssemblyPdfInterests.length,
      mpInterests: mpInterests.length,
      assemblySourceRecords: inventoryRecords.length,
      mpExtracts: MP_EXTRACTS.length,
      pdfSourceRecords: inventoryRecords.filter((record) => record.kind === 'pdf').length,
      note: 'Structured MLA rows are extracted from the current provider JSON API, historical HTML register pages, and PDF register editions. NI MP rows are extracted from the supplied CSV files after NI-only filtering.'
    }),
    shards: interestShards,
    canonicalShards: canonicalInterestShards
  };

  writeJson(OUTPUT_SOURCE_PATH, sourcePayload);
  writeJson(OUTPUT_INTEREST_PATH, interestPayload);

  console.log(`NI register sources written: ${path.relative(ROOT, OUTPUT_SOURCE_PATH)} (${sources.length} records)`);
  console.log(`NI register interests written: ${path.relative(ROOT, OUTPUT_INTEREST_PATH)} (${interests.length} records)`);
  console.log(`- Canonical Browse interests: ${canonicalInterests.length}`);
  console.log(`- Duplicate source rows merged: ${interests.length - canonicalInterests.length}`);
  console.log(`- Current MLA API rows: ${currentAssemblyInterests.length}`);
  console.log(`- Historical MLA HTML rows: ${historicalAssemblyInterests.length}`);
  console.log(`- Historical MLA PDF rows: ${historicalAssemblyPdfInterests.length}`);
  console.log(`- NI MP rows: ${mpInterests.length}`);
}

function buildSourceRecords(inventory, inventoryRecords, sourceIdByInventoryUrl) {
  const records = [];
  records.push(compactObject({
    id: 'ni-register:assembly:collection',
    slug: 'ni-register-assembly-collection',
    type: 'register-source-collection',
    title: 'Northern Ireland Assembly Register of Members Interests',
    subtitle: `${inventoryRecords.length} scraped source records`,
    category: 'Registers of interests',
    date: null,
    provider: ['Northern Ireland Assembly'],
    description: 'Public current and archived Northern Ireland Assembly register of interests pages, HTML editions, PDF editions, and machine-readable API payloads.',
    url: START_PAGES.current,
    references: [
      { label: 'Current NI Assembly register page', url: START_PAGES.current },
      { label: 'Archived NI Assembly register page', url: START_PAGES.archive }
    ],
    downloads: [
      { label: 'Structured NI register interest data', url: STRUCTURED_DATA_URL, type: 'json' }
    ],
    keywords: ['register of interests', 'MLA', 'Northern Ireland Assembly', 'standards', 'transparency'],
    sourceHierarchy: ['Browse', 'Registers of interests', 'Northern Ireland Assembly'],
    status: 'Structured',
    statusChips: ['Source inventory', 'Structured current API', 'Historical HTML parsed'],
    sourceItems: [
      {
        kind: 'scrape-inventory',
        sourceCount: inventoryRecords.length,
        htmlCount: inventory.byKind?.html || 0,
        pdfCount: inventory.byKind?.pdf || 0,
        jsonCount: inventory.byKind?.json || 0,
        xmlCount: inventory.byKind?.xml || 0,
        downloadedBytes: inventory.downloadedBytes || null
      }
    ]
  }));

  for (const record of inventoryRecords) {
    const source = assemblyInventorySourceRecord(record);
    records.push(source);
    sourceIdByInventoryUrl.set(record.url, source.id);
    sourceIdByInventoryUrl.set(record.finalUrl || record.url, source.id);
  }

  records.push(compactObject({
    id: 'ni-register:mp:collection',
    slug: 'ni-register-mp-collection',
    type: 'register-source-collection',
    title: 'Northern Ireland MPs register of interests extracts',
    subtitle: `${MP_EXTRACTS.length} supplied CSV extracts filtered to NI MPs`,
    category: 'Registers of interests',
    provider: ['UK Parliament', 'TheyWorkForYou/Public Whip derived identifiers'],
    description: 'Filtered extracts from the supplied Westminster register CSV files, retaining only MPs matched to Northern Ireland House of Commons constituencies.',
    references: [
      { label: 'Structured NI register interest data', url: STRUCTURED_DATA_URL }
    ],
    downloads: [
      { label: 'Structured NI register interest data', url: STRUCTURED_DATA_URL, type: 'json' }
    ],
    keywords: ['register of interests', 'MP', 'Northern Ireland', 'House of Commons', 'Westminster'],
    sourceHierarchy: ['Browse', 'Registers of interests', 'Northern Ireland MPs'],
    status: 'Structured',
    statusChips: ['CSV filtered', 'NI MPs only'],
    sourceItems: MP_EXTRACTS.map((extract) => {
      const summary = existsSync(extract.summaryPath) ? readJson(extract.summaryPath) : {};
      return compactObject({
        id: extract.id,
        sourceFile: extract.sourceFile,
        filteredRows: summary.filteredRows,
        matchedNiMembersInCsv: summary.matchedNiMembersInCsv,
        totalCsvRows: summary.totalCsvRows
      });
    })
  }));

  for (const extract of MP_EXTRACTS) {
    const summary = existsSync(extract.summaryPath) ? readJson(extract.summaryPath) : {};
    records.push(compactObject({
      id: `ni-register:mp:${extract.id}`,
      slug: `ni-register-mp-${slugify(extract.id)}`,
      type: 'register-source-dataset',
      title: extract.title,
      subtitle: compactJoin([extract.sourceFile, summary.filteredRows ? `${summary.filteredRows} NI-only rows` : null]),
      category: 'Registers of interests',
      provider: ['UK Parliament', 'TheyWorkForYou/Public Whip derived identifiers'],
      description: 'A generated NI-only extract from a supplied Westminster register of interests CSV. England, Scotland, and Wales MPs are excluded by matching member names to local Northern Ireland Westminster election winners.',
      references: [
        { label: 'Structured NI register interest data', url: STRUCTURED_DATA_URL }
      ],
      downloads: [
        { label: 'Structured NI register interest data', url: STRUCTURED_DATA_URL, type: 'json' }
      ],
      keywords: ['register of interests', 'MP', 'Northern Ireland', 'CSV extract'],
      sourceHierarchy: ['Browse', 'Registers of interests', 'Northern Ireland MPs', extract.sourceFile],
      status: 'Structured',
      statusChips: ['CSV filtered', 'NI MPs only'],
      sourceItems: [
        compactObject({
          id: extract.id,
          sourceFile: extract.sourceFile,
          totalCsvRows: summary.totalCsvRows,
          matchedNiMembersInCsv: summary.matchedNiMembersInCsv,
          filteredRows: summary.filteredRows,
          declarationDateStart: summary.members ? minString(summary.members.map((member) => member.earliest_declaration)) : null,
          declarationDateEnd: summary.members ? maxString(summary.members.map((member) => member.latest_declaration)) : null,
          filterBasis: 'Matched to Northern Ireland Westminster election winners from local election result bundles.'
        })
      ]
    }));
  }

  return records.sort(sortByTitle);
}

function writeInterestShards(interests) {
  rmSync(OUTPUT_INTEREST_SHARD_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_INTEREST_SHARD_DIR, { recursive: true });
  const shards = [];
  for (let index = 0; index < interests.length; index += INTEREST_SHARD_SIZE) {
    const shardIndex = Math.floor(index / INTEREST_SHARD_SIZE);
    const shardName = `ni-register-interests-${String(shardIndex).padStart(3, '0')}.json`;
    const shardItems = interests.slice(index, index + INTEREST_SHARD_SIZE);
    writeJson(path.join(OUTPUT_INTEREST_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'ni-register-interests',
      shard: shardName,
      total: shardItems.length,
      interests: shardItems
    });
    shards.push({
      name: shardName,
      url: `/data/database/ni-register-interests/${shardName}`,
      count: shardItems.length
    });
  }
  return shards;
}

function writeCanonicalInterestShards(interests) {
  rmSync(OUTPUT_CANONICAL_INTEREST_SHARD_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_CANONICAL_INTEREST_SHARD_DIR, { recursive: true });
  const shards = [];
  for (let index = 0; index < interests.length; index += INTEREST_SHARD_SIZE) {
    const shardIndex = Math.floor(index / INTEREST_SHARD_SIZE);
    const shardName = `ni-register-canonical-interests-${String(shardIndex).padStart(3, '0')}.json`;
    const shardItems = interests.slice(index, index + INTEREST_SHARD_SIZE);
    writeJson(path.join(OUTPUT_CANONICAL_INTEREST_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'ni-register-canonical-interests',
      shard: shardName,
      total: shardItems.length,
      interests: shardItems
    });
    shards.push({
      name: shardName,
      url: `/data/database/ni-register-canonical-interests/${shardName}`,
      count: shardItems.length
    });
  }
  return shards;
}

function buildCanonicalInterests(sourceRows) {
  const groups = new Map();
  for (const row of sourceRows) {
    const key = canonicalInterestKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const sortedRows = [...rows].sort(sortSourceRowsForCanonical);
    const representative = sortedRows[0];
    const sourceRefs = sortedRows.map(canonicalSourceRef);
    const dates = uniqueCleanStrings(sourceRefs.map((ref) => ref.date || ref.editionDate));
    const sourceKinds = uniqueCleanStrings(sourceRefs.map((ref) => ref.sourceKind));
    const sourceRecordIds = uniqueCleanStrings(sourceRefs.map((ref) => ref.sourceRecordId));
    const sourceTitles = uniqueCleanStrings(sourceRefs.map((ref) => ref.sourceTitle));
    const sourceUrls = uniqueCleanStrings(sourceRefs.map((ref) => ref.sourceUrl));
    const category = representative.category;
    const memberName = representative.memberName;
    const dateStart = minString(dates);
    const dateEnd = maxString(dates);
    return compactObject({
      id: `ni-register-canonical-interest:${shortHash(key)}`,
      type: 'register-interest',
      canonicalKey: key,
      chamber: representative.chamber,
      memberType: representative.memberType,
      jurisdiction: representative.jurisdiction,
      memberId: representative.memberId,
      publicWhipId: representative.publicWhipId,
      memberName,
      constituency: representative.constituency || normalizeArray(representative.constituencies)[0] || null,
      constituencies: uniqueCleanStrings(sortedRows.flatMap((row) => normalizeArray(row.constituencies || row.constituency))),
      parties: uniqueCleanStrings(sortedRows.flatMap((row) => normalizeArray(row.parties))),
      categoryId: representative.categoryId,
      category,
      interestText: representative.interestText,
      isNone: sortedRows.every((row) => row.isNone),
      date: dateEnd || representative.date,
      dateStart,
      dateEnd,
      sourceCount: sourceRefs.length,
      duplicateSourceRowCount: Math.max(0, sourceRefs.length - 1),
      sourceKinds,
      sourceRecordIds,
      sourceTitles,
      sourceUrls,
      sourceRefs,
      sourceRowIds: sourceRefs.map((ref) => ref.sourceRowId),
      provider: uniqueCleanStrings(sortedRows.flatMap((row) => normalizeArray(row.provider))),
      extractionConfidence: sourceRefs.some((ref) => ref.extractionConfidence === 'high') ? 'high' : 'medium',
      extractionMethod: 'canonical-deduplication',
      keywords: uniqueCleanStrings(sortedRows.flatMap((row) => normalizeArray(row.keywords))).slice(0, 24)
    });
  });
}

function canonicalInterestKey(row) {
  return [
    row.memberType || '',
    row.jurisdiction || '',
    canonicalMemberName(row.memberName),
    canonicalCategory(row.category),
    canonicalInterestText(row.interestText)
  ].join('|');
}

function canonicalMemberName(value) {
  return normalizeKey(value)
    .replace(/^(dr|mr|mrs|ms|miss|sir|dame)\s+/, '')
    .replace(/\s+(obe|mbe|cbe|qpm|kc|pc|mla|mp)$/, '')
    .trim();
}

function canonicalCategory(value) {
  return normalizeKey(value)
    .replace(/\binterests\b/g, 'interest')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalInterestText(value) {
  return normalizeKey(value)
    .replace(/\bnone registered \d{1,2} [a-z]+ \d{4}\b/g, 'none')
    .replace(/\bnone\b\.?/g, 'none')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortSourceRowsForCanonical(a, b) {
  return sourceKindPriority(a.sourceKind) - sourceKindPriority(b.sourceKind)
    || String(b.date || '').localeCompare(String(a.date || ''))
    || String(a.sourceTitle || '').localeCompare(String(b.sourceTitle || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function sourceKindPriority(kind) {
  if (kind === 'current-provider-json-api') return 0;
  if (kind === 'historical-pdf-register') return 1;
  if (kind === 'historical-html-register') return 2;
  if (kind === 'filtered-westminster-csv') return 3;
  return 9;
}

function canonicalSourceRef(row) {
  return compactObject({
    sourceRowId: row.id,
    sourceKind: row.sourceKind,
    sourceRecordId: row.sourceRecordId,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    date: row.date,
    editionDate: row.editionDate,
    startDate: row.startDate,
    earliestDeclaration: row.earliestDeclaration,
    latestDeclaration: row.latestDeclaration,
    sourcePageStart: row.sourcePageStart,
    sourcePageEnd: row.sourcePageEnd,
    extractionMethod: row.extractionMethod,
    extractionConfidence: row.extractionConfidence,
    sourceExtractIds: normalizeArray(row.sourceExtractIds)
  });
}

function assemblyInventorySourceRecord(record) {
  const date = inferAssemblyRecordDate(record);
  const dateLabel = date ? humanDate(date) : null;
  const format = record.kind === 'landing-html' ? 'landing page' : record.kind;
  const title = assemblySourceTitle(record, dateLabel);
  const id = `ni-register:assembly:${record.kind}:${shortHash(record.finalUrl || record.url)}`;
  return compactObject({
    id,
    slug: `ni-register-assembly-${slugify(record.kind)}-${slugify(title).slice(0, 80)}-${shortHash(id).slice(0, 8)}`,
    type: record.kind === 'json' || record.kind === 'xml' ? 'register-source-dataset' : 'register-source-document',
    title,
    subtitle: compactJoin([record.sourcePageId === 'archive' ? 'Archive' : 'Current', format, dateLabel]),
    category: 'Registers of interests',
    date,
    provider: ['Northern Ireland Assembly'],
    description: compactJoin([
      `NI Assembly register of interests ${format}`,
      dateLabel ? `edition dated ${dateLabel}` : null,
      record.contentType ? `content type ${record.contentType}` : null
    ], '. '),
    url: record.finalUrl || record.url,
    references: [
      { label: record.sourcePageId === 'archive' ? 'Archive register landing page' : 'Current register landing page', url: record.sourcePageUrl || START_PAGES[record.sourcePageId] },
      { label: 'Provider source URL', url: record.finalUrl || record.url }
    ],
    downloads: [
      { label: `${record.kind || 'source'} source`, url: record.finalUrl || record.url, type: record.kind }
    ],
    keywords: ['register of interests', 'MLA', 'Northern Ireland Assembly', record.kind, record.sourcePageId],
    sourceHierarchy: ['Browse', 'Registers of interests', 'Northern Ireland Assembly', record.sourcePageId === 'archive' ? 'Archive' : 'Current'],
    status: record.ok ? 'Available' : 'Unavailable',
    statusChips: [record.kind, record.httpStatus ? `HTTP ${record.httpStatus}` : null, record.sourcePageId],
    parentId: 'ni-register:assembly:collection',
    parentTitle: 'Northern Ireland Assembly Register of Members Interests',
    sourceItems: [
      compactObject({
        sourcePageId: record.sourcePageId,
        sourcePageUrl: record.sourcePageUrl,
        title: record.title,
        linkText: record.linkText,
        kind: record.kind,
        contentType: record.contentType,
        httpStatus: record.httpStatus,
        bytes: record.bytes,
        sha256: record.sha256,
        lastModified: record.lastModified,
        providerUrl: record.finalUrl || record.url
      })
    ]
  });
}

function assemblySourceTitle(record, dateLabel) {
  const url = record.finalUrl || record.url || '';
  if (/GetAllRegisteredInterests_JSON/i.test(url)) return 'NI Assembly current registered interests JSON API';
  if (/GetAllRegisteredInterests_XML/i.test(url)) return 'NI Assembly current registered interests XML API';
  if (/GetAllRegisteredInterests_JSONP/i.test(url)) return 'NI Assembly current registered interests JSONP API';
  if (record.kind === 'landing-html') {
    return record.sourcePageId === 'archive'
      ? 'NI Assembly archive register landing page'
      : 'NI Assembly current register landing page';
  }
  if (dateLabel) return `NI Assembly Register of Members Interests (${dateLabel})`;
  const title = cleanText(record.title || record.linkText || '');
  if (title && !/^PDF\)?$/i.test(title)) return `NI Assembly ${title}`;
  return `NI Assembly register source ${shortHash(url)}`;
}

function buildCurrentAssemblyInterests(inventoryRecords, sourceIdByInventoryUrl) {
  const apiRecord = inventoryRecords.find((record) => /GetAllRegisteredInterests_JSON$/i.test(record.url || record.finalUrl || ''));
  if (!apiRecord) return [];
  const fullPath = path.join(ROOT, apiRecord.localPath || '');
  if (!existsSync(fullPath)) return [];
  const sourceRecordId = sourceIdByInventoryUrl.get(apiRecord.url) || sourceIdByInventoryUrl.get(apiRecord.finalUrl) || `ni-register:assembly:json:${shortHash(apiRecord.url)}`;
  const payload = readJson(fullPath);
  const rows = Array.isArray(payload)
    ? payload
    : normalizeArray(payload?.AllRegisteredInterests?.RegisteredInterest || payload?.RegisteredInterest || payload?.items);
  return normalizeArray(rows).map((row, index) => {
    const interestText = cleanText(row.RegisterEntry || row.registerEntry || '');
    const category = cleanText(row.RegisterCategory || row.registerCategory || 'Uncategorised');
    const memberName = cleanText(row.MemberName || row.memberName || '');
    const startDate = isoDateOnly(row.RegisterEntryStartDate || row.registerEntryStartDate);
    return compactObject({
      id: `ni-register-interest:mla-current:${shortHash(`${row.PersonId}|${row.RegisterCategoryId}|${startDate}|${interestText}|${index}`)}`,
      type: 'register-interest',
      chamber: 'Northern Ireland Assembly',
      memberType: 'MLA',
      jurisdiction: 'Northern Ireland',
      memberId: row.PersonId ? String(row.PersonId) : null,
      memberName,
      categoryId: row.RegisterCategoryId ? String(row.RegisterCategoryId) : null,
      category,
      interestText,
      isNone: isNoneEntry(interestText),
      date: startDate,
      startDate,
      provider: ['Northern Ireland Assembly'],
      sourceKind: 'current-provider-json-api',
      sourceRecordId,
      sourceTitle: 'NI Assembly current registered interests JSON API',
      sourceUrl: apiRecord.finalUrl || apiRecord.url,
      extractionMethod: 'provider-json-api',
      extractionConfidence: 'high',
      keywords: ['register of interests', 'MLA', 'Northern Ireland Assembly', category, memberName]
    });
  });
}

function buildHistoricalAssemblyHtmlInterests(inventoryRecords, sourceIdByInventoryUrl) {
  const interests = [];
  const seen = new Set();
  const htmlRecords = inventoryRecords.filter((record) => {
    if (record.kind !== 'html') return false;
    const url = record.finalUrl || record.url || '';
    if (/aims\.niassembly\.gov\.uk|data\.niassembly\.gov\.uk/i.test(url)) return false;
    return /register/i.test(url) || /register/i.test(record.title || '') || /register/i.test(record.localPath || '');
  });

  for (const record of htmlRecords) {
    const fullPath = path.join(ROOT, record.localPath || '');
    if (!existsSync(fullPath)) continue;
    const html = readFileSync(fullPath, 'utf8');
    const sourceRecordId = sourceIdByInventoryUrl.get(record.url) || sourceIdByInventoryUrl.get(record.finalUrl) || `ni-register:assembly:html:${shortHash(record.url)}`;
    const rows = extractAssemblyHtmlRows(html, record, sourceRecordId);
    for (const row of rows) {
      const key = [
        row.sourceRecordId,
        normalizeKey(row.memberName),
        normalizeKey(row.constituency),
        normalizeKey(row.category),
        normalizeKey(row.interestText)
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      interests.push(row);
    }
  }
  return interests;
}

function buildHistoricalAssemblyPdfInterests(inventoryRecords, sourceIdByInventoryUrl) {
  const interests = [];
  const seen = new Set();
  const pdfRecords = inventoryRecords.filter((record) => record.kind === 'pdf');
  for (const record of pdfRecords) {
    const fullPath = path.join(ROOT, record.localPath || '');
    if (!existsSync(fullPath)) continue;
    const sourceRecordId = sourceIdByInventoryUrl.get(record.url) || sourceIdByInventoryUrl.get(record.finalUrl) || `ni-register:assembly:pdf:${shortHash(record.url)}`;
    const pages = extractPdfPages(fullPath);
    const rows = extractAssemblyPdfRows(pages, record, sourceRecordId);
    for (const row of rows) {
      const key = [
        row.sourceRecordId,
        normalizeKey(row.memberName),
        normalizeKey(row.constituency),
        normalizeKey(row.category),
        normalizeKey(row.interestText)
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      interests.push(row);
    }
  }
  return interests;
}

function extractAssemblyPdfRows(pages, record, sourceRecordId) {
  const editionDate = inferAssemblyRecordDate(record) || isoDateFromPdfPages(pages);
  const dateLabel = editionDate ? humanDate(editionDate) : null;
  const sourceTitle = assemblySourceTitle(record, dateLabel);
  const lines = pdfLines(pages, editionDate);
  const rows = [];
  const seenLocal = new Set();
  let currentMember = null;
  let currentCategory = null;
  let currentCategoryNumber = null;
  let currentTexts = [];
  let currentPageStart = null;
  let currentPageEnd = null;
  let sequence = 0;

  const flush = () => {
    if (!currentMember || !currentCategory) {
      currentTexts = [];
      currentPageStart = null;
      currentPageEnd = null;
      return;
    }
    const body = cleanText(currentTexts.join(' '))
      .replace(/\bN one\b/g, 'None')
    .replace(/\bMem ber\b/g, 'Member')
    .replace(/\bResid ential\b/g, 'Residential');
    const inferredEmptyCategory = !body;
    const interestText = inferredEmptyCategory ? PDF_EMPTY_INTEREST_TEXT : body;
    currentTexts = [];
    if (!interestText || isNavigationText(interestText)) return;
    const key = `${currentMember.memberName}|${currentMember.constituency || ''}|${currentCategory}|${interestText}|${currentPageStart || ''}`;
    if (seenLocal.has(key)) return;
    seenLocal.add(key);
    sequence += 1;
    rows.push(compactObject({
      id: `ni-register-interest:mla-pdf:${shortHash(`${sourceRecordId}|${key}|${sequence}`)}`,
      type: 'register-interest',
      chamber: 'Northern Ireland Assembly',
      memberType: 'MLA',
      jurisdiction: 'Northern Ireland',
      memberName: currentMember.memberName,
      memberHeading: currentMember.heading,
      constituency: currentMember.constituency,
      category: currentCategory,
      categoryNumber: currentCategoryNumber,
      interestText,
      isNone: inferredEmptyCategory || isNoneEntry(interestText),
      inferredEmptyCategory,
      date: editionDate,
      editionDate,
      provider: ['Northern Ireland Assembly'],
      sourceKind: 'historical-pdf-register',
      sourceRecordId,
      sourceTitle,
      sourceUrl: record.finalUrl || record.url,
      sourcePageStart: currentPageStart,
      sourcePageEnd: currentPageEnd,
      extractionMethod: 'pdf-text-heading-parser',
      extractionConfidence: 'medium',
      keywords: ['register of interests', 'MLA', 'Northern Ireland Assembly', currentCategory, currentMember.memberName, currentMember.constituency, 'PDF']
    }));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const item = lines[index];
    const text = item.text;
    const member = parseMemberHeading({ tag: 'h2' }, text);
    if (member) {
      flush();
      currentMember = member;
      currentCategory = null;
      currentCategoryNumber = null;
      continue;
    }
    const category = parsePdfCategoryHeading(lines, index);
    if (currentMember && category) {
      flush();
      currentCategory = category.category;
      currentCategoryNumber = category.number;
      currentPageStart = item.page;
      currentPageEnd = item.page;
      index += category.consumed;
      continue;
    }
    if (currentMember && currentCategory) {
      currentTexts.push(text);
      currentPageEnd = item.page;
      if (!currentPageStart) currentPageStart = item.page;
    }
  }
  flush();
  return rows;
}

function pdfLines(pages, editionDate) {
  const lines = [];
  for (const page of normalizeArray(pages)) {
    const pageNumber = Number(page.page);
    const rawLines = String(page.text || '').split(/\r?\n/);
    for (const rawLine of rawLines) {
      const text = cleanPdfLine(rawLine);
      if (!text || isPdfBoilerplateLine(text, editionDate)) continue;
      lines.push({ page: pageNumber, text });
    }
  }
  return lines;
}

function cleanPdfLine(value) {
  return cleanText(String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\bpr ofession\b/gi, 'profession')
    .replace(/\ba nd\b/gi, 'and')
    .replace(/\bDonat ions\b/gi, 'Donations')
    .replace(/\bam ount\b/gi, 'amount')
    .replace(/\baverag e\b/gi, 'average')
    .replace(/\bregist er\b/gi, 'register'));
}

function isPdfBoilerplateLine(text, editionDate) {
  const normalized = cleanText(text);
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^parsing for Object Streams$/i.test(normalized)) return true;
  if (/^Register of Members[?'’] Interests(?:\s*[?-]\s*(?:Sixth|First|Second|Third|Fourth|Fifth|Seventh|Eighth|Ninth|Tenth) Edition)?$/i.test(normalized)) return true;
  if (/^Register of Members' Interests$/i.test(normalized)) return true;
  if (/^(Sixth|First|Second|Third|Fourth|Fifth|Seventh|Eighth|Ninth|Tenth) Edition$/i.test(normalized)) return true;
  if (/^SESSION\s+\d{4}\/\d{4}$/i.test(normalized)) return true;
  if (/^Ordered by The Committee on Standards and Privileges/i.test(normalized)) return true;
  if (/^Report:\s*NIA/i.test(normalized)) return true;
  if (/^PUBLISHED BY AUTHORITY/i.test(normalized)) return true;
  if (/^BELFAST:/i.test(normalized)) return true;
  if (/^This document is available/i.test(normalized)) return true;
  if (/^For more information please contact/i.test(normalized)) return true;
  if (/^Northern Ireland Assembly, Printed Paper Office/i.test(normalized)) return true;
  if (/^Tel:\s*/i.test(normalized)) return true;
  if (/^Session\s+\d{4}\/\d{4}$/i.test(normalized)) return true;
  if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(normalized)) return true;
  if (editionDate && normalized === humanDate(editionDate)) return true;
  return false;
}

function parsePdfCategoryHeading(lines, index) {
  const text = lines[index]?.text || '';
  const match = text.match(/^(\d{1,2})\.\s*(.*)$/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 1 || number > 12) return null;
  let category = cleanText(match[2] || '');
  let consumed = 0;
  if (shouldJoinPdfCategoryContinuation(category) && lines[index + 1]) {
    const next = lines[index + 1].text;
    if (!parseMemberHeading({ tag: 'h2' }, next) && !/^(\d{1,2})\.\s*/.test(next)) {
      category = cleanText(`${category} ${next}`);
      consumed = 1;
    }
  }
  const knownCategory = normalizePdfKnownCategory(category, number);
  if (!knownCategory) return null;
  return {
    number,
    category: knownCategory,
    consumed
  };
}

function normalizePdfKnownCategory(category, number) {
  const value = normalizeCategory(category)
    .replace(/\bDonat ions\b/gi, 'Donations')
    .replace(/[�]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
  const tests = [
    [1, /^Directorships$/i, 'Directorships'],
    [1, /^Employment and Earnings$/i, 'Employment and Earnings'],
    [2, /^Remunerated employment,\s*office,\s*profession,\s*etc$/i, 'Remunerated Employment, Office, Profession, etc'],
    [2, /^Donations and other support$/i, 'Donations and other support'],
    [3, /^Elected\/Public Office$/i, 'Elected/Public Office'],
    [3, /^Gifts,\s*benefits and hospitality(?:\s*\(UK\))?$/i, 'Gifts, benefits and hospitality'],
    [4, /^Electoral Support and Political Donations$/i, 'Electoral Support and Political Donations'],
    [4, /^Visits$/i, 'Visits'],
    [5, /^Gifts,\s*Benefits and Hospitality\s*\(UK\)$/i, 'Gifts, benefits and hospitality (UK)'],
    [5, /^Shareholdings$/i, 'Shareholdings'],
    [6, /^Overseas Visits$/i, 'Overseas visits'],
    [6, /^Land and Property$/i, 'Land and Property'],
    [7, /^Overseas Benefits and Gifts$/i, 'Overseas benefits and gifts'],
    [7, /^Miscellaneous(?: Interests)?$/i, 'Miscellaneous'],
    [8, /^Land and property$/i, 'Land and Property'],
    [8, /^Unremunerated interests$/i, 'Unremunerated interests'],
    [9, /^Shareholdings$/i, 'Shareholdings'],
    [9, /^Family members who benefit from Office Cost Expenditure$/i, 'Family members who benefit from Office Cost Expenditure'],
    [10, /^Miscellaneous(?: Interests)?$/i, 'Miscellaneous Interests'],
    [11, /^Unremunerated Interests$/i, 'Unremunerated Interests'],
    [12, /^Family Members who benefit from Assembly Members['?] Allowances$/i, "Family members who benefit from Assembly Members' Allowances"]
  ];
  const match = tests.find(([expectedNumber, pattern]) => expectedNumber === number && pattern.test(value));
  return match ? match[2] : null;
}

function shouldJoinPdfCategoryContinuation(category) {
  if (!category) return true;
  if (isLikelyCategory(category) && !/\b(from|of|and|with|who|Donat|Expenditure)$/i.test(category)) return false;
  if (/\bDonat$/i.test(category)) return true;
  if (/\b(from|of|and|with|who|Office Cost)$/i.test(category)) return true;
  if (category.length < 12 && !isLikelyCategory(category)) return true;
  return false;
}

function extractPdfPages(fullPath) {
  const python = findPythonWithPypdf();
  const result = spawnSync(python, [PDF_TEXT_SCRIPT, fullPath], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PDF text extraction failed for ${path.relative(ROOT, fullPath)}: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return normalizeArray(parsed.pages);
}

var cachedPythonWithPypdf = null;
function findPythonWithPypdf() {
  if (cachedPythonWithPypdf) return cachedPythonWithPypdf;
  const candidates = uniqueCleanStrings([
    process.env.CIVGRAPH_PYTHON,
    process.env.PYTHON,
    'python',
    'python3'
  ]);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import pypdf'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (result.status === 0) {
      cachedPythonWithPypdf = candidate;
      return candidate;
    }
  }
  throw new Error('Python with the pypdf package is required to extract NI Assembly register PDF text. Set CIVGRAPH_PYTHON to a suitable Python executable.');
}

function isoDateFromPdfPages(pages) {
  const text = normalizeArray(pages).slice(0, 4).map((page) => page.text).join(' ');
  return isoDateFromText(text);
}

function extractAssemblyHtmlRows(html, record, sourceRecordId) {
  const tokens = tokenizeHtml(html);
  const titleToken = tokens.find((token) => token.tag === 'h1')?.text || record.title || '';
  const editionDate = inferAssemblyRecordDate(record) || isoDateFromText(titleToken);
  const rows = [];
  const seenLocal = new Set();
  let currentMember = null;
  let currentCategory = null;
  let currentTexts = [];
  let categorySequence = 0;

  const flush = () => {
    if (!currentMember || !currentCategory) {
      currentTexts = [];
      return;
    }
    const interestText = cleanText(currentTexts.join(' '));
    currentTexts = [];
    if (!interestText || isNavigationText(interestText)) return;
    const key = `${currentMember.memberName}|${currentMember.constituency || ''}|${currentCategory}|${interestText}`;
    if (seenLocal.has(key)) return;
    seenLocal.add(key);
    categorySequence += 1;
    rows.push(compactObject({
      id: `ni-register-interest:mla-html:${shortHash(`${sourceRecordId}|${key}|${categorySequence}`)}`,
      type: 'register-interest',
      chamber: 'Northern Ireland Assembly',
      memberType: 'MLA',
      jurisdiction: 'Northern Ireland',
      memberName: currentMember.memberName,
      memberHeading: currentMember.heading,
      constituency: currentMember.constituency,
      category: currentCategory,
      interestText,
      isNone: isNoneEntry(interestText),
      date: editionDate,
      editionDate,
      provider: ['Northern Ireland Assembly'],
      sourceKind: 'historical-html-register',
      sourceRecordId,
      sourceTitle: assemblySourceTitle(record, editionDate ? humanDate(editionDate) : null),
      sourceUrl: record.finalUrl || record.url,
      extractionMethod: 'html-heading-parser',
      extractionConfidence: 'medium',
      keywords: ['register of interests', 'MLA', 'Northern Ireland Assembly', currentCategory, currentMember.memberName, currentMember.constituency]
    }));
  };

  for (const token of tokens) {
    const text = cleanText(token.text);
    if (!text || isNavigationText(text)) continue;
    const member = parseMemberHeading(token, text);
    if (member) {
      flush();
      currentMember = member;
      currentCategory = null;
      continue;
    }
    if (currentMember && isCategoryToken(token, text)) {
      flush();
      currentCategory = normalizeCategory(text);
      continue;
    }
    if (currentMember && currentCategory && isBodyToken(token, text)) {
      currentTexts.push(text);
    }
  }
  flush();
  return rows;
}

function tokenizeHtml(html) {
  const cleanedHtml = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const tokens = [];
  const blockRe = /<(h[1-6]|p|li|blockquote|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(cleanedHtml))) {
    const tag = match[1].toLowerCase();
    const text = cleanHtmlText(match[2]);
    if (text) tokens.push({ tag, text });
  }
  return tokens;
}

function cleanHtmlText(value) {
  return cleanText(decodeEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function parseMemberHeading(token, text) {
  let value = cleanText(text)
    .replace(/\bMLA\b\.?/gi, '')
    .replace(/\bMP\b\.?/gi, '')
    .replace(/\s+-\s+Register.*$/i, '')
    .trim();
  if (!value || !value.includes(',')) return null;
  if (value.length > 130) return null;
  const isHeadingTag = /^h[2-6]$/.test(token.tag || '');
  const hasConstituencySuffix = /\([A-Za-z][^)]{2,60}\)\s*$/.test(value);
  if (!isHeadingTag && !(token.tag === 'p' && hasConstituencySuffix)) return null;
  if (isLikelyCategory(value) || /^category\s+\d/i.test(value)) return null;
  const match = value.match(/^([A-Za-z][A-Za-z.'`\- ]{1,60}),\s*([^()]{1,80}?)(?:\s*\(([^)]+)\))?$/);
  if (!match) return null;
  const surname = cleanText(match[1]);
  const given = cleanText(match[2]);
  if (!surname || !given) return null;
  if (/^\d/.test(given)) return null;
  if (uppercaseRatio(surname) < 0.55) return null;
  if (/\b(register|interest|directorship|employment|office|land|shareholding|miscellaneous|visit|gift|donation|client|sponsorship)\b/i.test(`${surname} ${given}`)) return null;
  return compactObject({
    memberName: titleCaseName(`${given} ${surname}`),
    heading: value,
    constituency: match[3] ? cleanText(match[3]) : null
  });
}

function isCategoryToken(token, text) {
  if (!text || /^\d+\.?$/.test(text)) return false;
  if (/^(back to top|register of|members|member|contents|category|categories|purpose|form|advocacy|complaints|general|find mlas|accessibility|contact us|copyright|news|events|committees|assembly business)$/i.test(text)) return false;
  if (/^appendix\b/i.test(text)) return false;
  return Boolean(normalizeKnownAssemblyCategory(text));
}

function isLikelyCategory(text) {
  const normalized = cleanText(text).replace(/^\d+[.)]?\s*/, '');
  return /(directorship|employment|earnings|office|profession|trade|vocation|land|property|shareholding|shareholdings|miscellaneous|unremunerated|gift|benefit|hospitality|visit|overseas|client|services|sponsorship|donation|support|family|lobby|all-party|nil return|assembly allowance|travel|financial|remunerated|public funds|contracts|interests)/i.test(normalized);
}

function normalizeCategory(text) {
  return normalizeKnownAssemblyCategory(text) || cleanText(text)
    .replace(/^\d+[.)]?\s*/, '')
    .replace(/^[a-z][.)]\s*/i, '')
    .replace(/\s+for\s+which\s+remuneration\s+is\s+received/ig, ' for which remuneration is received');
}

function normalizeKnownAssemblyCategory(text) {
  const value = cleanText(text)
    .replace(/^\d+[.)]?\s*/, '')
    .replace(/^[a-z][.)]\s*/i, '')
    .replace(/\bDonat ions\b/gi, 'Donations')
    .replace(/[�]/g, "'")
    .replace(/[.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const patterns = [
    [/^Directorships$/i, 'Directorships'],
    [/^Employment and Earnings$/i, 'Employment and Earnings'],
    [/^Remunerated employment,\s*office,\s*profession,\s*etc$/i, 'Remunerated Employment, Office, Profession, etc'],
    [/^Donations and other support$/i, 'Donations and other support'],
    [/^Elected\/Public Office$/i, 'Elected/Public Office'],
    [/^Gifts,\s*benefits and hospitality(?:\s*\(UK\))?$/i, /UK/i.test(value) ? 'Gifts, benefits and hospitality (UK)' : 'Gifts, benefits and hospitality'],
    [/^Electoral Support and Political Donations$/i, 'Electoral Support and Political Donations'],
    [/^Visits$/i, 'Visits'],
    [/^Shareholdings$/i, 'Shareholdings'],
    [/^Land and Property$/i, 'Land and Property'],
    [/^Overseas Visits$/i, 'Overseas visits'],
    [/^Overseas Benefits and Gifts$/i, 'Overseas benefits and gifts'],
    [/^Miscellaneous(?: Interests)?$/i, /Interests/i.test(value) ? 'Miscellaneous Interests' : 'Miscellaneous'],
    [/^Unremunerated interests$/i, 'Unremunerated interests'],
    [/^Family members who benefit from Office Cost Expenditure$/i, 'Family members who benefit from Office Cost Expenditure'],
    [/^Family Members who benefit from Assembly Members['?] Allowances$/i, "Family members who benefit from Assembly Members' Allowances"]
  ];
  const match = patterns.find(([pattern]) => pattern.test(value));
  return match ? match[1] : null;
}

function isBodyToken(token, text) {
  if (!text || isNavigationText(text)) return false;
  if (token.tag && /^h[1-6]$/.test(token.tag)) return false;
  if (/^\d+\.?$/.test(text)) return false;
  return true;
}

function isNavigationText(text) {
  return /^(back to top|top|home|email|print this page|register of interests|members' register of interests)$/i.test(cleanText(text));
}

function buildMpInterests() {
  const byKey = new Map();
  for (const extract of MP_EXTRACTS) {
    if (!existsSync(extract.path)) {
      throw new Error(`Missing NI MP extract ${path.relative(ROOT, extract.path)}. Run the CSV extraction step before building this sidecar.`);
    }
    const rows = parseCsv(readFileSync(extract.path, 'utf8'));
    for (const row of rows) {
      const memberName = cleanText(row.member_name);
      const category = cleanText(row.category_name || 'Uncategorised');
      const interestText = cleanText(row.free_text);
      if (!memberName || !interestText) continue;
      const key = [
        normalizeKey(row.public_whip_id),
        normalizeKey(memberName),
        normalizeKey(category),
        normalizeKey(interestText),
        row.earliest_declaration || '',
        row.latest_declaration || ''
      ].join('|');
      const existing = byKey.get(key);
      const sourceExtract = compactObject({
        id: extract.id,
        sourceFile: extract.sourceFile,
        title: extract.title
      });
      if (existing) {
        existing.sourceExtracts.push(sourceExtract);
        existing.sourceExtractIds = uniqueCleanStrings(existing.sourceExtracts.map((item) => item.id));
        continue;
      }
      byKey.set(key, compactObject({
        id: `ni-register-interest:mp:${shortHash(key)}`,
        type: 'register-interest',
        chamber: 'House of Commons of the United Kingdom',
        memberType: 'MP',
        jurisdiction: 'Northern Ireland',
        publicWhipId: cleanText(row.public_whip_id),
        memberName,
        category,
        interestText,
        isNone: isNoneEntry(interestText),
        date: row.latest_declaration || row.earliest_declaration || null,
        earliestDeclaration: row.earliest_declaration || null,
        latestDeclaration: row.latest_declaration || null,
        newInLatest: parseBoolean(row.new_in_latest),
        declaredInLatest: parseBoolean(row.declared_in_latest),
        extractedOrganisations: splitList(row.extracted_orgs),
        extractedSum: cleanText(row.extracted_sum) || null,
        constituencies: splitList(row.ni_constituencies),
        electionDates: splitList(row.ni_election_dates),
        parties: splitList(row.ni_parties),
        filterBasis: cleanText(row.ni_filter_basis),
        provider: ['UK Parliament', 'TheyWorkForYou/Public Whip derived identifiers'],
        sourceKind: 'filtered-westminster-csv',
        sourceRecordId: `ni-register:mp:${extract.id}`,
        sourceTitle: extract.title,
        extractionMethod: 'ni-mp-csv-name-match',
        extractionConfidence: 'high',
        sourceExtracts: [sourceExtract],
        sourceExtractIds: [extract.id],
        keywords: ['register of interests', 'MP', 'Northern Ireland', category, memberName]
      }));
    }
  }
  return [...byKey.values()];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else if (char !== '\r') {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows
    .filter((current) => current.some((cell) => String(cell || '').trim()))
    .map((current) => Object.fromEntries(headers.map((header, index) => [header, current[index] || ''])));
}

function inferAssemblyRecordDate(record) {
  const text = [record.title, record.linkText, record.url, record.finalUrl].filter(Boolean).join(' ');
  return isoDateFromText(text);
}

function isoDateFromText(value) {
  const text = cleanText(value);
  const namedMonth = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?[-\s]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-\s]+(\d{2,4})\b/i);
  if (namedMonth) return buildIsoDate(Number(namedMonth[1]), monthNumber(namedMonth[2]), Number(normalizeYear(namedMonth[3])));
  const compactDate = text.match(/\bregister[_-](\d{2})(\d{2})(\d{2})\b/i);
  if (compactDate) return buildIsoDate(Number(compactDate[1]), Number(compactDate[2]), Number(normalizeYear(compactDate[3])));
  const dashedDate = text.match(/\b(\d{1,2})[-_](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[-_](\d{2,4})\b/i);
  if (dashedDate) return buildIsoDate(Number(dashedDate[1]), monthNumber(dashedDate[2]), Number(normalizeYear(dashedDate[3])));
  return null;
}

function buildIsoDate(day, month, year) {
  if (!day || !month || !year) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeYear(value) {
  const year = Number(value);
  if (String(value).length === 2) return year >= 70 ? 1900 + year : 2000 + year;
  return year;
}

function monthNumber(value) {
  const key = String(value || '').slice(0, 3).toLowerCase();
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }[key] || null;
}

function humanDate(isoDate) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split('-').map(Number);
  const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1];
  return `${day} ${monthName} ${year}`;
}

function isoDateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    copy: '(c)',
    gt: '>',
    hellip: '...',
    laquo: '<<',
    ldquo: '"',
    lsquo: "'",
    nbsp: ' ',
    ndash: '-',
    pound: 'GBP',
    quot: '"',
    raquo: '>>',
    rdquo: '"',
    rsquo: "'"
  };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&([a-z]+);/gi, (match, name) => Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : match);
}

function titleCaseName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, char) => `Mc${char.toUpperCase()}`)
    .replace(/\bO'([a-z])/g, (_, char) => `O'${char.toUpperCase()}`)
    .replace(/\b(Mla|Mp|Obe|Mbe|Qpm|Kc|Pc)\b/g, (match) => match.toUpperCase());
}

function uppercaseRatio(value) {
  const letters = String(value || '').replace(/[^A-Za-z]/g, '');
  if (!letters) return 0;
  const uppercase = letters.replace(/[^A-Z]/g, '').length;
  return uppercase / letters.length;
}

function splitList(value) {
  return uniqueCleanStrings(String(value || '').split(';'));
}

function uniqueCleanStrings(values) {
  return [...new Set(normalizeArray(values).map(cleanText).filter(Boolean))];
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (/^true$/i.test(String(value || ''))) return true;
  if (/^false$/i.test(String(value || ''))) return false;
  return null;
}

function isNoneEntry(value) {
  return /^(none\.?|nil\.?|no registrable interests?\.?|no interests?\.?)$/i.test(cleanText(value).replace(/[;:]+$/, ''));
}

function sortInterests(a, b) {
  return String(a.memberName || '').localeCompare(String(b.memberName || ''))
    || String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.category || '').localeCompare(String(b.category || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function sortByTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function maxString(values) {
  const clean = uniqueCleanStrings(values);
  return clean.length ? clean.sort().at(-1) : null;
}

function minString(values) {
  const clean = uniqueCleanStrings(values);
  return clean.length ? clean.sort()[0] : null;
}

function compactJoin(parts, separator = ' / ') {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim()).map(cleanText).join(separator) || null;
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'item';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compactObject(object) {
  const output = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const nextText = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === nextText) return;
  writeFileSync(filePath, nextText);
}
