#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = process.cwd();
const APPROVAL_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'approval-refinement');
const CATEGORY_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'category-3-publications');
const SOURCE_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'category-3-source-docs-tables');
const REMAINING_DECISION_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'remaining-decision-pack');

const SAFE_DAIL_CLASSIFICATIONS = new Set(['safe auto-match', 'encoding/name cleanup']);
const APPROVED_CATEGORY3_ACTIONS = new Set(['publish', 'merge as variant']);
const APPROVED_REMAINING_DAIL_ACTIONS = new Set(['approve alias after spot-check', 'approve encoding alias']);
const APPROVED_REMAINING_CATEGORY3_ACTIONS = new Set([
  'publish table/source now; defer interactive map',
  'merge as variant or citation for existing record'
]);

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
  const remainingDailAliasCandidates = readJson(path.join(REMAINING_DECISION_ROOT, 'dail-final-alias-approval-candidates.json'));
  const remainingDailMatchRecommendations = readJson(path.join(REMAINING_DECISION_ROOT, 'dail-remaining-match-recommendations.json'));
  const remainingCategoryRows = readJson(path.join(REMAINING_DECISION_ROOT, 'category3-remaining-source-recommendations.json'));
  const remainingVariantEvidence = readJson(path.join(REMAINING_DECISION_ROOT, 'category3-duplicate-variant-evidence-expanded.json'));
  const remainingBundles = readJson(path.join(REMAINING_DECISION_ROOT, 'category3-next-approval-bundles.json'));

  const dailAliases = buildDailAliases(dailRows, dailReviews, validationReport, {
    remainingDailAliasCandidates,
    remainingDailMatchRecommendations
  });
  const approvedSources = buildApprovedSources({
    draftRows,
    variantProposals,
    publishBatches,
    publicationActions,
    draftPages,
    provenanceDrafts,
    validationReport,
    remainingCategoryRows,
    remainingVariantEvidence,
    remainingBundles
  });

  writeStableGeneratedJson(OUTPUT_DAIL_ALIASES, dailAliases);
  writeStableGeneratedJson(OUTPUT_APPROVED_SOURCES, approvedSources);

  console.log(`Wrote ${dailAliases.aliases.length} approved Dail candidate aliases covering ${dailAliases.counts.sourceRows} source rows.`);
  console.log(`Wrote ${approvedSources.sources.length} approved Category 3 Browse source records (${approvedSources.counts.publish} publish, ${approvedSources.counts.variants} variants).`);
}

