#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveApprovedPublicationSources } from './lib/approved-publication-index.mjs';
import { partyColour } from '../src/election-domain.mjs';
import { canonicalElectionTitle, electionResultEntryLabel } from './lib/election-names.mjs';
import { CDN_BASE } from '../src/cdn-url.js';

const ROOT = process.cwd();

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
const RAW_ELECTION_SOURCE_CACHE = new Map();

const ENTITY_GROUPS = [
  { id: 'maps', label: 'Maps', description: 'Catalogue map entries, metadata, downloads, source credits, and interactive-map links.' },
  { id: 'elections', label: 'Elections', description: 'Election entries by election, with links to open the corresponding election layer.' },
  { id: 'features', label: 'Features', description: 'Boundary features by source map, including election geography groups where available.' },
  { id: 'parties', label: 'Parties / Labels', description: 'Party and ticket labels observed in election data.' },
  { id: 'persons', label: 'Persons', description: 'Candidate and elected-person entries observed in election bundles.' },
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
      ...normalizeArray(niRegisterSourcesData.sources || niRegisterSourcesData.items)
    ]
  };
  const sourceEnrichmentInputs = mergeSourceEnrichmentInputs(alreadyOnSiteEnrichmentsData, peatlandGeoportalSourcesData);
  const spatialIndex = readJson('data/database/spatial-index.json', { maps: [], features: [] });
  const partyIds = readJson('election-viewer-package/data/party-ids.json', { party_ids: [], aliases: {} });
  const electionManifest = readJson('render/metadata/elections-test2.json', { elections: [], totals: {} });
  const thumbnailIds = readThumbnailManifest();

  const categoriesById = new Map((mapsData.categories || []).map((category) => [category.id, category]));
  const mapClassInfoById = buildMapClassInfo(mapsData);
  const maps = buildMaps(mapsData, dataEntriesData, categoriesById, mapClassInfoById, thumbnailIds);
  let elections = buildElections(electionManifest, thumbnailIds);
  const parentElections = elections;
  const electionDetails = readElectionDetails(parentElections);
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
  elections = [...parentElections, ...electionResultEntries];
  const featureGroups = buildFeatureGroups(spatialIndex, maps, parentElections);
  const { parties, partyDetails } = buildParties(partyIds, electionDetails);
  const { persons, personDetails } = buildPersons(electionDetails);
  const registerInterests = buildRegisterInterests(niRegisterInterestsData);
  const sources = buildSources(booksData, dataEntriesData, maps, parentElections, thumbnailIds, browseSourceInputs, sourceEnrichmentInputs);
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
  const sourceDetailShardByKey = buildSourceDetailShardAssignments(sources);
  const sourceIndexItems = sources.map((source) => compactSourceIndexRecord(source, sourceDetailShardByKey));
  const registerInterestIndexItems = registerInterests.map(compactRegisterInterestIndexRecord);
  const registerInterestIndexShards = writeRegisterInterestIndexShards(registerInterestIndexItems);

  writeJson('maps.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: maps.length, items: maps });
  writeJson('elections.json', { schemaVersion: 1, generatedAt: GENERATED_AT, total: elections.length, items: elections });
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
  writeDetailFiles('elections', parentElections, (record) => ({
    rawMetadata: compactObject({
      manifest: rawElectionsByKey.get(record.parentElectionKey || record.key),
      result: record.resultMetadata || null,
      resultUrl: record.resultUrl,
      anchorUrl: record.anchorUrl
    })
  }), { prune: true });
  writeDetailFiles('parties', Object.values(partyDetails));
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
      'register-interests': registerInterests.length,
      sources: sources.length,
      proni: 1538177
    },
    entrypoints: {
      maps: '/data/browse/maps.json',
      elections: '/data/browse/elections.json',
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
      date: map.date || map.year || map.dateAdded || null,
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
        date: variant.date || variant.year || null
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
    return compactObject({
      id,
      slug: slugify(id),
      type: 'data-entry',
      title: cleanText(entry.name || entry.title || id),
      subtitle: compactJoin([entry.year, entry.region, entry.geography]),
      categoryId: entry.category || 'data-entry',
      category: entry.categoryName || entry.category || 'Tables and data',
      group: entry.group || 'Tables and data',
      description: cleanText(entry.description || ''),
      date: entry.date || entry.year || null,
      years: collectYears(entry),
      provider: normalizeArray(entry.provider || entry.providers),
      credits: normalizeArray(entry.credits || entry.credit),
      keywords: normalizeArray(entry.keywords),
      status: 'available',
      loadable: Boolean(entry.mapId || entry.layerId || entry.sourceMapId),
      thumbnail: thumbnailForCandidates(thumbnailIds, [entry.layerId, entry.mapId, entry.sourceMapId, entry.geography, id], entry.name || entry.title || id, 'table'),
      sourceFiles: normalizeFiles([entry.files, entry.file, entry.sourceFile, entry.csv].filter(Boolean)),
      references: normalizeReferences(entry.references || entry.sources || entry.source),
      downloads: normalizeLinks([entry.downloads, entry.download, entry.sourceDownload, entry.file, entry.files, entry.csv].filter(Boolean)),
      interactiveUrl: interactiveLayerUrl(entry.layerId || entry.mapId || entry.sourceMapId || id),
      browseUrl: `/browse/maps/${encodeURIComponent(id)}`
    });
  }).filter((entry) => entry.id);

  return [...mapRecords, ...dataEntries].sort(sortByTitle);
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

