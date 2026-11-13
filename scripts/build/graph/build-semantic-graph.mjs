import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzip, gzip } from 'node:zlib';
import { isGraphExcludedSource } from './graph-source-exclusions.mjs';
import { makeEntityId, shortHash, slugify } from '../../lib/graph-entity-id.mjs';
import { graphEntityAliases, readGraphLedger } from '../../lib/graph-id-ledger.mjs';
import { personKeepOf } from '../../lib/person-address-ledger.mjs';
import { wikidataUrl } from '../../lib/wikidata-persons.mjs';
import { buildTimestamp } from '../../lib/build-timestamp.mjs';
import { BROWSE_DIR as RECORD_BROWSE_DIR, GRAPH_DIR, PROVENANCE_FILE, localPathForUrl } from '../../../packages/loader/src/paths.mjs';
import { readProvenance } from '../../../packages/loader/src/election-provenance.mjs';
import { notAPartyLabels } from '../../../packages/core/src/party-names.mjs';
import { idBase } from '../../../packages/core/src/graph-iri.js';
import { SITE } from '../../../packages/config/src/node.mjs';

// Summary labels that are the absence of a party, not one: "No party recorded" (before 1832),
// "No label" (nothing printed or inferred) and a person record's "Unknown" (the parties
// registry's noPartyLabels in candidacies and persons).
/** @type {Set<unknown>} asked about raw labels, which may be missing or a record */
const NOT_A_PARTY = notAPartyLabels('candidacies', 'persons');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..', '..', '..');
const OUTPUT_DIR = GRAPH_DIR;
const BROWSE_DIR = RECORD_BROWSE_DIR;
const REGISTRY_DIR = path.join(ROOT_DIR, 'data', 'database');
// Deterministic, NOT wall-clock: the last commit's time. That still changes with every commit,
// so a file whose content is unchanged but for this stamp is left as it was on disk
// (writeIfChanged): on 2026-10-12 every publish re-uploaded ~4,440 graph files to R2 that
// differed only in generatedAt.
const GENERATED_AT = buildTimestamp();
const ENTITY_SHARD_SIZE = 5000;
const STATEMENT_SHARD_SIZE = 2500;
// Every localeCompare below pins the 'en' collation. Node's default follows the
// host (en-IE here, typically en-US or C in CI). Entity IDs are ASCII by
// construction, but label and JSON.stringify sorts are not -- 1,481 of a 50,000
// label sample are non-ASCII (Dail Eireann, Gearoid O hEara). An unpinned
// collation would let two machines emit differently ordered shards from identical
// input. Verified: pinning 'en' reproduces current ordering exactly (0 of 50,000
// positions differ); codepoint ordering was rejected as it moved 48,660.
// Shared with validate-semantic-graph.mjs -- see graph-source-exclusions.mjs for why the
// rule lives in its own module rather than here.
const COMPACT_REFERENCE_LIMIT = 3;
const COMPACT_DESCRIPTION_LIMIT = 600;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

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
  jurisdiction: 'cg:property:jurisdiction',
  historyOfParliament: 'cg:property:history-of-parliament-biography',
  dateOfBirth: 'cg:property:date-of-birth',
  dateOfDeath: 'cg:property:date-of-death',
  seatHeld: 'cg:property:seat-held',
  sameAs: 'cg:property:same-as'
};

// Parent-card values that correspond to an elected body, mapped (by slug key)
// to the canonical body label so a map used as an election layer gets an
// elected-body statement. Geographic/administrative parent cards are omitted.
/** @type {Record<string, string>} */
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

