import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..', '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data', 'graph');
const BROWSE_DIR = path.join(ROOT_DIR, 'data', 'browse');
const REGISTRY_DIR = path.join(ROOT_DIR, 'data', 'database');
const GENERATED_AT = new Date().toISOString();
const ENTITY_SHARD_SIZE = 5000;
const STATEMENT_SHARD_SIZE = 2500;
// Bulk catalogue-link source tranches are published to Browse/Sources (a sharded
// index that scales) but are intentionally NOT promoted to semantic-graph
// entities: they are catalogue stubs with no relationships, and folding tens of
// thousands of them into entity-search.json / entity-slugs.json would push those
// per-file indexes past the 25 MiB Cloudflare Pages limit. Matched by id prefix.
const GRAPH_EXCLUDED_SOURCE_ID_PREFIXES = ['approved-publication:cso-pxstat-', 'approved-publication:opendata-ie-', 'approved-publication:nisra-pub-'];
const isGraphExcludedSource = (item) =>
  GRAPH_EXCLUDED_SOURCE_ID_PREFIXES.some((p) => String(item.id || '').startsWith(p));
const COMPACT_REFERENCE_LIMIT = 3;
const COMPACT_DESCRIPTION_LIMIT = 600;
const gzipAsync = promisify(gzip);

const TYPE = {
  person: 'cg:entity-type:person',
  party: 'cg:entity-type:political-party',
  body: 'cg:entity-type:elected-body',
  office: 'cg:entity-type:office',
  election: 'cg:entity-type:election',
  contest: 'cg:entity-type:contest',
  candidature: 'cg:entity-type:candidature',
  mapLayer: 'cg:entity-type:map-layer',
  featureGroup: 'cg:entity-type:feature-group',
  geographicFeature: 'cg:entity-type:geographic-feature',
  sourceFile: 'cg:entity-type:source-file',
  provider: 'cg:entity-type:provider',
  source: 'cg:entity-type:source',
  registerRecord: 'cg:entity-type:register-record',
  registerInterest: 'cg:entity-type:register-interest',
  mapCategory: 'cg:entity-type:map-category',
  dateYear: 'cg:entity-type:date-year',
  dateMonth: 'cg:entity-type:date-month'
};

const PROP = {
  instanceOf: 'cg:property:instance-of',
  name: 'cg:property:name',
  electedBody: 'cg:property:elected-body',
  politicalOffice: 'cg:property:political-office',
  memberOfPoliticalParty: 'cg:property:member-of-political-party',
  stoodInElection: 'cg:property:stood-in-election',
  hasContest: 'cg:property:has-contest',
  contestInElection: 'cg:property:contest-in-election',
  hasCandidature: 'cg:property:has-candidature',
  candidate: 'cg:property:candidate',
  contest: 'cg:property:contest',
  appearedInElection: 'cg:property:appeared-in-election',
  registerRecord: 'cg:property:register-record',
  declaredInterest: 'cg:property:declared-interest',
  interestCategory: 'cg:property:interest-category',
  source: 'cg:property:source',
  sourceFile: 'cg:property:source-file',
  download: 'cg:property:download',
  provider: 'cg:property:provider',
  fileFormat: 'cg:property:file-format',
  url: 'cg:property:url',
  interactiveUrl: 'cg:property:interactive-url',
  mapCategory: 'cg:property:map-category',
  featureInLayer: 'cg:property:feature-in-layer',
  hasFeature: 'cg:property:has-feature',
  relatedElection: 'cg:property:related-election',
  featureCount: 'cg:property:feature-count',
  boundingBox: 'cg:property:bounding-box',
  spatialIndex: 'cg:property:spatial-index',
  sourceKind: 'cg:property:source-kind',
  interestText: 'cg:property:interest-text',
  nilReturn: 'cg:property:nil-return',
  candidatureStatus: 'cg:property:candidature-status',
  elected: 'cg:property:elected',
  firstPreferenceVotes: 'cg:property:first-preference-votes',
  votes: 'cg:property:votes',
  seats: 'cg:property:seats',
  stood: 'cg:property:stood',
  voteShare: 'cg:property:vote-share',
  sourceRowCount: 'cg:property:source-row-count',
  extractionConfidence: 'cg:property:extraction-confidence',
  date: 'cg:property:date',
  year: 'cg:property:year',
  constituency: 'cg:property:constituency',
  jurisdiction: 'cg:property:jurisdiction'
};

// Parent-card values that correspond to an elected body, mapped (by slug key)
// to the canonical body label so a map used as an election layer gets an
// elected-body statement. Geographic/administrative parent cards are omitted.
const PARENT_CARD_BODY = {
  'uk-parliament': 'House of Commons',
  'parliamentary-constituencies-before-1921': 'House of Commons',
  'ni-parliament': 'Parliament of Northern Ireland',
  'northern-ireland-1921': 'Parliament of Northern Ireland',
  'northern-ireland-assembly': 'Northern Ireland Assembly',
  'assembly': 'Northern Ireland Assembly',
  'european-parliament-constituencies': 'European Parliament',
  'constitutional-convention': 'Northern Ireland Constitutional Convention',
  'forum': 'Northern Ireland Forum for Political Dialogue',
  'local-government-districts': 'Local Government Districts',
  'dail-eireann': 'Dáil Éireann',
  'referendum-counting-areas': 'Referendum (Ireland)'
};

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const JSONLD_CONTEXT = {
  cg: 'https://civgraph.org/id/',
  civgraph: 'https://civgraph.org/ontology/',
  schema: 'https://schema.org/',
  prov: 'http://www.w3.org/ns/prov#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  id: '@id',
  type: '@type',
  label: 'rdfs:label',
  description: 'schema:description'
};

const entities = new Map();
const statements = new Map();
const browseRecordToEntity = {};
const personByNormalizedName = new Map();
const partyByNormalizedName = new Map();
const electionByKey = new Map();
const contestByKey = new Map();
const sourceByRecordKey = new Map();
const providerByName = new Map();
const sourceFileByUrl = new Map();
const mapLayerByKey = new Map();
const mapCategoryByName = new Map();
const dateYearByYear = new Map();
const dateMonthByKey = new Map();
let entityTypes = [];
let properties = [];

async function main() {
  const entityTypeRegistry = await readJson(path.join(REGISTRY_DIR, 'graph-entity-types.json'));
  const propertyRegistry = await readJson(path.join(REGISTRY_DIR, 'graph-properties.json'));
  entityTypes = requireArray(entityTypeRegistry.types, 'graph entity type registry');
  properties = requireArray(propertyRegistry.properties, 'graph property registry');

  await resetOutputDirectory();
  seedRegistryEntities();

  const browseElectionSource = addSyntheticSource(
    'civgraph-browse-election-index',
    'Civgraph Browse election index',
    'generated-browse-index'
  );
  const browsePersonSource = addSyntheticSource(
    'civgraph-browse-person-index',
    'Civgraph Browse person index',
    'generated-browse-index'
  );

  const [maps, features, parties, elections, persons, sources, registerRecords] = await Promise.all([
    loadBrowseItems('maps.json'),
    loadBrowseItems('features.json'),
    loadBrowseItems('parties.json'),
    loadBrowseItems('elections.json'),
    loadBrowseItems('persons.json'),
    loadSourceRecordsWithDetails(),
    loadRegisterInterestRecords()
  ]);

  buildSourceEntities(sources);
  buildMapEntities(maps);
  buildFeatureEntities(features);
  buildPartyEntities(parties);
  buildElectionEntities(elections, browseElectionSource);
  buildPersonEntities(persons, browsePersonSource);
  buildRegisterInterestEntities(registerRecords);
  addNameStatementsForEntities();

  const sortedEntities = [...entities.values()].sort(compareById);
  const sortedStatements = [...statements.values()].sort(compareStatements);
  const entityShards = await writeShards(sortedEntities, 'entity-shards', 'entities', ENTITY_SHARD_SIZE);
  const statementShards = await writeShards(sortedStatements, 'statement-shards', 'statements', STATEMENT_SHARD_SIZE);
  const mappedEntityIds = new Set(Object.values(browseRecordToEntity));
  const publicEntityIds = buildPublicEntityIdSet(sortedEntities, mappedEntityIds);
  const compactBySubject = buildCompactStatementsBySubject(sortedStatements, publicEntityIds);
  const entitySummaryById = buildEntitySummaryById(sortedEntities, publicEntityIds);

  await writeJson(path.join(OUTPUT_DIR, 'entity-types.json'), {
    schemaVersion: entityTypeRegistry.schemaVersion || 1,
    generatedAt: GENERATED_AT,
    types: entityTypes
  });
  await writeJson(path.join(OUTPUT_DIR, 'properties.json'), {
    schemaVersion: propertyRegistry.schemaVersion || 1,
    generatedAt: GENERATED_AT,
    properties
  });

  await fs.mkdir(path.join(OUTPUT_DIR, 'indexes'), { recursive: true });
  await writeEntitySlugIndex(sortedEntities, publicEntityIds);
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'browse-record-to-entity.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: Object.keys(browseRecordToEntity).length,
    items: sortObjectByKey(browseRecordToEntity)
  });
  const subjectStatementIndex = await writeSubjectStatementShards(compactBySubject);
  const entitySearch = await writeEntitySearchIndex(entitySummaryById);
  const reverseEntityValueIndex = await writeReverseEntityValueIndex(sortedStatements, entitySummaryById);
  const sourceStatementIndex = await writeSourceStatementIndex(sortedStatements, entitySummaryById);
  await writePropertySummary(sortedStatements);
  const exportIndex = await writeGraphExports(sortedEntities, sortedStatements);

  await fs.mkdir(path.join(OUTPUT_DIR, 'quality'), { recursive: true });
  const summary = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    generator: 'scripts/graph/build-semantic-graph.mjs',
    counts: {
      entityTypes: entityTypes.length,
      properties: properties.length,
      entities: sortedEntities.length,
      statements: sortedStatements.length,
      browseMappings: Object.keys(browseRecordToEntity).length,
      registerRecords: registerRecords.length
    },
    coverage: {
      personsFromBrowse: persons.length,
      partiesFromBrowse: parties.length,
      electionsFromBrowse: elections.length,
      sourcesFromBrowse: sources.length,
      mapsFromBrowse: maps.length,
      featureGroupsFromBrowse: features.length,
      registerRecordsFromBrowse: registerRecords.length
    }
  };
  await writeJson(path.join(OUTPUT_DIR, 'quality', 'validation-summary.json'), summary);

  const manifest = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    generator: 'scripts/graph/build-semantic-graph.mjs',
    registries: {
      entityTypes: '/data/graph/entity-types.json',
      properties: '/data/graph/properties.json'
    },
    entities: {
      total: sortedEntities.length,
      shards: entityShards
    },
    statements: {
      total: sortedStatements.length,
      shards: statementShards
    },
    indexes: {
      entitySlugs: '/data/graph/indexes/entity-slugs.json',
      entitySearch: entitySearch.url,
      browseRecordToEntity: '/data/graph/indexes/browse-record-to-entity.json',
      statementsBySubjectMap: '/data/graph/indexes/statements-by-subject-map.json',
      statementsBySubjectShards: subjectStatementIndex.shards,
      reverseEntityValuesMap: reverseEntityValueIndex.mapUrl,
      reverseEntityValueShards: reverseEntityValueIndex.shards,
      sourceStatementsMap: sourceStatementIndex.mapUrl,
      sourceStatementShards: sourceStatementIndex.shards,
      propertySummary: '/data/graph/indexes/property-summary.json'
    },
    quality: {
      validationSummary: '/data/graph/quality/validation-summary.json'
    },
    exports: exportIndex
  };
  await writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);

  console.log(`Built Civgraph semantic graph: ${sortedEntities.length.toLocaleString('en-GB')} entities, ${sortedStatements.length.toLocaleString('en-GB')} statements, ${Object.keys(browseRecordToEntity).length.toLocaleString('en-GB')} Browse mappings.`);
}

