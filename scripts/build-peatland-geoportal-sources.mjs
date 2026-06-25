#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'tasks', 'peatland-geoportal-duplicate-review-2026-06-25.csv');
const OUTPUT = path.join(ROOT, 'data', 'database', 'peatland-geoportal-sources.json');

const PORTAL_URL = 'https://peatlands-geoportal-queensub.hub.arcgis.com/';
const ARCGIS_GROUP_ID = 'b5fdfbe3f6264c14a90afd43f8f51956';
const ARCGIS_SITE_ITEM_ID = '371041bb577e4e128de842f93b9476fa';
const GROUP_SEARCH_URL = `https://www.arcgis.com/sharing/rest/search?f=json&q=group:${ARCGIS_GROUP_ID}&num=100&sortField=title`;

const SOURCE_RECORD_ACTIONS = new Set([
  'source-context-record-not-map-layer',
  'source-document-record',
  'candidate-interactive-map-after-license-dedupe',
  'context-layer-review-before-conversion',
  'service-layer-review-raster-or-source-only',
  'metadata-review'
]);

main();

function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing Peatland Geoportal audit CSV: ${path.relative(ROOT, INPUT)}`);
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8')).map((row, index) => normalizeRow(row, index + 1));
  const sources = rows
    .filter((row) => SOURCE_RECORD_ACTIONS.has(row.recommendedAction) || isUnmatchedLikelyDuplicate(row))
    .map(toSourceRecord)
    .sort(sortByTitle);
  const targets = buildExistingRecordEnrichments(rows);
  const serviceDefinitionReview = rows
    .filter((row) => row.type === 'Service Definition')
    .map(toServiceDefinitionReview)
    .sort(sortByTitle);
  const candidateConversionReview = rows
    .filter((row) => row.recommendedAction === 'candidate-interactive-map-after-license-dedupe')
    .map(toCandidateReview)
    .sort(sortByTitle);
  const variantReview = rows
    .filter((row) => row.recommendedAction === 'possible-variant-review' || isNamedVariant(row))
    .map(toVariantReview)
    .sort(sortByTitle);
  const sacHabitatGroup = buildSacHabitatGroup(rows);
  const bestSourceReview = buildBestSourceReview(rows);
  const unmatchedLikelyDuplicateReview = rows
    .filter(isUnmatchedLikelyDuplicate)
    .map(toUnmatchedLikelyDuplicateReview)
    .sort(sortByTitle);
  const unresolvedAmbiguities = buildUnresolvedAmbiguities(rows, candidateConversionReview, variantReview);

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReviewCsv: 'tasks/peatland-geoportal-duplicate-review-2026-06-25.csv',
    sourcePortal: {
      title: 'Peatland Geoportal',
      provider: ['Queen\'s University Belfast', 'DAERA', 'ArcGIS Hub'],
      url: PORTAL_URL,
      arcgisGroupId: ARCGIS_GROUP_ID,
      arcgisSiteItemId: ARCGIS_SITE_ITEM_ID,
      arcgisGroupSearchUrl: GROUP_SEARCH_URL
    },
    policy: {
      application: 'metadata/provenance/source-page publication only',
      noGeometryIngestion: 'No feature geometries, source exports, ArcGIS attachments, or vector conversions are downloaded or materialised by this sidecar.',
      conversionGate: 'Peatland-specific vector Feature Services remain conversion candidates until licence/provenance and duplicate/variant review are approved.',
      sourcePageUse: 'Web Maps, StoryMaps, Hub pages, PDFs, Code Attachments, Feature Services, WFS/WMS endpoints, and Service Definitions are preserved as source context where useful.',
      duplicatePolicy: 'Likely duplicate rows enrich existing Civgraph source records instead of creating duplicate map parent records.',
      sacGrouping: 'DAERA/QUB SAC habitat maps are grouped under one proposed Peatland SAC Habitat Maps parent before any runtime map publication.'
    },
    summary: {
      totalArcgisItems: rows.length,
      sourceRecords: sources.length,
      existingRecordEnrichmentRows: targets.reduce((sum, target) => sum + target.sourceItems.length, 0),
      unmatchedLikelyDuplicateRows: unmatchedLikelyDuplicateReview.length,
      existingRecordEnrichmentTargets: targets.length,
      serviceDefinitionRows: serviceDefinitionReview.length,
      candidateConversionRows: candidateConversionReview.length,
      sacHabitatCandidates: sacHabitatGroup.children.length,
      variantReviewRows: variantReview.length,
      bestSourceGroups: bestSourceReview.length,
      sourceContextRows: rows.filter((row) => row.recommendedAction === 'source-context-record-not-map-layer').length,
      sourceDocumentRows: rows.filter((row) => row.recommendedAction === 'source-document-record').length,
      byType: countBy(rows, 'type'),
      byRecommendedAction: countBy(rows, 'recommendedAction'),
      byOwner: countBy(rows, 'owner')
    },
    findings: {
      metadataProvenanceValue: [
        'ArcGIS item metadata supplies item IDs, owners, access state, modified dates, tags, item pages, sibling items, Web Maps, StoryMaps, Web Apps, PDFs, Code Attachments, and portal grouping context that is not reliably present on bare FeatureServer endpoints.',
        'Feature Service endpoints are still the preferred conversion source when approved because they expose layer counts, geometry types, query/extract capabilities, and stable service URLs.',
        'Service Definition items are useful provenance/package evidence but are not preferred conversion sources when a sibling Feature Service or WFS exists.'
      ],
      licenceReview: [
        'Public ArcGIS access is not by itself a reuse licence. Rows tagged OpenDataNI/Open data are more likely to be reusable, but each conversion candidate still needs provider/licence confirmation before geometry ingestion.',
        'Source pages can cite public item metadata now; runtime map conversion remains gated until licence, duplicate, and variant checks are complete.'
      ],
      geometryInspection: [
        'Geometry inspection in this pass is metadata-only: service layer count, table count, geometry type, and capabilities harvested from service metadata. No features were queried or exported.',
        'Polygon Feature Services with Query/Extract are technically suitable conversion candidates once approved; WFS is useful as standards-based fallback or corroborating source; Service Definitions are package/provenance records.'
      ]
    },
    targets,
    sources,
    sourceDocumentRecords: sources.filter((source) => source.category === 'Peatland Geoportal source documents'),
    sourceContextRecords: sources.filter((source) => source.category === 'Peatland Geoportal context'),
    candidateSourceRecords: sources.filter((source) => source.category === 'Peatland Geoportal conversion candidates'),
    serviceDefinitionReview,
    candidateConversionReview,
    sacHabitatGroup,
    bestSourceReview,
    variantReview,
    unmatchedLikelyDuplicateReview,
    unresolvedAmbiguities
  };

  assertNoLocalPaths(output);
  assertNoGeometryPayloads(output);

  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${sources.length} source records, ${targets.length} enrichment targets, and ${candidateConversionReview.length} conversion-review rows.`);
}