// cg: the entities' identifiers, https://civgraph.net/id/<kind>:<slug>, each answered by a 303 to
// the record's page (packages/core/src/graph-iri.js; owner decision PG14, 13 Nov 2026: they were
// under civgraph.org, which serves nothing). The ontology and export names below still are.
const JSONLD_CONTEXT = {
  cg: idBase(SITE.origin),
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

/**
 * The graph this builds (scripts/check/rules/semantic-graph.mjs validates it): entities, and
 * statements about them (subject, property, value, qualifiers, references).
 * @typedef {{ type: 'entity', id: string, label?: string }} EntityValue  a link to an entity; its own label (a full date) is shown in place of the entity's (the date's month or year)
 * @typedef {{ type: 'string' | 'date' | 'url', value: string, id?: undefined, label?: undefined }} TextValue
 * @typedef {{ type: 'boolean', value: boolean, id?: undefined, label?: undefined }} BooleanValue
 * @typedef {{ type: 'number', value: number, id?: undefined, label?: undefined }} NumberValue
 * @typedef {EntityValue | TextValue | BooleanValue | NumberValue} GraphValue
 * @typedef {{ propertyId: string, value: GraphValue }} Qualifier
 * @typedef {{ id: string, label: string, description?: string, valueType?: string }} RegistryEntry  an entity type or property of data/database/graph-*.json
 */

/**
 * @typedef {object} GraphReference  a statement's citation; compactObject has dropped its empty fields
 * @property {string} [sourceId]  the source entity (an original-source citation has none: it carries its title, kind and URL)
 * @property {string} [sourceTitle]
 * @property {string} [sourceKind]
 * @property {string} [sourceUrl]
 * @property {string} [sourceRecordId]
 * @property {string} [sourceRowId]
 * @property {string} [date]
 * @property {string} [earliestDeclaration]
 * @property {string} [latestDeclaration]
 * @property {string} [extractionMethod]
 * @property {string} [extractionConfidence]
 * @property {string[]} [sourceExtractIds]
 * @property {string | number} [sourcePageStart]
 * @property {string | number} [sourcePageEnd]
 */

/**
 * @typedef {object} GraphEntity  compactObject has dropped its empty fields
 * @property {string} id
 * @property {string} label
 * @property {string} [description]
 * @property {string} kind  'entity', or 'entity-type' for the registry's types
 * @property {string} [browseType]
 * @property {string} [browseSlug]
 * @property {string} [browseUrl]
 * @property {string} [sourceUrl]
 * @property {Record<string, unknown>} [attributes]
 * @property {string[]} typeIds
 */

/**
 * @typedef {object} EntityInput  what addEntity is given: a new entity's fields, or more for an existing one
 * @property {string[]} [typeIds]
 * @property {string} [label]
 * @property {string} [description]
 * @property {string} [kind]
 * @property {string} [browseType]
 * @property {string} [browseSlug]
 * @property {string} [browseUrl]
 * @property {string} [sourceUrl]
 * @property {Record<string, unknown>} [attributes]
 */

/**
 * @typedef {object} GraphStatement  compactObject has dropped its empty fields
 * @property {string} id  cg:statement:<a hash of subject, property, value and qualifiers>
 * @property {string} subjectId
 * @property {string} propertyId
 * @property {GraphValue} value
 * @property {Qualifier[]} [qualifiers]
 * @property {GraphReference[]} [references]
 * @property {string} rank
 */

/**
 * @typedef {object} StatementInput  what addStatement is given; one without a subject, property or value is not added
 * @property {string | null | undefined} subjectId
 * @property {string} propertyId
 * @property {GraphValue | null} value
 * @property {(Qualifier | null)[]} [qualifiers]
 * @property {(GraphReference | null)[]} [references]
 * @property {string} [rank]
 */

/**
 * The Browse records this reads (data/browse, from build-browse-indexes.mjs), as far as it reads them.
 * @typedef {{ slug?: string, id?: string, key?: string, title?: string, name?: string }} BrowseKeys  the fields a record's Browse mapping keys come from
 * @typedef {{ label?: string, url?: string, href?: string, path?: string, name?: string, title?: string, type?: string, format?: string }} FileLink  a source file or download
 * @typedef {{ label?: string, title?: string, source?: string, role?: string, url?: string }} BrowseReference  an external reference
 * @typedef {string | { name?: string, title?: string }} NameOrRef
 * @typedef {{ key?: string, id?: string, title?: string, date?: string, body?: string, constituency?: string, party?: string, status?: string, elected?: boolean, firstPrefs?: number }} ElectionRef  an election as a person or feature group names it
 * @typedef {{ key?: string, name?: string, title?: string, resultName?: string, resultKind?: string, browseUrl?: string, createdFrom?: string }} ContestInput  a contest of an election (contestInputsForElection)
 * @typedef {{ party?: string, name?: string, label?: string, stood?: number, seats?: number, votes?: number, share?: number }} PartySummaryRow
 * @typedef {{ title?: string, edition?: string, volume?: string, url?: string }} HopPage  a History of Parliament biography page
 * @typedef {{ title?: string, host?: string, url?: string | null, kind?: string }} Citation  an original source of a contest's result (election-provenance.json)
 */

/**
 * @typedef {object} SourceRecord  a Browse source, its detail row merged in
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string} [description]
 * @property {string} [browseUrl]
 * @property {string} [detailUrl]
 * @property {string} [url]
 * @property {string} [category]
 * @property {string | string[]} [provider]
 * @property {string} [publicationStatus]
 * @property {string | number} [date]
 * @property {number} [referenceCount]
 * @property {number} [downloadCount]
 * @property {FileLink[]} [downloads]
 * @property {BrowseReference[]} [references]
 */

/**
 * @typedef {object} MapRecord  a Browse map
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string} [description]
 * @property {string} [browseUrl]
 * @property {string} [category]
 * @property {string} [categoryId]
 * @property {string} [group]
 * @property {string | number} [date]
 * @property {number[]} [years]
 * @property {string | string[]} [provider]
 * @property {string} [status]
 * @property {boolean} [loadable]
 * @property {string} [labelProperty]
 * @property {string} [sourceMapId]
 * @property {string} [layerId]
 * @property {string} [parentCard]
 * @property {string} [interactiveUrl]
 * @property {FileLink[]} [sourceFiles]
 * @property {FileLink[]} [downloads]
 * @property {BrowseReference[]} [references]
 */

/**
 * @typedef {object} FeatureGroupRecord  a Browse feature group (features.json)
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [browseUrl]
 * @property {string} [category]
 * @property {string} [group]
 * @property {number} [featureCount]
 * @property {string} [sourceMapId]
 * @property {string} [mapId]
 * @property {string} [sourceFile]
 * @property {string} [spatialIndexUrl]
 * @property {number} [relatedElectionCount]
 * @property {ElectionRef[]} [relatedElections]
 * @property {{ name?: string, label?: string, bbox?: number[] }[]} [sampleFeatures]
 */

/**
 * @typedef {object} PartyRecord  a Browse party
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [canonicalName]
 * @property {string} [subtitle]
 * @property {string} [browseUrl]
 * @property {number} [firstYear]
 * @property {number} [lastYear]
 * @property {number} [occurrenceCount]
 * @property {number} [fileCount]
 * @property {number} [relatedElectionCount]
 * @property {string} [colour]
 * @property {string[]} [observedNames]
 */

/**
 * @typedef {object} ElectionRecord  a Browse election, or one of its contests (entryKind)
 * @property {string} [id]
 * @property {string} [key]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string} [description]
 * @property {string} [browseUrl]
 * @property {string} [entryKind]
 * @property {string} [body]
 * @property {string} [date]
 * @property {number} [year]
 * @property {string} [category]
 * @property {string} [contestType]
 * @property {string} [kind]
 * @property {string} [votingSystem]
 * @property {string} [contestStatus]
 * @property {number} [totalConstituencies]
 * @property {number} [unmatchedCount]
 * @property {string[]} [constituencies]
 * @property {ContestInput[]} [resultEntries]
 * @property {PartySummaryRow[]} [partySummary]
 * @property {string} [parentElectionKey]  a contest's election
 * @property {string} [constituency]
 * @property {string} [resultName]
 * @property {string} [sourceResultName]
 * @property {{ sourceFile?: string }} [resultMetadata]
 * @property {string} [sourceFile]
 */

/**
 * @typedef {object} PersonRecord  a Browse person
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [name]
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string} [browseUrl]
 * @property {number} [firstYear]
 * @property {number} [lastYear]
 * @property {number} [relatedElectionCount]
 * @property {{ stood?: number, elected?: number, firstPrefs?: number }} [totals]
 * @property {{ name?: string, title?: string }[]} [parties]
 * @property {{ name?: string }[]} [constituencies]
 * @property {ElectionRef[]} [elections]
 * @property {HopPage[]} [historyOfParliament]
 * @property {{ constituency?: string, dates?: string, source?: string }[]} [seatsHeld]
 * @property {string} [born]
 * @property {string} [died]
 * @property {string} [wikidata]
 */

/**
 * @typedef {object} RegisterSourceRef  a register-of-interests row's source
 * @property {string} [sourceTitle]
 * @property {string} [sourceKind]
 * @property {string} [sourceRecordId]
 * @property {string} [sourceRowId]
 * @property {string} [sourceUrl]
 * @property {string} [date]
 * @property {string} [editionDate]
 * @property {string} [earliestDeclaration]
 * @property {string} [latestDeclaration]
 * @property {string} [extractionMethod]
 * @property {string} [extractionConfidence]
 * @property {string[]} [sourceExtractIds]
 */

/**
 * @typedef {object} RegisterInterest  one declared interest of a register record
 * @property {string} [id]
 * @property {string} [category]
 * @property {string} [interestText]
 * @property {string} [interestSummary]
 * @property {boolean} [isNone]
 * @property {number} [sourceCount]
 * @property {number} [duplicateSourceRowCount]
 * @property {string} [extractionConfidence]
 * @property {RegisterSourceRef[]} [sourceRefs]
 */

/**
 * @typedef {object} RegisterRecord  a Browse register-of-interests record, its detail row merged in
 * @property {string} [id]
 * @property {string} [slug]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [browseUrl]
 * @property {string} [detailUrl]
 * @property {string} [recordKind]
 * @property {string} [memberName]
 * @property {string} [memberType]
 * @property {string} [electedBody]
 * @property {string} [chamber]
 * @property {string} [jurisdiction]
 * @property {string} [constituency]
 * @property {NameOrRef[]} [constituencies]
 * @property {string[]} [parties]
 * @property {string} [date]
 * @property {string} [dateStart]
 * @property {string} [dateEnd]
 * @property {number} [interestCount]
 * @property {number} [nonNilInterestCount]
 * @property {number} [sourceCount]
 * @property {string[]} [sourceKinds]
 * @property {string} [interestSummary]
 * @property {RegisterSourceRef[]} [sourceRefs]
 * @property {RegisterInterest[]} [interests]
 */

/**
 * The indexes this writes.
 * @typedef {{ name: string, url: string, count: number, bytes: number, uncompressedBytes?: number }} ShardRef  one shard file of a sharded list
 * @typedef {{ slug: string, label?: string, typeIds?: string[], typeLabels?: string[], browseType?: string, browseSlug?: string, browseUrl?: string }} SlugSummary  an entity's entry in the slug index
 * @typedef {SlugSummary & { entityId: string, description?: string, searchHints?: string[] }} EntitySummary
 * @typedef {{ entityId: string, slug?: string, label?: string, types?: string[], browseType?: string, browseSlug?: string, searchHints?: string[] }} SearchEntry
 * @typedef {{ statementId?: string, subjectId?: string, subjectSlug?: string, subjectLabel?: string, subjectTypeLabels?: string[], propertyId?: string, propertyLabel?: string, sourceKind?: string, sourceRowId?: string, date?: string }} Relation  a statement pointing at an entity (as its value, or citing it)
 * @typedef {Awaited<ReturnType<typeof writeRelatedIndex>>} RelatedIndex
 */

/** @type {Map<string | undefined, GraphEntity>} id -> entity; also asked about a reference's sourceId, which an original-source reference lacks */
const entities = new Map();
/** @type {Map<string, GraphStatement>} */
const statements = new Map();
/** @type {Record<string, string>} "<Browse type>:<key>" -> entity id */
const browseRecordToEntity = {};
/** @type {Map<string, string>} */
const personByNormalizedName = new Map();
/** @type {Map<string, string>} */
const partyByNormalizedName = new Map();
/** @type {Map<string, string>} */
const electionByKey = new Map();
/** @type {Map<string, string>} */
const contestByKey = new Map();
/** @type {Map<string, string>} */
const sourceByRecordKey = new Map();
/** @type {Map<string, string>} */
const providerByName = new Map();
/** @type {Map<string, string>} */
const sourceFileByUrl = new Map();
/** @type {Map<string, string>} */
const mapLayerByKey = new Map();
// The original sources of each contest's result (data/database/election-provenance.json, by the
// contest file's path) and of each election (its contests' sources, most cited first); a contest
// as a person's candidacy names it (electionKey|constituency) -> its file. QA H5, 11 Nov 2026:
// facts about elections, contests and candidacies cite these first and Civgraph's own Browse
// index only after them, as the place they were compiled.
/** @type {Map<string, Citation[]>} */
const contestSourcesByFile = new Map();
/** @type {Map<string, string>} */
const contestFileByElectionContest = new Map();
const ORIGINAL_SOURCE_LIMIT = 2;
/** @type {Map<string, string>} */
const mapCategoryByName = new Map();
/** @type {Map<string, string>} */
const dateYearByYear = new Map();
/** @type {Map<string, string>} */
const dateMonthByKey = new Map();
/** @type {RegistryEntry[]} */
let entityTypes = [];
/** @type {RegistryEntry[]} */
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

  await loadContestProvenance();
  /** @type {[MapRecord[], FeatureGroupRecord[], PartyRecord[], ElectionRecord[], PersonRecord[], SourceRecord[], RegisterRecord[]]} */
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
  const slugIndex = await writeEntitySlugIndex(sortedEntities, publicEntityIds);
  await writeBrowseRecordToEntity(browseRecordToEntity);
  const entityAliases = await writeEntityAliases(sortedEntities);
  const subjectStatementIndex = await writeSubjectStatementShards(compactBySubject);
  const entitySearch = await writeEntitySearchIndex(entitySummaryById);
  const reverseEntityValueIndex = await writeReverseEntityValueIndex(sortedStatements, entitySummaryById);
  const sourceStatementIndex = await writeSourceStatementIndex(sortedStatements, entitySummaryById);
  await writePropertySummary(sortedStatements);
  // Last of the index files: its version is a digest of all of them.
  const lookupIndex = await writeLookupIndex({
    browseMapping: browseRecordToEntity,
    entitySummaries: slugIndex.entries,
    bySlug: slugIndex.bySlug,
    subjectShardIndex: subjectStatementIndex.subjectToShardIndex,
    reverseIndex: reverseEntityValueIndex,
    sourceIndex: sourceStatementIndex
  });
  const exportIndex = await writeGraphExports(sortedEntities, sortedStatements);

  await fs.mkdir(path.join(OUTPUT_DIR, 'quality'), { recursive: true });
  const summary = {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    generator: 'scripts/build/graph/build-semantic-graph.mjs',
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
    generator: 'scripts/build/graph/build-semantic-graph.mjs',
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
      // What a Browse record page reads (writeLookupIndex); the maps below are the same data whole.
      lookup: lookupIndex.url,
      entitySlugs: '/data/graph/indexes/entity-slugs.json',
      entitySearch: entitySearch.url,
      browseRecordToEntity: '/data/graph/indexes/browse-record-to-entity.json',
      statementsBySubjectMap: '/data/graph/indexes/statements-by-subject-map.json',
      statementsBySubjectShards: subjectStatementIndex.shards,
      reverseEntityValuesMap: reverseEntityValueIndex.mapUrl,
      reverseEntityValueShards: reverseEntityValueIndex.shards,
      sourceStatementsMap: sourceStatementIndex.mapUrl,
      sourceStatementShards: sourceStatementIndex.shards,
      propertySummary: '/data/graph/indexes/property-summary.json',
      entityAliases: '/data/graph/indexes/entity-aliases.json'
    },
    quality: {
      validationSummary: '/data/graph/quality/validation-summary.json'
    },
    exports: exportIndex,
    // See inputStamps: lets the validator detect a graph built from older indexes.
    inputs: { ...inputStamps }
  };
  await writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);

  const removed = await removeUnwrittenOutputs();
  console.log(`Built Civgraph semantic graph: ${sortedEntities.length.toLocaleString('en-GB')} entities, ${sortedStatements.length.toLocaleString('en-GB')} statements, ${Object.keys(browseRecordToEntity).length.toLocaleString('en-GB')} Browse mappings.`);
  console.log(`  ${Object.keys(entityAliases.ids).length.toLocaleString('en-GB')} published id(s) the graph no longer has answer through aliases (indexes/entity-aliases.json)${entityAliases.unresolved.length ? `; ${entityAliases.unresolved.length} cannot be answered (the records check fails): ${entityAliases.unresolved.slice(0, 5).join(', ')}` : ''}.`);
  console.log(`  ${writtenOutputs.size - keptUnchanged} file(s) written, ${keptUnchanged} unchanged but for the build stamp (kept as they were), ${removed} stale file(s) removed.`);
}

