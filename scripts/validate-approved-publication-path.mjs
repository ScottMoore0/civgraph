#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPROVAL_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'approval-refinement');
const failures = [];

const SAFE_DAIL_CLASSIFICATIONS = new Set([
  'safe auto-match',
  'encoding/name cleanup',
  'user-approved spot-check alias',
  'user-approved encoding alias'
]);
const APPROVED_ACTIONS = new Set(['publish', 'merge as variant']);
const LOCAL_PATH_RE = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;

main();

function main() {
  const validationReport = readJson(path.join(APPROVAL_ROOT, 'refinement-validation-report.json'));
  const dailAliases = readJson(path.join(ROOT, 'data', 'elections', 'dail-approved-candidate-aliases.json'));
  const approvedSources = readJson(path.join(ROOT, 'data', 'database', 'approved-publication-sources.json'));
  const browseSources = readJson(path.join(ROOT, 'data', 'browse', 'sources.json'));

  validateDailAliases(validationReport, dailAliases);
  validateApprovedSources(validationReport, approvedSources);
  validateBrowseMaterialisation(approvedSources, browseSources);

  if (failures.length) {
    console.error('Approved Publication Path Validation');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`PASS: ${dailAliases.aliases.length} Dail aliases and ${approvedSources.sources.length} approved Category 3 source records are materialised and validated.`);
}

function validateDailAliases(validationReport, dailAliases) {
  const expectedSourceRows = 400;
  const expectedAliases = 47;
  assert(dailAliases.schemaVersion === 1, 'Dail approved candidate aliases must have schemaVersion 1.');
  assert(dailAliases.counts?.sourceRows === expectedSourceRows, `Expected ${expectedSourceRows} approved Dail source rows, found ${dailAliases.counts?.sourceRows}.`);
  assert(Array.isArray(dailAliases.aliases) && dailAliases.aliases.length === expectedAliases, `Expected ${expectedAliases} approved Dail alias groups, found ${dailAliases.aliases?.length}.`);
  assert(Array.isArray(dailAliases.sourceRows) && dailAliases.sourceRows.length === expectedSourceRows, `Dail approved sourceRows must contain ${expectedSourceRows} rows.`);
  assert(validationReport.counts?.dailCandidateRowsInput === 443, 'Approval validation report should be the expected 443-row Dail review pack.');
  for (const alias of dailAliases.aliases) {
    const classification = normalizeKey(alias.classification);
    assert(SAFE_DAIL_CLASSIFICATIONS.has(classification), `Unsafe Dail alias classification was published: ${alias.aliasId} / ${alias.classification}.`);
    assert(alias.electionId && alias.sourceCandidateName && alias.canonicalCandidateName, `Dail alias missing required identity fields: ${JSON.stringify(alias).slice(0, 180)}`);
  }
  for (const row of dailAliases.sourceRows) {
    const classification = normalizeKey(row.classification);
    assert(SAFE_DAIL_CLASSIFICATIONS.has(classification), `Unsafe Dail source row was published: ${row.sourceRowId} / ${row.classification}.`);
  }
  const remainingDecisions = dailAliases.remainingDecisions || {};
  assert(remainingDecisions.approvedGroups === 13, `Expected 13 user-approved remaining Dail alias groups, found ${remainingDecisions.approvedGroups}.`);
  assert(remainingDecisions.approvedSourceRows === 130, `Expected 130 user-approved remaining Dail source rows, found ${remainingDecisions.approvedSourceRows}.`);
  assert(remainingDecisions.heldProbableAliasGroups === 3, `Expected 3 held probable Dail alias groups, found ${remainingDecisions.heldProbableAliasGroups}.`);
  assert(remainingDecisions.heldProbableSourceRows === 31, `Expected 31 held probable Dail source rows, found ${remainingDecisions.heldProbableSourceRows}.`);
  assert(remainingDecisions.rejectedRematchGroups === 1, `Expected one rejected/rematch Dail group, found ${remainingDecisions.rejectedRematchGroups}.`);
  assert(remainingDecisions.rejectedRematchSourceRows === 12, `Expected 12 rejected/rematch Dail source rows, found ${remainingDecisions.rejectedRematchSourceRows}.`);
  assert(dailAliases.counts?.quarantinedRows === 43, `Expected 43 Dail rows to remain quarantined, found ${dailAliases.counts?.quarantinedRows}.`);
  const rejectedRematches = remainingDecisions.rejectedRematches || [];
  assert(rejectedRematches.some((row) => row.reviewId === 'dail-candidate-dail-eireann-2020-02-08-dublin-fingal-glenn-brady'), 'The Glenn Brady false match must remain rejected/rematch, not published.');
}