function seedRegistryEntities() {
  for (const type of entityTypes) {
    addEntity(type.id, {
      label: type.label,
      description: type.description,
      kind: 'entity-type',
      attributes: {
        registry: 'entity-types'
      }
    });
  }
}

function buildSourceEntities(items) {
  for (const item of items) {
    if (isGraphExcludedSource(item)) continue;
    const id = makeEntityId('source', item.id || item.slug || item.title);
    addEntity(id, {
      typeIds: [TYPE.source],
      label: item.title || item.id || 'Source',
      description: item.description || item.subtitle || '',
      browseType: 'sources',
      browseSlug: item.slug || slugify(item.id || item.title),
      browseUrl: item.browseUrl,
      sourceUrl: item.url,
      attributes: compactObject({
        sourceCategory: item.category,
        provider: joinDistinct(item.provider),
        publicationStatus: item.publicationStatus,
        date: item.date,
        referenceCount: item.referenceCount,
        downloadCount: item.downloadCount
      })
    });
    addBrowseMappings('sources', item, id);
    if (item.id) sourceByRecordKey.set(normalizeKey(item.id), id);
    if (item.slug) sourceByRecordKey.set(normalizeKey(item.slug), id);
    if (item.title) sourceByRecordKey.set(normalizeKey(item.title), id);
    if (item.category) addStatement({
      subjectId: id,
      propertyId: PROP.sourceKind,
      value: stringValue(item.category)
    });
    if (item.date) addDateStatements(id, item.date);
    if (item.url) addStatement({
      subjectId: id,
      propertyId: PROP.url,
      value: urlValue(item.url)
    });
    for (const providerLabel of normalizeArray(item.provider)) {
      const providerId = getProviderEntity(providerLabel);
      addStatement({
        subjectId: id,
        propertyId: PROP.provider,
        value: entityValue(providerId)
      });
    }
    for (const download of normalizeDownloadLinks(item.downloads)) {
      const fileId = getSourceFileEntity(download, { parentLabel: item.title, relationship: 'source-download' });
      addStatement({
        subjectId: id,
        propertyId: PROP.download,
        value: entityValue(fileId),
        qualifiers: [
          qualifier(PROP.fileFormat, stringValue(download.type || inferFormat(download.url || download.label))),
          qualifier(PROP.url, urlValue(download.url))
        ].filter(Boolean)
      });
    }
    for (const reference of normalizeArray(item.references)) {
      if (!reference?.url) continue;
      const sourceId = getGenericSourceEntity(reference, { sourceKind: 'source-reference' });
      addStatement({
        subjectId: id,
        propertyId: PROP.source,
        value: entityValue(sourceId),
        qualifiers: [
          qualifier(PROP.url, urlValue(reference.url)),
          qualifier(PROP.sourceKind, stringValue(reference.role || reference.source || 'source-reference'))
        ].filter(Boolean)
      });
    }
  }
}

function buildMapEntities(items) {
  for (const item of items) {
    const id = makeEntityId('map-layer', item.slug || item.id || item.title);
    addEntity(id, {
      typeIds: [TYPE.mapLayer],
      label: item.title || item.id || 'Map layer',
      description: item.description || item.subtitle || '',
      browseType: 'maps',
      browseSlug: item.slug || slugify(item.id || item.title),
      browseUrl: item.browseUrl,
      attributes: compactObject({
        category: item.category,
        categoryId: item.categoryId,
        group: item.group,
        date: item.date,
        years: item.years,
        provider: joinDistinct(item.provider),
        status: item.status,
        loadable: item.loadable,
        labelProperty: item.labelProperty,
        sourceMapId: item.sourceMapId,
        layerId: item.layerId,
        searchHints: searchHintList([
          item.category,
          item.categoryId,
          item.group,
          item.provider,
          item.sourceMapId,
          item.layerId
        ], 20)
      })
    });
    addBrowseMappings('maps', item, id);
    for (const key of [item.id, item.slug, item.sourceMapId, item.layerId, item.title].filter(Boolean)) {
      if (!mapLayerByKey.has(normalizeKey(key))) mapLayerByKey.set(normalizeKey(key), id);
    }
    if (item.category) addStatement({
      subjectId: id,
      propertyId: PROP.mapCategory,
      value: entityValue(getMapCategoryEntity(item.category)) || stringValue(item.category)
    });
    const electionBodyLabel = item.parentCard ? PARENT_CARD_BODY[slugify(item.parentCard)] : null;
    if (electionBodyLabel) addStatement({
      subjectId: id,
      propertyId: PROP.electedBody,
      value: entityValue(getBodyEntity(electionBodyLabel))
    });
    if (item.date) addDateStatements(id, item.date);
    if (item.interactiveUrl) addStatement({
      subjectId: id,
      propertyId: PROP.interactiveUrl,
      value: urlValue(item.interactiveUrl)
    });
    for (const providerLabel of normalizeArray(item.provider)) {
      const providerId = getProviderEntity(providerLabel);
      addStatement({
        subjectId: id,
        propertyId: PROP.provider,
        value: entityValue(providerId)
      });
    }
    for (const file of normalizeArray(item.sourceFiles)) {
      if (!file?.url) continue;
      const fileId = getSourceFileEntity(file, { parentLabel: item.title, relationship: 'map-source-file' });
      addStatement({
        subjectId: id,
        propertyId: PROP.sourceFile,
        value: entityValue(fileId),
        qualifiers: [
          qualifier(PROP.fileFormat, stringValue(file.label || inferFormat(file.url))),
          qualifier(PROP.url, urlValue(file.url))
        ].filter(Boolean)
      });
    }
    for (const download of normalizeDownloadLinks(item.downloads)) {
      const fileId = getSourceFileEntity(download, { parentLabel: item.title, relationship: 'map-download' });
      addStatement({
        subjectId: id,
        propertyId: PROP.download,
        value: entityValue(fileId),
        qualifiers: [
          qualifier(PROP.fileFormat, stringValue(download.type || inferFormat(download.url || download.label))),
          qualifier(PROP.url, urlValue(download.url))
        ].filter(Boolean)
      });
    }
    for (const reference of normalizeArray(item.references)) {
      if (!reference?.url) continue;
      const sourceId = getGenericSourceEntity(reference, { sourceKind: 'map-reference' });
      addStatement({
        subjectId: id,
        propertyId: PROP.source,
        value: entityValue(sourceId),
        qualifiers: [
          qualifier(PROP.url, urlValue(reference.url)),
          qualifier(PROP.sourceKind, stringValue(reference.role || reference.source || 'map-reference'))
        ].filter(Boolean)
      });
    }
  }
}

function buildFeatureEntities(items) {
  for (const item of items) {
    const id = makeEntityId('feature-group', item.slug || item.id || item.sourceMapId || item.title);
    const mapLayerId = getMapLayerEntityId(item.sourceMapId || item.mapId || item.id);
    addEntity(id, {
      typeIds: [TYPE.featureGroup],
      label: item.title || item.id || 'Feature group',
      description: item.description || `${formatNumberLike(item.featureCount)} features`.trim(),
      browseType: 'features',
      browseSlug: item.slug || slugify(item.id || item.title),
      browseUrl: item.browseUrl,
      attributes: compactObject({
        category: item.category,
        group: item.group,
        featureCount: item.featureCount,
        sourceMapId: item.sourceMapId,
        sourceFile: item.sourceFile,
        spatialIndexUrl: item.spatialIndexUrl,
        relatedElectionCount: item.relatedElectionCount,
        sampleFeatureCount: normalizeArray(item.sampleFeatures).length,
        searchHints: searchHintList([
          item.category,
          item.group,
          item.sourceMapId,
          normalizeArray(item.relatedElections).map((election) => [election.title, election.key, election.body]),
          normalizeArray(item.sampleFeatures).map((feature) => [feature.name, feature.label])
        ], 80)
      })
    });
    addBrowseMappings('features', item, id);
    if (mapLayerId) addStatement({
      subjectId: id,
      propertyId: PROP.featureInLayer,
      value: entityValue(mapLayerId)
    });
    if (item.featureCount !== undefined) addStatement({
      subjectId: id,
      propertyId: PROP.featureCount,
      value: numberValue(item.featureCount)
    });
    if (item.spatialIndexUrl) addStatement({
      subjectId: id,
      propertyId: PROP.spatialIndex,
      value: urlValue(item.spatialIndexUrl)
    });
    if (item.sourceFile) {
      const fileId = getSourceFileEntity({ label: inferFileName(item.sourceFile) || item.sourceFile, url: item.sourceFile }, {
        parentLabel: item.title,
        relationship: 'feature-source-file'
      });
      addStatement({
        subjectId: id,
        propertyId: PROP.sourceFile,
        value: entityValue(fileId),
        qualifiers: [
          qualifier(PROP.fileFormat, stringValue(inferFormat(item.sourceFile))),
          qualifier(PROP.url, urlValue(item.sourceFile))
        ].filter(Boolean)
      });
    }
    for (const election of item.relatedElections || []) {
      const electionId = getElectionEntity(election);
      addStatement({
        subjectId: id,
        propertyId: PROP.relatedElection,
        value: entityValue(electionId),
        qualifiers: [
          qualifier(PROP.date, dateValue(election.date))
        ].filter(Boolean)
      });
    }
    for (const feature of normalizeArray(item.sampleFeatures)) {
      const featureId = makeEntityId('geographic-feature', `${item.slug || item.id || item.sourceMapId || item.title}|${feature.name || feature.label || 'feature'}|${JSON.stringify(feature.bbox || [])}`);
      addEntity(featureId, {
        typeIds: [TYPE.geographicFeature],
        label: feature.name || feature.label || 'Unnamed feature',
        description: item.title || '',
        attributes: compactObject({
          featureGroupId: id,
          sourceMapId: item.sourceMapId,
          bbox: feature.bbox,
          createdFrom: 'feature-group-sample'
        })
      });
      addStatement({
        subjectId: id,
        propertyId: PROP.hasFeature,
        value: entityValue(featureId)
      });
      if (mapLayerId) addStatement({
        subjectId: featureId,
        propertyId: PROP.featureInLayer,
        value: entityValue(mapLayerId)
      });
      if (feature.bbox) addStatement({
        subjectId: featureId,
        propertyId: PROP.boundingBox,
        value: stringValue(normalizeArray(feature.bbox).join(','))
      });
    }
  }
}