function buildDailAliases(rowActions, reviewGroups, validationReport, remainingInputs = {}) {
  const remainingDailAliasCandidates = normalizeArray(remainingInputs.remainingDailAliasCandidates);
  const remainingDailMatchRecommendations = normalizeArray(remainingInputs.remainingDailMatchRecommendations);
  const approvedRemainingCandidates = remainingDailAliasCandidates
    .filter((candidate) => APPROVED_REMAINING_DAIL_ACTIONS.has(cleanText(candidate.proposedAction).toLowerCase()));
  const approvedRemainingSourceIds = new Set(approvedRemainingCandidates.flatMap((candidate) => splitSourceRowIds(candidate.sourceRowIds)));
  const rowActionsById = new Map(rowActions.map((row) => [row.sourceRowId, row]));
  const approvedRows = rowActions.filter((row) => SAFE_DAIL_CLASSIFICATIONS.has(cleanText(row.proposedClassification).toLowerCase()));
  const remainingApprovedRows = approvedRemainingCandidates.flatMap((candidate) => {
    const classification = remainingDailClassification(candidate.proposedAction);
    return splitSourceRowIds(candidate.sourceRowIds).map((sourceRowId) => {
      const existingRow = rowActionsById.get(sourceRowId) || {};
      return compactObject({
        ...existingRow,
        sourceRowId,
        electionId: existingRow.electionId || candidate.electionId,
        sourceConstituency: existingRow.sourceConstituency || candidate.sourceConstituency,
        sourceCandidateName: existingRow.sourceCandidateName || candidate.sourceCandidateName,
        sourceTableKind: existingRow.sourceTableKind,
        sourceCountNumber: existingRow.sourceCountNumber,
        proposedCanonicalConstituency: existingRow.proposedCanonicalConstituency || candidate.canonicalConstituency,
        proposedCanonicalConstituencyId: existingRow.proposedCanonicalConstituencyId,
        proposedCandidateName: existingRow.proposedCandidateName || candidate.canonicalCandidateName,
        proposedCandidateId: existingRow.proposedCandidateId || candidate.canonicalCandidateId,
        proposedParty: existingRow.proposedParty || candidate.canonicalParty,
        proposedClassification: classification,
        confidence: existingRow.confidence || candidate.confidence,
        exactMergeTarget: existingRow.exactMergeTarget,
        approvedFromRemainingDecision: candidate.proposedAction
      });
    });
  });
  const approvedSourceRows = [...approvedRows, ...remainingApprovedRows];
  const quarantinedRows = rowActions.filter((row) => {
    const classification = cleanText(row.proposedClassification).toLowerCase();
    return !SAFE_DAIL_CLASSIFICATIONS.has(classification) && !approvedRemainingSourceIds.has(row.sourceRowId);
  });
  const approvedRowsByReviewKey = new Map();
  for (const row of approvedSourceRows) {
    const key = dailAliasKey(row.electionId, row.sourceConstituency, row.sourceCandidateName);
    if (!approvedRowsByReviewKey.has(key)) approvedRowsByReviewKey.set(key, []);
    approvedRowsByReviewKey.get(key).push(row);
  }

  const initialAliases = reviewGroups
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
    });
  const remainingAliases = approvedRemainingCandidates.map((candidate) => {
    const key = dailAliasKey(candidate.electionId, candidate.sourceConstituency, candidate.sourceCandidateName);
    const sourceRows = approvedRowsByReviewKey.get(key) || [];
    return compactObject({
      aliasId: `dail-candidate-alias:${slugify(candidate.aliasId || key)}`,
      electionId: candidate.electionId,
      electionDate: String(candidate.electionId || '').split('__').at(1) || null,
      sourceConstituency: candidate.sourceConstituency,
      sourceCandidateName: decodeCommonMojibake(candidate.sourceCandidateName),
      canonicalConstituency: candidate.canonicalConstituency,
      canonicalCandidateName: decodeCommonMojibake(candidate.canonicalCandidateName),
      canonicalCandidateId: candidate.canonicalCandidateId,
      canonicalParty: decodeCommonMojibake(candidate.canonicalParty),
      classification: remainingDailClassification(candidate.proposedAction),
      confidence: candidate.confidence,
      proposedAlias: decodeCommonMojibake(`${candidate.sourceCandidateName} -> ${candidate.canonicalCandidateName}`),
      sourceRowCount: sourceRows.length || splitSourceRowIds(candidate.sourceRowIds).length || null,
      sourceRowIds: sourceRows.map((row) => row.sourceRowId),
      rationale: compactJoin([candidate.proposedAction, candidate.evidenceStrength, candidate.approvalDefault]),
      approval: compactObject({
        source: 'remaining-decision-pack',
        proposedAction: candidate.proposedAction,
        evidenceStrength: candidate.evidenceStrength,
        approvalDefault: candidate.approvalDefault
      })
    });
  });
  const aliases = [...initialAliases, ...remainingAliases]
    .sort((a, b) => (a.electionId || '').localeCompare(b.electionId || '')
      || (a.canonicalConstituency || '').localeCompare(b.canonicalConstituency || '')
      || (a.canonicalCandidateName || '').localeCompare(b.canonicalCandidateName || ''));

  const sourceRows = approvedSourceRows.map((row) => compactObject({
    sourceRowId: row.sourceRowId,
    electionId: row.electionId,
    sourceConstituency: row.sourceConstituency,
    sourceCandidateName: decodeCommonMojibake(row.sourceCandidateName),
    sourceTableKind: row.sourceTableKind,
    sourceCountNumber: row.sourceCountNumber,
    canonicalConstituency: row.proposedCanonicalConstituency,
    canonicalConstituencyId: row.proposedCanonicalConstituencyId,
    canonicalCandidateName: decodeCommonMojibake(row.proposedCandidateName),
    canonicalCandidateId: row.proposedCandidateId,
    classification: row.proposedClassification,
    confidence: row.confidence,
    exactMergeTarget: row.exactMergeTarget,
    approvedFromRemainingDecision: row.approvedFromRemainingDecision
  }));

  const countsByClassification = countBy(sourceRows, (row) => cleanText(row.classification).toLowerCase() || 'unknown');
  const reviewPackCountsByClassification = countBy(rowActions, (row) => cleanText(row.proposedClassification).toLowerCase() || 'unknown');
  const aliasCountsByClassification = countBy(aliases, (alias) => cleanText(alias.classification).toLowerCase() || 'unknown');
  const heldProbableRows = remainingDailAliasCandidates
    .filter((candidate) => cleanText(candidate.proposedAction).toLowerCase() === 'probable alias - user approval required')
    .flatMap((candidate) => splitSourceRowIds(candidate.sourceRowIds));
  const rejectedRematches = remainingDailMatchRecommendations
    .filter((recommendation) => cleanText(recommendation.proposedAction).toLowerCase() === 'reject current match and rematch');
  const rejectedRematchRows = rejectedRematches.flatMap((recommendation) => splitSourceRowIds(recommendation.sourceRowIds));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      approvalPack: relativePath(APPROVAL_ROOT),
      remainingDecisionPack: relativePath(REMAINING_DECISION_ROOT),
      validationReportGeneratedAt: validationReport.generatedAt || null
    },
    approvalPolicy: 'Safe auto-match and encoding/name cleanup Dail candidate decisions are applied, plus user-approved remaining spot-check and encoding aliases. Probable aliases and rejected/rematch rows remain quarantined.',
    counts: {
      sourceRows: sourceRows.length,
      aliases: aliases.length,
      byClassification: countsByClassification,
      reviewPackByClassification: reviewPackCountsByClassification,
      aliasGroupsByClassification: aliasCountsByClassification,
      quarantinedRows: quarantinedRows.length,
      remainingApprovedSourceRows: remainingApprovedRows.length
    },
    aliases,
    sourceRows,
    quarantinedClassifications: countBy(quarantinedRows, (row) => cleanText(row.proposedClassification).toLowerCase() || 'unknown'),
    remainingDecisions: compactObject({
      approvedGroups: approvedRemainingCandidates.length,
      approvedSourceRows: remainingApprovedRows.length,
      heldProbableAliasGroups: remainingDailAliasCandidates.filter((candidate) => cleanText(candidate.proposedAction).toLowerCase() === 'probable alias - user approval required').length,
      heldProbableSourceRows: heldProbableRows.length,
      rejectedRematchGroups: rejectedRematches.length,
      rejectedRematchSourceRows: rejectedRematchRows.length,
      rejectedRematches: rejectedRematches.map((recommendation) => compactObject({
        reviewId: recommendation.reviewId,
        electionId: recommendation.electionId,
        sourceConstituency: recommendation.sourceConstituency,
        sourceCandidateName: recommendation.sourceCandidateName,
        proposedAlias: recommendation.proposedAlias,
        proposedCanonicalConstituency: recommendation.proposedCanonicalConstituency,
        reviewerInstruction: recommendation.reviewerInstruction
      }))
    })
  };
}

