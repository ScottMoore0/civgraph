// HAND-WRITTEN: the core shapes the code uses most, named once. No schema describes these
// files as a whole, so each is written from the code that reads it (the loader, the Functions,
// the map app) and from the data; every type says where it comes from. Where a generated type
// covers a shape (a registry entry, a records row, a /api/v1 answer), the name here is an alias
// of it, so there is still one source. Unlike packages/types/generated/, this file is edited by
// hand; tests/unit/types-package.test.mjs checks that it compiles and that each name exists.

import type { Council as CouncilEntry, CouncilsRegistry } from '../generated/registries/councils.js';
import type { Entity as PartyEntity, PartiesRegistry } from '../generated/registries/parties.js';
import type { OfficesDocument } from '../generated/facts/offices.js';
import type { TenuresDocument } from '../generated/facts/tenures.js';
import type {
  CandidaciesRow, ContestsRow, PartiesRow, PersonsRow, RCountsRow, RElectionsRow, LayersRow, MapsRow,
} from '../generated/records-db.js';
import type {
  ElectionsBundleAnswer, ElectionsContestAnswer, ElectionsManifestAnswer, LayersLayerAnswer,
} from '../generated/api-v1.js';

/** A JSON value as JSON.parse returns it. @handwritten */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A date as the data writes it: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD'. @handwritten */
export type IsoDate = string;

// ---------------------------------------------------------------- elections

/**
 * One count row of a contest (a bundle result's `countGroup[]`), in the PascalCase of the source
 * CSVs. Ingested as an r_counts row (RCountsRow). @handwritten
 */
export interface Count {
  id?: number | string;
  Candidate_Id?: string | number;
  Count_Number?: number | string;
  Total_Votes?: number | string | null;
  Transfers?: number | string | null;
  Status?: string | null;
  [key: string]: unknown;
}

/**
 * One candidate standing in a contest (a bundle result's `candidates[]`). Ingested as a
 * candidacies row (CandidaciesRow; the whole object is its `meta`). @handwritten
 */
export interface Candidacy {
  id?: string | number;
  personId?: string | null;
  name?: string;
  nameAsPrinted?: string | null;
  partyAsPrinted?: string | null;
  /** The party label as the source prints it. */
  party?: string | null;
  partyLabelRule?: number | null;
  partyId?: string | null;
  ballotDescription?: string | null;
  firstPrefs?: number | null;
  finalVotes?: number | null;
  elected?: boolean;
  electedAt?: number | null;
  excluded?: boolean;
  excludedAt?: number | null;
  status?: string | null;
  unopposed?: boolean;
  colour?: string | null;
  gender?: string | null;
  [key: string]: unknown;
}
/** The older name some code uses. @handwritten */
export type Candidate = Candidacy;

/**
 * One contest (a constituency, ward or DEA) of an election: a bundle's `results[]` item.
 * Ingested as a contests row (ContestsRow). @handwritten
 */
export interface Contest {
  constituency: string;
  sourceFile?: string | null;
  seatsTotal?: number | null;
  seatsWon?: number | null;
  electorate?: number | null;
  quota?: number | null;
  turnoutPct?: number | null;
  winnerParty?: string | null;
  winnerName?: string | null;
  leadingParty?: string | null;
  leadingName?: string | null;
  leadingVotes?: number | null;
  leadingPct?: number | null;
  majority?: number | null;
  majorityPct?: number | null;
  matched?: boolean;
  matchName?: string | null;
  featureId?: string | number | null;
  featureName?: string | null;
  candidates?: Candidacy[];
  countGroup?: Count[];
  animationPayload?: Json;
  [key: string]: unknown;
}

/**
 * An election bundle (one file of the election bundle directory, ELECTION_BUNDLE_DIR; the
 * /api/v1/elections?format=bundle answer). Ingested as an r_elections row plus its contests.
 * @handwritten
 */