function buildPartyEntities(items) {
  for (const item of items) {
    const id = makeEntityId('party', item.slug || item.id || item.title);
    addEntity(id, {
      typeIds: [TYPE.party],
      label: item.title || item.canonicalName || item.id || 'Party / label',
      description: item.subtitle || '',
      browseType: 'parties',
      browseSlug: item.slug || slugify(item.title || item.id),
      browseUrl: item.browseUrl,
      attributes: compactObject({
        firstYear: item.firstYear,
        lastYear: item.lastYear,
        occurrenceCount: item.occurrenceCount,
        fileCount: item.fileCount,
        relatedElectionCount: item.relatedElectionCount,
        colour: item.colour
      })
    });
    addBrowseMappings('parties', item, id);
    addPartyAliases(id, [item.title, item.canonicalName, item.id, item.slug, ...(item.observedNames || [])]);
  }
}

function buildElectionEntities(items, browseElectionSource) {
  for (const item of items) {
    const key = item.key || item.id || `${item.title || 'election'}:${item.date || ''}`;
    const id = makeEntityId('election', key);
    const bodyId = item.body ? getBodyEntity(item.body) : null;
    addEntity(id, {
      typeIds: [TYPE.election],
      label: item.title || item.resultName || item.key || 'Election',
      description: item.subtitle || item.description || '',
      browseType: 'elections',
      browseSlug: item.slug || slugify(item.id || item.key || item.title),
      browseUrl: item.browseUrl,
      attributes: compactObject({
        key: item.key,
        entryKind: item.entryKind,
        body: item.body,
        date: item.date,
        year: item.year,
        category: item.category,
        contestType: item.contestType,
        kind: item.kind,
        votingSystem: item.votingSystem,
        contestStatus: item.contestStatus,
        totalConstituencies: item.totalConstituencies,
        unmatchedCount: item.unmatchedCount,
        searchHints: searchHintList([
          item.body,
          item.category,
          item.constituencies,
          normalizeArray(item.resultEntries).map((entry) => [entry.resultName, entry.title, entry.key])
        ], 100)
      })
    });
    addBrowseMappings('elections', item, id);
    if (item.key) electionByKey.set(normalizeKey(item.key), id);
    if (item.id) electionByKey.set(normalizeKey(item.id), id);
    if (item.title && item.date) electionByKey.set(normalizeKey(`${item.title}|${item.date}`), id);
    if (bodyId) {
      addStatement({
        subjectId: id,
        propertyId: PROP.electedBody,
        value: entityValue(bodyId),
        references: [browseReference(browseElectionSource)]
      });
    }
    if (item.date) {
      addDateStatements(id, item.date, [browseReference(browseElectionSource)]);
    }
    const contestInputs = contestInputsForElection(item);
    for (const contest of contestInputs) {
      const contestId = getContestEntity({ election: item, contest });
      addStatement({
        subjectId: id,
        propertyId: PROP.hasContest,
        value: entityValue(contestId),
        qualifiers: [
          qualifier(PROP.constituency, stringValue(contest.name)),
          qualifier(PROP.date, dateValue(item.date))
        ].filter(Boolean),
        references: [browseReference(browseElectionSource)]
      });
      addStatement({
        subjectId: contestId,
        propertyId: PROP.contestInElection,
        value: entityValue(id),
        references: [browseReference(browseElectionSource)]
      });
      if (contest.name) addStatement({
        subjectId: contestId,
        propertyId: PROP.constituency,
        value: stringValue(contest.name),
        references: [browseReference(browseElectionSource)]
      });
    }
    for (const party of item.partySummary || []) {
      const partyId = getPartyEntity(party.party || party.name || party.label);
      addStatement({
        subjectId: partyId,
        propertyId: PROP.appearedInElection,
        value: entityValue(id),
        qualifiers: [
          qualifier(PROP.date, dateValue(item.date)),
          qualifier(PROP.electedBody, bodyId ? entityValue(bodyId) : null),
          qualifier(PROP.stood, numberValue(party.stood)),
          qualifier(PROP.seats, numberValue(party.seats)),
          qualifier(PROP.votes, numberValue(party.votes)),
          qualifier(PROP.voteShare, numberValue(party.share))
        ].filter(Boolean),
        references: [browseReference(browseElectionSource)]
      });
    }
  }
}

function buildPersonEntities(items, browsePersonSource) {
  for (const item of items) {
    const id = makeEntityId('person', item.slug || item.id || item.name || item.title);
    addEntity(id, {
      typeIds: [TYPE.person],
      label: item.name || item.title || item.id || 'Person',
      description: item.subtitle || '',
      browseType: 'persons',
      browseSlug: item.slug || slugify(item.name || item.title || item.id),
      browseUrl: item.browseUrl,
      attributes: compactObject({
        firstYear: item.firstYear,
        lastYear: item.lastYear,
        relatedElectionCount: item.relatedElectionCount,
        contestsStood: item.totals?.stood,
        contestsElected: item.totals?.elected,
        firstPreferenceVotes: item.totals?.firstPrefs,
        searchHints: searchHintList([
          item.parties,
          item.constituencies,
          normalizeArray(item.elections).map((election) => [election.constituency, election.party, election.title])
        ], 80)
      })
    });
    addBrowseMappings('persons', item, id);
    const nameKey = normalizePersonName(item.name || item.title || item.id);
    if (nameKey && !personByNormalizedName.has(nameKey)) personByNormalizedName.set(nameKey, id);

    for (const party of item.parties || []) {
      const partyId = getPartyEntity(party.name || party.title || party);
      addStatement({
        subjectId: id,
        propertyId: PROP.memberOfPoliticalParty,
        value: entityValue(partyId),
        qualifiers: [
          qualifier(PROP.sourceKind, stringValue('Browse person party summary'))
        ],
        references: [browseReference(browsePersonSource)]
      });
    }

    for (const election of item.elections || []) {
      const electionId = getElectionEntity(election);
      const contestId = getContestEntity({
        election,
        contest: {
          key: election.constituency,
          name: election.constituency,
          resultKind: 'constituency-result'
        }
      });
      const partyId = election.party ? getPartyEntity(election.party) : null;
      const candidatureId = makeEntityId('candidature', `${id}|${contestId}|${partyId || election.party || ''}|${election.status || ''}`);
      addEntity(candidatureId, {
        typeIds: [TYPE.candidature],
        label: `${item.name || item.title || item.id} - ${election.constituency || election.title || election.key}`,
        description: [election.title, election.party, election.status].filter(Boolean).join(' / '),
        attributes: compactObject({
          personId: id,
          electionId,
          contestId,
          partyId,
          electionKey: election.key,
          date: election.date,
          constituency: election.constituency,
          status: election.status,
          elected: election.elected,
          firstPreferenceVotes: election.firstPrefs,
          createdFrom: 'person-election-appearance'
        })
      });
      const qualifiers = [
        qualifier(PROP.date, dateValue(election.date)),
        qualifier(PROP.constituency, stringValue(election.constituency)),
        qualifier(PROP.candidatureStatus, stringValue(election.status)),
        qualifier(PROP.elected, booleanValue(election.elected)),
        qualifier(PROP.firstPreferenceVotes, numberValue(election.firstPrefs))
      ].filter(Boolean);
      if (partyId) qualifiers.push(qualifier(PROP.memberOfPoliticalParty, entityValue(partyId)));
      addStatement({
        subjectId: id,
        propertyId: PROP.stoodInElection,
        value: entityValue(electionId),
        qualifiers,
        references: [browseReference(browsePersonSource)]
      });
      addStatement({
        subjectId: id,
        propertyId: PROP.hasCandidature,
        value: entityValue(candidatureId),
        qualifiers,
        references: [browseReference(browsePersonSource)]
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.candidate,
        value: entityValue(id),
        references: [browseReference(browsePersonSource)]
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.contest,
        value: entityValue(contestId),
        references: [browseReference(browsePersonSource)]
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.stoodInElection,
        value: entityValue(electionId),
        references: [browseReference(browsePersonSource)]
      });
      if (partyId) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.memberOfPoliticalParty,
        value: entityValue(partyId),
        references: [browseReference(browsePersonSource)]
      });
      if (election.status) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.candidatureStatus,
        value: stringValue(election.status),
        references: [browseReference(browsePersonSource)]
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.elected,
        value: booleanValue(election.elected),
        references: [browseReference(browsePersonSource)]
      });
      if (election.firstPrefs !== undefined) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.firstPreferenceVotes,
        value: numberValue(election.firstPrefs),
        references: [browseReference(browsePersonSource)]
      });
      if (election.date) addDateStatements(candidatureId, election.date, [browseReference(browsePersonSource)]);
    }
  }
}

