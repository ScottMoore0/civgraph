#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = process.cwd();
const APPROVAL_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'approval-refinement');
const CATEGORY_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'category-3-publications');
const SOURCE_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'category-3-source-docs-tables');

const SAFE_DAIL_CLASSIFICATIONS = new Set(['safe auto-match', 'encoding/name cleanup']);
const APPROVED_CATEGORY3_ACTIONS = new Set(['publish', 'merge as variant']);

const OUTPUT_DAIL_ALIASES = path.join(ROOT, 'data', 'elections', 'dail-approved-candidate-aliases.json');
const OUTPUT_APPROVED_SOURCES = path.join(ROOT, 'data', 'database', 'approved-publication-sources.json');
const LOCAL_PATH_RE = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;

main();

function main() {
  const validationReport = readJson(path.join(APPROVAL_ROOT, 'refinement-validation-report.json'));
  const dailRows = readJson(path.join(APPROVAL_ROOT, 'dail-candidate-match-row-actions.json'));
  const dailReviews = readJson(path.join(APPROVAL_ROOT, 'dail-candidate-match-review.json'));
  const draftRows = readJson(path.join(APPROVAL_ROOT, 'category3-improved-draft-pages.json'));
  const variantProposals = readJson(path.join(APPROVAL_ROOT, 'category3-variant-parent-proposals.json'));
  const publishBatches = readJson(path.join(APPROVAL_ROOT, 'category3-publish-approval-batches.json'));
  const publicationActions = readJson(path.join(CATEGORY_ROOT, 'publication-approval-actions.json')).records || [];
  const draftPages = readJson(path.join(CATEGORY_ROOT, 'draft-source-and-metadata-pages.json')).records || [];
  const provenanceDrafts = readJson(path.join(SOURCE_ROOT, 'provenance-drafts.json')).records || [];

  const dailAliases = buildDailAliases(dailRows, dailReviews, validationReport);
  const approvedSources = buildApprovedSources({
    draftRows,
    variantProposals,
    publishBatches,
    publicationActions,
    draftPages,
    provenanceDrafts,
    validationReport
  });

  writeStableGeneratedJson(OUTPUT_DAIL_ALIASES, dailAliases);
  writeStableGeneratedJson(OUTPUT_APPROVED_SOURCES, approvedSources);

  console.log(`Wrote ${dailAliases.aliases.length} approved Dail candidate aliases covering ${dailAliases.counts.sourceRows} source rows.`);
  console.log(`Wrote ${approvedSources.sources.length} approved Category 3 Browse source records (${approvedSources.counts.publish} publish, ${approvedSources.counts.variants} variants).`);
}

