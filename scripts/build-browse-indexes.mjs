#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveApprovedPublicationSources } from './lib/approved-publication-index.mjs';
import { partyColour, NO_LABEL, NO_PARTY_RECORDED } from '../src/election-domain.mjs';
import { isPublicMap, isPublicStatistic, statisticGeographyIds } from '../src/public-map.mjs';
import { canonicalElectionTitle, compareElectionsNewestFirst, electionResultEntryLabel } from './lib/election-names.mjs';
import { buildPartyVocabulary, classifyPersonName, stripWikipediaQualifier, NOT_A_PERSON } from './lib/person-name-artefacts.mjs';
import { referenceOffices, referenceRelatives } from './lib/reference-person-facts.mjs';
import { browsePartySlugResolver, formatSpan, indexFactsModel, loadFactsModel } from './lib/facts-model.mjs';
import { CDN_BASE } from '../src/cdn-url.js';
import { buildNiLocalGroupEntry, groupNiLocalRounds, isIrelandLocalYear, isNiLocalCouncilRound, niLocalGroupKey } from '../src/ni-local-groups.mjs';

const ROOT = process.cwd();

/**
 * Printed works whose stated coverage includes an election, from the same declaration the
 * provenance builder uses (data/elections/walker-volumes.json) so the two cannot drift apart.
 *
 * These are citations, not links: the volumes are in copyright and are not published by this
 * project. addReference keeps a reference with no url as long as it carries a note, which is
 * exactly the shape a printed source needs.
 */
const BIBLIOGRAPHY_PATH = path.join(ROOT, 'data', 'elections', 'walker-volumes.json');
// Loaded on first use, not at module scope: the build runs before this point in the file,
// so a const here sits in its own temporal dead zone and every election fails to read.
let bibliographyRulesCache = null;
function bibliographyRules() {
  if (bibliographyRulesCache) return bibliographyRulesCache;
  try {
    const doc = JSON.parse(readFileSync(BIBLIOGRAPHY_PATH, 'utf8'));
    bibliographyRulesCache = (doc.volumes || []).flatMap((v) => (v.rules || []).map((r) => ({ v, r })));
  } catch {
    bibliographyRulesCache = [];
  }
  return bibliographyRulesCache;
}

function addBibliographyReferences(refs, bodySlug, date, scope) {
  if (!bodySlug || !date) return;
  const day = String(date).slice(0, 10);
  for (const { v, r } of bibliographyRules()) {
    if (r.body !== bodySlug || day < r.from || day > r.to) continue;
    addReference(refs, {
      label: `${v.title} — ${v.editor}`,
      source: v.publisher,
      role: refs.length ? 'corroboration' : 'result-source',
      scope: scope || '',
      note: `Printed source, ${v.year}. ${r.section}. Not reproduced here; consult the volume.`,
    });
  }
}


// IA download links for agency map layers (mirrored by scripts/build-agency-ia-mirror.mjs).
const AGENCY_IA_MIRRORS = (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'data/database/agency-ia-mirrors.json'), 'utf8')).items || {}; }
  catch { return {}; }
})();
// Open-data election datasets (data.gov.ie) attached as source-provenance references
// to election browse records. Keyed by election key. Additive only.
const ELECTION_SOURCE_ENRICHMENTS = (() => {
  const map = new Map();
  try {
    const data = JSON.parse(readFileSync(path.join(ROOT, 'data/database/election-source-enrichments.json'), 'utf8'));
    for (const e of (data.enrichments || [])) map.set(e.electionKey, e.datasets || []);
  } catch { /* sidecar optional */ }
  return map;
})();
const OUT_DIR = path.join(ROOT, 'data', 'browse');
const DETAILS_DIR = path.join(OUT_DIR, 'details');

const GENERATED_AT = new Date().toISOString();
const SAMPLE_RELATED_LIMIT = 40;
const FEATURE_SAMPLE_LIMIT = 600;
const PERSON_RELATED_LIMIT = Number.POSITIVE_INFINITY;
const PARTY_RELATED_LIMIT = Number.POSITIVE_INFINITY;
const SOURCE_DETAIL_SHARD_DIR = 'source-shards';
const SOURCE_DETAIL_SHARD_SIZE = 200;
const REGISTER_INTEREST_INDEX_SHARD_DIR = 'register-interest-shards';
const REGISTER_INTEREST_INDEX_SHARD_SIZE = 5000;
const SOURCE_INDEX_SHARD_DIR = 'source-index-shards';
const SOURCE_INDEX_SHARD_SIZE = 5000;
const PERSON_INDEX_SHARD_DIR = 'person-shards';
const PERSON_INDEX_SHARD_SIZE = 5000;
// election-contest-parents/<bucket>.json: contest slug -> election slug, in this many pieces.
const CONTEST_PARENT_BUCKETS = 64;
// A party label with fewer appearances than this, in no election's party table and not in the
// party registry, is a ballot-paper label: listed only when the reader asks (buildParties).
const BALLOT_LABEL_MAX_OCCURRENCES = 10;
const RAW_ELECTION_SOURCE_CACHE = new Map();

const ENTITY_GROUPS = [
  { id: 'maps', label: 'Maps', description: 'Catalogue map entries, metadata, downloads, source credits, and interactive-map links.' },
  { id: 'elections', label: 'Elections', description: 'Election entries by election, with links to open the corresponding election layer.' },
  { id: 'features', label: 'Features', description: 'Boundary features by source map, including election geography groups where available.' },
  { id: 'parties', label: 'Parties / Labels', description: 'Party and ticket labels observed in election data.' },
  { id: 'persons', label: 'Persons', description: 'Candidate and elected-person entries observed in election bundles.' },
  { id: 'offices', label: 'Offices', description: 'Offices people held (ministries, mayoralties, party leaderships) and who held them, each tenure cited.' },
  { id: 'register-interests', label: 'Register Interests', description: 'MLA and Northern Ireland MP register of interests records, linked back to source editions and datasets.' },
  { id: 'sources', label: 'Books / Tables / Sources', description: 'Books, tables, datasets, map downloads, source files, and references.' },
  { id: 'proni', label: 'PRONI Records', description: 'Archival catalogue records from the PRONI eCatalogue (Public Record Office of Northern Ireland), browsable by their original hierarchy. Open Government Licence.' }
];

main();

function main() {
  mkdirSync(DETAILS_DIR, { recursive: true });

  const mapsData = readJson('data/database/maps.json', { categories: [], maps: [] });
  const dataEntriesData = readJson('data/database/data-entries.json', { dataEntries: [] });
  const booksData = readJson('data/database/books.json', { categories: [], books: [] });
  const externalSourcesData = readJson('data/database/external-sources.json', { sources: [] });
  const approvedPublicationSourcesData = readJson('data/database/approved-publication-sources.json', { sources: [] });
  approvedPublicationSourcesData.sources = resolveApprovedPublicationSources(approvedPublicationSourcesData);
  const rawSourceDocumentsData = readJson('data/database/raw-source-documents.json', { sources: [] });
  const mediumPriorityPublicationSourcesData = readJson('data/database/medium-priority-publication-sources.json', { sources: [] });
  const peatlandGeoportalSourcesData = readJson('data/database/peatland-geoportal-sources.json', { sources: [], targets: [], reviewRows: [] });
  const niRegisterSourcesData = readJson('data/database/ni-register-sources.json', { sources: [] });
  const niRegisterInterestsData = readJson('data/database/ni-register-interests.json', { interests: [], shards: [] });
  const alreadyOnSiteEnrichmentsData = readJson('data/database/already-on-site-enrichments.json', { targets: [], reviewRows: [] });
  const browseSourceInputs = {
    sources: [
      ...normalizeArray(externalSourcesData.sources || externalSourcesData.items),
      ...normalizeArray(approvedPublicationSourcesData.sources || approvedPublicationSourcesData.items),
      ...normalizeArray(rawSourceDocumentsData.sources || rawSourceDocumentsData.items),
      ...normalizeArray(mediumPriorityPublicationSourcesData.sources || mediumPriorityPublicationSourcesData.items),
      ...normalizeArray(peatlandGeoportalSourcesData.sources || peatlandGeoportalSourcesData.items),
      ...normalizeArray(niRegisterSourcesData.sources || niRegisterSourcesData.items),
      ...referenceWorkSources()
    ]
  };
  const sourceEnrichmentInputs = mergeSourceEnrichmentInputs(alreadyOnSiteEnrichmentsData, peatlandGeoportalSourcesData);
  const spatialIndex = readJson('data/database/spatial-index.json', { maps: [], features: [] });
  const partyIds = readJson('data/elections-source/data/party-ids.json', { party_ids: [], aliases: {} });
  const electionManifest = readJson('render/metadata/elections-test2.json', { elections: [], totals: {} });
  const thumbnailIds = readThumbnailManifest();

  const categoriesById = new Map((mapsData.categories || []).map((category) => [category.id, category]));
  const mapClassInfoById = buildMapClassInfo(mapsData);
  // Browse lists the PUBLIC maps -- visible, loadable, not a placeholder -- using the
  // shared rule in src/public-map.mjs. It used to apply its own filter and report 993
  // while the homepage said 1,0xx and the file held 1,031 entries: three answers to one
  // question, none of them wrong on its own terms. Loadability is decided by the RENDER
  // record, since the DoBIH layers carry no catalogue `files` yet draw perfectly.
  const renderLayerIds = new Set(
    (readJson('render/metadata/maps-test.json', { layers: [] }).layers || [])
      .map((layer) => layer.sourceMapId).filter(Boolean));
  const rawMaps = mapsData.maps || [];
  const rawById = new Map(rawMaps.map((map) => [map.id, map]));
  const publicIds = new Set(rawMaps
    .filter((map) => isPublicMap(map, (id) => rawById.get(id), (id) => renderLayerIds.has(id)))
    .map((map) => map.id));
  // A census statistic is public when the boundary map it is drawn on is (isPublicStatistic):
  // the filter used to test the statistic's own id against maps.json, which never holds it, so
  // all 80 dropped out and /browse/maps/data-2021-religion-catholic-ward said "Map not found".
  const rawEntriesById = new Map(normalizeArray(dataEntriesData.dataEntries).map((entry) => [entry.id, entry]));
  const statisticGeographies = statisticGeographyIds(rawMaps.filter((map) => publicIds.has(map.id)));
  const maps = buildMaps(mapsData, dataEntriesData, categoriesById, mapClassInfoById, thumbnailIds)
    .filter((entry) => (entry.type === 'data-entry'
      ? isPublicStatistic(rawEntriesById.get(entry.id), (id) => statisticGeographies.has(id))
      : publicIds.has(entry.id)));
  let elections = buildElections(electionManifest, thumbnailIds);
  const parentElections = elections;
  const electionDetails = readElectionDetails(parentElections);
  applyElectionReaderFixes(parentElections, electionDetails);
  const electionResultEntries = buildElectionResultSubEntries(parentElections, electionDetails);
  for (const parent of parentElections) {
    parent.resultEntries = electionResultEntries
      .filter((entry) => entry.parentElectionKey === parent.key)
      .map((entry) => compactObject({
        key: entry.key,
        title: entry.title,
        resultName: entry.resultName,
        resultKind: entry.resultKind,
        browseUrl: entry.browseUrl
      }));
    parent.resultEntryCount = parent.resultEntries.length;
  }
  // The pre-1973 Northern Ireland council rounds, one entry a year in the list and in search
  // (src/ni-local-groups.mjs); each round keeps its own record, page and address.
  const niLocalGroupRecords = buildNiLocalGroupRecords(parentElections);
  elections = [...parentElections, ...niLocalGroupRecords, ...electionResultEntries];
  applyGazetteElectionExtras(parentElections, electionResultEntries);
  applyRoundCompleteness(parentElections, electionResultEntries);
  const featureGroups = buildFeatureGroups(spatialIndex, maps, parentElections);
  const { parties, partyDetails, partyNames, folds: partyFolds } = buildParties(partyIds, electionDetails);
  reportPartyLabelFolds(partyFolds);
  const { persons, personDetails } = buildPersons(electionDetails, parties, partyNames);
  const registerInterests = buildRegisterInterests(niRegisterInterestsData);
  const sources = buildSources(booksData, dataEntriesData, maps, parentElections, thumbnailIds, browseSourceInputs, sourceEnrichmentInputs);
  for (const source of sources) applySourceReaderLabels(source);
  const sourceMerges = mergeDuplicateSources(sources);
  const rawMapsById = new Map((mapsData.maps || []).map((map) => [map.id, map]));
  const rawDataEntriesById = new Map(normalizeArray(dataEntriesData.dataEntries || dataEntriesData.entries).map((entry) => [entry.id || entry.slug || slugify(entry.name || entry.title), entry]));
  const rawElectionsByKey = new Map(normalizeArray(electionManifest.elections).map((entry) => [entry.key, entry]));
  const rawBooksById = new Map(normalizeArray(booksData.books || booksData.items).map((book) => [`book:${book.id || book.slug || slugify(book.title || book.name)}`, book]));
  const rawExternalSourcesById = new Map(normalizeArray(browseSourceInputs.sources).map((entry) => [entry.id || `external:${slugify(entry.title || entry.url || '')}`, entry]));
  ensureUniqueSlugs(maps);
  ensureUniqueSlugs(elections);
  ensureUniqueSlugs(featureGroups);
  ensureUniqueSlugs(parties);
  ensureUniqueSlugs(persons);
  ensureUniqueSlugs(registerInterests);
  ensureUniqueSlugs(sources);
  linkRegisterInterestsToPersons(registerInterests, persons);
  const personFacets = addListFacets(parties, partyDetails, persons, electionDetails, partyNames);
  // A feature group links to its map's record by the map's final slug.
  const mapSlugById = new Map(maps.map((map) => [map.id, map.slug]));
  for (const group of featureGroups) {
    if (mapSlugById.has(group.sourceMapId)) group.mapSlug = mapSlugById.get(group.sourceMapId);
    else delete group.mapSlug;
  }
  const sourceDetailShardByKey = buildSourceDetailShardAssignments(sources);
  const sourceIndexItems = sources.map((source) => compactSourceIndexRecord(source, sourceDetailShardByKey));
  const registerInterestIndexItems = registerInterests.map(compactRegisterInterestIndexRecord);
  const registerInterestIndexShards = writeRegisterInterestIndexShards(registerInterestIndexItems);

  writeJson('maps.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: maps.length, items: maps });
  writeJson('elections.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: elections.length, items: elections });
  writeElectionListIndex(elections);
  writeJson('features.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    totalFeatureRecords: spatialIndex.features?.length || 0,
    totalFeatureGroups: featureGroups.length,
    featureSampleLimit: FEATURE_SAMPLE_LIMIT,
    items: featureGroups
  });
  writeJson('parties.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: parties.length, items: parties });
  // Sharded for the same reason as the source index: a single persons.json reached
  // 25.18 MB across 13,113 people and breached Cloudflare Pages' 25 MB per-file limit,
  // failing the deploy gate. The runtime loader (browse.js loadIndex) and the graph
  // build/validators resolve shards generically via indexLayout === 'sharded', so no
  // consumer needed changing.
  const personIndexShards = writePersonIndexShards(persons);
  writeJson('persons.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: persons.length,
    indexLayout: 'sharded',
    indexShardStrategy: 'fixed-size',
    indexShardSize: PERSON_INDEX_SHARD_SIZE,
    indexShardDir: `/data/browse/${PERSON_INDEX_SHARD_DIR}`,
    shards: personIndexShards
  });
  // The People filter options (body, decade, elected, party with every spelling of it in the
  // person records), so Browse can offer them without reading the 16 MB person index.
  writeJson('persons-facets.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: persons.length, facets: personFacets }, { compact: true });
  writeJson('register-interests.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: registerInterests.length,
    indexLayout: 'sharded',
    indexShardStrategy: 'fixed-size',
    indexShardSize: REGISTER_INTEREST_INDEX_SHARD_SIZE,
    indexShardDir: `/data/browse/${REGISTER_INTEREST_INDEX_SHARD_DIR}`,
    detailLayout: 'external-shards',
    defaultSort: { key: 'date', direction: 'desc' },
    sortOptions: [
      { key: 'date', label: 'Date' },
      { key: 'memberName', label: 'Politician' },
      { key: 'electedBody', label: 'Elected body' },
      { key: 'constituency', label: 'Constituency' },
      { key: 'interestCount', label: 'Interests' },
      { key: 'sourceCount', label: 'Source rows' }
    ],
    filterFields: ['electedBody', 'memberType', 'chamber', 'constituency', 'categories', 'sourceKinds', 'isNone'],
    shards: registerInterestIndexShards
  });
  // The aggregate search index is split into fixed-size shards so the manifest
  // (data/browse/sources.json) and every shard stay under the 25 MB Cloudflare
  // Pages per-file limit as the source corpus grows. The runtime loader and the
  // validators/graph build resolve shards via indexLayout === 'sharded'.
  const sourceIndexShards = writeSourceIndexShards(sourceIndexItems);
  writeJson('sources.json', {
    schemaVersion: 2,
    generatedAt: GENERATED_AT,
    total: sources.length,
    indexLayout: 'sharded',
    indexShardStrategy: 'fixed-size',
    indexShardSize: SOURCE_INDEX_SHARD_SIZE,
    indexShardDir: `/data/browse/${SOURCE_INDEX_SHARD_DIR}`,
    detailLayout: 'sharded',
    detailShardStrategy: 'fixed-size',
    detailShardSize: SOURCE_DETAIL_SHARD_SIZE,
    detailShardDir: `/data/browse/details/${SOURCE_DETAIL_SHARD_DIR}`,
    shards: sourceIndexShards
  });

  writeDetailFiles('maps', maps, (record) => ({
    rawMetadata: record.type === 'data-entry'
      ? rawDataEntriesById.get(record.id)
      : rawMapsById.get(record.id)
  }));
  writeDetailFiles('elections', [...parentElections, ...niLocalGroupRecords], (record) => ({
    rawMetadata: compactObject({
      manifest: rawElectionsByKey.get(record.parentElectionKey || record.key),
      result: record.resultMetadata || null,
      resultUrl: record.resultUrl,
      anchorUrl: record.anchorUrl
    })
  }), { prune: true });
  writeElectionContestShards(parentElections, electionResultEntries);
  writeDetailFiles('parties', Object.values(partyDetails));
  // A folded label's old address: its detail file now holds its party, so the path-style page
  // (functions/_browse-page.js) redirects /browse/parties/<old> to the party's own address.
  for (const party of Object.values(partyDetails)) {
    for (const oldSlug of party.previousSlugs || []) {
      writeJson(path.join('details', 'parties', `${oldSlug}.json`), { schemaVersion: 1, generatedAt: GENERATED_AT, item: compactObject(party) });
    }
  }
  writeJson('party-names.json', { schemaVersion: 1, generatedAt: GENERATED_AT, items: partyNames }, { compact: true });
  // Every source record merged into another, so the merges can be read and checked.
  writeJson('source-merges.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    note: 'Source records that were the same work listed more than once (same title and address, or a table staged from the record it repeats), each merged into one record. The old addresses open the merged record. Built by scripts/build-browse-indexes.mjs mergeDuplicateSources.',
    total: sourceMerges.length,
    items: sourceMerges
  });
  writeSourceDetailShards(sources, (record) => ({
    rawMetadata: sourceRawMetadata(record, {
      rawMapsById,
      rawDataEntriesById,
      rawElectionsByKey,
      rawBooksById,
      rawExternalSourcesById,
      electionDetails
    })
  }), sourceDetailShardByKey);

  writeJson('index.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    groups: ENTITY_GROUPS,
    counts: {
      maps: maps.length,
      elections: elections.length,
      featureGroups: featureGroups.length,
      featureRecords: spatialIndex.features?.length || 0,
      parties: parties.length,
      persons: persons.length,
      // Offices with at least one recorded holder: scripts/build-office-pages.mjs writes their pages.
      offices: (() => { const model = loadFactsModel(ROOT); const held = new Set(model.tenures.map((t) => t.officeId)); return model.offices.filter((o) => held.has(o.id)).length; })(),
      'register-interests': registerInterests.length,
      sources: sources.length,
      proni: 1538177
    },
    entrypoints: {
      maps: '/data/browse/maps.json',
      elections: '/data/browse/elections.json',
      // The Elections list reads this; elections.json has every field of every record.
      electionsList: '/data/browse/elections-list.json',
      features: '/data/browse/features.json',
      parties: '/data/browse/parties.json',
      persons: '/data/browse/persons.json',
      'register-interests': '/data/browse/register-interests.json',
      sources: '/data/browse/sources.json'
    },
    notes: [
      'Browse is generated from static repository data.',
      'Feature records are grouped by map and loaded lazily from existing spatial-index sidecars to avoid creating thousands of static files.',
      'Open in interactive map and Open election layer links target the main site route with hash state.'
    ]
  });

  console.log(`Browse indexes written to ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`- maps: ${maps.length}`);
  console.log(`- elections: ${elections.length}`);
  console.log(`- feature groups: ${featureGroups.length} (${spatialIndex.features?.length || 0} feature records)`);
  console.log(`- parties: ${parties.length}`);
  console.log(`- persons: ${persons.length}`);
  console.log(`- register interests: ${registerInterests.length}`);
  console.log(`- sources: ${sources.length}`);
}

function buildMaps(mapsData, dataEntriesData, categoriesById, mapClassInfoById, thumbnailIds) {
  const mapRecords = (mapsData.maps || []).filter((map) => !map.hidden).map((map) => {
    const category = categoriesById.get(map.category) || {};
    const files = normalizeFiles(map.files || map.file || map.sourceFile || map.data || null);
    const variantFiles = normalizeArray(map.variants).some((variant) => {
      if (!variant || typeof variant === 'string') return false;
      return Boolean(variant.files || variant.file || variant.sourceFile || variant.data || variant.url || variant.source);
    });
    const references = normalizeReferences(map.references || map.sourceReferences || map.sources);
    const iaLinks = (AGENCY_IA_MIRRORS[map.id]?.files || []).map((f) => ({ label: `Internet Archive: ${f.name}`, url: f.iaUrl }));
    const downloads = normalizeLinks([map.downloads || map.sourceDownload || map.sourceDownloads || map.download || files, ...iaLinks]);
    const rawTitle = cleanText(map.name || map.title || map.id);
    const title = mapDisplayTitle(map, mapClassInfoById.get(map.id), rawTitle);
    return compactObject({
      id: map.id,
      slug: map.slug || slugify(map.id || title),
      type: 'map',
      title,
      subtitle: compactJoin([formatDateRange(map), geographyLabel(map)]),
      categoryId: map.category || null,
      category: category.name || map.category || null,
      group: category.group || map.group || null,
      description: cleanText(map.description || category.description || ''),
      date: yearPrecisionDate(map.date || map.year || map.dateAdded || null, map),
      years: collectYears(map),
      provider: normalizeArray(map.provider || map.providers),
      credits: normalizeArray(map.credits || map.credit || map.sourceCredit),
      keywords: normalizeArray(map.keywords),
      status: map.placeholder ? 'not yet converted' : 'available',
      featured: Boolean(map.featured),
      loadable: Boolean(map.files || map.file || map.url || map.source || map.tiles || map.pmtiles || map.geojson || variantFiles),
      labelProperty: map.labelProperty || null,
      parentCard: mapClassInfoById.get(map.id)?.className || null,
      thumbnail: thumbnailForCandidates(thumbnailIds, [map.id, map.cloneOf], map.name || map.title || map.id, 'map'),
      variants: normalizeArray(map.variants).filter((variant) => typeof variant === 'string' || !variant.hidden).map((variant) => typeof variant === 'string' ? { id: variant } : compactObject({
        id: variant.id || variant.mapId || variant.slug || variant.name,
        title: mapDisplayTitle(
          { ...map, ...variant, id: variant.id || variant.mapId || variant.slug || variant.name, name: variant.name || variant.title || variant.label || variant.id || variant.mapId },
          mapClassInfoById.get(variant.id || variant.mapId || variant.slug || variant.name),
          variant.name || variant.title || variant.label || variant.id || variant.mapId
        ),
        date: yearPrecisionDate(variant.date || variant.year || null, variant)
      })),
      sourceFiles: files,
      references,
      downloads,
      interactiveUrl: interactiveLayerUrl(map.id),
      browseUrl: `/browse/maps/${encodeURIComponent(map.id)}`
    });
  }).filter((map) => map.id);

  const dataEntries = normalizeArray(dataEntriesData.dataEntries || dataEntriesData.entries).filter((entry) => !entry.hidden).map((entry) => {
    const id = entry.id || entry.slug || slugify(entry.name || entry.title);
    // The statistics CSVs live on the data bucket, not in the Pages build (data/census/ is
    // gitignored), so a bare path would link to a 404 on civgraph.net.
    const csvUrl = entry.csv ? `${CDN_BASE}/${String(entry.csv).replace(/^\/+/, '')}` : null;
    const licence = entry.source?.licence || null;
    // "Drawn on Wards 2012", not the bare id "wards-2012".
    const geographyName = (mapsData.maps || []).find((map) => map.id === entry.geography)?.name || entry.geography;
    return compactObject({
      id,
      slug: slugify(id),
      type: 'data-entry',
      title: cleanText(entry.name || entry.title || id),
      subtitle: compactJoin([entry.year, entry.region, geographyName ? `Drawn on ${geographyName}` : null]),
      categoryId: entry.category || 'data-entry',
      category: entry.categoryName || (String(entry.category || '').startsWith('data-') ? 'Census statistics' : entry.category) || 'Tables and data',
      group: entry.group || 'Tables and data',
      description: cleanText(entry.description || ''),
      date: entry.date || entry.year || null,
      years: collectYears(entry),
      provider: normalizeArray(entry.provider || entry.providers),
      credits: normalizeArray(entry.credits || entry.credit),
      keywords: normalizeArray(entry.keywords),
      status: 'available',
      // Drawn on the map as its geography's boundaries shaded by the CSV (src/census-overlay.mjs).
      loadable: Boolean(entry.mapId || entry.layerId || entry.sourceMapId || (entry.geography && entry.csv)),
      geography: entry.geography || null,
      license: licence?.short || licence?.name || null,
      thumbnail: thumbnailForCandidates(thumbnailIds, [entry.layerId, entry.mapId, entry.sourceMapId, entry.geography, id], entry.name || entry.title || id, 'table'),
      sourceFiles: normalizeFiles([entry.files, entry.file, entry.sourceFile, csvUrl].filter(Boolean)),
      references: [
        ...normalizeReferences(entry.references || entry.sources || entry.source),
        ...(licence?.url ? [{ label: `Licence: ${licence.name || licence.short}`, url: licence.url }] : [])
      ],
      downloads: normalizeLinks([entry.downloads, entry.download, entry.sourceDownload, entry.file, entry.files, csvUrl].filter(Boolean)),
      interactiveUrl: interactiveLayerUrl(entry.layerId || entry.mapId || entry.sourceMapId || id),
      browseUrl: `/browse/maps/${encodeURIComponent(id)}`
    });
  }).filter((entry) => entry.id);

  return [...mapRecords, ...dataEntries].sort(sortByTitle);
}

/**
 * A map's date stored as 1 January when only the year is known ("1977-01-01" for the 1977
 * DEDs, a 2016 pothole survey) is a year: it read "1 Jan 1977" in Browse and in the graph.
 * Kept as the day only where the map says the day: "1 Jan" or "-01-01" in its name or id
 * (the 1 January 1919 and 1929 administrative areas), or a date in force of that day.
 */
function yearPrecisionDate(value, map = {}) {
  const text = String(value || '');
  if (!/^\d{4}-01-01$/.test(text)) return value;
  const named = `${map.id || ''} ${map.name || ''} ${map.title || ''}`;
  if (/\b1 Jan(uary)?\b|-01-01\b/i.test(named) || map.dateEffective === text) return value;
  return text.slice(0, 4);
}

function buildMapClassInfo(mapsData) {
  const infoById = new Map();
  const mapsById = new Map((mapsData.maps || []).map((map) => [map.id, map]));

  for (const cls of mapsData.classes || []) {
    for (const mapId of cls.maps || []) {
      if (!infoById.has(mapId)) {
        infoById.set(mapId, {
          classId: cls.id,
          className: cls.name,
          scope: cls.scope || null
        });
      }
    }
  }

  for (const map of mapsData.maps || []) {
    for (const variant of map.variants || []) {
      const variantId = variant?.id || variant?.mapId || variant?.slug || variant?.name;
      if (!variantId || infoById.has(variantId)) continue;
      const parent = mapsById.get(map.id) || map;
      infoById.set(variantId, {
        classId: parent.id,
        className: parent.name || parent.title || parent.id,
        scope: parent.scope || null,
        parentId: parent.id
      });
    }
  }

  return infoById;
}

function mapDisplayTitle(map, classInfo, fallbackTitle = '') {
  const title = cleanText(fallbackTitle || map?.name || map?.title || map?.label || map?.id);
  if (!title) return title;
  const parentTitle = cleanText(classInfo?.className || map?.parentName || '');
  const derivedName = derivedMapNamePart(map, title, parentTitle);
  if (!parentTitle || !derivedName) return title;
  return `${parentTitle} - ${derivedName}`;
}

function derivedMapNamePart(map, title, parentTitle = '') {
  const text = cleanText(title);
  if (!text) return '';
  if (parentTitle) {
    const parentPattern = escapeRegExp(parentTitle).replace(/\\ /g, '\\s+');
    const parentDateMatch = text.match(new RegExp(`^${parentPattern}\\s+(.+)$`, 'i'));
    if (parentDateMatch && isDerivedMapName(map, parentDateMatch[1])) {
      return parentDateMatch[1].trim();
    }
  }
  return isDerivedMapName(map, text) ? text : '';
}

function isDerivedMapName(map, title) {
  const text = cleanText(title);
  if (!text) return false;
  if (/^\d{4}$/.test(text)) return true;
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:\s*\([^)]*\))?$/.test(text)) return true;
  if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(text)) return true;

  const normalText = normalizeDisplayText(text);
  for (const candidate of [formatPlainMapDate(map?.date), plainMapYear(map?.date)]) {
    const normalCandidate = normalizeDisplayText(candidate);
    if (normalCandidate && (normalText === normalCandidate || normalText.startsWith(`${normalCandidate} (`))) {
      return true;
    }
  }
  return false;
}

function formatPlainMapDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr);
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (/^\d{4}$/.test(str)) return str;
  if (/^\d{4}-\d{2}$/.test(str)) {
    const [year, month] = str.split('-').map(Number);
    return `${shortMonths[month - 1]} ${year}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [year, month, day] = str.split('-').map(Number);
    return `${String(day).padStart(2, '0')} ${longMonths[month - 1]} ${year}`;
  }
  return str;
}