function normalizeRow(row, rowNumber) {
  const title = cleanText(row.title);
  return {
    rowNumber,
    itemId: cleanText(row.itemId),
    title,
    normalizedTitle: normalizeTitle(title),
    type: cleanText(row.type),
    owner: cleanText(row.owner),
    access: cleanText(row.access),
    modified: cleanText(row.modified),
    topicClass: cleanText(row.topicClass),
    tags: splitList(row.tags, ';'),
    url: cleanText(row.url),
    serviceLayerCount: parseOptionalNumber(row.serviceLayerCount),
    serviceTableCount: parseOptionalNumber(row.serviceTableCount),
    geometryTypes: splitList(row.geometryTypes, ';'),
    capabilities: splitList(row.capabilitiesOrError, ','),
    arcgisSiblings: parseArcgisSiblings(row.arcgisSiblingSameTitle),
    civgraphMatchScore: parseOptionalNumber(row.civgraphMatchScore),
    civgraphMatchId: cleanText(row.civgraphMatchId),
    civgraphMatchTitle: cleanText(row.civgraphMatchTitle),
    civgraphMatchKind: cleanText(row.civgraphMatchKind),
    recommendedAction: cleanText(row.recommendedAction),
    duplicateReason: cleanText(row.duplicateReason),
    itemPage: cleanText(row.itemPage) || (row.itemId ? `https://www.arcgis.com/home/item.html?id=${cleanText(row.itemId)}` : '')
  };
}

function toSourceRecord(row) {
  const sourceClass = classifySourceRecord(row);
  const id = `peatland-geoportal:${sourceClass.idPrefix}:${slugify(row.title)}:${row.itemId}`;
  const references = buildReferences(row);
  const downloads = buildDownloads(row);
  return compactObject({
    id,
    slug: slugify(id),
    type: sourceClass.type,
    title: row.title,
    subtitle: compactJoin([row.type, row.owner, row.modifiedDate, sourceClass.subtitle]),
    category: sourceClass.category,
    date: datePart(row.modified),
    provider: inferProviders(row),
    description: buildSourceDescription(row, sourceClass),
    url: row.itemPage || row.url,
    references,
    downloads,
    keywords: mergeKeywordLists([
      'peatland-geoportal',
      row.topicClass,
      row.recommendedAction,
      row.type,
      row.owner
    ], row.tags),
    statusChips: sourceClass.statusChips,
    sourceHierarchy: ['Peatland Geoportal', sourceClass.hierarchyLabel, row.topicClass].filter(Boolean),
    viewport: buildViewport(row),
    sourceItems: [toArcgisSourceItem(row)],
    license: inferLicense(row),
    publicationStatus: sourceClass.publicationStatus,
    proposedBrowsePath: sourceClass.proposedBrowsePath,
    variantOf: row.recommendedAction === 'possible-variant-review' ? row.civgraphMatchId : null,
    parentId: sourceClass.parentId,
    parentTitle: sourceClass.parentTitle,
    relationship: sourceClass.relationship,
    relatedRecords: buildRelatedRecords(row),
    approval: compactObject({
      recommendedAction: sourceClass.approvalAction,
      conversionRecommendation: sourceClass.conversionRecommendation,
      dedupeRecommendation: sourceClass.dedupeRecommendation,
      arcgisItemId: row.itemId,
      sourceType: row.type,
      confidence: sourceClass.confidence
    }),
    shortCitation: `${row.owner || 'Peatland Geoportal'}: ${row.title}`,
    fullCitation: `${row.title}. ${row.owner || 'Peatland Geoportal'} via Peatland Geoportal / ArcGIS item ${row.itemId}${row.modified ? `, modified ${datePart(row.modified)}` : ''}.`
  });
}