function buildDailAliases(rowActions, reviewGroups, validationReport) {
  const approvedRows = rowActions.filter((row) => SAFE_DAIL_CLASSIFICATIONS.has(cleanText(row.proposedClassification).toLowerCase()));
  const quarantinedRows = rowActions.filter((row) => !SAFE_DAIL_CLASSIFICATIONS.has(cleanText(row.proposedClassification).toLowerCase()));
  const approvedRowsByReviewKey = new Map();
  for (const row of approvedRows) {
    const key = dailAliasKey(row.electionId, row.sourceConstituency, row.sourceCandidateName);
    if (!approvedRowsByReviewKey.has(key)) approvedRowsByReviewKey.set(key, []);
    approvedRowsByReviewKey.get(key).push(row);
  }

  const aliases = reviewGroups
    .filter((review) => SAFE_DAIL_CLASSIFICATIONS.has(cleanText(review.proposedClassification).toLowerCase()))
    .map((review) => {
      const key = dailAliasKey(review.electionId, review.sourceConstituency, review.sourceCandidateName);
      const sourceRows = approvedRowsByReviewKey.get(key) || [];
      return compactObject({
        aliasId: `dail-candidate-alias:${slugify(review.reviewId || key)}`,
        electionId: review.electionId,
        electionDate: String(review.electionId || '').split('__').at(1) || null,
        sourceConstituency: review.sourceConstituency,
        sourceCandidateName: review.sourceCandidateName,
        canonicalConstituency: review.proposedCanonicalConstituency,
        canonicalConstituencyId: review.proposedCanonicalConstituencyId,
        canonicalCandidateName: review.proposedCandidateName,
        canonicalCandidateId: review.proposedCandidateId,
        canonicalParty: decodeCommonMojibake(review.proposedParty),
        classification: review.proposedClassification,
        confidence: review.confidence,
        proposedAlias: decodeCommonMojibake(review.proposedAlias),
        exactMergeTarget: review.exactMergeTarget,
        sourceRowCount: sourceRows.length || review.sourceRowCount || null,
        sourceRowIds: sourceRows.map((row) => row.sourceRowId),
        rationale: review.rationale
      });
    })
    .sort((a, b) => (a.electionId || '').localeCompare(b.electionId || '')
      || (a.canonicalConstituency || '').localeCompare(b.canonicalConstituency || '')
      || (a.canonicalCandidateName || '').localeCompare(b.canonicalCandidateName || ''));

  const sourceRows = approvedRows.map((row) => compactObject({
    sourceRowId: row.sourceRowId,
    electionId: row.electionId,
    sourceConstituency: row.sourceConstituency,
    sourceCandidateName: row.sourceCandidateName,
    sourceTableKind: row.sourceTableKind,
    sourceCountNumber: row.sourceCountNumber,
    canonicalConstituency: row.proposedCanonicalConstituency,
    canonicalConstituencyId: row.proposedCanonicalConstituencyId,
    canonicalCandidateName: row.proposedCandidateName,
    canonicalCandidateId: row.proposedCandidateId,
    classification: row.proposedClassification,
    confidence: row.confidence,
    exactMergeTarget: row.exactMergeTarget
  }));

  const countsByClassification = countBy(rowActions, (row) => cleanText(row.proposedClassification).toLowerCase() || 'unknown');
  const aliasCountsByClassification = countBy(aliases, (alias) => cleanText(alias.classification).toLowerCase() || 'unknown');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      approvalPack: relativePath(APPROVAL_ROOT),
      validationReportGeneratedAt: validationReport.generatedAt || null
    },
    approvalPolicy: 'Only safe auto-match and encoding/name cleanup Dail candidate decisions are applied. Probable matches and human-decision rows remain quarantined.',
    counts: {
      sourceRows: approvedRows.length,
      aliases: aliases.length,
      byClassification: countsByClassification,
      aliasGroupsByClassification: aliasCountsByClassification,
      quarantinedRows: quarantinedRows.length
    },
    aliases,
    sourceRows,
    quarantinedClassifications: Object.fromEntries(Object.entries(countsByClassification).filter(([key]) => !SAFE_DAIL_CLASSIFICATIONS.has(key)))
  };
}

function buildApprovedSources(inputs) {
  const draftRowsById = new Map(inputs.draftRows.map((row) => [row.rowId, row]));
  const actionById = new Map(inputs.publicationActions.map((record) => [record.stagingId, record]));
  const draftPageById = new Map(inputs.draftPages.map((record) => [record.stagingId, record]));
  const provenanceById = new Map(inputs.provenanceDrafts.map((record) => [record.stagingId, record]));
  const batchByRowId = new Map();
  for (const batch of inputs.publishBatches) {
    for (const rowId of batch.rowIds || []) batchByRowId.set(rowId, batch);
  }
  const variantByDraftKey = new Map();
  for (const variant of inputs.variantProposals) {
    const key = category3TitleProviderKey(variant.title, variant.provider);
    if (!variantByDraftKey.has(key)) variantByDraftKey.set(key, []);
    variantByDraftKey.get(key).push(variant);
  }

  const publishRecords = inputs.draftRows
    .filter((row) => cleanText(row.recommendedAction).toLowerCase() === 'publish')
    .map((row) => sourceRecordFromDraft(row, {
      action: actionById.get(row.rowId),
      draftPage: draftPageById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      batch: batchByRowId.get(row.rowId),
      variant: null
    }));

  const variantRecords = [];
  for (const [variantIndex, variant] of inputs.variantProposals.entries()) {
    const candidates = variantByDraftKey.get(category3TitleProviderKey(variant.title, variant.provider)) || [];
    const matchedDraft = candidates
      .map((proposal) => inputs.draftRows.find((row) => category3TitleProviderKey(row.displayTitle, row.provider) === category3TitleProviderKey(proposal.title, proposal.provider)))
      .find(Boolean)
      || inputs.draftRows.find((row) => category3TitleProviderKey(row.displayTitle, row.provider) === category3TitleProviderKey(variant.title, variant.provider));
    const row = matchedDraft || {
      rowId: `variant-${slugify(`${variant.provider}-${variant.title}`)}`,
      recommendedAction: 'merge as variant',
      displayTitle: variant.title,
      pageType: 'source',
      topic: 'variant',
      provider: variant.provider,
      proposedBrowsePath: 'Browse/Sources as variant',
      shortSummary: `Variant source candidate for ${variant.proposedParentTitle || variant.proposedParentId}.`,
      reviewState: 'approval-ready'
    };
    variantRecords.push(sourceRecordFromDraft(row, {
      action: actionById.get(row.rowId),
      draftPage: draftPageById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      batch: null,
      variant,
      variantIndex
    }));
  }

  const sources = [...publishRecords, ...variantRecords]
    .filter((source) => APPROVED_CATEGORY3_ACTIONS.has(source.approval?.recommendedAction))
    .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.title.localeCompare(b.title));

  const excluded = countBy(inputs.draftRows.filter((row) => !APPROVED_CATEGORY3_ACTIONS.has(cleanText(row.recommendedAction).toLowerCase())), (row) => cleanText(row.recommendedAction).toLowerCase() || 'unknown');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      approvalPack: relativePath(APPROVAL_ROOT),
      categoryPublicationPack: relativePath(CATEGORY_ROOT),
      sourcePreparationPack: relativePath(SOURCE_ROOT),
      validationReportGeneratedAt: inputs.validationReport.generatedAt || null
    },
    approvalPolicy: 'User approved publication of approval-ready Category 3 publish batches and variant proposals. Holds, citation-only rows, and needs-decision rows are excluded.',
    counts: {
      publish: publishRecords.length,
      variants: variantRecords.length,
      total: sources.length,
      excluded
    },
    sources
  };
}