function plainMapYear(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})/);
  return match ? match[1] : '';
}

function normalizeDisplayText(value) {
  return cleanText(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// What an election is, in a few sentences with links (Phelim Birch's descriptions document,
// data/catalogue/descriptions.json): the election page's lede, its links among the references.
// (A function, read on first use: main() runs before this module's later constants exist.)
function electionAboutFor(key) {
  if (!electionAboutFor.all) {
    try { electionAboutFor.all = JSON.parse(readFileSync(path.join(ROOT, 'data/catalogue/descriptions.json'), 'utf8')).elections || {}; } catch { electionAboutFor.all = {}; }
  }
  return electionAboutFor.all[key];
}

function buildElections(manifest, thumbnailIds) {
  return (manifest.elections || []).map((entry) => {
    const about = electionAboutFor(entry.key);
    const title = cleanText(entry.displayTitle || canonicalElectionTitle(entry) || entry.body || entry.bodySlug || entry.key);
    const layerId = mainElectionLayerId(entry);
    const decade = Number.isFinite(Number(entry.date?.slice(0, 4))) ? `${Math.floor(Number(entry.date.slice(0, 4)) / 10) * 10}s` : null;
    return compactObject({
      id: entry.key,
      key: entry.key,
      type: 'election',
      entryKind: 'election',
      title,
      body: cleanText(entry.body || title),
      bodySlug: entry.bodySlug || slugify(title),
      date: entry.date || null,
      year: entry.year || Number(entry.date?.slice(0, 4)) || null,
      decade,
      subtitle: cleanText(entry.displaySubtitle || ''),
      description: about ? about.text.join(' ') : undefined,
      provider: cleanText(entry.displayProvider || entry.body || ''),
      category: 'Elections',
      geography: electionGeographyLabel(entry),
      contestType: entry.contestType || null,
      kind: entry.kind || null,
      votingSystem: entry.votingSystem || null,
      contestStatus: entry.contestStatus || null,
      candidateRowsExpected: entry.candidateRowsExpected,
      transferDataExpected: entry.transferDataExpected,
      votesPerElector: entry.votesPerElector,
      constituencies: normalizeArray(entry.constituencies).slice(0, SAMPLE_RELATED_LIMIT),
      totalConstituencies: entry.totalConstituencies || entry.constituencies?.length || 0,
      matchedCount: entry.matchedCount || 0,
      unmatchedCount: entry.unmatchedCount || 0,
      sourceMapId: entry.sourceMapId || null,
      layerId: entry.layerId || null,
      labelProperty: entry.labelProperty || null,
      loadable: Boolean(entry.loadable),
      placeholder: Boolean(entry.placeholder),
      status: entry.placeholder ? 'not yet converted' : entry.loadable ? 'available' : 'metadata only',
      resultUrl: entry.resultUrl || null,
      anchorUrl: entry.anchorUrl || null,
      references: normalizeReferences([
        ...(entry.references || []),
        ...(about?.links || []),
        // The election's Wikidata item, where Wikipedia has an article for it (2026-10-13).
        ...(resolvedElectionArticle(entry.key)?.qid ? [{ label: `Wikidata: ${resolvedElectionArticle(entry.key).qid}`, url: `https://www.wikidata.org/wiki/${resolvedElectionArticle(entry.key).qid}`, source: 'Wikidata' }] : []),
      ]),
      previousKey: entry.previousKey || null,
      thumbnail: thumbnailForCandidates(thumbnailIds, [entry.sourceMapId, entry.layerId], title, 'election'),
      interactiveUrl: interactiveLayerUrl(layerId),
      browseUrl: `/browse/elections/${encodeURIComponent(entry.key)}`
    });
  }).filter((entry) => entry.key).sort((a, b) => compareElectionsNewestFirst(a, b) || a.title.localeCompare(b.title));
}

/**
 * A year of pre-1973 Northern Ireland council elections as one Browse record: the councils that
 * polled (each linking to its own round's page), the parties' seats and votes over all of them,
 * and the map link that opens the year grouped (app/src/ni-local-view.js).
 */
function buildNiLocalGroupRecords(parentElections) {
  const groups = groupNiLocalRounds(parentElections);
  return [...groups].map(([year, rounds]) => {
    const group = buildNiLocalGroupEntry(year, rounds);
    const parties = new Map();
    for (const round of rounds) {
      for (const row of round.partySummary || []) {
        if (!row.party) continue;
        if (!parties.has(row.party)) parties.set(row.party, { party: row.party, stood: 0, seats: 0, votes: 0, colour: row.colour });
        const sum = parties.get(row.party);
        sum.stood += Number(row.stood) || 0;
        sum.seats += Number(row.seats) || 0;
        sum.votes += Number(row.votes) || 0;
      }
    }
    const totalVotes = [...parties.values()].reduce((n, row) => n + row.votes, 0);
    const partySummary = [...parties.values()]
      .sort((a, b) => b.seats - a.seats || b.votes - a.votes)
      .map((row) => compactObject({ ...row, share: totalVotes && row.votes ? Math.round((row.votes / totalVotes) * 10000) / 100 : undefined }));
    const councils = rounds.map((round) => compactObject({
      key: round.key,
      title: round.title,
      body: round.body,
      date: round.date,
      subtitle: round.subtitle,
      browseUrl: round.browseUrl
    }));
    const thumbnail = rounds.find((round) => round.thumbnail)?.thumbnail;
    const params = new URLSearchParams({ electionBody: group.body, electionDate: group.date });
    return compactObject({
      id: group.key,
      key: group.key,
      slug: slugify(group.key),
      // A pre-1921 year was briefly ni-local-YYYY (never published): that address still finds it.
      previousSlugs: (group.previousKeys || []).flatMap((key) => [slugify(key), key]),
      type: 'election',
      entryKind: 'election',
      title: group.displayTitle,
      body: group.body,
      bodySlug: group.bodySlug,
      date: group.date,
      year: Number(year),
      decade: `${Math.floor(Number(year) / 10) * 10}s`,
      subtitle: group.displaySubtitle,
      description: `The council elections held ${isIrelandLocalYear(year) ? 'in Ireland' : 'in Northern Ireland'} in ${year} for which Civgraph holds results: ${group.councilCount} council${group.councilCount === 1 ? '' : 's'}${group.hasAldermen ? ' and their aldermanic polls' : ''}. Open it on the map to see the results by ward and DED, county electoral division, town, district or county.`,
      provider: group.body,
      category: 'Elections',
      geography: isIrelandLocalYear(year) ? 'Ireland' : 'Northern Ireland',
      contestType: 'election',
      kind: 'general',
      // Searched: a council's name finds its year.
      constituencies: [...new Set(rounds.map((round) => round.body))],
      totalConstituencies: group.councilCount,
      loadable: true,
      status: 'available',
      partySummary: partySummary.slice(0, 24),
      councils,
      roundKeys: group.roundKeys,
      thumbnail,
      interactiveUrl: `/maps/#${params.toString()}`,
      browseUrl: `/browse/elections/${encodeURIComponent(group.key)}`
    });
  }).sort((a, b) => compareElectionsNewestFirst(a, b));
}

// Corrections to an election's title that the source files cannot carry. The fifteen
// by-elections of 23 January 1986, held on one day when the unionist MPs resigned their seats
// over the Anglo-Irish Agreement, are filed as a general election and were titled "1986 UK
// general election in Northern Ireland" on every Browse page that named them.
// (A function, not a module const: main() runs on import, before a later const is initialised.)
function electionTitleOverride(key) {
  return {
    'house-of-commons-of-the-united-kingdom__1986-01-23': { title: '1986 Northern Ireland by-elections', kind: 'by-election' }
  }[key];
}

/** One spelling for one thing: the sources mix "bye-election" (Irish usage) and "by-election". */
function readerElectionTitle(title) {
  return cleanText(title).replace(/\b([Bb])ye-election/g, '$1y-election');
}

/**
 * Titles and dates as a reader sees them, applied before contests, parties and people copy the
 * title. The detail's displayTitle is set too, because buildParties and buildPersons read it.
 * A referendum's `date` arrives with its question appended ("2024-03-08-care", from the key),
 * which the cards printed as the date; only the date part is kept. The detail's own date is
 * left alone: the map layer ids are made from it.
 */
function applyElectionReaderFixes(elections, details) {
  for (const election of elections) {
    const override = electionTitleOverride(election.key);
    const title = override?.title || readerElectionTitle(election.title);
    election.title = title;
    if (override?.kind) election.kind = override.kind;
    const isoDate = /^\d{4}(?:-\d{2}(?:-\d{2})?)?/.exec(String(election.date || ''))?.[0] || null;
    if (election.date && isoDate !== election.date) election.date = isoDate;
    const detail = details.get(election.key);
    if (detail) {
      detail.displayTitle = title;
      if (override?.kind) detail.kind = override.kind;
    }
  }
}

function readElectionDetails(elections) {
  const detailFiles = new Map();
  for (const election of elections) {
    const rel = String(election.resultUrl || `/render/metadata/elections-test2/${election.key}.json`).replace(/^\/+/, '');
    const fullPath = path.join(ROOT, rel);
    if (!existsSync(fullPath)) continue;
    try {
      const detail = JSON.parse(readFileSync(fullPath, 'utf8'));
      detailFiles.set(election.key, detail);
      Object.assign(election, compactObject({
        title: cleanText(detail.displayTitle || canonicalElectionTitle(detail) || detail.body || election.title),
        body: cleanText(detail.body || election.body),
        provider: cleanText(detail.displayProvider || election.provider),
        subtitle: cleanText(detail.displaySubtitle || election.subtitle),
        availableStyleModes: normalizeArray(detail.availableStyleModes),
        partySummary: normalizeArray(detail.mainLikePartySummary || detail.partySummary).slice(0, 16).map((party) => compactObject({
          party: party.party,
          seats: party.seats ?? party.elected,
          stood: party.stood,
          votes: party.votes ?? party.firstPrefs,
          share: party.share,
          colour: party.colour || party.color
        })),
        totals: compactObject({
          seats: detail.mainLikeTotals?.seats || sumNumbers(detail.partySummary, 'seats'),
          validPoll: detail.mainLikeTotals?.validPoll || sumNumbers(detail.partySummary, 'votes'),
          constituencies: detail.totalConstituencies || detail.constituencies?.length || election.totalConstituencies
        }),
        references: buildElectionReferences(election, detail)
      }));
    } catch (error) {
      console.warn(`Could not read election detail ${rel}: ${error.message}`);
    }
  }
  return detailFiles;
}

function buildElectionResultSubEntries(parentElections, electionDetails) {
  const byKey = new Map(parentElections.map((election) => [election.key, election]));
  const entries = [];
  for (const [key, detail] of electionDetails) {
    const parent = byKey.get(key);
    if (!parent) continue;
    const parentTitle = cleanText(detail.displayTitle || parent.title || canonicalElectionTitle(detail));
    const common = {
      parentElectionKey: parent.key,
      parentTitle,
      parentBrowseUrl: `/browse/elections/${encodeURIComponent(parent.slug || parent.key)}`,
      body: parent.body,
      bodySlug: parent.bodySlug,
      bodyGroup: parent.bodyGroup,
      date: parent.date,
      year: parent.year,
      decade: parent.decade,
      provider: parent.provider,
      category: parent.category,
      geography: parent.geography,
      sourceMapId: parent.sourceMapId,
      layerId: parent.layerId,
      contestType: parent.contestType || detail.contestType || null,
      kind: parent.kind || detail.kind || null,
      votingSystem: parent.votingSystem || detail.votingSystem || null,
      contestStatus: parent.contestStatus || detail.contestStatus || null,
      candidateRowsExpected: parent.candidateRowsExpected ?? detail.candidateRowsExpected,
      transferDataExpected: parent.transferDataExpected ?? detail.transferDataExpected,
      votesPerElector: parent.votesPerElector || detail.votesPerElector || null,
      loadable: parent.loadable,
      placeholder: parent.placeholder,
      status: parent.status,
      resultUrl: parent.resultUrl,
      anchorUrl: parent.anchorUrl,
      references: parent.references,
      thumbnail: parent.thumbnail,
      interactiveUrl: parent.interactiveUrl
    };
    entries.push(compactObject({
      ...common,
      id: `${parent.key}::overall`,
      key: `${parent.key}::overall`,
      slug: `${slugify(parent.key)}-overall-results`,
      type: 'election',
      entryKind: 'election-overall-result',
      resultKind: 'overall',
      resultName: 'Overall results',
      title: electionResultEntryLabel(parentTitle, null, { overall: true }),
      subtitle: compactJoin(['Overall election result', parent.subtitle]),
      description: `Overall results for ${parentTitle}.`,
      totalConstituencies: detail.totalConstituencies || parent.totalConstituencies,
      matchedCount: detail.matchedCount ?? parent.matchedCount,
      unmatchedCount: detail.unmatchedCount ?? parent.unmatchedCount,
      partySummary: parent.partySummary,
      totals: parent.totals,
      references: buildElectionResultReferences(parent, detail, null, { overall: true }),
      resultMetadata: compactObject({
        kind: 'overall',
        partySummaryRows: normalizeArray(detail.mainLikePartySummary || detail.partySummary).length,
        constituencyResults: normalizeArray(detail.results).length
      }),
      browseUrl: `/browse/elections/${encodeURIComponent(`${slugify(parent.key)}-overall-results`)}`
    }));

    for (const result of normalizeArray(detail.results)) {
      const resultName = cleanText(result.constituency || result.featureName || result.matchName);
      if (!resultName) continue;
      const regionalList = isNorthernIrelandForumRegionalList(detail, resultName);
      const displayResultName = regionalList ? 'Regional List' : resultName;
      const slug = `${slugify(parent.key)}-${slugify(displayResultName)}`;
      entries.push(compactObject({
        ...common,
        id: `${parent.key}::${slugify(displayResultName)}`,
        key: `${parent.key}::${slugify(displayResultName)}`,
        slug,
        type: 'election',
        entryKind: 'election-constituency-result',
        resultKind: regionalList ? 'regional-list' : parent.bodyGroup === 'local-government' ? 'dea-result' : 'constituency-result',
        resultName: displayResultName,
        sourceResultName: resultName,
        title: electionResultEntryLabel(parentTitle, displayResultName, { regionalList }),
        subtitle: compactJoin([regionalList ? 'Regional List result' : 'Constituency / DEA result', parentTitle]),
        description: `${displayResultName} result in ${parentTitle}.`,
        constituency: resultName,
        featureId: result.featureId || null,
        featureName: result.featureName || null,
        matched: Boolean(result.matched),
        localBody: result.localBody || null,
        contestType: result.contestType || parent.contestType || detail.contestType || null,
        kind: result.kind || parent.kind || detail.kind || null,
        votingSystem: result.votingSystem || parent.votingSystem || detail.votingSystem || null,
        contestStatus: result.contestStatus || parent.contestStatus || detail.contestStatus || null,
        candidateRowsExpected: result.candidateRowsExpected ?? parent.candidateRowsExpected ?? detail.candidateRowsExpected,
        transferDataExpected: result.transferDataExpected ?? parent.transferDataExpected ?? detail.transferDataExpected,
        votesPerElector: result.votesPerElector || parent.votesPerElector || detail.votesPerElector || null,
        partySummary: normalizeArray(result.partySummary || result.summary || result.parties).slice(0, 16),
        references: buildElectionResultReferences(parent, detail, result),
        resultMetadata: compactObject({
          kind: regionalList ? 'regional-list' : 'constituency',
          constituency: resultName,
          featureName: result.featureName,
          matched: Boolean(result.matched),
          localBody: result.localBody,
          sourceFile: result.sourceFile
        }),
        browseUrl: `/browse/elections/${encodeURIComponent(slug)}`
      }));
    }
  }
  return entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.title || '').localeCompare(String(b.title || '')));
}

