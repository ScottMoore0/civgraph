// The modules app.js imported before the split into src/map/app/, in the same order, so they are
// evaluated in the same order as before; those whose names moved to the method modules are
// imported for that order alone.
import dataService from '../../src/data-service.js';
import { prefetchCatalogueData } from '../../src/catalogue/flag.js';
import '../../src/date-format.mjs';
import '../../src/feature-loader.js';
import uiController from '../../src/ui-controller.js';
import '../../src/public-map.mjs';
import '../../src/map-relations.mjs';
import '../../src/storage-keys.mjs';
import { TestMetadataService } from '../../render/src/metadata-service.js';
import '../../src/party-names.mjs';
import '../../src/entity-detail-data.mjs';
import { Test2MapLibreMainAdapter } from './maplibre-main-adapter.js';
import '../../src/map/app/layer-order.mjs';
import '../../src/map/app/url-compat.mjs';
import { escapeHtml } from '../../src/map/app/helpers.mjs';
import { installMethods } from '../../src/map/app/install-methods.mjs';
import { LayerMethods } from '../../src/map/app/layers.js';
import { UrlStateMethods } from '../../src/map/app/url-state.js';
import { UiWiringMethods } from '../../src/map/app/ui-wiring.js';
import { LazyRuntimeMethods } from '../../src/map/app/lazy-runtime.js';
import { ElectionPaneMethods } from '../../src/map/app/election-pane.js';
import { EntityBridgeMethods } from '../../src/map/app/entity-bridge.js';
import { CatalogueListMethods } from '../../src/map/app/catalogue-list.js';
import { SearchMethods } from '../../src/map/app/search.js';
import { TimelineControlMethods } from '../../src/map/app/timeline/controls.js';
import { TimelineAnimationMethods } from '../../src/map/app/timeline/animation.js';
import { TimelineChangeMethods } from '../../src/map/app/timeline/changes.js';
import { SourcePanelMethods } from '../../src/map/app/sources.js';
import { LegendMethods } from '../../src/map/app/legend.js';
import { MapControlMethods } from '../../src/map/app/controls.js';
import { MobileLayoutMethods } from '../../src/map/app/mobile-layout.js';
import { SiteChromeMethods } from '../../src/map/app/site-chrome.js';
import { PerformanceMethods } from '../../src/map/app/performance.js';
import { MessageMethods } from '../../src/map/app/messages.js';

/**
 * The map app at civgraph.net/maps/: Test2App owns the app state (the constructor) and the start-up
 * (init). Everything else is in modules under src/map/app/, one concern each, whose methods are
 * installed on Test2App.prototype below, so `this.updateURLState()` and the rest work as before.
 */
class Test2App {
  constructor() {
    this.currentCategory = 'all';
    this.currentAuthor = 'all';
    this.currentProviderCategory = 'all-providers';
    this.currentProviderList = [];
    this.searchQuery = '';
    this.mapController = null;
    this.metadataService = null;
    this._suspendURLState = false;
    this._restoringURLState = false;
    this.currentDetailMapId = null;
    // The party, person, constituency or feature page open in the catalogue pane, if any:
    // { kind, key, title, typeLabel }. In the address as page=kind:key (updateURLState).
    this.currentPage = null;
    this.currentSourceMapId = null;
    this.baseMapId = 'osm-standard';
    // T1-06: set once the user picks a basemap deliberately; from then on the
    // theme toggle stops changing it. Persisted so the choice survives a reload.
    this.userPickedBasemap = (() => {
      try { return localStorage.getItem('basemapUserChoice') === '1'; } catch { return false; }
    })();
    this.elections = null;
    this.timelineItems = [];
    this.timelineOnSelect = null;
    this.timelineApplying = false;
    this.timelineApplyDepth = 0;
    this.timelineChangeIndex = null;
    this.timelineChangeCache = new Map();
    this.timelineChangeView = null;
    this.editionRoles = new Map();
    this.timelineAnimation = {
      playing: false,
      paused: false,
      atEnd: false,
      timer: 0,
      runId: 0,
      originalLayerId: null,
      currentIndex: 0,
      singleLayerReferenceId: null,
      sequenceItems: []
    };
    this.booksPromise = null;
    this.electionModulePromise = null;
    this.electionLoadPromise = null;
    this.electionCatalogueWarmScheduled = false;
    this.searchWorker = null;
    this.searchWorkerReady = false;
    this.searchWorkerSeq = 0;
    this.searchWorkerCallbacks = new Map();
    this.workerSearchQuery = '';
    this.workerSearchResultIds = null;
    this.serviceWorkerStatusPromise = null;
    this.performanceBudget = null;
    this.browseEntityDetailCache = new Map();
    this.classicScriptPromises = new Map();
  }