// Every contest, election and person id the graph has published keeps answering
// (scripts/lib/graph-id-ledger.mjs): an id of the ledger this build no longer has answers with
// the entity it became, through the retired election slugs and the person-id merges. The
// records load puts these in graph_browse_keys as alias:<old id> and slug:<old readable slug>.
/** @param {GraphEntity[]} sortedEntities */
async function writeEntityAliases(sortedEntities) {
  const aliases = graphEntityAliases(readGraphLedger(), sortedEntities.map((entity) => ({
    id: entity.id,
    browseSlug: entity.browseSlug,
    // a string: the election key getContestEntity and buildPersonEntities put there
    electionKey: /** @type {string | undefined} */ (entity.attributes?.electionKey)
  })), { keepOf: personKeepOf() });
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'entity-aliases.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    generator: 'scripts/build/graph/build-semantic-graph.mjs',
    ...aliases
  }, { pretty: false });
  return aliases;
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

/** @param {SourceRecord[]} items */
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

/** @param {MapRecord[]} items */
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

/** @param {FeatureGroupRecord[]} items */
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

/** @param {PartyRecord[]} items */
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

/**
 * @param {ElectionRecord[]} items
 * @param {string} browseElectionSource  the Browse election index's source entity
 */
function buildElectionEntities(items, browseElectionSource) {
  // Each contest's file, so an election can cite its contests' sources and a person's
  // candidacy (electionKey + constituency) the sources of the contest.
  /** @type {Map<string | undefined, string[]>} election key -> its contests' files (asked about an election's key, which a record may lack) */
  const filesByElection = new Map();
  for (const item of items) {
    const file = contestSourceFile(item);
    if (!file || !item.parentElectionKey) continue;
    for (const name of [item.constituency, item.resultName, item.sourceResultName]) {
      if (name) contestFileByElectionContest.set(normalizeKey(`${item.parentElectionKey}|${name}`), file);
    }
    if (!filesByElection.has(item.parentElectionKey)) filesByElection.set(item.parentElectionKey, []);
    /** @type {string[]} */ (filesByElection.get(item.parentElectionKey)).push(file); // set on the line before
  }
  for (const item of items) {
    const key = item.key || item.id || `${item.title || 'election'}:${item.date || ''}`;
    const file = contestSourceFile(item);
    const references = [
      ...(file ? originalSourceReferences([file]) : originalSourceReferences(filesByElection.get(item.key) || [])),
      browseReference(browseElectionSource)
    ];
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
        references
      });
    }
    if (item.date) {
      addDateStatements(id, item.date, references);
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
        references
      });
      addStatement({
        subjectId: contestId,
        propertyId: PROP.contestInElection,
        value: entityValue(id),
        references
      });
      if (contest.name) addStatement({
        subjectId: contestId,
        propertyId: PROP.constituency,
        value: stringValue(contest.name),
        references
      });
    }
    for (const party of item.partySummary || []) {
      if (NOT_A_PARTY.has(party.party || party.name || party.label)) continue;
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
        references
      });
    }
  }
}

/**
 * A member's History of Parliament biography, and the birth and death dates it gives, each
 * referenced to that page. The volume is the source entity; the page is the reference's URL.
 * @param {string} id
 * @param {PersonRecord} item
 */
function addHistoryOfParliament(id, item) {
  const pages = normalizeArray(item.historyOfParliament);
  if (!pages.length) return;
  const refs = pages.map((page) => {
    const sourceId = getGenericSourceEntity({
      label: [page.title, page.edition].filter(Boolean).join(', '),
      url: `https://www.historyofparliamentonline.org/volume/${page.volume}`
    }, { sourceKind: 'history-of-parliament' });
    return compactObject({ sourceId, sourceTitle: entities.get(sourceId)?.label, sourceUrl: page.url });
  });
  pages.forEach((page, i) => addStatement({
    subjectId: id,
    propertyId: PROP.historyOfParliament,
    value: urlValue(page.url),
    references: [refs[i]]
  }));
  // The seats he held and when, each referenced to the page that lists it.
  for (const seat of normalizeArray(item.seatsHeld)) {
    const ref = refs[pages.findIndex((page) => page.url === seat.source)] || refs[0];
    addStatement({
      subjectId: id,
      propertyId: PROP.seatHeld,
      value: stringValue(`${seat.constituency}, ${seat.dates}`),
      references: [ref]
    });
  }
  // Every page that gives the date is cited for it, not only the most precise.
  for (const [prop, key] of /** @type {const} */ ([[PROP.dateOfBirth, 'born'], [PROP.dateOfDeath, 'died']])) {
    if (item[key]) addStatement({ subjectId: id, propertyId: prop, value: dateValue(item[key]), references: refs });
  }
}