/**
 * Belfast Gazette polling-district schedules and an election's "Rules and costs" (returning
 * officers' charges, candidates' expense limits, Exchequer issues for returning officers'
 * expenses), each with its Gazette citation. The committed file is built from the Gazette
 * extracts by scripts/gazette/build_gazette_election_extras.py, so this build never needs the
 * Gazette folder. Fields are added only where there is data.
 */
function applyGazetteElectionExtras(parents, contests) {
  const extras = readJson('data/elections/gazette-election-extras.json', { elections: {}, contests: {} });
  const electionExtras = extras.elections || {};
  const contestExtras = extras.contests || {};
  const seen = new Set();
  for (const parent of parents) {
    const extra = electionExtras[parent.key];
    if (!extra) continue;
    seen.add(parent.key);
    if (extra.pollingDistricts?.rows?.length) parent.gazettePollingDistricts = extra.pollingDistricts;
    if (extra.rulesAndCosts?.length) parent.gazetteRulesAndCosts = extra.rulesAndCosts;
  }
  for (const contest of contests) {
    const extra = contestExtras[contest.key];
    if (!extra) continue;
    seen.add(contest.key);
    if (extra.pollingDistricts?.rows?.length) contest.gazettePollingDistricts = extra.pollingDistricts;
  }
  const missing = [...Object.keys(electionExtras), ...Object.keys(contestExtras)].filter((key) => !seen.has(key));
  if (missing.length) console.warn(`Gazette election extras with no Browse record: ${missing.join(', ')}`);
}

/**
 * Northern Ireland council rounds 1921-67 that hold only some of the council's divisions or
 * wards (data/elections/round-completeness.json): the election page and each of its results
 * carry the round's one line, "Results for 3 of 22 district electoral divisions. ...", so a
 * partial round is not read as the whole result. The map panel shows the same line.
 */
function applyRoundCompleteness(parents, contests) {
  const rounds = readJson('data/elections/round-completeness.json', { rounds: {} }).rounds || {};
  const seen = new Set();
  for (const parent of parents) {
    const text = rounds[parent.key]?.text;
    if (!text) continue;
    seen.add(parent.key);
    parent.completenessNote = text;
  }
  for (const contest of contests) {
    const text = rounds[contest.parentElectionKey]?.text;
    if (text) contest.completenessNote = text;
  }
  const missing = Object.keys(rounds).filter((key) => !seen.has(key));
  if (missing.length) console.warn(`Round completeness lines with no Browse election: ${missing.join(', ')}`);
}

function isNorthernIrelandForumRegionalList(detail, resultName) {
  return normalizeName(detail?.body) === 'northern ireland forum for political dialogue'
    && normalizeName(resultName) === 'northern ireland';
}

function addElectionEnrichmentReferences(refs, election, detail) {
  const key = election?.key || detail?.key || election?.id;
  for (const d of (ELECTION_SOURCE_ENRICHMENTS.get(key) || [])) {
    addReference(refs, {
      label: `${d.title} - ${d.provider || 'data.gov.ie'} (${d.license})`,
      url: d.providerUrl,
      source: d.provider || 'data.gov.ie',
      role: 'external-dataset-source',
      scope: 'election-open-data',
      note: `Open-data election dataset (${d.license}). ${d.attribution || ''}`.trim()
    });
  }
}

function buildElectionReferences(election, detail) {
  const refs = [];
  addElectionOverviewReferences(refs, election, detail);
  addElectionCorpusReferences(refs, election, detail);
  addElectionEnrichmentReferences(refs, election, detail);
  addBibliographyReferences(refs, election?.bodySlug || detail?.bodySlug, election?.date || detail?.date, 'whole election');

  const resultSourceUrls = new Set();
  for (const result of normalizeArray(detail?.results)) {
    for (const sourceUrl of rawElectionSourceUrls(result?.sourceFile)) {
      resultSourceUrls.add(sourceUrl);
    }
  }
  if (resultSourceUrls.size === 1) {
    const [url] = [...resultSourceUrls];
    addReference(refs, {
      label: `${sourceNameForUrl(url)} result source`,
      url,
      source: sourceNameForUrl(url),
      role: 'primary-result-source',
      scope: 'election-result',
      note: 'Source URL carried by the underlying election result data.'
    });
  } else if (resultSourceUrls.size > 1) {
    addReference(refs, {
      label: `${resultSourceUrls.size} constituency/result source pages are cited on the result sub-entries`,
      source: dominantSourceName([...resultSourceUrls]),
      role: 'primary-result-source',
      scope: 'constituency-result-set',
      note: 'The parent election uses per-result references to avoid duplicating every constituency/DEA source link here.'
    });
  }

  return dedupeReferences(refs);
}

function buildElectionResultReferences(parent, detail, result, options = {}) {
  const refs = [];
  if (options.overall) {
    addElectionOverviewReferences(refs, parent, detail);
    addElectionCorpusReferences(refs, parent, detail);
    addBibliographyReferences(refs, parent?.bodySlug, parent?.date, 'whole election');
    return dedupeReferences(refs);
  }

  for (const sourceUrl of rawElectionSourceUrls(result?.sourceFile)) {
    addReference(refs, {
      label: primaryResultReferenceLabel(sourceUrl, parent, result),
      url: sourceUrl,
      source: sourceNameForUrl(sourceUrl),
      role: 'primary-result-source',
      scope: resultScopeForElection(parent, result),
      note: 'Source URL carried by the underlying election result data.'
    });
  }

  const constituencyUrl = wikipediaConstituencyReferenceUrl(parent, result);
  if (constituencyUrl) {
    addReference(refs, {
      label: `Wikipedia constituency/election table: ${cleanText(result?.constituency || result?.featureName || result?.matchName)}`,
      url: constituencyUrl,
      source: 'Wikipedia',
      role: refs.length ? 'corroboration' : 'result-source',
      scope: resultScopeForElection(parent, result),
      note: 'Inferred from the election body and constituency/DEA name; verify if using for citation-critical work.'
    });
  }

  addElectionOverviewReferences(refs, parent, detail, { role: refs.length ? 'corroboration' : 'election-overview' });
  addElectionCorpusReferences(refs, parent, detail, { compact: true });
  addBibliographyReferences(refs, parent?.bodySlug, parent?.date, resultScopeForElection(parent, result));
  return dedupeReferences(refs);
}

function addElectionOverviewReferences(refs, election, detail, options = {}) {
  const wikiUrl = wikipediaElectionReferenceUrl(election, detail);
  if (wikiUrl) {
    addReference(refs, {
      label: `Wikipedia overview: ${cleanText(detail?.displayTitle || election?.title || canonicalElectionTitle(election))}`,
      url: wikiUrl,
      source: 'Wikipedia',
      role: options.role || 'election-overview',
      scope: 'election'
    });
    // The election's Wikidata item, where Wikipedia has an article for it (2026-10-13).
    const qid = resolvedElectionArticle(election?.key || detail?.key)?.qid;
    if (qid) addReference(refs, { label: `Wikidata: ${qid}`, url: `https://www.wikidata.org/wiki/${qid}`, source: 'Wikidata', role: options.role || 'election-overview', scope: 'election' });
  }
}

function addElectionCorpusReferences(refs, election, detail, options = {}) {
  const bodySlug = election?.bodySlug || detail?.bodySlug;
  const geography = electionGeographyLabel(election || detail || {});
  if (isNorthernIrelandElection(election || detail)) {
    addReference(refs, {
      label: options.compact ? 'ARK Elections / CAIN election archive' : 'ARK Elections / CAIN archive',
      url: 'https://www.ark.ac.uk/elections/',
      source: 'ARK Elections / CAIN',
      role: 'corroboration-source',
      scope: options.compact ? 'source-corpus' : 'election-corpus',
      note: 'Used as a source/corroboration corpus for Northern Ireland election result data where available.'
    });
    if (Number(election?.year || detail?.year || 0) >= 1998) {
      addReference(refs, {
        label: 'Electoral Office for Northern Ireland election results and statistics',
        url: 'https://www.eoni.org.uk/Elections/Election-results-and-statistics',
        source: 'EONI',
        role: 'official-source-corpus',
        scope: options.compact ? 'source-corpus' : 'election-corpus'
      });
    }
  }
  if (bodySlug === 'dail-eireann') {
    addReference(refs, {
      label: 'ElectionsIreland general election result pages',
      url: 'https://electionsireland.org/results/general/index.cfm',
      source: 'ElectionsIreland',
      role: 'primary-source-corpus',
      scope: options.compact ? 'source-corpus' : 'election-corpus'
    });
  } else if (bodySlug === 'ireland-president') {
    addReference(refs, {
      label: 'ElectionsIreland presidential election result pages',
      url: 'https://electionsireland.org/results/president/index.cfm',
      source: 'ElectionsIreland',
      role: 'primary-source-corpus',
      scope: options.compact ? 'source-corpus' : 'election-corpus'
    });
  } else if (bodySlug === 'ireland-european') {
    addReference(refs, {
      label: 'ElectionsIreland European election result pages',
      url: 'https://electionsireland.org/results/europe/index.cfm',
      source: 'ElectionsIreland',
      role: 'primary-source-corpus',
      scope: options.compact ? 'source-corpus' : 'election-corpus'
    });
  } else if (bodySlug === 'ireland-referendum') {
    addReference(refs, {
      label: 'Wikipedia referendum result pages',
      url: wikipediaElectionReferenceUrl(election, detail),
      source: 'Wikipedia',
      role: 'primary-source-corpus',
      scope: options.compact ? 'source-corpus' : 'election-corpus'
    });
  } else if (bodySlug === 'ireland-local' || (bodySlug === 'local-government' && geography === 'Republic of Ireland')) {
    addReference(refs, {
      label: 'Irish local election overview sources',
      url: wikipediaElectionReferenceUrl(election, detail),
      source: 'Wikipedia',
      role: 'corroboration-source',
      scope: options.compact ? 'source-corpus' : 'election-corpus'
    });
  }
}

function rawElectionSourceUrls(sourceFile) {
  const rel = cleanText(sourceFile);
  if (!rel) return [];
  if (RAW_ELECTION_SOURCE_CACHE.has(rel)) return RAW_ELECTION_SOURCE_CACHE.get(rel);
  const fullPath = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!existsSync(fullPath)) {
    RAW_ELECTION_SOURCE_CACHE.set(rel, []);
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
    const urls = [...extractSourceUrls(raw)];
    RAW_ELECTION_SOURCE_CACHE.set(rel, urls);
    return urls;
  } catch {
    RAW_ELECTION_SOURCE_CACHE.set(rel, []);
    return [];
  }
}

function extractSourceUrls(value, urls = new Set()) {
  if (!value) return urls;
  if (typeof value === 'string') {
    if (isUrl(value)) urls.add(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractSourceUrls(item, urls);
    return urls;
  }
  if (typeof value !== 'object') return urls;
  for (const [key, current] of Object.entries(value)) {
    if (/^(source_url|sourceUrl|source|url)$/i.test(key) && typeof current === 'string' && isUrl(current)) {
      urls.add(current);
    } else if (/^(sources|references|reference|sourceUrls)$/i.test(key)) {
      extractSourceUrls(current, urls);
    }
  }
  return urls;
}

// The Wikipedia article for each election, resolved against Wikipedia rather than guessed
// (data/elections/wikipedia-election-articles.json): 783 of the 1,025 guesses below named pages
// that do not exist (audit 2026-10-13). The guesses stay as the fallback for elections it lacks.
function resolvedElectionArticle(key) {
  if (!resolvedElectionArticle.all) {
    try { resolvedElectionArticle.all = JSON.parse(readFileSync(path.join(ROOT, 'data/elections/wikipedia-election-articles.json'), 'utf8')).elections || {}; } catch { resolvedElectionArticle.all = {}; }
  }
  return key ? resolvedElectionArticle.all[key] : null;
}

function wikipediaElectionReferenceUrl(election, detail) {
  const resolved = resolvedElectionArticle(election?.key || detail?.key);
  if (resolved?.url) return resolved.url;
  const bodySlug = election?.bodySlug || detail?.bodySlug;
  const body = cleanText(election?.body || detail?.body || '');
  const date = cleanText(election?.date || detail?.date || '');
  const year = Number(election?.year || detail?.year || date.slice(0, 4));
  const title = cleanText(election?.title || detail?.displayTitle || canonicalElectionTitle(election || detail));
  if (!year && !title) return null;

  if (bodySlug === 'dail-eireann') return wikiUrl(`${year} Irish general election`);
  if (bodySlug === 'ireland-president') return wikiUrl(`${year} Irish presidential election`);
  if (bodySlug === 'ireland-european') return wikiUrl(`${year} European Parliament election in Ireland`);
  if (bodySlug === 'european-parliament') return wikiUrl(`${year} European Parliament election in Northern Ireland`);
  if (bodySlug === 'northern-ireland-assembly') return wikiUrl(`${year} Northern Ireland Assembly election`);
  if (bodySlug === 'northern-ireland-forum-for-political-dialogue') return wikiUrl('1996 Northern Ireland Forum election');
  if (bodySlug === 'northern-ireland-constitutional-convention') return wikiUrl('1975 Northern Ireland Constitutional Convention election');
  if (bodySlug === 'parliament-of-northern-ireland') {
    if (/by-election/i.test(title)) return wikiUrl('List of Northern Ireland Parliament by-elections');
    return wikiUrl(`${year} Northern Ireland general election`);
  }
  if (bodySlug === 'house-of-commons-of-the-united-kingdom') {
    if (/by-election|recall petition/i.test(title)) return wikiUrl('List of United Kingdom by-elections in Northern Ireland');
    return wikiUrl(`${year} United Kingdom general election in Northern Ireland`);
  }
  if (bodySlug === 'local-government') {
    if (/northern ireland/i.test(body) || /Northern Ireland/i.test(title)) return wikiUrl(`${year} Northern Ireland local elections`);
    return wikiUrl(`${year} Irish local elections`);
  }
  if (bodySlug === 'ireland-local') return wikiUrl(`${year} Irish local elections`);
  if (bodySlug === 'ireland-referendum') {
    const firstSource = firstRawSourceUrl(detail);
    return firstSource || wikiUrl(title.replace(/\s*\([^)]*\)\s*$/, ''));
  }
  return title ? wikiUrl(title) : null;
}

function wikipediaConstituencyReferenceUrl(election, result) {
  const name = cleanText(result?.constituency || result?.featureName || result?.matchName);
  if (!name) return null;
  const bodySlug = election?.bodySlug;
  if (bodySlug === 'house-of-commons-of-the-united-kingdom') return wikiUrl(`${name} (UK Parliament constituency)`);
  if (bodySlug === 'northern-ireland-assembly') return wikiUrl(`${name} (Assembly constituency)`);
  if (bodySlug === 'parliament-of-northern-ireland') return wikiUrl(`${name} (Northern Ireland Parliament constituency)`);
  if (bodySlug === 'northern-ireland-constitutional-convention') return wikiUrl(`${name} (Northern Ireland Parliament constituency)`);
  if (bodySlug === 'northern-ireland-forum-for-political-dialogue') {
    return normalizeName(name) === 'northern ireland' ? wikiUrl('1996 Northern Ireland Forum election') : wikiUrl(`${name} (Assembly constituency)`);
  }
  return null;
}

function firstRawSourceUrl(detail) {
  for (const result of normalizeArray(detail?.results)) {
    const [url] = rawElectionSourceUrls(result?.sourceFile);
    if (url) return url;
  }
  return null;
}