function buildApprovedSources(inputs) {
  const remainingCategoryRows = normalizeArray(inputs.remainingCategoryRows);
  const remainingVariantEvidence = normalizeArray(inputs.remainingVariantEvidence);
  const draftRowsById = new Map(inputs.draftRows.map((row) => [row.rowId, row]));
  const actionById = new Map(inputs.publicationActions.map((record) => [record.stagingId, record]));
  const draftPageById = new Map(inputs.draftPages.map((record) => [record.stagingId, record]));
  const provenanceById = new Map(inputs.provenanceDrafts.map((record) => [record.stagingId, record]));
  const batchByRowId = new Map();
  for (const batch of inputs.publishBatches) {
    for (const rowId of batch.rowIds || []) batchByRowId.set(rowId, batch);
  }
  const remainingBatchByRowId = new Map();
  for (const batch of normalizeArray(inputs.remainingBundles)) {
    for (const rowId of splitSourceRowIds(batch.rowIds)) remainingBatchByRowId.set(rowId, batch);
  }
  const remainingVariantEvidenceById = new Map(remainingVariantEvidence.map((row) => [row.rowId, row]));
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

  const remainingPublishRows = remainingCategoryRows
    .filter((row) => cleanText(row.recommendedNextAction).toLowerCase() === 'publish table/source now; defer interactive map');
  const remainingVariantRows = remainingCategoryRows
    .filter((row) => cleanText(row.recommendedNextAction).toLowerCase() === 'merge as variant or citation for existing record');
  const remainingPublishRecords = remainingPublishRows.map((remainingRow) => {
    const row = mergeRemainingCategoryDraft(draftRowsById.get(remainingRow.rowId), remainingRow, 'publish');
    return sourceRecordFromDraft(row, {
      action: remainingActionFromRecommendation(remainingRow),
      draftPage: draftPageById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      batch: remainingBatchByRowId.get(row.rowId),
      variant: null
    });
  });
  const remainingVariantRecords = remainingVariantRows.map((remainingRow, variantIndex) => {
    const row = mergeRemainingCategoryDraft(draftRowsById.get(remainingRow.rowId), remainingRow, 'merge as variant');
    const variantEvidence = remainingVariantEvidenceById.get(remainingRow.rowId) || remainingRow;
    return sourceRecordFromDraft(row, {
      action: remainingActionFromRecommendation(remainingRow),
      draftPage: draftPageById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      batch: remainingBatchByRowId.get(row.rowId),
      variant: variantFromRemainingEvidence(variantEvidence, remainingRow),
      variantIndex
    });
  });

  const sources = [...publishRecords, ...variantRecords, ...remainingPublishRecords, ...remainingVariantRecords]
    .filter((source) => APPROVED_CATEGORY3_ACTIONS.has(source.approval?.recommendedAction))
    .sort((a, b) => (a.type || '').localeCompare(b.type || '') || a.title.localeCompare(b.title));

  const remainingApprovedIds = new Set([...remainingPublishRows, ...remainingVariantRows].map((row) => row.rowId));
  const remainingExcluded = countBy(remainingCategoryRows.filter((row) => !remainingApprovedIds.has(row.rowId)), (row) => cleanText(row.recommendedNextAction).toLowerCase() || 'unknown');
  const initiallyExcludedBeforeRemainingApproval = countBy(inputs.draftRows.filter((row) => !APPROVED_CATEGORY3_ACTIONS.has(cleanText(row.recommendedAction).toLowerCase())), (row) => cleanText(row.recommendedAction).toLowerCase() || 'unknown');
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedFrom: {
      approvalPack: relativePath(APPROVAL_ROOT),
      categoryPublicationPack: relativePath(CATEGORY_ROOT),
      sourcePreparationPack: relativePath(SOURCE_ROOT),
      remainingDecisionPack: relativePath(REMAINING_DECISION_ROOT),
      validationReportGeneratedAt: inputs.validationReport.generatedAt || null
    },
    approvalPolicy: 'User approved publication of approval-ready Category 3 publish batches and variant proposals, plus the approved remaining table/source rows and high-confidence variant/citation rows. Probable variants and citation-only source pages remain excluded.',
    counts: {
      publish: publishRecords.length + remainingPublishRecords.length,
      variants: variantRecords.length + remainingVariantRecords.length,
      total: sources.length,
      excluded: remainingExcluded,
      initiallyExcludedBeforeRemainingApproval,
      remainingApproved: {
        publish: remainingPublishRecords.length,
        variants: remainingVariantRecords.length
      }
    },
    sources
  };
}