function buildRegisterInterestEntities(records) {
  for (const record of records) {
    const recordId = makeEntityId('register-record', record.id || `${record.memberName}|${record.electedBody}|${record.date}`);
    const bodyId = getBodyEntity(record.electedBody || record.chamber);
    const officeId = getOfficeEntity(record.memberType);
    const personId = getPersonEntity(record.memberName, {
      constituency: record.constituency,
      partyLabels: record.parties,
      body: record.electedBody
    });
    const sourceRefs = normalizeArray(record.sourceRefs);
    const recordReferences = summarizeRegisterReferences(sourceRefs);

    addEntity(recordId, {
      typeIds: [TYPE.registerRecord],
      label: record.title || `${record.memberName || 'Politician'} - ${record.electedBody || 'Body'} - ${record.date || 'undated'}`,
      description: record.interestSummary || record.description || '',
      browseType: 'register-interests',
      browseSlug: record.slug || slugify(record.id || record.title),
      browseUrl: record.browseUrl,
      attributes: compactObject({
        recordKind: record.recordKind,
        memberName: record.memberName,
        electedBody: record.electedBody,
        chamber: record.chamber,
        memberType: record.memberType,
        jurisdiction: record.jurisdiction,
        constituency: record.constituency,
        date: record.date,
        dateStart: record.dateStart,
        dateEnd: record.dateEnd,
        interestCount: record.interestCount,
        nonNilInterestCount: record.nonNilInterestCount,
        sourceCount: record.sourceCount,
        sourceKinds: record.sourceKinds
      })
    });
    addBrowseMappings('register-interests', record, recordId);

    addStatement({
      subjectId: personId,
      propertyId: PROP.registerRecord,
      value: entityValue(recordId),
      qualifiers: [
        qualifier(PROP.date, dateValue(record.date)),
        qualifier(PROP.electedBody, entityValue(bodyId)),
        qualifier(PROP.politicalOffice, entityValue(officeId)),
        qualifier(PROP.constituency, stringValue(record.constituency || firstArrayName(record.constituencies))),
        qualifier(PROP.sourceRowCount, numberValue(record.sourceCount))
      ].filter(Boolean),
      references: recordReferences
    });
    addStatement({
      subjectId: recordId,
      propertyId: PROP.electedBody,
      value: entityValue(bodyId),
      references: recordReferences
    });
    addStatement({
      subjectId: recordId,
      propertyId: PROP.politicalOffice,
      value: entityValue(officeId),
      references: recordReferences
    });
    if (record.date) addDateStatements(recordId, record.date, recordReferences);
    if (record.constituency || firstArrayName(record.constituencies)) addStatement({
      subjectId: recordId,
      propertyId: PROP.constituency,
      value: stringValue(record.constituency || firstArrayName(record.constituencies)),
      references: recordReferences
    });
    if (record.jurisdiction) addStatement({
      subjectId: recordId,
      propertyId: PROP.jurisdiction,
      value: stringValue(record.jurisdiction),
      references: recordReferences
    });

    for (const sourceRef of sourceRefs) {
      const ref = registerReference(sourceRef, { rowLevel: false });
      if (!ref?.sourceId) continue;
      addStatement({
        subjectId: recordId,
        propertyId: PROP.source,
        value: entityValue(ref.sourceId),
        qualifiers: [
          qualifier(PROP.sourceKind, stringValue(ref.sourceKind)),
          qualifier(PROP.date, dateValue(ref.date))
        ].filter(Boolean),
        references: [ref]
      });
    }

    for (const partyLabel of normalizeArray(record.parties)) {
      const partyId = getPartyEntity(partyLabel);
      addStatement({
        subjectId: personId,
        propertyId: PROP.memberOfPoliticalParty,
        value: entityValue(partyId),
        qualifiers: [
          qualifier(PROP.date, dateValue(record.date)),
          qualifier(PROP.electedBody, entityValue(bodyId))
        ].filter(Boolean),
        references: recordReferences
      });
    }

    addStatement({
      subjectId: personId,
      propertyId: PROP.electedBody,
      value: entityValue(bodyId),
      qualifiers: [
        qualifier(PROP.date, dateValue(record.date)),
        qualifier(PROP.politicalOffice, entityValue(officeId)),
        qualifier(PROP.constituency, stringValue(record.constituency || firstArrayName(record.constituencies)))
      ].filter(Boolean),
      references: recordReferences
    });

    for (const interest of normalizeArray(record.interests)) {
      const interestId = makeEntityId('register-interest', interest.id || `${recordId}|${interest.category}|${interest.interestText || ''}`);
      const interestReferences = normalizeArray(interest.sourceRefs).map((sourceRef) => registerReference(sourceRef, { rowLevel: true })).filter(Boolean);
      const refs = interestReferences.length ? interestReferences : recordReferences;
      addEntity(interestId, {
        typeIds: [TYPE.registerInterest],
        label: interest.category || 'Register interest',
        description: interest.interestText || interest.interestSummary || '',
        attributes: compactObject({
          parentRegisterRecordId: recordId,
          category: interest.category,
          interestText: interest.interestText,
          isNone: interest.isNone,
          sourceCount: interest.sourceCount,
          duplicateSourceRowCount: interest.duplicateSourceRowCount,
          extractionConfidence: interest.extractionConfidence
        })
      });
      addStatement({
        subjectId: recordId,
        propertyId: PROP.declaredInterest,
        value: entityValue(interestId),
        qualifiers: [
          qualifier(PROP.interestCategory, stringValue(interest.category)),
          qualifier(PROP.date, dateValue(record.date)),
          qualifier(PROP.nilReturn, booleanValue(interest.isNone)),
          qualifier(PROP.extractionConfidence, stringValue(interest.extractionConfidence)),
          qualifier(PROP.sourceRowCount, numberValue(interest.sourceCount))
        ].filter(Boolean),
        references: refs
      });
      if (interest.category) addStatement({
        subjectId: interestId,
        propertyId: PROP.interestCategory,
        value: stringValue(interest.category),
        references: refs
      });
      if (interest.interestText || interest.interestSummary) addStatement({
        subjectId: interestId,
        propertyId: PROP.interestText,
        value: stringValue(interest.interestText || interest.interestSummary),
        references: refs
      });
      addStatement({
        subjectId: interestId,
        propertyId: PROP.nilReturn,
        value: booleanValue(Boolean(interest.isNone)),
        references: refs
      });
    }
  }
}

function addNameStatementsForEntities() {
  for (const entity of entities.values()) {
    if (!entity.label) continue;
    addStatement({
      subjectId: entity.id,
      propertyId: PROP.name,
      value: stringValue(entity.label)
    });
  }
}

function addEntity(id, input = {}) {
  if (!id) throw new Error('Entity id is required.');
  const existing = entities.get(id);
  const typeIds = normalizeArray(input.typeIds).filter(Boolean);
  if (existing) {
    existing.typeIds = unique([...(existing.typeIds || []), ...typeIds]);
    for (const key of ['label', 'description', 'browseType', 'browseSlug', 'browseUrl', 'sourceUrl', 'kind']) {
      if (!existing[key] && input[key]) existing[key] = input[key];
    }
    existing.attributes = compactObject({ ...(existing.attributes || {}), ...(input.attributes || {}) });
  } else {
    const entity = compactObject({
      id,
      label: input.label || id,
      description: input.description || '',
      kind: input.kind || 'entity',
      browseType: input.browseType,
      browseSlug: input.browseSlug,
      browseUrl: input.browseUrl,
      sourceUrl: input.sourceUrl,
      attributes: compactObject(input.attributes || {})
    });
    entity.typeIds = unique(typeIds);
    entities.set(id, entity);
  }
  const entity = entities.get(id);
  for (const typeId of typeIds) {
    addStatement({
      subjectId: id,
      propertyId: PROP.instanceOf,
      value: entityValue(typeId)
    });
  }
  return entity;
}

function addStatement(input) {
  if (!input.subjectId || !input.propertyId || !input.value) return null;
  const qualifiers = normalizeArray(input.qualifiers).filter((item) => item?.propertyId && item?.value);
  const references = normalizeArray(input.references).filter(Boolean);
  const key = statementSemanticKey(input.subjectId, input.propertyId, input.value, qualifiers);
  const id = `cg:statement:${shortHash(key, 20)}`;
  const existing = statements.get(id);
  if (existing) {
    existing.references = mergeReferences(existing.references, references);
    return existing;
  }
  const statement = compactObject({
    id,
    subjectId: input.subjectId,
    propertyId: input.propertyId,
    value: input.value,
    qualifiers,
    references,
    rank: input.rank || 'normal'
  });
  statements.set(id, statement);
  return statement;
}

function getPersonEntity(name, context = {}) {
  const label = cleanText(name) || 'Unnamed person';
  const normalized = normalizePersonName(label);
  const existingId = normalized ? personByNormalizedName.get(normalized) : null;
  if (existingId) return existingId;
  const id = makeEntityId('person', label);
  addEntity(id, {
    typeIds: [TYPE.person],
    label,
    description: context.body ? `${context.body}${context.constituency ? ` / ${context.constituency}` : ''}` : '',
    attributes: compactObject({
      constituency: context.constituency,
      partyLabels: normalizeArray(context.partyLabels),
      createdFrom: 'register-interest-record'
    })
  });
  if (normalized) personByNormalizedName.set(normalized, id);
  return id;
}

function getPartyEntity(label) {
  const partyLabel = cleanText(label) || 'Unknown party / label';
  const normalized = normalizePartyName(partyLabel);
  const existingId = normalized ? partyByNormalizedName.get(normalized) : null;
  if (existingId) return existingId;
  const id = makeEntityId('party', partyLabel);
  addEntity(id, {
    typeIds: [TYPE.party],
    label: partyLabel,
    attributes: {
      createdFrom: 'observed-party-label'
    }
  });
  addPartyAliases(id, [partyLabel]);
  return id;
}

function getBodyEntity(label) {
  const body = canonicalBody(label);
  const id = makeEntityId('body', body.slug);
  addEntity(id, {
    typeIds: [TYPE.body],
    label: body.label,
    description: body.description,
    attributes: compactObject({
      jurisdiction: body.jurisdiction
    })
  });
  if (body.jurisdiction) addStatement({
    subjectId: id,
    propertyId: PROP.jurisdiction,
    value: stringValue(body.jurisdiction)
  });
  return id;
}

function getOfficeEntity(label) {
  const raw = cleanText(label);
  const office = canonicalOffice(raw);
  const id = makeEntityId('office', office.slug);
  addEntity(id, {
    typeIds: [TYPE.office],
    label: office.label,
    description: office.description,
    attributes: compactObject({
      shortLabel: office.shortLabel
    })
  });
  return id;
}

function getElectionEntity(election) {
  const candidates = [
    election?.key,
    election?.id,
    election?.title && election?.date ? `${election.title}|${election.date}` : null
  ].filter(Boolean).map(normalizeKey);
  for (const key of candidates) {
    const existingId = electionByKey.get(key);
    if (existingId) return existingId;
  }
  const id = makeEntityId('election', election?.key || `${election?.title || 'election'}:${election?.date || ''}`);
  addEntity(id, {
    typeIds: [TYPE.election],
    label: election?.title || election?.key || 'Election',
    description: election?.date || '',
    browseType: 'elections',
    browseSlug: slugify(election?.key || election?.title || id),
    attributes: compactObject({
      key: election?.key,
      date: election?.date,
      createdFrom: 'person-election-appearance'
    })
  });
  if (election?.key) electionByKey.set(normalizeKey(election.key), id);
  return id;
}

function getContestEntity({ election, contest }) {
  const electionKey = election?.key || election?.id || election?.title || 'election';
  const contestName = cleanText(contest?.resultName || contest?.name || contest?.title || contest?.key || 'contest');
  const contestKey = normalizeKey(`${electionKey}::${contest?.key || contestName}`);
  const existingId = contestByKey.get(contestKey);
  if (existingId) return existingId;
  const id = makeEntityId('contest', `${electionKey}::${contest?.key || contestName}`);
  addEntity(id, {
    typeIds: [TYPE.contest],
    label: contestName || 'Election contest',
    description: election?.title ? `${contestName} - ${election.title}` : '',
    browseType: contest?.browseUrl ? 'elections' : undefined,
    browseSlug: contest?.browseUrl ? (String(contest.browseUrl).split('/').pop() || undefined) : undefined,
    browseUrl: contest?.browseUrl,
    attributes: compactObject({
      electionKey,
      electionTitle: election?.title,
      date: election?.date,
      resultKind: contest?.resultKind,
      constituency: contestName,
      createdFrom: contest?.createdFrom || 'election-result-entry'
    })
  });
  contestByKey.set(contestKey, id);
  if (election?.key) contestByKey.set(normalizeKey(`${election.key}::${contestName}`), id);
  if (election?.title && election?.date) contestByKey.set(normalizeKey(`${election.title}|${election.date}::${contestName}`), id);
  return id;
}