function validateApprovedSources(validationReport, approvedSources) {
  assert(approvedSources.schemaVersion === 1, 'Approved publication sources must have schemaVersion 1.');
  assert(validationReport.counts?.category3PublishRows === 5892, 'Approval validation report should have 5,892 Category 3 publish rows.');
  assert(validationReport.counts?.category3VariantRows === 758, 'Approval validation report should have 758 Category 3 variant rows.');
  assert(approvedSources.counts?.publish === 5912, `Expected 5,912 approved publish records, found ${approvedSources.counts?.publish}.`);
  assert(approvedSources.counts?.variants === 760, `Expected 760 approved variant records, found ${approvedSources.counts?.variants}.`);
  assert(approvedSources.counts?.total === 6672, `Expected 6,672 approved source records, found ${approvedSources.counts?.total}.`);
  assert(Array.isArray(approvedSources.sources) && approvedSources.sources.length === 6672, `Expected 6,672 approved source records in sources array, found ${approvedSources.sources?.length}.`);
  assert(approvedSources.counts?.remainingApproved?.publish === 20, `Expected 20 approved remaining publish records, found ${approvedSources.counts?.remainingApproved?.publish}.`);
  assert(approvedSources.counts?.remainingApproved?.variants === 2, `Expected 2 approved remaining variant records, found ${approvedSources.counts?.remainingApproved?.variants}.`);
  assert(approvedSources.counts?.excluded?.['probable variant - user approval required'] === 5, 'Category 3 probable variants must stay excluded.');
  assert(approvedSources.counts?.excluded?.['citation-only source page'] === 4, 'Category 3 citation-only source pages must stay excluded.');

  const ids = new Set();
  for (const source of approvedSources.sources) {
    assert(source.id && source.title && source.type, `Approved source is missing id/title/type: ${JSON.stringify(source).slice(0, 180)}`);
    assert(!ids.has(source.id), `Duplicate approved source id: ${source.id}`);
    ids.add(source.id);
    assert(APPROVED_ACTIONS.has(source.approval?.recommendedAction), `Unexpected approved source action: ${source.id} / ${source.approval?.recommendedAction}`);
    assert(!LOCAL_PATH_RE.test(JSON.stringify(source)), `Approved source leaks a local filesystem path: ${source.id}`);
    const links = [...(source.references || []), ...(source.downloads || [])];
    for (const link of links) {
      assert(!link.url || /^https?:\/\//i.test(link.url), `Approved source has non-public URL ${source.id}: ${link.url}`);
    }
    if (source.approval?.recommendedAction === 'merge as variant') {
      assert(source.variantOf?.id && source.variantOf?.title, `Variant source missing parent id/title: ${source.id}`);
      assert(source.relationship === 'variant', `Variant source should have relationship=variant: ${source.id}`);
    }
  }
}

function validateBrowseMaterialisation(approvedSources, browseSources) {
  assert(Array.isArray(browseSources.items), 'Browse sources index must contain items.');
  const browseById = new Map(browseSources.items.map((item) => [item.id, item]));
  for (const source of approvedSources.sources) {
    const browseItem = browseById.get(source.id);
    assert(Boolean(browseItem), `Browse sources index is missing approved source ${source.id}.`);
    if (!browseItem) continue;
    assert(browseItem.approval?.recommendedAction === source.approval?.recommendedAction, `Browse source lost approval metadata: ${source.id}`);
    if (source.variantOf) assert(browseItem.variantOf?.id === source.variantOf.id, `Browse source lost variant parent metadata: ${source.id}`);
    const detailPath = path.join(ROOT, 'data', 'browse', 'details', 'sources', `${browseItem.slug || slugify(source.id)}.json`);
    assert(existsSync(detailPath), `Browse source detail file is missing for ${source.id}: ${path.relative(ROOT, detailPath)}`);
  }
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(file) {
  assert(existsSync(file), `Missing required file: ${path.relative(ROOT, file)}`);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}