function sourceRecordFromDraft(row, context) {
  const action = context.action || {};
  const draftPage = context.draftPage || {};
  const provenance = context.provenance || {};
  const sourceType = row.proposedMetadataPageFields?.sourceType || draftPage.category || row.pageType || action.publicationType || 'source';
  const isVariant = Boolean(context.variant);
  const recommendedAction = isVariant ? 'merge as variant' : cleanText(row.recommendedAction).toLowerCase();
  const idPrefix = isVariant ? 'approved-variant' : 'approved-publication';
  const id = isVariant
    ? `${idPrefix}:${row.rowId}:${slugify(context.variant.proposedParentId || context.variant.proposedParentTitle || context.variant.title || context.variantIndex)}:${context.variantIndex + 1}`
    : `${idPrefix}:${row.rowId}`;
  const references = sanitizeReferences([draftPage.references, provenance.references].flat());
  const downloads = sanitizeDownloads([draftPage.downloads, provenance.downloads].flat());
  const provider = uniqueStrings([
    ...normalizeArray(draftPage.provider),
    action.organisation,
    row.provider,
    action.provider,
    provenance.organisation,
    provenance.provider
  ].map(publicProviderName));
  const title = sanitizePublicText(row.displayTitle || draftPage.title || action.title || row.rowId);
  const topic = cleanText(row.topic || draftPage.category || action.publicationType || sourceType);
  const placement = sanitizePublicText(row.proposedBrowsePath || action.placement || draftPage.proposedBrowsePath || 'Browse/Sources');
  const category = isVariant
    ? 'Approved source variants'
    : sourceCategoryFor(sourceType, placement, topic);
  return compactObject({
    id,
    slug: stableSlug(id),
    type: isVariant ? 'approved-variant-source' : `approved-${slugify(sourceType)}-source`,
    title,
    subtitle: compactJoin([provider.join(', '), topic, placement]),
    category,
    date: extractYear(title),
    provider,
    description: sanitizePublicText(compactJoin([row.shortSummary || draftPage.summary || action.actionReason, action.actionReason && action.actionReason !== row.shortSummary ? action.actionReason : null])),
    url: references.find((ref) => ref.url)?.url || downloads.find((link) => link.url)?.url || null,
    references,
    downloads,
    keywords: uniqueStrings([
      topic,
      sourceType,
      publicProviderName(row.provider),
      action.sourceResolutionStatus,
      recommendedAction,
      isVariant ? 'variant' : 'approved-publication'
    ].flatMap((item) => String(item || '').split(/[,\s/]+/))).filter((item) => item.length > 2),
    sourceItems: buildSourceItems(references, downloads),
    proposedBrowsePath: placement,
    publicationStatus: 'approved-staged',
    approval: compactObject({
      stagingId: row.rowId,
      recommendedAction,
      batchId: context.batch?.batchId || null,
      reviewState: row.reviewState || draftPage.reviewState || 'approval-ready',
      sourceResolutionStatus: action.sourceResolutionStatus || provenance.sourceResolutionStatus,
      sourceResolutionConfidence: action.sourceResolutionConfidence || provenance.confidence,
      defaultAction: action.defaultAction || provenance.recommendedDefault,
      defaultConfidence: action.defaultConfidence
    }),
    variantOf: isVariant ? compactObject({
      id: context.variant.proposedParentId,
      title: context.variant.proposedParentTitle,
      relationship: context.variant.relationship || 'variant',
      confidence: context.variant.confidence,
      rationale: context.variant.rationale,
      existingSiteMatches: context.variant.existingSiteMatches
    }) : null,
    parentId: context.variant?.proposedParentId || null,
    parentTitle: context.variant?.proposedParentTitle || null,
    relationship: context.variant?.relationship || null,
    duplicateCount: normalizeArray(action.duplicateGroupIds).length || normalizeArray(context.variant?.duplicateGroupIds).length || null
  });
}