function classifySourceRecord(row) {
  if (row.recommendedAction === 'source-document-record') {
    const isPdf = row.type === 'PDF';
    return {
      idPrefix: isPdf ? 'pdf' : 'code-attachment',
      type: isPdf ? 'peatland-geoportal-pdf-source' : 'peatland-geoportal-code-source',
      category: 'Peatland Geoportal source documents',
      subtitle: isPdf ? 'PDF/source document' : 'code/source attachment',
      hierarchyLabel: 'Documents and attachments',
      statusChips: ['Source only', isPdf ? 'PDF' : 'Code attachment', 'Structured extraction candidate'],
      publicationStatus: 'source-document-published',
      proposedBrowsePath: 'Books / Tables / Sources > Peatland Geoportal source documents',
      approvalAction: 'publish as source/document page',
      conversionRecommendation: 'not a runtime map source; retain for citation and later structured extraction where useful',
      dedupeRecommendation: 'dedupe by ArcGIS item ID and title',
      confidence: 'high'
    };
  }

  if (row.recommendedAction === 'candidate-interactive-map-after-license-dedupe') {
    const isSac = isSacHabitatMap(row);
    return {
      idPrefix: 'conversion-candidate',
      type: 'peatland-geoportal-conversion-candidate-source',
      category: 'Peatland Geoportal conversion candidates',
      subtitle: isSac ? 'SAC habitat map candidate' : 'conversion candidate',
      hierarchyLabel: isSac ? 'Peatland SAC Habitat Maps' : 'Conversion candidates',
      statusChips: ['Conversion candidate', 'Licence review required', 'Geometry not ingested'],
      publicationStatus: 'conversion-review-only',
      proposedBrowsePath: isSac
        ? 'Books / Tables / Sources > Peatland Geoportal > Peatland SAC Habitat Maps'
        : 'Books / Tables / Sources > Peatland Geoportal conversion candidates',
      parentId: isSac ? 'peatland-sac-habitat-maps' : null,
      parentTitle: isSac ? 'Peatland SAC Habitat Maps' : null,
      relationship: isSac ? 'candidate-child-source' : 'conversion-review-source',
      approvalAction: 'retain as conversion candidate; do not publish runtime layer until approved',
      conversionRecommendation: bestConversionRecommendation(row),
      dedupeRecommendation: dedupeRecommendation(row),
      confidence: row.civgraphMatchScore >= 0.75 ? 'needs variant/dedupe review' : 'candidate'
    };
  }

  if (row.recommendedAction === 'likely-duplicate-enrich-existing') {
    return {
      idPrefix: 'unmatched-duplicate-review',
      type: 'peatland-geoportal-unmatched-duplicate-review-source',
      category: 'Peatland Geoportal duplicate review',
      subtitle: 'duplicate review without concrete Civgraph target',
      hierarchyLabel: 'Duplicate review',
      statusChips: ['Duplicate review', 'Needs target match', row.type].filter(Boolean),
      publicationStatus: 'duplicate-review-only',
      proposedBrowsePath: 'Books / Tables / Sources > Peatland Geoportal duplicate review',
      approvalAction: 'retain as duplicate-review source page; do not enrich a specific Civgraph record until target is confirmed',
      conversionRecommendation: 'Do not convert or publish as a standalone map until the matching Civgraph target is identified.',
      dedupeRecommendation: row.duplicateReason || 'Likely duplicate by metadata pattern, but no concrete Civgraph target ID was recorded in the audit.',
      confidence: 'needs target confirmation'
    };
  }

  if (row.recommendedAction === 'context-layer-review-before-conversion' || row.recommendedAction === 'service-layer-review-raster-or-source-only') {
    return {
      idPrefix: 'context-layer-review',
      type: 'peatland-geoportal-layer-review-source',
      category: 'Peatland Geoportal context',
      subtitle: 'layer/service review',
      hierarchyLabel: 'Context layers',
      statusChips: ['Review required', 'Geometry not ingested'],
      publicationStatus: 'source-review-only',
      proposedBrowsePath: 'Books / Tables / Sources > Peatland Geoportal context',
      approvalAction: 'retain as source/context review record',
      conversionRecommendation: bestConversionRecommendation(row),
      dedupeRecommendation: dedupeRecommendation(row),
      confidence: 'review'
    };
  }

  return {
    idPrefix: 'context',
    type: 'peatland-geoportal-context-source',
    category: 'Peatland Geoportal context',
    subtitle: row.type,
    hierarchyLabel: 'Web maps, StoryMaps, apps, and context',
    statusChips: ['Source context', row.type].filter(Boolean),
    publicationStatus: 'context-source-published',
    proposedBrowsePath: 'Books / Tables / Sources > Peatland Geoportal context',
    approvalAction: 'publish as source/context page',
    conversionRecommendation: 'not preferred for direct conversion; use as context/citation unless it points to an approved Feature Service/WFS',
    dedupeRecommendation: 'dedupe by ArcGIS item ID and title',
    confidence: 'high'
  };
}