function mergeRemainingCategoryDraft(draftRow, remainingRow, recommendedAction) {
  return {
    ...(draftRow || {}),
    rowId: remainingRow.rowId,
    recommendedAction,
    displayTitle: remainingRow.title || draftRow?.displayTitle || remainingRow.rowId,
    pageType: remainingRow.sourcePageType || draftRow?.pageType || 'source',
    topic: remainingRow.topic || draftRow?.topic || 'general-reference',
    provider: remainingRow.provider || draftRow?.provider || remainingRow.provenanceSummary,
    proposedBrowsePath: remainingRow.proposedPlacement || draftRow?.proposedBrowsePath || 'Browse/Sources',
    shortSummary: remainingRow.rationale || draftRow?.shortSummary || remainingRow.browseTreatment,
    reviewState: 'user-approved-from-remaining-decision-pack',
    proposedMetadataPageFields: {
      ...(draftRow?.proposedMetadataPageFields || {}),
      sourceType: remainingRow.sourcePageType || draftRow?.proposedMetadataPageFields?.sourceType || remainingRow.topic || 'source'
    }
  };
}

function remainingActionFromRecommendation(remainingRow) {
  return compactObject({
    publicationType: remainingRow.sourcePageType || remainingRow.topic,
    organisation: remainingRow.provenanceSummary || remainingRow.provider,
    provider: remainingRow.provider,
    placement: remainingRow.proposedPlacement,
    title: remainingRow.title,
    sourceResolutionStatus: 'approved-from-remaining-decision-pack',
    sourceResolutionConfidence: remainingRow.confidence,
    defaultAction: remainingRow.browseTreatment || remainingRow.recommendedNextAction,
    defaultConfidence: remainingRow.confidence,
    actionReason: remainingRow.rationale,
    duplicateGroupIds: remainingRow.duplicateGroupIds
  });
}

