/**
 * The map app as its method modules see it: `this` in packages/map/src/app/*.js. Test2App
 * (packages/map/app/app.js) is one class written as several modules; installMethods puts each
 * module's methods on its prototype, so inside a method `this` is the app. A method module that
 * joins the type check (packages/map/tsconfig.check.json) types `this` as `MapApp & <its own
 * methods class>`, per method (`@this`), and reads the rest of the app only through this interface.
 *
 * Declarations only, nothing at run time. Each member is one a checked module uses, typed by what
 * it is in the app: a field set in Test2App's constructor, or a method of another method module.
 * tests/unit/map-app-host.test.mjs holds every member to the app: a field must be assigned in the
 * constructor, a method defined by app.js or a method module. Members join as modules do.
 */
import type { CensusLegend, LegendModel } from './legend-view.mjs';
import type { TimelineChangeView } from './timeline/timeline-view.mjs';
import type { TimelineAnimationState, TimelineItem as PlaybackItem } from './timeline/playback.mjs';

/** A stop on the timeline: an edition (its map) or an election (packages/map/src/app/timeline/controls.js). */
export interface TimelineItem extends PlaybackItem {
  mapId?: string | null;
  date?: unknown;
  timestamp?: unknown;
  label?: unknown;
  displayLabel?: string;
  minor?: boolean;
  [key: string]: unknown;
}

/** One pair of the boundary-change index (data/timeline-changes/index.json `pairs`). */
export interface TimelineChangeIndexEntry {
  path?: string;
  kind?: string;
  count?: number;
  text?: string;
}

/** One change of a pair file (data/timeline-changes/<pair>.json `changes`). */
export interface TimelineChange {
  id?: string;
  type?: string;
  from?: string;
  to?: string;
  ha?: number;
  point?: unknown;
  bbox?: unknown;
  [key: string]: unknown;
}

/** A pair file of data/timeline-changes/: its changes and their GeoJSON features. */
export interface TimelineChangeFile {
  changes?: TimelineChange[];
  features?: Array<{ properties?: Record<string, unknown> | null; [key: string]: unknown }>;
}

/** The changes between the edition shown before and the one shown now (changes.js buildTimelineChangeView). */
export interface TimelineChangeState extends TimelineChangeView {
  key: string;
  kind: 'changes' | 'none' | 'redrawn' | 'unknown';
  count: number;
  parts: Array<{ label: string; kind: string; count: number; text: string }>;
  changes: Array<TimelineChange & { key: string; step: string; text: string }>;
  features: Array<{ properties?: Record<string, unknown> | null; [key: string]: unknown }>;
  fromMapId: string | null;
  toMapId: string | null;
  note: string;
  drawn: boolean;
}

/** One timing the map controller keeps (getMetrics). */
export interface MapMetric {
  event?: string;
  [key: string]: unknown;
}

/** The main map's adapter (packages/map/app/maplibre-main-adapter.js). */
type MainAdapter = import('../../app/maplibre-main-adapter.js').Test2MapLibreMainAdapter;
/** The election manager with its installed methods (packages/map/src/election/election-manager.d.ts). */
type ElectionManager = import('../election/election-manager').ElectionManager;

/**
 * What the method modules use of the main map controller (packages/map/app/maplibre-main-adapter.js):
 * the adapter's own members, typed as the adapter types them, and below them the dashboard's reads.
 */
