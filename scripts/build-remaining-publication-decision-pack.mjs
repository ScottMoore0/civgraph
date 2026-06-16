#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = process.cwd();
const APPROVAL_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'approval-refinement');
const CATEGORY_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'category-3-publications');
const SOURCE_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'category-3-source-docs-tables');
const OUT_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'remaining-decision-pack');
const SAFE_DAIL = new Set(['safe auto-match', 'encoding/name cleanup']);
const LOCAL_PATH_RE = /(?:^|[^A-Za-z])(?:[A-Z]:[\\/]|\\\\[^\\/])/i;

main();

function main() {
  mkdirSync(OUT_ROOT, { recursive: true });

  const dailReview = readJson(path.join(APPROVAL_ROOT, 'dail-candidate-match-review.json'));
  const dailRows = readJson(path.join(APPROVAL_ROOT, 'dail-candidate-match-row-actions.json'));
  const dailPatchRecords = readJson(path.join(APPROVAL_ROOT, 'dail-proposed-patch-records.json'));
  const dailMergeTargets = readJson(path.join(APPROVAL_ROOT, 'dail-merge-targets.json'));

  const catDrafts = readJson(path.join(APPROVAL_ROOT, 'category3-improved-draft-pages.json'));
  const catSpatialHolds = readJson(path.join(APPROVAL_ROOT, 'category3-spatial-hold-inspection.json'));
  const duplicateEvidence = readJson(path.join(APPROVAL_ROOT, 'category3-existing-duplicate-evidence.json'));
  const variants = readJson(path.join(APPROVAL_ROOT, 'category3-variant-parent-proposals.json'));
  const approvedSources = readJson(path.join(ROOT, 'data', 'database', 'approved-publication-sources.json')).sources || [];
  const publicationActions = (readJson(path.join(CATEGORY_ROOT, 'publication-approval-actions.json')).records || []);
  const provenanceDrafts = (readJson(path.join(SOURCE_ROOT, 'provenance-drafts.json')).records || []);

  const dailPack = buildDailDecisionPack({ dailReview, dailRows, dailPatchRecords, dailMergeTargets });
  const categoryPack = buildCategory3DecisionPack({ catDrafts, catSpatialHolds, duplicateEvidence, variants, publicationActions, provenanceDrafts, approvedSources });
  const providerAudit = buildProviderAuditScratchReview();
  const mergeDeploy = buildMergeDeployValidationReport({ dailPack, categoryPack });
  const uploadDryRun = buildUploadDryRunManifest({ categoryPack, approvedSources });
  const validation = buildValidationReport({ dailPack, categoryPack, providerAudit, mergeDeploy, uploadDryRun });

  writeJson('dail-remaining-match-recommendations.json', dailPack.matchRecommendations);
  writeCsv('dail-remaining-match-recommendations.csv', dailPack.matchRecommendations);
  writeJson('dail-remaining-patch-records.json', dailPack.remainingPatchRecords);
  writeCsv('dail-remaining-patch-records.csv', dailPack.remainingPatchRecords.map(patchRecordCsvRow));
  writeJson('dail-final-alias-approval-candidates.json', dailPack.aliasApprovalCandidates);
  writeCsv('dail-final-alias-approval-candidates.csv', dailPack.aliasApprovalCandidates);
  writeJson('dail-remaining-merge-targets.json', dailPack.remainingMergeTargets);
  writeCsv('dail-remaining-merge-targets.csv', dailPack.remainingMergeTargets.map(mergeTargetCsvRow));

  writeJson('category3-remaining-source-recommendations.json', categoryPack.remainingSourceRecommendations);
  writeCsv('category3-remaining-source-recommendations.csv', categoryPack.remainingSourceRecommendations);
  writeJson('category3-next-approval-bundles.json', categoryPack.nextApprovalBundles);
  writeCsv('category3-next-approval-bundles.csv', categoryPack.nextApprovalBundles);
  writeJson('category3-provenance-placement-previews.json', categoryPack.provenancePlacementPreviews);
  writeCsv('category3-provenance-placement-previews.csv', categoryPack.provenancePlacementPreviews);
  writeJson('category3-duplicate-variant-evidence-expanded.json', categoryPack.duplicateVariantEvidence);
  writeCsv('category3-duplicate-variant-evidence-expanded.csv', categoryPack.duplicateVariantEvidence);

  writeJson('provider-audit-scratch-review.json', providerAudit);
  writeText('provider-audit-scratch-review.md', providerAuditMarkdown(providerAudit));
  writeJson('merge-deploy-validation-report.json', mergeDeploy);
  writeText('merge-deploy-validation-report.md', mergeDeployMarkdown(mergeDeploy));
  writeJson('r2-cdn-dry-run-manifest.json', uploadDryRun);
  writeCsv('r2-cdn-dry-run-manifest.csv', uploadDryRun.items);
  writeJson('validation-report.json', validation);
  writeText('README.md', readmeMarkdown({ dailPack, categoryPack, providerAudit, mergeDeploy, uploadDryRun, validation }));

  console.log(`Wrote remaining publication decision pack to ${relativePath(OUT_ROOT)}`);
  console.log(`Dail withheld review groups: ${dailPack.counts.reviewGroups}; rows: ${dailPack.counts.sourceRows}; recommended auto-alias candidates: ${dailPack.counts.recommendedAutoAliasCandidates}`);
  console.log(`Category 3 excluded rows reviewed: ${categoryPack.counts.remainingRows}`);
  console.log(`Upload dry-run items: ${uploadDryRun.items.length}`);
}