function wikiUrl(title) {
  const clean = cleanText(title);
  if (!clean) return null;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/\s+/g, '_')).replace(/%28/g, '(').replace(/%29/g, ')').replace(/%27/g, "'")}`;
}

function addReference(refs, ref) {
  const normalized = compactObject({
    label: cleanText(ref.label || ref.url || ref.source || 'Reference'),
    url: ref.url || null,
    source: cleanText(ref.source || sourceNameForUrl(ref.url)),
    role: cleanText(ref.role || ''),
    scope: cleanText(ref.scope || ''),
    note: cleanText(ref.note || '')
  });
  if (normalized.url === null) delete normalized.url;
  if (!normalized.url && !normalized.note) return;
  refs.push(normalized);
}

function dedupeReferences(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref.url || ref.label}|${ref.role || ''}|${ref.scope || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function primaryResultReferenceLabel(url, parent, result) {
  const source = sourceNameForUrl(url);
  const resultName = cleanText(result?.constituency || result?.featureName || result?.matchName || '');
  if (resultName) return `${source}: ${resultName}, ${parent?.title || parent?.date || 'election result'}`;
  return `${source}: ${parent?.title || parent?.date || 'election result'}`;
}

function resultScopeForElection(parent, result) {
  if (isNorthernIrelandForumRegionalList(parent, result?.constituency)) return 'regional-list-result';
  if (parent?.bodyGroup === 'local-government' || /local/i.test(parent?.body || '')) return 'dea-result';
  if (/referendum/i.test(parent?.body || '')) return 'referendum-constituency-result';
  return 'constituency-result';
}

function firstUrlHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sourceNameForUrl(url) {
  const host = firstUrlHost(url).toLowerCase();
  if (!host) return '';
  if (host.includes('electionsireland.org')) return 'ElectionsIreland';
  if (host.includes('wikipedia.org')) return 'Wikipedia';
  if (host.includes('ark.ac.uk')) return 'ARK Elections / CAIN';
  if (host.includes('eoni.org.uk')) return 'EONI';
  if (host.includes('web.archive.org')) return 'Internet Archive / Wayback Machine';
  return host;
}

function dominantSourceName(urls) {
  const counts = new Map();
  for (const url of urls) {
    const source = sourceNameForUrl(url) || 'Source';
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Source';
}

function isNorthernIrelandElection(entry) {
  const body = `${entry?.body || ''} ${entry?.bodySlug || ''} ${entry?.displayProvider || ''}`;
  const geography = electionGeographyLabel(entry || {});
  return /northern ireland|westminster|house-of-commons|assembly|forum|constitutional|parliament-of-northern-ireland|local-government|european-parliament/i.test(body)
    || geography === 'Northern Ireland';
}

function buildFeatureGroups(spatialIndex, maps, elections) {
  const mapById = new Map(maps.map((map) => [map.id, map]));
  const electionsBySourceMap = new Map();
  for (const election of elections) {
    if (!election.sourceMapId) continue;
    const current = electionsBySourceMap.get(election.sourceMapId) || [];
    current.push({ key: election.key, title: election.title, date: election.date, interactiveUrl: election.interactiveUrl });
    electionsBySourceMap.set(election.sourceMapId, current);
  }

  const sampleByMap = new Map();
  const countByMap = new Map();
  for (const feature of spatialIndex.features || []) {
    if (!feature?.mapId) continue;
    countByMap.set(feature.mapId, (countByMap.get(feature.mapId) || 0) + 1);
    const sample = sampleByMap.get(feature.mapId) || [];
    if (sample.length < FEATURE_SAMPLE_LIMIT) {
      sample.push(compactObject({
        name: cleanText(feature.name || feature.label || 'Unnamed feature'),
        bbox: Array.isArray(feature.bbox) ? feature.bbox : null
      }));
    }
    sampleByMap.set(feature.mapId, sample);
  }

  return (spatialIndex.maps || []).map((group) => {
    const map = mapById.get(group.id) || {};
    const relatedElections = electionsBySourceMap.get(group.id) || [];
    // The spatial index's own featureCount is not a count of features (it gave 27,464 for
    // the 52-seat 1929 Stormont map); the features it actually lists for the map are. A map it
    // lists none for, and that has no sidecar file, has no feature list here: the card says so
    // and the record points to the map's own features table rather than fetching a 404.
    const sidecar = existsSync(path.join(ROOT, 'data', 'database', 'spatial-index', `${group.id}.json`));
    const name = cleanText(group.name);
    return compactObject({
      id: group.id,
      type: 'feature-group',
      // A bare year ("2009") is the spatial index's short name for a Dáil map; the map's own
      // title says which map it is.
      title: (/^\d{4}$/.test(name) ? '' : name) || cleanText(map.title) || name || group.id,
      category: map.category || (group.category ? humanizeSlug(group.category) : null),
      group: map.group || null,
      featureCount: countByMap.get(group.id) || 0,
      bounds: Array.isArray(group.bounds) ? group.bounds : null,
      sourceMapId: group.id,
      // The map's Browse record, which has the full features table, when the map is public.
      mapSlug: mapById.has(group.id) ? slugify(group.id) : undefined,   // made exact in main()
      sourceFile: group.file || null,
      spatialIndexUrl: sidecar ? `/data/database/spatial-index/${encodeURIComponent(group.id)}.json` : null,
      relatedElections: relatedElections.slice(0, SAMPLE_RELATED_LIMIT),
      relatedElectionCount: relatedElections.length,
      sampleFeatures: sampleByMap.get(group.id) || [],
      thumbnail: map.thumbnail || null,
      interactiveUrl: interactiveLayerUrl(group.id),
      browseUrl: `/browse/features?map=${encodeURIComponent(group.id)}`
    });
  }).sort((a, b) => (b.relatedElectionCount - a.relatedElectionCount) || (b.featureCount - a.featureCount) || a.title.localeCompare(b.title));
}

function buildParties(partyIds, electionDetails) {
  const aliasToId = new Map();
  const byId = new Map();
  // The curated registry gives the full name ("Ulster Unionist Party") where party-ids.json
  // has only the abbreviation ("UUP"), and more spellings seen on ballot papers. Searching
  // Browse for a party's full name found nothing while the record was titled by its initials.
  const registry = new Map((readJson('data/elections/parties/party_registry.json', { entities: [] }).entities || [])
    .map((entry) => [entry.id, entry]));
  const registryAliases = (entry) => normalizeArray(entry?.aliases)
    .map((alias) => (typeof alias === 'string' ? alias : alias?.string))
    .filter(Boolean);
  const partyIdOf = (party) => party.party_id || `party:${slugify(party.canonical_name)}`;
  const folds = partyLabelFolds(partyIds.party_ids || [], registry, registryAliases, partyIdOf);
  for (const party of partyIds.party_ids || []) {
    const id = partyIdOf(party);
    // A misspelling of a party is merged into it below, not listed as a party of its own.
    if (folds.has(id)) continue;
    const entry = registry.get(id.replace(/^party:/, ''));
    const fullName = cleanText(entry?.name || '');
    const shortName = cleanText(party.canonical_name || id);
    const detail = {
      id,
      slug: id.replace(/^party:/, ''),
      type: 'party',
      title: fullName || shortName,
      // The initials stay with the record as its short name, shown under the title.
      shortName: fullName && fullName !== shortName ? shortName : null,
      canonicalName: shortName,
      observedNames: normalizeArray(party.observed_names),
      knownAliases: [...new Set([...normalizeArray(party.known_aliases), ...registryAliases(entry),
        ...(fullName ? [fullName] : []), ...(entry?.shortName ? [entry.shortName] : [])])],
      occurrenceCount: Number(party.occurrence_count) || 0,
      fileCount: Number(party.file_count) || 0,
      relatedElections: [],
      totals: { stood: 0, seats: 0, votes: 0 },
      firstYear: null,
      lastYear: null,
      colour: cleanText(party.colour || party.color || partyColour(party.canonical_name || id)),
      browseUrl: `/browse/parties/${encodeURIComponent(id.replace(/^party:/, ''))}`
    };
    byId.set(id, detail);
    for (const name of [detail.canonicalName, ...detail.observedNames, ...detail.knownAliases]) {
      if (name) aliasToId.set(normalizeName(name), id);
    }
  }

  // Each folded label becomes one of its party's spellings: its candidacies are counted there,
  // its names find the party in search and in the election summaries below, and its old
  // address opens the party (previousSlugs, matched by browse.js findItem and by the detail
  // stub main() writes under the old slug).
  for (const party of partyIds.party_ids || []) {
    const fold = folds.get(partyIdOf(party));
    if (!fold) continue;
    const target = byId.get(fold.target);
    const label = cleanText(party.canonical_name);
    const names = [label, ...normalizeArray(party.observed_names).map(cleanText), ...normalizeArray(party.known_aliases).map(cleanText)];
    target.observedNames = [...new Set([...target.observedNames, ...normalizeArray(party.observed_names).map(cleanText), label])];
    target.knownAliases = [...new Set([...target.knownAliases, ...names])];
    target.occurrenceCount += Number(party.occurrence_count) || 0;
    target.fileCount += Number(party.file_count) || 0;
    target.previousSlugs = [...new Set([...(target.previousSlugs || []), partyIdOf(party).replace(/^party:/, '')])];
    for (const name of names) if (name) aliasToId.set(normalizeName(name), fold.target);
  }

  for (const [key, detail] of electionDetails) {
    for (const row of normalizeArray(detail.mainLikePartySummary || detail.partySummary)) {
      const partyName = cleanText(row.party || row.name);
      // "No party recorded" (before 1832) and "No label" (nothing printed or inferred) are the
      // absence of a party, not one: no party page.
      if (!partyName || partyName === NO_PARTY_RECORDED || partyName === NO_LABEL) continue;
      const id = aliasToId.get(normalizeName(partyName)) || `party:${slugify(partyName)}`;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          slug: id.replace(/^party:/, ''),
          type: 'party',
          title: partyName,
          canonicalName: partyName,
          observedNames: [partyName],
          knownAliases: [],
          occurrenceCount: 0,
          fileCount: 0,
          relatedElections: [],
          totals: { stood: 0, seats: 0, votes: 0 },
          firstYear: null,
          lastYear: null,
          colour: cleanText(row.colour || row.color || partyColour(partyName)),
          browseUrl: `/browse/parties/${encodeURIComponent(id.replace(/^party:/, ''))}`
        });
      }
      const party = byId.get(id);
      const rowColour = cleanText(row.colour || row.color || '');
      if (rowColour && (!party.colour || party.colour === '#6b7280')) party.colour = rowColour;
      const year = Number(detail.year || detail.date?.slice(0, 4));
      party.totals.stood += Number(row.stood || 0);
      party.totals.seats += Number(row.seats ?? row.elected ?? 0);
      party.totals.votes += Number(row.votes ?? row.firstPrefs ?? 0);
      party.firstYear = party.firstYear === null ? year : Math.min(party.firstYear, year || party.firstYear);
      party.lastYear = party.lastYear === null ? year : Math.max(party.lastYear, year || party.lastYear);
      if (party.relatedElections.length < PARTY_RELATED_LIMIT) {
        party.relatedElections.push(compactObject({
          key,
          title: cleanText(detail.displayTitle || canonicalElectionTitle(detail) || detail.body || key),
          date: detail.date,
          seats: row.seats ?? row.elected,
          stood: row.stood,
          votes: row.votes ?? row.firstPrefs,
          share: row.share,
          interactiveUrl: interactiveLayerUrl(mainElectionLayerId(detail))
        }));
      }
    }
  }

  // Party pages that are no longer built because their candidacies now carry another party's
  // label (scripts/browse-party-label-folds.json, retiredSlugs: the Workers' Party merge of
  // 2026-11-02, for one). The old address still opens the party, as a folded label's does.
  const retired = readJson('scripts/browse-party-label-folds.json', { retiredSlugs: {} }).retiredSlugs || {};
  const claimed = new Set([...byId.values()].flatMap((party) => party.previousSlugs || []));
  for (const [targetSlug, group] of Object.entries(retired)) {
    const target = byId.get(`party:${targetSlug}`);
    if (!target) {
      console.warn(`- parties: retiredSlugs target ${targetSlug} is not a party; skipped`);
      continue;
    }
    for (const oldSlug of normalizeArray(group.slugs)) {
      // A slug that is still a party of its own, or already another party's old address, stays so.
      if (byId.has(`party:${oldSlug}`) || claimed.has(oldSlug)) continue;
      target.previousSlugs = [...new Set([...(target.previousSlugs || []), oldSlug])];
      claimed.add(oldSlug);
    }
  }

  const details = Object.fromEntries([...byId.values()].map((party) => [party.slug, {
    ...party,
    subtitle: compactJoin([party.shortName, formatYearRange(party.firstYear, party.lastYear), `${party.relatedElections.length} linked elections`]),
    interactiveUrl: party.relatedElections[0]?.interactiveUrl || null,
    // A label seen on a handful of ballot papers and in no election's party table, and not a
    // party in the curated registry: listed behind "Show ballot-paper labels" in Browse, so the
    // parties a reader is looking for are not lost among 500 one-off spellings.
    ballotLabel: !registry.has(party.slug) && party.relatedElections.length === 0
      && party.occurrenceCount < BALLOT_LABEL_MAX_OCCURRENCES ? true : undefined
  }]));
  const items = Object.values(details).map((party) => compactObject({
    id: party.id,
    slug: party.slug,
    type: 'party',
    title: party.title,
    subtitle: party.subtitle,
    // Searched by the list filter (browse.js searchableText), so the initials, the full name
    // and the ballot-paper spellings all find the party.
    shortName: party.shortName,
    knownAliases: party.knownAliases?.length ? party.knownAliases : undefined,
    previousSlugs: party.previousSlugs,
    ballotLabel: party.ballotLabel,
    occurrenceCount: party.occurrenceCount,
    fileCount: party.fileCount,
    firstYear: party.firstYear,
    lastYear: party.lastYear,
    relatedElectionCount: party.relatedElections.length,
    totals: party.totals,
    colour: party.colour,
    browseUrl: party.browseUrl
  })).sort((a, b) => (b.occurrenceCount - a.occurrenceCount) || (b.relatedElectionCount - a.relatedElectionCount) || a.title.localeCompare(b.title));

  // Every name a party is known by, folded, to its slug: browse.js links the party names in a
  // person's elections and a contest's candidates with it (one small file, not parties.json).
  const partyNames = {};
  for (const party of Object.values(details)) {
    for (const name of [party.title, party.canonicalName, party.shortName, ...party.observedNames, ...party.knownAliases]) {
      const key = normalizeName(name);
      if (key && !(key in partyNames)) partyNames[key] = party.slug;
    }
  }

  return { parties: items, partyDetails: details, partyNames, folds };
}

/**
 * Which party-ids.json labels are another party under a different spelling.
 *
 * Three sources, in this order, each auditable:
 *   1. scripts/browse-party-label-folds.json, a curated list: misspellings, the party's other
 *      name, a leader's name or a candidate's occupation in the party field.
 *   2. The curated party registry: a label that is exactly one of a registry party's aliases.
 *   3. Plain typing errors: a label that differs from an established party's name only by a
 *      letter or two in one or two words ("Demcratic Unionist", "Progrssive Unionist Party").
 *
 * Only a little-used label (fewer than ESTABLISHED appearances) is ever folded, never a party
 * in the registry, and never one on the curated neverFold list. The typo rule is strict on
 * purpose: words of five letters or more, the same first letter, at most one edit (two for
 * words of eight letters or more), the same number of words, and the label's word must not
 * itself be a word of another party's name ("Liberal" is not a misspelling of "Libertas").
 * A label that matches two parties is not folded. Every fold is reported by the caller.
 */
function partyLabelFolds(parties, registry, registryAliases, partyIdOf) {
  const ESTABLISHED = 50;
  const curated = readJson('scripts/browse-party-label-folds.json', { folds: {}, neverFold: [] });
  const ids = new Set(parties.map(partyIdOf));
  const byLabel = new Map(parties.map((party) => [cleanText(party.canonical_name), party]));
  const never = new Set(normalizeArray(curated.neverFold).map(cleanText));
  const isEstablished = (party) => registry.has(partyIdOf(party).replace(/^party:/, '')) || Number(party.occurrence_count) >= ESTABLISHED;
  const folds = new Map();
  const missing = [];
  const ambiguous = [];
  const add = (party, target, reason) => {
    const sourceId = partyIdOf(party);
    if (sourceId === target || !ids.has(target) || folds.has(sourceId)) return;
    if (isEstablished(party) || never.has(cleanText(party.canonical_name))) return;
    folds.set(sourceId, { target, reason, label: cleanText(party.canonical_name), occurrences: Number(party.occurrence_count) || 0 });
  };

  for (const [targetSlug, group] of Object.entries(curated.folds || {})) {
    for (const label of normalizeArray(group.labels)) {
      const party = byLabel.get(cleanText(label));
      if (!party) missing.push(label);
      else add(party, `party:${targetSlug}`, `curated: ${group.reason}`);
    }
  }

  // Registry aliases, for registry parties that are also party-ids records (the registry and
  // party-ids share ids for the main parties only).
  const aliasTarget = new Map();
  for (const [id, entry] of registry) {
    if (!ids.has(`party:${id}`)) continue;
    for (const alias of [entry.name, entry.shortName, ...registryAliases(entry)]) {
      if (alias) aliasTarget.set(foldKey(alias), `party:${id}`);
    }
  }
  for (const party of parties) {
    const target = aliasTarget.get(foldKey(party.canonical_name));
    if (target) add(party, target, 'a name of this party in the party registry');
  }

  const targets = [];
  const vocabulary = new Set();
  for (const party of parties) {
    if (!isEstablished(party)) continue;
    const entry = registry.get(partyIdOf(party).replace(/^party:/, ''));
    for (const name of [party.canonical_name, entry?.name, ...normalizeArray(party.known_aliases)]) {
      const key = foldKey(name);
      if (key.length < 10) continue;
      const words = key.split(' ');
      targets.push({ id: partyIdOf(party), name: cleanText(name), words });
      for (const word of words) vocabulary.add(word);
    }
  }
  for (const party of parties) {
    if (folds.has(partyIdOf(party)) || isEstablished(party)) continue;
    const key = foldKey(party.canonical_name);
    if (key.length < 10) continue;
    const words = key.split(' ');
    const matched = new Map();
    for (const target of targets) {
      if (isTypoOf(words, target.words, vocabulary)) matched.set(target.id, target.name);
    }
    if (matched.size === 1) {
      const [[target, name]] = [...matched];
      add(party, target, `misspelling of "${name}"`);
    } else if (matched.size > 1) {
      ambiguous.push(`${party.canonical_name} (${[...matched.keys()].join(', ')})`);
    }
  }
  folds.missing = missing;
  folds.ambiguous = ambiguous;
  return folds;
}

/** A party name for comparison: no accents, case, punctuation or apostrophes. */
function foldKey(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isTypoOf(words, targetWords, vocabulary) {
  if (words.length !== targetWords.length) return false;
  let differing = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const target = targetWords[i];
    if (word === target) continue;
    if (word.length < 5 || target.length < 5 || word[0] !== target[0] || vocabulary.has(word)) return false;
    if (editDistance(word, target) > (Math.min(word.length, target.length) >= 8 ? 2 : 1)) return false;
    differing += 1;
  }
  return differing > 0 && differing <= 2;
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swaps of two neighbours. */
function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/**
 * A referendum has OPTIONS, not candidates.
 *
 * buildPersons walks every candidate row and mints a person from the name, which for a
 * referendum means "Yes" and "No" become people. Measured 2026-08-24: those two entries
 * had accumulated 1,207 elections each and weighed 437 KB apiece, against a median
 * person record of 0.9 KB -- they were the only two rows in the whole 11,964-person
 * index too large for a single D1 statement, and had to be written in chunks.
 *
 * The size was the symptom. The defect is that they are not people: they appear in the
 * persons index, in person search, and as linkable entities from election panes, where
 * clicking "Yes" offers a biography of a referendum option.
 *
 * Detected the same way the runtime does (election-manager.js isReferendumElection):
 * by looking for "referendum" across the contest type, body and key, so one rule governs
 * both and they cannot disagree.
 */
function isReferendumElection(election, key) {
  return [election?.contestType, election?.type, election?.body, key]
    .some((value) => String(value || '').toLowerCase().includes('referendum'));
}

/**
 * A person URL that a reader can recognise and still resolve uniquely.
 *
 * Person ids became registry ids when the candidacies were stamped, and slugifying an id
 * directly gave URLs like /browse/persons/84105 -- correct, unshareable, and impossible
 * to sanity-check by eye. The name alone is not enough either, because the registry
 * deliberately keeps distinct people who share a name apart, which is the whole reason
 * it exists. So the readable part carries the name and the id keeps it unique.
 *
 * Where a candidacy could not be resolved the id is already `name:<slug>`, one entry per
 * name by construction, so the name alone is unique and no suffix is added.
 */
function personSlug(personId, name) {
  const id = String(personId || '');
  const readable = slugify(name);
  if (id.startsWith('name:')) return readable || slugify(id);
  return readable ? `${readable}-${slugify(id)}` : slugify(id);
}

/**
 * The History of Parliament's biographies of the Irish members, 1790-1832 (scripts/hop), keyed
 * by the sourcePersonId a candidacy carries: "wikipedia:<article>" through Wikidata's HoP ID
 * (P1614), "hop:<page>" for a member with no article, and "person:<id>" where
 * link_hop_members.py matched him by seat. Each page is cited and linked; the birth and death
 * dates are the only facts taken from it, never the Trust's text.
 */
function loadHopPages() {
  const members = readJson('data/elections/hop/hop-irish-members.json', { members: [] }).members || [];
  if (!members.length) return new Map();
  const consData = readJson('data/elections/hop/hop-irish-constituencies.json', { volumes: {}, constituencies: [] });
  const volumes = consData.volumes || {};
  // Seat names as HoP gives them ("Co. Antrim"); a seat outside Ireland is named from its slug.
  const seatName = new Map((consData.constituencies || []).map((c) => [hopPageKey(c.path), c.name]));
  const nameSeat = (path) => seatName.get(hopPageKey(path))
    || String(path).replace(/\/$/, '').split('/').pop().split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const wikidata = readJson('data/elections/hop/wikidata-hop-ids.json', { records: [] }).records || [];
  const enwiki = new Map(wikidata.filter((r) => r.enwiki).map((r) => [hopPageKey(`/volume/${r.hop}`), r.enwiki]));
  // The Wikidata item a page describes: the two volumes can head one man differently
  // (FOSTER, later SKEFFINGTON) or disagree on an uncertain birth year (Ruthven ?1772, 1773).
  const item = new Map(wikidata.filter((r) => r.wikidata).map((r) => [hopPageKey(`/volume/${r.hop}`), r.wikidata]));
  const links = readJson('data/elections/hop/hop-person-links.json', { links: [] }).links || [];
  const byKey = new Map();
  // A page reached through its own id or Wikidata is strong evidence; one matched by seat and
  // surname (link_hop_members.py) is weaker, and gives way where the two disagree.
  const add = (key, page, strong) => {
    if (!key) return;
    const list = byKey.get(key) || [];
    const at = list.findIndex((p) => p.page.url === page.url);
    if (at < 0) list.push({ page, strong });
    else if (strong) list[at].strong = true;
    byKey.set(key, list);
  };
  const pageOf = new Map();
  for (const m of members) {
    const v = volumes[m.volume] || {};
    const page = compactObject({
      title: v.title, edition: [v.editor, v.year].filter(Boolean).join(', '), volume: m.volume,
      url: m.url, heading: m.heading.replace(/\s*\(.*$/, ''), born: m.born, died: m.died,
      seats: (m.seats || []).map((seat) => ({
        constituency: nameSeat(seat.constituency),
        dates: seat.dates,
        // The seat itself (co-antrim and county-antrim are one) and the year he took it.
        key: `${String(seat.constituency).split('/').pop().replace(/^(co|county)-/, '').replace(/^queens-co$/, 'queens-county')}|${String(seat.from || '').slice(0, 4)}`
      })),
      // One man has a page in each volume, not always under the same slug ("prittie-hon-
      // francis-aldborough-1779-1853", "prittie-hon-francis-1779-1853"): his Wikidata item
      // is who he is, else his surname and years.
      member: item.get(hopPageKey(m.path)) || memberIdentity(m.path)
    });
    pageOf.set(hopPageKey(m.path), page);
    add(`hop:${m.path.replace(/^\/volume\//, '')}`, page, true);
    const article = enwiki.get(hopPageKey(m.path));
    if (article) add(`wikipedia:${article}`, page, true);
  }
  for (const l of links) {
    const page = pageOf.get(hopPageKey(String(l.hop || '')));
    if (page && l.personKey) add(l.personKey, page, l.method === 'wikidata');
  }
  return byKey;
}

// HoP's links percent-encode the apostrophe in O'Grady (o%E2%80%99grady); Wikidata stores
// the character. Both are looked up decoded.
function hopPageKey(p) {
  try { return decodeURIComponent(p).toLowerCase(); } catch { return p.toLowerCase(); }
}