export interface MapControllerView extends Pick<MainAdapter,
  | 'addAddressMarker'
  | 'applyElectionStyle'
  | 'clearElectionStyle'
  | 'clearTimelineChanges'
  | 'clearTransientHighlight'
  | 'featuresAtLastClick'
  | 'findRenderedFeature'
  | 'fitToBounds'
  | 'fitToLayer'
  | 'fitToLayers'
  | 'getCensusOverlayLegend'
  | 'getLayerDrawOrder'
  | 'getLayerLoadFailure'
  | 'getLayerState'
  | 'getLoadedFeatures'
  | 'getPartialFeatureItems'
  | 'getPartialFeatureNames'
  | 'getTimelineChangesState'
  | 'getVisibleLayers'
  | 'groupStates'
  | 'hideLayer'
  | 'highlightFeature'
  | 'invalidateSize'
  | 'isFeatureLoaded'
  | 'isFeatureVisible'
  | 'isLayerLoaded'
  | 'isLayerVisible'
  | 'isPartialLayer'
  | 'layerStates'
  | 'loadLayer'
  | 'loadSingleFeature'
  | 'mainToTest'
  | 'markGroupLoaded'
  | 'queryFeaturesAtLngLat'
  | 'removeAddressMarker'
  | 'resolveLayer'
  | 'selectFeatureAtClick'
  | 'setBaseMap'
  | 'setEditionRole'
  | 'setElectionHatch'
  | 'setFillTransparency'
  | 'setLabelsEnabled'
  | 'setLayerDrawOrder'
  | 'setTextScale'
  | 'setTimelineChanges'
  | 'setTransparency'
  | 'showLayer'
  | 'toggleLayer'
  | 'togglePartialFeature'
  | 'unloadLayer'
  | 'unloadPartialFeature'
  | 'waitForMapRender'
  | 'waitUntilSettled'> {
  /** The MapLibre map (made by init). */
  map: MainAdapter['map'];
  /** The renderer under the adapter (made by init). */
  renderer: MainAdapter['renderer'];
  // The performance dashboard (performance.js) also asks for these, defensively; the adapter has
  // none of them today, so the dashboard reports no metrics, no loaded layers and no runtime class.
  layers?: Map<string, unknown>;
  metrics?: MapMetric[];
  runtimeProfile?: { deviceClass?: string } | null;
  getMetrics?(): MapMetric[];
  /** Set by the app's init (app.js): the adapter's wait for the style, as the app's whenStyleLoaded. */
  waitForMap?(): Promise<void>;
}

/**
 * A loaded layer's or group's state (the adapter's getLayerState): a layer's has no isGroup or
 * childIds, which read undefined.
 */
export type LayerOrGroupState = import('../../app/maplibre-main-adapter.js').GroupState
  | (import('../../app/maplibre-main-adapter.js').MainLayerState & { isGroup?: undefined; childIds?: undefined });

/** What the method modules use of the election manager (packages/map/app/election-manager.js), typed as the manager types it. */
export interface ElectionsView extends Pick<ElectionManager,
  | 'activeBundle'
  | 'activeEntry'
  | 'buildCatalogueCards'
  | 'cancelPendingLoad'
  | 'catalogue'
  | 'enrichFeature'
  | 'findEntry'
  | 'findEntryByCanonicalLayerId'
  | 'findResultByKey'
  | 'getActiveElectionBackingLayerIds'
  | 'getActiveElectionStyleSourceMapId'
  | 'getCanonicalLayerId'
  | 'getSeatCircleOverlayState'
  | 'getURLState'
  | 'isCanonicalElectionLayerId'
  | 'isElectionLoaded'
  | 'lastSeatCircleRenderMs'
  | 'legendModel'
  | 'load'
  | 'loadBundle'
  | 'loadElection'
  | 'loadRun'
  | 'pendingLoad'
  | 'renderPanel'
  | 'restoreURLState'
  | 'setPaneCollapsed'
  | 'showFeatureResults'
  | 'unloadElection'
  | 'updateElectionTimeline'> {
}

