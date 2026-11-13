/**
 * The election manager (Test2ElectionManager, packages/map/app/election-manager.js) and what it
 * holds, as the type check sees them. The manager is one class written as several modules:
 * installMethods puts GroupedYearMethods (grouped-year-methods.js) on its prototype, so the
 * manager a method module, the NI local view (packages/map/app/ni-local-view.js) or the class
 * itself sees is ElectionManager, the class with those methods.
 *
 * Declarations only, nothing at run time. ElectionHost is what the manager uses of the map app
 * (Test2App: `app` in its constructor), ElectionMapController what it uses of the main map's
 * adapter, each member typed by what it is there. The unit test election-manager-host.test.mjs
 * holds every member to the code, as map-app-host.test.mjs does for MapApp.
 */
import type { MapApp } from '../app/map-app';
import type { LayerIndex, Test2MapLibreMainAdapter } from '../../app/maplibre-main-adapter.js';
import type { Test2ElectionManager } from '../../app/election-manager.js';
import type { GroupedYearMethods } from './grouped-year-methods.js';
import type { ElectionRecord, ElectionResult } from '../../../core/src/election-view-model.mjs';

/** The manager with the methods installMethods puts on its prototype. */
export type ElectionManager = Test2ElectionManager & GroupedYearMethods;

/** What the manager uses of the map app (packages/map/app/app.js and its method modules). */
export interface ElectionHost extends Pick<MapApp,
  | 'updateURLState'
  | 'updateActiveLayers'
  | 'syncCatalogueMapState'
  | 'loadMap'
  | 'updateTimeline'> {
  // Fields (Test2App's constructor).
  /**
   * The map index (packages/map/src/renderer/metadata-service.js), made by the app's init before
   * any election opens. A lookup of no id (a bundle without one) finds nothing.
   */
  metadataService: { getLayer(id: string | undefined): ReturnType<LayerIndex['getLayer']> };
  /** Holds the address while several layer changes each would write it (packages/map/src/app/url-suspend.mjs). */
  urlSuspend: { hold(): boolean; release(wasSuspended: boolean): void };
  /** The history entry a navigation will push (packages/map/src/app/navigation-push.mjs). */
  navigationPush: { clear(): void };
  /** The base map shown (controls.js setBaseMap): the NI local view's hatching follows its tone. */
  baseMapId: string;
  /** The main map's adapter (the manager's own `mapController` is the same object). */
  mapController: { invalidateSize?(): void } | null;

  // Methods of the app's method modules.
  /** election-pane.js */
  refitAfterElectionPane(sourceMapId: string): void;
  /** catalogue-list.js */
  focusActiveElectionCatalogueEntry(entry: ElectionEntry | null, options?: { scroll?: boolean }): void;
  /** url-state.js */
  beginNavigation(label: string): void;
  /** url-state.js */
  endNavigation(): void;
  /** url-state.js */
  pushURLState(label?: string): void;
  /** legend.js */
  updateMapLegend(): void;
  /** entity-bridge.js */
  openElectionEntityDetailInCatalogue(kind: string | undefined, key: string | undefined, options?: { label?: string }): Promise<boolean>;
  /** catalogue-list.js */
  updateMapList(): void;
  /** timeline/controls.js */
  setTimelineItems<T extends object>(items: T[], activeIndex: number, onSelect: (item: T) => unknown, options?: Record<string, unknown>): void;
  /** timeline/controls.js */
  getTimelineGeneralsOnly(fallback?: boolean): boolean;
  /** election-pane.js */
  openElection(body: string, date: string): Promise<unknown>;
  /** election-pane.js: set once the pane's resizer is wired (setupElectionPaneResizer). */
  syncElectionPaneResizerAria?: () => void;
}

/** What the manager uses of the main map's adapter (packages/map/app/maplibre-main-adapter.js). */
export type ElectionMapController = Pick<Test2MapLibreMainAdapter,
  | 'map'
  | 'groupStates'
  | 'isLayerLoaded'
  | 'loadLayer'
  | 'unloadLayer'
  | 'showLayer'
  | 'hideLayer'
  | 'resolveLayer'
  | 'getLayerState'
  | 'applyElectionStyle'
  | 'clearElectionStyle'
  | 'setElectionHatch'
  | 'fitToLayer'
  | 'invalidateSize'> & {
  /** No controller has it today; the overlays' hover asks for it, defensively. */
  setMapCursor?(cursor: string): void;
};

/** One way of drawing an election: another map its results are matched to (a bundle's `geographyModes`). */
export interface ElectionGeographyMode {
  id: string;
  label?: string;
  sourceMapId?: string;
  layerId?: string;
  labelProperty?: string;
  geometryType?: string;
  /** The styling modes this geography offers (else the election's), and the one it opens with. */
  stylingModes?: string[];
  defaultMode?: string;
  /** 'area-results': a national contest's results by area, on a map of their own. */
  dataKind?: string;
  results?: BundleResult[];
  /** Where the area results come from, cited under the table. */
  references?: Array<{ url?: string; label?: string; note?: string }>;
  [field: string]: unknown;
}

/**
 * An election as the manager holds it: a catalogue entry (the election manifest's) or its loaded
 * results bundle, which repeats the entry's fields and adds its results. ElectionRecord with the
 * fields the manager reads by name, typed by what the build writes.
 */