function memberIdentity(path) {
  const slug = path.replace(/^.*\/member\//, '').replace(/\d{4,}(?=[a-z])/g, '');   // "o8217brien"
  const years = slug.match(/(\d{4})-(\d{4})$/);
  return years ? `${slug.split('-')[0]}:${years[1]}-${years[2]}` : slug;
}

// The more precise of two dates: "1776-08-01" over "1776".
function preciser(a, b) {
  return !a ? b : !b ? a : b.length > a.length ? b : a;
}

function buildPersons(electionDetails, partyRecords, partyNames = {}) {
  const byId = new Map();
  // Offices held, and party affiliation over time, from the facts model (docs/facts-model.md).
  const factsModel = loadFactsModel(ROOT);
  const factsIndex = indexFactsModel(factsModel);
  const partyRegistry = readJson('data/elections/parties/party_registry.json', { entities: [] }).entities || [];
  const partySlugOf = browsePartySlugResolver(partyRegistry, partyNames, new Set(normalizeArray(partyRecords).map((p) => p.slug)));
  const partyTitleOf = (id) => normalizeArray(partyRecords).find((p) => p.slug === partySlugOf(id))?.title
    || partyRegistry.find((e) => e.id === id)?.name || id;
  const hopPages = loadHopPages();
  let referendumsSkipped = 0;
  // Same reasoning as the referendum skip above: these names are not people, so they
  // must not become entries here. Suppressed at the person, never at the candidate row,
  // because the votes are real and only the name is missing. See
  // scripts/lib/person-name-artefacts.mjs.
  const partyVocabulary = buildPartyVocabulary(partyRecords);
  const notPeople = new Map();
  const qualifiersStripped = new Set();
  const candidateLists = new Set();
  for (const [key, election] of electionDetails) {
    if (isReferendumElection(election, key)) { referendumsSkipped += 1; continue; }
    const context = {
      key,
      title: cleanText(election.displayTitle || canonicalElectionTitle(election) || election.body || key),
      date: election.date,
      year: Number(election.year || election.date?.slice(0, 4)) || null,
      interactiveUrl: interactiveLayerUrl(mainElectionLayerId(election))
    };
    const electionBody = cleanText(election.body || '');
    for (const result of normalizeArray(election.results)) {
      // The poll a candidate's first-preference vote is a share of: the contest's valid poll
      // (as the election's own tables compute it). Where the source gives no valid poll, the
      // candidates' votes add up to it only when each voter had one vote to give -- a
      // one-seat contest or STV -- so a block-vote contest is left without a share. Stored on
      // each candidacy so a person's page can show the share without the election's bundle.
      const oneVoteEach = Number(result.seatsTotal) === 1 || /stv/i.test(String(result.votingSystem || ''));
      const contestPoll = Number(result.validPoll || 0)
        || (oneVoteEach ? Number(result.totalVotes || 0) || normalizeArray(result.candidates).reduce((sum, row) => sum + (Number(row.firstPrefs || row.firstPref || row.votes || 0) || 0), 0) : 0);
      for (const candidate of extractCandidates(result)) {
        const name = cleanText(candidate.name || candidate.candidate || candidate.Candidate);
        if (!name) continue;
        const artefactRule = classifyPersonName(name, partyVocabulary);
        if (NOT_A_PERSON.has(artefactRule)) {
          notPeople.set(name, (notPeople.get(name) || 0) + 1);
          continue;
        }
        // The candidate row keeps the source's name; only the person is shown without
        // the Wikipedia scaffolding.
        const displayName = stripWikipediaQualifier(name);
        if (displayName !== name) qualifiersStripped.add(name);
        // "Independent (Alan Chambers) list" is a real thing that stood in real elections
        // and is not a person. Suppressing it would hide 19 elections' worth of genuine
        // results behind an entity model that does not exist yet, so it stays in the index
        // and is MARKED instead: the record says what it is rather than implying a person.
        // See docs/review/PERSON-NAME-ARTEFACTS.md, "a modelling question, not a cleanup".
        const entryKind = artefactRule === 'candidate-list' ? 'candidate-list' : 'person';
        if (entryKind === 'candidate-list') candidateLists.add(displayName);
        const personId = cleanText(candidate.personId || candidate.person_id || candidate.personID || '') || `name:${slugify(name)}`;
        if (!byId.has(personId)) {
          byId.set(personId, {
            id: personId,
            slug: personSlug(personId, displayName),
            type: 'person',
            entryKind,
            title: displayName,
            name: displayName,
            parties: new Map(),
            constituencies: new Map(),
            genders: new Map(),
            // Names a person stood under. A person is many-to-many with names, so this
            // is a list, not a field: see data/elections/persons/name_registry.json.
            names: new Map(),
            elections: [],
            sourceKeys: new Set([`person:${personId}`]),
            officialIds: new Set(),
            totals: { stood: 0, elected: 0, firstPrefs: 0 },
            // The bodies stood for (Dáil Éireann, House of Commons ...), for Browse's filter.
            bodies: new Map(),
            firstYear: null,
            lastYear: null,
            browseUrl: `/browse/persons/${encodeURIComponent(personSlug(personId, displayName))}`
          });
        }
        const person = byId.get(personId);
        if (candidate.sourcePersonId) person.sourceKeys.add(String(candidate.sourcePersonId));
        for (const id of candidate.officialPersonIds || []) person.officialIds.add(String(id));
        const nameId = cleanText(candidate.name_id || '');
        if (nameId) {
          const seen = person.names.get(nameId) || { nameId, name, count: 0 };
          seen.count += 1;
          person.names.set(nameId, seen);
        }
        const party = cleanText(candidate.party || candidate.Party || result.party || '');
        const constituency = cleanText(candidate.constituency || result.constituency || '');
        const gender = cleanText(candidate.gender || candidate.Gender || candidate.genderId || candidate.Gender_Id || '');
        const year = context.year;
        person.parties.set(party || NO_LABEL, (person.parties.get(party || NO_LABEL) || 0) + 1);
        if (constituency) person.constituencies.set(constituency, (person.constituencies.get(constituency) || 0) + 1);
        if (gender) person.genders.set(gender, (person.genders.get(gender) || 0) + 1);
        if (electionBody) person.bodies.set(electionBody, (person.bodies.get(electionBody) || 0) + 1);
        person.totals.stood += 1;
        person.totals.elected += candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected' || candidate.status === 'Elected' ? 1 : 0;
        person.totals.firstPrefs += Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0);
        person.firstYear = person.firstYear === null ? year : Math.min(person.firstYear, year || person.firstYear);
        person.lastYear = person.lastYear === null ? year : Math.max(person.lastYear, year || person.lastYear);
        if (person.elections.length < PERSON_RELATED_LIMIT) {
          person.elections.push(compactObject({
            ...context,
            party,
            // The label as printed (a newspaper's or report's) and the ballot paper description:
            // browse.js shows them in its "As printed" column when the reader asks for it. An
            // inferred label carries its flag and evidence in both views.
            partyAsPrinted: cleanText(candidate.partyAsPrinted || candidate.Party_As_Printed || '') || undefined,
            ballotDescription: cleanText(candidate.ballotDescription || candidate.Ballot_Description || '') || undefined,
            partyInferred: candidate.partyInferred === true || candidate.Party_Inferred === true || undefined,
            partyBasis: cleanText(candidate.partyBasis || candidate.Party_Basis || '') || undefined,
            constituency,
            gender,
            dailAbbreviation: cleanText(candidate.dailAbbreviation || candidate.partyAbbreviation || candidate.Dail_Abbreviation || candidate.Party_Abbreviation || ''),
            officialCandidateId: cleanText(candidate.officialCandidateId || candidate.Official_Candidate_Id || ''),
            officialStatus: cleanText(candidate.officialStatus || candidate.Official_Status || ''),
            status: cleanText(candidate.status || candidate.outcome || ''),
            elected: Boolean(candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected'),
            firstPrefs: Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0) || null,
            share: candidateShare(candidate, contestPoll)
          }));
        }
      }
    }
  }

  // People who never stood in an election Civgraph holds (Northern Ireland Office ministers,
  // civil servants, party officers), registered so offices and affiliations can name them
  // (data/elections/persons/non-candidate-persons.json, docs/facts-model.md). They get a record
  // like any other person, with no contests.
  let registeredAdded = 0;
  for (const p of factsModel.nonCandidates) {
    const personId = String(p.personId);
    if (byId.has(personId)) continue;
    byId.set(personId, {
      id: personId,
      slug: personSlug(personId, p.displayName),
      type: 'person',
      entryKind: 'person',
      nonCandidate: true,
      title: p.displayName,
      name: p.displayName,
      parties: new Map(),
      constituencies: new Map(),
      genders: new Map(),
      names: new Map(),
      elections: [],
      sourceKeys: new Set([`person:${personId}`]),
      officialIds: new Set(p.officialPersonIds || []),
      totals: { stood: 0, elected: 0, firstPrefs: 0 },
      bodies: new Map(),
      firstYear: null,
      lastYear: null,
      registeredLife: { born: p.born || null, died: p.died || null, source: p.lifeSource || null },
      browseUrl: `/browse/persons/${encodeURIComponent(personSlug(personId, p.displayName))}`
    });
    registeredAdded += 1;
  }
  if (registeredAdded) console.log(`- persons: ${registeredAdded} registered non-candidate(s) added (people who hold offices but stood in no election held here)`);

  // Old person URLs, kept resolvable.
  //
  // Before candidacies carried registry ids, a person's id was `name:<slugified name>`
  // and the slug was that id slugified again, so Peter Robinson lived at
  // /browse/#/persons/name-peter-robinson. Those links are in the wild and the string no
  // longer appears in any field.
  //
  // This cannot be a redirect. Browse is hash-routed, and a fragment is never sent to
  // the server, so _redirects would never see the slug. findItem() already matches on
  // slug, id or key, so the fix is to make the old form something a record still
  // carries.
  //
  // Only where the name identifies ONE person. Registry ids deliberately separate people
  // who share a name, and the old URL conflated them: pointing it at whichever record
  // happened to sort first would assert an identity the data does not support. An
  // ambiguous old link is better left unresolved than silently answered wrong.
  const byName = new Map();
  for (const person of byId.values()) {
    const key = slugify(person.name);
    if (key) byName.set(key, (byName.get(key) || 0) + 1);
  }
  let aliased = 0;
  let ambiguousAliases = 0;
  for (const person of byId.values()) {
    const key = slugify(person.name);
    if (!key) continue;
    if (byName.get(key) > 1) { ambiguousAliases += 1; continue; }
    // Two forms are carried, not one.
    //
    //   name-peter-robinson   the pre-registry slug, from before candidacies had ids
    //   peter-robinson        the bare name
    //
    // The bare name is the one that matters going forward. The current slug ends in a
    // registry id, and those ids move whenever the registry is rebuilt or people are
    // merged -- which has already happened twice this month. An alias keyed only on the
    // OLD form would leave today's URLs just as fragile as yesterday's. Keyed on the
    // name, a person stays reachable across any number of id changes, for as long as the
    // name identifies them uniquely.
    const aliases = [slugify(`name:${key}`), key]
      .filter((alias) => alias && alias !== person.slug);
    if (aliases.length) {
      person.previousSlugs = [...new Set(aliases)];
      aliased += 1;
    }
  }
  console.log(`- persons: ${aliased} record(s) carry name aliases so their URLs survive an id change; ${ambiguousAliases} left unaliased because the name is shared`);
  if (candidateLists.size) {
    console.log(`- persons: ${candidateLists.size} record(s) marked entryKind "candidate-list", not people: ${[...candidateLists].join(', ')}`);
  }
  if (qualifiersStripped.size) {
    console.log(`- persons: stripped a Wikipedia qualifier from ${qualifiersStripped.size} name(s): ${[...qualifiersStripped].join(', ')}`);
  }

  let withHop = 0;
  let severalMembers = 0;
  // Official records of the person (data/elections/persons/official-person-ids.json) and the
  // Wikidata item that ties them together (official-person-crosswalk.json), with the dates
  // Wikidata gives. Shown as links out; the dates fill in where History of Parliament has none.
  const officialDoc = readJson('data/elections/persons/official-person-ids.json', { sources: {} });
  const crosswalkDoc = readJson('data/elections/persons/official-person-crosswalk.json', { ids: {}, people: {} });
  // Dates from published reference works (Boylan's Dictionary of Irish Biography), cited by
  // page, for people neither History of Parliament nor Wikidata dates.
  const referenceDates = readJson('data/elections/persons/reference-dates.json', { sources: {}, people: {} });
  const referenceDate = (personId, field) => {
    const r = referenceDates.people?.[personId];
    const work = r && referenceDates.sources?.[r.source];
    if (!r?.[field] || !work) return null;
    const page = String(r.pages?.[field] || r.page);
    const book = `${work.title} (${[work.edition, work.year].filter(Boolean).join(', ')}), ${/[-–]/.test(page) ? `pp. ${page.replace('-', '–')}` : `p. ${page}`}`;
    // Elliott & Flackes dates are added only where a second source gives the same date
    // (checkedAgainst); where the book is wrong (bookGives), the second sources are the
    // citation and the book's reading is named beside them.
    const checked = (r.checkedAgainst?.[field] || []).map((c) => c.title);
    const source = r.bookGives?.[field]
      ? `${checked.join('; ')} (${book}, gives ${r.bookGives[field]})`
      : [book, ...checked].join('; ');
    return { value: r[field], preferred: Boolean(r.preferOver?.[field]), source };
  };
  const officialProfiles = (ids) => {
    const out = [];
    const seen = new Set();
    const qids = new Set();
    for (const id of [...ids].sort()) {
      const [system, value] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      // A Wikidata item held directly (system "wikidata") is the person's item, linked once below.
      if (system === 'wikidata') {
        qids.add(value);
        continue;
      }
      const source = officialDoc.sources?.[system];
      if (source?.personUrl && !seen.has(id)) {
        seen.add(id);
        out.push({ source: source.publisher, label: source.title, url: source.personUrl.replace('{id}', encodeURIComponent(value)), licence: source.licence });
      }
      if (crosswalkDoc.ids?.[id]) qids.add(crosswalkDoc.ids[id]);
    }
    // One Wikidata item, or none: two would mean the record holds two people's ids.
    const qid = qids.size === 1 ? [...qids][0] : null;
    if (qid) out.push({ source: 'Wikidata', label: 'Wikidata', url: `https://www.wikidata.org/wiki/${qid}`, licence: 'CC0 1.0' });
    return { profiles: out, qid, life: qid ? crosswalkDoc.people?.[qid] || null : null };
  };
  // Offices held and family relations from the same reference work, cited by page
  // (scripts/lib/reference-person-facts.mjs). Seats Civgraph's election results show are
  // not in the files; a Commons seat gives way to History of Parliament's seat list.
  // Formal names official notices print where Civgraph shows a familiar or shorter one ("John
  // Beattie" for Jack Beattie), each cited (scripts/gazette/build_reference_names.py). Listed on
  // the record and searched as knownAliases; the display name is not changed.
  const referenceNamesDoc = readJson('data/elections/persons/reference-names.json', { sources: {}, people: {} });
  const formalNamesOf = (personId) => (referenceNamesDoc.people?.[personId] || []).map((entry) => ({
    name: entry.name,
    source: (entry.citations || []).map((c) => c.citation).join('; '),
    url: entry.citations?.[0]?.url || null,
  }));
  const referenceOfficeDoc = readJson('data/elections/persons/reference-offices.json', { people: {} });
  const referenceRelationDoc = readJson('data/elections/persons/reference-relations.json', { people: {} });
  const relativeLookup = (id) => {
    const other = byId.get(id);
    return other ? { title: other.title, slug: other.slug } : null;
  };
  const missingRelatives = new Set();
  let withOffices = 0;
  let withRelatives = 0;
  const lifeDate = (hop, official, reference, field) => {
    if (hop.length) return {};
    const wikidata = official.life?.[field];
    if (reference && (reference.preferred || !wikidata)) return { [field]: reference.value, [`${field}Source`]: reference.source };
    return wikidata ? { [field]: wikidata, [`${field}Source`]: official.life[`${field}Source`] || 'Wikidata' } : {};
  };
  let withOfficial = 0;
  // A citation as the person page shows it: the work and page, and the link where there is one.
  const shortCitation = (c) => compactObject({ title: c.title, url: c.url || undefined, page: c.page || undefined });
  const personOffices = (personId) => (factsIndex.tenuresByPerson.get(String(personId)) || []).map((t) => {
    const office = factsIndex.officeById.get(t.officeId) || {};
    const institution = factsIndex.institutionById.get(office.institution) || {};
    return compactObject({
      officeSlug: t.officeId,
      office: office.name || t.officeId,
      institution: institution.name,
      start: t.start, end: t.end,
      held: formatSpan(t.start, t.end, { startBy: t.startBy }),
      startBy: t.startBy || undefined,
      began: t.began || undefined, ended: t.ended || undefined,
      contestKey: t.contest || undefined,
      note: t.note || undefined,
      citations: (t.citations || []).map(shortCitation)
    });
  });
  // Peerages, knighthoods, the Privy Council, lieutenancies and seats in appointed or indirectly
  // chosen bodies (data/elections/persons/honours.json), dated and cited.
  const personHonours = (personId) => (factsIndex.honoursByPerson.get(String(personId)) || []).map((h) => compactObject({
    kind: h.kind,
    title: h.title,
    body: h.body || undefined,
    start: h.start, end: h.end,
    held: formatSpan(h.start, h.end, { startBy: h.startBy }),
    ended: h.ended || undefined,
    note: h.note || undefined,
    citations: (h.citations || []).map(shortCitation)
  }));
  // Each interval of a person's affiliation, and the candidacies inside it that carry another
  // party's label: the two are shown side by side, never reconciled by overwriting one.
  const personAffiliations = (person) => (factsIndex.affiliationsByPerson.get(String(person.id)) || []).map((a) => {
    const slug = a.partyId ? partySlugOf(a.partyId) : null;
    const inside = (row) => {
      const d = String(row.date || '');
      return d && (!a.start || d >= a.start) && (!a.end || d < a.end);
    };
    const otherLabels = a.kind === 'party' && slug ? normalizeArray(person.elections).filter((row) => inside(row) && row.party && row.party !== NO_LABEL
      && partyNames[normalizeName(row.party)] && partyNames[normalizeName(row.party)] !== slug).map((row) => compactObject({ key: row.key, title: row.title, date: row.date, label: row.party })) : [];
    return compactObject({
      kind: a.kind,
      party: a.partyId ? partyTitleOf(a.partyId) : a.label,
      partySlug: slug || undefined,
      start: a.start, end: a.end,
      startEvent: a.startEvent || undefined, endEvent: a.endEvent || undefined,
      span: formatSpan(a.start, a.end),
      otherLabels: otherLabels.length ? otherLabels : undefined,
      citations: (a.citations || []).map(shortCitation)
    });
  });
  const details = Object.fromEntries([...byId.values()].map(({ sourceKeys, officialIds, registeredLife, ...person }) => {
    const official = officialProfiles(officialIds);
    if (official.profiles.length) withOfficial += 1;
    const reached = [];
    for (const key of sourceKeys) {
      for (const r of hopPages.get(key) || []) {
        const seen = reached.find((x) => x.page.url === r.page.url);
        if (!seen) reached.push({ ...r });
        else if (r.strong) seen.strong = true;
      }
    }
    const strong = reached.filter((r) => r.strong);
    const hop = (strong.length ? strong : reached).map((r) => r.page);
    hop.sort((a, b) => a.volume.localeCompare(b.volume));
    // Pages for two different members on one record (Mervyn Archdall, father and son) mean
    // the record is several people; neither biography, nor its dates, is this record's.
    if (new Set(hop.map((p) => p.member)).size > 1) { severalMembers += 1; hop.length = 0; }
    if (hop.length) withHop += 1;
    const parties = mapToSortedArray(person.parties);
    const constituencies = mapToSortedArray(person.constituencies);
    const genders = mapToSortedArray(person.genders);
    const names = [...person.names.values()].sort((a, b) => b.count - a.count);
    // Largest gap between consecutive candidacy years, which is what makes a span
    // implausible rather than merely long: a 60-year career is possible, a 60-year gap
    // in the middle of one is not.
    const years = [...new Set((person.elections || [])
      .map((e) => Number(e.year)).filter((y) => Number.isFinite(y) && y > 0))].sort((a, b) => a - b);
    let careerGapYears = 0;
    for (let i = 1; i < years.length; i += 1) {
      careerGapYears = Math.max(careerGapYears, years[i] - years[i - 1]);
    }
    const officesHeld = referenceOffices(referenceOfficeDoc, person.id, { hasHop: hop.length > 0 });
    const offices = personOffices(person.id);
    const affiliationTimeline = personAffiliations(person);
    const honours = personHonours(person.id);
    const relatives = referenceRelatives(referenceRelationDoc, person.id, relativeLookup, missingRelatives);
    const formalNames = formalNamesOf(person.id);
    if (officesHeld.length) withOffices += 1;
    if (relatives.length) withRelatives += 1;
    const detail = {
      ...person,
      parties,
      constituencies,
      genders,
      bodies: mapToSortedArray(person.bodies).map((row) => row.name),
      names,
      nameCount: names.length,
      // Distinct NAMES, not distinct name records. The name layer keys on name_id, so one
      // person can hold two ids carrying the same spelling, and listing those produced
      // "Eamon de Valera, also stood as Eamon de Valera" on 14 records.
      alsoStoodAs: [...new Set(names.slice(1).map((n) => n.name))]
        .filter((n) => n && n !== person.name),
      gender: genders[0]?.name || null,
      // An implausible career is almost certainly several people under one name.
      //
      // audit_person_ids flags 163 of these. "Austin Stack" carries candidacies from 1918
      // and 2024, a 97-year gap; nobody stood in both. They cannot be split mechanically:
      // the candidacy ids on these rows are ROW INDICES -- '1', '8', '2', each carrying
      // many different names -- so there is nothing to attach the two halves to, and a
      // split would leave both unresolvable by anything but the shared name.
      //
      // What can be fixed is the claim. The record no longer presents a 106-year career as
      // a fact; it says the span is implausible and why. A visible doubt beats a confident
      // wrong answer, which is the same reason the registry flags the opposite case
      // needsReview rather than merging on a name.
      ...(careerGapYears >= 40 ? {
        spanImplausible: true,
        careerGapYears,
        reviewNote: `Candidacies ${careerGapYears} years apart are recorded under this name. `
          + 'That is longer than a career, so this is probably more than one person; the '
          + 'records cannot be separated automatically because the source rows carry no '
          + 'usable person identifier.',
      } : {}),
      subtitle: person.nonCandidate
        ? compactJoin([offices[0]?.office, offices[0]?.held])
        : compactJoin([parties[0]?.name, formatYearRange(person.firstYear, person.lastYear), `${person.totals.stood} contests`]),
      interactiveUrl: person.elections[0]?.interactiveUrl || null,
      ...(hop.length ? {
        historyOfParliament: hop.map(({ born, died, member, seats, ...page }) => page),
        // The seats he held and when, as HoP gives them; both volumes list the same seats,
        // so each seat and span is kept once, with the page it came from.
        seatsHeld: (() => {
          const seen = new Map();
          for (const page of hop) {
            for (const seat of page.seats || []) {
              const { key, ...shown } = seat;
              if (!seen.has(key)) seen.set(key, { ...shown, source: page.url });
            }
          }
          return [...seen.values()];
        })(),
        born: hop.map((p) => p.born).reduce(preciser, null),
        died: hop.map((p) => p.died).reduce(preciser, null),
      } : {}),
      ...(official.profiles.length ? { officialProfiles: official.profiles } : {}),
      ...(official.qid ? { wikidata: official.qid } : {}),
      // Dates from Wikidata where History of Parliament gives none, and from a reference work
      // where neither does.
      // (A reference date marked preferOver, which a second source confirms, wins over Wikidata.)
      ...lifeDate(hop, official, referenceDate(person.id, 'born'), 'born'),
      ...lifeDate(hop, official, referenceDate(person.id, 'died'), 'died'),
      ...(officesHeld.length ? { officesHeld } : {}),
      ...(offices.length ? { offices } : {}),
      ...(affiliationTimeline.length ? { affiliationTimeline } : {}),
      ...(honours.length ? { honours } : {}),
      // A registered non-candidate's dates, from Wikidata, where nothing above gives them.
      // (A reference date the second sources confirm and that is preferred stays.)
      ...(registeredLife?.born && !hop.length && !official.life?.born && !referenceDate(person.id, 'born')?.preferred ? { born: registeredLife.born, bornSource: registeredLife.source || 'Wikidata' } : {}),
      ...(registeredLife?.died && !hop.length && !official.life?.died && !referenceDate(person.id, 'died')?.preferred ? { died: registeredLife.died, diedSource: registeredLife.source || 'Wikidata' } : {}),
      ...(relatives.length ? { relatives } : {}),
      ...(formalNames.length ? { formalNames, knownAliases: formalNames.map((entry) => entry.name) } : {}),
    };
    return [detail.slug, detail];
  }));
  console.log(`- persons: ${withOfficial} record(s) link to an official or Wikidata record of the person`);
  console.log(`- persons: ${withOffices} record(s) list offices and ${withRelatives} list relatives from a reference work`);
  const staleReferenceIds = [...new Set([...Object.keys(referenceOfficeDoc.people || {}), ...Object.keys(referenceRelationDoc.people || {}), ...missingRelatives])]
    .filter((id) => !byId.has(id));
  if (staleReferenceIds.length) {
    console.log(`- persons: WARNING ${staleReferenceIds.length} id(s) in reference-offices/relations.json are not in the person index (merged or renumbered?): ${staleReferenceIds.join(', ')}`);
  }
  if (hopPages.size) {
    console.log(`- persons: ${withHop} record(s) cite their History of Parliament biography; `
      + `${severalMembers} left without, because pages for more than one member reach them`);
  }

  const items = Object.values(details).map((person) => compactObject({
    ...person,
    relatedElectionCount: person.elections.length
  })).sort((a, b) => (b.totals.elected - a.totals.elected) || (b.totals.stood - a.totals.stood) || a.title.localeCompare(b.title));

  if (referendumsSkipped) {
    console.log(`- persons: skipped ${referendumsSkipped} referendum(s); their options are not people`);
  }
  if (notPeople.size) {
    const total = [...notPeople.values()].reduce((sum, n) => sum + n, 0);
    const names = [...notPeople.entries()].sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name} (${n})`).join(', ');
    console.log(`- persons: skipped ${total} candidacy row(s) whose name is not a person: ${names}`);
  }
  return { persons: items, personDetails: details };
}

/**
 * A register entry names its member but not their person record, so its page could link only
 * to the graph's entity view. The member is matched to a person by name and by having stood in
 * the entry's constituency; only a single match is linked, so two people of one name who both
 * stood there are left unlinked rather than guessed between.
 */
function linkRegisterInterestsToPersons(records, persons) {
  const byName = new Map();
  for (const person of persons) {
    const key = normalizeName(person.name || person.title);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(person);
  }
  let linked = 0;
  for (const record of records) {
    const candidates = byName.get(normalizeName(record.memberName)) || [];
    const places = new Set([record.constituency, ...normalizeArray(record.constituencies)].map(normalizeName).filter(Boolean));
    const matches = candidates.filter((person) => normalizeArray(person.constituencies)
      .some((place) => places.has(normalizeName(place?.name || place))));
    if (matches.length === 1) {
      record.personSlug = matches[0].slug;
      linked += 1;
    }
  }
  console.log(`- register interests linked to a person: ${linked} of ${records.length}`);
}

function buildRegisterInterests(data) {
  return expandRegisterInterestRecords(data).map((entry) => {
    const interests = normalizeArray(entry.interests);
    const categories = uniqueCleanStrings(entry.categories || interests.map((interest) => interest.category) || entry.category);
    const id = entry.id || `register-interest:${slugify(`${entry.memberName || 'member'}-${entry.electedBody || entry.memberType || 'body'}-${entry.date || ''}`)}`;
    const date = entry.date || entry.latestDeclaration || entry.earliestDeclaration || entry.editionDate || entry.startDate || null;
    const memberName = cleanText(entry.memberName || 'Unknown member');
    const category = cleanText(entry.category || (categories.length === 1 ? categories[0] : `${categories.length || interests.length || 1} categories`));
    const constituency = entry.constituency || normalizeArray(entry.constituencies)[0] || null;
    const chamber = cleanText(entry.chamber || '');
    const electedBody = cleanText(entry.electedBody || (/House of Commons/i.test(chamber) ? 'House of Commons' : 'Assembly'));
    const memberType = cleanText(entry.memberType || '');
    const title = cleanText(entry.title || `${memberName} - ${electedBody} - ${date || 'Undated register'}`);
    const slug = entry.slug || slugify(id);
    const sourceRefs = normalizeArray(entry.sourceRefs);
    const sourceUrls = normalizeArray(entry.sourceUrls || sourceRefs.map((ref) => ref.sourceUrl)).filter(Boolean);
    const sourceTitles = normalizeArray(entry.sourceTitles || sourceRefs.map((ref) => ref.sourceTitle)).filter(Boolean);
    const sourceKinds = normalizeArray(entry.sourceKinds || sourceRefs.map((ref) => ref.sourceKind)).filter(Boolean);
    const sourceUrl = entry.sourceUrl || sourceUrls[0] || null;
    const references = normalizeReferences(entry.references || sourceRefs.map((ref) => ({ label: ref.sourceTitle || ref.sourceKind || 'Register source', url: ref.sourceUrl })).filter((ref) => ref.url));
    const interestSummary = truncateText(entry.interestSummary || entry.interestText || entry.description || summarizeRegisterInterestEntries(interests), 500);
    return compactObject({
      id,
      slug,
      type: 'register-interest',
      recordKind: entry.recordKind,
      title,
      subtitle: compactJoin([memberType, electedBody, constituency, date]),
      category,
      categories,
      categoryCount: entry.categoryCount || categories.length || null,
      date,
      provider: normalizeArray(entry.provider),
      description: truncateText(interestSummary, 240),
      interestSummary,
      interests,
      interestCount: entry.interestCount || interests.length || null,
      nonNilInterestCount: entry.nonNilInterestCount,
      hasNilInterests: entry.hasNilInterests,
      chamber,
      electedBody,
      memberType,
      jurisdiction: entry.jurisdiction,
      memberName,
      constituency,
      constituencies: normalizeArray(entry.constituencies),
      parties: normalizeArray(entry.parties),
      publicWhipId: entry.publicWhipId,
      sourceRecordId: entry.sourceRecordId,
      sourceTitle: entry.sourceTitle || sourceTitles[0],
      sourceTitles,
      sourceKind: entry.sourceKind || sourceKinds[0],
      sourceKinds,
      sourceUrl,
      sourceUrls,
      sourceCount: entry.sourceCount || sourceRefs.length || sourceUrls.length || null,
      duplicateSourceRowCount: entry.duplicateSourceRowCount,
      sourceRefs,
      dateStart: entry.dateStart,
      dateEnd: entry.dateEnd,
      extractionMethod: entry.extractionMethod,
      extractionConfidence: entry.extractionConfidence,
      isNone: entry.isNone,
      references,
      keywords: normalizeArray(entry.keywords).slice(0, 16),
      detailUrl: entry.detailUrl,
      browseUrl: `/browse/register-interests/${encodeURIComponent(slug)}`
    });
  }).sort(sortRegisterInterestRecords);
}

function expandRegisterInterestRecords(data) {
  const direct = normalizeArray(data?.interests || data?.items);
  if (direct.length) return direct;
  return normalizeArray(data?.browseShards || data?.canonicalShards || data?.shards).flatMap((shard) => {
    const relPath = String(shard.path || shard.url || '').replace(/^\/+/, '').replace(/[?#].*$/, '');
    if (!relPath) return [];
    const shardData = readJson(relPath, { interests: [], items: [] });
    const detailUrl = shard.url || `/${relPath.replace(/\\/g, '/')}`;
    return normalizeArray(shardData.interests || shardData.items).map((entry) => compactObject({ ...entry, detailUrl }));
  });
}

function sortRegisterInterestRecords(a, b) {
  return sortableRegisterDate(b.date).localeCompare(sortableRegisterDate(a.date))
    || String(a.memberName || '').localeCompare(String(b.memberName || ''))
    || String(a.electedBody || '').localeCompare(String(b.electedBody || ''))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function sortableRegisterDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

function summarizeRegisterInterestEntries(interests) {
  const rows = normalizeArray(interests);
  const nonNil = rows.filter((interest) => !interest.isNone);
  return (nonNil.length ? nonNil : rows).slice(0, 3).map((interest) => {
    const text = truncateText(interest.interestText || '', 120);
    return compactJoin([interest.category, text], ': ');
  }).filter(Boolean).join(' / ');
}

function mergeSourceEnrichmentInputs(...inputs) {
  return {
    targets: inputs.flatMap((input) => normalizeArray(input?.targets)),
    reviewRows: inputs.flatMap((input) => normalizeArray(input?.reviewRows))
  };
}

/**
 * Catalogue words a reader can use, in the record, the D1 column and the facet alike (UX review
 * M3). The publication pipeline's categories carry its own stage names ("Approved tables",
 * "Medium-priority: Local authority planning/property/open-data layers"); a licence was spelt
 * five ways ("CC BY 4.0", "Creative Commons Attribution 4.0", "cc-by", ...), each its own
 * filter option; and emitted descriptions end "Published as a Books/Tables/Sources source
 * record under CC BY 4.0", which is the pipeline describing itself.
 */
// A function, not a module const: main() runs on import, before a later const is initialised.
function licenceLabels() {
  return new Map([
    ['creative commons attribution 4.0', 'CC BY 4.0'],
    // data.gov.ie's licence ids: its "cc-by" is Creative Commons Attribution 4.0.
    ['cc-by', 'CC BY 4.0'],
    ['cc-by-sa', 'CC BY-SA 4.0'],
    ['creative commons attribution share-alike 4.0', 'CC BY-SA 4.0'],
    ['cc-by-nc', 'CC BY-NC 4.0'],
    ['cc-by-nc-sa', 'CC BY-NC-SA 4.0'],
    ['creative commons attribution-noncommercial-noderivatives 4.0', 'CC BY-NC-ND 4.0'],
    ['cc-zero', 'CC0 1.0'],
    ['open government licence v3.0', 'OGL v3.0'],
    ['uk open government licence (ogl)', 'OGL v3.0'],
    ['license not specified', 'Not specified'],
    ['licence not specified', 'Not specified']
  ]);
}

function readerLicence(value) {
  if (typeof value !== 'string') return value;
  const text = cleanText(value);
  readerLicence.labels ||= licenceLabels();
  return readerLicence.labels.get(text.toLowerCase()) || text;
}

function readerSourceCategory(value) {
  if (typeof value !== 'string') return value;
  const text = cleanText(value)
    .replace(/^Medium-priority:\s*/i, '')
    .replace(/^Approved\s+(?=\S)/i, '');
  if (text === 'data-population') return 'Population data';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function applySourceReaderLabels(source) {
  if (source.category) source.category = readerSourceCategory(source.category);
  if (source.license) source.license = readerLicence(source.license);
  if (typeof source.description === 'string') {
    source.description = source.description
      .replace(/\s*Published as a Books\/Tables\/Sources source(?:[- ]table)? record(?: under ([^.]+))?\./,
        (match, licence) => (licence ? ` Licence: ${readerLicence(licence)}.` : ''))
      .trim();
  }
}

function buildSources(booksData, dataEntriesData, maps, elections, thumbnailIds, externalSourcesData = {}, alreadyOnSiteEnrichmentsData = {}) {
  const sources = [];
  const bookCategories = new Map((booksData.categories || []).map((category) => [category.id, category]));
  for (const book of normalizeArray(booksData.books || booksData.items)) {
    const id = `book:${book.id || book.slug || slugify(book.title || book.name)}`;
    const category = bookCategories.get(book.category) || {};
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'book',
      title: cleanText(book.title || book.name || id),
      subtitle: compactJoin([book.year, book.publisher, category.name]),
      category: category.name || book.category || 'Books',
      date: book.date || book.year || null,
      provider: normalizeArray(book.provider || book.publisher),
      description: cleanText(book.description || ''),
      thumbnail: thumbnailForCandidates(thumbnailIds, [`book-${book.id || book.slug}`, book.thumbnailId], book.title || book.name || id, 'book'),
      references: normalizeReferences(book.references),
      downloads: normalizeLinks([book.downloads, book.file, book.pdf, book.url, book.archiveUrl].filter(Boolean)),
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const entry of normalizeArray(dataEntriesData.dataEntries || dataEntriesData.entries)) {
    const id = `table:${entry.id || entry.slug || slugify(entry.title || entry.name)}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'table',
      title: cleanText(entry.title || entry.name || id),
      subtitle: compactJoin([entry.year, entry.provider, entry.category]),
      category: entry.category || 'Tables',
      date: entry.date || entry.year || null,
      provider: normalizeArray(entry.provider || entry.providers),
      description: cleanText(entry.description || ''),
      thumbnail: thumbnailForCandidates(thumbnailIds, [entry.layerId, entry.mapId, entry.sourceMapId, entry.geography, entry.id], entry.title || entry.name || id, 'table'),
      license: entry.source?.licence?.short || entry.source?.licence?.name || null,
      references: normalizeReferences(entry.references || entry.sources || entry.source),
      downloads: normalizeLinks([entry.downloads, entry.sourceDownload, entry.file, entry.files, entry.csv ? `${CDN_BASE}/${String(entry.csv).replace(/^\/+/, '')}` : null].filter(Boolean)),
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const map of maps) {
    if (map.type !== 'map') continue;
    if (!map.sourceFiles?.length && !map.downloads?.length && !map.references?.length) continue;
    const id = `map-source:${map.id}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'map-source',
      title: `${map.title} source files`,
      subtitle: compactJoin([map.category, map.provider?.join(', ')]),
      category: 'Map sources',
      date: map.date || null,
      provider: map.provider,
      description: map.description,
      sourceMapId: map.id,
      thumbnail: map.thumbnail || null,
      references: map.references,
      downloads: [...(map.downloads || []), ...(map.sourceFiles || [])],
      interactiveUrl: map.interactiveUrl,
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const election of elections) {
    if (!election.resultUrl && !election.anchorUrl) continue;
    const id = `election-source:${election.key}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'election-source',
      title: `${election.title} ${election.date || ''}`.trim(),
      subtitle: compactJoin([election.body, election.subtitle]),
      category: 'Election sources',
      date: election.date || null,
      provider: normalizeArray(election.provider),
      description: `Generated election bundle for ${election.title}.`,
      sourceMapId: election.sourceMapId,
      thumbnail: election.thumbnail || null,
      references: normalizeReferences(election.references || []),
      downloads: normalizeLinks([election.resultUrl, election.anchorUrl].filter(Boolean)),
      interactiveUrl: election.interactiveUrl,
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
  for (const entry of normalizeArray(externalSourcesData.sources || externalSourcesData.items)) {
    const id = entry.id || `external:${slugify(entry.title || entry.url || '')}`;
    const title = cleanText(entry.title || entry.name || id);
    const slug = entry.slug || slugify(id);
    const references = normalizeReferences(entry.references || entry.sourceReferences || entry.source || entry.url);
    const downloads = normalizeLinks([entry.downloads, entry.links, entry.downloadUrl].filter(Boolean));
    sources.push(compactObject({
      id,
      slug,
      type: entry.type || 'external-source',
      title,
      subtitle: cleanText(entry.subtitle || compactJoin([entry.date || entry.year, entry.provider, entry.category])),
      category: entry.category || 'External sources',
      date: entry.date || entry.year || null,
      provider: normalizeArray(entry.provider || entry.providers || entry.source),
      description: cleanText(entry.description || ''),
      url: entry.url || references.find((ref) => ref.url)?.url || null,
      thumbnail: normalizeExternalThumbnail(entry.thumbnail, title),
      references,
      downloads,
      keywords: normalizeArray(entry.keywords),
      sourceItems: normalizeArray(entry.sourceItems),
      status: entry.status || normalizeArray(entry.statusChips)[0] || null,
      statusChips: normalizeArray(entry.statusChips),
      sourceHierarchy: normalizeArray(entry.sourceHierarchy),
      viewport: entry.viewport || null,
      shortCitation: entry.shortCitation || null,
      fullCitation: entry.fullCitation || null,
      relatedRecords: normalizeArray(entry.relatedRecords),
      duplicateCount: entry.duplicateCount || null,
      license: entry.license || null,
      approval: entry.approval || null,
      publicationStatus: entry.publicationStatus || null,
      proposedBrowsePath: entry.proposedBrowsePath || null,
      variantOf: entry.variantOf || null,
      parentId: entry.parentId || null,
      parentTitle: entry.parentTitle || null,
      relationship: entry.relationship || null,
      browseUrl: `/browse/sources/${encodeURIComponent(slug)}`
    }));
  }
  applyAlreadyOnSiteEnrichments(sources, alreadyOnSiteEnrichmentsData);
  return sources.sort(sortByTitle);
}