function contestInputsForElection(item) {
  const rows = [];
  for (const entry of item.resultEntries || []) {
    rows.push({
      key: entry.key,
      name: entry.resultName || entry.title || entry.key,
      title: entry.title,
      resultKind: entry.resultKind,
      browseUrl: entry.browseUrl
    });
  }
  if (!rows.length) {
    for (const name of normalizeArray(item.constituencies)) {
      rows.push({
        key: name,
        name,
        resultKind: 'constituency-result',
        createdFrom: 'election-constituency-list'
      });
    }
  }
  const byName = new Map();
  for (const row of rows) {
    const key = normalizeKey(row.key || row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  }
  return [...byName.values()];
}

function addSyntheticSource(key, title, sourceKind) {
  const id = makeEntityId('source', key);
  addEntity(id, {
    typeIds: [TYPE.source],
    label: title,
    attributes: {
      sourceKind,
      generated: true
    }
  });
  addStatement({
    subjectId: id,
    propertyId: PROP.sourceKind,
    value: stringValue(sourceKind)
  });
  sourceByRecordKey.set(normalizeKey(key), id);
  return id;
}

function registerReference(sourceRef, options = {}) {
  if (!sourceRef) return null;
  const rowLevel = options.rowLevel !== false;
  const sourceId = getSourceEntityFromReference(sourceRef);
  return compactObject({
    sourceId,
    sourceTitle: sourceRef.sourceTitle,
    sourceKind: sourceRef.sourceKind,
    sourceRecordId: sourceRef.sourceRecordId,
    sourceRowId: rowLevel ? sourceRef.sourceRowId : undefined,
    sourceUrl: sourceRef.sourceUrl,
    date: sourceRef.date || sourceRef.editionDate,
    earliestDeclaration: sourceRef.earliestDeclaration,
    latestDeclaration: sourceRef.latestDeclaration,
    extractionMethod: sourceRef.extractionMethod,
    extractionConfidence: sourceRef.extractionConfidence,
    sourceExtractIds: rowLevel ? sourceRef.sourceExtractIds : undefined
  });
}

function getSourceEntityFromReference(ref) {
  const sourceKey = ref.sourceTitle || ref.sourceKind || ref.sourceUrl || ref.sourceRecordId || 'unknown-register-source';
  const keys = [
    ref.sourceTitle,
    ref.sourceKind,
    ref.sourceUrl,
    sourceKey
  ].filter(Boolean).map(normalizeKey);
  for (const key of keys) {
    const existingId = sourceByRecordKey.get(key);
    if (existingId) return existingId;
  }
  const id = makeEntityId('source', sourceKey);
  addEntity(id, {
    typeIds: [TYPE.source],
    label: ref.sourceTitle || ref.sourceKind || ref.sourceRecordId || 'Register source',
    sourceUrl: ref.sourceUrl,
    attributes: compactObject({
      sourceKind: ref.sourceKind,
      sourceRecordId: ref.sourceRecordId,
      createdFrom: 'register-interest-reference'
    })
  });
  if (ref.sourceKind) addStatement({
    subjectId: id,
    propertyId: PROP.sourceKind,
    value: stringValue(ref.sourceKind)
  });
  for (const key of keys) sourceByRecordKey.set(key, id);
  return id;
}

function getGenericSourceEntity(reference, options = {}) {
  const label = cleanText(reference.label || reference.title || reference.source || reference.url || 'External source');
  const sourceKey = reference.url || label;
  const existingId = sourceByRecordKey.get(normalizeKey(sourceKey));
  if (existingId) return existingId;
  const id = makeEntityId('source', `${label}-${shortHash(sourceKey, 12)}`);
  addEntity(id, {
    typeIds: [TYPE.source],
    label,
    sourceUrl: reference.url,
    attributes: compactObject({
      sourceKind: options.sourceKind || reference.role || reference.source,
      role: reference.role,
      createdFrom: 'external-reference'
    })
  });
  if (reference.url) addStatement({
    subjectId: id,
    propertyId: PROP.url,
    value: urlValue(reference.url)
  });
  if (options.sourceKind || reference.role || reference.source) addStatement({
    subjectId: id,
    propertyId: PROP.sourceKind,
    value: stringValue(options.sourceKind || reference.role || reference.source)
  });
  sourceByRecordKey.set(normalizeKey(sourceKey), id);
  sourceByRecordKey.set(normalizeKey(label), id);
  return id;
}

function getProviderEntity(value) {
  const label = cleanText(value);
  if (!label) return makeEntityId('provider', 'unknown-provider');
  const normalized = normalizeKey(label);
  const existingId = providerByName.get(normalized);
  if (existingId) return existingId;
  const id = makeEntityId('provider', label);
  addEntity(id, {
    typeIds: [TYPE.provider],
    label,
    attributes: {
      createdFrom: 'provider-label'
    }
  });
  providerByName.set(normalized, id);
  return id;
}

function getMapCategoryEntity(value) {
  const label = cleanText(value);
  if (!label) return null;
  const normalized = normalizeKey(label);
  const existingId = mapCategoryByName.get(normalized);
  if (existingId) return existingId;
  const id = makeEntityId('map-category', label);
  addEntity(id, {
    typeIds: [TYPE.mapCategory],
    label,
    description: `Map category: ${label}`,
    attributes: { createdFrom: 'map-category-label' }
  });
  mapCategoryByName.set(normalized, id);
  return id;
}

function extractYear(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

// Pull {year, month} from a date. Handles ISO (YYYY-MM-DD / YYYY-MM, including
// ISO-prefixed referendum ids like 2015-05-22-equal-marriage) and bare years.
function parseDateParts(value) {
  const text = cleanText(value);
  if (!text) return {};
  const iso = text.match(/(\d{4})-(\d{2})(?:-\d{2})?/);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return { year: iso[1], month: iso[2] };
  const year = extractYear(text);
  return year ? { year } : {};
}

function getDateYearEntity(year) {
  if (!year) return null;
  const existingId = dateYearByYear.get(year);
  if (existingId) return existingId;
  const id = makeEntityId('date-year', year);
  addEntity(id, {
    typeIds: [TYPE.dateYear],
    label: year,
    description: `Entities dated ${year}`,
    attributes: { createdFrom: 'date-year', year }
  });
  dateYearByYear.set(year, id);
  return id;
}

function getDateMonthEntity(year, month) {
  if (!year || !month) return null;
  const key = `${year}-${month}`;
  const existingId = dateMonthByKey.get(key);
  if (existingId) return existingId;
  const id = makeEntityId('date-month', key);
  const label = `${MONTH_NAMES[Number(month)] || month} ${year}`;
  addEntity(id, {
    typeIds: [TYPE.dateMonth],
    label,
    description: `Entities dated ${label}`,
    attributes: { createdFrom: 'date-month', year, month }
  });
  dateMonthByKey.set(key, id);
  return id;
}

// Emit date statements that display the original date but link to a bucket
// entity at the date's precision: a month bucket when the date has a month
// (clicking lists everything in that month), otherwise the year bucket. When a
// month is present, also add a `year` statement so the year bucket still
// gathers every entity dated within that year.
function addDateStatements(subjectId, dateText, references) {
  const { year, month } = parseDateParts(dateText);
  if (!year) {
    addStatement({ subjectId, propertyId: PROP.date, value: dateValue(dateText), references });
    return;
  }
  const label = cleanText(dateText) || year;
  if (month) {
    addStatement({ subjectId, propertyId: PROP.date, value: { type: 'entity', id: getDateMonthEntity(year, month), label }, references });
    addStatement({ subjectId, propertyId: PROP.year, value: entityValue(getDateYearEntity(year)), references });
  } else {
    addStatement({ subjectId, propertyId: PROP.date, value: { type: 'entity', id: getDateYearEntity(year), label }, references });
  }
}

function getMapLayerEntityId(value) {
  const key = normalizeKey(value);
  if (!key) return null;
  const existingId = mapLayerByKey.get(key);
  if (existingId) return existingId;
  const id = makeEntityId('map-layer', value);
  addEntity(id, {
    typeIds: [TYPE.mapLayer],
    label: cleanText(value) || 'Map layer',
    attributes: {
      createdFrom: 'feature-source-map-reference'
    }
  });
  mapLayerByKey.set(key, id);
  return id;
}

function getSourceFileEntity(file, context = {}) {
  const url = cleanText(file.url || file.href || file.path || '');
  const label = cleanText(file.label || file.name || file.title || inferFileName(url) || context.parentLabel || 'Source file');
  const key = url || `${context.parentLabel || ''}|${label}|${file.type || ''}`;
  const normalized = normalizeKey(key);
  const existingId = sourceFileByUrl.get(normalized);
  if (existingId) return existingId;
  const id = makeEntityId('source-file', `${label}-${shortHash(key, 12)}`);
  const format = file.type || file.format || inferFormat(url || label);
  addEntity(id, {
    typeIds: [TYPE.sourceFile],
    label,
    description: context.parentLabel ? `${label} for ${context.parentLabel}` : '',
    sourceUrl: url,
    attributes: compactObject({
      url,
      format,
      relationship: context.relationship,
      parentLabel: context.parentLabel
    })
  });
  if (url) addStatement({
    subjectId: id,
    propertyId: PROP.url,
    value: urlValue(url)
  });
  if (format) addStatement({
    subjectId: id,
    propertyId: PROP.fileFormat,
    value: stringValue(format)
  });
  sourceFileByUrl.set(normalized, id);
  if (url) sourceFileByUrl.set(normalizeKey(url), id);
  return id;
}

function normalizeDownloadLinks(downloads) {
  const rows = normalizeArray(downloads);
  const links = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const next = rows[index + 1] || {};
    if (String(row.label || '').toLowerCase() === 'label' && String(next.label || '').toLowerCase() === 'file' && isLikelyUrl(next.url)) {
      links.push({
        label: cleanText(row.url || next.label || inferFileName(next.url) || next.url),
        url: next.url,
        type: inferFormat(row.url || next.url)
      });
      index += 1;
      continue;
    }
    if (isLikelyUrl(row.url)) {
      links.push({
        label: cleanText(row.label || row.name || inferFileName(row.url) || row.url),
        url: row.url,
        type: row.type || row.format || inferFormat(row.url)
      });
    }
  }
  const byUrl = new Map();
  for (const link of links) {
    const key = normalizeKey(link.url || link.label);
    if (key && !byUrl.has(key)) byUrl.set(key, link);
  }
  return [...byUrl.values()];
}

function urlValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'url', value: text };
}

function isLikelyUrl(value) {
  return /^https?:\/\//i.test(cleanText(value)) || /^\//.test(cleanText(value));
}

function inferFileName(value) {
  const text = cleanText(value).split('?')[0];
  return text.split(/[\\/]/).filter(Boolean).pop() || '';
}

function inferFormat(value) {
  const text = cleanText(value).split('?')[0].toLowerCase();
  const extension = text.match(/\.([a-z0-9]{2,8})$/)?.[1];
  if (extension) return extension.toUpperCase();
  const known = ['GeoJSON', 'KML', 'ZIP', 'CSV', 'PDF', 'PNG', 'JPG', 'JPEG', 'WEBP', 'FGB', 'PMTILES', 'MBTILES'];
  const match = known.find((format) => text.includes(format.toLowerCase()));
  return match || '';
}

function summarizeRegisterReferences(sourceRefs) {
  const byKey = new Map();
  for (const sourceRef of normalizeArray(sourceRefs)) {
    const ref = registerReference(sourceRef, { rowLevel: false });
    if (!ref) continue;
    const key = JSON.stringify([
      ref.sourceId,
      ref.sourceTitle,
      ref.sourceKind,
      ref.date,
      ref.extractionMethod,
      ref.extractionConfidence
    ]);
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))).slice(0, 25);
}

function browseReference(sourceId) {
  const entity = entities.get(sourceId);
  return compactObject({
    sourceId,
    sourceTitle: entity?.label,
    sourceKind: entity?.attributes?.sourceKind
  });
}

function addPartyAliases(id, aliases) {
  for (const alias of normalizeArray(aliases)) {
    const normalized = normalizePartyName(alias);
    if (normalized && !partyByNormalizedName.has(normalized)) partyByNormalizedName.set(normalized, id);
  }
}

function addBrowseMappings(type, item, entityId) {
  const keys = type === 'register-interests'
    ? [item.slug, item.id].filter(Boolean)
    : [
        item.slug,
        item.id,
        item.key,
        item.title,
        item.name
      ].filter(Boolean);
  for (const key of keys) {
    browseRecordToEntity[`${type}:${key}`] = entityId;
    browseRecordToEntity[`${type}:${slugify(key)}`] = entityId;
  }
}