// The person's own Wikidata item (the record's `wikidata`: from its official ids, or the Wikidata
// crosswalk data/elections/persons/wikidata-persons.json), as an exact-match link, cited to Wikidata.
/**
 * @param {string} id
 * @param {PersonRecord} item
 */
function addWikidataSameAs(id, item) {
  const url = wikidataUrl(item.wikidata);
  if (!url) return;
  const sourceId = getGenericSourceEntity({ label: 'Wikidata', url: 'https://www.wikidata.org/' }, { sourceKind: 'wikidata' });
  addStatement({
    subjectId: id,
    propertyId: PROP.sameAs,
    value: urlValue(url),
    references: [compactObject({ sourceId, sourceTitle: entities.get(sourceId)?.label, sourceUrl: url })]
  });
}

/**
 * @param {PersonRecord[]} items
 * @param {string} browsePersonSource  the Browse person index's source entity
 */
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
    addHistoryOfParliament(id, item);
    addWikidataSameAs(id, item);
    const nameKey = normalizePersonName(item.name || item.title || item.id);
    if (nameKey && !personByNormalizedName.has(nameKey)) personByNormalizedName.set(nameKey, id);

    for (const party of item.parties || []) {
      // "No party recorded" (before 1832) is the absence of a party, not membership of one.
      if (NOT_A_PARTY.has(party.name || party.title || party)) continue;
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
      const partyId = election.party && !NOT_A_PARTY.has(election.party) ? getPartyEntity(election.party) : null;
      // The contest's own sources first; the person index is where the row was compiled.
      const contestFile = contestFileByElectionContest.get(normalizeKey(`${election.key}|${election.constituency}`));
      const references = [...(contestFile ? originalSourceReferences([contestFile]) : []), browseReference(browsePersonSource)];
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
        references
      });
      addStatement({
        subjectId: id,
        propertyId: PROP.hasCandidature,
        value: entityValue(candidatureId),
        qualifiers,
        references
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.candidate,
        value: entityValue(id),
        references
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.contest,
        value: entityValue(contestId),
        references
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.stoodInElection,
        value: entityValue(electionId),
        references
      });
      if (partyId) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.memberOfPoliticalParty,
        value: entityValue(partyId),
        references
      });
      if (election.status) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.candidatureStatus,
        value: stringValue(election.status),
        references
      });
      addStatement({
        subjectId: candidatureId,
        propertyId: PROP.elected,
        value: booleanValue(election.elected),
        references
      });
      if (election.firstPrefs !== undefined) addStatement({
        subjectId: candidatureId,
        propertyId: PROP.firstPreferenceVotes,
        value: numberValue(election.firstPrefs),
        references
      });
      if (election.date) addDateStatements(candidatureId, election.date, references);
    }
  }
}

/** @param {RegisterRecord[]} records */
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

/**
 * @param {string} id
 * @param {EntityInput} [input]
 */