function buildElections(manifest, thumbnailIds) {
  return (manifest.elections || []).map((entry) => {
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
      references: normalizeReferences(entry.references || []),
      previousKey: entry.previousKey || null,
      thumbnail: thumbnailForCandidates(thumbnailIds, [entry.sourceMapId, entry.layerId], title, 'election'),
      interactiveUrl: interactiveLayerUrl(layerId),
      browseUrl: `/browse/elections/${encodeURIComponent(entry.key)}`
    });
  }).filter((entry) => entry.key).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.title.localeCompare(b.title));
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

function isNorthernIrelandForumRegionalList(detail, resultName) {
  return normalizeName(detail?.body) === 'northern ireland forum for political dialogue'
    && normalizeName(resultName) === 'northern ireland';
}

function addElectionEnrichmentReferences(refs, election, detail) {
  const key = election?.key || detail?.key || election?.id;
  for (const d of (ELECTION_SOURCE_ENRICHMENTS.get(key) || [])) {
    addReference(refs, {
      label: `${d.title} — ${d.provider || 'data.gov.ie'} (${d.license})`,
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

function wikipediaElectionReferenceUrl(election, detail) {
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
  for (const feature of spatialIndex.features || []) {
    if (!feature?.mapId) continue;
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
    return compactObject({
      id: group.id,
      type: 'feature-group',
      title: cleanText(group.name || map.title || group.id),
      category: map.category || group.category || null,
      group: map.group || null,
      featureCount: group.featureCount || sampleByMap.get(group.id)?.length || 0,
      bounds: Array.isArray(group.bounds) ? group.bounds : null,
      sourceMapId: group.id,
      sourceFile: group.file || null,
      spatialIndexUrl: `/data/database/spatial-index/${encodeURIComponent(group.id)}.json`,
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
  for (const party of partyIds.party_ids || []) {
    const id = party.party_id || `party:${slugify(party.canonical_name)}`;
    const detail = {
      id,
      slug: id.replace(/^party:/, ''),
      type: 'party',
      title: cleanText(party.canonical_name || id),
      canonicalName: cleanText(party.canonical_name || id),
      observedNames: normalizeArray(party.observed_names),
      knownAliases: normalizeArray(party.known_aliases),
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

  for (const [key, detail] of electionDetails) {
    for (const row of normalizeArray(detail.mainLikePartySummary || detail.partySummary)) {
      const partyName = cleanText(row.party || row.name);
      if (!partyName) continue;
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

  const details = Object.fromEntries([...byId.values()].map((party) => [party.slug, {
    ...party,
    subtitle: compactJoin([formatYearRange(party.firstYear, party.lastYear), `${party.relatedElections.length} linked elections`]),
    interactiveUrl: party.relatedElections[0]?.interactiveUrl || null
  }]));
  const items = Object.values(details).map((party) => compactObject({
    id: party.id,
    slug: party.slug,
    type: 'party',
    title: party.title,
    subtitle: party.subtitle,
    occurrenceCount: party.occurrenceCount,
    fileCount: party.fileCount,
    firstYear: party.firstYear,
    lastYear: party.lastYear,
    relatedElectionCount: party.relatedElections.length,
    totals: party.totals,
    colour: party.colour,
    browseUrl: party.browseUrl
  })).sort((a, b) => (b.occurrenceCount - a.occurrenceCount) || (b.relatedElectionCount - a.relatedElectionCount) || a.title.localeCompare(b.title));

  return { parties: items, partyDetails: details };
}

function buildPersons(electionDetails) {
  const byId = new Map();
  for (const [key, election] of electionDetails) {
    const context = {
      key,
      title: cleanText(election.displayTitle || canonicalElectionTitle(election) || election.body || key),
      date: election.date,
      year: Number(election.year || election.date?.slice(0, 4)) || null,
      interactiveUrl: interactiveLayerUrl(mainElectionLayerId(election))
    };
    for (const result of normalizeArray(election.results)) {
      for (const candidate of extractCandidates(result)) {
        const name = cleanText(candidate.name || candidate.candidate || candidate.Candidate);
        if (!name) continue;
        const personId = cleanText(candidate.personId || candidate.person_id || candidate.personID || '') || `name:${slugify(name)}`;
        if (!byId.has(personId)) {
          byId.set(personId, {
            id: personId,
            slug: slugify(personId),
            type: 'person',
            title: name,
            name,
            parties: new Map(),
            constituencies: new Map(),
            genders: new Map(),
            // Names a person stood under. A person is many-to-many with names, so this
            // is a list, not a field: see data/elections/persons/name_registry.json.
            names: new Map(),
            elections: [],
            totals: { stood: 0, elected: 0, firstPrefs: 0 },
            firstYear: null,
            lastYear: null,
            browseUrl: `/browse/persons/${encodeURIComponent(slugify(personId))}`
          });
        }
        const person = byId.get(personId);
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
        person.parties.set(party || 'Unknown', (person.parties.get(party || 'Unknown') || 0) + 1);
        if (constituency) person.constituencies.set(constituency, (person.constituencies.get(constituency) || 0) + 1);
        if (gender) person.genders.set(gender, (person.genders.get(gender) || 0) + 1);
        person.totals.stood += 1;
        person.totals.elected += candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected' || candidate.status === 'Elected' ? 1 : 0;
        person.totals.firstPrefs += Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0);
        person.firstYear = person.firstYear === null ? year : Math.min(person.firstYear, year || person.firstYear);
        person.lastYear = person.lastYear === null ? year : Math.max(person.lastYear, year || person.lastYear);
        if (person.elections.length < PERSON_RELATED_LIMIT) {
          person.elections.push(compactObject({
            ...context,
            party,
            constituency,
            gender,
            dailAbbreviation: cleanText(candidate.dailAbbreviation || candidate.partyAbbreviation || candidate.Dail_Abbreviation || candidate.Party_Abbreviation || ''),
            officialCandidateId: cleanText(candidate.officialCandidateId || candidate.Official_Candidate_Id || ''),
            officialStatus: cleanText(candidate.officialStatus || candidate.Official_Status || ''),
            status: cleanText(candidate.status || candidate.outcome || ''),
            elected: Boolean(candidate.elected || candidate.counted_as_elected || candidate.outcome === 'Elected'),
            firstPrefs: Number(candidate.firstPrefs || candidate.firstPref || candidate.votes || 0) || null
          }));
        }
      }
    }
  }

  const details = Object.fromEntries([...byId.values()].map((person) => {
    const parties = mapToSortedArray(person.parties);
    const constituencies = mapToSortedArray(person.constituencies);
    const genders = mapToSortedArray(person.genders);
    const names = [...person.names.values()].sort((a, b) => b.count - a.count);
    const detail = {
      ...person,
      parties,
      constituencies,
      genders,
      names,
      nameCount: names.length,
      alsoStoodAs: names.slice(1).map((n) => n.name),
      gender: genders[0]?.name || null,
      subtitle: compactJoin([parties[0]?.name, formatYearRange(person.firstYear, person.lastYear), `${person.totals.stood} contests`]),
      interactiveUrl: person.elections[0]?.interactiveUrl || null
    };
    return [detail.slug, detail];
  }));

  const items = Object.values(details).map((person) => compactObject({
    ...person,
    relatedElectionCount: person.elections.length
  })).sort((a, b) => (b.totals.elected - a.totals.elected) || (b.totals.stood - a.totals.stood) || a.title.localeCompare(b.title));

  return { persons: items, personDetails: details };
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
      references: normalizeReferences(entry.references || entry.sources || entry.source),
      downloads: normalizeLinks([entry.downloads, entry.sourceDownload, entry.file, entry.files, entry.csv].filter(Boolean)),
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
  rmSync(shardDir, { recursive: true, force: true });
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
  return `/#${params.toString()}`;
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

function mapToSortedArray(map) {
  return [...map.entries()]
    .filter(([name]) => name)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