async function loadBrowseItems(fileName) {
  const data = await readJson(path.join(BROWSE_DIR, fileName));
  if (data.indexLayout === 'sharded' && Array.isArray(data.shards)) {
    const items = [];
    for (const shard of requireArray(data.shards, `${fileName} shards`)) {
      const shardData = await readJson(siteUrlToPath(shard.url));
      items.push(...requireArray(shardData.items, shard.name || shard.url));
    }
    return items;
  }
  return Array.isArray(data) ? data : requireArray(data.items || [], fileName);
}

async function loadSourceIndexItems() {
  const index = await readJson(path.join(BROWSE_DIR, 'sources.json'));
  if (index.indexLayout === 'sharded' && Array.isArray(index.shards)) {
    const items = [];
    for (const shard of requireArray(index.shards, 'sources index shards')) {
      const shardData = await readJson(siteUrlToPath(shard.url));
      items.push(...requireArray(shardData.items, shard.name || shard.url));
    }
    return items;
  }
  return requireArray(index.items || [], 'sources index items');
}

async function loadSourceRecordsWithDetails() {
  const items = await loadSourceIndexItems();
  const detailCache = new Map();
  const enriched = [];
  for (const item of items) {
    if (!item.detailUrl) {
      enriched.push(item);
      continue;
    }
    let shard = detailCache.get(item.detailUrl);
    if (!shard) {
      shard = await readJson(siteUrlToPath(item.detailUrl));
      detailCache.set(item.detailUrl, shard);
    }
    const detailItems = Array.isArray(shard.items) ? shard.items : [];
    const match = detailItems.find((candidate) => (
      sameText(candidate.slug, item.slug) ||
      sameText(candidate.id, item.id)
    ));
    enriched.push(match ? { ...item, ...match, slug: item.slug || match.slug, browseUrl: item.browseUrl || match.browseUrl } : item);
  }
  return enriched;
}

async function loadRegisterInterestRecords() {
  const index = await readJson(path.join(BROWSE_DIR, 'register-interests.json'));
  const items = [];
  if (index.indexLayout === 'sharded') {
    for (const shard of requireArray(index.shards, 'register interest index shards')) {
      const shardData = await readJson(siteUrlToPath(shard.url));
      items.push(...requireArray(shardData.items, shard.name || shard.url));
    }
  } else {
    items.push(...requireArray(index.items || [], 'register interest items'));
  }

  const detailCache = new Map();
  const records = [];
  for (const item of items) {
    if (!item.detailUrl) {
      records.push(item);
      continue;
    }
    let detailShard = detailCache.get(item.detailUrl);
    if (!detailShard) {
      detailShard = await readJson(siteUrlToPath(item.detailUrl));
      detailCache.set(item.detailUrl, detailShard);
    }
    const detailItems = Array.isArray(detailShard.items)
      ? detailShard.items
      : Array.isArray(detailShard.interests)
        ? detailShard.interests
        : [];
    const match = detailItems.find((candidate) => (
      sameText(candidate.slug, item.slug) ||
      sameText(candidate.id, item.id)
    ));
    if (!match) throw new Error(`Register interest detail ${item.slug || item.id} not found in ${item.detailUrl}`);
    records.push({ ...item, ...match, slug: item.slug || match.slug, browseUrl: item.browseUrl || match.browseUrl });
  }
  return records;
}

function buildEntitySlugIndex(items, allowedEntityIds) {
  const byId = {};
  const bySlug = {};
  const typeLabelsById = new Map(entityTypes.map((type) => [type.id, type.label]));
  for (const entity of items) {
    if (allowedEntityIds && !allowedEntityIds.has(entity.id)) continue;
    const slug = slugify(entity.browseSlug || entity.label || entity.id);
    byId[entity.id] = compactObject({
      slug,
      label: entity.label,
      typeIds: entity.typeIds,
      typeLabels: normalizeArray(entity.typeIds).map((typeId) => typeLabelsById.get(typeId) || typeId),
      browseType: entity.browseType,
      browseSlug: entity.browseSlug,
      browseUrl: entity.browseUrl
    });
    if (!bySlug[slug]) bySlug[slug] = entity.id;
  }
  return {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: Object.keys(byId).length,
    byId,
    bySlug
  };
}

async function writeEntitySlugIndex(items, allowedEntityIds) {
  const entries = [];
  const typeLabelsById = new Map(entityTypes.map((type) => [type.id, type.label]));
  for (const entity of items) {
    if (allowedEntityIds && !allowedEntityIds.has(entity.id)) continue;
    const slug = slugify(entity.browseSlug || entity.label || entity.id);
    entries.push([entity.id, compactObject({
      slug,
      label: entity.label,
      typeIds: entity.typeIds,
      typeLabels: normalizeArray(entity.typeIds).map((typeId) => typeLabelsById.get(typeId) || typeId),
      browseType: entity.browseType,
      browseSlug: entity.browseSlug,
      browseUrl: entity.browseUrl
    })]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const bySlug = {};
  const byIdShard = {};
  const shards = [];
  const shardDir = path.join(OUTPUT_DIR, 'indexes', 'entity-summary-shards');
  await fs.mkdir(shardDir, { recursive: true });
  const entitiesPerShard = 1000;
  for (let start = 0, shardIndex = 0; start < entries.length; start += entitiesPerShard, shardIndex += 1) {
    const chunk = entries.slice(start, start + entitiesPerShard);
    const name = `entity-summaries-${String(shardIndex).padStart(3, '0')}.json`;
    const url = `/data/graph/indexes/entity-summary-shards/${name}`;
    const itemsById = Object.fromEntries(chunk);
    await writeJson(path.join(shardDir, name), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      shard: shardIndex,
      total: chunk.length,
      items: itemsById
    });
    const stat = await fs.stat(path.join(shardDir, name));
    shards.push({ name, url, count: chunk.length, bytes: stat.size });
    for (const [entityId, summary] of chunk) {
      byIdShard[entityId] = url;
      if (!bySlug[summary.slug]) bySlug[summary.slug] = entityId;
    }
  }
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'entity-slugs.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: entries.length,
    bySlug,
    byIdShard,
    shards
  });
}

function buildEntitySummaryById(items, allowedEntityIds) {
  const typeLabelsById = new Map(entityTypes.map((type) => [type.id, type.label]));
  const summaries = {};
  for (const entity of items) {
    if (allowedEntityIds && !allowedEntityIds.has(entity.id)) continue;
    const slug = slugify(entity.browseSlug || entity.label || entity.id);
    summaries[entity.id] = compactObject({
      entityId: entity.id,
      slug,
      label: entity.label,
      description: truncateText(entity.description || '', 220),
      typeIds: entity.typeIds,
      typeLabels: normalizeArray(entity.typeIds).map((typeId) => typeLabelsById.get(typeId) || typeId),
      browseType: entity.browseType,
      browseSlug: entity.browseSlug,
      browseUrl: entity.browseUrl,
      searchHints: searchHintList(entity.attributes?.searchHints, 20)
    });
  }
  return summaries;
}

async function writeEntitySearchIndex(entitySummaryById) {
  const items = Object.values(entitySummaryById)
    .map((summary) => compactObject({
      entityId: summary.entityId,
      // Omit slug when it is identical to browseSlug (the common case): consumers
      // fall back to browseSlug, and dropping the redundant field keeps this index
      // under the 25 MiB Cloudflare Pages per-file cap as the corpus grows.
      slug: summary.slug === summary.browseSlug ? undefined : summary.slug,
      label: summary.label,
      types: summary.typeLabels,
      browseType: summary.browseType,
      browseSlug: summary.browseSlug,
      searchHints: summary.searchHints
    }))
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')) || a.entityId.localeCompare(b.entityId));
  const url = '/data/graph/indexes/entity-search.json';
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'entity-search.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: items.length,
    items
  }, { pretty: false });
  return { url, count: items.length };
}

async function writeReverseEntityValueIndex(statements, entitySummaryById) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  const byValue = {};
  for (const statement of statements) {
    if (statement.value?.type !== 'entity') continue;
    const valueSummary = entitySummaryById[statement.value.id];
    const subjectSummary = entitySummaryById[statement.subjectId];
    if (!valueSummary || !subjectSummary) continue;
    if (!byValue[statement.value.id]) byValue[statement.value.id] = [];
    byValue[statement.value.id].push(compactObject({
      statementId: statement.id,
      subjectId: statement.subjectId,
      subjectSlug: subjectSummary.slug,
      subjectLabel: subjectSummary.label,
      subjectTypeLabels: subjectSummary.typeLabels,
      propertyId: statement.propertyId,
      propertyLabel: propertyLabels.get(statement.propertyId) || statement.propertyId
    }));
  }
  return writeRelatedIndex('reverse-entity-value', byValue);
}

async function writeSourceStatementIndex(statements, entitySummaryById) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  const bySource = {};
  for (const statement of statements) {
    const subjectSummary = entitySummaryById[statement.subjectId];
    if (!subjectSummary) continue;
    for (const reference of normalizeArray(statement.references)) {
      if (!reference.sourceId || !entitySummaryById[reference.sourceId]) continue;
      if (!bySource[reference.sourceId]) bySource[reference.sourceId] = [];
      bySource[reference.sourceId].push(compactObject({
        statementId: statement.id,
        subjectId: statement.subjectId,
        subjectSlug: subjectSummary.slug,
        subjectLabel: subjectSummary.label,
        subjectTypeLabels: subjectSummary.typeLabels,
        propertyId: statement.propertyId,
        propertyLabel: propertyLabels.get(statement.propertyId) || statement.propertyId,
        sourceKind: reference.sourceKind,
        sourceRowId: reference.sourceRowId,
        date: reference.date
      }));
    }
  }
  return writeRelatedIndex('source-statements', bySource);
}

async function writeRelatedIndex(prefix, relationMap) {
  const entries = Object.entries(relationMap)
    .map(([entityId, relations]) => [entityId, dedupeRelations(relations).slice(0, 1000)])
    .sort(([a], [b]) => a.localeCompare(b));
  const shardDir = path.join(OUTPUT_DIR, 'indexes', `${prefix}-shards`);
  await fs.mkdir(shardDir, { recursive: true });
  const entityToShard = {};
  const shards = [];
  const entitiesPerShard = 20;
  for (let start = 0, shardIndex = 0; start < entries.length; start += entitiesPerShard, shardIndex += 1) {
    const chunk = entries.slice(start, start + entitiesPerShard);
    const name = `${prefix}-${String(shardIndex).padStart(3, '0')}.json`;
    const url = `/data/graph/indexes/${prefix}-shards/${name}`;
    const items = Object.fromEntries(chunk);
    await writeJson(path.join(shardDir, name), {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      shard: shardIndex,
      totalSubjects: chunk.length,
      items
    });
    const stat = await fs.stat(path.join(shardDir, name));
    shards.push({ name, url, count: chunk.length, bytes: stat.size });
    for (const [entityId] of chunk) entityToShard[entityId] = url;
  }
  const mapName = `${prefix}-map.json`;
  const mapUrl = `/data/graph/indexes/${mapName}`;
  await writeJson(path.join(OUTPUT_DIR, 'indexes', mapName), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    totalSubjects: entries.length,
    items: entityToShard
  });
  return { mapUrl, shards };
}