function buildDailDecisionPack({ dailReview, dailRows, dailPatchRecords, dailMergeTargets }) {
  const remainingReviews = dailReview
    .filter((review) => !SAFE_DAIL.has(clean(review.proposedClassification)))
    .map((review) => {
      const rowIds = new Set(review.sourceRowIds || []);
      const rows = dailRows.filter((row) => rowIds.has(row.sourceRowId));
      const recommendation = recommendDailReview(review);
      return {
        reviewId: review.reviewId,
        electionId: review.electionId,
        sourceConstituency: decodeCommonMojibake(review.sourceConstituency),
        sourceCandidateName: decodeCommonMojibake(review.sourceCandidateName),
        sourceRowCount: rows.length || review.sourceRowCount || 0,
        currentClassification: review.proposedClassification,
        confidence: review.confidence,
        proposedAction: recommendation.action,
        recommendationBand: recommendation.band,
        evidenceStrength: recommendation.evidenceStrength,
        proposedAlias: decodeCommonMojibake(review.proposedAlias),
        proposedCanonicalConstituency: decodeCommonMojibake(review.proposedCanonicalConstituency),
        proposedCandidateName: decodeCommonMojibake(review.proposedCandidateName),
        proposedCandidateId: review.proposedCandidateId,
        proposedParty: decodeCommonMojibake(review.proposedParty),
        exactMergeTarget: review.exactMergeTarget,
        alternativeSummary: summarizeAlternatives(review.alternatives),
        reason: recommendation.reason,
        reviewerInstruction: recommendation.reviewerInstruction,
        sourceRowIds: [...rowIds].join('; ')
      };
    })
    .sort((a, b) => actionSort(a.proposedAction).localeCompare(actionSort(b.proposedAction))
      || (b.confidence || 0) - (a.confidence || 0)
      || a.electionId.localeCompare(b.electionId)
      || a.sourceCandidateName.localeCompare(b.sourceCandidateName));

  const remainingRowIds = new Set(remainingReviews.flatMap((review) => splitList(review.sourceRowIds)));
  const remainingPatchRecords = dailPatchRecords
    .filter((record) => remainingRowIds.has(record.sourceRowId))
    .map((record) => ({
      ...sanitizeForPublic(record),
      applyStatus: 'hold-pending-candidate-alias-approval',
      approvalBlocker: 'candidate-alias-review',
      recommendedNextStep: 'Apply only after the corresponding Dail remaining match recommendation is approved.'
    }));
  const remainingMergeTargets = dailMergeTargets
    .filter((record) => remainingRowIds.has(record.sourceRowId))
    .map((record) => ({
      ...sanitizeForPublic(record),
      mergeStatus: 'blocked-by-candidate-alias-review',
      recommendedNextStep: 'Use as evidence for approval; do not merge automatically.'
    }));
  const aliasApprovalCandidates = remainingReviews
    .filter((review) => ['approve alias after spot-check', 'approve encoding alias', 'probable alias - user approval required'].includes(review.proposedAction))
    .map((review) => ({
      aliasId: `pending:${slugify(review.reviewId)}`,
      electionId: review.electionId,
      sourceConstituency: review.sourceConstituency,
      sourceCandidateName: review.sourceCandidateName,
      canonicalConstituency: review.proposedCanonicalConstituency,
      canonicalCandidateName: review.proposedCandidateName,
      canonicalCandidateId: review.proposedCandidateId,
      canonicalParty: review.proposedParty,
      confidence: review.confidence,
      proposedAction: review.proposedAction,
      evidenceStrength: review.evidenceStrength,
      approvalDefault: review.proposedAction === 'approve encoding alias' ? 'approve-if-source-row-text-is-mojibake' : 'spot-check-before-approve',
      sourceRowIds: review.sourceRowIds
    }));

  return {
    counts: {
      reviewGroups: remainingReviews.length,
      sourceRows: remainingRowIds.size,
      patchRecords: remainingPatchRecords.length,
      mergeTargets: remainingMergeTargets.length,
      recommendedAutoAliasCandidates: aliasApprovalCandidates.length,
      byAction: countBy(remainingReviews, (row) => row.proposedAction),
      byCurrentClassification: countBy(remainingReviews, (row) => row.currentClassification)
    },
    matchRecommendations: remainingReviews,
    remainingPatchRecords,
    remainingMergeTargets,
    aliasApprovalCandidates
  };
}