/**
 * Merge source records that are the same work listed more than once (UX review 2026-10-31,
 * M3: "(Continue to) Make Inroads ..." appeared three times under three pipeline categories).
 *
 * Conservative: two records are merged only on direct evidence that they are one work --
 *   1. the same title (folded) AND the same address (scheme, www, query and trailing slash
 *      ignored); or
 *   2. the same title AND one record's approval names the other as the record it was
 *      staged from (approval.stagingId, medium-prep:x = medium-priority:x).
 * A shared title alone is not enough: the CSO publishes several different census tables
 * called "Population" in one year, each with its own matrix code.
 *
 * The surviving record gains the others' providers, keywords, references and downloads, lists
 * them in mergedFrom (id, slug, type, category, approval, variant parent) and keeps their
 * slugs in previousSlugs, which the browse index, /_api/sources and /browse/sources/<slug>
 * resolve to it. Returns the merges for the report. Mutates `sources`.
 */
function mergeDuplicateSources(sources) {
  // The pipeline record types a work can be listed under more than once: the publication gate,
  // the medium-priority tranches, variants and the raw source tables and documents. Books,
  // maps, elections and external sources are curated one record per work and never merged.
  const MERGEABLE_SOURCE_TYPE = /^(approved-|raw-source-|medium-priority|peatland-geoportal-)/;
  // Which record of a merged group keeps its address, other things equal: the reader-facing
  // reference or book record before a table or variant staged from it.
  const SOURCE_SURVIVOR_ORDER = [
    'approved-book-or-report-source', 'approved-source-reference-source', 'approved-spatial-source-source',
    'approved-medium-priority-source', 'approved-table-source', 'approved-variant-source',
    'raw-source-document', 'raw-source-table'
  ];
  const foldTitle = (value) => String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const canonicalUrl = (value) => String(value || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '')
    .replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
  const stagingKey = (value) => String(value || '').replace(/^medium-prep:/, 'medium-priority:');
  const mergeable = sources.filter((source) => MERGEABLE_SOURCE_TYPE.test(String(source.type || '')) && foldTitle(source.title));

  const parent = new Map(mergeable.map((source) => [source, source]));
  const find = (source) => {
    let root = source;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(source, root);
    return root;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); };

  const byTitleUrl = new Map();
  const byId = new Map(mergeable.map((source) => [String(source.id), source]));
  for (const source of mergeable) {
    if (!source.url) continue;
    const key = `${foldTitle(source.title)}\u0000${canonicalUrl(source.url)}`;
    if (byTitleUrl.has(key)) union(byTitleUrl.get(key), source);
    else byTitleUrl.set(key, source);
  }
  for (const source of mergeable) {
    const staged = byId.get(stagingKey(source.approval?.stagingId));
    if (staged && staged !== source && foldTitle(staged.title) === foldTitle(source.title)) union(staged, source);
  }

  const groups = new Map();
  for (const source of mergeable) {
    const root = find(source);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(source);
  }
  const rank = (source) => {
    const order = SOURCE_SURVIVOR_ORDER.indexOf(source.type);
    return [
      source.url ? 1 : 0,
      normalizeArray(source.references).length + normalizeArray(source.downloads).length,
      source.description ? 1 : 0,
      -(order === -1 ? SOURCE_SURVIVOR_ORDER.length : order)
    ];
  };
  const better = (a, b) => {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
    return String(a.id) < String(b.id);
  };

  const merges = [];
  const removed = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Only a record of the approved-publication gate is merged away: its validator
    // (validate-approved-publication-path.mjs) finds it in the survivor's mergedFrom. The
    // medium-priority, raw-source and peatland validators require each of their records to
    // stand on its own, so those are only ever the record that survives.
    const removable = (source) => /^approved-(publication|variant):/.test(String(source.id || ''));
    const keepers = group.filter((source) => !removable(source));
    const pool = keepers.length ? keepers : group;
    const survivor = pool.reduce((best, source) => (better(source, best) ? source : best));
    const others = group.filter((source) => source !== survivor && removable(source));
    if (!others.length) continue;
    survivor.provider = [...new Set([...normalizeArray(survivor.provider), ...others.flatMap((source) => normalizeArray(source.provider))])];
    survivor.keywords = mergeKeywordLists(survivor.keywords, ...others.map((source) => source.keywords));
    survivor.references = dedupeReferences([...normalizeReferences(survivor.references), ...others.flatMap((source) => normalizeReferences(source.references))]);
    const downloads = new Map();
    for (const link of [...normalizeArray(survivor.downloads), ...others.flatMap((source) => normalizeArray(source.downloads))]) {
      const key = typeof link === 'string' ? link : (link?.url || JSON.stringify(link));
      if (!downloads.has(key)) downloads.set(key, link);
    }
    survivor.downloads = [...downloads.values()];
    if (!survivor.description) survivor.description = others.find((source) => source.description)?.description;
    if (!survivor.license) survivor.license = others.find((source) => source.license)?.license;
    if (!survivor.date) survivor.date = others.find((source) => source.date)?.date;
    survivor.mergedFrom = others.map((source) => compactObject({
      id: source.id,
      slug: source.slug,
      type: source.type,
      category: source.category,
      approval: compactObject({ recommendedAction: source.approval?.recommendedAction }),
      variantOf: source.variantOf?.id ? { id: source.variantOf.id } : undefined
    }));
    survivor.previousSlugs = [...new Set([...normalizeArray(survivor.previousSlugs), ...others.map((source) => source.slug).filter(Boolean)])];
    for (const source of others) removed.add(source);
    merges.push({
      id: survivor.id,
      slug: survivor.slug,
      title: survivor.title,
      merged: others.map((source) => ({ id: source.id, slug: source.slug, type: source.type, category: source.category }))
    });
  }
  for (let i = sources.length - 1; i >= 0; i -= 1) if (removed.has(sources[i])) sources.splice(i, 1);
  const byRule = merges.length ? `${merges.length} record(s) now stand for ${removed.size + merges.length}` : 'none';
  console.log(`- sources: merged duplicate listings of one work: ${byRule}; ${removed.size} record(s) removed, their addresses kept as previousSlugs (data/browse/source-merges.json)`);
  for (const merge of merges.slice(0, 5)) {
    console.log(`    ${merge.title} <- ${merge.merged.map((m) => m.type).join(', ')}`);
  }
  return merges.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The reference works the election results are taken from or checked against
 * (data/database/reference-works.json), as source records, each saying how many contests cite
 * it (data/database/election-provenance.json) so a reader following a citation finds the work
 * and what Civgraph takes from it (UX review 2026-10-31, L12).
 */
function referenceWorkSources() {
  const works = normalizeArray(readJson('data/database/reference-works.json', { sources: [] }).sources);
  if (!works.length) return [];
  const provenance = normalizeArray(readJson('data/database/election-provenance.json', { contests: [] }).contests);
  return works.map((work) => {
    const cites = (source) => normalizeArray(work.citedAs).some((text) => String(source?.title || '').includes(text) || String(source?.url || '').includes(text));
    let contests = 0;
    let checked = 0;
    const bodies = new Set();
    for (const contest of provenance) {
      const matching = normalizeArray(contest.sources).filter(cites);
      if (!matching.length) continue;
      contests += 1;
      if (matching.some((source) => source.checked)) checked += 1;
      if (contest.body) bodies.add(contest.body);
    }
    const electorates = work.electorateFile
      ? normalizeArray(readJson(work.electorateFile, { records: [] }).records).length
      : 0;
    const authors = normalizeArray(work.authors);
    const byline = work.editorNote ? `${work.editorNote.charAt(0).toUpperCase()}${work.editorNote.slice(1)}` : authors.join(', ');
    const imprint = [work.place, work.publisher, work.date].filter(Boolean).join(', ');
    const usage = [
      contests ? `${formatCount(contests)} contest ${contests === 1 ? 'record cites' : 'records cite'} it as a source${checked ? `, ${formatCount(checked)} of them with figures checked against it` : ''}.` : '',
      electorates ? `Electorates for ${formatCount(electorates)} contests are read from it.` : ''
    ].filter(Boolean).join(' ');
    const references = [
      work.url ? { label: work.archiveUrl ? 'The work online' : 'The work', url: work.url, source: work.publisher, role: 'source-work' } : null,
      work.archiveUrl ? { label: 'Internet Archive copy', url: work.archiveUrl, source: 'Internet Archive', role: 'source-mirror' } : null,
      ...normalizeArray(work.pages).map(([label, url]) => ({
        label: `${label} (Internet Archive copy, 2020)`,
        url: `https://web.archive.org/web/2020/${url}`,
        source: 'Internet Archive',
        role: 'source-page'
      }))
    ].filter(Boolean);
    const fullCitation = `${authors.length ? `${authors.join(', ')}${work.editorNote && /edited/.test(work.editorNote) ? ' (ed.)' : ''}, ` : ''}${work.title}${imprint ? ` (${imprint})` : ''}${work.isbn ? `, ISBN ${work.isbn}` : ''}.${work.reprint ? ` ${work.reprint}` : ''}`;
    return compactObject({
      id: work.id,
      slug: slugify(work.id),
      type: 'reference-work',
      title: work.title,
      subtitle: compactJoin([byline, imprint]),
      category: work.category || 'Reference works',
      date: work.date || null,
      provider: [work.publisher].filter(Boolean),
      description: [work.description, work.reprint && !String(work.description || '').includes('Reprinted') ? work.reprint : '',
        `How Civgraph uses it: ${work.uses}`, usage, work.copyright].filter(Boolean).join(' '),
      url: work.url || null,
      references,
      keywords: [...normalizeArray(work.keywords), ...authors, ...[...bodies].map(humanizeSlug)],
      shortCitation: `${authors[0]?.split(/[,(]/)[0].trim() || work.publisher}${work.date ? ` (${work.date})` : ''}`,
      fullCitation,
      license: work.copyright ? { status: 'provider-specific', note: work.copyright } : null,
      publicationStatus: 'reference'
    });
  });
}

function formatCount(value) {
  return Number(value).toLocaleString('en-GB');
}