async function writePropertySummary(statements) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  const counts = {};
  for (const statement of statements) counts[statement.propertyId] = (counts[statement.propertyId] || 0) + 1;
  const items = Object.entries(counts)
    .map(([propertyId, count]) => ({ propertyId, propertyLabel: propertyLabels.get(propertyId) || propertyId, count }))
    .sort((a, b) => b.count - a.count || a.propertyId.localeCompare(b.propertyId));
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'property-summary.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: items.length,
    items
  });
}

async function writeGraphExports(sortedEntities, sortedStatements) {
  const jsonLdEntityShards = await writeCompressedJsonLdShards({
    items: sortedEntities,
    dirName: 'jsonld/entity-shards',
    baseName: 'entities-jsonld',
    shardSize: 5000,
    mapItem: jsonLdEntity
  });
  const jsonLdStatementShards = await writeCompressedJsonLdShards({
    items: sortedStatements,
    dirName: 'jsonld/statement-shards',
    baseName: 'statements-jsonld',
    shardSize: 2500,
    mapItem: jsonLdStatement
  });
  const rdfShards = await writeCompressedNdjsonShards({
    items: sortedStatements,
    dirName: 'rdf-ndjson-shards',
    baseName: 'civgraph-rdf',
    shardSize: 10000,
    mapItem: rdfStatement
  });
  const provenanceRows = buildProvenanceRows(sortedStatements);
  const provenanceShards = await writeCompressedJsonShards({
    items: provenanceRows,
    dirName: 'provenance-shards',
    baseName: 'civgraph-provenance',
    shardSize: 10000
  });

  const jsonLdManifest = {
    '@context': JSONLD_CONTEXT,
    '@id': 'https://civgraph.org/exports/civgraph.jsonld',
    '@type': 'civgraph:GraphExport',
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    compression: 'gzip',
    entityCount: sortedEntities.length,
    statementCount: sortedStatements.length,
    entityShards: jsonLdEntityShards,
    statementShards: jsonLdStatementShards
  };
  const jsonLdUrl = '/data/graph/exports/civgraph.jsonld';
  await writeJson(path.join(OUTPUT_DIR, 'exports', 'civgraph.jsonld'), jsonLdManifest);

  const rdfManifest = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    format: 'rdf-style-ndjson',
    compression: 'gzip',
    statementCount: sortedStatements.length,
    shards: rdfShards
  };
  const rdfUrl = '/data/graph/exports/civgraph-rdf.ndjson';
  await writeNdjsonManifest(path.join(OUTPUT_DIR, 'exports', 'civgraph-rdf.ndjson'), rdfManifest, rdfShards);

  const provenanceManifest = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    format: 'civgraph-provenance-json',
    compression: 'gzip',
    referenceCount: provenanceRows.length,
    shards: provenanceShards
  };
  const provenanceUrl = '/data/graph/exports/civgraph-provenance.json';
  await writeJson(path.join(OUTPUT_DIR, 'exports', 'civgraph-provenance.json'), provenanceManifest);

  const manifest = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    exports: {
      jsonld: jsonLdUrl,
      rdfNdjson: rdfUrl,
      provenance: provenanceUrl
    },
    counts: {
      entities: sortedEntities.length,
      statements: sortedStatements.length,
      provenanceReferences: provenanceRows.length
    }
  };
  const manifestUrl = '/data/graph/exports/manifest.json';
  await writeJson(path.join(OUTPUT_DIR, 'exports', 'manifest.json'), manifest);

  return {
    manifest: manifestUrl,
    jsonld: jsonLdUrl,
    rdfNdjson: rdfUrl,
    provenance: provenanceUrl
  };
}

function jsonLdEntity(entity) {
  return compactObject({
    '@id': entity.id,
    '@type': normalizeArray(entity.typeIds),
    'rdfs:label': entity.label,
    'schema:description': entity.description,
    'civgraph:kind': entity.kind,
    'civgraph:browseType': entity.browseType,
    'civgraph:browseSlug': entity.browseSlug,
    'civgraph:browseUrl': entity.browseUrl,
    'civgraph:sourceUrl': entity.sourceUrl,
    'civgraph:attributes': entity.attributes
  });
}

function jsonLdStatement(statement) {
  return compactObject({
    '@id': statement.id,
    '@type': 'civgraph:Statement',
    'civgraph:subject': { '@id': statement.subjectId },
    'civgraph:property': { '@id': statement.propertyId },
    'civgraph:value': jsonLdValue(statement.value),
    'civgraph:rank': statement.rank,
    'civgraph:qualifier': normalizeArray(statement.qualifiers).map((qualifierItem) => compactObject({
      'civgraph:property': { '@id': qualifierItem.propertyId },
      'civgraph:value': jsonLdValue(qualifierItem.value)
    })),
    'prov:wasDerivedFrom': normalizeArray(statement.references).map(jsonLdReference)
  });
}

function jsonLdValue(value) {
  if (!value) return null;
  if (value.type === 'entity') {
    const entity = entities.get(value.id);
    return compactObject({
      '@id': value.id,
      'rdfs:label': entity?.label || value.label
    });
  }
  return compactObject({
    '@value': value.value,
    '@type': jsonLdDatatype(value.type)
  });
}

function jsonLdDatatype(type) {
  if (type === 'date') return 'xsd:date';
  if (type === 'number') return 'xsd:decimal';
  if (type === 'boolean') return 'xsd:boolean';
  if (type === 'url') return 'xsd:anyURI';
  return 'xsd:string';
}

function jsonLdReference(reference) {
  return compactObject({
    '@id': reference.sourceId,
    'rdfs:label': reference.sourceTitle || entities.get(reference.sourceId)?.label,
    'civgraph:sourceKind': reference.sourceKind,
    'civgraph:sourceRecordId': reference.sourceRecordId,
    'civgraph:sourceRowId': reference.sourceRowId,
    'civgraph:sourcePageStart': reference.sourcePageStart,
    'civgraph:sourcePageEnd': reference.sourcePageEnd,
    'civgraph:date': reference.date,
    'civgraph:extractionConfidence': reference.extractionConfidence
  });
}

function rdfStatement(statement) {
  return compactObject({
    recordType: 'statement',
    statement: statement.id,
    subject: statement.subjectId,
    predicate: statement.propertyId,
    object: rdfValue(statement.value),
    rank: statement.rank,
    qualifiers: normalizeArray(statement.qualifiers).map((qualifierItem) => compactObject({
      predicate: qualifierItem.propertyId,
      object: rdfValue(qualifierItem.value)
    })),
    references: normalizeArray(statement.references).map(compactReference)
  });
}

function rdfValue(value) {
  if (!value) return null;
  if (value.type === 'entity') {
    const entity = entities.get(value.id);
    return compactObject({
      type: 'iri',
      value: value.id,
      label: entity?.label || value.label
    });
  }
  return compactObject({
    type: 'literal',
    datatype: value.type,
    value: value.value
  });
}

function buildProvenanceRows(sortedStatements) {
  const rows = [];
  for (const statement of sortedStatements) {
    normalizeArray(statement.references).forEach((reference, index) => {
      rows.push(compactObject({
        statementId: statement.id,
        referenceIndex: index,
        subjectId: statement.subjectId,
        propertyId: statement.propertyId,
        sourceId: reference.sourceId,
        sourceTitle: reference.sourceTitle || entities.get(reference.sourceId)?.label,
        sourceKind: reference.sourceKind,
        sourceRecordId: reference.sourceRecordId,
        sourceRowId: reference.sourceRowId,
        sourcePageStart: reference.sourcePageStart,
        sourcePageEnd: reference.sourcePageEnd,
        date: reference.date,
        extractionConfidence: reference.extractionConfidence
      }));
    });
  }
  return rows;
}

async function writeCompressedJsonLdShards({ items, dirName, baseName, shardSize, mapItem }) {
  const dir = path.join(OUTPUT_DIR, 'exports', dirName);
  await fs.mkdir(dir, { recursive: true });
  const shards = [];
  for (let start = 0, shardIndex = 0; start < items.length; start += shardSize, shardIndex += 1) {
    const chunk = items.slice(start, start + shardSize);
    const name = `${baseName}-${String(shardIndex).padStart(3, '0')}.jsonld.gz`;
    const filePath = path.join(dir, name);
    const payload = {
      '@context': JSONLD_CONTEXT,
      schemaVersion: 1,
      shard: shardIndex,
      total: chunk.length,
      '@graph': chunk.map(mapItem)
    };
    const uncompressedBytes = await writeGzipJson(filePath, payload);
    const stat = await fs.stat(filePath);
    shards.push({
      name,
      url: `/data/graph/exports/${dirName}/${name}`,
      count: chunk.length,
      bytes: stat.size,
      uncompressedBytes
    });
  }
  return shards;
}

async function writeCompressedJsonShards({ items, dirName, baseName, shardSize }) {
  const dir = path.join(OUTPUT_DIR, 'exports', dirName);
  await fs.mkdir(dir, { recursive: true });
  const shards = [];
  for (let start = 0, shardIndex = 0; start < items.length; start += shardSize, shardIndex += 1) {
    const chunk = items.slice(start, start + shardSize);
    const name = `${baseName}-${String(shardIndex).padStart(3, '0')}.json.gz`;
    const filePath = path.join(dir, name);
    const payload = {
      schemaVersion: 1,
      shard: shardIndex,
      total: chunk.length,
      items: chunk
    };
    const uncompressedBytes = await writeGzipJson(filePath, payload);
    const stat = await fs.stat(filePath);
    shards.push({
      name,
      url: `/data/graph/exports/${dirName}/${name}`,
      count: chunk.length,
      bytes: stat.size,
      uncompressedBytes
    });
  }
  return shards;
}

async function writeCompressedNdjsonShards({ items, dirName, baseName, shardSize, mapItem }) {
  const dir = path.join(OUTPUT_DIR, 'exports', dirName);
  await fs.mkdir(dir, { recursive: true });
  const shards = [];
  for (let start = 0, shardIndex = 0; start < items.length; start += shardSize, shardIndex += 1) {
    const chunk = items.slice(start, start + shardSize);
    const name = `${baseName}-${String(shardIndex).padStart(3, '0')}.ndjson.gz`;
    const filePath = path.join(dir, name);
    const text = `${chunk.map((item) => JSON.stringify(mapItem(item))).join('\n')}\n`;
    await writeGzipText(filePath, text);
    const stat = await fs.stat(filePath);
    shards.push({
      name,
      url: `/data/graph/exports/${dirName}/${name}`,
      count: chunk.length,
      bytes: stat.size,
      uncompressedBytes: Buffer.byteLength(text)
    });
  }
  return shards;
}

async function writeNdjsonManifest(filePath, manifest, shards) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const rows = [
    compactObject({ recordType: 'manifest', ...manifest }),
    ...shards.map((shard) => compactObject({ recordType: 'shard', ...shard }))
  ];
  await fs.writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function writeGzipJson(filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await writeGzipText(filePath, text);
  return Buffer.byteLength(text);
}

async function writeGzipText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, await gzipAsync(Buffer.from(text)));
}