export interface MapApp {
  // Fields (Test2App's constructor).
  /** Aborted by dispose(): listeners on document and window pass its signal. */
  lifecycle: AbortController;
  mapController: MapControllerView | null;
  elections: ElectionsView | null;
  /** map id -> 'older' or 'newer', for two editions of one series on the map (updateEditionRoles). */
  editionRoles: Map<string, string>;
  /** The boundary-change index's pairs, by "<from map>__<to map>" (timeline/changes.js); null until loaded. */
  timelineChangeIndex: Record<string, TimelineChangeIndexEntry> | null;
  /** Pair files fetched, by URL (timeline/changes.js). */
  timelineChangeCache: Map<string, Promise<TimelineChangeFile | null>>;
  /** The changes the timeline's button describes (timeline/changes.js). */
  timelineChangeView: TimelineChangeState | null;
  /** The Play button's machine and the run's bookkeeping (timeline/playback.mjs). */
  timelineAnimation: TimelineAnimationState;
  /** A layer swap is under way (timeline/controls.js beginTimelineApply): updateTimeline waits. */
  timelineApplying: boolean;
  /** The count of layer swaps under way (timeline/controls.js). */
  timelineApply: ReturnType<typeof import('../state-helpers.mjs').createHoldCount>;
  /** The slider's stops (timeline/controls.js setupTimeline). */
  timelineItems: TimelineItem[];
  /** What a stop chosen on the slider does; null while no timeline is shown. */
  timelineOnSelect: ((...args: never[]) => unknown) | null;
  /** The classic scripts asked for, by URL (lazy-runtime.js loadClassicScript). */
  classicScriptPromises: Map<string, Promise<unknown>>;
  /** The layer index (/_api/layers?view=index), made once the app starts. */
  metadataService: import('../renderer/metadata-service.js').TestMetadataService | null;
  /** The legacy catalogue list's filters (catalogue-list.js) and the search's query. */
  currentCategory: string;
  /** 'all', or the authors the filter keeps (ui-wiring.js onAuthorFilter). */
  currentAuthor: string | string[];
  currentProviderCategory: string;
  currentProviderList: string[];
  searchQuery: string;
  /** The entity page shown, if one is (entity-bridge.js). */
  currentPage: { kind?: string; key?: string; title?: string; typeLabel?: string } | null;
  /** The catalogue's search worker (search.js) and its answers by request number. */
  searchWorker: Worker | null;
  searchWorkerReady: ReturnType<typeof import('../state-helpers.mjs').createFlag>;
  searchWorkerSeq: number;
  searchWorkerCallbacks: Map<number, { resolve(ids: string[]): void }>;
  workerSearchQuery: string;
  workerSearchResultIds: string[] | null;
  /** The address held still while something else changes the map (url-sync.mjs createUrlSuspend). */
  urlSuspend: ReturnType<typeof import('./url-sync.mjs').createUrlSuspend>;
  /** Restoring the map from the address: idle, restoring or queued (url-sync.mjs createUrlRestore). */
  urlRestore: ReturnType<typeof import('./url-sync.mjs').createUrlRestore>;
  /** The next address write as a history entry (beginNavigation; url-sync.mjs createNavigationPush). */
  navigationPush: ReturnType<typeof import('./url-sync.mjs').createNavigationPush>;
  /** The hashchanges to ignore while a failed step is stepped back over (url-sync.mjs createHashListen). */
  hashListen: ReturnType<typeof import('./url-sync.mjs').createHashListen>;
  /** The address a Back or Forward step arrived at (url-sync.mjs createTraversal). */
  traversal: ReturnType<typeof import('./url-sync.mjs').createTraversal>;
  /** The map whose details the catalogue pane shows, if it shows one. */
  currentDetailMapId: string | null;
  /** The layer the source panel shows (sources.js), if it is open. */
  currentSourceMapId: string | null;
  /** The base map shown (controls.js applyBaseMap). */
  baseMapId: string;
  /** The reader chose the base map (controls.js applyBaseMap): the theme leaves it alone. */
  userPickedBasemap: boolean;
  /** The election manager's module, imported on demand (election-pane.js ensureElections). */
  electionModulePromise: Promise<typeof import('../../app/election-manager.js')> | null;
  /** The election catalogue's load (election-pane.js ensureElections). */
  electionLoadPromise: Promise<unknown> | null;
  /** Party, person and area pages built from the Browse records, by "<kind>:<key>" (entity-bridge.js). */
  browseEntityDetailCache: Map<string, import('./entity-bridge.js').EntityPage | null>;