export interface Election extends ElectionsBundleAnswer {
  key: string;
  body: string;
  bodySlug?: string;
  bodyGroup?: string | null;
  date: IsoDate;
  year?: number;
  displayTitle: string;
  contestType?: string | null;
  kind?: string | null;
  votingSystem?: string | null;
  contestStatus?: string | null;
  sourceMapId?: string | null;
  layerId?: string | null;
  labelProperty?: string | null;
  candidateRowsExpected?: boolean | number | null;
  transferDataExpected?: boolean | number | null;
  previousKey?: string | null;
  placeholder?: boolean;
  results?: Contest[];
}

/** One entry of the election manifest (/api/v1/elections?view=manifest). @handwritten */
export type ElectionManifestEntry = ElectionsManifestAnswer['elections'][number];

/** A contest as /api/v1/elections answers it (candidates and counts). @handwritten */
export type ContestAnswer = ElectionsContestAnswer;

// ---------------------------------------------------------------- people, parties, bodies

/**
 * A person as Browse lists them (data/browse persons items; /api/v1/persons list items). The
 * records row is PersonsRow, whose `meta` holds the full record. @handwritten
 */
export interface Person {
  id: string;
  slug: string;
  type: string;
  title: string;
  name: string;
  browseUrl: string;
  parties?: unknown[];
  elections?: unknown[];
  [key: string]: unknown;
}

/** A party entity of the parties registry (registries/schemas/parties.schema.json $defs.entity). @handwritten alias */
export type Party = PartyEntity;

/** A council of the councils registry (registries/schemas/councils.schema.json $defs.council). @handwritten alias */
export type Council = CouncilEntry;

/** An institution of data/offices/offices.json. @handwritten alias */
export type Institution = OfficesDocument['institutions'][number];
/** An office of data/offices/offices.json. @handwritten alias */
export type Office = OfficesDocument['offices'][number];
/** One tenure of an office (data/offices/tenures/*.json). @handwritten alias */
export type Tenure = TenuresDocument['tenures'][number];

// ---------------------------------------------------------------- the map catalogue