function buildExistingRecordEnrichments(rows) {
  const enrichmentRows = rows.filter((row) => row.recommendedAction === 'likely-duplicate-enrich-existing' && row.civgraphMatchId);
  const groups = new Map();
  for (const row of enrichmentRows) {
    const target = targetForMatch(row);
    const key = target.sourceTargetId;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTargetId: key,
        targetEntityKind: target.targetEntityKind,
        targetEntityId: target.targetEntityId,
        targetTitle: target.targetTitle,
        targetBrowseUrl: target.targetBrowseUrl,
        sourceRecordBrowseUrl: `/browse/sources/${encodeURIComponent(slugify(key))}`,
        evidence: [],
        sourceItems: [],
        safetyClasses: ['safe metadata enrichment candidate'],
        enrichmentTypes: ['ArcGIS item provenance', 'provider metadata', 'source URL', 'service URL', 'alternative service link'],
        formats: [],
        providers: [],
        categories: ['Peatland Geoportal duplicate-match enrichment'],
        rowNumbers: []
      });
    }
    const group = groups.get(key);
    group.evidence.push(compactObject({
      kind: row.civgraphMatchKind || 'matched-record',
      id: row.civgraphMatchId,
      title: row.civgraphMatchTitle,
      score: row.civgraphMatchScore
    }));
    group.sourceItems.push(toArcgisSourceItem(row));
    addUnique(group.formats, row.type);
    addUnique(group.providers, row.owner || 'Peatland Geoportal');
    addUnique(group.rowNumbers, row.rowNumber);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      evidence: dedupeByJson(group.evidence),
      sourceItems: group.sourceItems.sort((a, b) => Number(a.auditRowNumber) - Number(b.auditRowNumber)),
      confidence: 'safe',
      sourceItemCount: group.sourceItems.length
    }))
    .sort(sortByTitle);
}

function targetForMatch(row) {
  if (row.civgraphMatchKind === 'map') {
    return {
      sourceTargetId: `map-source:${row.civgraphMatchId}`,
      targetEntityKind: 'map',
      targetEntityId: row.civgraphMatchId,
      targetTitle: row.civgraphMatchTitle || row.title,
      targetBrowseUrl: `/browse/maps/${encodeURIComponent(row.civgraphMatchId)}`
    };
  }
  if (row.civgraphMatchKind === 'source') {
    return {
      sourceTargetId: row.civgraphMatchId,
      targetEntityKind: 'source',
      targetEntityId: row.civgraphMatchId,
      targetTitle: row.civgraphMatchTitle || row.title,
      targetBrowseUrl: `/browse/sources/${encodeURIComponent(slugify(row.civgraphMatchId))}`
    };
  }
  return {
    sourceTargetId: `peatland-geoportal-enrichment:${slugify(row.civgraphMatchId || row.title)}`,
    targetEntityKind: row.civgraphMatchKind || 'unknown',
    targetEntityId: row.civgraphMatchId || row.itemId,
    targetTitle: row.civgraphMatchTitle || row.title,
    targetBrowseUrl: null
  };
}

function toArcgisSourceItem(row) {
  return compactObject({
    auditRowNumber: row.rowNumber,
    title: row.title,
    provider: row.owner || 'Peatland Geoportal',
    category: row.topicClass || 'Peatland Geoportal',
    formats: [row.type].filter(Boolean),
    arcgisItemId: row.itemId,
    arcgisItemPage: row.itemPage,
    serviceUrl: row.url || null,
    modified: row.modified,
    access: row.access,
    tags: row.tags,
    serviceLayerCount: row.serviceLayerCount,
    serviceTableCount: row.serviceTableCount,
    geometryTypes: row.geometryTypes,
    capabilities: row.capabilities,
    siblingItems: row.arcgisSiblings,
    recommendedAction: row.recommendedAction,
    duplicateReason: row.duplicateReason,
    civgraphMatchId: row.civgraphMatchId,
    civgraphMatchTitle: row.civgraphMatchTitle,
    civgraphMatchKind: row.civgraphMatchKind,
    civgraphMatchScore: row.civgraphMatchScore,
    licenseNote: inferLicense(row).note
  });
}