function applyAlreadyOnSiteEnrichments(sources, alreadyOnSiteEnrichmentsData = {}) {
  const targets = normalizeArray(alreadyOnSiteEnrichmentsData.targets);
  if (!targets.length) return;

  const byId = new Map(sources.map((source) => [String(source.id || ''), source]));
  for (const target of targets) {
    const sourceTargetId = cleanText(target.sourceTargetId || '');
    if (!sourceTargetId) continue;
    const sourceItems = normalizeArray(target.sourceItems);
    if (!sourceItems.length) continue;

    const existing = byId.get(sourceTargetId);
    const provenanceSummary = sourceEnrichmentProvenanceSummary(target);
    const enrichment = compactObject({
      sourceTargetId,
      targetEntityKind: target.targetEntityKind,
      targetEntityId: target.targetEntityId,
      targetTitle: target.targetTitle,
      targetBrowseUrl: target.targetBrowseUrl,
      sourceItemCount: target.sourceItemCount || sourceItems.length,
      confidence: target.confidence,
      safetyClasses: normalizeArray(target.safetyClasses),
      formats: normalizeArray(target.formats),
      providers: normalizeArray(target.providers),
      categories: normalizeArray(target.categories),
      enrichmentTypes: normalizeArray(target.enrichmentTypes),
      arcgisItemIds: uniqueCleanStrings(sourceItems.map((item) => item.arcgisItemId)),
      arcgisItemPages: uniqueCleanStrings(sourceItems.map((item) => item.arcgisItemPage)),
      serviceUrls: uniqueCleanStrings(sourceItems.map((item) => item.serviceUrl)),
      modifiedDates: uniqueCleanStrings(sourceItems.map((item) => item.modified)),
      accessStates: uniqueCleanStrings(sourceItems.map((item) => item.access)),
      licenseNotes: uniqueCleanStrings(sourceItems.map((item) => item.licenseNote)),
      provenanceSummary,
      sourceItems,
      evidence: normalizeArray(target.evidence)
    });

    if (existing) {
      existing.alreadyOnSiteEnrichments = [...normalizeArray(existing.alreadyOnSiteEnrichments), enrichment];
      existing.sourceItems = mergeSourceItems(existing.sourceItems, sourceItems);
      existing.references = dedupeReferences([
        ...normalizeReferences(existing.references),
        ...sourceEnrichmentReferences(target)
      ]);
      existing.keywords = mergeKeywordLists(existing.keywords, [
        'already-on-site-enrichment',
        'duplicate-source-match',
        ...normalizeArray(target.enrichmentTypes)
      ]);
      existing.description = appendSentence(
        existing.description,
        provenanceSummary || `${sourceItems.length} additional already-on-site duplicate-match source ${sourceItems.length === 1 ? 'row is' : 'rows are'} staged as metadata/provenance enrichment for this existing record.`
      );
      existing.publicationStatus = existing.publicationStatus || 'enriched';
      continue;
    }

    const title = cleanText(target.targetTitle || sourceTargetId);
    const id = `already-on-site-enrichment:${slugify(sourceTargetId)}`;
    sources.push(compactObject({
      id,
      slug: slugify(id),
      type: 'already-on-site-enrichment-source',
      title: target.targetEntityKind === 'source-family' ? `${title} provenance enrichment` : `${title} source/provenance enrichment`,
      subtitle: compactJoin([
        `${sourceItems.length} duplicate-match source ${sourceItems.length === 1 ? 'row' : 'rows'}`,
        normalizeArray(target.providers).join(', '),
        normalizeArray(target.formats).join(', ')
      ]),
      category: 'Already-on-site source enrichments',
      provider: normalizeArray(target.providers),
      description: provenanceSummary || `Additional source/provenance metadata for an existing Civgraph record. This does not create a duplicate map or data parent record.`,
      references: sourceEnrichmentReferences(target),
      downloads: [],
      sourceItems,
      alreadyOnSiteEnrichments: [enrichment],
      publicationStatus: 'enrichment-staged',
      proposedBrowsePath: 'Books / Tables / Sources > Already-on-site source enrichments',
      parentId: target.targetEntityId || sourceTargetId,
      parentTitle: title,
      relationship: 'metadata-enrichment',
      approval: compactObject({
        recommendedAction: 'enrich existing record; do not create duplicate parent',
        stagingId: sourceTargetId,
        confidence: target.confidence,
        sourceType: 'already-on-site duplicate match',
        provider: normalizeArray(target.providers).join('; ')
      }),
      keywords: mergeKeywordLists(['already-on-site-enrichment', 'duplicate-source-match'], normalizeArray(target.enrichmentTypes)),
      browseUrl: `/browse/sources/${encodeURIComponent(slugify(id))}`
    }));
  }
}

function mergeSourceItems(existing, additions) {
  const out = [];
  const seen = new Set();
  for (const item of [...normalizeArray(existing), ...normalizeArray(additions)]) {
    const key = JSON.stringify([
      item.arcgisItemId || '',
      item.arcgisItemPage || '',
      item.serviceUrl || '',
      item.auditRowNumber || '',
      item.title || '',
      normalizeArray(item.formats).join('|')
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sourceEnrichmentProvenanceSummary(target) {
  const sourceItems = normalizeArray(target.sourceItems);
  if (!sourceItems.length) return '';
  if (!sourceItems.some(isArcgisSourceItem)) return genericSourceEnrichmentProvenanceSummary(target);
  const corpusLabel = isPeatlandEnrichmentTarget(target) ? 'Peatland Geoportal ArcGIS' : 'ArcGIS';
  const providers = uniqueCleanStrings([
    ...sourceItems.map((item) => item.provider),
    ...normalizeArray(target.providers)
  ]);
  const itemIds = uniqueCleanStrings(sourceItems.map((item) => item.arcgisItemId));
  const serviceUrls = uniqueCleanStrings(sourceItems.map((item) => item.serviceUrl));
  const modifiedDates = uniqueCleanStrings(sourceItems.map((item) => formatArcgisDate(item.modified)));
  const accessStates = uniqueCleanStrings(sourceItems.map((item) => item.access));
  const licenseNotes = uniqueCleanStrings(sourceItems.map((item) => item.licenseNote)).map(stripTrailingSentencePunctuation);
  const relatedCount = sourceItems.reduce((sum, item) => sum + normalizeArray(item.siblingItems).length, 0);
  const parts = [
    `${sourceItems.length} ${corpusLabel} metadata ${sourceItems.length === 1 ? 'item' : 'items'} staged as provenance for this existing Civgraph record`
  ];
  if (providers.length) parts.push(`owner/provider: ${limitListForSentence(providers, 4)}`);
  if (itemIds.length) parts.push(`ArcGIS item ${itemIds.length === 1 ? 'ID' : 'IDs'}: ${limitListForSentence(itemIds, 4)}`);
  if (modifiedDates.length) parts.push(`modified: ${limitListForSentence(modifiedDates, 3)}`);
  if (accessStates.length) parts.push(`access: ${limitListForSentence(accessStates, 3)}`);
  if (serviceUrls.length) parts.push(`${serviceUrls.length} service ${serviceUrls.length === 1 ? 'link' : 'links'} preserved as references`);
  if (relatedCount) parts.push(`${relatedCount} related ArcGIS sibling/context ${relatedCount === 1 ? 'item' : 'items'} preserved as references`);
  if (licenseNotes.length) parts.push(`licence note: ${limitListForSentence(licenseNotes, 2)}`);
  return `${parts.join('; ')}.`;
}

function genericSourceEnrichmentProvenanceSummary(target) {
  const sourceItems = normalizeArray(target.sourceItems);
  const targetLabel = target.targetEntityKind === 'source-family' ? 'this Civgraph source-family record' : 'this existing Civgraph record';
  const providers = uniqueCleanStrings([
    ...sourceItems.map((item) => item.provider),
    ...normalizeArray(target.providers)
  ]);
  const formats = uniqueCleanStrings([
    ...sourceItems.flatMap((item) => normalizeArray(item.formats)),
    ...normalizeArray(target.formats)
  ]);
  const datasetUrls = uniqueCleanStrings(sourceItems.map((item) => item.providerDatasetUrl));
  const relationships = uniqueCleanStrings(sourceItems.map((item) => item.relationship));
  const licenceTitles = uniqueCleanStrings(sourceItems.map((item) => item.licenseTitle));
  const parts = [
    `${sourceItems.length} related provider/source ${sourceItems.length === 1 ? 'row is' : 'rows are'} staged as provenance for ${targetLabel}`
  ];
  if (providers.length) parts.push(`provider: ${limitListForSentence(providers, 4)}`);
  if (formats.length) parts.push(`formats: ${limitListForSentence(formats, 6)}`);
  if (datasetUrls.length) parts.push(`${datasetUrls.length} provider dataset ${datasetUrls.length === 1 ? 'link' : 'links'} preserved as references`);
  if (licenceTitles.length) parts.push(`licence: ${limitListForSentence(licenceTitles, 3)}`);
  if (relationships.length) parts.push(`relationship: ${limitListForSentence(relationships, 2)}`);
  return `${parts.join('; ')}.`;
}

function sourceEnrichmentReferences(target) {
  const refs = [];
  if (target.targetBrowseUrl) {
    refs.push(compactObject({
      label: `Existing Civgraph record: ${cleanText(target.targetTitle || target.targetEntityId || target.sourceTargetId)}`,
      url: target.targetBrowseUrl,
      source: 'Civgraph',
      role: 'matched-existing-record'
    }));
  }
  if (target.sourceRecordBrowseUrl) {
    refs.push(compactObject({
      label: `Existing Civgraph source record: ${cleanText(target.sourceTargetId)}`,
      url: target.sourceRecordBrowseUrl,
      source: 'Civgraph',
      role: 'matched-source-record'
    }));
  }
  for (const item of normalizeArray(target.sourceItems)) {
    if (item.providerDatasetUrl) {
      refs.push(compactObject({
        label: `Provider dataset: ${cleanText(item.title || target.targetTitle || item.providerDatasetUrl)}`,
        url: item.providerDatasetUrl,
        source: cleanText(item.provider || 'Source provider'),
        role: 'canonical-provider-dataset',
        type: normalizeArray(item.formats)[0] || null,
        note: compactJoin([
          item.relationship,
          item.licenseTitle ? `licence: ${item.licenseTitle}` : ''
        ], '; ')
      }));
    }
    if (item.licenseUrl) {
      refs.push(compactObject({
        label: item.licenseTitle ? `Licence: ${item.licenseTitle}` : 'Source licence',
        url: item.licenseUrl,
        source: cleanText(item.provider || 'Source provider'),
        role: 'source-licence'
      }));
    }
    if (!isArcgisSourceItem(item)) continue;
    const title = cleanText(item.title || item.arcgisItemId || 'ArcGIS item');
    const provider = cleanText(item.provider || 'ArcGIS Online / Peatland Geoportal');
    if (item.arcgisItemPage) {
      refs.push(compactObject({
        label: `ArcGIS item: ${title}`,
        url: item.arcgisItemPage,
        source: provider,
        role: 'arcgis-item-page',
        type: normalizeArray(item.formats)[0] || null,
        note: compactJoin([
          item.arcgisItemId ? `Item ID ${item.arcgisItemId}` : '',
          item.modified ? `modified ${formatArcgisDate(item.modified)}` : '',
          item.access ? `access ${item.access}` : ''
        ], '; ')
      }));
    }
    if (item.serviceUrl) {
      refs.push(compactObject({
        label: `ArcGIS service: ${title}`,
        url: item.serviceUrl,
        source: provider,
        role: 'arcgis-service-url',
        type: 'ArcGIS service',
        note: compactJoin([
          normalizeArray(item.geometryTypes).length ? `geometry: ${normalizeArray(item.geometryTypes).join(', ')}` : '',
          normalizeArray(item.capabilities).length ? `capabilities: ${normalizeArray(item.capabilities).join(', ')}` : '',
          Number.isFinite(Number(item.serviceLayerCount)) ? `${item.serviceLayerCount} layers` : ''
        ], '; ')
      }));
    }
    for (const sibling of normalizeArray(item.siblingItems)) {
      const siblingTitle = cleanText(sibling.title || sibling.itemId || 'Related ArcGIS item');
      const siblingType = cleanText(sibling.type || 'ArcGIS item');
      if (sibling.itemPage) {
        refs.push(compactObject({
          label: `Related ArcGIS ${siblingType}: ${siblingTitle}`,
          url: sibling.itemPage,
          source: 'ArcGIS Online',
          role: 'arcgis-related-item',
          type: siblingType,
          note: sibling.itemId ? `Item ID ${sibling.itemId}` : ''
        }));
      }
      if (sibling.serviceUrl) {
        refs.push(compactObject({
          label: `Related ArcGIS service: ${siblingTitle}`,
          url: sibling.serviceUrl,
          source: 'ArcGIS Online',
          role: 'arcgis-related-service',
          type: siblingType
        }));
      }
    }
  }
  return refs;
}

function isArcgisSourceItem(item) {
  return Boolean(
    item?.arcgisItemId ||
    item?.arcgisItemPage ||
    /arcgis\.com|FeatureServer|MapServer|ImageServer|SceneServer/i.test(cleanText(item?.serviceUrl || '')) ||
    normalizeArray(item?.siblingItems).some((sibling) => sibling?.itemId || sibling?.itemPage || sibling?.serviceUrl)
  );
}

function isPeatlandEnrichmentTarget(target) {
  return /peatland-geoportal/i.test(JSON.stringify([
    target.sourceTargetId,
    target.categories,
    target.enrichmentTypes,
    target.sourceItems
  ]));
}

function uniqueCleanStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of normalizeArray(values).flatMap((item) => normalizeArray(item))) {
    const clean = cleanText(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function limitListForSentence(values, limit = 3) {
  const cleanValues = uniqueCleanStrings(values);
  if (cleanValues.length <= limit) return cleanValues.join(', ');
  return `${cleanValues.slice(0, limit).join(', ')} and ${cleanValues.length - limit} more`;
}

function formatArcgisDate(value) {
  const clean = cleanText(value);
  if (!clean) return '';
  const dateMatch = clean.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return dateMatch[1];
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && numeric > 100000000000) {
    return new Date(numeric).toISOString().slice(0, 10);
  }
  return clean;
}

function stripTrailingSentencePunctuation(value) {
  return cleanText(value).replace(/[.]+$/g, '');
}

function mergeKeywordLists(...lists) {
  const out = [];
  for (const list of lists) {
    for (const value of normalizeArray(list)) {
      const clean = cleanText(value);
      if (!clean || out.includes(clean)) continue;
      out.push(clean);
    }
  }
  return out;
}

function appendSentence(value, sentence) {
  const base = cleanText(value || '');
  const addition = cleanText(sentence || '');
  if (!addition || base.includes(addition)) return base;
  return base ? `${base} ${addition}` : addition;
}

/**
 * Print every party-label fold, and keep the list beside the data for audit
 * (data/browse/party-label-folds.json). A curated label that no longer exists, or a label that
 * looked like a misspelling of two parties, is reported and left alone.
 */
function reportPartyLabelFolds(folds) {
  const rows = [...folds].map(([source, fold]) => ({ source, ...fold }))
    .sort((a, b) => a.target.localeCompare(b.target) || a.label.localeCompare(b.label));
  console.log(`Party labels folded into their party: ${rows.length}`);
  for (const row of rows) console.log(`  ${row.label} (${row.occurrences}) -> ${row.target.replace(/^party:/, '')}: ${row.reason}`);
  if (folds.missing.length) console.log(`  Curated labels not found in party-ids.json: ${folds.missing.join('; ')}`);
  if (folds.ambiguous.length) console.log(`  Not folded, near two parties: ${folds.ambiguous.join('; ')}`);
  writeJson('party-label-folds.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    curatedList: 'scripts/browse-party-label-folds.json',
    total: rows.length,
    folds: rows,
    missing: folds.missing,
    ambiguous: folds.ambiguous
  });
}

/**
 * A constituency result is opened from its own election's file, not from elections.json (54 MB
 * with every contest in it, which a record page used to download and parse to find one entry).
 * Each election's contests are written to details/election-contests/<election slug>.json, and
 * election-contest-parents.json says which election a contest slug belongs to.
 */
function writeElectionContestShards(parents, contests) {
  const kind = 'election-contests';
  const dir = path.join(DETAILS_DIR, kind);
  mkdirSync(dir, { recursive: true });
  const parentSlugByKey = new Map(parents.map((record) => [record.key, record.slug || slugify(record.id || record.key || record.title)]));
  const byParent = new Map();
  const parentOf = {};
  for (const contest of contests) {
    const parentSlug = parentSlugByKey.get(contest.parentElectionKey);
    if (!parentSlug) continue;
    const slug = contest.slug || slugify(contest.id || contest.key || contest.title);
    if (!byParent.has(parentSlug)) byParent.set(parentSlug, []);
    byParent.get(parentSlug).push(contest);
    parentOf[slug] = parentSlug;
  }
  const desired = new Set([...byParent.keys()].map((slug) => `${slug}.json`));
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.json') && !desired.has(file)) rmSync(path.join(dir, file), { force: true });
  }
  for (const [parentSlug, items] of byParent) {
    writeJson(path.join('details', kind, `${parentSlug}.json`), { schemaVersion: 1, generatedAt: GENERATED_AT, items });
  }
  writeJson('election-contest-parents.json', { schemaVersion: 1, generatedAt: GENERATED_AT, items: parentOf }, { compact: true });
  // The same map in small pieces, by a hash of the contest slug (browse.js lookupBucket), so a
  // contest page reads about 20 KB to find its election rather than the whole 1.2 MB map. The
  // single file stays for anything that still reads it.
  const bucketDir = path.join(OUT_DIR, 'election-contest-parents');
  const buckets = Array.from({ length: CONTEST_PARENT_BUCKETS }, () => ({}));
  for (const [slug, parentSlug] of Object.entries(parentOf)) buckets[lookupBucket(slug, CONTEST_PARENT_BUCKETS)][slug] = parentSlug;
  pruneStaleShards(bucketDir, new Set(buckets.map((_, index) => `${bucketName(index)}.json`)));
  buckets.forEach((items, index) => {
    writeJson(path.join('election-contest-parents', `${bucketName(index)}.json`), { schemaVersion: 1, generatedAt: GENERATED_AT, items }, { compact: true });
  });
}

/**
 * Which of `count` files a key lives in: FNV-1a over the key's UTF-16 code units. browse.js has
 * the same function (lookupBucket) and the graph build a third copy; the three must agree, or a
 * record page looks in the wrong file and finds nothing.
 */
function lookupBucket(key, count) {
  let hash = 0x811c9dc5;
  const text = String(key);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % count;
}

function bucketName(index) {
  return String(index).padStart(4, '0');
}

/**
 * The Elections list without the weight of the records behind it.
 *
 * elections.json is 54 MB: every contest with its references, result metadata and party
 * tables, which the list never shows. The list needs a card (title, date, body, status, a
 * thumbnail and the map link), the filters (body, decade, kind) and something to search, so
 * elections-list.json carries only those. Thumbnails are written once each and referred to by
 * id, since every constituency of an election shares its election's.
 */
function writeElectionListIndex(entries) {
  const thumbnails = {};
  const parentIndex = new Map();
  entries.forEach((entry, index) => {
    if (!entry.entryKind || entry.entryKind === 'election') parentIndex.set(entry.key, index);
  });
  const items = entries.map((entry) => {
    // A pre-1973 NI council round is listed under its year's entry: `grp` is that entry's place,
    // and browse.js leaves the round out of the list (its contests still name it).
    const groupKey = (!entry.entryKind || entry.entryKind === 'election') && isNiLocalCouncilRound(entry)
      ? niLocalGroupKey(String(entry.date).slice(0, 4))
      : null;
    const grp = groupKey && parentIndex.has(groupKey) ? parentIndex.get(groupKey) : undefined;
    const slug = entry.slug || slugify(entry.id || entry.key || entry.title);
    // A contest or an overall result says which election it belongs to (`of`, that election's
    // place in this list) and inherits its date, body, kind, status, thumbnail and map link,
    // which browse.js copies back on load (expandElectionList).
    if (entry.entryKind && entry.entryKind !== 'election' && parentIndex.has(entry.parentElectionKey)) {
      return compactObject({
        slug,
        of: parentIndex.get(entry.parentElectionKey),
        result: entry.resultKind,
        title: entry.title,
        constituency: entry.constituency
      });
    }
    let thumb;
    if (entry.thumbnail?.kind === 'asset' && entry.thumbnail.url) {
      thumb = entry.thumbnail.id || entry.thumbnail.url;
      thumbnails[thumb] ||= compactObject({ kind: 'asset', id: entry.thumbnail.id, url: entry.thumbnail.url, smallUrl: entry.thumbnail.smallUrl });
    }
    return compactObject({
      slug,
      title: entry.title,
      date: entry.date,
      decade: entry.decade,
      body: entry.body,
      kind: entry.kind,
      subtitle: entry.subtitle,
      geography: entry.geography,
      status: entry.status,
      // Searched, never shown in full on a card.
      description: truncateText(entry.description, 240),
      constituencies: entry.constituencies,
      totalConstituencies: entry.totalConstituencies,
      unmatchedCount: entry.unmatchedCount,
      thumb,
      interactiveUrl: entry.interactiveUrl,
      previousSlugs: entry.previousSlugs?.length ? entry.previousSlugs : undefined,
      grp
    });
  });
  writeJson('elections-list.json', {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: items.length,
    note: 'The Elections list only. Each record is opened from details/elections/ or details/election-contests/; elections.json has every field.',
    thumbnails,
    items
  }, { compact: true });
}

function writeDetailFiles(kind, records, enhance = null, options = {}) {
  const dir = path.join(DETAILS_DIR, kind);
  mkdirSync(dir, { recursive: true });
  const desiredFiles = new Set();
  for (const record of records) {
    const slug = record.slug || slugify(record.id || record.key || record.title);
    desiredFiles.add(`${slug}.json`);
  }
  if (options.prune) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || desiredFiles.has(file)) continue;
      rmSync(path.join(dir, file), { force: true });
    }
  }
  for (const record of records) {
    const slug = record.slug || slugify(record.id || record.key || record.title);
    const extra = enhance ? compactObject(enhance(record) || {}) : {};
    writeJson(path.join('details', kind, `${slug}.json`), { schemaVersion: 1, generatedAt: GENERATED_AT, item: compactObject({ ...record, ...extra }) });
  }
}

function buildSourceDetailShardAssignments(records) {
  const assignments = new Map();
  const sortedRecords = [...records].sort((a, b) => sourceDetailSlug(a).localeCompare(sourceDetailSlug(b)));
  for (const [index, record] of sortedRecords.entries()) {
    const shardIndex = Math.floor(index / SOURCE_DETAIL_SHARD_SIZE);
    const shardName = `sources-${String(shardIndex).padStart(3, '0')}.json`;
    for (const key of sourceDetailKeys(record)) assignments.set(key, shardName);
  }
  return assignments;
}

function sourceDetailSlug(record) {
  return record.slug || slugify(record.id || record.key || record.title);
}

function sourceDetailKeys(record) {
  return [sourceDetailSlug(record), record.id, record.key]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function sourceShardNameForRecord(record, assignments = null) {
  if (assignments) {
    for (const key of sourceDetailKeys(record)) {
      const shardName = assignments.get(key);
      if (shardName) return shardName;
    }
  }
  return 'sources-misc.json';
}

/**
 * Delete only the shard files a run did not produce.
 *
 * Shard directories used to be removed wholesale before regeneration, which defeated
 * preserveGeneratedAtWhenPayloadMatches: with no file on disk to compare against, every
 * shard was rewritten with a fresh generatedAt whether or not its contents had changed.
 * A single build then produced hundreds of timestamp-only diffs, which buries real
 * changes and makes a bulk `git checkout` look like a routine tidy-up rather than the
 * destructive operation it is.
 */
function pruneStaleShards(dir, desiredFiles) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || desiredFiles.has(file)) continue;
    rmSync(path.join(dir, file), { force: true });
  }
}