function recommendDailReview(review) {
  const sourceName = decodeCommonMojibake(review.sourceCandidateName || '');
  const canonical = decodeCommonMojibake(review.proposedCandidateName || '');
  const sourceHadMojibake = containsMojibake(review.sourceCandidateName || '');
  const sameConstituency = normalizeName(review.sourceConstituency) === normalizeName(review.proposedCanonicalConstituency)
    || constituencyAliasEquivalent(review.sourceConstituency, review.proposedCanonicalConstituency);
  const nameSimilarity = similarity(normalizeName(sourceName), normalizeName(canonical));
  const confidence = Number(review.confidence || 0);
  const alternatives = review.alternatives || [];
  const nextAltScore = Number(alternatives[0]?.score || 0);
  const margin = confidence - nextAltScore;

  if (clean(review.proposedClassification) === 'probable match' && confidence >= 0.9 && sameConstituency && margin >= 0.4) {
    return {
      action: 'approve alias after spot-check',
      band: 'probable-safe',
      evidenceStrength: 'high',
      reason: 'The candidate is in the same/aliased constituency, the match confidence is high, and alternatives are weak.',
      reviewerInstruction: 'Approve as an alias unless a source check shows this is a distinct candidate.'
    };
  }
  if (sourceHadMojibake && sameConstituency && canonical && confidence >= 0.55) {
    return {
      action: 'approve encoding alias',
      band: 'encoding-cleanup',
      evidenceStrength: confidence >= 0.7 ? 'high' : 'medium',
      reason: 'The source text contains mojibake/encoding damage and points to an accented live candidate in the same/aliased constituency.',
      reviewerInstruction: 'Approve if the source row is just corrupted text for the proposed canonical candidate.'
    };
  }
  if (sameConstituency && confidence >= 0.72 && margin >= 0.25) {
    return {
      action: 'probable alias - user approval required',
      band: 'probable',
      evidenceStrength: 'medium',
      reason: 'Same/aliased constituency with a plausible match, but not strong enough for automatic application.',
      reviewerInstruction: 'Spot-check the candidate name in the source before approving.'
    };
  }
  if (!sameConstituency) {
    return {
      action: 'reject current match and rematch',
      band: 'reject-current-target',
      evidenceStrength: 'low',
      reason: 'The proposed target is not in the same or aliased constituency.',
      reviewerInstruction: 'Do not approve this alias. Re-run matching with stricter constituency constraints or inspect the source manually.'
    };
  }
  return {
    action: 'needs manual source check',
    band: 'manual',
    evidenceStrength: confidence >= 0.65 ? 'medium' : 'low',
    reason: 'The match is plausible but below the threshold needed for a safe automatic alias.',
    reviewerInstruction: 'Check the official table/Wikipedia/Oireachtas source and approve, reject, or add a corrected canonical candidate.'
  };
}