function addEntity(id, input = {}) {
  if (!id) throw new Error('Entity id is required.');
  const existing = entities.get(id);
  const typeIds = normalizeArray(input.typeIds).filter(Boolean);
  if (existing) {
    existing.typeIds = unique([...(existing.typeIds || []), ...typeIds]);
    for (const key of /** @type {const} */ (['label', 'description', 'browseType', 'browseSlug', 'browseUrl', 'sourceUrl', 'kind'])) {
      // set: the condition has just tested it
      if (!existing[key] && input[key]) existing[key] = /** @type {string} */ (input[key]);
    }
    existing.attributes = compactObject({ ...(existing.attributes || {}), ...(input.attributes || {}) });
  } else {
    // id, label and kind are never empty, so compactObject keeps them; typeIds is set on the next line
    const entity = /** @type {GraphEntity} */ (compactObject({
      id,
      label: input.label || id,
      description: input.description || '',
      kind: input.kind || 'entity',
      browseType: input.browseType,
      browseSlug: input.browseSlug,
      browseUrl: input.browseUrl,
      sourceUrl: input.sourceUrl,
      attributes: compactObject(input.attributes || {})
    }));
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

/**
 * @param {StatementInput} input
 * @returns {GraphStatement | null}
 */
function addStatement(input) {
  if (!input.subjectId || !input.propertyId || !input.value) return null;
  // the filters dropped the nulls
  const qualifiers = /** @type {Qualifier[]} */ (normalizeArray(input.qualifiers).filter((item) => item?.propertyId && item?.value));
  const references = /** @type {GraphReference[]} */ (normalizeArray(input.references).filter(Boolean));
  const key = statementSemanticKey(input.subjectId, input.propertyId, input.value, qualifiers);
  const id = `cg:statement:${shortHash(key, 20)}`;
  const existing = statements.get(id);
  if (existing) {
    existing.references = mergeReferences(existing.references, references);
    return existing;
  }
  // id, subject, property and value were tested above and rank defaults, so compactObject keeps them
  const statement = /** @type {GraphStatement} */ (compactObject({
    id,
    subjectId: input.subjectId,
    propertyId: input.propertyId,
    value: input.value,
    qualifiers,
    references,
    rank: input.rank || 'normal'
  }));
  statements.set(id, statement);
  return statement;
}

/**
 * @param {unknown} name
 * @param {{ constituency?: string, partyLabels?: string[], body?: string }} [context]
 */
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

/** @param {unknown} label */
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

/** @param {unknown} label */
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

/** @param {unknown} label */
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

/** @param {ElectionRef} election */
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

/** @param {{ election: ElectionRef, contest: ContestInput }} input */
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

/** @param {ElectionRecord} item */
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

/**
 * The contest file a Browse contest item was built from, relative to data/elections-source/data/
 * elections/ as the provenance file names it; '' for anything else.
 * @param {ElectionRecord} item
 */
function contestSourceFile(item) {
  const file = String(item?.resultMetadata?.sourceFile || item?.sourceFile || '');
  return file.replace(/^data\/elections-source\/data\/elections\//, '');
}

/** The election provenance's contests (packages/loader/src/election-provenance.mjs), by file: each contest's citations. */
async function loadContestProvenance() {
  let doc = null;
  try { doc = readProvenance(); } catch { /* unreadable: as if not built */ }
  if (!doc) {
    console.warn(`  ${path.relative(ROOT_DIR, PROVENANCE_FILE)} not found: election facts cite only the Browse index.`);
    return;
  }
  for (const contest of normalizeArray(doc?.contests)) {
    // A contest's file is its path and its sources' fields are strings (election-provenance.json).
    if (contest?.file && normalizeArray(contest.sources).length) contestSourcesByFile.set(/** @type {string} */ (contest.file), /** @type {Citation[]} */ (normalizeArray(contest.sources)));
  }
}

/**
 * References to the original sources of some contests' results: each distinct citation once,
 * the most cited first, at most ORIGINAL_SOURCE_LIMIT. A citation is not made a source entity
 * (there are tens of thousands of distinct newspaper pages): the reference carries its title,
 * kind and URL itself.
 * @param {string[]} files
 */
function originalSourceReferences(files) {
  /** @type {Map<string, { citation: Citation, title: string, n: number }>} */
  const counts = new Map();
  for (const file of files) {
    for (const citation of contestSourcesByFile.get(file) || []) {
      const title = cleanText(citation.title || '') || cleanText(citation.host || '') || cleanText(citation.url || '');
      if (!title) continue;
      const key = `${title}|${citation.url || ''}`;
      const row = counts.get(key) || { citation, title, n: 0 };
      row.n += 1;
      counts.set(key, row);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.title.localeCompare(b.title))
    .slice(0, ORIGINAL_SOURCE_LIMIT)
    .map(({ citation, title }) => compactObject({
      sourceTitle: title,
      sourceKind: citation.kind || 'election-result-source',
      sourceUrl: citation.url || undefined
    }));
}

/**
 * @param {string} key
 * @param {string} title
 * @param {string} sourceKind
 */
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

/**
 * @param {RegisterSourceRef | null | undefined} sourceRef
 * @param {{ rowLevel?: boolean }} [options]  rowLevel: false leaves out the row's own ids
 */
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

/** @param {RegisterSourceRef} ref */
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

/**
 * @param {BrowseReference} reference
 * @param {{ sourceKind?: string }} [options]
 */
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

/** @param {unknown} value */
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

/** @param {unknown} value */
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

/** @param {unknown} value */
function extractYear(value) {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

// Pull {year, month} from a date. Handles ISO (YYYY-MM-DD / YYYY-MM, including
// ISO-prefixed referendum ids like 2015-05-22-equal-marriage) and bare years.
/** @param {unknown} value */
function parseDateParts(value) {
  const text = cleanText(value);
  if (!text) return {};
  const iso = text.match(/(\d{4})-(\d{2})(?:-\d{2})?/);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return { year: iso[1], month: iso[2] };
  const year = extractYear(text);
  return year ? { year } : {};
}

/** @param {string} year */
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

/**
 * @param {string} year
 * @param {string} month
 */
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
/**
 * @param {string} subjectId
 * @param {unknown} dateText
 * @param {(GraphReference | null)[]} [references]
 */
function addDateStatements(subjectId, dateText, references) {
  const { year, month } = parseDateParts(dateText);
  if (!year) {
    addStatement({ subjectId, propertyId: PROP.date, value: dateValue(dateText), references });
    return;
  }
  const label = cleanText(dateText) || year;
  // Both ids are set: year (and month) are, so neither getter returns null.
  if (month) {
    addStatement({ subjectId, propertyId: PROP.date, value: { type: 'entity', id: /** @type {string} */ (getDateMonthEntity(year, month)), label }, references });
    addStatement({ subjectId, propertyId: PROP.year, value: entityValue(getDateYearEntity(year)), references });
  } else {
    addStatement({ subjectId, propertyId: PROP.date, value: { type: 'entity', id: /** @type {string} */ (getDateYearEntity(year)), label }, references });
  }
}

/** @param {unknown} value */
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

/**
 * @param {FileLink} file
 * @param {{ parentLabel?: string, relationship?: string }} [context]
 */
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

/** @param {FileLink | FileLink[] | null | undefined} downloads */
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

/**
 * @param {unknown} value
 * @returns {TextValue | null}
 */
function urlValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'url', value: text };
}

/** @param {unknown} value */
function isLikelyUrl(value) {
  return /^https?:\/\//i.test(cleanText(value)) || /^\//.test(cleanText(value));
}

/** @param {unknown} value */
function inferFileName(value) {
  const text = cleanText(value).split('?')[0];
  return text.split(/[\\/]/).filter(Boolean).pop() || '';
}

/** @param {unknown} value */
function inferFormat(value) {
  const text = cleanText(value).split('?')[0].toLowerCase();
  const extension = text.match(/\.([a-z0-9]{2,8})$/)?.[1];
  if (extension) return extension.toUpperCase();
  const known = ['GeoJSON', 'KML', 'ZIP', 'CSV', 'PDF', 'PNG', 'JPG', 'JPEG', 'WEBP', 'FGB', 'PMTILES', 'MBTILES'];
  const match = known.find((format) => text.includes(format.toLowerCase()));
  return match || '';
}

/** @param {RegisterSourceRef[]} sourceRefs */
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
  return [...byKey.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')).slice(0, 25);
}

/** @param {string} sourceId */
function browseReference(sourceId) {
  const entity = entities.get(sourceId);
  return compactObject({
    sourceId,
    sourceTitle: entity?.label,
    // a string: the sources this is given are addSyntheticSource's, whose attributes carry it
    sourceKind: /** @type {string | undefined} */ (entity?.attributes?.sourceKind)
  });
}

/**
 * @param {string} id
 * @param {unknown[]} aliases
 */
function addPartyAliases(id, aliases) {
  for (const alias of normalizeArray(aliases)) {
    const normalized = normalizePartyName(alias);
    if (normalized && !partyByNormalizedName.has(normalized)) partyByNormalizedName.set(normalized, id);
  }
}

/**
 * @param {string} type
 * @param {BrowseKeys} item
 * @param {string} entityId
 */
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

/**
 * What each browse index said when the graph was built.
 *
 * The graph is derived from the browse indexes and nothing tied the two together, so a
 * graph built before an index changed still validated: validate-semantic-graph.mjs checks
 * internal consistency, which a stale graph has perfectly. Measured 2026-09-11, the graph
 * was 1,020 entities behind the persons index and passed anyway.
 *
 * Recording each input's generatedAt lets the validator answer the question the internal
 * checks cannot: was this built from what is on disk now?
 */
/** @type {Record<string, string>} */
const inputStamps = {};

/** @param {string} fileName */
async function loadBrowseItems(fileName) {
  const data = await readJson(path.join(BROWSE_DIR, fileName));
  if (data && !Array.isArray(data) && data.generatedAt) inputStamps[fileName] = data.generatedAt;
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

/** @returns {Promise<SourceRecord[]>} */
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
    /** @type {SourceRecord[]} */
    const detailItems = Array.isArray(shard.items) ? shard.items : [];
    const match = detailItems.find((candidate) => (
      sameText(candidate.slug, item.slug) ||
      sameText(candidate.id, item.id)
    ));
    enriched.push(match ? { ...item, ...match, slug: item.slug || match.slug, browseUrl: item.browseUrl || match.browseUrl } : item);
  }
  return enriched;
}

/** @returns {Promise<RegisterRecord[]>} */
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
    /** @type {RegisterRecord[]} */
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

/**
 * @param {GraphEntity[]} items
 * @param {Set<string>} allowedEntityIds
 */
function buildEntitySlugIndex(items, allowedEntityIds) {
  /** @type {Record<string, Partial<SlugSummary>>} */
  const byId = {};
  /** @type {Record<string, string>} */
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

/**
 * @param {GraphEntity[]} items
 * @param {Set<string>} allowedEntityIds
 */
async function writeEntitySlugIndex(items, allowedEntityIds) {
  /** @type {[string, SlugSummary][]} */
  const entries = [];
  const typeLabelsById = new Map(entityTypes.map((type) => [type.id, type.label]));
  for (const entity of items) {
    if (allowedEntityIds && !allowedEntityIds.has(entity.id)) continue;
    const slug = slugify(entity.browseSlug || entity.label || entity.id);
    // slug is never empty (slugify falls back to 'entry'), so compactObject keeps it
    entries.push([entity.id, /** @type {SlugSummary} */ (compactObject({
      slug,
      label: entity.label,
      typeIds: entity.typeIds,
      typeLabels: normalizeArray(entity.typeIds).map((typeId) => typeLabelsById.get(typeId) || typeId),
      browseType: entity.browseType,
      browseSlug: entity.browseSlug,
      browseUrl: entity.browseUrl
    }))]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b, 'en'));
  /** @type {Record<string, string>} */
  const bySlug = {};
  /** @type {Record<string, string>} */
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
  // Written in parts: one file passed the 25 MiB Cloudflare Pages per-file limit once the
  // 1832-1922 Westminster results were added. entity-slugs.json lists the parts; browse.js
  // loads them and merges bySlug and byIdShard.
  const parts = await writeIndexParts('entity-slugs', [bySlug, byIdShard], ([slugs, ids]) => ({ bySlug: slugs, byIdShard: ids }));
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'entity-slugs.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: entries.length,
    parts,
    shards
  });
  return { entries, bySlug };
}

// Lookup files per key kind, each in this many pieces by a hash of the key (lookupBucket).
const LOOKUP_BUCKETS = { browse: 1024, entity: 1024, slug: 512 };

/**
 * Which of `count` files a key lives in: FNV-1a over the key's UTF-16 code units. browse.js
 * (lookupBucket) and scripts/build/build-browse-indexes.mjs have the same function; all three must
 * agree, or a record page looks in the wrong file and finds nothing.
 * @param {unknown} key
 * @param {number} count
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

/**
 * The lookups a record page makes, in small files (indexes/lookup/).
 *
 * A Browse record page used to download about 56 MB to show its facts: the record-to-entity
 * map for its type (up to 14 MB), the subject-to-shard map (20 MB) and the four parts of the
 * slug index (28 MB), each one whole, to read one key from each. Every map is now split by a
 * hash of its key, which the page computes for itself, so it reads only the piece that holds
 * the key:
 *
 *   lookup/browse/<n>.json   "persons:<slug>" and the record's other keys -> entity id
 *   lookup/entity/<n>.json   entity id -> its summary (label, types, slug, Browse record), with
 *                            the shard numbers of its statements (st), the statements that
 *                            point at it (rv) and the statements it is the source of (ss)
 *   lookup/slug/<n>.json     entity page slug -> entity id
 *
 * lookup.json says how many pieces there are, the URL patterns, and `version`, a digest of the
 * index files, which browse.js appends to each URL so a rebuilt graph is never mixed with a
 * cached copy of the old one. The whole-file maps are still written, for the validator and for
 * a browse.js that predates this.
 * @param {object} indexes
 * @param {Record<string, string>} indexes.browseMapping  Browse key -> entity id
 * @param {[string, SlugSummary][]} indexes.entitySummaries  entity id -> its summary
 * @param {Record<string, string>} indexes.bySlug  entity page slug -> entity id
 * @param {Record<string, number>} indexes.subjectShardIndex  entity id -> the shard of its statements
 * @param {RelatedIndex} indexes.reverseIndex  the statements whose value it is
 * @param {RelatedIndex} indexes.sourceIndex  the statements that cite it
 */
async function writeLookupIndex({ browseMapping, entitySummaries, bySlug, subjectShardIndex, reverseIndex, sourceIndex }) {
  const dir = path.join(OUTPUT_DIR, 'indexes', 'lookup');
  /** @param {keyof typeof LOOKUP_BUCKETS} kind @param {[string, unknown][]} entries */
  const write = async (kind, entries) => {
    const count = LOOKUP_BUCKETS[kind];
    /** @type {Record<string, unknown>[]} */
    const buckets = Array.from({ length: count }, () => ({}));
    for (const [key, value] of entries) buckets[lookupBucket(key, count)][key] = value;
    for (let index = 0; index < count; index += 1) {
      await writeJson(path.join(dir, kind, `${String(index).padStart(4, '0')}.json`), {
        schemaVersion: 1, generatedAt: GENERATED_AT, items: buckets[index]
      }, { pretty: false });
    }
  };
  await write('browse', Object.entries(browseMapping));
  await write('entity', entitySummaries.map(([entityId, summary]) => [entityId, compactObject({
    ...summary,
    st: subjectShardIndex[entityId],
    rv: reverseIndex.entityToShardIndex[entityId],
    ss: sourceIndex.entityToShardIndex[entityId]
  })]));
  await write('slug', Object.entries(bySlug));

  indexDigestValue = indexDigest.digest('hex').slice(0, 12);
  const url = '/data/graph/indexes/lookup.json';
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'lookup.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    version: indexDigestValue,
    hash: 'fnv-1a 32-bit over UTF-16 code units, modulo the bucket count',
    buckets: LOOKUP_BUCKETS,
    bucketPad: 4,
    urls: {
      browse: '/data/graph/indexes/lookup/browse/{bucket}.json',
      entity: '/data/graph/indexes/lookup/entity/{bucket}.json',
      slug: '/data/graph/indexes/lookup/slug/{bucket}.json'
    },
    // Shard numbers in the entity lookup become URLs by these patterns, {n} padded to `pad`.
    shards: {
      statements: { url: '/data/graph/indexes/statements-by-subject-shards/statements-by-subject-{n}.json', pad: 4 },
      reverse: { url: `/data/graph/indexes/${reverseIndex.prefix}-shards/${reverseIndex.prefix}-{n}.json`, pad: 3 },
      sourceStatements: { url: `/data/graph/indexes/${sourceIndex.prefix}-shards/${sourceIndex.prefix}-{n}.json`, pad: 3 }
    }
  });
  return { url, version: indexDigestValue };
}