function sanitizeReferences(items) {
  const seen = new Set();
  const output = [];
  for (const item of normalizeArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const url = item.url || item.href || item.sourceUrl;
    if (!isPublicUrl(url)) continue;
    const key = `${url}|${item.label || item.title || item.name || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compactObject({
      label: cleanText(item.label || item.title || item.name || url),
      url,
      source: item.source || null,
      role: item.role || null,
      status: item.status || null,
      type: item.type || null
    }));
  }
  return output;
}

function sanitizeDownloads(items) {
  const seen = new Set();
  const output = [];
  for (const item of normalizeArray(items)) {
    if (!item || typeof item !== 'object') continue;
    const url = item.sourceUrl || item.url || item.href;
    if (!isPublicUrl(url)) continue;
    const label = cleanText(item.label || item.title || item.name || fileLabel(url));
    const key = `${url}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compactObject({
      label,
      url,
      type: item.format || item.type || null,
      bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null
    }));
  }
  return output;
}

function buildSourceItems(references, downloads) {
  return [
    ...references.map((reference) => compactObject({ kind: 'reference', label: reference.label, url: reference.url, source: reference.source })),
    ...downloads.map((download) => compactObject({ kind: 'download', label: download.label, url: download.url, type: download.type, bytes: download.bytes }))
  ];
}

function sourceCategoryFor(sourceType, placement, topic) {
  const type = cleanText(sourceType).toLowerCase();
  const place = cleanText(placement).toLowerCase();
  if (type.includes('book') || place.includes('book')) return 'Approved books';
  if (type.includes('table') || place.includes('table')) return 'Approved tables';
  if (topic) return `Approved ${topic} sources`;
  return 'Approved sources';
}

function publicProviderName(value) {
  const text = cleanText(value);
  if (!text) return '';
  if (LOCAL_PATH_RE.test(text) || /^local\b/i.test(text)) return 'Local source staging';
  return sanitizePublicText(text);
}

function sanitizePublicText(value) {
  return cleanText(value)
    .replace(LOCAL_PATH_RE, 'Local source staging')
    .replace(/\b[A-Z]:\\[^\s,;|]+/g, 'local source mirror')
    .replace(/\b[A-Z]:\\\b/g, 'local source mirror')
    .replace(/\s+/g, ' ')
    .trim();
}

function category3TitleProviderKey(title, provider) {
  return `${slugify(provider || '')}|${slugify(title || '')}`;
}

function dailAliasKey(electionId, constituency, candidateName) {
  return `${electionId || ''}|${slugify(constituency || '')}|${slugify(candidateName || '')}`;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function decodeCommonMojibake(value) {
  return cleanText(value)
    .replace(/Sinn FÃ©in/g, 'Sinn Fein')
    .replace(/Fianna FÃ¡il/g, 'Fianna Fail')
    .replace(/DÃ¡il/g, 'Dail');
}

function extractYear(value) {
  const match = String(value || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match?.[1] || null;
}

function fileLabel(value) {
  const text = cleanText(value);
  const last = text.split(/[\\/]/).pop() || text;
  return last.split('?')[0] || text || 'Source';
}

function isPublicUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of normalizeArray(values).flat()) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function compactJoin(parts) {
  return normalizeArray(parts)
    .flat()
    .map(cleanText)
    .filter(Boolean)
    .join(' / ') || null;
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

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function stableSlug(value, maxLength = 120) {
  const slug = slugify(value);
  if (slug.length <= maxLength) return slug;
  const hash = createHash('sha1').update(String(value)).digest('hex').slice(0, 10);
  return `${slug.slice(0, maxLength - hash.length - 1).replace(/-+$/g, '')}-${hash}`;
}

function relativePath(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function readJson(file) {
  if (!existsSync(file)) throw new Error(`Missing required approval input: ${path.relative(ROOT, file)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