function buildCategory3DecisionPack({ catDrafts, catSpatialHolds, duplicateEvidence, variants, publicationActions, provenanceDrafts, approvedSources }) {
  const remainingDrafts = catDrafts.filter((row) => !['publish', 'merge as variant'].includes(clean(row.recommendedAction)));
  const holdById = new Map(catSpatialHolds.map((row) => [row.rowId, row]));
  const duplicateById = new Map(duplicateEvidence.map((row) => [row.rowId, row]));
  const provenanceById = new Map(provenanceDrafts.map((row) => [row.stagingId, row]));
  const actionById = new Map(publicationActions.map((row) => [row.stagingId, row]));

  const remainingSourceRecommendations = remainingDrafts
    .map((row) => category3Recommendation(row, {
      hold: holdById.get(row.rowId),
      duplicate: duplicateById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      action: actionById.get(row.rowId)
    }))
    .sort((a, b) => actionSort(a.recommendedNextAction).localeCompare(actionSort(b.recommendedNextAction)) || a.title.localeCompare(b.title));

  const nextApprovalBundles = Object.values(groupBy(remainingSourceRecommendations, (row) => [
    row.recommendedNextAction,
    row.provider,
    row.topic,
    row.proposedPlacement
  ].join('|'))).map((items, index) => ({
    bundleId: `remaining-cat3-${String(index + 1).padStart(3, '0')}`,
    recommendedNextAction: items[0].recommendedNextAction,
    provider: items[0].provider,
    topic: items[0].topic,
    proposedPlacement: items[0].proposedPlacement,
    rowCount: items.length,
    totalBytes: sum(items.map((item) => item.bytes)),
    sampleTitles: items.slice(0, 8).map((item) => item.title).join(' | '),
    rowIds: items.map((item) => item.rowId).join('; ')
  }));

  const provenancePlacementPreviews = remainingSourceRecommendations.map((row) => ({
    rowId: row.rowId,
    title: row.title,
    provider: row.provider,
    sourcePageType: row.sourcePageType,
    proposedPlacement: row.proposedPlacement,
    recommendedNextAction: row.recommendedNextAction,
    sourceVisibility: row.sourceVisibility,
    provenanceSummary: row.provenanceSummary,
    downloadSummary: row.downloadSummary,
    browseTreatment: row.browseTreatment,
    publicationBlocker: row.publicationBlocker
  }));

  const duplicateVariantEvidence = duplicateEvidence.map((row) => {
    const recommendation = category3Recommendation(catDrafts.find((draft) => draft.rowId === row.rowId) || row, {
      duplicate: row,
      hold: holdById.get(row.rowId),
      provenance: provenanceById.get(row.rowId),
      action: actionById.get(row.rowId)
    });
    return {
      rowId: row.rowId,
      title: row.title,
      provider: row.provider,
      proposedDecision: row.proposedDecision,
      recommendedNextAction: recommendation.recommendedNextAction,
      confidence: recommendation.confidence,
      rationale: recommendation.rationale,
      strongestExistingMatch: strongestMatch(row.existingSiteMatches),
      existingSiteMatches: summarizeExistingMatches(row.existingSiteMatches),
      duplicateGroupIds: normalizeArray(row.duplicateGroupIds).join('; '),
      sourceUrl: sanitizePublicText(row.sourceUrl)
    };
  });

  return {
    counts: {
      remainingRows: remainingSourceRecommendations.length,
      holds: remainingSourceRecommendations.filter((row) => row.originalAction === 'hold').length,
      needsDecision: remainingSourceRecommendations.filter((row) => row.originalAction === 'needs decision').length,
      citationOnly: remainingSourceRecommendations.filter((row) => row.originalAction === 'citation-only').length,
      byRecommendation: countBy(remainingSourceRecommendations, (row) => row.recommendedNextAction),
      alreadyApprovedSources: approvedSources.length,
      variantProposalsAlreadyApproved: variants.length
    },
    remainingSourceRecommendations,
    nextApprovalBundles,
    provenancePlacementPreviews,
    duplicateVariantEvidence
  };
}

function category3Recommendation(row, context) {
  const action = clean(row.recommendedAction || context.action?.recommendedAction);
  const hold = context.hold || {};
  const duplicate = context.duplicate || {};
  const provenance = context.provenance || {};
  const title = sanitizePublicText(row.displayTitle || row.title || row.rowId);
  const provider = sanitizePublicText(row.provider || duplicate.provider || context.action?.provider || 'Unknown provider');
  const sourceType = sanitizePublicText(hold.sourceType || row.pageType || row.proposedMetadataPageFields?.sourceType || 'source');
  const topic = sanitizePublicText(row.topic || 'general-reference');
  const formats = sanitizePublicText(hold.formats || inferFormatsFromDownload(row.downloadSummary));
  const bytes = Number(hold.totalBytes || row.bytes || duplicate.bytes || 0) || 0;
  const strongest = strongestMatch(duplicate.existingSiteMatches);
  const isSpatial = /(geojson|shp|shapefile|gml|gpkg|geopackage|kml|kmz|filegdb|arcgis|feature)/i.test(`${formats} ${row.downloadSummary || ''}`);
  const isTable = /table|csv|xlsx|ods|pxstat|json/i.test(`${sourceType} ${formats} ${row.downloadSummary || ''}`);
  const isLarge = bytes >= 250 * 1024 * 1024;

  let recommendedNextAction = 'needs user decision';
  let confidence = 'medium';
  let browseTreatment = 'Hold until reviewed.';
  let publicationBlocker = 'needs explicit decision';
  let rationale = 'The row was deliberately excluded from approved publication and needs a reviewer decision.';

  if (action === 'citation-only') {
    recommendedNextAction = 'citation-only source page';
    confidence = 'high';
    browseTreatment = 'Add only as a source/reference page if it is cited by another record; do not create a standalone table or map entry yet.';
    publicationBlocker = 'needs parent citation target';
    rationale = 'No usable download or standalone Browse object was identified; this is useful mainly as citation/provenance.';
  } else if (action === 'hold' && isSpatial && !isLarge && isTable) {
    recommendedNextAction = 'publish table/source now; defer interactive map';
    confidence = 'medium-high';
    browseTreatment = 'Publish as a source/table with downloads and provenance; create interactive PMTiles later only after semantic/geography checks.';
    publicationBlocker = 'semantic/geography staging before map conversion';
    rationale = 'Small supported spatial/table formats are present, but the content is statistical/source data where table semantics matter before interactive-map promotion.';
  } else if (action === 'hold' && isSpatial && isLarge) {
    recommendedNextAction = 'download-only or source-reference; user size decision required';
    confidence = 'medium';
    browseTreatment = 'Keep as source/download reference unless the user approves conversion/storage for the large spatial asset.';
    publicationBlocker = 'large file/format decision';
    rationale = 'Spatial data exists, but size makes automatic interactive conversion/storage risky.';
  } else if (action === 'hold' && isTable) {
    recommendedNextAction = 'publish table/source after metadata spot-check';
    confidence = 'medium-high';
    browseTreatment = 'Publish as table/source, not as an interactive map.';
    publicationBlocker = 'metadata/source-title spot-check';
    rationale = 'This looks like a table/source publication rather than a new map layer.';
  } else if (action === 'needs decision' && strongest.score >= 1.0) {
    recommendedNextAction = 'merge as variant or citation for existing record';
    confidence = 'high';
    browseTreatment = 'Attach to the strongest existing map/source record rather than publishing as a new standalone record.';
    publicationBlocker = 'confirm duplicate versus provider variant';
    rationale = 'Existing-site evidence contains a high-scoring same-title/source-family match.';
  } else if (action === 'needs decision' && strongest.score >= 0.7) {
    recommendedNextAction = 'probable variant - user approval required';
    confidence = 'medium';
    browseTreatment = 'Treat as a likely variant/child record if the provider/date/format differs; otherwise reject as duplicate.';
    publicationBlocker = 'duplicate/variant decision';
    rationale = 'There are plausible existing-site matches, but not enough evidence to auto-merge.';
  }

  return {
    rowId: row.rowId,
    title,
    provider,
    originalAction: action,
    recommendedNextAction,
    confidence,
    sourcePageType: sourceType,
    topic,
    formats,
    bytes,
    coverage: sanitizePublicText(hold.coverage || ''),
    proposedPlacement: sanitizePublicText(row.proposedBrowsePath || 'Browse/Sources'),
    sourceVisibility: recommendedNextAction.includes('citation') ? 'source/reference only' : 'browse-visible after approval',
    browseTreatment,
    publicationBlocker,
    rationale,
    strongestExistingMatch: strongest.summary,
    provenanceSummary: sanitizePublicText(row.provenanceSummary || provenance.provenanceSummary || provider),
    downloadSummary: sanitizePublicText(row.downloadSummary || ''),
    reviewerInstruction: reviewerInstructionForCategory3(recommendedNextAction)
  };
}