export interface ElectionEntry extends ElectionRecord {
  key: string;
  body: string;
  date: string;
  bodySlug?: string;
  /**
   * The boundary map. A grouped year's level with no map sets these three null
   * (ni-local-view.js syncManagerEntry); they are read only for truthiness there.
   */
  sourceMapId?: string;
  layerId?: string;
  labelProperty?: string;
  geometryType?: string;
  councilSourceMapId?: string;
  councilLayerId?: string;
  councilLabelProperty?: string;
  councilGeometryType?: string;
  results?: BundleResult[];
  /** The election-wide totals as the source states them (seats, valid and total poll, electorate, spoiled). */
  mainLikeTotals?: MainLikeTotals | null;
  geographyModes?: ElectionGeographyMode[];
  stylingModes?: string[];
  loadable?: boolean;
  resultsOnly?: boolean;
  resultUrl?: string;
  previousKey?: string;
  isByElection?: boolean;
  niLocalGroup?: unknown;
  constituencies?: string[];
  /** A local election's councils (one entry each). */
  localBodies?: unknown[];
  displaySubtitle?: string;
  displayProvider?: string;
}

/** The election catalogue (the manifest, ELECTION_MANIFEST_URL), with its grouped years added. */
export interface ElectionCatalogue {
  elections: ElectionEntry[];
  [field: string]: unknown;
}

/** The layer an election is drawn on, as the styling reads it: the renderer's layer, the bundle, or a geography mode's map. */
export interface ElectionStyleLayer {
  id?: string;
  sourceMapId?: string;
  labelProperty?: string | null;
  geometryType?: string;
}

/** A feature the app asks the manager about (enrichFeature): the renderer's, with the map it is on. */
export interface ElectionFeature {
  id?: string | number | null;
  mapId?: string;
  featureName?: string;
  name?: string;
  properties?: Record<string, unknown> | null;
  /** The result enrichFeature matched it to. */
  electionResult?: BundleResult;
  [field: string]: unknown;
}

/** A recall petition's figures (a result's `recallPetition`). */
export interface RecallPetitionFigures {
  triggered?: unknown;
  signed?: unknown;
  signatures?: unknown;
  threshold?: unknown;
  required?: unknown;
  [field: string]: unknown;
}

/** A contest's count rows as the animation runtime takes them (a result's `animationPayload`). */
export interface AnimationPayload {
  Constituency?: { countGroup?: Array<Record<string, unknown>>; countInfo?: Record<string, unknown>; [field: string]: unknown };
  [field: string]: unknown;
}

/**
 * One contest's result as a bundle holds it (ElectionResult) with the fields the manager reads by
 * name: the names its features may carry, the count rows of its animation, and a petition's figures.
 */
export interface BundleResult extends ElectionResult {
  featureAliases?: string[];
  featureNames?: string[];
  featureMatches?: Array<{ name?: string; aliases?: string[] } | null>;
  animationPayload?: AnimationPayload | null;
  recallPetition?: RecallPetitionFigures | null;
  /** 'council' or 'district': a council's results drawn as one (buildCouncilAggregateResult). */
  aggregateType?: string;
  /** Where the overlay draws the contest's seats: a centre, the area's bounds and its size. */
  anchor?: { center?: [number, number]; bounds?: GeoBounds | null; area?: unknown } | null;
  /** An STV count's non-transferable papers, by count. */
  nonTransferable?: Array<{ [field: string]: unknown }>;
  /** A contest with no area of its own on the map (a university seat): its seats are labelled. */
  syntheticNonGeographic?: boolean;
}

/** Bounds in degrees. */
export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The jQuery shim's `$` as the manager uses it, with what the classic viewer scripts add to it. */
export type ViewerJQuery = ((element: Element) => { data?: (key: string) => unknown } | undefined) & {
  preloadElectionData?: (payload: unknown) => void;
  clearPreloadedData?: () => void;
};

declare global {
  /** The animation runtime's files by served path, each with its content hash (scripts/build/app-bundle.mjs defines it). */
  const __VIEWER_ASSET_VERSIONS__: Record<string, string>;
  /**
   * The site's number formatter and the viewer colours, which the classic viewer scripts
   * (site/app/election-viewer-package/) cannot import: ensureElectionAnimationRuntime hands them over.
   */
  var civgraphFormat: { siteNumber: typeof import('../../../core/src/format.js').siteNumber } | undefined;
  var civgraphViewerColours: unknown;
  interface Window {
    /** The jQuery shim (site/app/js/jquery-shim.js), loaded with the animation runtime. */
    $?: ViewerJQuery;
    /** The classic viewer's count animation (election-viewer-package/js/stages2.js). */
    animateStages?: (options: { date?: string; electedBody?: string; constituency?: string; maxWidth?: number }) => void;
  }
}

/** A row of an entity page's table: a party's candidate, or a candidate's contest. */
export interface EntityPageRow {
  name?: string;
  constituency?: string;
  status?: string;
  [field: string]: unknown;
}

/**
 * A party or a candidate as its page shows it: an entry of the bundle's entity index (lists),
 * or of one built from the results (buildEntityIndex, whose constituencies are a Set: no length,
 * so the page shows 0, as before).
 */
export interface EntityPageEntity {
  name?: string;
  party?: string;
  colour?: string;
  constituencies?: { length?: number };
  candidates?: EntityPageRow[];
  appearances?: EntityPageRow[];
  [field: string]: unknown;
}

/** An election's or a contest's totals as its source states them (a bundle's `mainLikeTotals`). */
export interface MainLikeTotals {
  totalSeats?: unknown;
  validPoll?: unknown;
  totalPoll?: unknown;
  totalElectorate?: unknown;
  totalSpoiled?: unknown;
  [field: string]: unknown;
}