// Split each map (or array) into pieces by position and write one file per piece. (A constant,
// not a module-level const: the build runs on import, before a later const is initialised.)
/**
 * @param {string} name
 * @param {(Record<string, unknown> | unknown[])[]} collections  maps or arrays
 * @param {(pieces: (Record<string, unknown> | unknown[])[]) => Record<string, unknown>} shape  a part's content, from its piece of each collection
 */
async function writeIndexParts(name, collections, shape) {
  const INDEX_PARTS = 4;
  const urls = [];
  const split = collections.map((c) => {
    const list = Array.isArray(c) ? c : Object.entries(c);
    const size = Math.ceil(list.length / INDEX_PARTS);
    return Array.from({ length: INDEX_PARTS }, (_, i) => list.slice(i * size, (i + 1) * size));
  });
  for (let i = 0; i < INDEX_PARTS; i += 1) {
    // a map's piece is a list of its entries
    const pieces = split.map((pieceList, k) => (Array.isArray(collections[k]) ? pieceList[i] : Object.fromEntries(/** @type {[string, unknown][]} */ (pieceList[i]))));
    const file = `${name}-part-${i}.json`;
    await writeJson(path.join(OUTPUT_DIR, 'indexes', file), { schemaVersion: 1, generatedAt: GENERATED_AT, part: i, ...shape(pieces) }, { pretty: false });
    urls.push(`/data/graph/indexes/${file}`);
  }
  return urls;
}

// The Browse-record-to-entity map, one file per Browse type. A record page needs only its own
// type's keys ("persons:...", "sources:..."), and as one file the map passed the Pages 25 MiB
// limit when the 1801-1831 results were added, so browse.js loads just the type it is showing.
/** @param {Record<string, string>} mapping */
async function writeBrowseRecordToEntity(mapping) {
  /** @type {Record<string, Record<string, string>>} */
  const byTypeItems = {};
  for (const [key, entityId] of Object.entries(sortObjectByKey(mapping))) {
    const type = key.slice(0, key.indexOf(':'));
    (byTypeItems[type] ??= {})[key] = entityId;
  }
  /** @type {Record<string, string>} */
  const byType = {};
  for (const [type, items] of Object.entries(byTypeItems)) {
    const file = `browse-record-to-entity-${slugify(type)}.json`;
    await writeJson(path.join(OUTPUT_DIR, 'indexes', file), {
      schemaVersion: 1, generatedAt: GENERATED_AT, type, total: Object.keys(items).length, items
    }, { pretty: false });
    byType[type] = `/data/graph/indexes/${file}`;
  }
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'browse-record-to-entity.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: Object.keys(mapping).length,
    byType
  });
}

/**
 * @param {GraphEntity[]} items
 * @param {Set<string>} allowedEntityIds
 */
function buildEntitySummaryById(items, allowedEntityIds) {
  const typeLabelsById = new Map(entityTypes.map((type) => [type.id, type.label]));
  /** @type {Record<string, EntitySummary>} */
  const summaries = {};
  for (const entity of items) {
    if (allowedEntityIds && !allowedEntityIds.has(entity.id)) continue;
    const slug = slugify(entity.browseSlug || entity.label || entity.id);
    // entityId and slug are never empty (slugify falls back to 'entry'), so compactObject keeps them
    summaries[entity.id] = /** @type {EntitySummary} */ (compactObject({
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
    }));
  }
  return summaries;
}

/** @param {Record<string, EntitySummary>} entitySummaryById */
async function writeEntitySearchIndex(entitySummaryById) {
  const items = Object.values(entitySummaryById)
    // entityId is never empty, so compactObject keeps it
    .map((summary) => /** @type {SearchEntry} */ (compactObject({
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
    })))
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'en') || a.entityId.localeCompare(b.entityId, 'en'));
  const url = '/data/graph/indexes/entity-search.json';
  // In parts, like entity-slugs.json: the single file passed the 25 MiB per-file limit.
  const parts = await writeIndexParts('entity-search', [items], ([piece]) => ({ items: piece }));
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'entity-search.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: items.length,
    parts
  }, { pretty: false });
  return { url, count: items.length };
}

/**
 * @param {GraphStatement[]} statements
 * @param {Record<string, EntitySummary>} entitySummaryById
 */
async function writeReverseEntityValueIndex(statements, entitySummaryById) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  /** @type {Record<string, Relation[]>} */
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

/**
 * @param {GraphStatement[]} statements
 * @param {Record<string, EntitySummary>} entitySummaryById
 */
async function writeSourceStatementIndex(statements, entitySummaryById) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  /** @type {Record<string, Relation[]>} */
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

/**
 * @param {string} prefix
 * @param {Record<string, Relation[]>} relationMap  entity id -> the statements related to it
 */
async function writeRelatedIndex(prefix, relationMap) {
  const entries = Object.entries(relationMap)
    .map(([entityId, relations]) => /** @type {const} */ ([entityId, dedupeRelations(relations).slice(0, 1000)]))
    .sort(([a], [b]) => a.localeCompare(b, 'en'));
  const shardDir = path.join(OUTPUT_DIR, 'indexes', `${prefix}-shards`);
  await fs.mkdir(shardDir, { recursive: true });
  /** @type {Record<string, string>} */
  const entityToShard = {};
  /** @type {Record<string, number>} */
  const entityToShardIndex = {};
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
    for (const [entityId] of chunk) {
      entityToShard[entityId] = url;
      entityToShardIndex[entityId] = shardIndex;
    }
  }
  const mapName = `${prefix}-map.json`;
  const mapUrl = `/data/graph/indexes/${mapName}`;
  await writeJson(path.join(OUTPUT_DIR, 'indexes', mapName), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    totalSubjects: entries.length,
    items: entityToShard
  });
  return { mapUrl, shards, entityToShardIndex, prefix };
}