function buildProviderAuditScratchReview() {
  const auditDir = path.join(ROOT, 'data', 'provider-mirror-audit');
  const scriptPath = path.join(ROOT, 'scripts', 'audit-provider-mirrors.mjs');
  const files = [];
  if (existsSync(auditDir)) {
    for (const name of readdirSync(auditDir).sort()) {
      const full = path.join(auditDir, name);
      if (!statSync(full).isFile()) continue;
      files.push({
        path: relativePath(full),
        bytes: statSync(full).size,
        kind: name.endsWith('.md') ? 'human-readable summary' : 'local mirror inventory/report',
        recommendedAction: name === 'provider-mirror-audit.md' ? 'commit sanitized summary only if needed' : 'ignore or move to local scratch',
        rationale: name.endsWith('.json')
          ? 'JSON inventories can include local mirror paths and are large/generated; keep out of public git unless explicitly sanitized.'
          : 'The markdown summary is useful, but should be regenerated from a parameterized script and checked for local paths before committing.'
      });
    }
  }
  const scriptExists = existsSync(scriptPath);
  const scriptText = scriptExists ? readFileSync(scriptPath, 'utf8') : '';
  return {
    generatedAt: new Date().toISOString(),
    status: files.length || scriptExists ? 'scratch-present' : 'no-scratch-found',
    files,
    script: {
      path: relativePath(scriptPath),
      exists: scriptExists,
      bytes: scriptExists ? statSync(scriptPath).size : 0,
      containsHardCodedLocalDriveRoots: /D:\\/.test(scriptText),
      recommendedAction: scriptExists ? 'generalize then commit, or keep ignored until generalized' : 'none',
      rationale: scriptExists
        ? 'The script is useful and repeatable, but currently has local drive roots as defaults. Best next step is parameterize roots via environment/options before committing it.'
        : 'No provider mirror audit script exists.'
    },
    recommendation: {
      immediate: 'Do not commit the JSON inventories. Add an ignore rule or move them to a local scratch directory if they keep cluttering git status.',
      preservation: 'Keep the audit script locally for now; commit it only after replacing hard-coded local roots with configurable provider root arguments.',
      deletion: 'Do not delete the scratch until you confirm the audit has been superseded or archived locally.'
    }
  };
}