  // Methods of other method modules.
  /** layers.js */
  getLoadedLayerIds(): string[];
  /** layers.js */
  isMapVisible(mapId: string): boolean;
  /** layers.js */
  isMapLoaded(mapId: string): boolean;
  /** layers.js */
  loadMap(mapId: string, options?: { fit?: boolean }): Promise<unknown>;
  /** layers.js */
  unloadMap(mapId: string, options?: { preserveTimelineAnimation?: boolean }): Promise<unknown>;
  /** layers.js */
  syncCatalogueMapState(): void;
  /** layers.js */
  updateActiveLayers(): void;
  /** url-state.js */
  updateURLState(): void;
  /** messages.js */
  showMapError(error: unknown, options?: { kind?: string; retry?: () => unknown; retryLabel?: string }): void;
  /** timeline/controls.js */
  isTimelineMapPlayable(mapId: string): boolean;
  /** timeline/controls.js */
  beginTimelineApply(): void;
  /** timeline/controls.js */
  endTimelineApply(): boolean;
  /** timeline/controls.js */
  clampTimelineIndex(index: number, items?: TimelineItem[]): number;
  /** timeline/controls.js */
  getTimelineRangeIndex(): number;
  /** timeline/controls.js */
  setTimelineRangeIndex(index: number): void;
  /** timeline/controls.js */
  updateTimeline(): void;
  /** timeline/controls.js */
  applyTimelineTimestamp(timestamp: unknown, options?: { fit?: boolean }): Promise<unknown>;
  /** layers.js */
  getConvertedCompositeChildIds(mapConfig: unknown): string[];
  /** timeline/animation.js */
  pauseTimelineAnimation(options?: { preserveOverlay?: boolean }): void;
  /** timeline/animation.js */
  startTimelineAnimation(): Promise<void>;
  /** timeline/animation.js */
  stopTimelineAnimation(options?: { restoreOriginal?: boolean }): Promise<void>;
  /** timeline/animation.js */
  clearTimelineAnimationTimer(): void;
  /** timeline/animation.js */
  updateTimelineAnimationButtons(): void;
  /** timeline/changes.js */
  toggleTimelineChangesPanel(): void;
  /** timeline/changes.js */
  closeTimelineChangesPanel(options?: { focusButton?: boolean }): void;
  /** timeline/changes.js */
  renderTimelineChangesControl(): void;
  /** timeline/changes.js */
  syncTimelineChangesToShownEdition(): void;
  /** timeline/changes.js */
  setTimelineHighlightEnabled(value: unknown): void;
  /** timeline/changes.js */
  getShownTimelineIndex(items?: TimelineItem[]): number;
  /** timeline/changes.js */
  getTimelineHighlightEnabled(): boolean;
  /** timeline/changes.js */
  setTimelineChangeView(view: TimelineChangeState | null): void;
  /** timeline/changes.js */
  showTimelineStepChanges(fromIndex: number, toIndex: number, items?: TimelineItem[], options?: { draw?: boolean }): Promise<TimelineChangeState | null>;
  /** timeline/animation.js */
  getTimelineAnimationItems(): TimelineItem[];
  /** timeline/controls.js */
  formatTimelineItemLabel(item: TimelineItem | null | undefined): string;
  /** messages.js */
  mapLabel(mapId: string): string;
  /** messages.js */
  exportMapImage(mapId: string, format?: string, options?: { trigger?: HTMLElement }): Promise<unknown>;
  /** mobile-layout.js */
  isPhoneLayout(): boolean;
  searchMapsForCatalogue<T extends { id: string }>(query: string, allMaps: T[]): T[];
  updateMapList(): void;
  /** controls.js */
  syncBasemapToTheme(): Promise<unknown>;
  /** controls.js */
  applyBaseMap(baseMapId: string, options?: { userChoice?: boolean }): Promise<void>;
  /** controls.js */
  setMapControlsOpen(open: boolean, options?: { focus?: boolean }): void;
  /** controls.js */
  setActiveLayersPanelOpen(open: boolean, options?: { focus?: boolean }): void;
  /** app.js */
  whenStyleLoaded(): Promise<void>;
  /** url-state.js */
  beginNavigation(label?: string): void;
  /** url-state.js */
  endNavigation(): void;
  /** url-state.js */
  undoNavigationSince(mark: number | undefined): void;
  /** url-state.js */
  getCurrentURLParams(): URLSearchParams;
  /** url-state.js */
  pushURLState(label?: string): void;
  /** timeline/controls.js */
  setTimelineItems<T extends object>(items: T[], activeIndex: number, onSelect: (item: T) => unknown, options?: Record<string, unknown>): void;
  /** timeline/controls.js */
  getTimelineGeneralsOnly(fallback?: boolean): boolean;
  /** url-state.js */
  resolveFeatureBounds(mapConfig: { id?: string; featureIndexUrl?: string } | null | undefined, featureId: string | number, featureName: string | null | undefined, layerConfig?: { featureIndexUrl?: string } | null): Promise<import('./feature-bounds.mjs').BBox | null>;
  /** layers.js */
  getActiveLayerOrder(loadedIds?: string[]): string[];
  /** layers.js */
  setActiveLayerOrder(order: string[], options?: { persist?: boolean; notify?: boolean } | null): string[];
  /** layers.js */
  restoreLayerOrder(params: URLSearchParams): void;
  /** layers.js */
  waitForMapOutcome(mapId: string): Promise<import('../../app/settle.js').SettleOutcome | 'failed'>;
  /** layers.js */
  reportMapLoadFailure(mapId: string, error: unknown): void;
  /** layers.js */
  unloadMapNow(mapId: string): void;
  /** layers.js */
  getMapUnloadCandidateIds(mapId: string): Set<string>;
  /** layers.js */
  recordSettleOutcome<T extends string>(mapId: string, outcome: T): T;
  /** election-pane.js */
  ensureElections(options?: { refreshCatalogue?: boolean }): Promise<ElectionsView>;
  /** election-pane.js */
  scheduleElectionCatalogueWarm(): void;
  /** election-pane.js */
  hasElectionURLState(params: URLSearchParams, layers?: Iterable<string>): boolean;
  /** election-pane.js */
  unloadActiveElectionForLayer(mapId: string): boolean;
  /** entity-bridge.js */
  openElectionEntityDetailInCatalogue(kind: string | undefined, key: string | undefined, options?: { label?: string; fromHistory?: boolean; focus?: boolean }): Promise<boolean>;
  /** sources.js */
  bindActiveLayerSourceButtons(): void;
  /** sources.js */
  renderSourcePanel(): Promise<void>;
  /** messages.js */
  announce(message: string): void;
  /** messages.js */
  hideMapError(): void;
  /** messages.js */
  dismissStaleMapMessage(minAgeMs?: number): void;
  /** messages.js */
  triggerDownload(url: string, filename?: string): void;
  /** mobile-layout.js */
  dismissMobileCatalogueAfterLoad(label?: string): void;
  /** mobile-layout.js */
  revealCatalogueOnPhone(): void;
  /** lazy-runtime.js */
  scheduleIdleTask(callback: () => void, options?: { timeout?: number }): void;
  /** catalogue-list.js */
  focusActiveElectionCatalogueEntry(entry: { body?: string; date?: string } | null | undefined, options?: { scroll?: boolean }): void;
  /** timeline/animation.js */
  isTimelineAnimationLayer(mapId: string | null | undefined): boolean;
  /** timeline/changes.js */
  updateEditionRoles(): void;
  /** legend.js */
  updateMapLegend(): void;
}

/**
 * The app once init has made the map controller (app.js init, before it wires the catalogue and
 * restores the address). A method module whose methods run only after that, and use the
 * controller without asking whether it is there, types `this` with this in place of MapApp.
 */
export interface MapAppReady extends MapApp {
  mapController: MapControllerView;
}
