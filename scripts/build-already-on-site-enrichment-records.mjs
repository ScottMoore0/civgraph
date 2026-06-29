#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'data', 'review-inputs', 'already-on-site-enrichment-review-2026-06-24.csv');
const OUTPUT = path.join(ROOT, 'data', 'database', 'already-on-site-enrichments.json');

const APPLIED_SAFETY_CLASSES = new Set([
  'safe metadata enrichment candidate',
  'high-confidence enrichment candidate'
]);

const USER_APPROVED_REVIEW_ONLY_ROWS = new Set([
  7, 15, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  31, 51, 52, 53, 54, 70, 86, 88, 89, 90, 91, 92,
  93, 94, 95, 103, 105, 148, 149, 155, 159, 160, 161, 162,
  163, 164, 165, 166, 167, 168, 169, 170, 174, 175, 176, 177,
  178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189,
  239, 240, 241, 247, 263, 279, 283, 284, 285, 286, 287,
  288, 290, 291, 292, 293, 301, 322, 358, 366, 373, 374, 430,
  494, 521, 621, 630, 653, 654, 656, 657, 662, 663, 664, 696,
  697, 702, 703, 704, 705, 706, 707, 708, 709, 714, 715,
  716, 717, 718, 719, 720, 721, 722, 723, 724, 725, 726, 727,
  728, 729, 730, 731, 732, 733, 736, 737, 738, 739, 740, 741,
  744, 745, 746, 747, 748, 749, 750, 751, 752, 753, 754, 755,
  756, 757, 758, 759, 762, 810, 812, 868, 879, 880, 901, 906,
  966, 1000, 1001, 1003, 1005, 1032
]);

const HELD_SAFE_RECOMMENDATION_ROWS = new Set([555, 945]);

const SENSITIVE_PUBLIC_REVIEW_ROWS = new Set([555]);

const STATUTORY_BOUNDARY_FAMILY_ROWS = new Set([
  15, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 53,
  54, 70, 86, 88, 89, 90, 91, 92, 93, 94, 95, 159,
  160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 174,
  175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186,
  187, 188, 189, 239, 240, 263, 290, 291, 292, 293, 702, 703,
  704, 705, 706, 707, 708, 709, 714, 715, 716, 717, 718, 719,
  720, 721, 722, 723, 724, 725, 726, 727, 728, 729, 730, 731,
  732, 733, 736, 737, 738, 739, 740, 741, 744, 745, 746, 747,
  748, 749, 750, 751, 752, 753, 754, 755, 756, 757, 758, 759,
  966
]);

const RESOLVED_ROW_TARGETS = new Map([
  [521, {
    sourceTargetId: 'map-source:roi-local-authorities-2024',
    targetEntityKind: 'map',
    targetEntityId: 'roi-local-authorities-2024',
    targetTitle: 'Local Authorities 2024 source files',
    targetBrowseUrl: '/browse/maps/roi-local-authorities-2024'
  }],
  [1005, {
    sourceTargetId: 'map-source:dcc-dcc-public-cycle-parking-stands',
    targetEntityKind: 'map',
    targetEntityId: 'dcc-dcc-public-cycle-parking-stands',
    targetTitle: 'Public Cycle Parking Stands (DCC) source files',
    targetBrowseUrl: '/browse/maps/dcc-dcc-public-cycle-parking-stands'
  }]
]);

const ROW_PROVIDER_OVERRIDES = new Map([
  [521, 'Tailte Eireann'],
  [1005, 'Dublin City Council']
]);

const ROW_TITLE_OVERRIDES = new Map([
  [521, 'Local Authorities - National Statutory Boundaries - Ungeneralised - 2024'],
  [1005, 'Cycle Parking DCC']
]);

const ROW_PROVIDER_DATASET_URL_OVERRIDES = new Map([
  [521, 'https://data.gov.ie/dataset/local-authorities-national-statutory-boundaries-ungeneralised-20241'],
  [1005, 'https://data.gov.ie/dataset/cycle-parking-dcc']
]);