function buildMergeDeployValidationReport({ dailPack, categoryPack }) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }) || 'unknown';
  const head = git(['rev-parse', 'HEAD'], { allowFailure: true }) || 'unknown';
  const status = git(['status', '--short'], { allowFailure: true });
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFailure: true }) || null;
  return {
    generatedAt: new Date().toISOString(),
    branch,
    upstream,
    head,
    dirtyWorkingTree: Boolean(status.trim()),
    statusSummary: status.trim().split('\n').filter(Boolean).map(sanitizePublicText),
    mergeReadiness: status.trim() ? 'not-clean-yet' : 'clean',
    validationCommands: [
      'node scripts/build-remaining-publication-decision-pack.mjs',
      'npm run check:approved-publication',
      'npm run check:external-sources',
      'npm run build:browse',
      'npm run build:test2:elections',
      'npm run check:test2'
    ],
    deploymentDryRun: {
      livePublication: 'not performed',
      r2Uploads: 'not performed',
      cloudflarePagesDeployment: 'not performed',
      reason: 'This pass prepares review/approval outputs only.'
    },
    blockersBeforeMerge: [
      `${dailPack.counts.reviewGroups} Dail candidate review groups remain withheld from automatic application.`,
      `${categoryPack.counts.remainingRows} Category 3 rows remain excluded from approved publication.`,
      'Provider mirror audit scratch remains untracked and should be ignored, moved, or generalized before merging if a perfectly clean tree is required.'
    ]
  };
}