function toServiceDefinitionReview(row) {
  const siblingFeatureServices = row.arcgisSiblings.filter((item) => item.type === 'Feature Service');
  const siblingWfs = row.arcgisSiblings.filter((item) => item.type === 'WFS');
  return compactObject({
    arcgisItemId: row.itemId,
    title: row.title,
    owner: row.owner,
    modified: row.modified,
    itemPage: row.itemPage,
    siblingFeatureServiceCount: siblingFeatureServices.length,
    siblingWfsCount: siblingWfs.length,
    siblings: row.arcgisSiblings,
    usefulMetadataNotOnFeatureService: [
      'Service Definition proves an ArcGIS publishing/package relationship.',
      'Item page, owner, modified date, tags, and sibling links are useful provenance/context.',
      'It is not the preferred conversion source when a Feature Service or WFS sibling exists.'
    ],
    recommendation: siblingFeatureServices.length
      ? 'Do not publish as a standalone map layer; use as provenance/package evidence for the sibling Feature Service.'
      : 'Retain as source/package record until a better conversion source is identified.'
  });
}

function toCandidateReview(row) {
  return compactObject({
    arcgisItemId: row.itemId,
    title: row.title,
    type: row.type,
    owner: row.owner,
    modified: row.modified,
    itemPage: row.itemPage,
    serviceUrl: row.url || null,
    topicClass: row.topicClass,
    tags: row.tags,
    serviceLayerCount: row.serviceLayerCount,
    serviceTableCount: row.serviceTableCount,
    geometryTypes: row.geometryTypes,
    capabilities: row.capabilities,
    siblingItems: row.arcgisSiblings,
    civgraphMatchId: row.civgraphMatchId,
    civgraphMatchTitle: row.civgraphMatchTitle,
    civgraphMatchScore: row.civgraphMatchScore,
    license: inferLicense(row),
    bestSourceRecommendation: bestConversionRecommendation(row),
    dedupeRecommendation: dedupeRecommendation(row),
    proposedCatalogueGrouping: isSacHabitatMap(row) ? 'Peatland SAC Habitat Maps' : null,
    conversionStatus: 'not converted; review-only'
  });
}

function buildSacHabitatGroup(rows) {
  const children = rows
    .filter((row) => row.recommendedAction === 'candidate-interactive-map-after-license-dedupe' && isSacHabitatMap(row))
    .map((row) => ({
      arcgisItemId: row.itemId,
      title: row.title,
      owner: row.owner,
      modified: row.modified,
      itemPage: row.itemPage,
      serviceUrl: row.url || null,
      geometryTypes: row.geometryTypes,
      serviceLayerCount: row.serviceLayerCount,
      bestSourceRecommendation: bestConversionRecommendation(row),
      license: inferLicense(row)
    }))
    .sort(sortByTitle);
  return {
    proposedParentId: 'peatland-sac-habitat-maps',
    proposedParentTitle: 'Peatland SAC Habitat Maps',
    proposedCataloguePath: 'Peatlands / SAC Habitat Maps',
    recommendation: 'Publish as one coherent parent card with one child/subentry per SAC habitat map after licence/provenance approval and vector conversion. Do not scatter individual SAC habitat maps as unrelated top-level cards.',
    children
  };
}

function buildBestSourceReview(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.normalizedTitle;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1 || group.some((row) => ['Feature Service', 'WFS', 'Shapefile', 'Service Definition'].includes(row.type)))
    .map((group) => {
      const sorted = [...group].sort((a, b) => sourcePreferenceScore(b) - sourcePreferenceScore(a));
      const preferred = sorted[0];
      return {
        titleKey: preferred.normalizedTitle,
        preferredArcgisItemId: preferred.itemId,
        preferredTitle: preferred.title,
        preferredType: preferred.type,
        recommendation: bestConversionRecommendation(preferred),
        alternatives: sorted.map((row) => ({
          arcgisItemId: row.itemId,
          title: row.title,
          type: row.type,
          url: row.url || row.itemPage,
          role: row.itemId === preferred.itemId ? 'preferred-source' : alternativeRole(row)
        }))
      };
    })
    .sort((a, b) => a.titleKey.localeCompare(b.titleKey));
}

function sourcePreferenceScore(row) {
  if (row.type === 'Feature Service' && row.geometryTypes.length && !row.geometryTypes.includes('unknown')) return 100;
  if (row.type === 'WFS') return 90;
  if (row.type === 'Shapefile') return 80;
  if (row.type === 'Map Service') return 60;
  if (row.type === 'Image Service') return 40;
  if (row.type === 'Service Definition') return 20;
  return 10;
}