  async init() {
    const runtimeInitStartedAt = performance?.now?.() || Date.now();
    window.__civgraphTest2 = {
      ...(window.__civgraphTest2 || {}),
      app: this,
      runtimeInitStartedAt
    };
    this.installRouteGuard();
    this.registerServiceWorker();
    // The catalogue pane's data and code, started now so they arrive alongside the map index
    // rather than after it (src/catalogue/flag.js).
    if (prefetchCatalogueData()) import('../../src/catalogue/index.js').catch(() => {});

    // The startup index from D1 (data design phase 3; it was the static
    // render/metadata/maps-test-index.json, which now answers 301 here). The answer
    // carries an ETag of the dataset version and must-revalidate, so a publish is seen
    // on the next load and an unchanged index costs a 304: no content-hash token needed.
    // A layer id from a link is tried in its other spelling when it is not in the index
    // (src/map/app/url-compat.mjs resolveLegacyLayerId).
    this.isKnownLayerId = (id) => Boolean(this.metadataService?.getLayer(id));
    this.metadataService = new TestMetadataService('/_api/layers?view=index', undefined, {
      cache: 'default',
      portPlanCache: 'default'
    });
    // The three are independent, so they load side by side: one after another, the catalogue
    // waited for the map list (/_api/catalogue), then the transition manifest, then the 3.9 MB
    // map index and its port plan before it could draw (UX review 2026-10-31, L10).
    // The port plan (2.2 MB) is fetched with the index rather than after it is parsed.
    const portPlan = this.metadataService.loadPortPlan();
    this.metadataService.loadPortPlan = () => portPlan;
    await Promise.all([
      dataService.init({ loadBooks: false, loadGeographies: false }).then(() => { dataService.fuse = null; }),
      this.loadTimelineChangeIndex(),
      this.metadataService.load()
    ]);

    // The catalogue (ui-controller) reads from dataService (data/database/maps.json),
    // which doesn't include the test-only 3D/LiDAR layers — so their catalogue cards
    // (LiDAR Point Clouds / NI LiDAR Elevation Models) render empty. Inject those
    // layers into dataService so getMapById resolves them and the cards populate.
    try {
      if (dataService.maps && Array.isArray(dataService.maps.maps)) {
        const existingIds = new Set(dataService.maps.maps.map((m) => m.id));
        for (const layer of this.metadataService.layers || []) {
          if ((layer.sourceType === 'point-cloud' || layer.sourceType === 'raster-dem') && !existingIds.has(layer.id)) {
            dataService.maps.maps.push(layer);
          }
        }
      }
    } catch (e) { console.warn('[app] 3D layer catalogue injection failed', e); }

    this.mapController = new Test2MapLibreMainAdapter('map', this.metadataService, {
      onFeatureClick: (features) => {
        const feature = features?.[0] || null;
        if (feature && this.elections?.showFeatureResults(feature)) {
          uiController.hideFeatureInfo?.();
          return;
        }
        uiController.showFeatureInfo(features, dataService.getAllMaps());
        this.addFeaturesHereList(feature);
      },
      getMainMap: (mapId) => dataService.getMapById(mapId),
      onTimelineChangeClick: (changeKey) => this.zoomToTimelineChange(changeKey),
      // A census statistic (data/database/data-entries.json), drawn on its geography's tiles.
      getDataEntry: (mapId) => (dataService.maps?.dataEntries || []).find((entry) => entry.id === mapId) || null,
      enrichFeature: (feature, selection) => this.elections?.enrichFeature(feature, selection) || feature,
      onChange: () => {
        this.syncCatalogueMapState();
        this.updateActiveLayers();
        this.updateURLState();
      },
      onError: (error) => this.showMapError(error)
    });
    window.mapController = this.mapController;
    globalThis.mapController = this.mapController;

    this.wireUiCallbacks();
    this.installCatalogueStateBridge();
    this.installLazyCatalogueDataBridge();
    this.installLazyRuntimeHelpersBridge();
    uiController.init();
    this.configureCataloguePerformanceProfile();

    this._suspendURLState = true;
    this.mapController.init('map');
    // Layers are added only once the style has loaded. The controller's own wait gave up after
    // 3 s and added them anyway, which threw "Style is not done loading" and dropped them --
    // in a background tab or hidden pane always, because MapLibre parses even an inline style
    // on an animation frame, and such a page gets none until it is shown.
    this.mapController.waitForMap = () => this.whenStyleLoaded();
    this.installOutsideMapHighlightClear();
    this.relocateMobileCatalogueToggle();
    this.installMobilePaneToggle();
    window.__civgraphTest2 = {
      ...(window.__civgraphTest2 || {}),
      app: this,
      mapController: this.mapController,
      metadataService: this.metadataService,
      elections: null,
      restorePromise: null,
      runtimeReadyAt: performance?.now?.() || Date.now(),
      serviceWorkerStatusPromise: this.serviceWorkerStatusPromise,
      getPerformanceStatus: () => this.collectPerformanceStatus(),

      // `timeline` is attached later, by setupTimelineControls, because the
      // apply path it exposes is defined there.

      /**
       * Resolve once the map has gone idle — no pending tiles, no transitions.
       * Browser tests for timeline races need a real completion signal; a
       * setTimeout is a guess that passes on a fast machine and flakes on a
       * loaded one, which is worse than no test.
       */
      whenIdle: (timeoutMs = 15000) => new Promise((resolve) => {
        const map = this.mapController?.map;
        if (!map) { resolve({ idle: false, reason: 'no map' }); return; }
        if (map.loaded?.() && !map.isMoving?.()) { resolve({ idle: true, immediate: true }); return; }
        let settled = false;
        const done = (payload) => { if (!settled) { settled = true; map.off?.('idle', onIdle); resolve(payload); } };
        const onIdle = () => done({ idle: true, immediate: false });
        map.once?.('idle', onIdle);
        setTimeout(() => done({ idle: false, reason: 'timeout' }), timeoutMs);
      }),

      /** The URL state the app would write right now, without writing it. */
      urlState: () => ({
        hash: window.location.hash,
        suspended: this._suspendURLState,
      }),
    };
    this.scheduleIdleTask(() => this.prepareSearchWorker(), { timeout: 3500 });
    this.renderCategoryPills();
    this.updateMapList();
    this.setupSearch();
    this.setupThemeToggle();
    this.setupSupportModal();
    this.setupMapControls();
    this.setupOverlayEscape();
    this.setupPerformanceDashboard();
    this.setupTimelineControls();
    this.setupElectionPaneResize();
    this.setupSourcePanel();
    this.setupURLStateListener();
    this.scheduleElectionCatalogueWarm();
    // The catalogue above is drawn now; the address's layers wait for the map's style (and
    // the address is left alone until they are back).
    window.__civgraphTest2.restorePromise = this.whenStyleLoaded()
      .then(() => this.restoreURLState())
      .catch((error) => this.showMapError(error))
      .finally(() => {
        this._suspendURLState = false;
        this.updateURLState();
      });
    await window.__civgraphTest2.restorePromise;
    this.showFirstVisitHint();
  }