function buildUploadDryRunManifest({ categoryPack, approvedSources }) {
  const items = [];
  for (const source of approvedSources) {
    items.push({
      itemId: source.id,
      title: source.title,
      phase: 'approved-source-record',
      recommendedUploadAction: 'none',
      target: 'external/source metadata only',
      reason: 'Approved record uses Browse/source metadata and existing external/source download references; no R2 object is required in this branch.'
    });
  }
  for (const row of categoryPack.remainingSourceRecommendations) {
    if (!/(interactive|large|download-only|source-reference)/i.test(`${row.recommendedNextAction} ${row.browseTreatment}`)) continue;
    items.push({
      itemId: row.rowId,
      title: row.title,
      phase: 'excluded-row-dry-run',
      recommendedUploadAction: r2ActionFor(row),
      target: r2TargetFor(row),
      estimatedBytes: row.bytes || '',
      format: row.formats,
      reason: row.rationale,
      blocker: row.publicationBlocker
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    policy: 'Dry-run only. No files are uploaded and no CDN manifests are changed.',
    counts: {
      items: items.length,
      noUpload: items.filter((item) => item.recommendedUploadAction === 'none').length,
      possibleFutureUpload: items.filter((item) => item.recommendedUploadAction !== 'none').length
    },
    items
  };
}

function buildValidationReport({ dailPack, categoryPack, providerAudit, mergeDeploy, uploadDryRun }) {
  const outputs = [
    dailPack.matchRecommendations,
    dailPack.remainingPatchRecords,
    dailPack.aliasApprovalCandidates,
    dailPack.remainingMergeTargets,
    categoryPack.remainingSourceRecommendations,
    categoryPack.nextApprovalBundles,
    categoryPack.provenancePlacementPreviews,
    categoryPack.duplicateVariantEvidence,
    providerAudit,
    mergeDeploy,
    uploadDryRun
  ];
  const localLeak = outputs.some((output) => containsLocalPath(output));
  const errors = [];
  if (localLeak) errors.push('Generated decision pack contains a local filesystem path.');
  if (dailPack.counts.sourceRows !== 173) errors.push(`Expected 173 withheld Dail source rows, found ${dailPack.counts.sourceRows}.`);
  if (categoryPack.counts.remainingRows !== 31) errors.push(`Expected 31 remaining Category 3 rows, found ${categoryPack.counts.remainingRows}.`);
  return {
    generatedAt: new Date().toISOString(),
    status: errors.length ? 'fail' : 'pass',
    errors,
    counts: {
      dail: dailPack.counts,
      category3: categoryPack.counts,
      providerAuditScratchFiles: providerAudit.files.length,
      uploadDryRun: uploadDryRun.counts
    }
  };
}

function patchRecordCsvRow(record) {
  return {
    patchId: record.patchId,
    sourceRowId: record.sourceRowId,
    electionId: record.electionId,
    tableKind: record.tableKind,
    patchKind: record.patchKind,
    targetPath: record.targetPath,
    applyStatus: record.applyStatus,
    approvalBlocker: record.approvalBlocker,
    availableFields: normalizeArray(record.availableFields).join('; '),
    missingRequestedFields: normalizeArray(record.missingRequestedFields).join('; '),
    recommendedNextStep: record.recommendedNextStep
  };
}

function mergeTargetCsvRow(record) {
  return {
    sourceRowId: record.sourceRowId,
    electionId: record.electionId,
    mergeStatus: record.mergeStatus,
    targetPath: record.exactMergeTarget || record.targetPath,
    sourceCandidateName: decodeCommonMojibake(record.sourceCandidateName),
    proposedCandidateName: decodeCommonMojibake(record.proposedCandidateName),
    recommendedNextStep: record.recommendedNextStep
  };
}

function reviewerInstructionForCategory3(action) {
  if (action.includes('defer interactive map')) return 'Approve table/source publication first; open a separate map-conversion ticket only after geography/semantic QA.';
  if (action.includes('download-only')) return 'Ask user to approve storage/format handling before any R2 or PMTiles work.';
  if (action.includes('merge as variant')) return 'Confirm parent record, then attach as variant/citation rather than standalone.';
  if (action.includes('citation-only')) return 'Approve only if there is a parent record that should cite this source.';
  if (action.includes('metadata spot-check')) return 'Spot-check title/provider/downloads, then publish as table/source.';
  return 'Needs explicit user/product decision.';
}

function r2ActionFor(row) {
  if (/large file/.test(row.publicationBlocker)) return 'possible-future-upload-after-user-size-approval';
  if (/semantic\/geography/.test(row.publicationBlocker)) return 'possible-future-pmtiles-after-data-staging';
  return 'none';
}

function r2TargetFor(row) {
  if (/pmtiles|interactive|spatial|map/i.test(`${row.recommendedNextAction} ${row.browseTreatment}`)) return `r2://boundaries-data/proposed/${slugify(row.title)}.pmtiles`;
  return 'external/download-reference';
}

function actionSort(action) {
  const order = [
    'approve alias after spot-check',
    'approve encoding alias',
    'probable alias - user approval required',
    'publish table/source after metadata spot-check',
    'publish table/source now; defer interactive map',
    'merge as variant or citation for existing record',
    'probable variant - user approval required',
    'citation-only source page',
    'download-only or source-reference; user size decision required',
    'needs manual source check',
    'needs user decision',
    'reject current match and rematch'
  ];
  const idx = order.indexOf(action);
  return `${String(idx < 0 ? 99 : idx).padStart(2, '0')}:${action}`;
}

function strongestMatch(matches) {
  const sorted = normalizeArray(matches)
    .map((match) => ({
      id: match.id || '',
      title: match.title || '',
      score: Number(match.score || 0),
      raw: match.raw || ''
    }))
    .sort((a, b) => b.score - a.score);
  const top = sorted[0] || { id: '', title: '', score: 0, raw: '' };
  return {
    ...top,
    summary: top.id ? `${top.id} | ${top.title} | score ${top.score}` : ''
  };
}

function summarizeAlternatives(alternatives) {
  return normalizeArray(alternatives).slice(0, 5)
    .map((alt) => `${decodeCommonMojibake(alt.candidateName)} (${decodeCommonMojibake(alt.party || '')}, ${decodeCommonMojibake(alt.constituency || '')}, ${alt.score})`)
    .join(' | ');
}

function summarizeExistingMatches(matches) {
  return normalizeArray(matches).slice(0, 8)
    .map((match) => `${match.id}: ${match.title} (${match.score})`)
    .join(' | ');
}

function inferFormatsFromDownload(value) {
  const text = String(value || '');
  const formats = [];
  for (const fmt of ['csv', 'geojson', 'shapefile', 'shp', 'gml', 'gpkg', 'geopackage', 'kml', 'kmz', 'xlsx', 'ods', 'pdf', 'json', 'xml', 'filegdb']) {
    if (new RegExp(`\\b${escapeRegExp(fmt)}\\b`, 'i').test(text)) formats.push(fmt);
  }
  return formats.join('; ');
}

function groupBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const key = fn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

function countBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const key = fn(item) || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function splitList(value) {
  return String(value || '').split(';').map((item) => item.trim()).filter(Boolean);
}

function clean(value) {
  return String(value || '').trim().toLowerCase();
}

function containsMojibake(value) {
  return /�|Ã|Â|¢|€/u.test(String(value || ''));
}

function decodeCommonMojibake(value) {
  return String(value || '')
    .replace(/�A/g, 'É')
    .replace(/�E/g, 'é')
    .replace(/�I/g, 'í')
    .replace(/�O/g, 'Ó')
    .replace(/�U/g, 'Ú')
    .replace(/�a/g, 'á')
    .replace(/�e/g, 'é')
    .replace(/�i/g, 'í')
    .replace(/�o/g, 'ó')
    .replace(/�u/g, 'ú')
    .replace(/�/g, '');
}

function normalizeName(value) {
  return decodeCommonMojibake(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function constituencyAliasEquivalent(a, b) {
  const aa = normalizeName(a);
  const bb = normalizeName(b);
  const aliases = [
    ['limerick county', 'limerick'],
    ['cavan monaghan', 'cavan monaghan'],
    ['dun laoghaire', 'dun laoghaire'],
    ['laois offaly', 'laois offaly']
  ];
  return aliases.some((group) => group.includes(aa) && group.includes(bb));
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function sanitizePublicText(value) {
  return String(value || '')
    .replace(/[A-Z]:\\[^\s,;|"]+/g, '<local-path>')
    .replace(/[A-Z]:\/[^\s,;|"]+/g, '<local-path>')
    .replace(/\\\\[^\s,;|"]+/g, '<local-path>')
    .replace(/C:\/Users\/[^\s,;|"]+/gi, '<local-path>');
}

function sanitizeForPublic(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeForPublic(entry)]));
  }
  if (typeof value === 'string') return sanitizePublicText(value);
  return value;
}

function containsLocalPath(value) {
  if (Array.isArray(value)) return value.some((item) => containsLocalPath(item));
  if (value && typeof value === 'object') return Object.values(value).some((entry) => containsLocalPath(entry));
  if (typeof value === 'string') return LOCAL_PATH_RE.test(value);
  return false;
}

function slugify(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'item';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(name, data) {
  writeStableGeneratedJson(path.join(OUT_ROOT, name), data);
}

function writeText(name, text) {
  writeFileSync(path.join(OUT_ROOT, name), `${text.trim()}\n`, 'utf8');
}

function writeCsv(name, rows) {
  const file = path.join(OUT_ROOT, name);
  mkdirSync(path.dirname(file), { recursive: true });
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function csvEscape(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function relativePath(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function git(args, options = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (options.allowFailure) return '';
    throw error;
  }
}

function providerAuditMarkdown(report) {
  return `# Provider Audit Scratch Review

Status: ${report.status}

## Recommendation

- Immediate: ${report.recommendation.immediate}
- Preservation: ${report.recommendation.preservation}
- Deletion: ${report.recommendation.deletion}

## Script

- Path: \`${report.script.path}\`
- Exists: ${report.script.exists}
- Hard-coded local drive roots: ${report.script.containsHardCodedLocalDriveRoots}
- Recommendation: ${report.script.recommendedAction}
- Rationale: ${report.script.rationale}

## Generated Scratch Files

${report.files.map((file) => `- \`${file.path}\` (${file.bytes} bytes): ${file.recommendedAction}. ${file.rationale}`).join('\n') || '- None found.'}
`;
}

function mergeDeployMarkdown(report) {
  return `# Merge And Deploy Validation

- Branch: \`${report.branch}\`
- Upstream: \`${report.upstream || 'none'}\`
- Head: \`${report.head}\`
- Working tree dirty: ${report.dirtyWorkingTree}
- Merge readiness: ${report.mergeReadiness}

## Validation Commands

${report.validationCommands.map((cmd) => `- \`${cmd}\``).join('\n')}

## Deployment Dry Run

- Live publication: ${report.deploymentDryRun.livePublication}
- R2 uploads: ${report.deploymentDryRun.r2Uploads}
- Cloudflare Pages deployment: ${report.deploymentDryRun.cloudflarePagesDeployment}
- Reason: ${report.deploymentDryRun.reason}

## Blockers Before Merge

${report.blockersBeforeMerge.map((item) => `- ${item}`).join('\n')}
`;
}

function readmeMarkdown({ dailPack, categoryPack, providerAudit, mergeDeploy, uploadDryRun, validation }) {
  return `# Remaining Publication Decision Pack

Generated by \`scripts/build-remaining-publication-decision-pack.mjs\`.

This pack does not publish data, modify live election bundles, or upload to R2/CDN. It prepares the remaining decisions after the approved publication branch materialised safe Dail aliases and approved Category 3 source records.

## Dail Candidate Matches

- Remaining review groups: ${dailPack.counts.reviewGroups}
- Remaining source rows: ${dailPack.counts.sourceRows}
- Patch records held pending alias approval: ${dailPack.counts.patchRecords}
- Alias candidates worth approving after review: ${dailPack.counts.recommendedAutoAliasCandidates}

Primary files:

- \`dail-remaining-match-recommendations.csv\`
- \`dail-final-alias-approval-candidates.csv\`
- \`dail-remaining-patch-records.csv\`
- \`dail-remaining-merge-targets.csv\`

## Category 3 Remaining Rows

- Remaining excluded rows: ${categoryPack.counts.remainingRows}
- Original holds: ${categoryPack.counts.holds}
- Needs-decision rows: ${categoryPack.counts.needsDecision}
- Citation-only rows: ${categoryPack.counts.citationOnly}

Primary files:

- \`category3-remaining-source-recommendations.csv\`
- \`category3-next-approval-bundles.csv\`
- \`category3-provenance-placement-previews.csv\`
- \`category3-duplicate-variant-evidence-expanded.csv\`

## Provider Audit Scratch

Recommendation: ${providerAudit.recommendation.immediate}

## Merge/Deploy

Merge readiness: ${mergeDeploy.mergeReadiness}

## R2/CDN Dry Run

- Items: ${uploadDryRun.counts.items}
- No-upload metadata/source records: ${uploadDryRun.counts.noUpload}
- Possible future uploads after approval: ${uploadDryRun.counts.possibleFutureUpload}

## Validation

Status: ${validation.status}
`;
}