function alternativeRole(row) {
  if (row.type === 'Service Definition') return 'package/provenance evidence';
  if (row.type === 'WFS') return 'standards-based alternative/corroboration';
  if (row.type === 'Shapefile') return 'raw source package candidate';
  if (row.type === 'Web Map' || row.type === 'StoryMap') return 'context/presentation source';
  return 'alternative source/context';
}

function toVariantReview(row) {
  return compactObject({
    arcgisItemId: row.itemId,
    title: row.title,
    type: row.type,
    owner: row.owner,
    modified: row.modified,
    itemPage: row.itemPage,
    serviceUrl: row.url || null,
    civgraphMatchId: row.civgraphMatchId,
    civgraphMatchTitle: row.civgraphMatchTitle,
    civgraphMatchScore: row.civgraphMatchScore,
    siblingItems: row.arcgisSiblings,
    recommendation: variantRecommendation(row),
    caveat: 'This is a title/provider/service-metadata review only. Final duplicate/variant status requires field/schema and geometry lineage inspection before conversion.'
  });
}

function toUnmatchedLikelyDuplicateReview(row) {
  return compactObject({
    arcgisItemId: row.itemId,
    title: row.title,
    type: row.type,
    owner: row.owner,
    modified: row.modified,
    itemPage: row.itemPage,
    serviceUrl: row.url || null,
    siblingItems: row.arcgisSiblings,
    duplicateReason: row.duplicateReason,
    recommendation: 'Likely duplicate/source-package row, but the audit did not identify a concrete existing Civgraph target ID. Keep as a source review page and resolve target before enrichment or conversion.'
  });
}

function buildUnresolvedAmbiguities(rows, candidateConversionReview, variantReview) {
  const unresolved = [];
  for (const row of rows.filter((entry) => entry.recommendedAction === 'metadata-review')) {
    unresolved.push({
      arcgisItemId: row.itemId,
      title: row.title,
      type: row.type,
      ambiguity: 'metadata-review row from audit',
      recommendation: 'Inspect item metadata manually before creating a Browse/source record or conversion candidate.'
    });
  }
  for (const row of candidateConversionReview.filter((entry) => entry.license.status !== 'likely-open-but-confirm')) {
    unresolved.push({
      arcgisItemId: row.arcgisItemId,
      title: row.title,
      type: row.type,
      ambiguity: 'licence not explicit in metadata audit',
      recommendation: 'Confirm provider licence before vector conversion; source-page citation is safe.'
    });
  }
  for (const row of variantReview) {
    unresolved.push({
      arcgisItemId: row.arcgisItemId,
      title: row.title,
      type: row.type,
      ambiguity: 'possible duplicate/variant relationship',
      recommendation: row.recommendation
    });
  }
  return dedupeByJson(unresolved).sort(sortByTitle);
}

function isNamedVariant(row) {
  return /grassland habitat network|purple moor grass|rush pasture/i.test(row.title);
}

function isUnmatchedLikelyDuplicate(row) {
  return row.recommendedAction === 'likely-duplicate-enrich-existing' && !row.civgraphMatchId;
}

function variantRecommendation(row) {
  if (/purple moor grass|rush pasture/i.test(row.title)) {
    return 'Treat as probable same-family variant of the existing Purple Moor Grass and Rush Pasture Habitat Network record. Inspect fields, provider lineage, and geometry before deciding whether it enriches the current record or becomes a dated/source variant.';
  }
  if (/grassland habitat network/i.test(row.title)) {
    return 'Do not merge automatically into Acid Grassland. Treat as a broader grassland network candidate and compare schema/classes before deciding whether it is a parent/generalised variant.';
  }
  if (row.civgraphMatchId) {
    return `Review against existing Civgraph record ${row.civgraphMatchTitle || row.civgraphMatchId}; publish as metadata enrichment or child/variant only if lineage differs materially.`;
  }
  return 'Variant status unresolved; inspect provider lineage, schema, and geometry coverage before publishing.';
}

function buildSourceDescription(row, sourceClass) {
  const serviceBits = [];
  if (row.serviceLayerCount !== null) serviceBits.push(`${row.serviceLayerCount} layer${row.serviceLayerCount === 1 ? '' : 's'}`);
  if (row.geometryTypes.length) serviceBits.push(row.geometryTypes.join(', '));
  if (row.capabilities.length) serviceBits.push(`capabilities: ${row.capabilities.join(', ')}`);
  const serviceSentence = serviceBits.length ? ` Service metadata observed in the audit: ${serviceBits.join('; ')}.` : '';
  return [
    `${row.title} is a ${row.type} item from the Peatland Geoportal, owned by ${row.owner || 'an ArcGIS publisher'}.`,
    sourceClass.conversionRecommendation,
    sourceClass.dedupeRecommendation,
    `ArcGIS item ID: ${row.itemId}.${row.modified ? ` Modified: ${datePart(row.modified)}.` : ''}`,
    serviceSentence,
    inferLicense(row).note
  ].filter(Boolean).join(' ');
}

