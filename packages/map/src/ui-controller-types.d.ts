/**
 * The UI controller's neighbours and records as packages/map/src/ui-controller.js reads them, so
 * the type check (packages/map/tsconfig.check.json) knows them. Declarations only: nothing here
 * exists at run time. (Not named ui-controller.d.ts, which would stand in for the module itself.)
 *
 * - UiCallbacks: what the map app gives the controller to call (packages/map/src/app/ui-wiring.js
 *   wireUiCallbacks, mobile-layout.js and search.js), each before the controller's init().
 * - The catalogue's history entries, the entity tables' columns and rows, and the other records
 *   the controller keeps.
 */

/** A GeoJSON feature as the map's layers give them. */
export type MapFeature = import('geojson').Feature<import('geojson').Geometry | null, Record<string, unknown> | null>;

/** A place of the catalogue's history (Back and Forward). */
export interface CatalogueHistoryEntry {
  type: 'list' | 'detail' | 'tab' | 'book-viewer' | 'feature-detail' | 'election-entity-detail';
  mapId?: string;
  tabId?: string;
  bookId?: string;
  format?: string;
  detailId?: string;
}

/** The map app's callbacks: set by packages/map/src/app/ui-wiring.js before init(). */
export interface UiCallbacks {
  onSplitChange: (stateId: string) => void;
  onMapLoad: (mapId: string) => Promise<unknown>;
  onMapUnload: (mapId: string) => Promise<unknown>;
  onMapToggle: (mapId: string) => void;
  onCheckMapLoaded: (mapId: string) => boolean;
  onCheckMapSettled: (mapId: string) => string;
  onCheckMapVisible: (mapId: string) => boolean;
  onLoadSingleFeature: (mapId: string, featureId: string | number, featureName: string | null, bbox: number[] | null, options?: Record<string, unknown>) => Promise<{ feature?: DetailFeature & { featureName?: string } } | null>;
  onHideMap: (mapId: string) => void;
  onCategoryChange: (categoryId: string) => void;
  onProviderCategoryChange: (providerId: string, providers: string[]) => void;
  onAuthorFilter: (authors: string[] | null) => void;
  onExpandToFullMap: (mapId: string) => Promise<unknown>;
  onPartialFeatureToggle: (mapId: string, featureIndex: string | number) => void;
  onPartialFeatureUnload: (mapId: string, featureIndex: string | number) => void;
  onCheckFeatureLoaded: (mapId: string, featureIndex: string | number) => boolean;
  onCheckFeatureVisible: (mapId: string, featureIndex: string | number) => boolean;
  onFeatureLoad: (mapId: string, featureIndex: string | number, featureName: string | null, bbox: number[] | null, options?: Record<string, unknown>) => Promise<unknown>;
  onSearch: (query: string) => void;
  onOpenElectionEntityDetail: (kind: string, key: string, label?: string) => Promise<unknown>;
  onElectionEntityElectionOpen: (target: { key?: string; body?: string; date?: string; constituency?: string }) => Promise<unknown>;
  onOpenElectionConstituencyFeature: (target: { constituency?: string; level?: string }) => Promise<unknown>;
  onBuildElectionCatalogueCards: () => Promise<ElectionCatalogueCard[]>;
  onLoadElection: (body: string, date: string) => Promise<unknown>;
  onUnloadElection: () => unknown;
  onCheckElectionLoaded: (body: string, date: string) => boolean;
  onSetupElectionTableControls: (dataTable: unknown) => void;
  onShowOnMap: (label: string) => void;
  onReorderLayers: (ids: string[]) => void;
  onDownloadFgb: (mapId: string) => Promise<unknown>;
  onExportMapImage: (mapId: string, format: string, options?: { trigger?: HTMLElement }) => unknown;
  onAddressSelect: (lat: number, lon: number, name: string) => void;
  onRemoveAddressMarker: () => void;
  onCheckIntersection: (lat: number, lon: number) => Promise<unknown[]>;
  onGetLoadedFeatures: () => unknown[];
  onZoomToBbox: (bounds: unknown, options?: Record<string, unknown>) => void;
  onHighlightFeature: (mapId: string, featureId: string | number, options?: Record<string, unknown>) => void;
}