function variantFromRemainingEvidence(variantEvidence, remainingRow) {
  const strongestMatch = variantEvidence.strongestExistingMatch || remainingRow.strongestExistingMatch || {};
  return compactObject({
    title: variantEvidence.title || remainingRow.title,
    provider: variantEvidence.provider || remainingRow.provider,
    recommendedAction: 'merge as variant',
    relationship: 'variant',
    proposedParentId: strongestMatch.id || remainingRow.strongestExistingMatch?.id,
    proposedParentTitle: strongestMatch.title || remainingRow.strongestExistingMatch?.title,
    confidence: variantEvidence.confidence || remainingRow.confidence,
    rationale: variantEvidence.rationale || remainingRow.rationale,
    existingSiteMatches: variantEvidence.existingSiteMatches,
    duplicateGroupIds: splitSourceRowIds(variantEvidence.duplicateGroupIds || remainingRow.duplicateGroupIds)
  });
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

function remainingDailClassification(action) {
  const normalized = cleanText(action).toLowerCase();
  if (normalized === 'approve alias after spot-check') return 'user-approved spot-check alias';
  if (normalized === 'approve encoding alias') return 'user-approved encoding alias';
  return normalized || 'user-approved alias';
}

function splitSourceRowIds(value) {
  return normalizeArray(value)
    .flatMap((item) => String(item).split(';'))
    .map(cleanText)
    .filter(Boolean);
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function decodeCommonMojibakeLegacy(value) {
  return cleanText(value)
    .replace(/Sinn FÃ©in/g, 'Sinn Fein')
    .replace(/Fianna FÃ¡il/g, 'Fianna Fail')
    .replace(/DÃ¡il/g, 'Dail');
}

function decodeCommonMojibake(value) {
  const text = cleanText(value);
  if (!/[ÃÂ]/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('�')) return decoded;
  } catch {
    // Fall through to conservative literal replacements.
  }
  return text
    .replace(/Sinn FÃƒÂ©in|Sinn FÃ©in/g, 'Sinn Féin')
    .replace(/Fianna FÃƒÂ¡il|Fianna FÃ¡il/g, 'Fianna Fáil')
    .replace(/DÃƒÂ¡il|DÃ¡il/g, 'Dáil');
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