function buildReferences(row) {
  const refs = [
    {
      label: `${row.title} ArcGIS item page`,
      url: row.itemPage,
      source: 'ArcGIS Online / Peatland Geoportal',
      role: 'arcgis-item-page'
    },
    {
      label: 'Peatland Geoportal',
      url: PORTAL_URL,
      source: 'Queen\'s University Belfast / ArcGIS Hub',
      role: 'source-portal'
    },
    {
      label: 'Peatland Geoportal ArcGIS group search',
      url: GROUP_SEARCH_URL,
      source: 'ArcGIS Online',
      role: 'source-group'
    }
  ];
  if (row.url) {
    refs.push({
      label: `${row.title} service or source URL`,
      url: row.url,
      source: row.owner || 'ArcGIS Online',
      role: serviceRole(row.type)
    });
  }
  for (const sibling of row.arcgisSiblings) {
    refs.push({
      label: `${row.title} sibling ${sibling.type}`,
      url: `https://www.arcgis.com/home/item.html?id=${sibling.itemId}`,
      source: 'ArcGIS Online',
      role: `sibling-${slugify(sibling.type)}`
    });
  }
  return dedupeReferences(refs);
}

function buildDownloads(row) {
  const downloads = [];
  if (row.url && /FeatureServer|MapServer|ImageServer|WFSServer|WMSServer/i.test(row.url)) {
    downloads.push({
      label: `${row.title} service endpoint`,
      url: row.url,
      source: row.owner || 'ArcGIS Online',
      role: serviceRole(row.type)
    });
  }
  if (row.url && /\.(pdf|zip|csv|xlsx?|ods|txt|json)$/i.test(row.url)) {
    downloads.push({
      label: `${row.title} source file`,
      url: row.url,
      source: row.owner || 'ArcGIS Online',
      role: 'source-file'
    });
  }
  return dedupeReferences(downloads);
}

function buildViewport(row) {
  const url = row.url || row.itemPage;
  if (row.type === 'PDF') {
    return {
      type: 'pdf',
      status: /\.pdf($|\?)/i.test(url) ? 'previewable-when-cors-allows' : 'arcgis-item-page-only',
      url
    };
  }
  if (row.type === 'Code Attachment') {
    return {
      type: 'code',
      status: 'source-attachment-page',
      url
    };
  }
  if (['Web Map', 'StoryMap', 'Web Mapping Application', 'Web Experience', 'Hub Page', 'Hub Site Application', 'Web Scene'].includes(row.type)) {
    return {
      type: 'web-context',
      status: 'external-context-link',
      url: row.itemPage || row.url
    };
  }
  return null;
}

function buildRelatedRecords(row) {
  const records = [];
  if (row.civgraphMatchId) {
    records.push({
      id: row.civgraphMatchId,
      title: row.civgraphMatchTitle,
      kind: row.civgraphMatchKind,
      relationship: row.recommendedAction === 'possible-variant-review' ? 'possible-variant-of' : 'matched-existing-record',
      confidence: row.civgraphMatchScore
    });
  }
  for (const sibling of row.arcgisSiblings) {
    records.push({
      id: sibling.itemId,
      title: `${row.title} (${sibling.type})`,
      kind: 'arcgis-sibling',
      relationship: 'same-title-sibling'
    });
  }
  return records;
}

function inferProviders(row) {
  const providers = [];
  if (row.owner) providers.push(row.owner);
  if (/DAERA|NIEA|OpenDataNI|Open Data NI/i.test(`${row.owner} ${row.tags.join(' ')}`)) providers.push('DAERA / Open Data NI');
  if (/Queen|QUB|Queens/i.test(`${row.owner} ${row.tags.join(' ')}`)) providers.push('Queen\'s University Belfast');
  if (/NPWS|National Parks/i.test(`${row.owner} ${row.tags.join(' ')}`)) providers.push('NPWS');
  if (/Tailte|OSi/i.test(`${row.owner} ${row.tags.join(' ')}`)) providers.push('Tailte Éireann / OSi');
  if (/Met Office|MetOffice/i.test(`${row.owner} ${row.tags.join(' ')}`)) providers.push('Met Office');
  return dedupeStrings(providers.length ? providers : ['Peatland Geoportal']);
}

function inferLicense(row) {
  const haystack = `${row.owner} ${row.tags.join(' ')} ${row.title}`;
  if (/OpenDataNI|Open Data NI|OpenData|Open data/i.test(haystack)) {
    return {
      status: 'likely-open-but-confirm',
      note: 'Metadata tags indicate open-data context, but the exact reuse licence must be confirmed before geometry conversion.'
    };
  }
  return {
    status: 'licence-review-required',
    note: 'The metadata audit confirms public item access, not a definitive reuse licence. Confirm provider licence before geometry conversion.'
  };
}