function dedupeRelations(relations) {
  const byKey = new Map();
  for (const relation of relations) {
    const key = JSON.stringify([
      relation.statementId,
      relation.subjectId,
      relation.propertyId,
      relation.sourceRowId || ''
    ]);
    if (!byKey.has(key)) byKey.set(key, relation);
  }
  return [...byKey.values()].sort((a, b) => (
    String(a.subjectLabel || '').localeCompare(String(b.subjectLabel || '')) ||
    String(a.propertyLabel || '').localeCompare(String(b.propertyLabel || '')) ||
    String(a.statementId || '').localeCompare(String(b.statementId || ''))
  ));
}

function normalizeSearchText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function buildPublicEntityIdSet(items, mappedEntityIds) {
  const publicTypeIds = new Set([
    TYPE.person,
    TYPE.party,
    TYPE.body,
    TYPE.office,
    TYPE.election,
    TYPE.contest,
    TYPE.mapLayer,
    TYPE.featureGroup,
    TYPE.geographicFeature,
    TYPE.provider,
    TYPE.source,
    TYPE.registerRecord,
    TYPE.mapCategory,
    TYPE.dateYear,
    TYPE.dateMonth
  ]);
  const ids = new Set(mappedEntityIds);
  for (const entity of items) {
    if (normalizeArray(entity.typeIds).some((typeId) => publicTypeIds.has(typeId))) ids.add(entity.id);
  }
  return ids;
}

function buildCompactStatementsBySubject(sortedStatements, allowedSubjectIds) {
  const bySubject = {};
  const propertiesById = new Map(properties.map((property) => [property.id, property]));
  for (const statement of sortedStatements) {
    if (allowedSubjectIds && !allowedSubjectIds.has(statement.subjectId)) continue;
    const property = propertiesById.get(statement.propertyId);
    const value = compactValue(statement.value);
    const compact = compactObject({
      id: statement.id,
      propertyId: statement.propertyId,
      propertyLabel: property?.label || statement.propertyId,
      valueType: statement.value?.type,
      valueId: statement.value?.id,
      valueLabel: value.label,
      valueText: value.text,
      valueDescription: value.description,
      qualifiers: normalizeArray(statement.qualifiers).map((item) => compactObject({
        propertyId: item.propertyId,
        propertyLabel: propertiesById.get(item.propertyId)?.label || item.propertyId,
        valueType: item.value?.type,
        valueId: item.value?.id,
        valueLabel: compactValue(item.value).label,
        valueText: compactValue(item.value).text
      })),
      referenceCount: normalizeArray(statement.references).length,
      references: normalizeArray(statement.references).slice(0, COMPACT_REFERENCE_LIMIT).map(compactReference)
    });
    if (!bySubject[statement.subjectId]) bySubject[statement.subjectId] = [];
    bySubject[statement.subjectId].push(compact);
  }
  return sortObjectByKey(bySubject);
}

async function writeSubjectStatementShards(compactBySubject) {
  const entries = Object.entries(compactBySubject).sort(([a], [b]) => a.localeCompare(b));
  const shardDir = path.join(OUTPUT_DIR, 'indexes', 'statements-by-subject-shards');
  await fs.mkdir(shardDir, { recursive: true });
  const subjectToShard = {};
  const shards = [];
  const subjectsPerShard = 250;
  for (let start = 0, shardIndex = 0; start < entries.length; start += subjectsPerShard, shardIndex += 1) {
    const chunk = entries.slice(start, start + subjectsPerShard);
    const items = Object.fromEntries(chunk);
    const name = `statements-by-subject-${String(shardIndex).padStart(3, '0')}.json`;
    const url = `/data/graph/indexes/statements-by-subject-shards/${name}`;
    const filePath = path.join(shardDir, name);
    await writeJson(filePath, {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      shard: shardIndex,
      totalSubjects: chunk.length,
      items
    });
    const stat = await fs.stat(filePath);
    for (const [subjectId] of chunk) subjectToShard[subjectId] = url;
    shards.push({
      name,
      url,
      count: chunk.length,
      bytes: stat.size
    });
  }
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'statements-by-subject-map.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    totalSubjects: entries.length,
    items: subjectToShard
  });
  return { shards, subjectToShard };
}

function compactValue(value) {
  if (!value) return {};
  if (value.type === 'entity') {
    const entity = entities.get(value.id);
    // An explicit value.label wins so a value can display its own text (e.g. a
    // full date) while still linking to a coarser bucket entity (its year).
    return {
      label: value.label || entity?.label || value.id,
      text: value.label || entity?.label || value.id,
      description: truncateText(entity?.description || '', COMPACT_DESCRIPTION_LIMIT)
    };
  }
  if (value.type === 'boolean') {
    return {
      label: value.value ? 'Yes' : 'No',
      text: value.value ? 'Yes' : 'No'
    };
  }
  return {
    label: value.value === null || value.value === undefined ? '' : String(value.value),
    text: value.value === null || value.value === undefined ? '' : String(value.value)
  };
}

function compactReference(ref) {
  return compactObject({
    sourceId: ref.sourceId,
    sourceTitle: ref.sourceTitle || entities.get(ref.sourceId)?.label,
    sourceKind: ref.sourceKind,
    sourceRecordId: ref.sourceRecordId,
    sourceRowId: ref.sourceRowId,
    date: ref.date,
    page: ref.sourcePageStart || ref.sourcePageEnd,
    extractionConfidence: ref.extractionConfidence
  });
}

async function writeShards(items, dirName, baseName, shardSize) {
  const dir = path.join(OUTPUT_DIR, dirName);
  await fs.mkdir(dir, { recursive: true });
  const shards = [];
  for (let start = 0, shardIndex = 0; start < items.length; start += shardSize, shardIndex += 1) {
    const chunk = items.slice(start, start + shardSize);
    const name = `${baseName}-${String(shardIndex).padStart(3, '0')}.json`;
    const filePath = path.join(dir, name);
    await writeJson(filePath, {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      shard: shardIndex,
      total: chunk.length,
      items: chunk
    });
    const stat = await fs.stat(filePath);
    shards.push({
      name,
      url: `/data/graph/${dirName}/${name}`,
      count: chunk.length,
      bytes: stat.size
    });
  }
  return shards;
}

async function resetOutputDirectory() {
  const resolved = path.resolve(OUTPUT_DIR);
  const expected = path.join(ROOT_DIR, 'data', 'graph');
  if (resolved !== expected) throw new Error(`Refusing to reset unexpected graph output path: ${resolved}`);
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, data, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const pretty = options.pretty !== false;
  await fs.writeFile(filePath, `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`);
}

function siteUrlToPath(url) {
  const clean = decodeURIComponent(String(url || '').split('?')[0].replace(/^\/+/, ''));
  return path.join(ROOT_DIR, ...clean.split('/'));
}

function makeEntityId(prefix, key) {
  const slug = slugify(key || prefix);
  const stableSlug = slug.length > 96 ? `${slug.slice(0, 72)}-${shortHash(slug, 12)}` : slug;
  return `cg:${prefix}:${stableSlug}`;
}

function canonicalBody(value) {
  const raw = cleanText(value);
  const lower = raw.toLowerCase();
  if (lower.includes('house of commons')) {
    return {
      slug: 'house-of-commons',
      label: 'House of Commons',
      description: 'House of Commons of the United Kingdom',
      jurisdiction: 'United Kingdom'
    };
  }
  if (lower.includes('northern ireland assembly') || lower === 'assembly') {
    return {
      slug: 'northern-ireland-assembly',
      label: 'Northern Ireland Assembly',
      description: 'Northern Ireland Assembly',
      jurisdiction: 'Northern Ireland'
    };
  }
  return {
    slug: raw || 'unknown-elected-body',
    label: raw || 'Unknown elected body',
    description: '',
    jurisdiction: ''
  };
}

function canonicalOffice(value) {
  const raw = cleanText(value);
  const lower = raw.toLowerCase();
  if (lower === 'mp' || lower.includes('member of parliament')) {
    return {
      slug: 'mp',
      label: 'Member of Parliament',
      shortLabel: 'MP',
      description: 'Member of Parliament in the House of Commons'
    };
  }
  if (lower === 'mla' || lower.includes('member of the legislative assembly')) {
    return {
      slug: 'mla',
      label: 'Member of the Legislative Assembly',
      shortLabel: 'MLA',
      description: 'Member of the Northern Ireland Assembly'
    };
  }
  return {
    slug: raw || 'unknown-office',
    label: raw || 'Unknown office',
    shortLabel: raw,
    description: ''
  };
}

function statementSemanticKey(subjectId, propertyId, value, qualifiers) {
  return JSON.stringify({
    subjectId,
    propertyId,
    value: normalizeValueForKey(value),
    qualifiers: normalizeArray(qualifiers)
      .map((item) => ({ propertyId: item.propertyId, value: normalizeValueForKey(item.value) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  });
}

function normalizeValueForKey(value) {
  if (!value) return null;
  if (value.type === 'entity') return { type: value.type, id: value.id };
  return { type: value.type, value: value.value };
}

function entityValue(id) {
  if (!id) return null;
  return { type: 'entity', id };
}

function stringValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'string', value: text };
}

function dateValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'date', value: text };
}

function booleanValue(value) {
  if (value === null || value === undefined || value === '') return null;
  return { type: 'boolean', value: Boolean(value) };
}

function numberValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return { type: 'number', value: number };
}

function qualifier(propertyId, value) {
  if (!propertyId || !value) return null;
  return { propertyId, value };
}

function mergeReferences(existing, next) {
  const byKey = new Map();
  for (const ref of [...normalizeArray(existing), ...normalizeArray(next)]) {
    byKey.set(JSON.stringify(sortObjectByKey(compactObject(ref))), compactObject(ref));
  }
  return [...byKey.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function compactObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  return output;
}

function sortObjectByKey(input) {
  return Object.fromEntries(Object.entries(input || {}).sort(([a], [b]) => a.localeCompare(b)));
}

function compareById(a, b) {
  return String(a.id).localeCompare(String(b.id));
}

function compareStatements(a, b) {
  return (
    String(a.subjectId).localeCompare(String(b.subjectId)) ||
    String(a.propertyId).localeCompare(String(b.propertyId)) ||
    String(a.id).localeCompare(String(b.id))
  );
}

function normalizeArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength) {
  const text = cleanText(value);
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

function normalizePersonName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePartyName(value) {
  return normalizePersonName(value);
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

function shortHash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function sameText(a, b) {
  return normalizeKey(a) === normalizeKey(b);
}

function joinDistinct(value) {
  const items = normalizeArray(value).map(cleanText).filter(Boolean);
  return unique(items).join(', ');
}

function searchHintList(value, maxItems = 25) {
  const hints = [];
  collectSearchHints(value, hints);
  return unique(hints.map(cleanText).filter(Boolean)).slice(0, maxItems);
}

function collectSearchHints(value, hints) {
  if (value === null || value === undefined || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSearchHints(item, hints);
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['name', 'title', 'label', 'resultName', 'constituency', 'party', 'body', 'category', 'group', 'sourceMapId', 'layerId', 'key']) {
      collectSearchHints(value[key], hints);
    }
    return;
  }
  hints.push(value);
}

function formatNumberLike(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toLocaleString('en-GB');
}

function firstArrayName(value) {
  const first = normalizeArray(value)[0];
  if (typeof first === 'object') return first?.name || first?.title || '';
  return first || '';
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