/** @param {GraphStatement[]} statements */
async function writePropertySummary(statements) {
  const propertyLabels = new Map(properties.map((property) => [property.id, property.label]));
  /** @type {Record<string, number>} */
  const counts = {};
  for (const statement of statements) counts[statement.propertyId] = (counts[statement.propertyId] || 0) + 1;
  const items = Object.entries(counts)
    .map(([propertyId, count]) => ({ propertyId, propertyLabel: propertyLabels.get(propertyId) || propertyId, count }))
    .sort((a, b) => b.count - a.count || a.propertyId.localeCompare(b.propertyId, 'en'));
  await writeJson(path.join(OUTPUT_DIR, 'indexes', 'property-summary.json'), {
    schemaVersion: 1,
    generatedAt: GENERATED_AT,
    total: items.length,
    items
  });
}

/**
 * @param {GraphEntity[]} sortedEntities
 * @param {GraphStatement[]} sortedStatements
 */
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

/** @param {GraphEntity} entity */
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

/** @param {GraphStatement} statement */
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

/** @param {GraphValue | undefined} value */
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

/** @param {string} type */
function jsonLdDatatype(type) {
  if (type === 'date') return 'xsd:date';
  if (type === 'number') return 'xsd:decimal';
  if (type === 'boolean') return 'xsd:boolean';
  if (type === 'url') return 'xsd:anyURI';
  return 'xsd:string';
}

/** @param {GraphReference} reference */
function jsonLdReference(reference) {
  return compactObject({
    '@id': reference.sourceId,
    'rdfs:label': reference.sourceTitle || entities.get(reference.sourceId)?.label,
    'civgraph:sourceKind': reference.sourceKind,
    'civgraph:sourceRecordId': reference.sourceRecordId,
    'civgraph:sourceRowId': reference.sourceRowId,
    'schema:url': reference.sourceUrl,
    'civgraph:sourcePageStart': reference.sourcePageStart,
    'civgraph:sourcePageEnd': reference.sourcePageEnd,
    'civgraph:date': reference.date,
    'civgraph:extractionConfidence': reference.extractionConfidence
  });
}

/** @param {GraphStatement} statement */
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

/** @param {GraphValue | undefined} value */
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

/** @param {GraphStatement[]} sortedStatements */
function buildProvenanceRows(sortedStatements) {
  /** @type {Record<string, unknown>[]} */
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

/**
 * @template T
 * @param {{ items: T[], dirName: string, baseName: string, shardSize: number, mapItem: (item: T) => unknown }} options
 */
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

/** @param {{ items: unknown[], dirName: string, baseName: string, shardSize: number }} options */
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

/**
 * @template T
 * @param {{ items: T[], dirName: string, baseName: string, shardSize: number, mapItem: (item: T) => unknown }} options
 */
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

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} manifest
 * @param {ShardRef[]} shards
 */
async function writeNdjsonManifest(filePath, manifest, shards) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const rows = [
    compactObject({ recordType: 'manifest', ...manifest }),
    ...shards.map((shard) => compactObject({ recordType: 'shard', ...shard }))
  ];
  await writeIfChanged(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

/**
 * @param {string} filePath
 * @param {unknown} payload
 * @returns {Promise<number>} the uncompressed size in bytes
 */
async function writeGzipJson(filePath, payload) {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await writeGzipText(filePath, text);
  return Buffer.byteLength(text);
}

/**
 * @param {string} filePath
 * @param {string} text
 */
async function writeGzipText(filePath, text) {
  await writeIfChanged(filePath, text, { gzipped: true });
}

/** @param {Relation[]} relations */
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
    String(a.subjectLabel || '').localeCompare(String(b.subjectLabel || ''), 'en') ||
    String(a.propertyLabel || '').localeCompare(String(b.propertyLabel || ''), 'en') ||
    String(a.statementId || '').localeCompare(String(b.statementId || ''), 'en')
  ));
}

/** @param {unknown} value */
function normalizeSearchText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * @param {GraphEntity[]} items
 * @param {Set<string>} mappedEntityIds
 */
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

/**
 * @param {GraphStatement[]} sortedStatements
 * @param {Set<string>} allowedSubjectIds
 */
function buildCompactStatementsBySubject(sortedStatements, allowedSubjectIds) {
  /** @type {Record<string, Record<string, unknown>[]>} */
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

// Statements are grouped by a hash of their subject, not in runs of 250 sorted subjects: a run
// was 0.9 MB at the median and 8.8 MB at most (pretty-printed), and a record page downloads the
// whole file to read one entity's statements. 2,048 compact files average about 200 KB, and an
// entity whose statements change rewrites only its own file instead of moving every later
// subject into a different one.
const SUBJECT_STATEMENT_BUCKETS = 2048;

/** @param {Record<string, Record<string, unknown>[]>} compactBySubject  subject id -> its statements, compacted */
async function writeSubjectStatementShards(compactBySubject) {
  const entries = Object.entries(compactBySubject).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const shardDir = path.join(OUTPUT_DIR, 'indexes', 'statements-by-subject-shards');
  await fs.mkdir(shardDir, { recursive: true });
  /** @type {Record<string, string>} */
  const subjectToShard = {};
  /** @type {Record<string, number>} */
  const subjectToShardIndex = {};
  const shards = [];
  /** @type {[string, Record<string, unknown>[]][][]} */
  const buckets = Array.from({ length: SUBJECT_STATEMENT_BUCKETS }, () => []);
  for (const entry of entries) buckets[lookupBucket(entry[0], SUBJECT_STATEMENT_BUCKETS)].push(entry);
  for (let shardIndex = 0; shardIndex < buckets.length; shardIndex += 1) {
    const chunk = buckets[shardIndex];
    if (!chunk.length) continue;
    const items = Object.fromEntries(chunk);
    const name = `statements-by-subject-${String(shardIndex).padStart(4, '0')}.json`;
    const url = `/data/graph/indexes/statements-by-subject-shards/${name}`;
    const filePath = path.join(shardDir, name);
    await writeJson(filePath, {
      schemaVersion: 1,
      generatedAt: GENERATED_AT,
      shard: shardIndex,
      totalSubjects: chunk.length,
      items
    }, { pretty: false });
    const stat = await fs.stat(filePath);
    for (const [subjectId] of chunk) {
      subjectToShard[subjectId] = url;
      subjectToShardIndex[subjectId] = shardIndex;
    }
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
  }, { pretty: false });
  return { shards, subjectToShard, subjectToShardIndex };
}

/** @param {GraphValue | undefined} value */
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

/** @param {GraphReference} ref */
function compactReference(ref) {
  return compactObject({
    sourceId: ref.sourceId,
    sourceTitle: ref.sourceTitle || entities.get(ref.sourceId)?.label,
    sourceKind: ref.sourceKind,
    // The source's own address, so a record page can link it (QA H5).
    sourceUrl: ref.sourceUrl,
    sourceRecordId: ref.sourceRecordId,
    sourceRowId: ref.sourceRowId,
    date: ref.date,
    page: ref.sourcePageStart || ref.sourcePageEnd,
    extractionConfidence: ref.extractionConfidence
  });
}

/**
 * @param {unknown[]} items
 * @param {string} dirName
 * @param {string} baseName
 * @param {number} shardSize
 * @returns {Promise<ShardRef[]>}
 */
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

// The output is no longer wiped before a build: files are rewritten only when their content
// changes (writeIfChanged), and removeUnwrittenOutputs() deletes, after the build, whatever this
// build did not write, so nothing stale survives.
/** @type {Set<string>} */
const previousOutputs = new Set();
/** @type {Set<string>} */
const writtenOutputs = new Set();
let keptUnchanged = 0;

/**
 * @param {string} dir
 * @param {Set<string>} out
 * @returns {Promise<Set<string>>} out, with every file under dir added
 */
async function listFiles(dir, out) {
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await listFiles(full, out); else out.add(path.resolve(full));
  }
  return out;
}