  /**
   * Resolves once the map's style has loaded, so sources and layers can be added: at once if it
   * has, else on its 'style.load' (checked every quarter second too, in case the event was
   * missed). Never on a timer alone: adding a layer to a style still loading throws and the
   * layer is lost.
   */
  whenStyleLoaded() {
    const map = this.mapController?.map;
    if (!map) return Promise.resolve();
    const ready = () => Boolean(map.style?._loaded) || Boolean(map.isStyleLoaded?.());
    if (ready()) return Promise.resolve();
    if (!this._styleLoadedPromise) {
      this._styleLoadedPromise = new Promise((resolve) => {
        let timer = 0;
        const check = () => {
          if (!ready()) return;
          map.off('style.load', check);
          map.off('styledata', check);
          clearInterval(timer);
          this._styleLoadedPromise = null;
          resolve();
        };
        map.on('style.load', check);
        map.on('styledata', check);
        timer = setInterval(check, 250);
      });
    }
    return this._styleLoadedPromise;
  }
}

// The methods live in the modules under src/map/app/, one concern each; installMethods puts
// them on Test2App.prototype exactly as if they were written in this class.
installMethods(Test2App, [
  LayerMethods,
  UrlStateMethods,
  UiWiringMethods,
  LazyRuntimeMethods,
  ElectionPaneMethods,
  EntityBridgeMethods,
  CatalogueListMethods,
  SearchMethods,
  TimelineControlMethods,
  TimelineAnimationMethods,
  TimelineChangeMethods,
  SourcePanelMethods,
  LegendMethods,
  MapControlMethods,
  MobileLayoutMethods,
  SiteChromeMethods,
  PerformanceMethods,
  MessageMethods
]);

const app = new Test2App();
app.init().catch((error) => {
  console.error('[Test2] Failed to start', error);
  const target = document.getElementById('map') || document.body;
  target.insertAdjacentHTML('beforeend', `<div class="map-error">Failed to start Civgraph: ${escapeHtml(error.message)}</div>`);
});