/** A source link or download as the catalogue and layers list them. @handwritten */
export interface SourceLink {
  label?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * One map of the catalogue (data/database/maps.json `maps[]`; a maps row's `record`).
 * Written from the data (1,118 entries, 8 Nov 2026): only id, name, slug and category are in
 * every entry. @handwritten
 */
export interface MapEntry {
  id: string;
  name: string;
  slug: string;
  category: string;
  date?: string | number;
  dateAdded?: string | null;
  dateEffective?: string;
  description?: string;
  provider?: string[];
  keywords?: string[];
  featured?: boolean;
  hidden?: boolean;
  hiddenReason?: string;
  placeholder?: boolean;
  incomplete?: boolean;
  isGroup?: boolean;
  parentId?: string;
  cloneOf?: string;
  files?: { [key: string]: unknown };
  style?: { [key: string]: unknown };
  rasterStyle?: { [key: string]: unknown };
  labelProperty?: string | null;
  labelPropertyFallbacks?: string[];
  idProperty?: string;
  bounds?: number[][];
  references?: SourceLink[];
  sourceDownloads?: SourceLink[];
  downloads?: SourceLink[] | { [key: string]: unknown };
  variants?: Array<{ [key: string]: unknown }>;
  licence?: string;
  license?: string;
  licenceUrl?: string;
  licenseUrl?: string;
  attribution?: string;
  changeNote?: string;
  note?: string;
  [key: string]: unknown;
}

/** One segment of a catalogue series: which classes (or maps) cover which dates. @handwritten */
export interface CatalogueSeriesSegment {
  classIds?: string[];
  mapIds?: string[];
  from?: IsoDate;
  to?: IsoDate;
  column?: string;
}

/** A catalogue series: data/database/maps.json `timeSeriesChains[]`. @handwritten */
export interface CatalogueSeries {
  id: string;
  name: string;
  segments: CatalogueSeriesSegment[];
  category?: string;
  scope?: string;
  parallel?: boolean;
  /** The classes that precede the series (the parallel chain's columns all follow them). */
  predecessor?: { classIds?: string[]; [key: string]: unknown };
  /** Classes of the series given directly rather than by segment (read by the map's time slider). */
  classIds?: string[];
  /** Columns of a series drawn side by side, each with its classes (read by the map's time slider). */
  columns?: Array<{ classIds?: string[]; [key: string]: unknown }>;
}

/** A catalogue class (the maps of one boundary type in date order): maps.json `classes[]`. @handwritten */
export interface CatalogueClass {
  id: string;
  name: string;
  scope?: string;
  category: string;
  maps: string[];
  hidden?: boolean;
  showNotes?: boolean;
  useFullNames?: boolean;
}

/** A catalogue category: maps.json `categories[]`. @handwritten */
export interface CatalogueCategory {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  group?: string;
  hidden?: boolean;
}

/** data/database/maps.json as a whole. @handwritten */
export interface MapCatalogue {
  categories: CatalogueCategory[];
  timeSeriesChains: CatalogueSeries[];
  classes: CatalogueClass[];
  c1s: unknown[];
  maps: MapEntry[];
}

/**
 * One layer of the map app (render/metadata/maps-test.json `layers[]`; a layers row's
 * `record`; /api/v1/layers?layer= answers). Written from the data (1,339 layers, 8 Nov 2026):
 * the required fields are in every layer. @handwritten
 */
export interface LayerEntry extends LayersLayerAnswer {
  id: string;
  sourceMapId: string;
  name: string;
  category: string;
  renderer: string;
  geometryType: string;
  group?: string | null;
  date?: string | number | null;
  dateAdded?: string | null;
  dateEffective?: string | null;
  provider: string[];
  description: string;
  sourceType: string;
  minzoom: number;
  maxzoom: number;
  bounds: number[][];
  style: { [key: string]: unknown };
  keywords: string[];
  tiles?: string;
  tileUrl?: string;
  tilesFallback?: string | null;
  metadataUrl?: string;
  sourceLayer?: string;
  promoteId?: string;
  idProperty?: string;
  labelProperty?: string | null;
  labelPropertyFallbacks?: string[];
  labelMinZoom?: number;
  labelMaxZoom?: number | null;
  labelStyle?: { [key: string]: unknown };
  featureIndexUrl?: string;
  popupProperties?: string[];
  numericProperties?: string[];
  categoricalProperties?: string[];
  categoricalValues?: { [key: string]: unknown };
  references?: SourceLink[];
  sourceDownloads?: SourceLink[];
  sourceCredits?: string[];
  status?: string;
  notes?: string;
  aliasOf?: string;
  cloneOf?: string;
  aliasTargetLayerId?: string;
  variantOf?: string;
  parentId?: string;
  loadable?: boolean;
}

// ---------------------------------------------------------------- answer envelopes

/** The two JSON error envelopes of /api/v1 (functions/README.md, "v2 candidates"). @handwritten */
export type ApiError = { error: string } | { ok: false; error: string };

/** A Browse list page (packages/api/src/handlers/_browse-index.js), its items under `key`. @handwritten */
export type BrowsePage<K extends string, T> = { [P in K]: T[] } & {
  total: number;
  count: number;
  limit: number;
  offset: number;
  applied: { filters: unknown[]; sort: unknown };
};

/** One Browse record answer (`view=record`): the item, its shape set by the record type. @handwritten */
export interface RecordAnswer<T = { [key: string]: unknown }> {
  item: T;
  [key: string]: unknown;
}

/** A Browse detail answer (`view=detail`). @handwritten */
export interface DetailAnswer<T = { [key: string]: unknown }> {
  schemaVersion: number;
  item: T;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- the records rows, by role

/** The records rows behind the core shapes, under the names above. @handwritten aliases */
export interface CoreRows {
  election: RElectionsRow;
  contest: ContestsRow;
  candidacy: CandidaciesRow;
  count: RCountsRow;
  person: PersonsRow;
  party: PartiesRow;
  map: MapsRow;
  layer: LayersRow;
}

/** The registries as documents. @handwritten aliases */
export interface CoreRegistries {
  councils: CouncilsRegistry;
  parties: PartiesRegistry;
}