async function resetOutputDirectory() {
  const resolved = path.resolve(OUTPUT_DIR);
  const expected = path.resolve(GRAPH_DIR);
  if (resolved !== expected) throw new Error(`Refusing to reset unexpected graph output path: ${resolved}`);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await listFiles(OUTPUT_DIR, previousOutputs);
}

async function removeUnwrittenOutputs() {
  let removed = 0;
  for (const file of previousOutputs) {
    if (writtenOutputs.has(file)) continue;
    await fs.rm(file, { force: true });
    removed += 1;
  }
  return removed;
}

/** @param {string} text */
const withoutStamp = (text) => text.replace(/"generatedAt":\s*"[^"]*"/g, '"generatedAt":""');

// A digest of everything written under indexes/, apart from build stamps: the lookup head's
// `version` (writeLookupIndex). browse.js puts it on every lookup and shard URL, so a rebuild
// that changes a shard is a new URL rather than a day-old copy from the browser's cache (the
// graph is served with max-age=86400); a rebuild that changes nothing keeps every URL.
const indexDigest = crypto.createHash('sha1');
/** @type {string | null} */
let indexDigestValue = null;
/**
 * @param {string} resolved
 * @param {string} text
 */
function noteIndexContent(resolved, text) {
  if (indexDigestValue !== null) return;
  const relative = path.relative(path.join(OUTPUT_DIR, 'indexes'), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return;
  indexDigest.update(`${relative.split(path.sep).join('/')}\n`);
  indexDigest.update(withoutStamp(text));
}

/** Write `text` (gzipped when `gzipped`), unless the file already holds the same content apart
 * from its generatedAt stamp, in which case it is kept, stamp and all.
 * @param {string} filePath
 * @param {string} text
 * @param {{ gzipped?: boolean }} [options]
 */
async function writeIfChanged(filePath, text, { gzipped = false } = {}) {
  const resolved = path.resolve(filePath);
  writtenOutputs.add(resolved);
  noteIndexContent(resolved, text);
  if (previousOutputs.has(resolved)) {
    try {
      const raw = await fs.readFile(resolved);
      const old = gzipped ? (await gunzipAsync(raw)).toString('utf8') : raw.toString('utf8');
      if (old === text || withoutStamp(old) === withoutStamp(text)) { keptUnchanged += 1; return; }
    } catch {
      // unreadable or not gzip: write it afresh
    }
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, gzipped ? await gzipAsync(Buffer.from(text)) : text);
}

/** @param {string} filePath */
async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

/**
 * @param {string} filePath
 * @param {unknown} data
 * @param {{ pretty?: boolean }} [options]
 */
async function writeJson(filePath, data, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const pretty = options.pretty !== false;
  await writeIfChanged(filePath, `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`);
}

/**
 * @param {unknown} url  a site path (/data/browse/..., /data/graph/...)
 * @returns {string}
 */
function siteUrlToPath(url) {
  // /data/browse/... and /data/graph/... are wherever this build writes them (records/paths.mjs).
  // null only for an empty or http(s) URL; the indexes' URLs are site paths
  return /** @type {string} */ (localPathForUrl(decodeURIComponent(String(url || ''))));
}

/** @param {unknown} value */
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

/** @param {unknown} value */
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

/**
 * @param {string} subjectId
 * @param {string} propertyId
 * @param {GraphValue} value
 * @param {Qualifier[]} qualifiers
 */
function statementSemanticKey(subjectId, propertyId, value, qualifiers) {
  return JSON.stringify({
    subjectId,
    propertyId,
    value: normalizeValueForKey(value),
    qualifiers: normalizeArray(qualifiers)
      .map((item) => ({ propertyId: item.propertyId, value: normalizeValueForKey(item.value) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
  });
}

/** @param {GraphValue | null | undefined} value */
function normalizeValueForKey(value) {
  if (!value) return null;
  if (value.type === 'entity') return { type: value.type, id: value.id };
  return { type: value.type, value: value.value };
}

/**
 * @param {string | null | undefined} id
 * @returns {EntityValue | null}
 */
function entityValue(id) {
  if (!id) return null;
  return { type: 'entity', id };
}

/**
 * @param {unknown} value
 * @returns {TextValue | null}
 */
function stringValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'string', value: text };
}

/**
 * @param {unknown} value
 * @returns {TextValue | null}
 */
function dateValue(value) {
  const text = cleanText(value);
  if (!text) return null;
  return { type: 'date', value: text };
}

/**
 * @param {unknown} value
 * @returns {BooleanValue | null}
 */
function booleanValue(value) {
  if (value === null || value === undefined || value === '') return null;
  return { type: 'boolean', value: Boolean(value) };
}

/**
 * @param {unknown} value
 * @returns {NumberValue | null}
 */
function numberValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return { type: 'number', value: number };
}

/**
 * @param {string} propertyId
 * @param {GraphValue | null} value
 * @returns {Qualifier | null}
 */
function qualifier(propertyId, value) {
  if (!propertyId || !value) return null;
  return { propertyId, value };
}

/**
 * @param {GraphReference[] | undefined} existing
 * @param {GraphReference[]} next
 */
function mergeReferences(existing, next) {
  const byKey = new Map();
  for (const ref of [...normalizeArray(existing), ...normalizeArray(next)]) {
    byKey.set(JSON.stringify(sortObjectByKey(compactObject(ref))), compactObject(ref));
  }
  return [...byKey.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}

/**
 * @template {object} T
 * @param {T | null | undefined} input
 * @returns {Partial<T>} its fields less the empty ones (null, undefined, '', [] and {})
 */
function compactObject(input) {
  /** @type {Record<string, unknown>} */
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    output[key] = value;
  }
  // the input's own fields, less the empty ones
  return /** @type {Partial<T>} */ (output);
}

/**
 * @template T
 * @param {Record<string, T>} input
 * @returns {Record<string, T>}
 */
function sortObjectByKey(input) {
  return Object.fromEntries(Object.entries(input || {}).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

/**
 * @param {{ id: string }} a
 * @param {{ id: string }} b
 */
function compareById(a, b) {
  return String(a.id).localeCompare(String(b.id), 'en');
}

/**
 * @param {GraphStatement} a
 * @param {GraphStatement} b
 */
function compareStatements(a, b) {
  return (
    String(a.subjectId).localeCompare(String(b.subjectId), 'en') ||
    String(a.propertyId).localeCompare(String(b.propertyId), 'en') ||
    String(a.id).localeCompare(String(b.id), 'en')
  );
}

/**
 * @template T
 * @param {T | T[] | null | undefined} value
 * @returns {T[]}
 */
function normalizeArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @template T
 * @param {T} value
 * @param {string} label
 * @returns {T & unknown[]} the value itself, which is an array (or this throws)
 */
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

/**
 * @template T
 * @param {T[]} values
 */
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/** @param {unknown} value */
function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 */
function truncateText(value, maxLength) {
  const text = cleanText(value);
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

/** @param {unknown} value */
function normalizeKey(value) {
  return cleanText(value).toLowerCase();
}

/** @param {unknown} value */
function normalizePersonName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {unknown} value */
function normalizePartyName(value) {
  return normalizePersonName(value);
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function sameText(a, b) {
  return normalizeKey(a) === normalizeKey(b);
}

/** @param {unknown} value */
function joinDistinct(value) {
  const items = normalizeArray(value).map(cleanText).filter(Boolean);
  return unique(items).join(', ');
}

/**
 * @param {unknown} value
 * @param {number} [maxItems]
 */
function searchHintList(value, maxItems = 25) {
  /** @type {unknown[]} */
  const hints = [];
  collectSearchHints(value, hints);
  return unique(hints.map(cleanText).filter(Boolean)).slice(0, maxItems);
}

/**
 * @param {unknown} value
 * @param {unknown[]} hints
 */
function collectSearchHints(value, hints) {
  if (value === null || value === undefined || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) collectSearchHints(item, hints);
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['name', 'title', 'label', 'resultName', 'constituency', 'party', 'body', 'category', 'group', 'sourceMapId', 'layerId', 'key']) {
      collectSearchHints(/** @type {Record<string, unknown>} */ (value)[key], hints); // an object, by the test above
    }
    return;
  }
  hints.push(value);
}

/** @param {unknown} value */
function formatNumberLike(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toLocaleString('en-GB');
}

/** @param {NameOrRef | NameOrRef[] | undefined} value */
function firstArrayName(value) {
  const first = normalizeArray(value)[0];
  if (typeof first === 'object') return first?.name || first?.title || '';
  return first || '';
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
