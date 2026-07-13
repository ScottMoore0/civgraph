#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBrowseSourceItems } from './lib/browse-source-index.mjs';

const ROOT = process.cwd();
const APPROVAL_ROOT = path.join(ROOT, 'tasks', 'absence-integration-ready-2026-06-15', 'publication-approval-pack', 'approval-refinement');
const failures = [];

const SAFE_DAIL_CLASSIFICATIONS = new Set([
  'safe auto-match',
  'encoding/name cleanup',
  'user-approved spot-check alias',
  'user-approved encoding alias',
  'user-approved probable alias'
]);
const APPROVED_ACTIONS = new Set(['publish', 'merge as variant']);
const LOCAL_PATH_RE = /(?:[A-Z]:\\|\\\\|C:\/Users\/|D:\/)/i;

main();

function main() {
  const validationReport = readJson(path.join(APPROVAL_ROOT, 'refinement-validation-report.json'));
  const dailAliases = readJson(path.join(ROOT, 'data', 'elections', 'dail-approved-candidate-aliases.json'));
  const approvedSources = readJson(path.join(ROOT, 'data', 'database', 'approved-publication-sources.json'));
  const browseSources = readJson(path.join(ROOT, 'data', 'browse', 'sources.json'));
  browseSources.items = resolveBrowseSourceItems(browseSources, ROOT);

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
  const expectedSourceRows = 431;
  const expectedAliases = 50;
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
  assert(remainingDecisions.approvedGroups === 16, `Expected 16 user-approved remaining Dail alias groups, found ${remainingDecisions.approvedGroups}.`);
  assert(remainingDecisions.approvedSourceRows === 161, `Expected 161 user-approved remaining Dail source rows, found ${remainingDecisions.approvedSourceRows}.`);
  assert(remainingDecisions.heldProbableAliasGroups === 3, `Expected 3 original probable Dail alias groups in the decision pack, found ${remainingDecisions.heldProbableAliasGroups}.`);
  assert(remainingDecisions.heldProbableSourceRows === 0, `Expected 0 held probable Dail source rows after user approval, found ${remainingDecisions.heldProbableSourceRows}.`);
  assert(remainingDecisions.rejectedRematchGroups === 1, `Expected one rejected/rematch Dail group, found ${remainingDecisions.rejectedRematchGroups}.`);
  assert(remainingDecisions.rejectedRematchSourceRows === 12, `Expected 12 rejected/rematch Dail source rows, found ${remainingDecisions.rejectedRematchSourceRows}.`);
  assert(dailAliases.counts?.quarantinedRows === 12, `Expected 12 Dail rows to remain quarantined, found ${dailAliases.counts?.quarantinedRows}.`);
  const rejectedRematches = remainingDecisions.rejectedRematches || [];
  assert(rejectedRematches.some((row) => row.reviewId === 'dail-candidate-dail-eireann-2020-02-08-dublin-fingal-glenn-brady'), 'The Glenn Brady false match must remain rejected/rematch, not published.');
  assert(dailAliases.aliases.some((alias) => alias.sourceCandidateName === 'Cordelia Nicfhearraigh' && alias.canonicalCandidateName === 'Cordeila Nic Fhearraigh'), 'Cordelia Nicfhearraigh user-approved alias is missing.');
  assert(dailAliases.aliases.some((alias) => alias.sourceCandidateName === 'Arthur Desmond Mc Guinness' && alias.canonicalCandidateName === 'Arthur McGuinness'), 'Arthur Desmond Mc Guinness user-approved alias is missing.');
  assert(dailAliases.aliases.some((alias) => alias.sourceCandidateName === 'Sheik Mohiuddin Ahmed' && alias.canonicalCandidateName === 'Sheikh Ahmed'), 'Sheik Mohiuddin Ahmed user-approved alias is missing.');
  assert(!dailAliases.aliases.some((alias) => alias.sourceCandidateName === 'Glenn Brady' && alias.canonicalCandidateName === 'John Brady'), 'Glenn Brady must not be published as John Brady.');
}

