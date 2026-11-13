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
  onBuildElectionCatalogueCards: () => Promise<unknown[]>;
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
export type ViewElement = HTMLElement & { dataset: Record<string, string> };

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
  maps: Record<string, { colour?: string; renderedAssetIds?: unknown[]; renderedAssetBasePath?: string; [key: string]: unknown }>;
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