/** A map's drawing style, the fields the controller reads. */
export interface MapStyleView {
  color?: string;
  fillColor?: string;
  weight?: number;
  fillOpacity?: number;
  [key: string]: unknown;
}

/** A map's data files. */
export interface MapFilesView {
  fgb?: string;
  geojson?: string;
  [key: string]: unknown;
}

/** A variant of a group map (a map of its own, listed by id). */
export interface MapVariantView {
  id: string;
  name?: string;
  label?: string;
  files?: MapFilesView;
  [key: string]: unknown;
}

/** A reference of a map: a source with its link, note and when it was read. */
export interface MapReferenceView {
  label?: string;
  url?: string;
  note?: string;
  accessed?: string;
  [key: string]: unknown;
}

/**
 * A map of the catalogue (or a statistic) as the controller reads it: data-service.js's
 * CatalogueMap (packages/types MapEntry's fields), with the loose parts (style, files, variants,
 * references) given the fields read.
 */
export interface MapRecord {
  id: string;
  name: string;
  slug?: string;
  category?: string;
  group?: string;
  date?: string | number;
  dateAdded?: string | null;
  dateEffective?: string;
  description?: string;
  provider?: string[];
  keywords?: string[];
  featured?: boolean;
  hidden?: boolean;
  placeholder?: boolean;
  incomplete?: boolean;
  isGroup?: boolean;
  parentId?: string;
  cloneOf?: string;
  status?: string;
  labelProperty?: string | null;
  labelPropertyFallbacks?: string[];
  priorityProperty?: string;
  idProperty?: string;
  bounds?: number[][];
  style?: MapStyleView;
  files?: MapFilesView;
  variants?: MapVariantView[];
  references?: MapReferenceView[];
  sourceDownloads?: import('../../types/index.js').SourceLink[];
  /** A list of links, or the files by format (an array has no fgb: it reads as undefined). */
  downloads?: (import('../../types/index.js').SourceLink[] & { fgb?: undefined }) | { fgb?: string; [key: string]: unknown };
  licence?: string;
  license?: string;
  licenceUrl?: string;
  licenseUrl?: string;
  attribution?: string;
  changeNote?: string;
  note?: string;
  isDataEntry?: boolean;
  csv?: string;
  /** A composite's member layers (map-relations.mjs MapRelations). */
  members?: string[];
  chunked?: unknown;
  [key: string]: unknown;
}

/** A feature as the feature pages keep it, with the whole-feature figures the popup worked out. */
export type DetailFeature = MapFeature & {
  mapId?: string;
  wholeAreaM2?: number;
  wholePerimeterM?: number;
  geometryIsClipped?: boolean;
};

/** A feature page's record (the feature-detail cache). */
export interface FeatureDetailEntry {
  feature: {
    mapId?: string;
    id: string | number;
    properties: Record<string, unknown>;
    geometry: import('geojson').Geometry | null;
    wholeAreaM2?: number;
    wholePerimeterM?: number;
    geometryIsClipped?: boolean;
  };
  mapConfig: MapRecord | null | undefined;
  primaryName: string;
  electoralHistory: unknown;
}

/**
 * An element of the controller's own markup: an HTML element whose data attributes are those its
 * templates write with it (a lookup by class or attribute finds the element they were written on;
 * the handlers test the few that may be absent).
 */
export type ViewElement = ViewLookups & HTMLElement & { dataset: Record<string, string> };

/**
 * The lookups up from an element of the controller's markup: its ancestors are that markup's too
 * (first in ViewElement, so its answer is the one a call by selector takes).
 */