const ROW_LICENSE_OVERRIDES = new Map([
  [521, {
    title: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/'
  }],
  [1005, {
    title: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/'
  }]
]);

const REVIEW_ONLY_SAFETY_CLASSES = new Set([
  'variant/source enrichment review',
  'context-overlap review only',
  'weak feature-family match'
]);

main();

function main() {
  if (!existsSync(INPUT)) {
    throw new Error(`Missing enrichment review CSV: ${path.relative(ROOT, INPUT)}`);
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8'));
  const appliedRows = rows.filter((row) => shouldApplyRow(row));
  const reviewRows = rows.filter((row) => REVIEW_ONLY_SAFETY_CLASSES.has(cleanText(row.safetyClass)) && !shouldApplyRow(row));
  const publicReviewRows = reviewRows.filter((row) => !SENSITIVE_PUBLIC_REVIEW_ROWS.has(Number(row.rowNumber) || 0));
  const withheldSensitiveReviewRows = Math.max(
    SENSITIVE_PUBLIC_REVIEW_ROWS.size,
    reviewRows.length - publicReviewRows.length
  );
  const sourceReviewRows = rows.length + withheldSensitiveReviewRows;
  const internalReviewRows = publicReviewRows.length + withheldSensitiveReviewRows;
  const groupedTargets = groupAppliedRows(appliedRows);

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceReviewCsv: 'data/review-inputs/already-on-site-enrichment-review-2026-06-24.csv',
    policy: {
      application: 'safe and high-confidence duplicate-match rows enrich existing source records only; user-approved related-source rows enrich existing records or source families as provenance only',
      reviewOnly: 'unapproved variant, context-overlap, weak feature-family, and rights/source-URL-held rows remain staged for review and are not published as factual enrichment',
      approvedRelatedSourceRows: [...USER_APPROVED_REVIEW_ONLY_ROWS].sort((a, b) => a - b),
      heldSafeRecommendationRows: [...HELD_SAFE_RECOMMENDATION_ROWS].filter((rowNumber) => !SENSITIVE_PUBLIC_REVIEW_ROWS.has(rowNumber)).sort((a, b) => a - b),
      statutoryBoundaryFamilyRows: [...STATUTORY_BOUNDARY_FAMILY_ROWS].sort((a, b) => a - b),
      withheldSensitiveReviewRows,
      privacy: 'local filesystem paths are intentionally excluded from this public sidecar'
    },
    summary: {
      inputRows: sourceReviewRows,
      trackedInputRows: rows.length,
      appliedRows: appliedRows.length,
      appliedTargets: groupedTargets.length,
      reviewRows: publicReviewRows.length,
      internalReviewRows,
      withheldSensitiveReviewRows,
      omittedRows: sourceReviewRows - appliedRows.length - internalReviewRows
    },
    targets: groupedTargets,
    reviewRows: publicReviewRows.map(toReviewRow)
  };

  assertNoLocalPaths(output);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} with ${groupedTargets.length} enriched targets from ${appliedRows.length} applied rows; ${publicReviewRows.length} public review rows; ${reviewRows.length - publicReviewRows.length} sensitive review row(s) withheld.`);
}

function shouldApplyRow(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (HELD_SAFE_RECOMMENDATION_ROWS.has(rowNumber)) return false;
  return APPLIED_SAFETY_CLASSES.has(cleanText(row.safetyClass)) || USER_APPROVED_REVIEW_ONLY_ROWS.has(rowNumber);
}

function groupAppliedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const target = chooseTarget(row);
    const key = target.sourceTargetId;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTargetId: target.sourceTargetId,
        targetEntityKind: target.targetEntityKind,
        targetEntityId: target.targetEntityId,
        targetTitle: target.targetTitle,
        targetBrowseUrl: target.targetBrowseUrl,
        sourceRecordBrowseUrl: sourceRecordBrowseUrlForTarget(target.sourceTargetId),
        evidence: [],
        sourceItems: [],
        safetyClasses: [],
        enrichmentTypes: [],
        formats: [],
        providers: [],
        categories: [],
        rowNumbers: []
      });
    }
    const group = groups.get(key);
    group.evidence.push(...parseTargetEvidence(row.targetEvidence));
    group.sourceItems.push(toSourceItem(row));
    addUnique(group.safetyClasses, cleanText(row.safetyClass));
    addMany(group.enrichmentTypes, splitList(row.enrichmentTypes, ';'));
    addMany(group.formats, splitList(row.formats, '|'));
    addUnique(group.providers, publicText(row.provider, 'Local source mirror'));
    addUnique(group.categories, publicText(row.category, 'Local source'));
    addUnique(group.rowNumbers, Number(row.rowNumber) || cleanText(row.rowNumber));
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      evidence: dedupeEvidence(group.evidence).slice(0, 12),
      sourceItems: group.sourceItems.sort((a, b) => Number(a.auditRowNumber) - Number(b.auditRowNumber)),
      confidence: group.safetyClasses.includes('safe metadata enrichment candidate') ? 'safe' : 'high-confidence',
      sourceItemCount: group.sourceItems.length
    }))
    .sort((a, b) => a.targetTitle.localeCompare(b.targetTitle) || a.sourceTargetId.localeCompare(b.sourceTargetId));
}

function sourceRecordBrowseUrlForTarget(sourceTargetId) {
  if (String(sourceTargetId || '').startsWith('already-on-site-family:')) return null;
  return `/browse/sources/${encodeURIComponent(slugify(sourceTargetId))}`;
}

function chooseTarget(row) {
  const resolvedTarget = RESOLVED_ROW_TARGETS.get(Number(row.rowNumber) || 0);
  if (resolvedTarget) return resolvedTarget;

  const statutoryTarget = chooseApprovedStatutoryBoundaryFamilyTarget(row);
  if (statutoryTarget) return statutoryTarget;

  const evidence = parseTargetEvidence(row.targetEvidence);
  const sourceEvidence = evidence.find((item) => item.kind === 'browse-source');
  if (sourceEvidence) {
    return {
      sourceTargetId: sourceEvidence.id,
      targetEntityKind: inferEntityKindFromSourceId(sourceEvidence.id),
      targetEntityId: inferEntityIdFromSourceId(sourceEvidence.id),
      targetTitle: sourceEvidence.title || cleanText(row.title),
      targetBrowseUrl: browseUrlForSourceTarget(sourceEvidence.id)
    };
  }

  const mapEvidence = evidence.find((item) => item.kind === 'database-map' || item.kind === 'browse-map');
  if (mapEvidence) {
    return {
      sourceTargetId: `map-source:${mapEvidence.id}`,
      targetEntityKind: 'map',
      targetEntityId: mapEvidence.id,
      targetTitle: mapEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/maps/${encodeURIComponent(mapEvidence.id)}`
    };
  }

  const tableEvidence = evidence.find((item) => item.kind === 'browse-table' || item.kind === 'database-table');
  if (tableEvidence) {
    return {
      sourceTargetId: `table:${tableEvidence.id}`,
      targetEntityKind: 'table',
      targetEntityId: tableEvidence.id,
      targetTitle: tableEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/sources/${encodeURIComponent(slugify(`table:${tableEvidence.id}`))}`
    };
  }

  const featureEvidence = evidence.find((item) => item.kind === 'browse-feature');
  if (featureEvidence) {
    return {
      sourceTargetId: `feature-source:${featureEvidence.id}`,
      targetEntityKind: 'feature-group',
      targetEntityId: featureEvidence.id,
      targetTitle: featureEvidence.title || cleanText(row.title),
      targetBrowseUrl: `/browse/features?map=${encodeURIComponent(featureEvidence.id)}`
    };
  }

  const fallbackId = `already-on-site-enrichment:${row.rowNumber || slugify(row.title)}`;
  return {
    sourceTargetId: fallbackId,
    targetEntityKind: 'unknown',
    targetEntityId: fallbackId,
    targetTitle: cleanText(row.title || fallbackId),
    targetBrowseUrl: null
  };
}

function chooseApprovedStatutoryBoundaryFamilyTarget(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (!STATUTORY_BOUNDARY_FAMILY_ROWS.has(rowNumber)) return null;
  return {
    sourceTargetId: 'already-on-site-family:tailte-osi-2019-statutory-boundaries',
    targetEntityKind: 'source-family',
    targetEntityId: 'tailte-osi-2019-statutory-boundaries',
    targetTitle: 'Tailte/OSI 2019 statutory-boundary source family',
    targetBrowseUrl: null
  };
}

function parseTargetEvidence(value) {
  return splitList(value, '|').map((part) => {
    const match = part.match(/^([^:()]+):([^()]+?)(?:\s*\((.*?)(?:;\s*([0-9.]+))?\))?$/);
    if (!match) return null;
    const kind = cleanText(match[1]);
    const id = cleanText(match[2]);
    const title = cleanText(match[3] || '');
    const score = Number(match[4]);
    return compactObject({
      kind,
      id,
      title,
      score: Number.isFinite(score) ? score : null
    });
  }).filter(Boolean);
}

function toSourceItem(row) {
  const rowNumber = Number(row.rowNumber) || cleanText(row.rowNumber);
  const providerDatasetUrl = providerUrlForAuditRow(row);
  const approvedRelatedSource = USER_APPROVED_REVIEW_ONLY_ROWS.has(Number(row.rowNumber) || 0);
  const license = licenseForAuditRow(row);
  return compactObject({
    auditRowNumber: rowNumber,
    title: titleForAuditRow(row),
    provider: providerForAuditRow(row),
    category: publicText(row.category, 'Local source'),
    formats: splitList(row.formats, '|'),
    safetyClass: cleanText(row.safetyClass),
    approvalStatus: approvedRelatedSource ? 'user-approved-related-source-enrichment' : null,
    relationship: approvedRelatedSource ? relationshipForApprovedRow(row) : null,
    providerDatasetUrl,
    licenseTitle: approvedRelatedSource ? license.title : null,
    licenseUrl: approvedRelatedSource ? license.url : null,
    recommendedAction: cleanText(row.cleanedRecommendation || row.recommendedEnrichmentAction),
    sourcePlacement: cleanText(row.sourcePlacement),
    geographyRecommendation: cleanText(row.geographyRecommendation),
    enrichmentTypes: splitList(row.enrichmentTypes, ';'),
    detectedFamilies: splitList(row.detectedFamilies, ';'),
    siteFamiliesPresent: splitList(row.siteFamiliesPresent, ';'),
    refinedStatus: cleanText(row.refinedStatus)
  });
}

function relationshipForApprovedRow(row) {
  if (STATUTORY_BOUNDARY_FAMILY_ROWS.has(Number(row.rowNumber) || 0)) {
    return 'related statutory-boundary source family evidence; not an exact geometry or map-parent equivalence';
  }
  return 'related source/provenance enrichment for the matched existing Civgraph record; not a duplicate parent or runtime-layer approval';
}

function providerUrlForAuditRow(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (ROW_PROVIDER_DATASET_URL_OVERRIDES.has(rowNumber)) {
    return ROW_PROVIDER_DATASET_URL_OVERRIDES.get(rowNumber);
  }
  const provider = cleanText(row.provider).toLowerCase();
  const slug = slugFromAuditPath(row.dPath);
  if (!slug) return null;
  if (provider.includes('open data ni')) return `https://admin.opendatani.gov.uk/dataset/${encodeURIComponent(slug)}`;
  if (provider.includes('data.gov.ie') || provider.includes('tailte') || provider.includes('osi')) return `https://data.gov.ie/dataset/${encodeURIComponent(slug)}`;
  return null;
}

function slugFromAuditPath(value) {
  const text = cleanText(value);
  if (!text || !text.includes('...')) return '';
  const raw = text.split('...').pop().replaceAll('\\', '/').split('/').filter(Boolean).pop() || '';
  return raw.replace(/\.(geojson|json|csv|xlsx?|zip|shp|kml|gpkg)$/i, '').trim();
}

function providerForAuditRow(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (ROW_PROVIDER_OVERRIDES.has(rowNumber)) return ROW_PROVIDER_OVERRIDES.get(rowNumber);
  return publicText(row.provider, 'Local source mirror');
}

function titleForAuditRow(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (ROW_TITLE_OVERRIDES.has(rowNumber)) return ROW_TITLE_OVERRIDES.get(rowNumber);
  return cleanText(row.title);
}

function licenseForAuditRow(row) {
  const rowNumber = Number(row.rowNumber) || 0;
  if (ROW_LICENSE_OVERRIDES.has(rowNumber)) return ROW_LICENSE_OVERRIDES.get(rowNumber);
  return {
    title: licenseTitleForProvider(row.provider),
    url: licenseUrlForProvider(row.provider)
  };
}

function licenseTitleForProvider(provider) {
  const text = cleanText(provider).toLowerCase();
  if (text.includes('open data ni')) return 'UK Open Government Licence (OGL)';
  if (text.includes('data.gov.ie') || text.includes('tailte') || text.includes('osi')) return 'Creative Commons Attribution 4.0';
  return null;
}

function licenseUrlForProvider(provider) {
  const text = cleanText(provider).toLowerCase();
  if (text.includes('open data ni')) return 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
  if (text.includes('data.gov.ie') || text.includes('tailte') || text.includes('osi')) return 'https://creativecommons.org/licenses/by/4.0/';
  return null;
}

function toReviewRow(row) {
  return compactObject({
    auditRowNumber: Number(row.rowNumber) || cleanText(row.rowNumber),
    safetyClass: cleanText(row.safetyClass),
    title: cleanText(row.title),
    provider: publicText(row.provider, 'Local source mirror'),
    category: publicText(row.category, 'Local source'),
    formats: splitList(row.formats, '|'),
    targetIds: splitList(row.targetIds, ';'),
    targetEvidence: parseTargetEvidence(row.targetEvidence),
    recommendedAction: cleanText(row.cleanedRecommendation || row.recommendedEnrichmentAction),
    decisionNeeded: cleanText(row.decisionNeeded),
    sourcePlacement: cleanText(row.sourcePlacement),
    geographyRecommendation: cleanText(row.geographyRecommendation),
    enrichmentTypes: splitList(row.enrichmentTypes, ';'),
    refinedStatus: cleanText(row.refinedStatus)
  });
}

function inferEntityKindFromSourceId(id) {
  if (id.startsWith('map-source:')) return 'map';
  if (id.startsWith('election-source:')) return 'election';
  if (id.startsWith('table:')) return 'table';
  if (id.startsWith('book:')) return 'book';
  return 'source';
}

function inferEntityIdFromSourceId(id) {
  return id.replace(/^(map-source|election-source|table|book):/, '');
}

function browseUrlForSourceTarget(id) {
  if (id.startsWith('map-source:')) return `/browse/maps/${encodeURIComponent(id.replace(/^map-source:/, ''))}`;
  if (id.startsWith('election-source:')) return `/#layers=${encodeURIComponent(id.replace(/^election-source:/, ''))}`;
  return `/browse/sources/${encodeURIComponent(slugify(id))}`;
}

function dedupeEvidence(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data
    .filter((cells) => cells.some((cell) => String(cell || '').trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ''])));
}

function assertNoLocalPaths(value) {
  const text = JSON.stringify(value);
  const match = text.match(/[A-Z]:\\|\\\\|\/Users\/scomo/i);
  if (match) {
    throw new Error(`Public enrichment sidecar contains a local path token: ${match[0]}`);
  }
}

function publicText(value, localFallback = 'Local source mirror') {
  const text = cleanText(value);
  if (!text) return '';
  if (/[A-Z]:\\|\\\\|\/Users\/scomo/i.test(text)) return localFallback;
  return text;
}

function addUnique(list, value) {
  const clean = typeof value === 'number' ? value : cleanText(value);
  if (clean === '' || clean === null || clean === undefined) return;
  if (!list.includes(clean)) list.push(clean);
}

function addMany(list, values) {
  for (const value of values) addUnique(list, value);
}

function splitList(value, separator) {
  return String(value || '')
    .split(separator)
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'item';
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === null || item === undefined || item === '') return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}