function validateApprovedSources(validationReport, approvedSources) {
  assert(approvedSources.schemaVersion === 1, 'Approved publication sources must have schemaVersion 1.');
  assert(validationReport.counts?.category3PublishRows === 5892, 'Approval validation report should have 5,892 Category 3 publish rows.');
  assert(validationReport.counts?.category3VariantRows === 758, 'Approval validation report should have 758 Category 3 variant rows.');
  assert(approvedSources.counts?.publish === 5918, `Expected 5,918 approved publish records, found ${approvedSources.counts?.publish}.`);
  assert(approvedSources.counts?.variants === 761, `Expected 761 approved variant records, found ${approvedSources.counts?.variants}.`);
  // Base June Category-3 pack = 6,679 (publish 5,918 + variants 761). Two Category-1
  // census tranches were subsequently approved for publication and land in their own
  // counts buckets, growing the total; cat-3 publish/variants above are asserted
  // unchanged. censusCategory1 = full CSO CC-BY cube tranche; censusNisraOgl = NISRA
  // OGL v3.0 tranche; censusCsoNiCarveout = the 35 CSO-CC-BY-origin cross-border NI
  // cubes (rights confirmed clear 2026-07-07, now published under CC BY 4.0).
  const censusCso = approvedSources.counts?.censusCategory1?.publish || 0;
  const censusNisra = approvedSources.counts?.censusNisraOgl?.publish || 0;
  const censusCsoNiCarveout = approvedSources.counts?.censusCsoNiCarveout?.publish || 0;
  // localAuthoritySources = ready (zero-blocker, non-duplicate) local-authority /
  // data.gov.ie / Open Data NI source-download records; rights confirmed clear 2026-07-07.
  const localAuthoritySources = approvedSources.counts?.localAuthoritySources?.publish || 0;
  // localAuthoritySourcesHeld = the 755 LA rows previously held by the single
  // conservative "duplicate-or-variant-review: no existing match candidate" flag;
  // dedup pass 2026-07-08 confirmed no auto-match / no URL+id collision -> published
  // as distinct. transportPublicAssets + sourceDownloadRecords = zero-blocker rows
  // from the transport and source-download prep buckets, minus any whose provider
  // URL already existed in the gate (skipped as already-published).
  const localAuthoritySourcesHeld = approvedSources.counts?.localAuthoritySourcesHeld?.publish || 0;
  const transportPublicAssets = approvedSources.counts?.transportPublicAssets?.publish || 0;
  const sourceDownloadRecords = approvedSources.counts?.sourceDownloadRecords?.publish || 0;
  // openDataSourceRecords = 93 net-new open-data source records reframed from the
  // mislabelled enrich-existing-source bucket (its matcher was polluted by staging
  // rows in the browse corpus; the rows had no real on-site target). Licence
  // CKAN-verified per dataset (57 CC BY 4.0 + 35 CC BY-SA 4.0 + 1 OGL); 2 stale excluded.
  const openDataSourceRecords = approvedSources.counts?.openDataSourceRecords?.publish || 0;
  // variantSourceRecords = 65 net-new boundary-variant source records (CKAN licence-verified:
  // 24 CC BY 4.0 + 1 CC0 1.0 + 40 OGL; 2 stale excluded), 40 parent-map-linked via variantOf.
  const variantSourceRecords = approvedSources.counts?.variantSourceRecords?.publish || 0;
  // censusHistoricalReports = the 2,172 CSO historical census & statistical
  // reports (PDF 1841-1991 + SAPS 2016/2022 data) mirrored to the Internet
  // Archive item civgraph-cso-historical-reports under CC BY 4.0.
  const censusHistoricalReports = approvedSources.counts?.censusHistoricalReports?.publish || 0;
  // csoPxstatBacklog = the remaining CSO PxStat cubes (non-census social/economic
  // statistics) backfilled as CC-BY catalogue records linking to data.cso.ie.
  const csoPxstatBacklog = approvedSources.counts?.csoPxstatBacklog?.publish || 0;
  assert(censusCso === 6560, `Expected 6,560 approved CSO census records, found ${censusCso}.`);
  assert(censusNisra === 645, `Expected 645 approved NISRA census records, found ${censusNisra}.`);
  assert(censusCsoNiCarveout === 35, `Expected 35 approved CSO NI-carveout census records, found ${censusCsoNiCarveout}.`);
  assert(localAuthoritySources === 715, `Expected 715 approved local-authority source records, found ${localAuthoritySources}.`);
  assert(localAuthoritySourcesHeld === 755, `Expected 755 approved held/dedup-cleared local-authority source records, found ${localAuthoritySourcesHeld}.`);
  assert(transportPublicAssets === 78, `Expected 78 approved transport/public-asset source records, found ${transportPublicAssets}.`);
  assert(sourceDownloadRecords === 16, `Expected 16 approved source-download records, found ${sourceDownloadRecords}.`);
  assert(openDataSourceRecords === 93, `Expected 93 approved net-new open-data source records, found ${openDataSourceRecords}.`);
  assert(variantSourceRecords === 65, `Expected 65 approved boundary-variant source records, found ${variantSourceRecords}.`);
  assert(censusHistoricalReports === 2172, `Expected 2,172 approved CSO historical-reports records, found ${censusHistoricalReports}.`);
  assert(csoPxstatBacklog === 6968, `Expected 6,968 approved CSO PxStat backfill records, found ${csoPxstatBacklog}.`);
  const expectedTotal = 6679 + censusCso + censusNisra + censusCsoNiCarveout + localAuthoritySources
    + localAuthoritySourcesHeld + transportPublicAssets + sourceDownloadRecords + openDataSourceRecords + variantSourceRecords
    + censusHistoricalReports + csoPxstatBacklog;
  assert(approvedSources.counts?.total === expectedTotal, `Expected ${expectedTotal} approved source records, found ${approvedSources.counts?.total}.`);
  assert(Array.isArray(approvedSources.sources) && approvedSources.sources.length === expectedTotal, `Expected ${expectedTotal} approved source records in sources array, found ${approvedSources.sources?.length}.`);
  assert(approvedSources.counts?.remainingApproved?.publish === 26, `Expected 26 approved remaining publish records, found ${approvedSources.counts?.remainingApproved?.publish}.`);
  assert(approvedSources.counts?.remainingApproved?.variants === 3, `Expected 3 approved remaining variant records, found ${approvedSources.counts?.remainingApproved?.variants}.`);
  assert(!approvedSources.counts?.excluded?.['probable variant - user approval required'], 'Category 3 probable variants should be resolved by user approval in this pass.');
  assert(!approvedSources.counts?.excluded?.['citation-only source page'], 'Category 3 citation-only source pages should be resolved by user approval in this pass.');

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

  const approvedDistinctSourceIds = [
    'source-doc-03514-community-centres',
    'source-doc-00741-drainage-asset',
    'source-doc-05230-applications',
    'source-doc-00845-health',
    'source-doc-03553-report'
  ];
  for (const rowId of approvedDistinctSourceIds) {
    const source = approvedSources.sources.find((item) => item.approval?.stagingId === rowId);
    assert(Boolean(source), `User-approved distinct source row was not materialised: ${rowId}`);
    if (source) assert(source.approval?.recommendedAction === 'publish', `User-approved distinct source row must publish, not ${source.approval?.recommendedAction}: ${rowId}`);
  }
  const nbcoSource = approvedSources.sources.find((item) => item.approval?.stagingId === 'source-doc-05230-applications');
  if (nbcoSource) {
    const nonNbcoUrls = [...(nbcoSource.references || []), ...(nbcoSource.downloads || [])]
      .map((link) => link.url)
      .filter(Boolean)
      .filter((url) => !/\/\/data\.nbco\.gov\.ie\//i.test(url));
    assert(nonNbcoUrls.length === 0, `NBCO applications source must not inherit unrelated application/planning references: ${nonNbcoUrls.join(', ')}`);
  }
  assertApprovedDistinctSourceLinks(approvedSources, 'source-doc-03514-community-centres', /(?:belfastcity\.gov\.uk|community-centres-csv-3\.csv)/i);
  assertApprovedDistinctSourceLinks(approvedSources, 'source-doc-00741-drainage-asset', /drainage_assets/i);
  assertApprovedDistinctSourceLinks(approvedSources, 'source-doc-00845-health', /crsdataset\.csv/i);
  assertApprovedDistinctSourceLinks(approvedSources, 'source-doc-03553-report', /orp_report_odni_201920\.pdf/i);
  const cpdSource = approvedSources.sources.find((item) => item.approval?.stagingId === 'source-doc-cpdjan2026');
  assert(Boolean(cpdSource), 'Grouped Central Postcode Directory January 2026 source family is missing.');
  if (cpdSource) {
    const componentIds = cpdSource.approval?.componentRowIds || [];
    assert(componentIds.includes('source-doc-04018-cpdjan2026access'), 'CPD grouped source is missing Access component row.');
    assert(componentIds.includes('source-doc-04019-cpdjan2026csv'), 'CPD grouped source is missing CSV component row.');
    assert(componentIds.includes('source-doc-04020-cpdjan2026txt'), 'CPD grouped source is missing TXT component row.');
  }
  const lfsOds = approvedSources.sources.find((item) => item.approval?.stagingId === 'source-doc-04056-lfs-claimant-count-oct-2021-ods');
  assert(Boolean(lfsOds), 'LFS Claimant Count Oct 2021 ODS alternate-format variant is missing.');
  if (lfsOds) {
    assert(lfsOds.approval?.recommendedAction === 'merge as variant', 'LFS ODS row must be materialised as a variant.');
    assert(lfsOds.variantOf?.title === 'LFS Claimant Count Oct 2021', 'LFS ODS variant must point at the LFS Claimant Count Oct 2021 source family.');
  }
}

function assertApprovedDistinctSourceLinks(approvedSources, stagingId, expectedPattern) {
  const source = approvedSources.sources.find((item) => item.approval?.stagingId === stagingId);
  if (!source) return;
  const links = [...(source.references || []), ...(source.downloads || [])].map((link) => link.url).filter(Boolean);
  const badUrls = links.filter((url) => !expectedPattern.test(url));
  assert(badUrls.length === 0, `User-approved distinct source ${stagingId} inherited unrelated references/downloads: ${badUrls.join(', ')}`);
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
    assert(hasBrowseSourceDetail(browseItem), `Browse source detail record is missing for ${source.id}: ${browseItem.detailUrl || browseItem.slug}`);
  }
}

function hasBrowseSourceDetail(browseItem) {
  const slug = browseItem.slug || slugify(browseItem.id);
  if (!browseItem.detailUrl) {
    const detailPath = path.join(ROOT, 'data', 'browse', 'details', 'sources', `${slug}.json`);
    return existsSync(detailPath);
  }
  try {
    const parsed = new URL(browseItem.detailUrl, 'https://civgraph.local');
    const shardPath = path.join(ROOT, ...parsed.pathname.replace(/^\/+/, '').split('/'));
    if (!existsSync(shardPath)) return false;
    const shard = JSON.parse(readFileSync(shardPath, 'utf8'));
    const items = Array.isArray(shard.items) ? shard.items : [];
    return items.some((item) => (
      String(item.slug || '').toLowerCase() === String(slug || '').toLowerCase() ||
      String(item.id || '').toLowerCase() === String(browseItem.id || '').toLowerCase()
    ));
  } catch {
    return false;
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
