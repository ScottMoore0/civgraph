#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'data', 'review-inputs', 'medium-priority-publication-prep-2026-06-25', 'row-staging-records.json');
const OUTPUT = path.join(ROOT, 'data', 'database', 'medium-priority-publication-sources.json');
const EXPECTED_TOTAL = 2346;
const EXPECTED_READY = 1121;
const EXPECTED_REVIEW = 1225;

main();

function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing staged medium-priority records: ${path.relative(ROOT, INPUT)}`);
  }

  const rows = JSON.parse(readFileSync(INPUT, 'utf8'));
  if (!Array.isArray(rows)) {
    throw new Error('Medium-priority staging records must be a JSON array.');
  }
  if (rows.length !== EXPECTED_TOTAL) {
    throw new Error(`Expected ${EXPECTED_TOTAL} medium-priority rows, found ${rows.length}.`);
  }

  const sources = rows.map(toSourceRecord);
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate medium-priority source id: ${source.id}`);
    ids.add(source.id);
  }

  const summary = buildSummary(sources);
  if (summary.byPublicationStatus['approved-source-record'] !== EXPECTED_READY) {
    throw new Error(`Expected ${EXPECTED_READY} approved-source-record rows, found ${summary.byPublicationStatus['approved-source-record'] || 0}.`);
  }
  if (summary.byPublicationStatus['source-record-with-runtime-review'] !== EXPECTED_REVIEW) {
    throw new Error(`Expected ${EXPECTED_REVIEW} source-record-with-runtime-review rows, found ${summary.byPublicationStatus['source-record-with-runtime-review'] || 0}.`);
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      stagingRecords: 'data/review-inputs/medium-priority-publication-prep-2026-06-25/row-staging-records.json',
      stagingSummary: 'data/review-inputs/medium-priority-publication-prep-2026-06-25/README.md',
      stagingValidation: 'data/review-inputs/medium-priority-publication-prep-2026-06-25/validation-report.json'
    },
    publicationPolicy: {
      scope: 'Public Browse/Books/Tables/Sources source and provenance records for the five approved medium-priority D: drive queues.',
      runtimeSafety: 'Records with pending conversion, duplicate/variant, geography, or special-format review are published as source/provenance records only. They are not treated as live interactive MapLibre layers until a separate conversion/runtime pass supplies validated PMTiles and catalogue metadata.',
      links: 'Current provider URLs are canonical when available; Wayback URLs are preserved when present; Internet Archive mirror links remain pending until an IA item/file URL exists.',
      localPaths: 'Local D: and user filesystem paths are intentionally excluded from public records.',
      alreadyLiveData: 'This sidecar complements existing raw-source documents and already-on-site enrichments; it does not duplicate those generated sidecars.'
    },
    summary,
    sources
  };

  assertNoLocalPaths(output);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${sources.length} medium-priority publication source records.`);
}

function toSourceRecord(row) {
  const title = cleanText(row.cleanTitle || row.title || row.slugOrId || row.id);
  const id = String(row.id || `medium-prep:${slugify(title)}`).replace(/^medium-prep:/, 'medium-priority:');
  const slug = slugify(id);
  const provider = unique([row.organisation, row.provider].map(cleanText).filter(Boolean));
  const formats = normalizeArray(row.formats).map((format) => cleanText(format).toUpperCase()).filter(Boolean);
  const residualBlockers = normalizeArray(row.residualBlockers).map(cleanText).filter(Boolean);
  const resolvedBlockers = normalizeArray(row.resolvedBlockers).map(cleanText).filter(Boolean);
  const approvalReady = cleanText(row.approvalState) === 'ready-for-approval' && residualBlockers.length === 0;
  const publicationStatus = approvalReady ? 'approved-source-record' : 'source-record-with-runtime-review';
  const sourceKind = classifySourceKind(row, formats);
  const category = categoryFor(row);
  const references = referencesFor(row, title);
  const downloads = downloadsFor(row, references);
  const statusChips = statusChipsFor(row, approvalReady, residualBlockers, formats);
  const sourceItems = [sourceItemFor(row, formats, approvalReady)];
  const relatedRecords = relatedRecordsFor(row);
  const variantOf = variantParentFor(row);

  return compactObject({
    id,
    slug,
    type: 'approved-medium-priority-source',
    title,
    subtitle: compactJoin([
      row.groupTitle,
      provider.join(', '),
      row.jurisdiction,
      formats.join(', '),
      approvalReady ? 'Approved source record' : 'Source record; runtime review pending'
    ]),
    category,
    date: inferYear(title),
    provider,
    description: descriptionFor(row, title, provider, approvalReady, residualBlockers),
    url: row.currentProviderUrl || references.find((reference) => reference.url)?.url || null,
    references,
    downloads,
    status: approvalReady ? 'Source ready' : 'Source only',
    statusChips,
    sourceHierarchy: sourceHierarchyFor(row, title),
    viewport: viewportFor(row, formats),
    shortCitation: shortCitationFor(title, provider),
    fullCitation: fullCitationFor(row, title, provider),
    sourceItems,
    relatedRecords,
    license: {
      status: 'provider-specific',
      note: 'Use the provider dataset page, Wayback capture, source metadata, or IA item metadata to confirm any resource-specific licence before structured reuse.'
    },
    approval: compactObject({
      stagingId: row.id,
      sourceRowNumber: row.sourceRowNumber,
      approvalState: row.approvalState,
      recommendedAction: actionLabel(row.proposedAction),
      proposedAction: row.proposedAction,
      proposedPlacement: row.proposedPlacement,
      proposedRuntime: row.proposedRuntime,
      confidence: row.confidence,
      residualBlockers,
      resolvedBlockers,
      cleanedRecommendation: cleanText(row.cleanedRecommendation),
      geographyRecommendation: cleanText(row.geographyRecommendation),
      comparabilityRecommendation: cleanText(row.comparabilityRecommendation),
      sourcePlacement: cleanText(row.sourcePlacement)
    }),
    publicationStatus,
    proposedBrowsePath: cleanText(row.proposedPlacement || row.sourcePlacement || `Browse / Sources > ${category}`),
    variantOf,
    parentId: variantOf?.id || row.bestExistingMatchId || null,
    parentTitle: variantOf?.title || row.bestExistingMatchTitle || null,
    relationship: relationshipFor(row),
    keywords: unique([
      'medium-priority-publication',
      publicationStatus,
      row.groupTitle,
      row.topic,
      row.featureUnit,
      row.jurisdiction,
      row.proposedAction,
      ...formats,
      ...residualBlockers.map((blocker) => `review:${slugify(blocker)}`)
    ].map(cleanText).filter(Boolean)),
    browseUrl: `/browse/sources/${encodeURIComponent(slug)}`
  });
}

function descriptionFor(row, title, providers, approvalReady, residualBlockers) {
  const providerText = providers.length ? providers.join(', ') : 'the source provider';
  const base = `${title} is published as a medium-priority Civgraph source/provenance record from ${providerText}.`;
  const runtime = row.isSpatial
    ? 'The source was identified as spatial, but this publication pass does not create or replace a live MapLibre layer unless a separate PMTiles/runtime conversion is already present.'
    : 'The source is available as a Browse/Books/Tables/Sources record rather than a map runtime layer.';
  const review = approvalReady
    ? 'The staging pass found no residual blockers for source-level publication.'
    : `Runtime or semantic review remains before this can become a duplicate-free interactive layer or merged structured dataset: ${residualBlockers.join('; ') || 'review required'}.`;
  return `${base} ${runtime} ${review}`;
}

function referencesFor(row, title) {
  const refs = [];
  if (row.currentProviderUrl) {
    refs.push({
      label: `${title} provider page`,
      url: row.currentProviderUrl,
      source: cleanText(row.provider || row.organisation || 'Provider'),
      role: 'canonical-provider-url'
    });
  }
  if (row.waybackUrl) {
    refs.push({
      label: `${title} Wayback captures`,
      url: row.waybackUrl,
      source: 'Internet Archive Wayback Machine',
      role: 'archive-captures'
    });
  }
  for (const evidence of relatedRecordsFor(row).slice(0, 5)) {
    if (!evidence.url) continue;
    refs.push({
      label: `Potential existing Civgraph match: ${evidence.title || evidence.id}`,
      url: evidence.url,
      source: 'Civgraph',
      role: 'possible-existing-record'
    });
  }
  return dedupeLinks(refs);
}

function downloadsFor(row, references) {
  const downloads = [];
  const providerReference = references.find((reference) => reference.role === 'canonical-provider-url');
  if (providerReference) {
    downloads.push({
      label: 'Provider dataset/download page',
      url: providerReference.url,
      type: 'dataset-page',
      status: 'download resources are listed by the provider page'
    });
  }
  if (row.internetArchiveStatus && row.internetArchiveStatus !== 'not-needed') {
    downloads.push({
      label: 'Internet Archive mirror',
      url: null,
      type: 'ia-mirror',
      status: row.internetArchiveStatus
    });
  }
  return downloads.filter((download) => download.url || download.status);
}

function sourceItemFor(row, formats, approvalReady) {
  return compactObject({
    sourceRowNumber: row.sourceRowNumber,
    stagingId: row.id,
    title: cleanText(row.title),
    cleanTitle: cleanText(row.cleanTitle),
    provider: cleanText(row.provider),
    organisation: cleanText(row.organisation),
    category: cleanText(row.category),
    roiGroup: cleanText(row.roiGroup),
    groupTitle: cleanText(row.groupTitle),
    jurisdiction: cleanText(row.jurisdiction),
    topic: cleanText(row.topic),
    featureUnit: cleanText(row.featureUnit),
    formats,
    isSpatial: Boolean(row.isSpatial),
    isLargeOrSpecial: Boolean(row.isLargeOrSpecial),
    proposedAction: cleanText(row.proposedAction),
    proposedPlacement: cleanText(row.proposedPlacement),
    proposedRuntime: row.proposedRuntime || null,
    approvalState: cleanText(row.approvalState),
    sourcePublicationState: approvalReady ? 'approved public source record' : 'public source record with runtime/semantic review still pending',
    confidence: row.confidence,
    currentProviderUrl: row.currentProviderUrl || null,
    waybackUrl: row.waybackUrl || null,
    internetArchiveStatus: cleanText(row.internetArchiveStatus),
    canonicalSourcePolicy: cleanText(row.canonicalSourcePolicy),
    bestExistingMatch: compactObject({
      type: cleanText(row.bestExistingMatchType),
      id: cleanText(row.bestExistingMatchId),
      title: cleanText(row.bestExistingMatchTitle),
      score: cleanText(row.bestExistingMatchScore),
      stillPresent: Boolean(row.bestExistingMatchStillPresent)
    }),
    allMatchEvidence: normalizeArray(row.allMatchEvidence),
    resolvedBlockers: normalizeArray(row.resolvedBlockers),
    residualBlockers: normalizeArray(row.residualBlockers),
    cleanedRecommendation: cleanText(row.cleanedRecommendation),
    geographyRecommendation: cleanText(row.geographyRecommendation),
    comparabilityRecommendation: cleanText(row.comparabilityRecommendation),
    sourcePlacement: cleanText(row.sourcePlacement)
  });
}

function relatedRecordsFor(row) {
  const evidence = normalizeArray(row.allMatchEvidence);
  const out = [];
  for (const item of evidence) {
    const kind = cleanText(item.type || item.kind);
    const id = cleanText(item.id);
    if (!kind || !id) continue;
    out.push(compactObject({
      kind,
      id,
      title: cleanText(item.title),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      url: browseUrlForEvidence(kind, id)
    }));
  }
  if (!out.length && row.bestExistingMatchId) {
    out.push(compactObject({
      kind: cleanText(row.bestExistingMatchType),
      id: cleanText(row.bestExistingMatchId),
      title: cleanText(row.bestExistingMatchTitle),
      score: Number.isFinite(Number(row.bestExistingMatchScore)) ? Number(row.bestExistingMatchScore) : null,
      url: browseUrlForEvidence(row.bestExistingMatchType, row.bestExistingMatchId)
    }));
  }
  return out;
}

function browseUrlForEvidence(kind, id) {
  if (!id) return null;
  if (kind === 'browse-map' || kind === 'database-map') return `/browse/maps/${encodeURIComponent(id)}`;
  if (kind === 'browse-source') return `/browse/sources/${encodeURIComponent(slugify(id))}`;
  if (kind === 'browse-feature') return `/browse/features?map=${encodeURIComponent(id)}`;
  return null;
}

function variantParentFor(row) {
  if (row.proposedAction !== 'variant-child-map' && row.proposedAction !== 'enrich-existing-source') return null;
  const matchId = cleanText(row.bestExistingMatchId);
  if (!matchId) return null;
  return compactObject({
    id: matchId,
    title: cleanText(row.bestExistingMatchTitle),
    matchType: cleanText(row.bestExistingMatchType),
    score: Number.isFinite(Number(row.bestExistingMatchScore)) ? Number(row.bestExistingMatchScore) : null
  });
}

function relationshipFor(row) {
  if (row.proposedAction === 'variant-child-map') return 'variant-source-candidate';
  if (row.proposedAction === 'enrich-existing-source') return 'source-metadata-enrichment';
  if (row.proposedAction === 'enrich-existing-election') return 'election-source-enrichment';
  if (row.proposedAction === 'new-interactive-map') return 'source-record-runtime-conversion-pending';
  return 'source-record';
}

function statusChipsFor(row, approvalReady, residualBlockers, formats) {
  const chips = ['Source record'];
  if (approvalReady) chips.push('Approved');
  if (!approvalReady || residualBlockers.length) chips.push('Runtime review pending');
  if (row.isSpatial) chips.push('Spatial source');
  if (row.proposedRuntime?.desired === 'MapLibre interactive layer') chips.push('Conversion pending');
  if (formats.length) chips.push('Download available');
  if (row.currentProviderUrl) chips.push('Provider link');
  if (row.waybackUrl) chips.push('Wayback link');
  if (row.proposedAction === 'variant-child-map') chips.push('Variant candidate');
  if (row.proposedAction === 'enrich-existing-election') chips.push('Election provenance');
  if (row.proposedAction === 'enrich-existing-source') chips.push('Existing record enrichment');
  return unique(chips);
}

function viewportFor(row, formats) {
  const support = [];
  const formatSet = new Set(formats.map((format) => format.toLowerCase()));
  if (hasAny(formatSet, ['pdf'])) support.push('pdf');
  if (hasAny(formatSet, ['csv', 'txt', 'json', 'geojson', 'html', 'xml'])) support.push('table-or-text');
  if (hasAny(formatSet, ['png', 'jpg', 'jpeg', 'tif', 'tiff'])) support.push('image');
  if (hasAny(formatSet, ['xls', 'xlsx', 'ods'])) support.push('spreadsheet');
  if (hasAny(formatSet, ['zip', 'shp', 'gdb', 'mdb', 'database'])) support.push('download-only');
  return compactObject({
    status: support.length ? 'ready-when-public-file-url-attached' : 'source-page-only',
    supportedViewportTypes: support,
    canonicalDatasetUrl: row.currentProviderUrl || null,
    waybackUrl: row.waybackUrl || null,
    internetArchiveStatus: row.internetArchiveStatus || null,
    runtimeNote: row.proposedRuntime?.conversion || null
  });
}

function categoryFor(row) {
  const group = cleanText(row.groupTitle || row.roiGroup);
  if (group) return `Medium-priority: ${group}`;
  return 'Medium-priority source records';
}

function sourceHierarchyFor(row, title) {
  return ['Books / Tables / Sources', categoryFor(row), row.jurisdiction, row.topic, title].map(cleanText).filter(Boolean);
}

function actionLabel(action) {
  const labels = {
    'new-interactive-map': 'publish source record; convert to interactive map in a later runtime pass',
    'variant-child-map': 'publish source record as candidate child/variant metadata',
    'hold-special-format': 'publish source record; hold runtime conversion pending size/format review',
    'local-authority-batch-review': 'publish source record in local-authority batch; convert only genuinely new/materially different layers later',
    'transport-public-asset-batch-review': 'publish source record in transport/public-asset batch; convert stable layers before operational feeds',
    'enrich-existing-source': 'publish source/provenance enrichment for an existing record',
    'enrich-existing-election': 'publish election source/provenance enrichment',
    'source-download-only': 'publish as source/download record'
  };
  return labels[action] || 'publish as source/provenance record';
}

function classifySourceKind(row, formats) {
  const category = cleanText(row.category).toLowerCase();
  const formatSet = new Set(formats.map((format) => format.toLowerCase()));
  if (row.isSpatial) return 'spatial-source';
  if (category === 'service' || hasAny(formatSet, ['website', 'data portal', 'map hub'])) return 'source';
  if (hasAny(formatSet, ['csv', 'xlsx', 'xls', 'ods', 'px', 'json-stat', 'json', 'xml'])) return 'table';
  if (hasAny(formatSet, ['pdf', 'docx', 'doc', 'txt', 'png', 'jpg', 'jpeg', 'tiff'])) return 'document';
  return 'source';
}

function shortCitationFor(title, providers) {
  return `${providers.join(', ') || 'Source provider'}, ${title}.`;
}

function fullCitationFor(row, title, providers) {
  const providerText = providers.join(', ') || 'Source provider';
  const urlText = row.currentProviderUrl ? ` Current provider URL: ${row.currentProviderUrl}.` : '';
  const waybackText = row.waybackUrl ? ` Wayback capture index: ${row.waybackUrl}.` : '';
  return `${providerText}. ${title}. Medium-priority Civgraph publication source record generated from D: drive audit and staging review.${urlText}${waybackText}`;
}

function inferYear(value) {
  const match = cleanText(value).match(/\b(18|19|20)\d{2}\b/);
  return match?.[0] || null;
}

function buildSummary(sources) {
  return {
    total: sources.length,
    byGroup: countBy(sources, (source) => source.sourceItems?.[0]?.groupTitle || 'Unknown'),
    byAction: countBy(sources, (source) => source.sourceItems?.[0]?.proposedAction || 'Unknown'),
    byPublicationStatus: countBy(sources, (source) => source.publicationStatus || 'Unknown'),
    byProvider: countBy(sources, (source) => source.provider?.at(-1) || 'Unknown'),
    withProviderUrl: sources.filter((source) => source.url).length,
    withWaybackUrl: sources.filter((source) => source.viewport?.waybackUrl).length,
    spatialSources: sources.filter((source) => source.sourceItems?.[0]?.isSpatial).length,
    runtimeConversionPending: sources.filter((source) => source.statusChips?.includes('Conversion pending')).length,
    residualReviewRows: sources.filter((source) => source.publicationStatus === 'source-record-with-runtime-review').length
  };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = cleanText(selector(item)) || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function dedupeLinks(links) {
  const seen = new Set();
  const out = [];
  for (const link of links) {
    if (!link?.url) continue;
    const key = `${link.role || ''}:${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function compactJoin(parts) {
  return parts.map((part) => Array.isArray(part) ? part.join(', ') : cleanText(part)).filter(Boolean).join(' / ');
}

function hasAny(set, candidates) {
  return candidates.some((candidate) => set.has(candidate.toLowerCase()));
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const text = cleanText(item);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value == null) return false;
    if (Array.isArray(value) && !value.length) return false;
    if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return false;
    if (value === '') return false;
    return true;
  }));
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'item';
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  const match = text.match(/[A-Z]:\\|\\\\|\/Users\/scomo|C:\/Users\/scomo|D:\//i);
  if (match) {
    throw new Error(`Medium-priority publication sidecar contains a local path token: ${match[0]}`);
  }
}
