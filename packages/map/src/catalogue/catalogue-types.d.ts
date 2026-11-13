/**
 * The rebuilt catalogue's data and neighbours as its modules (index.js, view-*.js) read them, so
 * the type check (packages/map/tsconfig.check.json) knows them. Declarations only: nothing here
 * exists at run time.
 *
 * - The catalogue document (/_api/catalogue, built by scripts/build/catalogue/build-catalogue.mjs):
 *   search.js types the part its search reads (Catalogue); the rows, shelves and records here add
 *   what the views draw.
 * - CatalogueUi: what the catalogue calls on the UI controller (packages/map/src/ui-controller.js),
 *   each optional as the catalogue calls it (`?.`), so the catalogue and the controller type-check
 *   apart; the controller passes itself, which the check holds to this interface.
 * - CatalogueApp: what it reads of the map app (window.__civgraphTest2.app, packages/map/app/app.js).
 */
import type { Book, CatalogueMap } from '../data-service.js';
import type { Catalogue, CatalogueElection, CatalogueMapRecord, CatalogueMember, CatalogueSeries, PersonRow } from './search.js';

/** One part or county of a map: a button each. */
export interface CataloguePart {
  id: string;
  label: string;
}

/** An order that made a map's divisions, with what it did and when. */
export interface CatalogueOrder {
  divisions?: string;
  made?: string;
  purposes?: Array<[string, string]>;
}

/** What a row or an election is (data/catalogue/descriptions.json): its paragraphs, then its links. */
export interface CatalogueAbout {
  text?: string[];
  links?: Array<{ url: string; label: string }>;
}

/** A map of the catalogue as its row draws it (the document's `maps`, by id). */
export interface CatalogueMapRec extends CatalogueMapRecord {
  provider?: string[];
  features?: number;
  unit?: string;
  status?: string;
  years?: number[];
  parts?: CataloguePart[];
  counties?: CataloguePart[];
  color?: string;
  note?: string;
  dateNote?: string;
  licence?: string;
  orders?: CatalogueOrder[];
  ordersSource?: string;
}

/** An edition, version or council map of a row. */
export interface CatalogueRowMember extends CatalogueMember {
  version?: string;
}

/** A row of the catalogue: a series of maps, its editions as chips. */
export interface CatalogueRow extends CatalogueSeries {
  kind: string;
  members: CatalogueRowMember[];
  local?: CatalogueRowMember[];
  todo?: CatalogueRowMember[];
  about?: CatalogueAbout;
  arrangement?: string;
  color?: string;
  thumb?: string;
  unit?: string;
}

/** A subject: the rows under one heading of a shelf. */
export interface CatalogueSubject {
  id: string;
  name: string;
  kind?: string;
  series: string[];
}

/** A shelf of a section: its subjects, and the rows it sends to the end. */
export interface CatalogueShelf {
  id: string;
  name: string;
  subjects: string[];
  flat?: boolean;
  last?: string[];
}

/** An election as its row draws it. */
export interface CatalogueRowElection extends CatalogueElection {
  seats?: number;
  contestType?: string;
  mapless?: boolean;
  thumb?: string;
  about?: CatalogueAbout;
}

/** Where a link to a hidden map or a map to be added opens (built into mapLinks). */
export interface CatalogueMapLink {
  route?: string;
  series: string;
  todo?: boolean;
  map?: string;
}

/** The catalogue document. */
export interface CatalogueDoc extends Catalogue {
  subjects: CatalogueSubject[];
  shelves: CatalogueShelf[];
  series: CatalogueRow[];
  maps: Record<string, CatalogueMapRec>;
  elections: CatalogueRowElection[];
  redirects?: Record<string, string>;
  mapLinks?: Record<string, CatalogueMapLink>;
}

/** data/catalogue/people.json: everyone who stood, and the tables their rows index. */
export interface CataloguePeopleDoc {
  people: PersonRow[];
  parties: string[];
  constituencies: string[];
}

/** A feature's thumbnail in the search results: an image, or a box to draw a locator in. */
export interface FeatureThumbnail {
  url?: string;
  bbox?: number[];
  colour?: string;
}

/**
 * One record of the current pane's search (ui-controller.js makeCatalogueSearchRecord): a map, an
 * election, a party, a person, a source or a feature, with the text the search matches.
 */