export interface ViewLookups {
  closest(selectors: string): ViewElement | null;
}

/**
 * A part of the page the controller draws into (a pane, a card, a menu): the elements it holds are
 * its own markup's, so a lookup in it gives a ViewElement. HTMLElement and Document are both
 * assignable to it.
 */
export interface HtmlRoot {
  querySelector(selectors: string): ViewElement | null;
  querySelectorAll(selectors: string): NodeListOf<ViewElement>;
}

/** An HTML element that holds HTML elements (HtmlRoot's lookups first). */
export type HtmlElementRoot = HtmlRoot & HTMLElement;

/** What the map list is drawn with (catalogue-list.js renderMapList), kept for later redraws. */
export interface MapListOptions {
  visibleIds?: string[];
  loadedIds?: string[];
  featureCounts?: Map<string, number>;
  totalMaps?: number;
  shownMaps?: number;
  fullCatalogue?: boolean;
  flatSectionKey?: string | null;
}

/** A detail page's remembered place: its scroll and each table's state, by table id. */
export interface DetailViewState {
  tables: Record<string, unknown>;
  scrollTop?: number;
}

/** data/database/feature-thumbnails/_manifest.json: each map's feature thumbnails. */
export interface FeatureThumbnailManifest {
  maps: Record<string, { colour?: string; renderedAssetIds?: unknown[]; renderedAssetBasePath?: string; renderedAssetExtension?: string; renderedAssetExtensionsById?: Record<string, string>; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** An item of a Browse list (data/browse/<kind>.json) as the catalogue search reads it. */
export interface BrowseItem {
  id?: string;
  key?: string;
  slug?: string;
  browseUrl?: string;
  title?: string;
  name?: string;
  subtitle?: string;
  category?: string;
  relatedElectionCount?: number | string;
  body?: string;
  date?: string;
  year?: number | string;
  thumbnailMapId?: string;
  provider?: string | string[];
  keywords?: string[];
  description?: string;
  [key: string]: unknown;
}

/** One feature the place search found (searchFeatures): its map, id, name and box. */
export interface FeatureSearchResult {
  mapId: string;
  id?: string | number;
  name?: string;
  bbox?: number[] | null;
  [key: string]: unknown;
}

/** A button of the controller's own markup (ViewElement's data attributes). */
export type ViewButton = HTMLButtonElement & { dataset: Record<string, string> };

/** An event's target in the controller's own markup: what it is inside is found by closest(). */
export interface ViewTarget {
  closest(selectors: string): ViewElement | null;
}

/** A class of maps.json `classes[]` as the legacy grouped list reads it (a class may be drawn joined to another). */
export type LegacyClass = import('../../types/index.js').CatalogueClass & { conjoinedTo?: string };

/** A cell of an explicit C1 grid column (maps.json `c1s[].sections[].columns[].items[]`): a map, or a header or note row. */
export interface C1GridItem {
  type?: string;
  label?: string;
  mapId?: string;
  /** The grid rows the cell spans. */
  rows?: number[];
}

/** A column of a C1 section: a stacked-columns column names its classes, an explicit-grid column lists its cells. */
export interface C1Column {
  header?: string;
  classId?: string;
  stack?: string[];
  items?: C1GridItem[];
}

/** An explicit-grid column: its cells are listed. */
export type C1ExplicitColumn = C1Column & { items: C1GridItem[] };

/** What every C1 section may name: a full-width class, or the classes of its two or three columns. */
interface C1SectionBase {
  width?: string;
  classId?: string;
  left?: string;
  center?: string;
  right?: string;
}

/** A stacked-columns section (drawn by renderChronologicalGrid). */
export interface C1StackedSection extends C1SectionBase {
  type: 'stacked-columns';
  columns: C1Column[];
}

/** An explicit-grid section (drawn by renderExplicitGrid): rows are given in the data. */
export interface C1ExplicitGridSection extends C1SectionBase {
  type: 'explicit-grid';
  totalRows?: number;
  columns: C1ExplicitColumn[];
}

/** A section of one, two or three classes side by side. */
export interface C1PlainSection extends C1SectionBase {
  type?: 'two-column' | 'three-column';
  columns?: C1Column[];
}

export type C1Section = C1StackedSection | C1ExplicitGridSection | C1PlainSection;

/** A C1 card of maps.json `c1s[]` (packages/types MapCatalogue holds them as unknown). */
export interface C1Record {
  id: string;
  name: string;
  category: string;
  layout?: string;
  c2s?: string[];
  rows?: Array<{ left?: string; right?: string }>;
  sections?: C1Section[];
}

/** A map of a class card, with the class it was listed under. */
export interface ClassMapEntry {
  map: MapRecord;
  classId: string;
  className: string;
}

/** What the legacy cards are drawn with: the list's options, and the section's own. */
export type CardOptions = MapListOptions & { fullWidth?: boolean; ignoreMemberHeight?: boolean };

/** A row of a stacked-columns grid: a class's heading, or one of its maps. */
export type ChronologicalGridItem = { gridRowStart?: number; gridRowEnd?: number; year: number; classId: string } & (
  | { type: 'header'; name: string }
  | { type: 'entry'; map: MapRecord; className: string; isLoaded: boolean; isPlaceholder?: boolean; isIncomplete?: boolean }
);

/** An election of the catalogue's lists: election-manager.js buildCatalogueCards's entry, with its listing fields. */
export type ElectionCatalogueCard = import('./election/election-manager').ElectionEntry & {
  canonicalLayerId?: string | null;
  placeholder?: boolean;
  displaySubtitle?: string;
  displayProvider?: string;
  displayTitle?: string;
  bodyGroup?: string;
};

/** A card of the flat catalogue (renderFlatView): its maps by id or class, or a decade's elections. */
export interface FlatCard {
  id: string;
  name: string;
  years?: string;
  extent?: string;
  mapIds?: string[];
  classIds?: string[];
  thumbMapId?: string | null;
  /** maps-v2's projection: the entry's subject, scope and year. */
  subjectId?: string;
  scope?: string | null;
  sortYear?: number | null;
  electionEntries?: ElectionCatalogueCard[];
}

/** A row of the flat catalogue's contents that stands for several cards. */
export interface FlatTocMerge {
  canonicalName: string;
  mergedIds: string[];
  years?: string;
  extent?: string;
  inHeading?: string;
  thumbMapId?: string;
}

/** A heading of the flat catalogue's contents: its cards by name (the hand-written list) or by id (maps-v2). */
export interface FlatTocGroup {
  heading: string;
  members?: string[];
  memberIds?: string[];
  shelf?: string;
  kind?: string;
}

/** An entry of data/database/maps-v2.json (the reorganised catalogue). */
export interface MapsV2Entry {
  id: string;
  name: string;
  subject: string;
  kind?: string;
  axis?: string | null;
  scope?: string | null;
  year?: number | null;
  mapIds: string[];
  variantOf?: unknown;
}

/** maps-v2.json as the flat catalogue reads it: the catalogue with its shelves, subjects and entries. */
export type MapsV2Document = Omit<import('./data-service.js').CatalogueDocument, 'entries'> & {
  entries: MapsV2Entry[];
  shelves?: Array<{ id: string; name: string; blurb?: string; order?: number; subjects?: string[] }>;
  subjects?: Array<{ id: string; name: string; kind?: string; shelf?: string; c1Ids?: string[] }>;
};

/** A download menu: while open it is carried to the page's body, and where it came from and its closing listener ride on it. */
export type DownloadDropdown = HtmlElementRoot & {
  _ddHome?: { parent: ParentNode | null; next: ChildNode | null } | null;
  _ddCloseHandler?: ((e?: Event) => void) | null;
};