function writeSourceDetailShards(records, enhance = null, assignments = null) {
  const legacyDir = path.join(DETAILS_DIR, 'sources');
  const shardDir = path.join(DETAILS_DIR, SOURCE_DETAIL_SHARD_DIR);
  const shardAssignments = assignments || buildSourceDetailShardAssignments(records);
  rmSync(legacyDir, { recursive: true, force: true });
  mkdirSync(shardDir, { recursive: true });

  const sortedRecords = [...records].sort((a, b) => sourceDetailSlug(a).localeCompare(sourceDetailSlug(b)));
  const byShard = new Map();
  for (const record of sortedRecords) {
    const shardName = sourceShardNameForRecord(record, shardAssignments);
    if (!byShard.has(shardName)) byShard.set(shardName, []);
    const extra = enhance ? compactObject(enhance(record) || {}) : {};
    byShard.get(shardName).push(compactObject({ ...record, ...extra }));
  }

  for (const [shardName, items] of [...byShard.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    writeJson(path.join('details', SOURCE_DETAIL_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'sources',
      shard: shardName,
      total: items.length,
      items
    });
  }
  pruneStaleShards(shardDir, new Set(byShard.keys()));
}

function writePersonIndexShards(records) {
  const shardDir = path.join(OUT_DIR, PERSON_INDEX_SHARD_DIR);
  mkdirSync(shardDir, { recursive: true });
  const shards = [];
  for (let index = 0; index < records.length; index += PERSON_INDEX_SHARD_SIZE) {
    const shardIndex = Math.floor(index / PERSON_INDEX_SHARD_SIZE);
    const shardName = `persons-${String(shardIndex).padStart(3, '0')}.json`;
    const items = records.slice(index, index + PERSON_INDEX_SHARD_SIZE);
    writeJson(path.join(PERSON_INDEX_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'person-index',
      shard: shardName,
      total: items.length,
      items
    });
    shards.push({
      name: shardName,
      url: `/data/browse/${PERSON_INDEX_SHARD_DIR}/${shardName}`,
      count: items.length
    });
  }
  pruneStaleShards(shardDir, new Set(shards.map((shard) => shard.name)));
  return shards;
}

function writeRegisterInterestIndexShards(records) {
  const shardDir = path.join(OUT_DIR, REGISTER_INTEREST_INDEX_SHARD_DIR);
  mkdirSync(shardDir, { recursive: true });
  const shards = [];
  for (let index = 0; index < records.length; index += REGISTER_INTEREST_INDEX_SHARD_SIZE) {
    const shardIndex = Math.floor(index / REGISTER_INTEREST_INDEX_SHARD_SIZE);
    const shardName = `register-interests-${String(shardIndex).padStart(3, '0')}.json`;
    const items = records.slice(index, index + REGISTER_INTEREST_INDEX_SHARD_SIZE);
    writeJson(path.join(REGISTER_INTEREST_INDEX_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'register-interest-index',
      shard: shardName,
      total: items.length,
      items
    });
    shards.push({
      name: shardName,
      url: `/data/browse/${REGISTER_INTEREST_INDEX_SHARD_DIR}/${shardName}`,
      count: items.length
    });
  }
  pruneStaleShards(shardDir, new Set(shards.map((shard) => shard.name)));
  return shards;
}

function writeSourceIndexShards(records) {
  const shardDir = path.join(OUT_DIR, SOURCE_INDEX_SHARD_DIR);
  // Not removed wholesale first (see pruneStaleShards): with the old files gone, every shard
  // took a fresh generatedAt, so all nine changed on every build and were re-uploaded to R2
  // on every publish whatever had changed.
  mkdirSync(shardDir, { recursive: true });
  const shards = [];
  for (let index = 0; index < records.length; index += SOURCE_INDEX_SHARD_SIZE) {
    const shardIndex = Math.floor(index / SOURCE_INDEX_SHARD_SIZE);
    const shardName = `sources-${String(shardIndex).padStart(3, '0')}.json`;
    const items = records.slice(index, index + SOURCE_INDEX_SHARD_SIZE);
    writeJson(path.join(SOURCE_INDEX_SHARD_DIR, shardName), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      kind: 'source-index',
      shard: shardName,
      total: items.length,
      items
    }, { compact: true });
    shards.push({
      name: shardName,
      url: `/data/browse/${SOURCE_INDEX_SHARD_DIR}/${shardName}`,
      count: items.length
    });
  }
  pruneStaleShards(shardDir, new Set(shards.map((shard) => shard.name)));
  return shards;
}

function compactSourceIndexRecord(record, assignments = null) {
  const slug = sourceDetailSlug(record);
  // Bulk homogeneous source tranches (census statistical cubes; local-authority /
  // open-data source-download records) carry a slim search-index entry — full metadata
  // lives in the detail shard. Keeps the aggregate sources.json index under the 25 MB
  // Pages/file limit as these corpora grow.
  if (typeof record.id === 'string'
    && (record.id.startsWith('approved-publication:census-')
      || record.id.startsWith('approved-publication:la-source-'))) {
    // Minimal search-index entry — full metadata (subtitle, approval, publicationStatus,
    // proposedBrowsePath, references, …) lives in the detail shard. sources.json is a
    // build/tooling artifact (not runtime-fetched), so this only needs the fields search
    // + validators consume; keeps the aggregate index under the 25 MB Pages/file limit.
    return compactObject({
      id: record.id,
      slug,
      type: record.type,
      title: record.title,
      category: record.category,
      date: record.date,
      provider: normalizeArray(record.provider),
      license: record.license,
      approval: compactApprovalSummary(record.approval),
      keywords: normalizeArray(record.keywords).slice(0, 4),
      previousSlugs: record.previousSlugs,
      mergedFrom: record.mergedFrom,
      browseUrl: record.browseUrl,
      detailUrl: `/data/browse/details/${SOURCE_DETAIL_SHARD_DIR}/${sourceShardNameForRecord(record, assignments)}`
    });
  }
  return compactObject({
    id: record.id,
    slug,
    type: record.type,
    title: record.title,
    subtitle: record.subtitle,
    category: record.category,
    date: record.date,
    provider: normalizeArray(record.provider),
    description: truncateText(record.description || '', 360),
    url: record.url,
    thumbnail: record.thumbnail,
    status: record.status,
    statusChips: normalizeArray(record.statusChips).slice(0, 8),
    sourceHierarchy: normalizeArray(record.sourceHierarchy).slice(0, 8),
    viewport: compactViewportSummary(record.viewport),
    shortCitation: record.shortCitation,
    publicationStatus: record.publicationStatus,
    approval: compactApprovalSummary(record.approval),
    proposedBrowsePath: record.proposedBrowsePath,
    variantOf: record.variantOf,
    parentId: record.parentId,
    parentTitle: record.parentTitle,
    relationship: record.relationship,
    sourceMapId: record.sourceMapId,
    duplicateCount: record.duplicateCount,
    license: record.license,
    referenceCount: normalizeArray(record.references).length,
    downloadCount: normalizeArray(record.downloads).length,
    relatedRecords: normalizeArray(record.relatedRecords).slice(0, 5),
    keywords: normalizeArray(record.keywords).slice(0, 16),
    // A record that stands for several listings of one work (mergeDuplicateSources): their
    // addresses still open it, and the publication validators find their ids here.
    previousSlugs: record.previousSlugs,
    mergedFrom: record.mergedFrom,
    interactiveUrl: record.interactiveUrl,
    browseUrl: record.browseUrl,
    detailUrl: `/data/browse/details/${SOURCE_DETAIL_SHARD_DIR}/${sourceShardNameForRecord(record, assignments)}`
  });
}

function compactRegisterInterestIndexRecord(record) {
  return compactObject({
    id: record.id,
    slug: record.slug,
    type: record.type,
    recordKind: record.recordKind,
    title: record.title,
    category: record.category,
    categories: normalizeArray(record.categories).slice(0, 20),
    categoryCount: record.categoryCount,
    date: record.date,
    description: truncateText(record.description || record.interestSummary || '', 140),
    memberType: record.memberType,
    memberName: record.memberName,
    personSlug: record.personSlug,
    electedBody: record.electedBody,
    chamber: record.chamber,
    constituency: record.constituency,
    constituencies: normalizeArray(record.constituencies).slice(0, 12),
    parties: normalizeArray(record.parties).slice(0, 12),
    interestCount: record.interestCount,
    nonNilInterestCount: record.nonNilInterestCount,
    hasNilInterests: record.hasNilInterests,
    sourceKind: record.sourceKind,
    sourceKinds: normalizeArray(record.sourceKinds).slice(0, 5),
    sourceCount: record.sourceCount,
    duplicateSourceRowCount: record.duplicateSourceRowCount,
    dateStart: record.dateStart,
    dateEnd: record.dateEnd,
    isNone: record.isNone,
    detailUrl: record.detailUrl
  });
}

function compactViewportSummary(viewport) {
  if (!viewport || typeof viewport !== 'object') return null;
  return compactObject({
    status: viewport.status,
    supportedViewportTypes: normalizeArray(viewport.supportedViewportTypes).slice(0, 8),
    canonicalDatasetUrl: viewport.canonicalDatasetUrl,
    internetArchiveUrl: viewport.internetArchiveUrl,
    waybackUrl: viewport.waybackUrl
  });
}

function truncateText(value, maxLength = 360) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}\u2026`;
}

function compactApprovalSummary(approval) {
  if (!approval || typeof approval !== 'object') return approval || null;
  return compactObject({
    recommendedAction: approval.recommendedAction,
    stagingId: approval.stagingId,
    confidence: approval.confidence,
    sourceType: approval.sourceType,
    provider: approval.provider
  });
}
function readThumbnailManifest() {
  const relPath = path.join('assets', 'thumbnails', 'manifest.json');
  const fullPath = path.join(ROOT, relPath);
  const excluded = readJson('assets/thumbnails/excluded-transparent.json', []);
  const excludedIds = new Set(Array.isArray(excluded) ? excluded.map(String) : []);
  if (!existsSync(fullPath)) return new Set();
  try {
    const ids = JSON.parse(readFileSync(fullPath, 'utf8'));
    return new Set(Array.isArray(ids) ? ids.map(String).filter((id) => !excludedIds.has(id.replace(/-60$/, ''))) : []);
  } catch (error) {
    console.warn(`Could not read ${relPath}: ${error.message}`);
    return new Set();
  }
}

function thumbnailForCandidates(thumbnailIds, candidates, label, fallbackType = 'entry') {
  const ids = normalizeArray(candidates).map((id) => String(id || '').trim()).filter(Boolean);
  for (const id of ids) {
    if (!thumbnailIds.has(id)) continue;
    return compactObject({
      kind: 'asset',
      id,
      // Absolute CDN URLs, not site-relative: assets/thumbnails/ is served from R2 and
      // excluded from the Pages deploy, so a /assets/... path here would 404.
      url: `${CDN_BASE}/assets/thumbnails/${id}.webp`,
      smallUrl: thumbnailIds.has(`${id}-60`) ? `${CDN_BASE}/assets/thumbnails/${id}-60.webp` : null,
      alt: cleanText(label || id)
    });
  }
  return compactObject({
    kind: 'placeholder',
    label: thumbnailInitials(label || ids[0] || fallbackType),
    type: fallbackType
  });
}

function normalizeExternalThumbnail(thumbnail, label) {
  if (!thumbnail) return null;
  if (typeof thumbnail === 'string') {
    return compactObject({
      kind: 'external',
      url: thumbnail,
      alt: cleanText(label || 'External source thumbnail')
    });
  }
  if (typeof thumbnail !== 'object') return null;
  return compactObject({
    kind: thumbnail.kind || 'external',
    url: thumbnail.url || thumbnail.href || null,
    smallUrl: thumbnail.smallUrl || thumbnail.thumbnailUrl || null,
    alt: cleanText(thumbnail.alt || label || 'External source thumbnail')
  });
}

function thumbnailInitials(value) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return initials || 'C';
}

function sourceRawMetadata(record, context) {
  if (record.type === 'book') return context.rawBooksById.get(record.id);
  if (record.type === 'table') return context.rawDataEntriesById.get(String(record.id || '').replace(/^table:/, ''));
  if (record.type === 'map-source') return context.rawMapsById.get(record.sourceMapId);
  if (record.type === 'election-source') {
    const key = String(record.id || '').replace(/^election-source:/, '');
    return compactObject({
      manifest: context.rawElectionsByKey.get(key),
      resultUrl: record.downloads?.[0]?.url,
      anchorUrl: record.downloads?.[1]?.url
    });
  }
  if (/^(wikipedia-article|internet-archive-raster-map|external-source|approved-[a-z-]+-source|raw-source-[a-z-]+|register-source-[a-z-]+)$/.test(record.type) || /^(external|approved-publication|approved-variant|raw-source|medium-priority|ni-register):/.test(String(record.id || ''))) {
    return context.rawExternalSourcesById?.get(record.id) || null;
  }
  return null;
}

function ensureUniqueSlugs(records) {
  const seen = new Map();
  for (const record of records) {
    const base = record.slug || slugify(record.id || record.key || record.title);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) {
      record.slug = base;
      continue;
    }
    const suffix = slugify(record.id || record.key || `${base}-${count + 1}`);
    record.slug = suffix && suffix !== base ? `${base}-${suffix}` : `${base}-${count + 1}`;
  }
}

function readJson(relPath, fallback) {
  const fullPath = path.join(ROOT, relPath);
  if (!existsSync(fullPath)) return fallback;
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function writeJson(relPath, value, { compact = false } = {}) {
  const fullPath = path.isAbsolute(relPath) ? relPath : path.join(OUT_DIR, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  const output = preserveGeneratedAtWhenPayloadMatches(fullPath, value);
  const nextText = compact ? `${JSON.stringify(output)}\n` : `${JSON.stringify(output, null, 2)}\n`;
  if (existsSync(fullPath) && readFileSync(fullPath, 'utf8') === nextText) return;
  writeFileSync(fullPath, nextText);
}

function preserveGeneratedAtWhenPayloadMatches(fullPath, value) {
  if (!isGeneratedJsonObject(value) || !existsSync(fullPath)) return value;
  try {
    const current = JSON.parse(readFileSync(fullPath, 'utf8'));
    if (!isGeneratedJsonObject(current)) return value;
    if (JSON.stringify(withoutTopLevelGeneratedAt(current)) === JSON.stringify(withoutTopLevelGeneratedAt(value))) {
      return { ...value, generatedAt: current.generatedAt };
    }
  } catch {
    return value;
  }
  return value;
}

function isGeneratedJsonObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'generatedAt'));
}

function withoutTopLevelGeneratedAt(value) {
  const copy = { ...value };
  delete copy.generatedAt;
  return copy;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** "electoral-divisions" -> "Electoral divisions", for a category that arrives as a slug. */
function humanizeSlug(value) {
  const text = cleanText(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(text)) return text;
  const words = text.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function normalizeFiles(value) {
  if (!value) return [];
  if (typeof value === 'string') return [{ label: fileLabel(value), url: value }];
  if (Array.isArray(value)) return value.flatMap(normalizeFiles);
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([label, url]) => {
      if (!url) return [];
      if (typeof url === 'string') return [{ label, url }];
      if (Array.isArray(url)) return url.map((item) => ({ label, url: String(item) }));
      return normalizeFiles(url).map((item) => ({ ...item, label: item.label || label }));
    });
  }
  return [];
}

function normalizeReferences(value) {
  return normalizeArray(value).flatMap((ref) => {
    if (!ref) return [];
    if (typeof ref === 'string') return [{ label: ref, url: isUrl(ref) ? ref : null }];
    return [compactObject({
      label: cleanText(ref.label || ref.title || ref.name || ref.url || ref.href),
      url: ref.url || ref.href || null,
      note: ref.note || ref.notes || null,
      accessed: ref.accessed || ref.accessedDate || null,
      source: ref.source || null,
      role: ref.role || null,
      scope: ref.scope || null,
      type: ref.type || null
    })];
  });
}

function normalizeLinks(value) {
  return normalizeArray(value).flatMap((link) => {
    if (!link) return [];
    if (typeof link === 'string') return [{ label: fileLabel(link), url: link }];
    if (Array.isArray(link)) return link.flatMap(normalizeLinks);
    if (typeof link === 'object') {
      if (link.url || link.href) return [compactObject({ label: cleanText(link.label || link.title || link.name || fileLabel(link.url || link.href)), url: link.url || link.href, type: link.type || null })];
      return normalizeFiles(link);
    }
    return [];
  }).filter((link) => link.url || link.label);
}

function collectYears(value) {
  const years = new Set();
  for (const key of ['year', 'startYear', 'endYear', 'fromYear', 'toYear', 'date']) {
    const current = value?.[key];
    if (!current) continue;
    const matches = String(current).match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || [];
    for (const match of matches) years.add(Number(match));
  }
  for (const item of normalizeArray(value?.years)) {
    const year = Number(item);
    if (Number.isFinite(year)) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function formatDateRange(value) {
  const years = collectYears(value);
  if (!years.length) return null;
  if (years.length === 1) return String(years[0]);
  return `${years[0]}-${years[years.length - 1]}`;
}

function formatYearRange(firstYear, lastYear) {
  if (!firstYear && !lastYear) return null;
  if (firstYear === lastYear) return String(firstYear);
  return `${firstYear || '?'}-${lastYear || '?'}`;
}

function geographyLabel(value) {
  return value.geography || value.region || value.area || value.country || null;
}

function electionGeographyLabel(entry) {
  const body = cleanText(entry.body || '');
  if (/dail|referendum|european parliament \(ireland\)/i.test(body)) return 'Republic of Ireland';
  if (/northern ireland|westminster|local government districts|assembly|forum/i.test(body)) return 'Northern Ireland';
  if (entry.bodySlug === 'european-parliament' || normalizeName(body) === 'european parliament') return 'Northern Ireland';
  return entry.bodyGroup || null;
}

function compactJoin(parts) {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim()).map(cleanText).join(' / ') || null;
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

function fileLabel(value) {
  const text = cleanText(value);
  if (!text) return 'Source';
  const last = text.split(/[\\/]/).pop() || text;
  return last.split('?')[0] || text;
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
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

function normalizeName(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mainElectionLayerId(entry) {
  return `election-${mainElectionSlug(entry.body || entry.displayTitle || entry.bodySlug || entry.key)}-${entry.date || ''}`.replace(/-+$/g, '');
}

function mainElectionSlug(value) {
  return slugify(cleanText(value)
    .replace(/DÃ¡il Ã‰ireann/g, 'Dail Eireann')
    .replace(/Dáil Éireann/g, 'Dail Eireann')
    .replace(/Ã‰/g, 'E')
    .replace(/Ã¡/g, 'a')
    .replace(/Ã©/g, 'e'));
}

function interactiveLayerUrl(layerId, extra = {}) {
  if (!layerId) return null;
  const params = new URLSearchParams();
  params.set('layers', layerId);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value);
  }
  // /maps/, not /: the interactive map moved there when the landing page took the root.
  // Links already published in the old form still work -- assets/pages/js/00-legacy-map-links.js
  // forwards them from the home page, which is the only place a fragment can be read.
  return `/maps/#${params.toString()}`;
}

function sortByTitle(a, b) {
  return String(a.title || '').localeCompare(String(b.title || ''));
}

function sumNumbers(rows, key) {
  return normalizeArray(rows).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function extractCandidates(result) {
  const candidates = [];
  for (const candidate of normalizeArray(result?.candidates)) {
    candidates.push({ ...candidate, constituency: result.constituency });
  }
  for (const row of normalizeArray(result?.forum?.rows)) {
    for (const candidate of normalizeArray(row?.list_candidates)) {
      candidates.push({ ...candidate, party: row.party, constituency: result.constituency });
    }
  }
  return candidates;
}

/**
 * Facets for Browse's People and Parties filters.
 *
 * Each party gets the bodies it contested and the decades it contested them in, from its
 * election party tables and from its candidates' candidacies (a ballot-paper label is in no
 * party table). The People filter options are returned: the bodies, decades and parties with
 * how many people each holds, and for each party every spelling of it in the person records,
 * which is what /_api/persons?party= matches.
 */
function addListFacets(parties, partyDetails, persons, electionDetails, partyNames) {
  const bodyOf = (key) => cleanText(electionDetails.get(key)?.body || '');
  const decadeOf = (year) => (Number(year) > 0 ? `${Math.floor(Number(year) / 10) * 10}s` : '');
  const partyFacts = new Map();
  const factsFor = (slug) => {
    if (!partyFacts.has(slug)) partyFacts.set(slug, { bodies: new Map(), decades: new Set() });
    return partyFacts.get(slug);
  };
  for (const party of Object.values(partyDetails)) {
    for (const row of party.relatedElections || []) {
      const facts = factsFor(party.slug);
      const body = bodyOf(row.key);
      if (body) facts.bodies.set(body, (facts.bodies.get(body) || 0) + 1);
      const decade = decadeOf(String(row.date || '').slice(0, 4));
      if (decade) facts.decades.add(decade);
    }
  }
  const count = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  const personBodies = new Map();
  const personDecades = new Map();
  const personElected = new Map();
  const personParties = new Map();
  for (const person of persons) {
    const bodies = new Set();
    const decades = new Set();
    const partySlugs = new Set();
    for (const row of person.elections || []) {
      const body = bodyOf(row.key);
      const decade = decadeOf(row.year);
      if (body) bodies.add(body);
      if (decade) decades.add(decade);
      const name = cleanText(row.party || '');
      const slug = name ? partyNames[normalizeName(name)] : null;
      if (!slug) continue;
      partySlugs.add(slug);
      const facts = factsFor(slug);
      if (body && !(partyDetails[slug]?.relatedElections || []).length) facts.bodies.set(body, (facts.bodies.get(body) || 0) + 1);
      if (decade) facts.decades.add(decade);
      if (!personParties.has(slug)) personParties.set(slug, { names: new Set(), people: new Set() });
      personParties.get(slug).names.add(name);
    }
    for (const body of bodies) count(personBodies, body);
    for (const decade of decades) count(personDecades, decade);
    count(personElected, Number(person.totals?.elected) > 0 ? 'yes' : 'no');
    for (const slug of partySlugs) personParties.get(slug).people.add(person.slug);
  }
  for (const party of parties) {
    const facts = partyFacts.get(party.slug);
    if (!facts) continue;
    const bodies = [...facts.bodies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([body]) => body);
    if (bodies.length) party.bodies = bodies;
    if (facts.decades.size) party.decades = [...facts.decades].sort();
  }
  const titleOf = new Map(parties.map((party) => [party.slug, party.title]));
  const counted = (map) => [...map.entries()].map(([value, n]) => ({ value, count: n }));
  return {
    body: counted(personBodies).sort((a, b) => a.value.localeCompare(b.value)),
    decade: counted(personDecades).sort((a, b) => a.value.localeCompare(b.value)),
    elected: counted(personElected).sort((a, b) => b.value.localeCompare(a.value)),
    // A party a single person stood for is left out of the menu (their record still finds it).
    party: [...personParties.entries()]
      .filter(([, entry]) => entry.people.size >= 2)
      .map(([slug, entry]) => ({ value: slug, label: titleOf.get(slug) || slug, count: entry.people.size, names: [...entry.names].sort() }))
      .sort((a, b) => a.label.localeCompare(b.label))
  };
}

/**
 * A candidate's first-preference vote as a percentage of the contest's valid poll, to two
 * places; null where either is unknown, or the vote exceeds the poll (a source error, not a
 * share to show).
 */
function candidateShare(candidate, poll) {
  const votes = Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0);
  if (!(votes > 0) || !(poll > 0) || votes > poll) return null;
  return Math.round((votes / poll) * 10000) / 100;
}

function mapToSortedArray(map) {
  return [...map.entries()]
    .filter(([name]) => name)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