function bestConversionRecommendation(row) {
  if (row.type === 'Feature Service') {
    const geometry = row.geometryTypes.length ? ` (${row.geometryTypes.join(', ')})` : '';
    return `Best conversion source if approved: ArcGIS Feature Service${geometry}; use item metadata and sibling records for provenance.`;
  }
  if (row.type === 'WFS') {
    return 'Good standards-based alternative/corroborating conversion source; prefer Feature Service if it has equivalent geometry and clearer metadata.';
  }
  if (row.type === 'Shapefile') {
    return 'Raw package candidate; useful if Feature Service/WFS is missing or if original shapefile lineage is required.';
  }
  if (row.type === 'Service Definition') {
    return 'Do not use as first-choice conversion source; retain as ArcGIS publishing/package provenance unless no service/export alternative exists.';
  }
  if (row.type === 'Image Service' || row.type === 'Map Service') {
    return 'Review as raster/context service. Convert only if it exposes suitable vector sublayers or a separate vector source exists.';
  }
  return 'Context/citation source; not a direct conversion source unless it links to an approved vector service.';
}

function dedupeRecommendation(row) {
  if (row.civgraphMatchScore >= 0.95) {
    return `Likely duplicate of existing Civgraph record ${row.civgraphMatchTitle || row.civgraphMatchId}; enrich existing record rather than creating a duplicate.`;
  }
  if (row.civgraphMatchScore >= 0.7) {
    return `Possible variant of ${row.civgraphMatchTitle || row.civgraphMatchId}; inspect lineage/schema/geometry before deciding.`;
  }
  return 'No high-confidence Civgraph duplicate from metadata-only title matching; still inspect provider lineage before conversion.';
}

function isSacHabitatMap(row) {
  return /SAC Habitat Map/i.test(row.title) && /DAERANI|DAERA|Megan\.Ryan/i.test(`${row.owner} ${row.tags.join(' ')}`);
}

function serviceRole(type) {
  if (type === 'Feature Service') return 'feature-service';
  if (type === 'Map Service') return 'map-service';
  if (type === 'Image Service') return 'image-service';
  if (type === 'WFS') return 'wfs';
  if (type === 'WMS') return 'wms';
  return 'source-url';
}

function parseArcgisSiblings(value) {
  return splitList(value, ';').map((part) => {
    const match = part.match(/^([^:]+):([a-z0-9]+)$/i);
    if (!match) return null;
    return {
      type: cleanText(match[1]),
      itemId: cleanText(match[2]),
      itemPage: `https://www.arcgis.com/home/item.html?id=${cleanText(match[2])}`
    };
  }).filter(Boolean);
}

function countBy(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = row[key] || 'unknown';
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...body] = rows;
  return body
    .filter((values) => values.some((value) => cleanText(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value) && !value.length) return false;
    if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return false;
    return true;
  }));
}

function cleanText(value) {
  return String(value ?? '').replace(/\uFFFD/g, '').replace(/\s+/g, ' ').trim();
}

function splitList(value, separator = ';') {
  return String(value || '')
    .split(separator)
    .map(cleanText)
    .filter(Boolean);
}

function parseOptionalNumber(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'item';
}

function normalizeTitle(value) {
  return slugify(value)
    .replace(/-npws$|-wfs$|-feature-service$|-service-definition$/g, '')
    .replace(/-+/g, '-');
}

function compactJoin(values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean).join(' / ');
}

function datePart(value) {
  const text = cleanText(value);
  return text.includes('T') ? text.slice(0, 10) : text;
}

function sortByTitle(a, b) {
  return cleanText(a.title || a.targetTitle || a.titleKey).localeCompare(cleanText(b.title || b.targetTitle || b.titleKey));
}

function addUnique(array, value) {
  const cleaned = cleanText(value);
  if (cleaned && !array.includes(cleaned)) array.push(cleaned);
}

function mergeKeywordLists(...lists) {
  return dedupeStrings(lists.flatMap((list) => Array.isArray(list) ? list : [list]).map(cleanText).filter(Boolean));
}

function dedupeStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function dedupeReferences(refs) {
  const out = [];
  const seen = new Set();
  for (const ref of refs.filter((item) => item?.url)) {
    const key = `${ref.role || ''}|${ref.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(compactObject(ref));
  }
  return out;
}

function dedupeByJson(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) {
    throw new Error('Peatland Geoportal source sidecar leaks a local filesystem path');
  }
}

function assertNoGeometryPayloads(value) {
  const text = JSON.stringify(value);
  if (/"features"\s*:\s*\[|"geometry"\s*:\s*\{|"coordinates"\s*:\s*\[/i.test(text)) {
    throw new Error('Peatland Geoportal source sidecar appears to contain geometry payloads');
  }
}