export interface CatalogueSearchRecord {
  type: string;
  title: string;
  subtitle: string;
  provider: string;
  searchText: string;
  id?: string;
  typeLabel?: string;
  mapId?: string;
  featureId?: string;
  url?: string;
  slug?: string;
  relatedElectionCount?: number | string;
  bbox?: number[] | null;
  featureThumbnail?: FeatureThumbnail | null;
  [key: string]: unknown;
}

/** A source file to download, as the current pane lists them (ui-controller.js getSourceDownloads). */
export interface SourceDownload {
  file?: string;
  label?: string;
  [key: string]: unknown;
}

/** What the catalogue calls on the UI controller: each member optional, as it is called. */
export interface CatalogueUi {
  booksData?: unknown;
  _catalogueSearchQuery?: string;
  ensureThumbnailManifest?(): Promise<unknown>;
  ensureFeatureCountManifest?(): Promise<unknown>;
  ensureFeatureThumbnailManifest?(): Promise<unknown>;
  _syncCatalogueShellHeight?(): void;
  bindFlatViewDelegates?(container: HTMLElement): void;
  hydrateLazyThumbnails?(root: ParentNode): void;
  syncCatalogueSearchActionButtons?(container: ParentNode): void;
  syncDownloadButtons?(container: ParentNode): void;
  thumbnailPath?(id: string, sizeSuffix?: string): string | null | undefined;
  renderMapProviderSummary?(map: CatalogueMap): string;
  getMapFeatureCount?(map: CatalogueMap): number | null;
  getMapFeatureUnitLabel?(map: CatalogueMap, count: number): string;
  getSourceDownloads?(map: CatalogueMap): SourceDownload[];
  searchFeatures?(query: string): Promise<unknown[]>;
  ensureCatalogueSearchIndex?(): Promise<CatalogueSearchRecord[]>;
  featureSearchResultToCatalogueRecord?(result: unknown): CatalogueSearchRecord | null;
  normalizeCatalogueSearchText?(value: string): string;
  scoreCatalogueSearchRecord?(record: CatalogueSearchRecord, terms: string[], normalizedQuery: string, mapOrder: Map<string, number>): number;
  renderCatalogueSearchActionStrip?(record: CatalogueSearchRecord): string;
  _buildFeatureLocatorSvg?(bbox: number[], colour?: string): string;
  _buildBookCardHtml?(book: Book): string;
  showTab?(tabId: string): void;
  showCatalogueDetailView?(mapId: string, addToHistory?: boolean): void;
  onAddressSelect?: ((lat: number, lon: number, label: string) => void) | null;
  onOpenElectionEntityDetail?: ((kind: string, id: string, name: string) => void) | null;
  onCheckMapLoaded?: ((mapId: string) => unknown) | null;
  onCheckMapVisible?: ((mapId: string) => unknown) | null;
  onCheckElectionLoaded?: ((body: string, date: string) => unknown) | null;
  onMapLoad?: ((mapId: string) => unknown) | null;
  onMapUnload?: ((mapId: string) => unknown) | null;
  onMapToggle?: ((mapId: string) => unknown) | null;
  onLoadElection?: ((body: string, date: string) => unknown) | null;
  onUnloadElection?: (() => unknown) | null;
  onDownloadFgb?: ((mapId: string) => unknown) | null;
  onExportMapImage?: ((mapId: string, format: string) => unknown) | null;
}

/** What the catalogue reads of the MapLibre map (its controller's `map`). */
export interface CatalogueMapView {
  getCanvas?(): HTMLCanvasElement;
  once(type: 'click', listener: (ev: { lngLat: { lng: number; lat: number } }) => void): unknown;
  off(type: 'click', listener: (ev: { lngLat: { lng: number; lat: number } }) => void): unknown;
}

/** What the catalogue reads of the map app (window.__civgraphTest2.app), each part optional. */
export interface CatalogueApp {
  searchQuery?: string;
  workerSearchQuery?: string;
  workerSearchResultIds?: unknown;
  mapController?: {
    map?: CatalogueMapView | null;
    fitToBounds?(bounds: unknown, options?: { smooth?: boolean }): void;
    setOpacity?(mapId: string, opacity: number): void;
  } | null;
  updateURLState?(): void;
  dismissMobileCatalogueAfterLoad?(label: string): void;
  buildLayerShareUrl?(mapId: string): string;
  getLoadedLayerIds?(): string[];
}
