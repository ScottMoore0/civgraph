import dataService, { resolveMapDownloadUrl } from '../../src/data-service.js';
import { prefetchCatalogueData } from '../../src/catalogue/flag.js';
import { formatDisplayDate } from '../../src/date-format.mjs';
import featureLoader from '../../src/feature-loader.js';
import uiController from '../../src/ui-controller.js';
import { publicMaps } from '../../src/public-map.mjs';
import { compositeChildIds } from '../../src/map-relations.mjs';
import { readStored, writeStored } from '../../src/storage-keys.mjs';
import { TestMetadataService } from '../../render/src/metadata-service.js';
import { partyFullName } from '../../src/party-names.mjs';
import {
  addPartyChanges,
  addStandings,
  BODY_GROUP_ORDER,
  bodyGroupOf,
  groupConstituencies,
  isListPseudoCandidate,
  knownCount,
  leadingPartyOf,
  normaliseStatus,
  partyHeadlineCards
} from '../../src/entity-detail-data.mjs';
import { Test2MapLibreMainAdapter } from './maplibre-main-adapter.js';

const TEST2_LAYER_ORDER_STORAGE_KEY = 'civgraph:maplibre:layer-order';
// Boundary changes between consecutive editions (scripts/build_timeline_changes.py). They
// replace the Play-only transition overlays of data/timeline-transition-overlays/.
const TIMELINE_CHANGES_BASE_PATH = '/data/timeline-changes';
const TIMELINE_HIGHLIGHT_STORAGE_KEY = 'civgraph:timelineHighlightChanges';
// A jump across more editions than this lists the first steps and says how many more.
const TIMELINE_CHANGES_MAX_STEPS = 12;
const TIMELINE_CHANGES_MAX_MARKERS = 200;
// Play: the pause before each step, and how long a step is held -- long enough to see what
// changed, short when there is nothing to see.
const TIMELINE_ANIMATION_DELAYS = Object.freeze({
  start: 500,
  hold: 2200,
  holdQuiet: 600
});

const CIVIL_PARISHES_COMPOSITE_PARENT_IDS = new Set([
  'civil-parishes-by-province',
  'ireland-civil-parishes',
  'flat-civil-parishes'
]);

const CIVIL_PARISHES_COMPOSITE_CHILD_IDS = [
  'civil-parishes-connacht',
  'civil-parishes-leinster',
  'civil-parishes-munster',
  'civil-parishes-ulster'
];

function parseLayerOrder(value) {
  if (!value) return [];
  let items = [];
  if (Array.isArray(value)) {
    items = value;
  } else {
    const text = String(value).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
    }
    if (!items.length) items = text.split(',');
  }
  const seen = new Set();
  const result = [];
  for (const rawId of items) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

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
    this.browsePersonsIndexPromise = null;
    this.classicScriptPromises = new Map();
  }

  readSavedLayerOrder() {
    try {
      return parseLayerOrder(localStorage.getItem(TEST2_LAYER_ORDER_STORAGE_KEY));
    } catch {
      return [];
    }
  }

  writeSavedLayerOrder(order) {
    const ids = parseLayerOrder(order);
    try {
      if (ids.length > 1) localStorage.setItem(TEST2_LAYER_ORDER_STORAGE_KEY, JSON.stringify(ids));
      else localStorage.removeItem(TEST2_LAYER_ORDER_STORAGE_KEY);
    } catch {
      // Storage can fail in private browsing or locked-down browser profiles.
    }
  }

  normalizeLoadedLayerOrder(order, loadedIds = this.getLoadedLayerIds()) {
    const loadedSet = new Set(loadedIds);
    const result = [];
    const seen = new Set();
    for (const id of parseLayerOrder(order)) {
      if (!loadedSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    for (const id of loadedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  }

  getActiveLayerOrder(loadedIds = this.getLoadedLayerIds()) {
    const drawOrder = this.mapController?.getLayerDrawOrder?.({ loadedOnly: true }) || [];
    return this.normalizeLoadedLayerOrder(drawOrder, loadedIds);
  }

  setActiveLayerOrder(order, options = {}) {
    const { persist = true, notify = false } = options || {};
    const normalized = this.normalizeLoadedLayerOrder(order);
    if (normalized.length < 2) return normalized;
    this.mapController?.setLayerDrawOrder?.(normalized, { notify });
    if (persist) this.writeSavedLayerOrder(normalized);
    this.syncCatalogueMapState();
    this.updateActiveLayers();
    this.updateURLState();
    return normalized;
  }

  restoreLayerOrder(params) {
    const explicitOrder = parseLayerOrder(params?.get?.('layerOrder'));
    const savedOrder = explicitOrder.length ? explicitOrder : this.readSavedLayerOrder();
    if (!savedOrder.length) return;
    const normalized = this.normalizeLoadedLayerOrder(savedOrder);
    if (normalized.length < 2) return;
    this.mapController?.setLayerDrawOrder?.(normalized);
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

    // Version token is the index's own content hash, injected at build time by
    // build-test2-app.mjs. It must stay content-derived: _headers serves this
    // file immutable, so a token that does not change when the bytes change
    // pins a stale catalogue in every browser that has already loaded it.
    this.metadataService = new TestMetadataService(`/render/metadata/maps-test-index.json?v=${__METADATA_INDEX_VERSION__}`, undefined, {
      cache: 'force-cache',
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

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      this.serviceWorkerStatusPromise = Promise.resolve({ available: false, reason: 'service-worker API unavailable' });
      return;
    }
    this.serviceWorkerConfig = this.getServiceWorkerConfig();
    this.serviceWorkerStatusPromise = navigator.serviceWorker.register(this.serviceWorkerConfig.url, { scope: this.serviceWorkerConfig.scope })
      .then(async (registration) => {
        await navigator.serviceWorker.ready.catch(() => registration);
        return this.getServiceWorkerStatus(registration);
      })
      .catch((error) => ({
        available: false,
        reason: String(error?.message || error)
      }));
  }

  getServiceWorkerConfig() {
    const path = window.location.pathname || '/';
  return { url: '/sw.js', scope: '/', route: 'root' };
}

  async getServiceWorkerStatus(registration = null) {
    if (!('serviceWorker' in navigator)) return { available: false, reason: 'service-worker API unavailable' };
    const config = this.serviceWorkerConfig || this.getServiceWorkerConfig();
    const activeRegistration = registration || await navigator.serviceWorker.getRegistration(config.scope);
    const target = navigator.serviceWorker.controller
      || activeRegistration?.active
      || activeRegistration?.waiting
      || activeRegistration?.installing;
    if (!target) return { available: true, controlled: false, reason: 'registered but not yet controlling this page' };
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve({ available: true, controlled: Boolean(navigator.serviceWorker.controller), reason: 'status timeout' }), 900);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve({
          available: true,
          route: config.route,
          controlled: Boolean(navigator.serviceWorker.controller),
          ...(event.data || {})
        });
      };
      target.postMessage({ type: 'TEST2_SW_STATUS' }, [channel.port2]);
    });
  }

  async collectPerformanceStatus() {
    const budget = await this.loadPerformanceBudget();
    const serviceWorker = await this.getServiceWorkerStatus().catch((error) => ({
      available: false,
      reason: String(error?.message || error)
    }));
    const mapMetrics = this.mapController?.getMetrics?.() || this.mapController?.metrics || [];
    const electionOverlay = this.elections?.getSeatCircleOverlayState?.() || null;
    return {
      generatedAt: new Date().toISOString(),
      budget,
      serviceWorker,
      map: {
        runtimeProfile: this.mapController?.runtimeProfile || null,
        loadedLayers: this.mapController?.layers?.size || 0,
        metrics: mapMetrics.slice(-40),
        fallbackCount: mapMetrics.filter((metric) => /fallback/i.test(metric?.event || '')).length
      },
      elections: {
        active: this.elections?.activeEntry?.key || null,
        seatCircleRenderMs: Number(this.elections?.lastSeatCircleRenderMs || 0),
        overlay: electionOverlay
      },
      browser: {
        memory: performance.memory?.usedJSHeapSize || 0,
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        dpr: window.devicePixelRatio || 1
      }
    };
  }

  async loadPerformanceBudget() {
    if (this.performanceBudget) return this.performanceBudget;
    this.performanceBudget = fetch('/app/build/performance-dashboard.json', { cache: 'no-cache' })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    return this.performanceBudget;
  }

  relocateMobileCatalogueToggle() {
    const toggle = document.getElementById('mobileToggle');
    const stack = document.querySelector('#map .test2-main-control-stack');
    const zoomControl = stack?.querySelector('.test2-main-zoom-control');
    if (!toggle || !stack || !zoomControl) return;
    toggle.classList.remove('mobile-toggle--navbar');
    toggle.classList.add('mobile-toggle--map-stack');
    toggle.removeAttribute('style');
    // T3-09 (#104): this set a THIRD wording, "Show or hide catalogue", which then got
    // replaced by updateMobilePaneToggleState()'s state-dependent "Show map" /
    // "Show catalogue". Two sources for one label, briefly disagreeing. The
    // state-dependent one wins because it says what pressing the button will DO.
    this.updateMobilePaneToggleState();
    if (toggle.parentElement !== stack || toggle.nextElementSibling !== zoomControl) {
      stack.insertBefore(toggle, zoomControl);
    }
  }

  installMobilePaneToggle() {
    if (this._mobilePaneToggleInstalled) {
      this.updateMobilePaneToggleState();
      return;
    }
    const header = document.querySelector('.app-header');
    if (!header) return;

    let toggle = document.getElementById('mobilePaneToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'mobilePaneToggle';
      toggle.type = 'button';
      toggle.className = 'mobile-pane-toggle';
      toggle.innerHTML = '<span aria-hidden="true">☰</span>';
      const menuButton = header.querySelector(':scope > .mobile-menu-toggle') || document.getElementById('mobileMenuBtn');
      if (menuButton?.parentElement === header) {
        header.insertBefore(toggle, menuButton);
      } else {
        header.appendChild(toggle);
      }
    }

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const nextState = uiController.currentStateId === 'info-full' ? 'map-full' : 'info-full';
      uiController.setSplitState(nextState);
      setTimeout(() => this.mapController?.invalidateSize?.(), 250);
      this.updateMobilePaneToggleState();
    });

    const previousSplitHandler = uiController.onSplitChange;
    uiController.onSplitChange = (stateId) => {
      if (typeof previousSplitHandler === 'function') previousSplitHandler(stateId);
      this.updateMobilePaneToggleState();
    };

    window.matchMedia?.('(max-width: 768px)')?.addEventListener?.('change', () => {
      this.updateMobilePaneToggleState();
    });

    this._mobilePaneToggleInstalled = true;
    this.mobilePaneToggle = toggle;
    this.updateMobilePaneToggleState();
  }

  /**
   * T3-09 (#105): on mobile the catalogue covers the map, so loading a layer left the
   * user looking at the list they had just used rather than the thing they had asked
   * for. They had to find the toggle and switch across manually, every time.
   *
   * Only on a mobile-like layout, and only when the catalogue is the full-screen pane --
   * on a split or desktop layout both are visible and there is nothing to dismiss.
   */
  dismissMobileCatalogueAfterLoad(label = '') {
    if (!this.isPhoneLayout()) return;
    if (uiController.currentStateId !== 'info-full') return;
    uiController.setSplitState('map-full');
    this.updateMobilePaneToggleState();
    setTimeout(() => this.mapController?.invalidateSize?.(), 250);
    // No "<map> is on the map" note (owner, 1 Nov 2026): the map itself shows what changed, and
    // the catalogue button in the header goes straight back.
  }

  /** On a phone the catalogue and the map are separate views: a page opened from the map (a
   * results table, a feature's name) or from a shared link is shown, not left behind the map. */
  revealCatalogueOnPhone() {
    if (!this.isPhoneLayout() || uiController.currentStateId !== 'map-full') return;
    uiController.setSplitState('info-full');
    this.updateMobilePaneToggleState();
  }

  isPhoneLayout() {
    return Boolean(uiController.isMobile || window.matchMedia?.('(max-width: 768px), (pointer: coarse)')?.matches);
  }

  /**
   * A small bar across the top of the map on phones: what just happened, and a button to the
   * catalogue. It goes by itself after a while, or when the catalogue opens; the header's
   * catalogue button stays the one permanent way across, so the map has no second toggle.
   */
  showMobilePeek(message, { action = 'Open the catalogue', timeoutMs = 9000, onDismiss = null } = {}) {
    const host = document.querySelector('.pane--map') || document.getElementById('map')?.parentElement;
    if (!host) return null;
    let peek = document.getElementById('mobileCataloguePeek');
    if (!peek) {
      peek = document.createElement('div');
      peek.id = 'mobileCataloguePeek';
      peek.className = 'mobile-catalogue-peek';
      peek.setAttribute('role', 'status');
      host.appendChild(peek);
    }
    clearTimeout(this._mobilePeekTimer);
    peek.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'mobile-catalogue-peek__text';
    text.textContent = message;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'mobile-catalogue-peek__open';
    open.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
    open.append(action);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mobile-catalogue-peek__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    const hide = () => {
      clearTimeout(this._mobilePeekTimer);
      peek.hidden = true;
      onDismiss?.();
    };
    open.addEventListener('click', () => {
      hide();
      uiController.setSplitState('info-full');
      this.updateMobilePaneToggleState();
    });
    close.addEventListener('click', hide);
    peek.append(text, open, close);
    peek.hidden = false;
    this.hideMobilePeek = hide;
    if (timeoutMs) this._mobilePeekTimer = setTimeout(hide, timeoutMs);
    return peek;
  }

  /**
   * First visit on a phone: the page opens on a bare map, and nothing said where the maps
   * are. One hint, once; the flag lives in localStorage (readStored/writeStored swallow a
   * blocked or full store, so a private window just sees the hint again).
   */
  showFirstVisitHint() {
    if (!this.isPhoneLayout() || uiController.currentStateId !== 'map-full') return;
    if (readStored('mapHintSeen')) return;
    if (this.getLoadedLayerIds().length || this.elections?.activeEntry) return;
    this.showMobilePeek('Choose a map or an election from the catalogue to draw it here.', {
      action: 'Open the catalogue',
      timeoutMs: 0,
      onDismiss: () => writeStored('mapHintSeen', '1'),
    });
  }

  /**
   * Wait for a newly added layer to draw, or to fail outright. waitUntilSettled() alone
   * waited out its full twenty seconds when the source itself could not load (a PMTiles
   * archive offline), with a spinner on the button and nothing to say why.
   */
  waitForMapOutcome(mapId) {
    const settle = this.mapController.waitUntilSettled();
    let timer = 0;
    const failed = new Promise((resolve) => {
      timer = setInterval(() => {
        if (this.mapController.getLayerLoadFailure?.(mapId)?.kind === 'source') resolve('failed');
      }, 250);
    });
    return Promise.race([settle, failed]).finally(() => clearInterval(timer));
  }

  /** Tell the reader a layer did not load, with a Retry that tries the same layer again. */
  reportMapLoadFailure(mapId, error) {
    this.showMapError(error, {
      retry: async () => {
        await uiController.onMapLoad(mapId);
        this.syncCatalogueMapState();
      },
    });
  }

  /**
   * Re-fit the map once the election results pane has taken its space.
   *
   * UX plan T3-08 (#96), "12 of 18 constituencies below the fold". The fit itself was
   * never broken -- loadMap fits correctly, and measured before the pane opens the view
   * contains the whole layer (south edge 51.168 against the layer's 51.389). The pane
   * then opens, the map container goes from 736px to 374px at 1280x800, and MapLibre
   * keeps the camera where it was. The view loses 2.3 degrees of latitude and the
   * southern third of an all-island election is simply off-screen.
   *
   * So this is a RE-fit after a resize, not a first fit.
   *
   * SKIPPED WHILE RESTORING FROM A URL. A viewport in the URL is an explicit request and
   * must win; re-fitting would silently discard the lng/lat/zoom someone shared.
   */
  refitAfterElectionPane(sourceMapId) {
    if (!sourceMapId || this._restoringURLState) return;
    const map = this.mapController?.map;
    if (!map) return;
    // Measure the container first. Without this the fit is computed against the
    // pre-pane height and lands in exactly the place this exists to correct.
    map.resize();
    this.mapController.fitToLayer?.(sourceMapId);
    // The layout is not finished when the pane opens: the catalogue pane changes width a
    // moment later (src/catalogue/split.js) and the pane slides up, so that fit was made for a
    // larger map than the one left. Fit again each time the map's box changes over the next
    // second, then stop listening, so a reader's own panning is never undone.
    const container = map.getContainer?.();
    if (!container || typeof ResizeObserver === 'undefined') return;
    this._electionRefitObserver?.disconnect();
    let last = `${container.clientWidth}x${container.clientHeight}`;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const size = `${container.clientWidth}x${container.clientHeight}`;
      if (size === last) return;
      last = size;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (this.elections?.activeEntry?.sourceMapId !== sourceMapId) return;
        map.resize();
        this.mapController.fitToLayer?.(sourceMapId);
      });
    });
    this._electionRefitObserver = observer;
    observer.observe(container);
    setTimeout(() => {
      if (this._electionRefitObserver !== observer) return;
      observer.disconnect();
      this._electionRefitObserver = null;
    }, 1200);
  }

  updateMobilePaneToggleState() {
    const toggle = document.getElementById('mobilePaneToggle');
    if (!toggle) return;
    const showingCatalogue = uiController.currentStateId === 'info-full';
    // The bar over the map is about the map; it has nothing to say once the catalogue is up.
    if (showingCatalogue && document.getElementById('mobileCataloguePeek')?.hidden === false) this.hideMobilePeek?.();
    const label = showingCatalogue ? 'Show map' : 'Show catalogue';
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
    const target = showingCatalogue ? 'map' : 'catalogue';
    // It showed a bare ☰ beside the site menu's own ☰, so the header had two identical
    // buttons doing different things. It now shows where it goes: a map, or a list.
    if (toggle.dataset.target !== target || !toggle.querySelector('svg')) {
      toggle.innerHTML = target === 'map'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>';
    }
    toggle.dataset.target = target;
  }

  configureCataloguePerformanceProfile() {
    const mobileQuery = window.matchMedia?.('(max-width: 768px), (pointer: coarse)');
    const apply = () => {
      const isMobileLike = Boolean(uiController.isMobile || mobileQuery?.matches);
      uiController.showAllMaps = !isMobileLike;
      uiController.includeMobileElectionCatalogue = true;
      uiController.singleSectionFlatCatalogue = true;
      uiController._mobileInitialMapCardLimit = isMobileLike ? 12 : 24;
      uiController._mobileInitialElectionCardLimit = isMobileLike ? 2 : 15;
      if (!isMobileLike) uiController._mobileCatalogueExpanded = false;
    };
    apply();
    mobileQuery?.addEventListener?.('change', () => {
      apply();
      uiController.requestFlatViewRender?.(uiController._lastMapListOptions || {}, { defer: true });
    });
  }

  setupElectionPaneResize() {
    if (this._electionPaneResizeReady) return;
    this._electionPaneResizeReady = true;
    const storageKey = 'civgraph:test2:electionPaneHeight';
    const minPaneHeight = 120;
    const defaultPaneHeight = () => Math.round(Math.min(window.innerHeight * 0.30, Math.max(minPaneHeight, window.innerHeight * 0.26)));
    const parseCssPx = (value, fallback) => {
      const number = Number.parseFloat(String(value || '').trim());
      return Number.isFinite(number) ? number : fallback;
    };
    const maxPaneHeight = () => {
      const rootStyle = getComputedStyle(document.body);
      const header = document.querySelector('.app-header')?.getBoundingClientRect().height || parseCssPx(rootStyle.getPropertyValue('--header-height'), 64);
      const mapMin = parseCssPx(rootStyle.getPropertyValue('--map-min-height'), 220);
      const timeline = document.getElementById('timelineSlider');
      const timelineHeight = timeline && !timeline.classList.contains('hidden')
        ? timeline.getBoundingClientRect().height
        : 0;
      return Math.max(minPaneHeight, window.innerHeight - header - mapMin - timelineHeight - 6);
    };
    const isPhoneLayout = () => Boolean(window.matchMedia?.('(max-width: 768px)')?.matches);
    const clampPaneHeight = (height) => Math.max(minPaneHeight, Math.min(maxPaneHeight(), Math.round(height)));
    const invalidateMapSize = () => {
      requestAnimationFrame(() => this.mapController?.invalidateSize?.());
    };
    const applyPaneHeightCss = (height) => {
      const cssValue = `${height}px`;
      document.documentElement.style.setProperty('--test2-election-pane-height', cssValue);
      document.body.style.setProperty('--test2-election-pane-height', cssValue);
      document.querySelector('.app-shell')?.style.setProperty('--test2-election-pane-height', cssValue);
    };
    const setPaneHeight = (height, options = {}) => {
      const { invalidate = true, persist = true } = options || {};
      const nextHeight = clampPaneHeight(height);
      this._electionPaneHeight = nextHeight;
      applyPaneHeightCss(nextHeight);
      if (persist) {
        try {
          localStorage.setItem(storageKey, String(nextHeight));
        } catch {
          // Ignore storage failures; resizing must still work in private modes.
        }
      }
      if (invalidate) invalidateMapSize();
      this.syncElectionPaneResizerAria();
      return nextHeight;
    };
    // The resizer is a separator with a value, so it must always say its value and range, not
    // only once a drag or key press has set them (UX review 2026-10-30, #13).
    this.syncElectionPaneResizerAria = () => {
      const handle = document.querySelector('[data-election-pane-resize]');
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      const now = Math.round(this._electionPaneHeight || pane?.getBoundingClientRect().height || defaultPaneHeight());
      handle.setAttribute('aria-valuemin', String(minPaneHeight));
      handle.setAttribute('aria-valuemax', String(Math.round(maxPaneHeight())));
      handle.setAttribute('aria-valuenow', String(now));
      handle.setAttribute('aria-valuetext', `${now} pixels tall`);
    };
    try {
      const savedHeight = Number.parseFloat(localStorage.getItem(storageKey) || '');
      if (Number.isFinite(savedHeight)) {
        setPaneHeight(savedHeight, { invalidate: false, persist: false });
      }
    } catch {
      // Ignore storage failures; the CSS default remains available.
    }
    const resizeSavedHeight = () => {
      let savedHeight = NaN;
      try {
        savedHeight = parseCssPx(localStorage.getItem(storageKey), NaN);
      } catch {
        savedHeight = NaN;
      }
      const current = this._electionPaneHeight || savedHeight;
      if (Number.isFinite(current)) setPaneHeight(current, { invalidate: true, persist: false });
    };
    window.addEventListener('resize', () => requestAnimationFrame(resizeSavedHeight), { passive: true });
    const getResizeTarget = (target) => {
      const explicit = target.closest?.('[data-election-pane-resize]');
      if (explicit) return explicit;
      const header = target.closest?.('.election-pane__header');
      if (!header) return null;
      const interactive = target.closest?.('button,a,input,select,textarea,[role="button"],[data-election-view],[data-election-entity],[data-election-result-key]');
      return interactive ? null : (document.querySelector('[data-election-pane-resize]') || header);
    };
    const startDrag = (event) => {
      const handle = getResizeTarget(event.target);
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      event.preventDefault();
      event.stopPropagation();
      const phone = isPhoneLayout();
      // On a phone the folded bar opens with the finger once it moves, or to the default
      // height on a plain tap; a tap must not fold it straight back on release.
      let folded = phone && document.body.classList.contains('test2-election-collapsed');
      const startY = event.clientY;
      let moved = false;
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture can fail on some synthetic/mobile events; window listeners cover it.
      }
      document.body.classList.add('test2-election-pane-resizing');
      handle.setAttribute('aria-valuemin', String(minPaneHeight));
      handle.setAttribute('aria-valuemax', String(maxPaneHeight()));
      const onMove = (moveEvent) => {
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        if (!moved && Math.abs(moveEvent.clientY - startY) < 6) return;
        moved = true;
        if (folded) {
          folded = false;
          this.elections?.setPaneCollapsed?.(false, { refit: false });
        }
        const nextHeight = setPaneHeight(window.innerHeight - moveEvent.clientY, { invalidate: false, persist: false });
        handle.setAttribute('aria-valuenow', String(nextHeight));
      };
      const onEnd = () => {
        document.body.classList.remove('test2-election-pane-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        const current = this._electionPaneHeight || pane.getBoundingClientRect().height || defaultPaneHeight();
        if (phone && !moved) {
          if (folded) {
            this.elections?.setPaneCollapsed?.(false, { refit: false });
            setPaneHeight(defaultPaneHeight(), { invalidate: false, persist: true });
            if (this.elections?.activeEntry?.sourceMapId) this.refitAfterElectionPane(this.elections.activeEntry.sourceMapId);
          }
          return;
        }
        if (phone) {
          // Phones snap to three heights: folded to the seat strip, the default, or as tall as
          // the map allows. A free height is fiddly with a thumb and easily left half-way.
          if (current < minPaneHeight + 40) {
            this.elections?.setPaneCollapsed?.(true);
            return;
          }
          const stops = [defaultPaneHeight(), maxPaneHeight()];
          const nearest = stops.reduce((best, stop) => (Math.abs(stop - current) < Math.abs(best - current) ? stop : best), stops[0]);
          setPaneHeight(nearest, { invalidate: false, persist: true });
          invalidateMapSize();
          if (this.elections?.activeEntry?.sourceMapId) this.refitAfterElectionPane(this.elections.activeEntry.sourceMapId);
          return;
        }
        setPaneHeight(current, { invalidate: false, persist: true });
        invalidateMapSize();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    };
    document.addEventListener('pointerdown', startDrag);
    document.addEventListener('keydown', (event) => {
      const handle = getResizeTarget(event.target);
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      const current = pane.getBoundingClientRect().height || defaultPaneHeight();
      const step = event.shiftKey ? 50 : 20;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(current + step)));
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(current - step)));
      } else if (event.key === 'Home') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(maxPaneHeight())));
      } else if (event.key === 'End') {
        event.preventDefault();
        handle.setAttribute('aria-valuenow', String(setPaneHeight(minPaneHeight)));
      }
    });
    document.addEventListener('dblclick', (event) => {
      if (!getResizeTarget(event.target)) return;
      event.preventDefault();
      setPaneHeight(defaultPaneHeight());
    });
  }

  installRouteGuard() {
    if (window.__civgraphTest2RouteGuardInstalled) return;
    window.__civgraphTest2RouteGuardInstalled = true;

    const preserveCurrentPath = (url) => {
      if (typeof url !== 'string' || !url.startsWith('#')) return url;
      return `${window.location.pathname}${window.location.search || ''}${url}`;
    };

    const nativeReplaceState = history.replaceState.bind(history);
    const nativePushState = history.pushState.bind(history);
    // Every entry this page adds is tagged with a number and remembered with a label, so the
    // History list can show the reader's own steps and go straight to one (history.go), and a
    // replaceState (pan, zoom, the slider) keeps the tag of the entry it rewrites rather than
    // wiping it with null.
    this.navEntries = [{ id: 0, label: 'Opened the map' }];
    this.navIndex = 0;
    let nextNavId = 1;
    const tagged = (state, id) => ({ ...(state && typeof state === 'object' ? state : {}), civgraphNav: id });
    nativeReplaceState(tagged(history.state, 0), '');
    history.replaceState = (state, title, url) => nativeReplaceState(tagged(state, this.navEntries[this.navIndex]?.id ?? 0), title, preserveCurrentPath(url));
    history.pushState = (state, title, url) => {
      const id = nextNavId++;
      this.navEntries = this.navEntries.slice(0, this.navIndex + 1);
      this.navEntries.push({ id, label: this._pendingNavLabel || this.describeNavigation(url) });
      this.navIndex = this.navEntries.length - 1;
      this._pendingNavLabel = '';
      return nativePushState(tagged(state, id), title, preserveCurrentPath(url));
    };
    // Capture, and registered before the catalogue's own capture listener: that one rewrites
    // the address straight away, and must find the entry it is on already current here.
    window.addEventListener('popstate', (event) => {
      const id = event.state?.civgraphNav;
      const index = this.navEntries.findIndex((entry) => entry.id === id);
      if (index >= 0) this.navIndex = index;
    }, true);

    document.addEventListener('click', (event) => {
      const anchor = event.target.closest?.('a[href^="#"]');
      if (!anchor) return;
      if (anchor.closest?.('#catalogueFlatView') || anchor.dataset?.catalogueTarget) return;

      const hash = anchor.getAttribute('href') || '';
      event.preventDefault();
      if (!hash || hash === '#') return;

      const next = `${window.location.pathname}${window.location.search || ''}${hash}`;
      history.pushState(null, '', next);

      const id = decodeURIComponent(hash.slice(1));
      const target = document.getElementById(id) || document.querySelector(`[name="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ block: 'start' });
    }, true);
  }

  async loadBooks() {
    try {
      uiController.booksData = await dataService.ensureBooksLoaded();
    } catch (error) {
      console.warn('[Test2] Could not load books data', error);
    }
  }

  scheduleIdleTask(callback, { timeout = 2000 } = {}) {
    if (typeof callback !== 'function') return;
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
    } else {
      setTimeout(callback, Math.min(timeout, 1000));
    }
  }

  loadClassicScript(src, globalName) {
    if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
    if (this.classicScriptPromises.has(src)) return this.classicScriptPromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(globalName ? globalThis[globalName] : true), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve(globalName ? globalThis[globalName] : true);
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
    this.classicScriptPromises.set(src, promise);
    return promise;
  }

  async ensureFlatgeobufRuntime() {
    return this.loadClassicScript('/app/js/libs/flatgeobuf-geojson.min.js', 'flatgeobuf');
  }

  async ensureElections(options = {}) {
    if (this.elections?.catalogue) return this.elections;
    if (!this.electionModulePromise) {
      this.electionModulePromise = import('./election-manager.js');
    }
    const { Test2ElectionManager } = await this.electionModulePromise;
    if (!this.elections) {
      this.elections = new Test2ElectionManager({
        app: this,
        mapController: this.mapController,
        onError: (error) => this.showMapError(error)
      });
      if (window.__civgraphTest2) window.__civgraphTest2.elections = this.elections;
    }
    if (!this.electionLoadPromise) {
      this.electionLoadPromise = this.elections.load();
    }
    await this.electionLoadPromise;
    if (options.refreshCatalogue) this.updateMapList();
    return this.elections;
  }

  scheduleElectionCatalogueWarm() {
    if (this.electionCatalogueWarmScheduled || this.elections?.catalogue) return;
    this.electionCatalogueWarmScheduled = true;
    const warm = () => {
      this.ensureElections({ refreshCatalogue: true }).catch((error) => {
        console.warn('[Test2] Election catalogue warmup failed', error);
      });
    };
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hasElectionState = this.hasElectionURLState(params, parseLayerOrder(params.get('layers')));
    const timeout = hasElectionState ? 1200 : 6000;
    this.scheduleIdleTask(warm, { timeout });
  }

  hasElectionURLState(params, layers = []) {
    if ([...layers].some((id) => String(id).startsWith('election-'))) return true;
    return params.has('electionBody') || params.has('electionDate') || params.has('electionMode') || params.has('electionView');
  }

  wireUiCallbacks() {
    // The History popup lists the reader's own steps (see installRouteGuard) and goes to one.
    uiController.getNavigationHistory = () => (this.navEntries ? { entries: this.navEntries, index: this.navIndex } : null);
    uiController.goToNavigationEntry = (index) => history.go(index - this.navIndex);
    uiController.onBuildElectionCatalogueCards = async () => {
      if (this.elections?.catalogue) return this.elections.buildCatalogueCards();
      this.scheduleElectionCatalogueWarm();
      return [];
    };
    uiController.onLoadElection = async (body, date) => {
      this.hideMapError();
      const navMark = this.navIndex;
      try {
        const elections = await this.ensureElections();
        await elections.loadElection(body, date);
        this.updateMapList();
        this.focusActiveElectionCatalogueEntry(this.elections?.activeEntry, { scroll: false });
        const title = this.elections?.activeBundle?.displayTitle || this.elections?.activeEntry?.displayTitle || `${body} ${date}`;
        // On a phone the catalogue covered the map, so opening an election changed nothing
        // the reader could see (UX review 2026-10-30, #12). Maps already did this; elections now do.
        this.dismissMobileCatalogueAfterLoad(title);
        this.announce(`${title} loaded`);
      } catch (error) {
        // The bundle or its map failed. Say so, with a Retry, rather than leave the loading
        // panel turning (UX review 2026-10-30, #15).
        this.undoNavigationSince(navMark);
        this.showMapError(error, { retry: () => uiController.onLoadElection(body, date) });
      }
    };
    uiController.onUnloadElection = () => {
      this.elections?.unloadElection({ label: 'Closed the election' });
      this.updateMapList();
    };
    uiController.onCheckElectionLoaded = (body, date) => this.elections?.isElectionLoaded(body, date) || false;
    uiController.onSetupElectionTableControls = () => {};
    uiController.onOpenElectionEntityDetail = async (kind, key, label) => this.openElectionEntityDetailInCatalogue(kind, key, { label: label || undefined });
    uiController.onShowOnMap = (label) => this.dismissMobileCatalogueAfterLoad(label);
    // An election named on a party, person or constituency page. The handler was declared and
    // called but never assigned, so those links did nothing. The election is found by its key
    // where the row has one: a body's display name need not match the catalogue's spelling.
    uiController.onElectionEntityElectionOpen = async ({ key, body, date, constituency } = {}) => {
      const elections = await this.ensureElections();
      const entries = elections?.catalogue?.elections || [];
      const entry = (key && entries.find((item) => item.key === key))
        || elections?.findEntry?.(body, date)
        || entries.find((item) => item.date === date && normalizeEntityName(item.body) === normalizeEntityName(body))
        || null;
      if (!entry) {
        this.showMapError(`${[body, date].filter(Boolean).join(' ')} is not in the election catalogue.`, { kind: 'info' });
        return;
      }
      await uiController.onLoadElection(entry.body, entry.date);
      if (constituency && this.elections?.activeEntry?.key === entry.key) {
        const result = this.elections.findResultByKey?.(constituency);
        if (result) {
          this.elections.renderPanel(result, 'party');
          this.updateURLState();
        }
      }
    };
    uiController.onOpenElectionConstituencyFeature = async ({ constituency, level }) => {
      const kind = level === 'council' ? 'lgd' : level === 'dea' ? 'dea' : 'constituency';
      return this.openElectionEntityDetailInCatalogue(kind, constituency);
    };

    uiController.onSplitChange = () => {
      this.mapController.invalidateSize();
      this.updateURLState();
    };

    uiController.onMapLoad = async (mapId) => {
      await this.stopTimelineAnimation({ restoreOriginal: false });
      this.hideMapError();
      const navMark = this.navIndex;
      this.beginNavigation(`Added ${this.mapLabel(mapId)}`);
      try {
        await this.loadMap(mapId);
      } catch (error) {
        this._pushNextURL = null;
        this.undoNavigationSince(navMark);
        this.reportMapLoadFailure(mapId, error);
        throw error;
      }
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.dismissMobileCatalogueAfterLoad(this.mapLabel(mapId));
      this.endNavigation();
      // Held until the tiles are actually drawn, so the catalogue's loading spinner spans
      // the wait the user experiences rather than just the style mutation, which returns
      // in tens of milliseconds. Deliberately last: the state updates above must not be
      // delayed by it.
      //
      // T0-05: keep WHY it stopped waiting. The catalogue's outcome announcement used to
      // be derived from isMapLoaded(), which is style membership -- true the instant the
      // layer is added, whether or not a single tile ever arrives. So a stalled load was
      // announced as "loaded" over an empty map. recordSettleOutcome() gives the
      // catalogue the third state the announcement needs.
      this.recordSettleOutcome(mapId, await this.waitForMapOutcome(mapId));
      // Settling is not success: MapLibre counts an errored tile as loaded, so offline, or with
      // the tile host down, the map settled at once over nothing and the button said "On map"
      // (UX review 2026-10-30, #15). A layer none of whose data arrived is taken off again, so
      // the button goes back to Add, and the reader is told, with a Retry.
      const failure = this.mapController.getLayerLoadFailure?.(mapId);
      if (failure && this.isMapLoaded(mapId)) {
        this.mapController.unloadLayer(mapId);
        this.settleOutcomes?.delete(mapId);
        this.syncCatalogueMapState();
        this.updateActiveLayers();
        this.updateURLState();
        this.undoNavigationSince(navMark);
        const error = new Error(`${this.mapLabel(mapId)} could not be loaded: ${navigator.onLine === false ? 'you appear to be offline' : 'its map data did not arrive'}.`);
        error.code = 'layer-data-failed';
        this.reportMapLoadFailure(mapId, error);
        throw error;
      }
      this.announce(`${this.mapLabel(mapId)} loaded`);
    };

    uiController.onMapUnload = async (mapId) => {
      await this.stopTimelineAnimation({ restoreOriginal: false });
      this.beginNavigation(`Removed ${this.mapLabel(mapId)}`);
      if (this.unloadActiveElectionForLayer(mapId)) {
        this.updateMapList();
        this.endNavigation();
        return;
      }
      this.unloadMapNow(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.endNavigation();
      // Same reason as onMapLoad: removing a layer forces a redraw, and the spinner should
      // last until the map has actually repainted without it.
      await this.mapController.waitUntilSettled();
      // The layer is gone; a stale 'timeout' left here would make the next load of the
      // same id inherit this one's verdict.
      this.settleOutcomes?.delete(mapId);
    };

    uiController.onMapToggle = (mapId) => {
      if (this.isTimelineAnimationLayer(mapId)) this.pauseTimelineAnimation({ preserveOverlay: false });
      this.mapController.toggleLayer(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };

    uiController.onHideMap = (mapId) => {
      if (this.isTimelineAnimationLayer(mapId)) this.pauseTimelineAnimation({ preserveOverlay: false });
      this.mapController.hideLayer(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };
    uiController.onCheckMapLoaded = (mapId) => this.isMapLoaded(mapId);
    uiController.onCheckMapSettled = (mapId) => this.settleOutcomes?.get(mapId) || 'unknown';
    uiController.onCheckMapVisible = (mapId) => this.isMapVisible(mapId);
    uiController.onReorderLayers = (ids) => this.setActiveLayerOrder(ids);
    uiController.onExpandToFullMap = async (mapId) => this.loadMap(mapId);
    uiController.onPartialFeatureToggle = (mapId, featureIndex) => {
      this.mapController.togglePartialFeature(mapId, featureIndex);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };
    uiController.onPartialFeatureUnload = (mapId, featureIndex) => {
      this.mapController.unloadPartialFeature(mapId, featureIndex);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };
    uiController.onCheckFeatureLoaded = (mapId, featureIndex) => this.mapController.isFeatureLoaded(mapId, featureIndex);
    uiController.onCheckFeatureVisible = (mapId, featureIndex) => this.mapController.isFeatureVisible(mapId, featureIndex);
    uiController.onFeatureLoad = async (mapId, featureIndex, featureName, bbox, options = {}) => {
      const mapConfig = dataService.getMapById(mapId);
      if (!mapConfig) return null;
      const result = await this.mapController.loadSingleFeature(mapConfig, featureIndex, featureName, bbox, { isolate: options.isolate === true });
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
      return result;
    };
    uiController.onCategoryChange = (categoryId) => {
      this.currentCategory = categoryId;
      this.updateMapList();
      this.updateURLState();
    };
    uiController.onProviderCategoryChange = (providerId, providers) => {
      this.currentProviderCategory = providerId;
      this.currentProviderList = providers || [];
      this.updateMapList();
      this.updateURLState();
    };
    uiController.onAuthorFilter = (authors) => {
      this.currentAuthor = !authors || authors.length === 0 ? 'all' : authors;
      this.updateMapList();
      this.updateURLState();
    };
    uiController.onDownloadFgb = async (mapId) => {
      const mapConfig = dataService.getMapById(mapId);
      const url = resolveMapDownloadUrl(mapConfig);
      if (url) this.triggerDownload(url, url.split('/').pop());
    };
    uiController.onExportMapImage = (mapId, format, options) => this.exportMapImage(mapId, format, options);
    uiController.onAddressSelect = (lat, lon, name) => this.mapController.addAddressMarker(lat, lon, name);
    uiController.onRemoveAddressMarker = () => this.mapController.removeAddressMarker();
    uiController.onCheckIntersection = async (lat, lon) => this.mapController.queryFeaturesAtLngLat(lat, lon);
    uiController.onGetLoadedFeatures = () => this.mapController.getLoadedFeatures();
    uiController.onZoomToBbox = (bounds, options) => this.mapController.fitToBounds(bounds, options);
    uiController.onHighlightFeature = (mapId, featureId, options) => this.mapController.highlightFeature(mapId, featureId, options);
    uiController.onLoadSingleFeature = async (mapId, featureId, featureName, bbox, options = {}) => {
      const mapConfig = dataService.getMapById(mapId);
      if (!mapConfig) return null;
      const result = await this.mapController.loadSingleFeature(mapConfig, featureId, featureName, bbox, { isolate: options.isolate !== false });
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
      if (options.showInfo !== false) {
        uiController.showFeatureInfo([{ ...result.feature, mapId, id: featureId }], dataService.getAllMaps());
      }
      return result;
    };
  }

  installCatalogueStateBridge() {
    if (uiController.__test2CatalogueStateBridgeInstalled) return;
    uiController.__test2CatalogueStateBridgeInstalled = true;

    // Every page the pane opens is a browser history entry, so browser Back and the pane's own
    // Back step through the same places (UX review 2026-10-31, H4: Back undid the map behind a
    // person's page while the pane kept showing it). Reopening from the address passes
    // addToHistory false and makes no entry.
    const showDetail = uiController.showCatalogueDetailView.bind(uiController);
    uiController.showCatalogueDetailView = (mapId, addToHistory = true) => {
      if (addToHistory && mapId !== this.currentDetailMapId) this.beginNavigation(`Details: ${this.mapLabel(mapId)}`);
      this.entityPageToken = (this.entityPageToken || 0) + 1;
      const result = showDetail(mapId, addToHistory);
      this.currentDetailMapId = mapId || null;
      this.currentPage = null;
      this.endNavigation();
      return result;
    };

    const showList = uiController.showCatalogueListView.bind(uiController);
    uiController.showCatalogueListView = (addToHistory = false) => {
      const wasOnPage = Boolean(this.currentDetailMapId || this.currentPage);
      if (addToHistory && wasOnPage) this.beginNavigation('Catalogue');
      this.entityPageToken = (this.entityPageToken || 0) + 1;
      const result = showList(addToHistory);
      this.currentDetailMapId = null;
      this.currentPage = null;
      this.endNavigation();
      return result;
    };

    const showFeature = uiController.showFeatureDetailInCatalogue.bind(uiController);
    uiController.showFeatureDetailInCatalogue = (detailId, addToHistory = true, options = {}) => {
      const entry = uiController._featureDetailCache?.get(detailId);
      const fresh = addToHistory && !(this.currentPage?.kind === 'feature' && this.currentPage.key === detailId);
      if (entry && fresh) this.beginNavigation(`Feature: ${entry.primaryName || detailId}`);
      this.entityPageToken = (this.entityPageToken || 0) + 1;
      if (entry) this.revealCatalogueOnPhone();
      const result = showFeature(detailId, addToHistory, options);
      if (entry) {
        this.currentPage = {
          kind: 'feature',
          key: detailId,
          title: uiController.featureDisplayName?.(entry.primaryName, entry.mapConfig) || entry.primaryName || 'Feature',
          typeLabel: entry.mapConfig?.name || 'Feature'
        };
        this.currentDetailMapId = null;
      }
      this.endNavigation();
      return result;
    };

    // The pane's Back and Forward are the browser's while the reader has steps to go back
    // through, so the two cannot disagree; the pane's own list remains for the Tables tab and
    // for the first page of a visit, which has no earlier entry.
    const tablesOpen = () => {
      const tables = document.querySelector('.pane__content[data-tab-content="tables"]');
      return Boolean(tables && !tables.classList.contains('pane-tab-content--hidden'));
    };
    const goBack = uiController.catalogueGoBack.bind(uiController);
    uiController.catalogueGoBack = () => {
      if (!tablesOpen() && this.navIndex > 0) {
        history.back();
        return;
      }
      goBack();
    };
    const goForward = uiController.catalogueGoForward.bind(uiController);
    uiController.catalogueGoForward = () => {
      if (!tablesOpen() && this.navEntries && this.navIndex < this.navEntries.length - 1) {
        history.forward();
        return;
      }
      goForward();
    };
    const updateNav = uiController.updateCatalogueNavButtons.bind(uiController);
    uiController.updateCatalogueNavButtons = () => {
      updateNav();
      const back = document.getElementById('catalogueBack');
      const forward = document.getElementById('catalogueForward');
      if (back && this.navIndex > 0) back.disabled = false;
      if (forward && this.navEntries && this.navIndex < this.navEntries.length - 1) forward.disabled = false;
    };
  }

  /**
   * Reopen the page the address names (page=party:dup, page=feature:pc-2023:7) after Back,
   * Forward, a reload or a shared link. A feature page needs the feature itself, which a
   * reload no longer has: it is looked for among the features drawn on the map, and if it is
   * not there the catalogue stays on its list rather than showing an empty page.
   */
  async restorePage(page, { initial = false } = {}) {
    if (!page) return;
    if (this.currentPage && this.currentPage.kind === page.kind && this.currentPage.key === page.key
      && !document.getElementById('catalogueDetailView')?.classList.contains('hidden')) return;
    if (page.kind !== 'feature') {
      await this.openElectionEntityDetailInCatalogue(page.kind, page.key, { fromHistory: true, focus: !initial });
      return;
    }
    if (!uiController._featureDetailCache?.has(page.key)) {
      const at = page.key.indexOf(':');
      const mapId = at > 0 ? page.key.slice(0, at) : '';
      const featureId = at > 0 ? page.key.slice(at + 1) : '';
      const mapConfig = mapId ? dataService.getMapById(mapId) : null;
      if (!mapConfig || !featureId) return;
      await Promise.resolve(this.mapController.waitForMapRender?.()).catch(() => {});
      const feature = this.mapController.findRenderedFeature?.(mapId, featureId);
      if (!feature) return;
      uiController.cacheFeatureDetailEntry(mapConfig, feature, null, featureId);
    }
    if (uiController._featureDetailCache?.has(page.key)) {
      uiController.showFeatureDetailInCatalogue(page.key, false, { restoreState: true, focus: !initial });
    }
  }

  setupURLStateListener() {
    // Back and Forward between the entries pushState makes fire hashchange (their addresses
    // differ only in the hash), as does editing the hash by hand; both mean "show this".
    window.addEventListener('hashchange', () => {
      if (this._suspendURLState || this._ignoreHashChanges) return;
      // Back then Forward quickly: the second arrives while the first is still restoring. Do it
      // once that one is done, rather than drop it and leave the page on the wrong entry.
      if (this._restoringURLState) {
        this._hashRestorePending = true;
        return;
      }
      this.restoreURLState({ updateAfterRestore: false, sync: true }).catch((error) => this.showMapError(error));
    });
  }

  async loadMap(mapId, options = {}) {
    const mapConfig = dataService.getMapById(mapId);
    if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      const childIds = compositeChildIds(mapConfig);
      await Promise.all(childIds.map((memberId) => this.loadMap(memberId, { fit: options.fit !== false })));
      this.mapController.markGroupLoaded(mapId, mapConfig, childIds);
      return;
    }
    if (mapConfig?.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      const variantIds = mapConfig.variants
        .map((variant) => variant?.id)
        .filter((variantId) => this.mapController.resolveLayer(variantId)?.loadable);
      await Promise.all(variantIds.map((variantId) => this.mapController.loadLayer(variantId, { fit: false })));
      this.mapController.markGroupLoaded(mapId, mapConfig, variantIds);
      if (options.fit !== false) {
        if (mapConfig.bounds) this.mapController.fitToBounds(mapConfig.bounds, { smooth: false });
        else this.mapController.fitToLayers(variantIds);
      }
      return;
    }
    const directLayer = this.mapController.resolveLayer(mapConfig?.id || mapId);
    if (!directLayer?.loadable) {
      const civilParishChildIds = this.getCivilParishesCompositeChildIds(mapId, mapConfig);
      if (civilParishChildIds.length) {
        const groupConfig = mapConfig || dataService.getMapById('civil-parishes-by-province') || {
          id: mapId,
          name: 'Civil Parishes of Ireland'
        };
        await Promise.all(civilParishChildIds.map((childId) => this.mapController.loadLayer(childId, { fit: false })));
        this.mapController.markGroupLoaded(groupConfig.id || mapId, groupConfig, civilParishChildIds);
        if (options.fit !== false) {
          if (groupConfig.bounds) this.mapController.fitToBounds(groupConfig.bounds, { smooth: false });
          else this.mapController.fitToLayers(civilParishChildIds);
        }
        return;
      }
      const childIds = this.getConvertedCompositeChildIds(mapConfig);
      if (childIds.length) {
        await Promise.all(childIds.map((childId) => this.mapController.loadLayer(childId, { fit: false })));
        this.mapController.markGroupLoaded(mapConfig.id, mapConfig, childIds);
        if (options.fit !== false && mapConfig.bounds) this.mapController.fitToBounds(mapConfig.bounds, { smooth: false });
        return;
      }
    }
    await this.mapController.loadLayer(mapConfig || mapId, { fit: options.fit !== false });
  }

  /** Take a map off, with its members if it is a group or composite. */
  unloadMapNow(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    if (this.mapController.getLayerState(mapId)?.isGroup) {
      this.mapController.unloadLayer(mapId);
    } else if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      compositeChildIds(mapConfig).forEach((memberId) => this.mapController.unloadLayer(memberId));
    } else if (mapConfig?.isGroup && Array.isArray(mapConfig.variants)) {
      mapConfig.variants.forEach((variant) => this.mapController.unloadLayer(variant.id));
    } else {
      this.mapController.unloadLayer(mapId);
    }
  }

  /**
   * Back and Forward: make the map match the entry's address. restoreURLState only ADDS what
   * an address names, which is right for a shared link on a fresh page but not for a step
   * back, where what the earlier entry did not have must come off: the layer just added, the
   * election just opened.
   */
  removeStateNotIn(params) {
    const wanted = new Set([...(params.get('layers') || '').split(','), params.get('featureMap') || '']
      .map((id) => resolveLegacyLayerId(id.trim())).filter(Boolean));
    const active = this.elections?.activeEntry;
    if (active) {
      const sameElection = (params.get('electionBody') === active.body && params.get('electionDate') === active.date)
        || wanted.has(this.elections.getCanonicalLayerId?.(active));
      if (!sameElection) this.elections.unloadElection();
    }
    const backing = new Set(this.elections?.activeEntry ? this.elections.getActiveElectionBackingLayerIds?.() || [] : []);
    for (const id of this.getLoadedLayerIds()) {
      if (!wanted.has(id) && !backing.has(id) && this.isMapLoaded(id)) this.unloadMapNow(id);
    }
  }

  getCivilParishesCompositeChildIds(mapId, mapConfig) {
    const requestedIds = new Set([
      mapId,
      mapConfig?.id,
      mapConfig?.classId,
      mapConfig?.slug
    ].filter(Boolean));
    const shouldUseComposite = [...requestedIds].some((id) => CIVIL_PARISHES_COMPOSITE_PARENT_IDS.has(id));
    if (!shouldUseComposite) return [];
    return CIVIL_PARISHES_COMPOSITE_CHILD_IDS
      .filter((childId) => this.mapController.resolveLayer(childId)?.loadable);
  }

  getConvertedCompositeChildIds(mapConfig) {
    if (!mapConfig) return [];
    const explicitSources = Array.isArray(mapConfig.compositeSources) ? mapConfig.compositeSources : [];
    const variantSources = !mapConfig.isGroup && Array.isArray(mapConfig.variants)
      ? mapConfig.variants.map((variant) => variant.id)
      : [];
    const candidates = [...new Set([...explicitSources, ...variantSources].filter(Boolean))];
    return candidates.filter((id) => this.mapController.resolveLayer(id)?.loadable);
  }

  isPlaceholderTimelineMap(mapConfig) {
    if (!mapConfig) return true;
    const keywords = [
      ...(Array.isArray(mapConfig.keywords) ? mapConfig.keywords : []),
      ...(Array.isArray(mapConfig.rawMetadata?.keywords) ? mapConfig.rawMetadata.keywords : [])
    ].map((keyword) => String(keyword).trim().toLowerCase());
    const status = String(mapConfig.status || mapConfig.rawMetadata?.status || '').toLowerCase();
    return Boolean(
      mapConfig.placeholder
      || mapConfig.rawMetadata?.placeholder
      || mapConfig.thumbnail?.kind === 'placeholder'
      || keywords.includes('placeholder')
      || keywords.includes('to-be-added')
      || keywords.includes('to be added')
      || status.includes('to be added')
    );
  }

  isTimelineMapPlayable(mapId) {
    if (!mapId) return false;
    const mapConfig = dataService.getMapById(mapId);
    if (!mapConfig || this.isPlaceholderTimelineMap(mapConfig)) return false;
    const directLayer = this.mapController.resolveLayer(mapConfig.id || mapId);
    if (directLayer?.loadable) return true;
    if (mapConfig.isGroup && compositeChildIds(mapConfig).length) {
      return compositeChildIds(mapConfig).some((memberId) => this.isTimelineMapPlayable(memberId));
    }
    if (mapConfig.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      return mapConfig.variants.some((variant) => this.mapController.resolveLayer(variant?.id)?.loadable);
    }
    return this.getConvertedCompositeChildIds(mapConfig).length > 0;
  }

  renderCategoryPills() {
    uiController.renderCategoryPills(dataService.getMapCategories(), this.currentCategory);
    uiController.renderProviderPills(this.currentProviderCategory);
  }

  updateMapList() {
    const allMaps = dataService.getAllMaps();
    let maps = dataService.getMapsByCategory(this.currentCategory);

    if (this.currentAuthor !== 'all') {
      const authors = Array.isArray(this.currentAuthor) ? this.currentAuthor : [this.currentAuthor];
      maps = maps.filter((map) => authors.some((author) => map.provider?.includes(author)));
    }

    if (this.currentProviderCategory !== 'all-providers' && this.currentProviderList.length > 0) {
      maps = maps.filter((map) => {
        const providers = Array.isArray(map.provider) ? map.provider : map.provider ? [map.provider] : [];
        return providers.some((provider) => this.currentProviderList.includes(provider));
      });
    }

    if (this.searchQuery) {
      maps = this.searchMapsForCatalogue(this.searchQuery, allMaps);
      if (this.currentCategory !== 'all') maps = maps.filter((map) => map.category === this.currentCategory);
    }

    const featureCounts = new Map();
    maps.forEach((map) => {
      const count = featureLoader.getFeatureCount(map.id);
      if (count > 0) featureCounts.set(map.id, count);
    });

    uiController.renderMapList(maps, {
      visibleIds: this.mapController.getVisibleLayers(),
      loadedIds: this.getLoadedLayerIds(),
      featureCounts,
      totalMaps: this.publicMapCount(),
      // `shown` counted a DIFFERENT set from `total`, which is how "1,012 of 893 maps"
      // happened: a filtered count under the old rule against a total under the new one.
      shownMaps: Math.min(maps.length, this.publicMapCount())
    });
  }

  /**
   * The number the catalogue shows as "N maps".
   *
   * It used to be getAllMaps().length, which filters only `hidden` -- so the homepage
   * counted placeholders (dates known but not digitised, which cannot be looked at) and
   * reported 1,0xx while /browse reported 993 and the file holds 1,031 entries. Three
   * numbers for one question.
   *
   * The rule is in src/public-map.mjs and is shared with build-browse-indexes.mjs, so the
   * two surfaces cannot drift again. Loadability is decided by the RENDER record, because
   * the DoBIH layers carry no catalogue `files` yet draw perfectly.
   */
  publicMapCount() {
    // READ the stamped number; do not recompute it. Computing it here from the browser's
    // catalogue copy produced "1,012 of 893 maps" -- a third wrong answer -- because that
    // copy is not byte-identical to the file the other surfaces measure.
    // build-render-time-series-chains.mjs stamps it, and check:public-map-count pins it.
    const stamped = this.metadataService?.metadata?.publicMapCount;
    if (Number.isFinite(stamped)) return stamped;
    // Fallback only for a metadata load that has not landed yet.
    const layerIds = new Set((this.metadataService?.layers || []).map((layer) => layer.sourceMapId).filter(Boolean));
    return publicMaps(dataService.maps?.maps || [], (id) => layerIds.has(id)).length;
  }

  focusActiveElectionCatalogueEntry(entry, options = {}) {
    if (!entry?.body || !entry?.date) return;
    // An election opened from a party, person or constituency page leaves the reader on that
    // page: putting the catalogue list back under them lost the page they came from.
    if (this.currentPage && !document.getElementById('catalogueDetailView')?.classList.contains('hidden')) return;
    const restoreCatalogueListState = () => {
      this.searchQuery = '';
      this.currentCategory = 'all';
      this.currentProviderCategory = 'all-providers';
      this.currentProviderList = [];
      const search = document.getElementById('searchInput');
      if (search) search.value = '';
      document.getElementById('searchClear')?.classList.remove('visible');
      uiController.showCatalogueListView?.(false);
      this.updateMapList();
    };
    // The catalogue opens on a table of contents. Election rows exist only inside a
    // decade card that has been opened, so restoring an election from a URL used to have
    // nothing to mark: focusRow ran, saw rows: 0, and returned. It appeared to work only
    // when some earlier interaction had already opened a decade -- which is why the
    // browser test for it passed in company and failed alone.
    //
    // Open the decade that holds the election. The decade table lives in
    // ui-controller.js (decadeDefs); rather than copy those 12 rows here and let the two
    // drift, read the decade buttons the TOC has already rendered and match on label.
    // A decade the catalogue does not offer is therefore a no-op, not a wrong guess.
    const openDecadeForEntry = async () => {
      const year = Number.parseInt(String(entry.date).slice(0, 4), 10);
      if (!Number.isFinite(year)) return;
      const label = `${Math.floor(year / 10) * 10}s`;
      const button = [...document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc-decade-btn')]
        .find((el) => el.textContent.trim() === label);
      const targetId = button?.dataset?.catalogueTarget;
      if (!targetId) return;
      // ensureCatalogueTargetRendered returns early when the card is already open, so
      // retrying is free. Deliberately NOT handleFlatTocClick: that pushes a history
      // entry, and restoring state from a URL must not rewrite the URL it came from.
      await uiController.ensureCatalogueTargetRendered?.(targetId, 'elections');
    };

    // Budget in TIME, not in frames. The first version of this retried across four
    // animation frames -- about 60ms -- and the decade buttons it needs are not in the
    // DOM that early on a cold load, so every attempt found nothing and gave up before
    // the catalogue had rendered. Measured: clicking the decade button yields 170 rows
    // and the marking below then works, so the failure was purely one of timing.
    const FOCUS_DEADLINE_MS = 8000;
    const FOCUS_POLL_MS = 120;
    const focusDeadline = performance.now() + FOCUS_DEADLINE_MS;
    let listStateRestored = false;
    const focusRow = () => {
      const rows = [...document.querySelectorAll('#catalogueFlatView .flat-election-entry')];
      const target = rows.find((row) => row.dataset.electionBody === entry.body && row.dataset.electionDate === entry.date);
      if (!target) {
        if (performance.now() >= focusDeadline) return;
        if (!listStateRestored) {
          listStateRestored = true;
          restoreCatalogueListState();
        }
        Promise.resolve(openDecadeForEntry())
          .catch(() => {})
          .then(() => setTimeout(focusRow, FOCUS_POLL_MS));
        return;
      }
      rows.forEach((row) => {
        const active = row === target;
        row.classList.toggle('class-member--loaded', active);
        row.classList.toggle('flat-election-entry--active', active);
        const button = row.querySelector('.election-load-btn');
        if (button) button.setAttribute('title', active ? 'Unload' : 'Load');
      });
      target.querySelector('.election-load-btn')?.setAttribute('title', 'Unload');
      if (options.scroll) {
        const scroller = target.closest('.pane__content') || document.querySelector('.pane__content[data-tab-content="catalogue"]');
        if (scroller?.scrollTo) {
          scroller.scrollTo({ top: Math.max(0, target.offsetTop - 72), behavior: 'auto' });
        } else {
          target.scrollIntoView({ block: 'nearest' });
        }
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(focusRow));
  }

  setupSearch() {
    uiController.initializeFuse = () => {
      // The promoted MapLibre shell renders search results in the catalogue
      // body. Keep Fuse.js out of the critical path; search-worker/simple
      // fallback paths below provide the runtime search contract.
      uiController.fuse = null;
      uiController.searchItems = [];
    };
    const mapResultsProvider = (query, limit = 1000) => this.searchCatalogueWithWorker(query, limit);
    uiController.performSearch = async (query) => {
      const trimmed = String(query || '').trim();
      uiController.hideAutocomplete?.();
      this.searchQuery = trimmed;
      uiController._catalogueSearchQuery = trimmed;
      if (!trimmed) {
        this.workerSearchQuery = '';
        this.workerSearchResultIds = null;
        uiController.clearCatalogueSearchResults?.({ render: true });
        this.updateURLState();
        return [];
      }
      const ids = await mapResultsProvider(trimmed, 1000);
      if (this.searchQuery !== trimmed) return [];
      this.workerSearchQuery = trimmed;
      this.workerSearchResultIds = ids;
      await uiController.renderCatalogueSearchResults?.(trimmed, { mapResultIds: ids, mapResultsProvider });
      this.updateURLState();
      return ids;
    };
    uiController.onSearch = (query) => {
      const trimmed = String(query || '').trim();
      this.searchQuery = trimmed;
      uiController._catalogueSearchQuery = trimmed;
      if (!trimmed) {
        this.workerSearchQuery = '';
        this.workerSearchResultIds = null;
        uiController.clearCatalogueSearchResults?.({ render: true });
        this.updateMapList();
        this.updateURLState();
        return;
      }
      uiController.performSearch(trimmed).catch((error) => {
        console.warn('[App] Catalogue search failed:', error);
      });
    };
    uiController.setupSearch();
    // Enter searches addresses once (Nominatim) while suggestions-as-you-type are paused; see
    // src/catalogue/geocoder.js. With suggestions running it does nothing extra.
    document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      uiController._catalogueNext?.searchAddressesNow?.(event.target.value);
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.overflow-menu')) {
        document.querySelectorAll('.overflow-menu--open').forEach((menu) => menu.classList.remove('overflow-menu--open'));
      }
    });
  }

  prepareSearchWorker() {
    if (!('Worker' in window)) return;
    try {
      this.searchWorker = new Worker('/app/src/search-worker.js?v=app-search-001', { type: 'module' });
      this.searchWorker.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'ready') {
          this.searchWorkerReady = true;
          return;
        }
        if (message.type === 'results') {
          const callback = this.searchWorkerCallbacks.get(message.seq);
          if (!callback) return;
          this.searchWorkerCallbacks.delete(message.seq);
          callback.resolve(Array.isArray(message.ids) ? message.ids : []);
        }
      });
      this.searchWorker.addEventListener('error', () => {
        this.searchWorkerReady = false;
      });
      this.searchWorker.postMessage({
        type: 'init',
        maps: dataService.getAllMaps().map((map) => ({
          id: map.id,
          name: map.name,
          category: map.category,
          group: map.group,
          provider: map.provider,
          description: map.description,
          date: map.date,
          dateRange: map.dateRange,
          keywords: map.keywords
        }))
      });
    } catch (error) {
      console.warn('[Test2] Search worker unavailable', error);
      this.searchWorker = null;
    }
  }

  async searchCatalogueWithWorker(query, limit = 200) {
    const trimmed = String(query || '').trim();
    if (!trimmed || trimmed.length < 1) return [];
    if (!this.searchWorker) return this.simpleSearchMapIds(trimmed, limit);
    const seq = ++this.searchWorkerSeq;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.searchWorkerCallbacks.delete(seq);
        resolve(this.simpleSearchMapIds(trimmed, limit));
      }, 900);
      this.searchWorkerCallbacks.set(seq, {
        resolve: (ids) => {
          clearTimeout(timeout);
          resolve(ids);
        }
      });
      this.searchWorker.postMessage({ type: 'search', query: trimmed, limit, seq });
    });
  }

  searchMapsForCatalogue(query, allMaps) {
    if (this.workerSearchQuery === query && Array.isArray(this.workerSearchResultIds)) {
      const idSet = new Set(this.workerSearchResultIds);
      return allMaps.filter((map) => idSet.has(map.id));
    }
    const fallbackIds = new Set(this.simpleSearchMapIds(query, 1000));
    return allMaps.filter((map) => fallbackIds.has(map.id));
  }

  simpleSearchMapIds(query, limit = 200) {
    const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return dataService.getAllMaps()
      .map((map) => {
        const text = normalizeSearchText([
          map.id,
          map.name,
          map.category,
          map.group,
          map.provider,
          map.description,
          map.date,
          map.dateRange,
          ...(Array.isArray(map.keywords) ? map.keywords : [])
        ].flat().filter(Boolean).join(' '));
        const name = normalizeSearchText(map.name || '');
        if (!terms.every((term) => text.includes(term))) return null;
        const score = terms.reduce((sum, term) => sum + (name.startsWith(term) ? 100 : (name.includes(term) ? 60 : 10)), 0);
        return { id: map.id, score, name: map.name || '' };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map((item) => item.id);
  }

  setupThemeToggle() {
    // The shared site header (partials/site-header.html) brings its own toggle, wired by
    // assets/site/site-chrome.js. The map only follows the theme, so binding a second click
    // handler here would flip it twice.
    if (document.querySelector('.app-header[data-site-chrome]')) {
      void this.syncBasemapToTheme();
      document.addEventListener('civgraph:themechange', () => void this.syncBasemapToTheme());
      return;
    }
    const toggles = [document.getElementById('themeToggle'), document.getElementById('themeToggleMobile')].filter(Boolean);
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = savedTheme || (prefersDark ? 'dark' : 'light');

    // T1-06: the basemap follows the theme from the first paint, not just on
    // toggle — someone arriving with prefers-color-scheme: dark should not get one
    // frame of white landmass. Fire-and-forget: applyBaseMap already handles the
    // map not being ready, and nothing here should block setup.
    void this.syncBasemapToTheme();

    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
        void this.syncBasemapToTheme();
      });
    });
  }

  setupSupportModal() {
    // Owned by assets/site/site-chrome.js when the shared site header is present.
    if (document.querySelector('.app-header[data-site-chrome]')) return;
    const modal = document.getElementById('supportModal');
    const buttons = [document.getElementById('supportBtn'), document.getElementById('mobileSupportBtn')].filter(Boolean);
    if (!modal || buttons.length === 0) return;

    // T3-06. The markup already declared role="dialog" aria-modal="true", which PROMISES
    // a keyboard user that focus is confined to the dialog and returns when it closes.
    // Nothing implemented that: focus stayed wherever it was, Tab walked straight out
    // into the page behind, and closing left focus nowhere. aria-modal="true" also tells
    // a screen reader the background is inert, so without this the announcement was
    // simply untrue.
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    let lastFocused = null;

    const focusables = () => [...modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      // Wrap at both ends, and also catch the case where focus has escaped the modal
      // entirely (a click on the background, a browser quirk) by pulling it back.
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    // Everything that is NOT the modal, so the background can be made inert. Computed on
    // open rather than cached: the shell is built at runtime and children change.
    const backgroundSiblings = () => [...document.body.children].filter((el) => el !== modal);

    const open = () => {
      lastFocused = document.activeElement;
      modal.classList.remove('hidden');
      backgroundSiblings().forEach((el) => {
        el.setAttribute('aria-hidden', 'true');
        if ('inert' in el) el.inert = true;
      });
      document.addEventListener('keydown', trap, true);
      (focusables()[0] || modal).focus();
    };

    const close = () => {
      modal.classList.add('hidden');
      backgroundSiblings().forEach((el) => {
        el.removeAttribute('aria-hidden');
        if ('inert' in el) el.inert = false;
      });
      document.removeEventListener('keydown', trap, true);
      // Return focus to whatever opened it, not to <body>.
      if (lastFocused && typeof lastFocused.focus === 'function' && document.contains(lastFocused)) {
        lastFocused.focus();
      }
      lastFocused = null;
    };

    buttons.forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault();
      open();
    }));
    modal.querySelector('.support-modal__backdrop')?.addEventListener('click', close);
    modal.querySelector('.support-modal__close')?.addEventListener('click', close);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
  }

  /**
   * T1-09: Escape closes the map overlays.
   *
   * #supportModal already handled Escape; these three did not, so a keyboard user
   * could open the map controls, the active-layers panel or a feature popup with no
   * way to dismiss it except by finding the close button.
   *
   * One press closes one thing, topmost first, so Escape does not clear the whole
   * screen at once. Ignored while a text field has focus, where Escape usually means
   * "revert what I am typing", and while the support modal is open, since it owns
   * Escape itself.
   */
  setupOverlayEscape() {
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const modal = document.getElementById('supportModal');
      if (modal && !modal.classList.contains('hidden')) return;

      const featureInfo = document.getElementById('featureInfo');
      if (featureInfo && !featureInfo.classList.contains('hidden')) {
        uiController.hideFeatureInfo?.();
        return;
      }
      if (document.getElementById('activeLayersToggle')?.getAttribute('aria-expanded') === 'true') {
        this.setActiveLayersPanelOpen(false);
        document.getElementById('activeLayersToggle')?.focus({ preventScroll: true });
        return;
      }
      if (document.getElementById('mapControlsToggle')?.getAttribute('aria-expanded') === 'true') {
        this.setMapControlsOpen(false);
        document.getElementById('mapControlsToggle')?.focus({ preventScroll: true });
      }
    });
  }

  setupMapControls() {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlPanel = document.getElementById('mapControlPanel');
    const mapControlsClose = document.getElementById('mapControlsClose');
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayers = document.getElementById('activeLayers');
    const activeLayersClose = document.getElementById('activeLayersClose');
    const featureInfoClose = document.getElementById('featureInfoClose');

    mapControlsToggle?.addEventListener('click', () => {
      this.setMapControlsOpen(mapControlsToggle.getAttribute('aria-expanded') !== 'true', { focus: true });
    });
    mapControlsClose?.addEventListener('click', () => this.setMapControlsOpen(false, { focus: true }));

    const overlayToggle = document.getElementById('overlayToggle');
    const overlayList = document.getElementById('overlayList');
    overlayToggle?.addEventListener('click', () => {
      const open = overlayToggle.getAttribute('aria-expanded') !== 'true';
      overlayToggle.setAttribute('aria-expanded', String(open));
      overlayList?.classList.toggle('overlay-list--collapsed', !open);
      overlayList?.classList.toggle('overlay-list--expanded', open);
    });

    document.getElementById('baseMapSelect')?.addEventListener('change', async (event) => {
      await this.applyBaseMap(event.target.value || 'osm-standard', { userChoice: true });
      this.updateURLState();
    });

    const outlineSlider = document.getElementById('transparencySlider');
    const outlineValue = document.getElementById('transparencyValue');
    outlineSlider?.addEventListener('input', () => {
      const value = Number(outlineSlider.value);
      this.mapController.setTransparency(value);
      if (outlineValue) outlineValue.textContent = `${value}%`;
      this.updateURLState();
    });

    const fillSlider = document.getElementById('fillTransparencySlider');
    const fillValue = document.getElementById('fillTransparencyValue');
    fillSlider?.addEventListener('input', () => {
      const value = Number(fillSlider.value);
      this.mapController.setFillTransparency(value);
      if (fillValue) fillValue.textContent = `${value}%`;
      this.updateURLState();
    });

    document.getElementById('labelsToggle')?.addEventListener('change', (event) => {
      this.mapController.setLabelsEnabled(event.target.checked);
      this.updateURLState();
    });

    let textScale = Number(readStored('textScale') || '100');
    const textSteps = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const textValue = document.getElementById('textSizeValue');
    const applyTextScale = () => {
      if (textValue) textValue.textContent = `${textScale}%`;
      this.mapController.setTextScale(textScale);
      writeStored('textScale', textScale);
      this.updateURLState();
    };
    document.getElementById('textSizeDecrease')?.addEventListener('click', () => {
      const index = textSteps.indexOf(textScale);
      textScale = textSteps[Math.max(0, index - 1)] || 100;
      applyTextScale();
    });
    document.getElementById('textSizeIncrease')?.addEventListener('click', () => {
      const index = textSteps.indexOf(textScale);
      textScale = textSteps[Math.min(textSteps.length - 1, index + 1)] || 100;
      applyTextScale();
    });
    applyTextScale();

    activeLayersToggle?.addEventListener('click', () => {
      this.setActiveLayersPanelOpen(activeLayersToggle.getAttribute('aria-expanded') !== 'true', { focus: true });
    });
    activeLayersClose?.addEventListener('click', () => this.setActiveLayersPanelOpen(false, { focus: true }));
    featureInfoClose?.addEventListener('click', () => uiController.hideFeatureInfo());

    document.getElementById('conditionalStylingBtn')?.addEventListener('click', () => {
      this.showMapError(new Error('Conditional styling controls use MapLibre expressions; this route currently supports base opacity, labels, and text scale.'));
    });

    this.mapController.map?.on('moveend', () => this.updateURLState());
  }

  setupPerformanceDashboard() {
    document.getElementById('performanceDashboard')?.setAttribute('hidden', '');
    const button = document.getElementById('performanceDashboardRefresh');
    const render = () => this.renderPerformanceDashboard().catch((error) => {
      const target = document.getElementById('performanceDashboardStatus');
      if (target) target.textContent = `Performance status unavailable: ${error?.message || error}`;
    });
    button?.addEventListener('click', render);
  }

  /**
   * Open a party, person or constituency page in the catalogue pane.
   *
   * UX review 2026-10-31 (H4, H6). The page used to appear only once its data had arrived (a
   * constituency took 6.9 s, with nothing on screen meanwhile), vanished without a word when the
   * lookup missed, and had no address: a reload or a shared link lost it, and browser Back undid
   * the map behind it while the pane stayed put. Now the page shell and its name show at once,
   * the step is a history entry with the page in the address (page=party:dup), a miss or a
   * failure says so with a Retry, and Back returns to the page before.
   *
   * options.fromHistory: reopening from the address (Back, Forward, a reload or a shared link),
   * so no new history entry is made and the page keeps its scroll and table state.
   */
  async openElectionEntityDetailInCatalogue(kind, key, options = {}) {
    const pageKind = canonicalEntityKind(kind);
    const keyText = String(key ?? '').trim();
    if (!pageKind || !keyText) return false;
    const token = (this.entityPageToken = (this.entityPageToken || 0) + 1);
    const label = options.label || entityKeyLabel(pageKind, keyText);
    const typeLabel = ENTITY_TYPE_LABEL[pageKind] || 'Page';
    const requested = { kind: pageKind, key: keyText, title: label, typeLabel };
    if (!options.fromHistory) this.beginNavigation(`${typeLabel}: ${label}`);
    this.currentPage = requested;
    this.currentDetailMapId = null;
    this.revealCatalogueOnPhone();
    uiController.showElectionEntityPlaceholder?.({ kind: pageKind, key: keyText, label, typeLabel, state: 'loading' }, { addToHistory: !options.fromHistory });
    this.endNavigation();

    let detail = null;
    let failure = null;
    try {
      detail = await this.loadElectionEntityBrowseDetail(pageKind, keyText);
    } catch (error) {
      failure = error;
    }
    // The reader has moved on (another page, the list, Back) while this one loaded: it must not
    // replace what they are now looking at.
    if (token !== this.entityPageToken || this.currentPage !== requested) return true;

    if (!detail || detail.kind === 'candidate-choice') {
      if (failure) console.warn('[Test2] Catalogue page could not be loaded', pageKind, keyText, failure);
      uiController.showElectionEntityPlaceholder?.({
        kind: pageKind,
        key: keyText,
        label,
        typeLabel,
        state: detail ? 'choice' : (failure ? 'error' : 'missing'),
        choices: detail?.choices || [],
        browseUrl: entityBrowseSearchUrl(pageKind, label),
        retry: () => this.openElectionEntityDetailInCatalogue(pageKind, keyText, { ...options, fromHistory: true })
      }, { addToHistory: false });
      this.announce(detail ? `More than one person is called ${label}: choose one.` : `${label} could not be ${failure ? 'loaded' : 'found'}.`);
      return true;
    }

    // Cached under the key it was asked for as well as its own, so the pane's history and the
    // address can name it either way.
    uiController._electionEntityDetailCache?.set(uiController.createElectionEntityDetailId(pageKind, keyText), detail);
    uiController.showElectionEntityDetailInCatalogue(detail, false, {
      restoreState: Boolean(options.fromHistory),
      focus: options.focus !== false
    });
    // The address names the page by its canonical key (the party's slug, the person's), so a
    // copied link reads the same whichever spelling opened it.
    this.currentPage = { kind: pageKind, key: detail.key || keyText, title: detail.name || label, typeLabel };
    this.updateURLState();
    return true;
  }

  async loadElectionEntityBrowseDetail(kind, key) {
    const normalizedKind = canonicalEntityKind(kind);
    const cacheKey = `${normalizedKind}:${key || ''}`;
    if (this.browseEntityDetailCache.has(cacheKey)) return this.browseEntityDetailCache.get(cacheKey);
    let detail = null;
    if (normalizedKind === 'party') {
      detail = await this.loadPartyBrowseDetail(key);
    } else if (normalizedKind === 'candidate') {
      detail = await this.loadPersonBrowseDetail(key);
    } else if (['constituency', 'dea', 'lgd'].includes(normalizedKind)) {
      detail = await this.loadAreaBrowseDetail(normalizedKind, key);
    }
    // A chooser is not cached: the reader's choice opens the person by id.
    if (detail && detail.kind !== 'candidate-choice') this.browseEntityDetailCache.set(cacheKey, detail);
    return detail;
  }

  /**
   * The party registry as Browse lists it (/data/browse/parties.json): every party with its
   * full name, short name, aliases and colour, keyed by each spelling. A results table names a
   * party as the ballot did ("Ulster Unionist", "Official Unionist"), and only the registry
   * knows that both are the UUP; a spelling two records share goes to the one with more
   * linked elections, the party rather than a ballot-paper label.
   */
  async loadPartyIndex() {
    if (!this.partyIndexPromise) {
      this.partyIndexPromise = fetch('/data/browse/parties.json', { cache: 'default' })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`parties index ${response.status}`))))
        .then((payload) => {
          const items = Array.isArray(payload?.items) ? payload.items : [];
          const byAlias = new Map();
          const ranked = [...items].sort((a, b) => (Number(b.relatedElectionCount) || 0) - (Number(a.relatedElectionCount) || 0));
          for (const item of ranked) {
            for (const name of [item.slug, item.title, item.shortName, item.canonicalName, ...(item.knownAliases || []), ...(item.observedNames || [])]) {
              const k = normalizeEntityName(name);
              if (k && !byAlias.has(k)) byAlias.set(k, item);
            }
          }
          return { items, byAlias };
        })
        .catch((error) => {
          this.partyIndexPromise = null;
          console.warn('[Test2] Party index unavailable', error);
          return { items: [], byAlias: new Map() };
        });
    }
    return this.partyIndexPromise;
  }

  partyFromIndex(index, name) {
    if (!index?.byAlias || !name) return null;
    return index.byAlias.get(normalizeEntityName(name))
      || index.byAlias.get(normalizeEntityName(partyFullName(name)))
      || null;
  }

  partyColourFrom(index, name) {
    const hit = this.partyFromIndex(index, name);
    const colour = hit?.colour;
    return colour && colour !== '#6b7280' ? colour : '#888';
  }

  async loadPartyBrowseDetail(key) {
    const index = await this.loadPartyIndex();
    const hit = this.partyFromIndex(index, key);
    const slug = slugifyEntityKey(key);
    const candidates = [...new Set([hit?.slug, slug, String(key || '').trim().toLowerCase()].filter(Boolean))];
    let failure = null;
    for (const candidateSlug of candidates) {
      let response;
      try {
        response = await fetch(`/data/browse/details/parties/${encodeURIComponent(candidateSlug)}.json`, { cache: 'default' });
      } catch (error) {
        failure = error;
        continue;
      }
      if (response.status === 404) continue;
      if (!response.ok) { failure = new Error(`party ${candidateSlug}: ${response.status}`); continue; }
      const detail = await response.json();
      const item = detail.item || detail;
      const persons = await this.loadPartyPersons(item);
      return this.mapPartyBrowseItem(item, persons, index);
    }
    // Nothing found and something failed on the way: that is "could not load", not "no such party".
    if (failure) throw failure;
    return null;
  }

  /**
   * One person, by key. Served from D1 (/_api/persons?slug=), not from the shards.
   *
   * The key is the person's id or slug wherever the link knows it -- a results table's
   * candidate button carries the source person id (UX review 2026-10-31, H5). A bare name was
   * the old key, and opened whoever held the bare-name slug: the Alliance Ian Paisley of
   * Holywood got the DUP leader's page. A name, with the party and date where known
   * ("Name|Party|date"), is now searched for, narrowed to the people who stood for that party
   * then, and answered with a chooser if more than one remains.
   *
   * The endpoint 404s honestly on a miss, which the shard walk could not do. The static shards
   * remain the fallback when the endpoint itself is unavailable, so a Functions outage degrades
   * rather than breaks.
   */
  async loadPersonBrowseDetail(key) {
    const raw = String(key || '').trim();
    const [namePart = '', partyPart = '', datePart = ''] = raw.split('|').map((part) => part.trim());
    const isNameKey = raw.includes('|');
    const partyIndex = await this.loadPartyIndex();
    let endpointDown = false;

    const fetchOne = async (slug) => {
      const response = await fetch(`/_api/persons?slug=${encodeURIComponent(slug)}`, { cache: 'default' });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`persons ${response.status}`);
      const payload = await response.json();
      return payload?.person || null;
    };

    if (!isNameKey) {
      const direct = raw.replace(/^(id|person|candidate|name):/i, '');
      try {
        const person = await fetchOne(direct) || (slugifyEntityKey(direct) !== direct ? await fetchOne(slugifyEntityKey(direct)) : null);
        if (person) return this.mapPersonBrowseItem(person, partyIndex);
      } catch {
        endpointDown = true;
      }
    }

    if (!endpointDown && namePart) {
      try {
        const response = await fetch(`/_api/persons?q=${encodeURIComponent(namePart)}&limit=50`, { cache: 'default' });
        if (!response.ok) throw new Error(`persons search ${response.status}`);
        const payload = await response.json();
        const wanted = normalizeEntityName(namePart);
        const sameName = (payload?.persons || []).filter((person) => [person.name, person.title, ...(person.names || []).map((n) => n.name)]
          .some((name) => normalizeEntityName(name) === wanted));
        const stoodFor = (person) => (person.elections || []).some((row) => (!partyPart || normalizeEntityName(row.party) === normalizeEntityName(partyPart)
          || this.partyFromIndex(partyIndex, row.party)?.slug === this.partyFromIndex(partyIndex, partyPart)?.slug)
          && (!datePart || row.date === datePart));
        // With a party (or date) to go on, a same-named person who never stood for it is a
        // namesake: no page is better than the wrong person's.
        const narrowed = sameName.filter(stoodFor);
        const pool = partyPart || datePart ? narrowed : sameName;
        if (pool.length === 1) return this.mapPersonBrowseItem(pool[0], partyIndex);
        if (pool.length > 1) {
          return {
            kind: 'candidate-choice',
            key: raw,
            name: namePart,
            choices: pool.map((person) => ({ key: person.slug || person.id, name: person.name || person.title, subtitle: person.subtitle || '' }))
          };
        }
      } catch {
        endpointDown = true;
      }
    }

    if (!endpointDown) return null;
    // The endpoint is unavailable: the slow path, by name or slug, as before.
    const wanted = slugifyEntityKey(raw);
    const rawNameSlug = slugifyEntityKey(namePart);
    const item = await this.findBrowsePerson((person) => {
      const slugs = [person.slug, person.id, person.name, person.title].map(slugifyEntityKey);
      return slugs.includes(wanted) || (rawNameSlug && slugs.includes(rawNameSlug));
    });
    return item ? this.mapPersonBrowseItem(item, partyIndex) : null;
  }

  /**
   * The persons who stood for one party, for its candidate summaries.
   *
   * buildPartyCandidateSummaries() matches on a party's aliases -- canonical name, title,
   * observed names, known aliases -- so all of them are sent.
   *
   * The endpoint returns at most 200 a request, and the DUP, Sinn Féin and Fianna Fáil each
   * have more: the page said "Candidates (200)" as if that were the party's total (UX review
   * 2026-10-31, H2). It is asked page by page; if it does not page (a second page identical to
   * the first, as the party query did before it took an offset) the result is marked capped and
   * the page says the list is partial.
   */
  async loadPartyPersons(item = {}) {
    const aliases = [...new Set([
      item.canonicalName,
      item.title,
      item.shortName,
      ...(item.observedNames || []),
      ...(item.knownAliases || []),
    ].filter(Boolean))];
    if (!aliases.length) return { persons: [], capped: false };
    const PAGE = 200;
    const MAX_PAGES = 20;
    const persons = [];
    const seen = new Set();
    let capped = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams();
      for (const alias of aliases) params.append('party', alias);
      params.set('limit', String(PAGE));
      if (page) params.set('offset', String(page * PAGE));
      let payload = null;
      try {
        const response = await fetch(`/_api/persons?${params}`, { cache: 'default' });
        if (response.ok) payload = await response.json();
      } catch { /* handled below */ }
      if (!Array.isArray(payload?.persons)) {
        if (page === 0) {
          // Same degradation as the person lookup: the whole index, only when the endpoint is down.
          return { persons: await this.loadBrowsePersonsIndex().catch(() => []), capped: false };
        }
        capped = true;
        break;
      }
      const fresh = payload.persons.filter((person) => {
        const id = String(person.id || person.slug || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      if (page > 0 && !fresh.length && payload.persons.length) { capped = true; break; }
      persons.push(...fresh);
      if (payload.persons.length < PAGE) break;
      if (Number.isFinite(Number(payload.total)) && persons.length >= Number(payload.total)) break;
      if (page === MAX_PAGES - 1) capped = true;
    }
    return { persons, capped };
  }

  async loadAreaBrowseDetail(kind, key) {
    const name = String(key || '').trim();
    if (!name) return null;
    const elections = await this.ensureElections();
    const catalogueEntries = Array.isArray(elections?.catalogue?.elections) ? elections.catalogue.elections : [];
    const target = normalizeEntityName(name);
    const entries = catalogueEntries.filter((entry) => {
      const candidateNames = kind === 'lgd'
        ? [...(entry.localBodies || []), entry.body]
        : (entry.constituencies || []);
      const mayContainTarget = candidateNames.some((candidate) => normalizeEntityName(candidate) === target);
      return mayContainTarget || (kind === 'constituency' && entry.key === this.elections?.activeEntry?.key);
    });
    // Four bundles at a time rather than one after another: a constituency contested in fifty
    // elections took 6.9 s to open (UX review 2026-10-31, H6).
    const perEntry = await mapWithConcurrency(entries, 4, async (entry) => {
      let bundle = null;
      try {
        bundle = await elections.loadBundle(entry);
      } catch {
        return [];
      }
      const matchingResults = (bundle?.results || []).filter((result) => {
        if (kind === 'lgd') {
          return normalizeEntityName(result.localBody || result.localGovernmentDistrict || result.council || result.bodyLabel || '') === target;
        }
        return normalizeEntityName(result.constituency || result.matchName || result.featureName || '') === target;
      });
      if (!matchingResults.length) return [];
      if (kind === 'lgd') return [this.mapCouncilAreaHistoryRow(entry, bundle, name, matchingResults)];
      return matchingResults.map((result) => this.mapConstituencyAreaHistoryRow(entry, bundle, result, kind));
    });
    // Oldest first, as Browse lists elections.
    const rows = perEntry.flat()
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.electionDisplayName || '').localeCompare(String(b.electionDisplayName || '')));
    if (!rows.length) return null;
    const general = rows.filter((row) => !row.isByElection);
    const latest = (general.length ? general : rows)[(general.length ? general : rows).length - 1];
    const latestElectedRow = [...rows].reverse().find((row) => row.electedNames?.length) || null;
    const metrics = {
      elections: rows.length,
      byElections: rows.length - general.length,
      districts: [...new Set(rows.map((row) => normalizeEntityName(row.localGovernmentDistrict)).filter(Boolean))].length,
      deas: kind === 'lgd'
        ? Math.max(0, ...rows.map((row) => Number(row.deaCount || 0)))
        : rows.length,
      firstYear: Number(String(rows[0]?.date || '').slice(0, 4)) || null,
      lastYear: Number(String(rows[rows.length - 1]?.date || '').slice(0, 4)) || null,
      latestDate: latest?.date || null,
      latestLeadingParty: latest?.winnerParty || '',
      latestElection: latestElectedRow?.electionDisplayName || '',
      latestElected: latestElectedRow?.electedNames || []
    };
    return {
      kind,
      key: name,
      name,
      colour: latest?.winnerColour || '#64748b',
      subtitle: kind === 'lgd' ? 'Local Government District / Council' : kind === 'dea' ? 'District Electoral Area' : 'Constituency',
      metrics,
      historyRows: rows,
      browseUrl: entityBrowseSearchUrl(kind, name)
    };
  }

  installLazyCatalogueDataBridge() {
    if (uiController.__test2LazyCatalogueDataBridgeInstalled) return;
    uiController.__test2LazyCatalogueDataBridgeInstalled = true;
    const ensureTarget = uiController.ensureCatalogueTargetRendered?.bind(uiController);
    if (ensureTarget) {
      uiController.ensureCatalogueTargetRendered = async (targetId, sectionKey = null) => {
        const resolvedSection = sectionKey || uiController._flatTargetToSection?.get?.(targetId);
        if (resolvedSection === 'books') await this.loadBooks();
        return ensureTarget(targetId, sectionKey);
      };
    }
    const openBookViewer = uiController.openCatalogueBookViewer?.bind(uiController);
    if (openBookViewer) {
      uiController.openCatalogueBookViewer = async (...args) => {
        await this.loadBooks();
        return openBookViewer(...args);
      };
    }
  }

  installLazyRuntimeHelpersBridge() {
    if (uiController.__test2LazyRuntimeHelpersBridgeInstalled) return;
    uiController.__test2LazyRuntimeHelpersBridgeInstalled = true;

    const downloadFeature = uiController.downloadFeature?.bind(uiController);
    if (downloadFeature) {
      uiController.downloadFeature = async (detailId, format) => {
        if (format === 'fgb') await this.ensureFlatgeobufRuntime();
        return downloadFeature(detailId, format);
      };
    }

    const loadAttributeSchema = uiController.loadAttributeSchema?.bind(uiController);
    if (loadAttributeSchema) {
      uiController.loadAttributeSchema = async (...args) => {
        await this.ensureFlatgeobufRuntime();
        return loadAttributeSchema(...args);
      };
    }
  }

  // The browse persons index was SHARDED (11,964 people across three files) and this
  // reader was not updated. persons.json is now a 628-byte manifest with no `items`, so
  // `payload.items` was undefined, the index resolved to [], and every person link
  // silently failed -- openElectionEntityDetailInCatalogue returned false, the handler
  // logged a console warning, and nothing happened on screen. Party details lost their
  // candidate summaries to the same cause without anything reporting it.
  //
  // Same manifest handling as browse/browse.js:3456, which has read it correctly all
  // along. A flat payload still works, so this does not depend on the layout staying
  // sharded.
  async fetchBrowseIndexItems(url) {
    const response = await fetch(url, { cache: 'default' });
    if (!response.ok) throw new Error(`Browse index failed: ${response.status} ${url}`);
    const payload = await response.json();
    if (payload?.indexLayout === 'sharded' && Array.isArray(payload.shards)) {
      const shards = await Promise.all(payload.shards.map((shard) => this.fetchBrowseIndexItems(shard.url)));
      return shards.flat();
    }
    return Array.isArray(payload.items) ? payload.items : [];
  }

  async loadBrowsePersonsIndex() {
    if (!this.browsePersonsIndexPromise) {
      this.browsePersonsIndexPromise = this.fetchBrowseIndexItems('/data/browse/persons.json');
    }
    return this.browsePersonsIndexPromise;
  }

  // Resolving ONE person should not cost the whole index. The shards total 24 MB, so
  // walk them in order and stop at the first match -- a person click usually pays for a
  // single shard. Falls back to the full index for a flat payload, and reuses the full
  // index when something else has already loaded it.
  async findBrowsePerson(matches) {
    if (this.browsePersonsIndexPromise) {
      const all = await this.browsePersonsIndexPromise;
      return all.find(matches) || null;
    }
    const response = await fetch('/data/browse/persons.json', { cache: 'default' });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!(payload?.indexLayout === 'sharded' && Array.isArray(payload.shards))) {
      return (Array.isArray(payload.items) ? payload.items : []).find(matches) || null;
    }
    for (const shard of payload.shards) {
      const items = await this.fetchBrowseIndexItems(shard.url).catch(() => []);
      const hit = items.find(matches);
      if (hit) return hit;
    }
    return null;
  }

  mapPartyBrowseItem(item, personsResult = {}, partyIndex = null) {
    const related = Array.isArray(item.relatedElections) ? item.relatedElections : [];
    // Oldest first, as Browse lists a party's elections, so the two pages read the same way.
    const historyRows = addPartyChanges(related.map((row) => this.mapPartyHistoryRow(row)))
      .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
    const persons = Array.isArray(personsResult) ? personsResult : (personsResult.persons || []);
    const { summaries, listEntries } = this.buildPartyCandidateSummaries(item, persons, partyIndex);
    const slug = item.slug || slugifyEntityKey(item.canonicalName || item.title);
    const shortName = item.shortName || (item.canonicalName && item.canonicalName !== item.title ? item.canonicalName : '');
    return {
      kind: 'party',
      key: slug,
      slug,
      // The full name heads the page and the abbreviation sits beneath it (UX review 2026-10-31,
      // L7: "AO" or "Ind O" in a results table meant nothing on a phone, where <abbr> cannot be read).
      name: item.title || item.canonicalName || slug,
      shortName,
      colour: item.colour || item.color || item.partyColour || '#6b7280',
      headlineCards: partyHeadlineCards(historyRows),
      historyRows,
      partySummaries: historyRows,
      candidateSummaries: summaries,
      // The persons endpoint returns at most 200 a page; when it cannot page further the list is
      // said to be partial rather than presented as the party's total (H2).
      candidatesCapped: Boolean(personsResult.capped),
      listEntriesLeftOut: listEntries,
      totals: item.totals || {},
      observedNames: item.observedNames || [],
      knownAliases: item.knownAliases || [],
      firstYear: item.firstYear,
      lastYear: item.lastYear,
      relatedElectionCount: related.length,
      browseUrl: `/browse/#/parties/${encodeURIComponent(slug)}`
    };
  }

  mapPersonBrowseItem(item, partyIndex = null) {
    const elections = Array.isArray(item.elections) ? item.elections : [];
    // Oldest first, numbered as they go (the 3rd time standing, the 2nd win), as Browse lists them.
    const appearances = addStandings(elections.map((row) => this.mapPersonAppearanceRow(row)));
    const latest = appearances[appearances.length - 1] || null;
    const latestParty = latest?.party || item.parties?.[0]?.name || '';
    const slug = item.slug || String(item.id || '') || slugifyEntityKey(item.name || item.title);
    const stood = knownCount(item.totals?.stood) ?? appearances.length;
    const won = knownCount(item.totals?.elected) ?? appearances.filter((row) => row.elected).length;
    const votesKnown = appearances.some((row) => row.firstPref !== null);
    return {
      kind: 'candidate',
      key: slug,
      slug,
      personId: item.id || '',
      name: item.name || item.title || '',
      latestParty,
      // The person record has no colour; their latest party's, rather than a grey swatch (M3).
      colour: this.partyColourFrom(partyIndex, latestParty),
      // Each party once: "Protestant Unionist" and "Protestant Unionist Party" are one party.
      parties: [...new Map((item.parties || []).map((party) => party.name || party).filter(Boolean)
        .map((name) => [this.partyFromIndex(partyIndex, name)?.slug || normalizeEntityName(partyFullName(name)), name])).values()],
      constituencyGroups: groupConstituencies(appearances),
      appearances,
      firstPrefs: votesKnown ? knownCount(item.totals?.firstPrefs, true) : null,
      electedCount: won,
      stoodCount: stood,
      firstYear: item.firstYear || null,
      lastYear: item.lastYear || null,
      born: item.born || null,
      died: item.died || null,
      lifeSource: [...new Set([item.bornSource, item.diedSource].filter(Boolean))].join(', '),
      officialProfiles: Array.isArray(item.officialProfiles) ? item.officialProfiles : [],
      browseUrl: `/browse/#/persons/${encodeURIComponent(slug)}`
    };
  }

  mapPartyHistoryRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key) || row.body || '';
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    const label = `${row.title || ''} ${row.key || ''}`;
    const elected = knownCount(row.seats ?? row.elected);
    // Browse's reading of the summary: a 0 beside seats won is a count it did not carry.
    const stood = knownCount(row.stood ?? row.candidates, Number(elected) > 0);
    const votes = knownCount(row.votes ?? row.firstPrefs, Number(elected) > 0 || Number(stood) > 0);
    const share = votes === null ? null : knownCount(row.share ?? row.validVotePct);
    const totalSeats = knownCount(row.totalSeats, true);
    return {
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: body,
      bodyGroup: bodyGroupOf(electionType),
      date: row.date || '',
      electionType,
      rank: knownCount(row.rank, true),
      contested: !/referendum|recall/i.test(label),
      isRecallPetition: /recall petition/i.test(label),
      isByElection: /by-election|bye-election/i.test(label),
      stood,
      elected,
      totalSeats,
      seatPct: totalSeats && elected !== null ? elected / totalSeats * 100 : null,
      constituenciesContested: knownCount(row.constituenciesContested ?? row.constituencies, true),
      firstPrefs: votes,
      validVotePct: share,
      // Filled by addPartyChanges().
      electedDelta: null,
      stoodDelta: null,
      firstPrefsDelta: null,
      validVotePctDelta: null
    };
  }

  mapPersonAppearanceRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key);
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    // A candidate with no votes at all does not happen; a 0 here is a vote the source did not
    // record (the 1996 Forum's lists), so it is shown as unknown.
    const firstPref = knownCount(row.firstPref ?? row.firstPrefs ?? row.votes, true);
    const status = normaliseStatus({ ...row, firstPref });
    return {
      electionKey: row.key || '',
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: electionType === 'Local' ? (row.localBody || row.bodyLabel || body) : body,
      bodyGroup: bodyGroupOf(electionType),
      date: row.date || '',
      constituency: row.constituency || '',
      party: row.party || '',
      status: status.label,
      statusSource: status.raw,
      rank: knownCount(row.rank, true),
      firstPref,
      firstPrefs: firstPref,
      firstPrefPct: knownCount(row.firstPrefPct ?? row.share),
      elected: status.elected,
      electionType,
      isByElection: /by-election|bye-election/i.test(`${row.title || ''} ${row.key || ''}`)
    };
  }

  /**
   * Everyone who stood for the party, with how often they stood and won and where. Labels such as
   * "DUP list" -- the 1996 Forum's regional lists -- are counted separately, not listed as people
   * (UX review 2026-10-31, H8).
   */
  buildPartyCandidateSummaries(item = {}, persons = [], partyIndex = null) {
    const aliases = new Set([
      item.canonicalName,
      item.title,
      item.shortName,
      ...(item.observedNames || []),
      ...(item.knownAliases || [])
    ].map(normalizeEntityName).filter(Boolean));
    const ownSlug = item.slug || '';
    const isOwnParty = (party) => {
      const key = normalizeEntityName(party);
      if (aliases.has(key)) return true;
      // A spelling the party record does not list but the registry files under it.
      return Boolean(ownSlug && partyIndex?.byAlias?.get(key)?.slug === ownSlug);
    };
    const summaries = new Map();
    let listEntries = 0;
    for (const person of persons || []) {
      const name = person.name || person.title || '';
      const rows = (person.elections || []).filter((row) => isOwnParty(row.party));
      if (!rows.length) continue;
      if (isListPseudoCandidate(name)) { listEntries += 1; continue; }
      const personId = person.slug || person.id || slugifyEntityKey(name);
      const appearances = rows.map((row) => this.mapPersonAppearanceRow(row));
      const byGroup = new Map();
      let votes = 0;
      let votesKnown = false;
      for (const row of appearances) {
        const group = byGroup.get(row.bodyGroup) || { stood: 0, won: 0 };
        group.stood += 1;
        if (row.elected) group.won += 1;
        byGroup.set(row.bodyGroup, group);
        if (row.firstPref !== null) { votes += row.firstPref; votesKnown = true; }
      }
      summaries.set(personId, {
        personId,
        name: name || personId,
        totalFirstPrefs: votesKnown ? votes : null,
        timesStood: appearances.length,
        timesElected: appearances.filter((row) => row.elected).length,
        byGroup: BODY_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({ group, ...byGroup.get(group) })),
        firstYear: Math.min(...appearances.map((row) => Number(String(row.date).slice(0, 4)) || 9999)),
        lastYear: Math.max(...appearances.map((row) => Number(String(row.date).slice(0, 4)) || 0)),
        constituencyGroups: groupConstituencies(appearances)
      });
    }
    const list = [...summaries.values()].sort((a, b) => (
      b.timesElected - a.timesElected
        || (b.totalFirstPrefs || 0) - (a.totalFirstPrefs || 0)
        || b.timesStood - a.timesStood
        || a.name.localeCompare(b.name)
    ));
    return { summaries: list, listEntries };
  }

  mapConstituencyAreaHistoryRow(entry, bundle, result, kind) {
    const lead = leadingPartyOf(result, { normalise: normalizeEntityName });
    const seats = knownCount(result.seatsTotal ?? result.seatsWon, true);
    return {
      electionKey: bundle.key || entry.key || '',
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      constituency: result.constituency || '',
      localGovernmentDistrict: result.localBody || result.localGovernmentDistrict || '',
      // The party with the most votes, summed over its candidates (H3), not the poll-topper's.
      winnerParty: lead.party,
      winnerColour: lead.colour || '#b0bec5',
      winnerVotes: lead.votes,
      winnerPct: lead.pct,
      electedNames: lead.elected,
      validVotes: knownCount(lead.valid, true),
      seats,
      isByElection: /by-election|bye-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`) || entry.kind === 'by-election',
      areaKind: kind
    };
  }

  mapCouncilAreaHistoryRow(entry, bundle, name, results) {
    const partyTotals = new Map();
    let validVotes = 0;
    let validKnown = false;
    let seats = 0;
    for (const result of results) {
      if (knownCount(result.validPoll, true) !== null) { validVotes += Number(result.validPoll); validKnown = true; }
      seats += Number(result.seatsTotal ?? result.seatsWon ?? 0) || 0;
      for (const candidate of result.candidates || []) {
        const party = candidate.party || result.leadingParty || 'Independent';
        const key = normalizeEntityName(party);
        const current = partyTotals.get(key) || { party, votes: 0, colour: candidate.colour || result.leadingColour || '#b0bec5' };
        current.votes += Number(candidate.firstPrefs ?? candidate.votes ?? 0) || 0;
        partyTotals.set(key, current);
      }
    }
    const leading = [...partyTotals.values()].sort((a, b) => b.votes - a.votes)[0] || {};
    return {
      electionKey: bundle.key || entry.key || '',
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      deaCount: results.length,
      districtElectoralAreas: results.map((result) => result.constituency).filter(Boolean),
      winnerParty: leading.party || '',
      winnerColour: leading.colour || '#b0bec5',
      winnerVotes: leading.votes || null,
      winnerPct: validKnown && leading.votes ? leading.votes / validVotes * 100 : null,
      validVotes: validKnown ? validVotes : null,
      seats: seats || null,
      isByElection: /by-election|bye-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`) || entry.kind === 'by-election',
      localGovernmentDistrict: name
    };
  }

  async renderPerformanceDashboard() {
    const target = document.getElementById('performanceDashboardStatus');
    if (!target) return;
    const status = await this.collectPerformanceStatus();
    const budget = status.budget || {};
    const failedBudgets = Number(budget?.totals?.failed || 0);
    const warningBudgets = Number(budget?.totals?.warnings || 0);
    const budgetClass = failedBudgets ? 'danger' : (warningBudgets ? 'warning' : 'ok');
    const serviceWorker = status.serviceWorker || {};
    const storage = serviceWorker.storage || {};
    const cacheSummary = serviceWorker.caches
      ? Object.entries(serviceWorker.caches).map(([name, count]) => `${shortCacheName(name)}: ${count}`).join(', ')
      : 'not controlling this page yet';
    const rows = [
      ['Budgets', `${budget?.summary || 'No budget report'}${failedBudgets ? ` (${failedBudgets} fail)` : ''}`, budgetClass],
      ['Service worker', serviceWorker.available ? (serviceWorker.controlled ? 'controlled' : 'registered') : 'unavailable', serviceWorker.available ? 'ok' : 'warning'],
      ['Cache entries', cacheSummary, 'neutral'],
      ['Storage', storage.quota ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : 'unreported', 'neutral'],
      ['Runtime', status.map.runtimeProfile?.deviceClass || 'unknown', 'neutral'],
      ['Loaded layers', String(status.map.loadedLayers || 0), 'neutral'],
      ['Fallbacks', String(status.map.fallbackCount || 0), status.map.fallbackCount ? 'warning' : 'ok'],
      ['Seat circles', status.elections.seatCircleRenderMs ? `${status.elections.seatCircleRenderMs}ms` : 'not active', 'neutral'],
      ['Heap', status.browser.memory ? formatBytes(status.browser.memory) : 'unreported', 'neutral']
    ];
    target.innerHTML = rows.map(([label, value, state]) => `
      <div class="test2-performance-dashboard__row test2-performance-dashboard__row--${state}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `).join('');
  }

  setupTimelineControls() {
    this.ensureTimelineChrome();
    const range = document.getElementById('timelineRange');
    const prev = document.getElementById('timelinePrev');
    const next = document.getElementById('timelineNext');
    const reset = document.getElementById('timelineReset');
    const play = document.getElementById('timelinePlay');
    const stop = document.getElementById('timelineStop');
    // Tech-debt item 17: the timeline rebuild race.
    //
    // Three previous attempts are recorded in the Playwright spec covering the
    // timeline and share URLs. They all tried to make the
    // REBUILD smarter -- to work out whether an item-list change meant "moved to
    // a different chain" or "transient mid-swap view of the same chain". That
    // distinction turned out not to be reliably available at rebuild time.
    //
    // This attempt does what that test's own note suggested instead: carry the
    // request identity, so a stale completion is dropped before it can touch
    // anything. Two things go wrong without it, and this handles both:
    //
    //   1. an earlier, slower request resolves LAST and writes its index over the
    //      newest one -- the map shows one year while the slider reads another;
    //   2. a rebuild running during the await moves currentIndex mid-flight, so
    //      even the winning request's own state is no longer what it set.
    //
    // (1) is the token check. (2) is why the index is re-asserted after the
    // await rather than only before it.
    let timelineRequestToken = 0;
    let timelineChain = Promise.resolve();
    const applyIndex = async (index, options = {}) => {
      const timelineItems = this.getTimelineAnimationItems();
      if (!timelineItems.length || !this.timelineOnSelect) return;
      if (options.manual !== false) this.pauseTimelineAnimation({ preserveOverlay: true });
      const safeIndex = this.clampTimelineIndex(index, timelineItems);
      const token = ++timelineRequestToken;
      // ATTEMPT 5, and the first one arrived at by measurement rather than reasoning.
      //
      // Instrumenting every write to the slider (see setTimelineRangeIndex) showed six
      // of nine writes in the failing race coming from one place:
      //
      //   setTimelineRangeIndex <- setTimelineItems <- updateTimeline
      //     <- updateActiveLayers <- onChange
      //
      // updateTimeline re-derives the active index from getCurrentTimelineTimestamp(),
      // which is the MAX DATE OF THE CURRENTLY LOADED LAYERS. Mid-swap that is the old
      // layer, or none, so the index resolves to 0 and the slider is reset -- once per
      // layer change, and each racing request causes one. No amount of guarding
      // applyIndex could have stopped that, which is why three attempts at it failed.
      //
      // updateTimeline ALREADY refuses to run when this.timelineApplying is set. That
      // guard was simply never armed: applyIndex tracked its own token and left the
      // flag alone. Arming it is the whole fix.
      //
      // The flag is cleared only by the NEWEST request, so overlapping requests do not
      // clear it out from under each other -- the same reason the token exists.
      // Optimistic: the slider follows the finger immediately, before any loading.
      this.setTimelineRangeIndex(safeIndex);
      this.timelineAnimation.currentIndex = safeIndex;

      // SERIALISED. timelineOnSelect unloads one layer and loads another; running three
      // of those concurrently interleaves their unload/load pairs, and the set left
      // loaded at the end is whichever pair happened to finish last -- not the one the
      // user asked for. The trace showed exactly that: internal index 5, map on layer 0.
      //
      // Queuing also makes "latest wins" exact rather than probabilistic. A request that
      // is superseded while still waiting its turn does no work at all: it never loads a
      // layer, so it cannot leave one behind. Dragging a slider across ten steps now
      // performs one swap instead of ten.
      const run = timelineChain.then(async () => {
        if (token !== timelineRequestToken) return;   // superseded while queued
        // The edition on the map before this step: the changes are drawn from it to the new one.
        const shownIndex = this.getShownTimelineIndex(timelineItems);
        this.beginTimelineApply();
        try {
          await this.timelineOnSelect(timelineItems[safeIndex], safeIndex);
        } finally {
          this.endTimelineApply();
        }
        // Superseded while we were loading: say nothing, touch nothing.
        if (token !== timelineRequestToken) return;
        this.setTimelineRangeIndex(safeIndex);
        this.timelineAnimation.currentIndex = safeIndex;
        this.updateTimelineAnimationButtons();
        if (shownIndex >= 0 && shownIndex !== safeIndex) {
          await this.showTimelineStepChanges(shownIndex, safeIndex, timelineItems).catch(() => null);
        }
      });
      // The chain must not break on a rejection, or every later request is dropped.
      timelineChain = run.catch(() => {});
      return run;
    };

    // Test surface for the time slider. applyIndex is the real code path the
    // change handler uses, and it returns the promise that settles once the
    // layer swap has completed — which is exactly what a race test needs and
    // what dispatching a synthetic 'change' event cannot give you, because the
    // listener's promise is unobservable from outside.
    if (window.__civgraphTest2) {
      window.__civgraphTest2.timeline = {
        element: range,
        getItems: () => this.getTimelineAnimationItems(),
        getIndex: () => this.getTimelineRangeIndex(),
        setIndex: (index) => applyIndex(index),
        isApplying: () => this.timelineApplying,
        currentIndex: () => this.timelineAnimation.currentIndex,
        // What the change highlight shows: the list (view) and what is drawn on the map.
        getChanges: () => {
          const view = this.timelineChangeView;
          return {
            view: view ? { kind: view.kind, count: view.count, reversed: view.reversed, drawn: view.drawn, fromMapId: view.fromMapId, toMapId: view.toMapId, changes: view.changes.map((c) => ({ key: c.key, type: c.type, text: c.text })) } : null,
            map: this.mapController?.getTimelineChangesState?.() || null,
            highlight: this.getTimelineHighlightEnabled()
          };
        },
      };
    }

    range?.addEventListener('change', (event) => applyIndex(event.target.value).catch((error) => this.showMapError(error)));
    range?.addEventListener('input', (event) => {
      this.pauseTimelineAnimation({ preserveOverlay: true });
      const timelineItems = this.getTimelineAnimationItems();
      const safeIndex = this.clampTimelineIndex(event.target.value, timelineItems);
      this.timelineAnimation.currentIndex = safeIndex;
      this.updateTimelineLabel(safeIndex);
      this.updateTimelineAnimationButtons();
    });
    prev?.addEventListener('click', () => applyIndex(this.getTimelineRangeIndex() - 1).catch((error) => this.showMapError(error)));
    next?.addEventListener('click', () => applyIndex(this.getTimelineRangeIndex() + 1).catch((error) => this.showMapError(error)));
    reset?.addEventListener('click', () => {
      const latest = Math.max(0, this.getTimelineAnimationItems().length - 1);
      applyIndex(latest).catch((error) => this.showMapError(error));
    });
    play?.addEventListener('click', () => {
      if (this.timelineAnimation.playing) {
        this.pauseTimelineAnimation({ preserveOverlay: true });
        return;
      }
      this.startTimelineAnimation().catch((error) => this.showMapError(error));
    });
    stop?.addEventListener('click', () => {
      this.stopTimelineAnimation({ restoreOriginal: true }).catch((error) => this.showMapError(error));
    });
  }

  /**
   * `timelineApplying` suppresses updateTimeline() while a layer swap is mid-flight,
   * because updateTimeline re-derives the slider index from the max date of the
   * CURRENTLY LOADED layers -- which, mid-swap, is the old layer or none.
   *
   * IT HAD TO BECOME A COUNTER. As a plain boolean it was shared by four overlapping
   * call sites, and whichever finished FIRST cleared it for all of them and then called
   * updateTimeline() itself. During a rapid slider drag that is guaranteed: the earliest
   * request is the one most likely to finish first, and it reopened the gate for a
   * rebuild that reset the slider to 0 while later requests were still loading.
   *
   * Found by instrumenting every write to the slider rather than reasoning about it --
   * four earlier attempts guessed and all four missed this, because the flag LOOKED
   * armed at each site in isolation.
   *
   * endTimelineApply() returns true only for the last one out, so the rebuild it guards
   * runs once, at the end, from settled state.
   */
  beginTimelineApply() {
    this.timelineApplyDepth = (this.timelineApplyDepth || 0) + 1;
    this.timelineApplying = true;
  }

  endTimelineApply() {
    this.timelineApplyDepth = Math.max(0, (this.timelineApplyDepth || 0) - 1);
    this.timelineApplying = this.timelineApplyDepth > 0;
    return !this.timelineApplying;
  }

  /**
   * The slider's added parts, built around the page's own markup so every page that carries
   * #timelineSlider gets them: the range goes into a track with a mark per stop under it, the
   * date label gains a second line naming the stop, and a "general elections only" filter
   * appears for election timelines. The native range input itself is unchanged.
   */
  ensureTimelineChrome() {
    const slider = document.getElementById('timelineSlider');
    const range = document.getElementById('timelineRange');
    const label = document.getElementById('timelineLabel');
    if (!slider || !range || !label || slider.dataset.chrome === 'ready') return;
    slider.dataset.chrome = 'ready';

    const track = document.createElement('div');
    track.className = 'timeline-track';
    range.replaceWith(track);
    track.appendChild(range);
    const ticks = document.createElement('div');
    ticks.className = 'timeline-ticks';
    ticks.id = 'timelineTicks';
    ticks.setAttribute('aria-hidden', 'true');
    track.appendChild(ticks);

    const info = document.createElement('div');
    info.className = 'timeline-info';
    label.replaceWith(info);
    info.appendChild(label);
    const sublabel = document.createElement('span');
    sublabel.className = 'timeline-sublabel';
    sublabel.id = 'timelineSublabel';
    info.appendChild(sublabel);

    const generals = document.createElement('button');
    generals.type = 'button';
    generals.id = 'timelineGenerals';
    generals.className = 'timeline-chip';
    generals.hidden = true;
    generals.innerHTML = 'Generals<span class="timeline-chip__more"> only</span>';
    generals.title = 'Step through general elections only, skipping by-elections';
    generals.setAttribute('aria-pressed', 'false');
    generals.addEventListener('click', () => {
      this.setTimelineGeneralsOnly(generals.getAttribute('aria-pressed') !== 'true');
      this.elections?.updateElectionTimeline?.();
    });
    const reset = document.getElementById('timelineReset');
    if (reset?.parentElement === slider) slider.insertBefore(generals, reset);
    else slider.appendChild(generals);

    // Beside the date: "Highlight changes" on/off, and the list of what changed at this step.
    const changes = document.createElement('div');
    changes.className = 'timeline-changes';
    changes.id = 'timelineChangesGroup';
    changes.hidden = true;
    changes.innerHTML = `
      <button type="button" id="timelineHighlight" class="timeline-switch" role="switch" aria-checked="${this.getTimelineHighlightEnabled() ? 'true' : 'false'}" aria-label="Highlight changes" title="Highlight boundary changes when the date changes">
        <span class="timeline-switch__track" aria-hidden="true"><span class="timeline-switch__thumb"></span></span>
        <span class="timeline-switch__label" aria-hidden="true">Highlight</span>
      </button>
      <button type="button" id="timelineChanges" class="timeline-chip timeline-changes__button" aria-expanded="false" aria-controls="timelineChangesPanel" hidden></button>`;
    info.insertAdjacentElement('afterend', changes);
    changes.querySelector('#timelineHighlight').addEventListener('click', () => {
      this.setTimelineHighlightEnabled(!this.getTimelineHighlightEnabled());
    });
    changes.querySelector('#timelineChanges').addEventListener('click', () => this.toggleTimelineChangesPanel());

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.fitTimelineYearLabels()).observe(track);
    }
  }

  /** The reader's choice, else `fallback` (the slider's own default) when they have made none. */
  getTimelineGeneralsOnly(fallback = false) {
    try {
      const stored = localStorage.getItem('civgraph:timelineGeneralsOnly');
      return stored === null ? Boolean(fallback) : stored === '1';
    } catch { return Boolean(fallback); }
  }

  setTimelineGeneralsOnly(value) {
    try { localStorage.setItem('civgraph:timelineGeneralsOnly', value ? '1' : '0'); } catch { /* private mode */ }
  }

  /** A mark per stop, tall for a major one (a general election, a boundary edition) and short
   * for a by-election. Positions follow the range's own index steps, not time, so a mark is
   * exactly where the thumb stops.
   *
   * Each label names the year of the stop it stands at. It used to name the decade ("1950") at
   * the decade's first stop, so on an index-spaced axis "1950" marked the 1955 edition and
   * "1970" the 1977 one (UX review 2026-10-30). Candidates are the first stop of each decade
   * (a general election or edition in preference to a by-election) and the two ends;
   * fitTimelineYearLabels keeps as many as fit, the most important first. */
  renderTimelineTicks() {
    const ticks = document.getElementById('timelineTicks');
    if (!ticks) return;
    const items = this.getTimelineAnimationItems();
    const count = items.length;
    if (count < 2) {
      ticks.innerHTML = '';
      return;
    }
    const drawMinor = count <= 600;
    const parts = [];
    // decade -> the stop to label: its first major stop, else its first stop.
    const byDecade = new Map();
    items.forEach((item, index) => {
      const p = (index / (count - 1)).toFixed(5);
      const minor = Boolean(item?.minor);
      if (!minor || drawMinor) {
        parts.push(`<span class="timeline-tick${minor ? '' : ' timeline-tick--major'}" style="--p:${p}"></span>`);
      }
      const year = this.timelineItemYear(item);
      if (!Number.isFinite(year)) return;
      const decade = Math.floor(year / 10);
      const held = byDecade.get(decade);
      if (!held || (held.minor && !minor)) byDecade.set(decade, { index, year, minor });
    });
    const label = (index, year, priority) => `<span class="timeline-year" data-priority="${priority}" style="--p:${(index / (count - 1)).toFixed(5)}">${year}</span>`;
    const firstYear = this.timelineItemYear(items[0]);
    const lastYear = this.timelineItemYear(items[count - 1]);
    const labelled = new Set();
    if (Number.isFinite(firstYear)) { parts.push(label(0, firstYear, 3)); labelled.add(0); }
    if (Number.isFinite(lastYear)) { parts.push(label(count - 1, lastYear, 3)); labelled.add(count - 1); }
    for (const { index, year, minor } of byDecade.values()) {
      if (labelled.has(index)) continue;
      parts.push(label(index, year, minor ? 1 : 2));
    }
    ticks.innerHTML = parts.join('');
    this.fitTimelineYearLabels();
    requestAnimationFrame(() => this.fitTimelineYearLabels());
  }

  timelineItemYear(item) {
    const date = this.parseTimelineDate(item?.date ?? item?.timestamp ?? item?.label);
    return date ? date.getUTCFullYear() : NaN;
  }

  /** Year labels that would collide are hidden: the ends first, then general elections and
   * editions, then the rest, each kept only where it has room. On the Westminster axis, whose
   * by-elections crowd the later decades, that thins the right end instead of packing it. */
  fitTimelineYearLabels() {
    const ticks = document.getElementById('timelineTicks');
    if (!ticks) return;
    const labels = [...ticks.querySelectorAll('.timeline-year')];
    const width = ticks.clientWidth;
    const placed = [];
    const ordered = labels
      .map((label) => {
        label.dataset.hidden = 'false';
        const left = label.offsetLeft - label.offsetWidth / 2;
        return { label, left, right: left + label.offsetWidth, priority: Number(label.dataset.priority || 1) };
      })
      .sort((a, b) => b.priority - a.priority || a.left - b.left);
    const gap = 10;
    for (const item of ordered) {
      const clash = placed.some((other) => item.left < other.right + gap && item.right > other.left - gap);
      if (clash || item.left < -12 || item.right > width + 12) {
        item.label.dataset.hidden = 'true';
        continue;
      }
      placed.push(item);
    }
  }

  setTimelineItems(items, activeIndex, onSelect, options = {}) {
    const slider = document.getElementById('timelineSlider');
    const range = document.getElementById('timelineRange');
    const playableItems = Array.isArray(items)
      ? items.filter((item) => !item?.mapId || this.isTimelineMapPlayable(item.mapId))
      : [];
    // The slider must span the full playable time series. Do NOT restrict it to the
    // longest contiguous run of precomputed transition overlays — that truncated the
    // range (e.g. the LGD chain stopped at 1 Apr 1969, where the admin-areas overlays
    // end, even with the 2012 map loaded). Play-mode morphing still works:
    // applyTimelineAnimationTransition looks up an overlay per adjacent pair and falls
    // back to a plain switch when none exists.
    this.timelineItems = playableItems;
    this.timelineOnSelect = typeof onSelect === 'function' ? onSelect : null;
    if (!slider || !range || this.timelineItems.length < 2 || !this.timelineOnSelect) {
      this.hideTimeline();
      return;
    }
    const requestedItem = Array.isArray(items) ? items[Number(activeIndex)] : null;

    /**
     * Identity must not be satisfied by two undefined values.
     *
     * The previous predicate was `item.mapId === requested.mapId || item.timestamp ===
     * requested.timestamp`. Election timeline items carry `{ label, body, date }` and have
     * NEITHER field, so both comparisons read `undefined === undefined`, matched the FIRST
     * item, and the slider silently snapped to index 0.
     *
     * Measured 2026-08-23: loading the 2024-07-04 UK general election gave
     * activeEntry.date "2024-07-04", a 60-item timeline starting 1922-11-15, and a slider
     * reading "15 Nov 1922" at index 0. updateElectionTimeline computed the right index
     * and handed it over; it was discarded here.
     *
     * Each clause now requires the field to be present on the requested item before it
     * can match, and elections match on body+date, which is their actual identity.
     */
    const sameTimelineItem = (item, requested) => {
      if (!item || !requested) return false;
      if (requested.mapId != null) return item.mapId === requested.mapId;
      if (requested.timestamp != null) return item.timestamp === requested.timestamp;
      if (requested.date != null) return item.date === requested.date && item.body === requested.body;
      return false;
    };
    const requestedIndex = this.timelineItems.findIndex((item) => sameTimelineItem(item, requestedItem));
    const safeIndex = this.clampTimelineIndex(requestedIndex >= 0 ? requestedIndex : activeIndex);
    range.min = '0';
    range.max = String(this.timelineItems.length - 1);
    this.setTimelineRangeIndex(safeIndex);
    slider.classList.remove('hidden');
    this.updateTimelineLabel(safeIndex);
    this.updateTimelineAnimationButtons();
    this.renderTimelineTicks();
    const generals = document.getElementById('timelineGenerals');
    if (generals) {
      const filter = options?.generalsFilter;
      generals.hidden = !filter?.available;
      generals.setAttribute('aria-pressed', filter?.active ? 'true' : 'false');
    }
    // An election's timeline has no boundary changes to show; a boundary series has.
    this.renderTimelineChangesControl();
    this.notifyTimelineLayoutChanged();
  }

  clampTimelineIndex(index, items = this.timelineItems) {
    const sequence = Array.isArray(items) ? items : [];
    if (!sequence.length) return 0;
    return Math.max(0, Math.min(sequence.length - 1, Number(index) || 0));
  }

  getTimelineRangeIndex() {
    return this.clampTimelineIndex(document.getElementById('timelineRange')?.value || 0);
  }

  setTimelineRangeIndex(index) {
    const safeIndex = this.clampTimelineIndex(index);
    const range = document.getElementById('timelineRange');
    if (range) range.value = String(safeIndex);
    this.updateTimelineLabel(safeIndex);
    // T17 attempt 5: every write to the slider records where it came from. Four
    // attempts guessed at the cause; this makes the reset name itself. Test-surface
    // only, so it costs nothing in production.
    if (window.__civgraphTest2) {
      const trace = window.__civgraphTest2.timelineWrites || (window.__civgraphTest2.timelineWrites = []);
      if (trace.length > 200) trace.shift();   // a long play run must not grow without bound
      trace.push({
        index: safeIndex,
        from: String(new Error().stack || '').split(String.fromCharCode(10)).slice(1, 6).join(' | ')
      });
    }
    return safeIndex;
  }
  getTimelineAnimationItems() {
    const sequenceItems = this.timelineAnimation?.sequenceItems;
    return Array.isArray(sequenceItems) && sequenceItems.length ? sequenceItems : this.timelineItems;
  }


  updateTimelineLabel(index) {
    const timelineItems = this.getTimelineAnimationItems();
    const item = timelineItems[this.clampTimelineIndex(index, timelineItems)];
    const label = document.getElementById('timelineLabel');
    const text = this.formatTimelineItemLabel(item);
    if (label) label.textContent = text;
    const sublabel = document.getElementById('timelineSublabel');
    if (sublabel) sublabel.textContent = item?.sublabel || '';
    document.getElementById('timelineRange')?.setAttribute('aria-valuetext', [text, item?.sublabel].filter(Boolean).join(', '));
  }

  hideTimeline() {
    this.clearTimelineAnimationTimer();
    this.timelineItems = [];
    this.timelineOnSelect = null;
    this.timelineAnimation.runId += 1;
    this.timelineAnimation.playing = false;
    this.timelineAnimation.paused = false;
    this.timelineAnimation.atEnd = false;
    this.timelineAnimation.singleLayerReferenceId = null;
    this.timelineAnimation.sequenceItems = [];
    this.setTimelineChangeView(null);
    this.closeTimelineChangesPanel();
    document.getElementById('timelineSlider')?.classList.add('hidden');
    this.updateTimelineAnimationButtons();
    this.notifyTimelineLayoutChanged();
  }

  notifyTimelineLayoutChanged() {
    requestAnimationFrame(() => this.mapController?.invalidateSize?.());
  }

  installOutsideMapHighlightClear() {
    if (this._outsideMapHighlightClearInstalled) return;
    this._outsideMapHighlightClearInstalled = true;
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target?.closest?.('#map, .maplibregl-map, .maplibre-dom-label')) return;
      // Kept for "Download SVG": a feature whose details are still showing counts as selected,
      // though reaching the download (in the catalogue or the details box) clears its highlight.
      const selected = this.mapController?.renderer?.selected;
      if (selected) this._lastClearedSelection = selected;
      this.mapController?.clearTransientHighlight?.();
    }, true);
  }

  isTimelineRunCurrent(runId) {
    return this.timelineAnimation.runId === runId && this.timelineAnimation.playing;
  }

  updateTimeline() {
    if (this.timelineApplying) return;
    if (this.timelineAnimation?.playing) return;
    if (this.elections?.activeEntry) {
      this.elections.updateElectionTimeline();
      return;
    }
    const activeIds = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id))
      .filter((id) => this.isMapVisible(id));
    const chains = [];
    const chainIds = new Set();
    for (const id of activeIds) {
      const chain = dataService.getChainForMap?.(id);
      if (!chain || chainIds.has(chain.id)) continue;
      chainIds.add(chain.id);
      chains.push(chain);
    }
    if (!chains.length) {
      this.hideTimeline();
      return;
    }
    const timestamps = (dataService.getApplicableDates?.(chains, activeIds) || [])
      .filter((timestamp) => Number.isFinite(Number(timestamp)))
      .sort((a, b) => a - b);
    if (timestamps.length < 2) {
      this.hideTimeline();
      return;
    }
    const referenceMapId = activeIds.length === 1 ? activeIds[0] : this.timelineAnimation.singleLayerReferenceId;
    this.timelineAnimation.singleLayerReferenceId = activeIds.length === 1 ? activeIds[0] : this.timelineAnimation.singleLayerReferenceId;
    const currentTimestamp = this.getCurrentTimelineTimestamp(activeIds);
    const items = timestamps.map((timestamp) => {
      const mapId = referenceMapId ? this.getTimelineMapIdForTimestamp(referenceMapId, timestamp) : null;
      const yearOnly = mapId ? this.yearOnlyMapDate(dataService.getMapById(mapId)) : null;
      return {
        timestamp,
        label: yearOnly || this.formatTimelineTimestamp(timestamp),
        // A map dated only by its year reads "2023", not "01 Jan 2023" (UX review L4).
        displayLabel: yearOnly || '',
        mapId,
        // An edition named only by its year ("2017") would repeat the date above it.
        sublabel: [mapId && dataService.getMapById(mapId)?.name].filter((name) => name && !/^\d{4}$/.test(String(name).trim()))[0] || ''
      };
    }).filter((item) => this.isTimelineMapPlayable(item.mapId));
    const activeIndex = items.findIndex((item) => item.timestamp === currentTimestamp);
    this.setTimelineItems(items, activeIndex >= 0 ? activeIndex : items.length - 1, async (item, index) => {
      this.timelineAnimation.currentIndex = this.clampTimelineIndex(index);
      // Stepping through time keeps the reader's zoom and position; only opening a map fits it.
      await this.applyTimelineTimestamp(item.timestamp, { fit: false });
    });
    this.syncTimelineChangesToShownEdition();
  }

  getTimelineMapIdForTimestamp(referenceMapId, timestamp) {
    if (!referenceMapId || !Number.isFinite(Number(timestamp))) return null;
    const equivalents = dataService.getEquivalentMapsForDate?.([referenceMapId], timestamp) || {};
    const direct = equivalents[referenceMapId];
    if (direct && this.isTimelineMapPlayable(direct)) return direct;
    const referenceMap = dataService.getMapById(referenceMapId);
    const referenceTimestamp = dataService.parseMapDate?.(referenceMap?.date);
    if (referenceTimestamp === timestamp && this.isTimelineMapPlayable(referenceMapId)) return referenceMapId;
    return null;
  }

  getCurrentTimelineTimestamp(activeIds) {
    const activeTimestamps = activeIds
      .map((id) => dataService.parseMapDate?.(dataService.getMapById(id)?.date))
      .filter((timestamp) => Number.isFinite(Number(timestamp)));
    return activeTimestamps.length ? Math.max(...activeTimestamps) : null;
  }

  formatTimelineTimestamp(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';
    return this.formatTimelineDate(date);
  }

  /**
   * A map's year when its date is known only to the year: a bare year (2023), or 1 January of
   * it with nothing saying the day is meant (the 1977 DEDs are "1977-01-01"). A map named
   * "1 Jan 1919", or in force from that day, keeps its day. Null otherwise.
   */
  yearOnlyMapDate(map) {
    const raw = String(map?.date ?? '').trim();
    if (/^\d{4}$/.test(raw)) return raw;
    if (!/^\d{4}-01-01$/.test(raw)) return null;
    if (/\b1 Jan(uary)?\b|-01-01\b/i.test(`${map.id || ''} ${map.name || ''}`) || map.dateEffective === raw) return null;
    return raw.slice(0, 4);
  }

  formatTimelineItemLabel(item) {
    if (!item) return '';
    if (item.displayLabel) return item.displayLabel;
    const candidates = [item.timestamp, item.date, item.label];
    for (const candidate of candidates) {
      const date = this.parseTimelineDate(candidate);
      if (date) return this.formatTimelineDate(date);
    }
    return item.label || '';
  }

  parseTimelineDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const numeric = Number(value);
      // A timestamp, not a year, whenever it is outside year range -- including the NEGATIVE
      // timestamps of every date before 1970. Testing only `> 9999` sent 1 Jan 1969
      // (-31536000000) to the text fallback, which parsed "01 Jan 1969" as local midnight:
      // 23:00 UTC on 31 Dec in Ireland, which kept summer time all year from 1968 to 1971.
      const date = Math.abs(numeric) > 9999 ? new Date(numeric) : new Date(Date.UTC(numeric, 0, 1));
      return Number.isFinite(date.getTime()) ? date : null;
    }
    const isoMatch = String(value).trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
    if (isoMatch) {
      const year = Number(isoMatch[1]);
      const month = Number(isoMatch[2] || 1) - 1;
      const day = Number(isoMatch[3] || 1);
      const date = new Date(Date.UTC(year, month, day));
      return Number.isFinite(date.getTime()) ? date : null;
    }
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  formatTimelineDate(date) {
    return formatDisplayDate(date);
  }

  async applyTimelineTimestamp(timestamp, options = {}) {
    const activeIds = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id))
      .filter((id) => this.isMapVisible(id));
    const equivalents = dataService.getEquivalentMapsForDate?.(activeIds, timestamp) || {};
    this.beginTimelineApply();
    try {
      for (const [oldId, newId] of Object.entries(equivalents)) {
        if (!newId || newId === oldId || !this.isTimelineMapPlayable(newId)) continue;
        await this.unloadMap(oldId, { preserveTimelineAnimation: true });
        await this.loadMap(newId, { fit: options.fit !== false });
      }
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    } finally {
      // Only the last operation out rebuilds, and only then is the state it reads
      // settled. Clearing unconditionally here is what reset the slider mid-race.
      if (this.endTimelineApply()) this.updateTimeline();
    }
  }

  getTimelineItemMapIds() {
    return new Set(this.getTimelineAnimationItems().map((item) => item?.mapId).filter(Boolean));
  }

  isTimelineAnimationLayer(mapId) {
    if (!mapId) return false;
    const animation = this.timelineAnimation || {};
    return Boolean(
      animation.playing || animation.paused || animation.originalLayerId
    ) && (animation.originalLayerId === mapId || this.getTimelineItemMapIds().has(mapId));
  }

  getVisibleTimelineLayerIds() {
    const ids = this.getTimelineItemMapIds();
    return this.getLoadedLayerIds()
      .filter((id) => ids.has(id))
      .filter((id) => this.isMapVisible(id));
  }

  canAnimateTimeline() {
    if (this.elections?.activeEntry) return false;
    if (!this.timelineItems.length || this.timelineItems.length < 2 || !this.timelineOnSelect) return false;
    const mapIds = this.getTimelineItemMapIds();
    if (mapIds.size < 2) return false;
    if (this.timelineAnimation.playing || this.timelineAnimation.paused || this.timelineAnimation.originalLayerId) return true;
    return this.getVisibleTimelineLayerIds().length === 1;
  }

  updateTimelineAnimationButtons() {
    const play = document.getElementById('timelinePlay');
    const stop = document.getElementById('timelineStop');
    if (!play || !stop) return;
    // The playback buttons animate boundary layers through time. An election has nothing to
    // animate, so canAnimateTimeline() always refuses while one is open; rather than sit
    // there greyed out, the pair is hidden until the election is closed.
    play.parentElement?.classList.toggle('timeline-playback-group--hidden', Boolean(this.elections?.activeEntry));
    const canAnimate = this.canAnimateTimeline();
    const { playing, paused, atEnd, originalLayerId } = this.timelineAnimation;
    play.disabled = !canAnimate;
    stop.disabled = !(playing || paused || originalLayerId);
    play.classList.toggle('is-playing', playing);
    play.classList.toggle('is-paused', paused);
    play.classList.toggle('is-replay', atEnd && !playing);
    if (playing) {
      play.title = 'Pause territorial animation';
      play.setAttribute('aria-label', 'Pause territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"></path></svg>';
    } else if (atEnd) {
      play.title = 'Replay territorial animation';
      play.setAttribute('aria-label', 'Replay territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h8V3z" fill="currentColor"></path></svg>';
    } else {
      play.title = 'Play territorial animation';
      play.setAttribute('aria-label', 'Play territorial animation');
      play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>';
    }
    stop.title = 'Stop territorial animation';
    stop.setAttribute('aria-label', 'Stop territorial animation');
  }

  clearTimelineAnimationTimer() {
    if (this.timelineAnimation.timer) {
      window.clearTimeout(this.timelineAnimation.timer);
      this.timelineAnimation.timer = 0;
    }
    if (this.timelineAnimation.delayResolve) {
      const resolve = this.timelineAnimation.delayResolve;
      this.timelineAnimation.delayResolve = null;
      resolve();
    }
  }

  scheduleTimelineAnimation(delay, callback) {
    this.clearTimelineAnimationTimer();
    this.timelineAnimation.timer = window.setTimeout(() => {
      this.timelineAnimation.timer = 0;
      callback();
    }, Math.max(0, Number(delay) || 0));
  }

  waitTimelineDelay(delay) {
    this.clearTimelineAnimationTimer();
    return new Promise((resolve) => {
      this.timelineAnimation.delayResolve = resolve;
      this.timelineAnimation.timer = window.setTimeout(() => {
        this.timelineAnimation.timer = 0;
        this.timelineAnimation.delayResolve = null;
        resolve();
      }, Math.max(0, Number(delay) || 0));
    });
  }

  pauseTimelineAnimation(options = {}) {
    const wasActive = this.timelineAnimation.playing || this.timelineAnimation.paused;
    if (wasActive) this.timelineAnimation.runId += 1;
    this.clearTimelineAnimationTimer();
    if (wasActive) {
      this.timelineAnimation.playing = false;
      this.timelineAnimation.paused = true;
      this.timelineAnimation.currentIndex = this.getTimelineRangeIndex();
    }
    if (wasActive && options.preserveOverlay !== true) this.setTimelineChangeView(null);
    this.updateTimelineAnimationButtons();
  }

  async stopTimelineAnimation(options = {}) {
    const { restoreOriginal = true } = options;
    const originalLayerId = this.timelineAnimation.originalLayerId;
    const wasActive = this.timelineAnimation.playing || this.timelineAnimation.paused || originalLayerId;
    this.timelineAnimation.runId += 1;
    this.clearTimelineAnimationTimer();
    this.timelineAnimation.playing = false;
    this.timelineAnimation.paused = false;
    this.timelineAnimation.atEnd = false;
    if (wasActive) this.setTimelineChangeView(null);
    if (!wasActive) {
      this.updateTimelineAnimationButtons();
      return;
    }
    if (restoreOriginal && originalLayerId && dataService.getMapById(originalLayerId)) {
      const timelineMapIds = this.getTimelineItemMapIds();
      this.beginTimelineApply();
      try {
        for (const loadedId of this.getLoadedLayerIds()) {
          if (loadedId !== originalLayerId && timelineMapIds.has(loadedId)) {
            await this.unloadMap(loadedId, { preserveTimelineAnimation: true });
          }
        }
        if (!this.isMapLoaded(originalLayerId)) await this.loadMap(originalLayerId, { fit: false });
        this.mapController.showLayer?.(originalLayerId);
        const originalTimestamp = dataService.parseMapDate?.(dataService.getMapById(originalLayerId)?.date);
        const timelineItems = this.getTimelineAnimationItems();
        const originalIndex = timelineItems.findIndex((item) => item.mapId === originalLayerId || item.timestamp === originalTimestamp);
        if (originalIndex >= 0) this.setTimelineRangeIndex(originalIndex);
        this.syncCatalogueMapState();
        this.updateActiveLayers();
        this.updateURLState();
      } finally {
        if (this.endTimelineApply()) this.updateTimeline();
      }
    }
    this.timelineAnimation.originalLayerId = null;
    this.timelineAnimation.sequenceItems = [];
    this.timelineAnimation.currentIndex = this.getTimelineRangeIndex();
    this.updateTimelineAnimationButtons();
  }

  async startTimelineAnimation() {
    if (!this.canAnimateTimeline()) {
      this.updateTimelineAnimationButtons();
      return;
    }
    const sequenceItems = this.timelineAnimation.paused && Array.isArray(this.timelineAnimation.sequenceItems) && this.timelineAnimation.sequenceItems.length
      ? this.timelineAnimation.sequenceItems
      : this.timelineItems.slice();
    this.timelineAnimation.sequenceItems = sequenceItems;
    const visibleTimelineLayers = this.getVisibleTimelineLayerIds();
    if (!this.timelineAnimation.originalLayerId || this.timelineAnimation.atEnd) {
      this.timelineAnimation.originalLayerId = visibleTimelineLayers[0] || sequenceItems[this.getTimelineRangeIndex()]?.mapId || null;
    }
    let startIndex = this.timelineAnimation.paused ? this.timelineAnimation.currentIndex : 0;
    if (this.timelineAnimation.atEnd) startIndex = 0;
    startIndex = this.clampTimelineIndex(startIndex, sequenceItems);
    const runId = this.timelineAnimation.runId + 1;
    this.timelineAnimation.runId = runId;
    this.timelineAnimation.playing = true;
    this.timelineAnimation.paused = false;
    this.timelineAnimation.atEnd = false;
    this.timelineAnimation.currentIndex = startIndex;
    this.setTimelineRangeIndex(startIndex);
    this.updateTimelineAnimationButtons();
    const startItem = sequenceItems[startIndex];
    if (this.getShownTimelineIndex(sequenceItems) !== startIndex) this.setTimelineChangeView(null);
    if (startItem?.timestamp !== undefined) await this.applyTimelineTimestamp(startItem.timestamp, { fit: false });
    if (!this.isTimelineRunCurrent(runId)) return;
    if (startIndex >= sequenceItems.length - 1) {
      this.timelineAnimation.playing = false;
      this.timelineAnimation.atEnd = true;
      this.updateTimelineAnimationButtons();
      return;
    }
    this.scheduleTimelineAnimation(TIMELINE_ANIMATION_DELAYS.start, () => {
      this.advanceTimelineAnimation(runId).catch((error) => this.showMapError(error));
    });
  }

  async advanceTimelineAnimation(runId = this.timelineAnimation.runId) {
    if (!this.isTimelineRunCurrent(runId)) return;
    const timelineItems = this.getTimelineAnimationItems();
    const fromIndex = this.clampTimelineIndex(this.timelineAnimation.currentIndex, timelineItems);
    const toIndex = fromIndex + 1;
    if (toIndex >= timelineItems.length) {
      this.timelineAnimation.playing = false;
      this.timelineAnimation.paused = false;
      this.timelineAnimation.atEnd = true;
      this.updateTimelineAnimationButtons();
      return;
    }
    await this.applyTimelineAnimationTransition(fromIndex, toIndex, runId, timelineItems);
    if (!this.isTimelineRunCurrent(runId)) return;
    this.timelineAnimation.currentIndex = toIndex;
    if (toIndex >= timelineItems.length - 1) {
      this.timelineAnimation.playing = false;
      this.timelineAnimation.paused = false;
      this.timelineAnimation.atEnd = true;
      this.updateTimelineAnimationButtons();
      return;
    }
    this.scheduleTimelineAnimation(TIMELINE_ANIMATION_DELAYS.start, () => {
      this.advanceTimelineAnimation(runId).catch((error) => this.showMapError(error));
    });
  }

  /**
   * One Play step: swap to the next edition, highlight what changed, and hold it long enough to
   * see. It used to load both editions, lay a precomputed overlay over them for 1.5 s and fade
   * it; the overlay existed for 14 series only, and for Counties covered the whole island.
   */
  async applyTimelineAnimationTransition(fromIndex, toIndex, runId = this.timelineAnimation.runId, items = this.getTimelineAnimationItems()) {
    const timelineItems = Array.isArray(items) && items.length ? items : this.getTimelineAnimationItems();
    const safeTo = this.clampTimelineIndex(toIndex, timelineItems);
    const toItem = timelineItems[safeTo];
    const shownIndex = this.getShownTimelineIndex(timelineItems);
    const from = shownIndex >= 0 ? shownIndex : this.clampTimelineIndex(fromIndex, timelineItems);
    if (toItem?.timestamp !== undefined) await this.applyTimelineTimestamp(toItem.timestamp, { fit: false });
    if (!this.isTimelineRunCurrent(runId)) return;
    this.setTimelineRangeIndex(safeTo);
    this.timelineAnimation.currentIndex = safeTo;
    const view = from !== safeTo ? await this.showTimelineStepChanges(from, safeTo, timelineItems).catch(() => null) : null;
    if (!this.isTimelineRunCurrent(runId)) return;
    const visible = Boolean(view?.changes?.length) && this.getTimelineHighlightEnabled();
    await this.waitTimelineDelay(visible ? TIMELINE_ANIMATION_DELAYS.hold : TIMELINE_ANIMATION_DELAYS.holdQuiet);
  }

  async ensureTimelineLayerLoaded(mapId) {
    if (!this.isTimelineMapPlayable(mapId)) return false;
    if (!this.isMapLoaded(mapId)) await this.loadMap(mapId, { fit: false });
    this.mapController.showLayer?.(mapId);
    return true;
  }

  /* ------------------------------------------------------------------------------------------
   * Boundary changes on the timeline (reviewer report, Phelim, 2026-11-01).
   *
   * Dragging the slider only swapped one edition for the next: colours stayed the same, a
   * change of a few townlands was invisible at island zoom, and only Play mode showed an
   * overlay -- for Counties, one that painted the whole island purple. Every step now draws
   * what changed between the edition that was shown and the one now shown, from
   * data/timeline-changes/ (scripts/build_timeline_changes.py), and the "N changes" button
   * beside the date lists them with a zoom-to for each.
   * ------------------------------------------------------------------------------------------ */

  async loadTimelineChangeIndex() {
    try {
      const response = await fetch(`${TIMELINE_CHANGES_BASE_PATH}/index.json`, { cache: 'default' });
      const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
      if (!response.ok || contentType.includes('text/html')) return;
      const index = await response.json();
      this.timelineChangeIndex = index?.pairs && typeof index.pairs === 'object' ? index.pairs : {};
    } catch {
      this.timelineChangeIndex = {};
    }
  }

  getTimelineHighlightEnabled() {
    try {
      return localStorage.getItem(TIMELINE_HIGHLIGHT_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  setTimelineHighlightEnabled(value) {
    try { localStorage.setItem(TIMELINE_HIGHLIGHT_STORAGE_KEY, value ? '1' : '0'); } catch { /* private mode */ }
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', value ? 'true' : 'false');
    this.drawTimelineChanges();
  }

  /** The index of the timeline stop whose edition is on the map now, or -1. */
  getShownTimelineIndex(items = this.getTimelineAnimationItems()) {
    return (Array.isArray(items) ? items : [])
      .findIndex((item) => item?.mapId && this.isMapLoaded(item.mapId) && this.isMapVisible(item.mapId));
  }

  /**
   * The consecutive pairs between two stops, in the order they are stepped through: forward
   * from 1927 to 1957 is 1927-1955 then 1955-1957; backward is the same pairs, latest first.
   */
  getTimelineChangeSteps(fromIndex, toIndex, items = this.getTimelineAnimationItems()) {
    const steps = [];
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return steps;
    for (let i = Math.min(fromIndex, toIndex); i < Math.max(fromIndex, toIndex); i += 1) {
      const fromMapId = items[i]?.mapId;
      const toMapId = items[i + 1]?.mapId;
      if (!fromMapId || !toMapId || fromMapId === toMapId) continue;
      const id = `${fromMapId}__${toMapId}`;
      steps.push({ id, fromMapId, toMapId, fromItem: items[i], toItem: items[i + 1], entry: this.timelineChangeIndex?.[id] || null });
    }
    return toIndex < fromIndex ? steps.reverse() : steps;
  }

  fetchTimelineChangePair(path) {
    if (!path) return Promise.resolve(null);
    const url = path.startsWith('/') ? path : `/${path}`;
    if (!this.timelineChangeCache.has(url)) {
      this.timelineChangeCache.set(url, fetch(url, { cache: 'default' })
        .then((response) => {
          const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
          return response.ok && !contentType.includes('text/html') ? response.json() : null;
        })
        .catch(() => null));
    }
    return this.timelineChangeCache.get(url);
  }

  /**
   * After every timeline step (drag, previous/next, latest, Play): what changed between the
   * edition that was shown (fromIndex) and the one now shown (toIndex). Stepping backwards
   * shows the same pairs reversed. It is drawn unless the reader has switched highlighting
   * off, and stays until the next step. `draw: false` only describes it, for the button.
   */
  async showTimelineStepChanges(fromIndex, toIndex, items = this.getTimelineAnimationItems(), options = {}) {
    const token = (this.timelineChangeToken = (this.timelineChangeToken || 0) + 1);
    const steps = this.getTimelineChangeSteps(fromIndex, toIndex, items);
    if (!steps.length) {
      this.setTimelineChangeView(null);
      return null;
    }
    const used = steps.slice(0, TIMELINE_CHANGES_MAX_STEPS);
    // While a step's own changes load, a layer change elsewhere must not replace them with the
    // undrawn description syncTimelineChangesToShownEdition gives a newly opened map.
    if (options.draw !== false) this.timelineChangeStepPending = token;
    let files;
    try {
      files = await Promise.all(used.map((step) => this.fetchTimelineChangePair(step.entry?.path)));
    } finally {
      if (this.timelineChangeStepPending === token) this.timelineChangeStepPending = 0;
    }
    if (token !== this.timelineChangeToken) return null;
    const view = this.buildTimelineChangeView(used, files, {
      reversed: toIndex < fromIndex,
      fromItem: items[fromIndex],
      toItem: items[toIndex],
      skipped: steps.length - used.length
    });
    view.drawn = options.draw !== false;
    this.setTimelineChangeView(view);
    return view;
  }

  buildTimelineChangeView(steps, files, { reversed, fromItem, toItem, skipped = 0 }) {
    const multi = steps.length > 1;
    const changes = [];
    const features = [];
    const parts = [];
    steps.forEach((step, k) => {
      const file = files[k];
      const entry = step.entry || null;
      const label = reversed
        ? `${this.formatTimelineItemLabel(step.toItem)} to ${this.formatTimelineItemLabel(step.fromItem)}`
        : `${this.formatTimelineItemLabel(step.fromItem)} to ${this.formatTimelineItemLabel(step.toItem)}`;
      parts.push({ label, kind: entry?.kind || 'unknown', count: Number(entry?.count) || 0, text: entry?.text || 'No change data for this step.' });
      for (const change of Array.isArray(file?.changes) ? file.changes : []) {
        changes.push({ ...change, key: `${k}:${change.id}`, step: multi ? label : '', text: this.describeTimelineChange(change, reversed) });
      }
      for (const feature of Array.isArray(file?.features) ? file.features : []) {
        const changeId = feature?.properties?.changeId;
        features.push(changeId ? { ...feature, properties: { ...feature.properties, changeKey: `${k}:${changeId}` } } : feature);
      }
    });
    const count = parts.reduce((sum, part) => sum + part.count, 0);
    const kinds = new Set(parts.map((part) => part.kind));
    const kind = kinds.has('changes') ? 'changes'
      : kinds.size === 1 && kinds.has('none') ? 'none'
        : kinds.has('redrawn') ? 'redrawn'
          : kinds.has('none') ? 'none' : 'unknown';
    const toMapId = toItem?.mapId || null;
    return {
      key: steps.map((step) => step.id).join('|') + (reversed ? '|reversed' : ''),
      reversed,
      kind,
      count,
      parts,
      changes,
      features,
      skipped,
      fromLabel: this.formatTimelineItemLabel(fromItem),
      toLabel: this.formatTimelineItemLabel(toItem),
      fromMapId: fromItem?.mapId || null,
      toMapId,
      note: !reversed && !multi && toMapId ? String(dataService.getMapById(toMapId)?.changeNote || '') : '',
      drawn: true
    };
  }

  /** A name in capitals ("KILKENNY", "KING'S COUNTY") in ordinary case for a sentence. */
  timelineChangeName(name) {
    const text = String(name || '').trim();
    if (!text) return 'an unnamed area';
    // "CROSSGAR and KILLYLEAGH" counts as capitals too: the joining words were left small.
    const bare = text.replace(/\b(and|of|the)\b/g, '');
    if (bare !== bare.toUpperCase() || !/[A-Z]/.test(text)) return text;
    return text.toLowerCase()
      .replace(/(^|[\s\-(/.])([a-z])/g, (match, lead, letter) => lead + letter.toUpperCase())
      .replace(/\s(And|Of|The|Na|An)\s/g, (match) => match.toLowerCase());
  }

  formatHectares(value) {
    const ha = Number(value) || 0;
    if (ha >= 100) return `${Math.round(ha).toLocaleString('en-GB')} ha`;
    if (ha >= 10) return `${Math.round(ha)} ha`;
    return `${ha.toFixed(1)} ha`;
  }

  describeTimelineChange(change, reversed = false) {
    const from = this.timelineChangeName(change?.from);
    const to = this.timelineChangeName(change?.to);
    const ha = this.formatHectares(change?.ha);
    switch (change?.type) {
      case 'created':
        return reversed ? `${to} merged back into ${from}` : `${to} formed from ${from}`;
      case 'abolished':
        return reversed ? `${from} re-formed from ${to}` : `${from} abolished, joined to ${to}`;
      case 'renamed':
        return reversed ? `${to} renamed back to ${from}` : `${from} renamed ${to}`;
      // Drawn in one edition only (a gap in the other's source layer).
      case 'appeared':
        return reversed ? `${to} not drawn in this edition` : `${to} first drawn in this edition`;
      case 'disappeared':
        return reversed ? `${from} drawn again in this edition` : `${from} no longer drawn`;
      default:
        return reversed ? `${ha} from ${to} back to ${from}` : `${ha} from ${from} to ${to}`;
    }
  }

  setTimelineChangeView(view) {
    if (!view) this.timelineChangeToken = (this.timelineChangeToken || 0) + 1;
    this.timelineChangeView = view || null;
    this.renderTimelineChangesControl();
    this.drawTimelineChanges();
  }

  drawTimelineChanges() {
    const view = this.timelineChangeView;
    if (!view || !view.drawn || !this.getTimelineHighlightEnabled() || (!view.features.length && !view.changes.length)) {
      this.mapController?.clearTimelineChanges?.();
      return;
    }
    this.mapController?.setTimelineChanges?.({ features: view.features }, {
      key: view.key,
      reversed: view.reversed,
      // A marker per change shows a small one at island zoom; past a few hundred (a ward review)
      // they would only blanket the map, and the new lines say it better.
      points: view.changes.length > TIMELINE_CHANGES_MAX_MARKERS ? [] : view.changes
        .filter((change) => Array.isArray(change.point))
        .map((change) => ({ id: change.key, lng: Number(change.point[0]), lat: Number(change.point[1]) }))
    });
  }

  /**
   * Keep the changes button about the edition on the map. A map opened from the catalogue,
   * or an edition changed some other way, is described against the edition before it, but
   * not drawn until the reader steps or opens the list.
   */
  syncTimelineChangesToShownEdition() {
    const items = this.getTimelineAnimationItems();
    const shown = this.getShownTimelineIndex(items);
    const view = this.timelineChangeView;
    if (shown < 0) {
      if (view) this.setTimelineChangeView(null);
      else this.renderTimelineChangesControl();
      return;
    }
    if ((view && view.toMapId === items[shown].mapId) || this.timelineChangeStepPending) {
      this.renderTimelineChangesControl();
      return;
    }
    if (shown > 0) this.showTimelineStepChanges(shown - 1, shown, items, { draw: false }).catch(() => {});
    else this.setTimelineChangeView(null);
  }

  renderTimelineChangesControl() {
    const group = document.getElementById('timelineChangesGroup');
    const button = document.getElementById('timelineChanges');
    if (!group || !button) return;
    const view = this.timelineChangeView;
    const items = this.getTimelineAnimationItems();
    const boundaryTimeline = !this.elections?.activeEntry && items.some((item) => item?.mapId);
    group.hidden = !boundaryTimeline;
    const toggle = document.getElementById('timelineHighlight');
    toggle?.setAttribute('aria-checked', this.getTimelineHighlightEnabled() ? 'true' : 'false');
    const known = view && view.kind !== 'unknown';
    button.hidden = !known;
    if (!known) {
      this.closeTimelineChangesPanel();
      return;
    }
    const label = view.kind === 'changes'
      ? `${view.count.toLocaleString('en-GB')} change${view.count === 1 ? '' : 's'}`
      : view.kind === 'redrawn' ? 'Redrawn' : 'No changes';
    button.textContent = label;
    button.dataset.kind = view.kind;
    button.title = `${view.fromLabel} to ${view.toLabel}: ${view.parts.map((part) => part.text).join(' ')}`;
    if (!document.getElementById('timelineChangesPanel')?.hidden) this.renderTimelineChangesPanel();
  }

  ensureTimelineChangesPanel() {
    let panel = document.getElementById('timelineChangesPanel');
    if (panel) return panel;
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return null;
    panel = document.createElement('section');
    panel.id = 'timelineChangesPanel';
    panel.className = 'timeline-changes-panel';
    panel.setAttribute('aria-label', 'Boundary changes');
    panel.hidden = true;
    panel.addEventListener('click', (event) => {
      const zoom = event.target.closest?.('[data-change-key]');
      if (zoom) {
        this.zoomToTimelineChange(zoom.dataset.changeKey);
        return;
      }
      if (event.target.closest?.('.timeline-changes-panel__close')) this.closeTimelineChangesPanel({ focusButton: true });
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeTimelineChangesPanel({ focusButton: true });
    });
    host.appendChild(panel);
    return panel;
  }

  toggleTimelineChangesPanel() {
    const panel = this.ensureTimelineChangesPanel();
    if (!panel) return;
    if (!panel.hidden) {
      this.closeTimelineChangesPanel();
      return;
    }
    // Opening the list draws the changes it lists.
    if (this.timelineChangeView && !this.timelineChangeView.drawn) {
      this.timelineChangeView.drawn = true;
      this.drawTimelineChanges();
    }
    this.renderTimelineChangesPanel();
    panel.hidden = false;
    document.getElementById('timelineChanges')?.setAttribute('aria-expanded', 'true');
    panel.querySelector('.timeline-changes-panel__close')?.focus({ preventScroll: true });
  }

  closeTimelineChangesPanel(options = {}) {
    const panel = document.getElementById('timelineChangesPanel');
    const button = document.getElementById('timelineChanges');
    if (panel && !panel.hidden) {
      panel.hidden = true;
      if (options.focusButton) button?.focus({ preventScroll: true });
    }
    button?.setAttribute('aria-expanded', 'false');
  }

  renderTimelineChangesPanel() {
    const panel = this.ensureTimelineChangesPanel();
    const view = this.timelineChangeView;
    if (!panel || !view) return;
    const esc = (value) => escapeHtml(String(value ?? ''));
    const typeLabel = { created: 'New', abolished: 'Abolished', renamed: 'Renamed', transfer: 'Transfer', reorganised: 'Transfer', appeared: 'Added', disappeared: 'Gone' };
    const reversedType = { created: 'abolished', abolished: 'created', appeared: 'disappeared', disappeared: 'appeared' };
    const summaries = view.parts.map((part) => `<p class="timeline-changes-panel__summary">${view.parts.length > 1 ? `<strong>${esc(part.label)}:</strong> ` : ''}${esc(part.text)}</p>`).join('');
    const list = view.changes.length
      ? `<ol class="timeline-changes-panel__list">${view.changes.map((change) => {
        const type = view.reversed ? (reversedType[change.type] || change.type) : change.type;
        return `<li class="timeline-changes-panel__item">
          <span class="timeline-changes-panel__type timeline-changes-panel__type--${esc(type)}">${esc(typeLabel[type] || 'Change')}</span>
          <span class="timeline-changes-panel__text">${esc(change.text)}${change.step ? ` <span class="timeline-changes-panel__step">(${esc(change.step)})</span>` : ''}</span>
          <button type="button" class="timeline-changes-panel__zoom" data-change-key="${esc(change.key)}" aria-label="Zoom to: ${esc(change.text)}" title="Zoom to this change">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </li>`;
      }).join('')}</ol>`
      : '';
    const more = view.skipped > 0 ? `<p class="timeline-changes-panel__summary">and ${view.skipped} more step${view.skipped === 1 ? '' : 's'}: step one edition at a time to see them.</p>` : '';
    const key = view.changes.length
      ? `<p class="timeline-changes-panel__key" aria-hidden="true"><span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--area"></span>changed area <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--new"></span>new line <span class="timeline-changes-panel__swatch timeline-changes-panel__swatch--gone"></span>line gone</p>`
      : '';
    const note = view.note ? `<p class="timeline-changes-panel__note"><strong>Catalogue note:</strong> ${esc(view.note)}</p>` : '';
    panel.innerHTML = `
      <header class="timeline-changes-panel__header">
        <h2 class="timeline-changes-panel__title">Changes, ${esc(view.fromLabel)} to ${esc(view.toLabel)}</h2>
        <button type="button" class="timeline-changes-panel__close" aria-label="Close the list of changes">&times;</button>
      </header>
      ${summaries}${more}${key}${list}${note}`;
  }

  zoomToTimelineChange(changeKey) {
    const change = this.timelineChangeView?.changes?.find((item) => item.key === changeKey);
    if (!change || !Array.isArray(change.bbox)) return;
    const [w, s, e, n] = change.bbox.map(Number);
    // A small change is shown with some country round it, not filling the screen.
    const padLng = Math.max((e - w) * 0.6, 0.01);
    const padLat = Math.max((n - s) * 0.6, 0.006);
    this.mapController?.fitToBounds?.([w - padLng, s - padLat, e + padLng, n + padLat]);
    if (this.isPhoneLayout?.()) this.closeTimelineChangesPanel();
  }

  /**
   * Two editions of one series switched on together were drawn identically, with two identical
   * legend entries. The older is now grey and dashed, and the legend says which is which.
   */
  updateEditionRoles() {
    const ids = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id) && this.isMapVisible(id));
    const groups = new Map();
    for (const id of ids) {
      const chain = dataService.getChainForMap?.(id);
      if (!chain) continue;
      const key = `${chain.id}|${(dataService.getColumnClassIds?.(chain, id) || []).join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    const roles = new Map();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const dated = members
        .map((id) => ({ id, time: Number(dataService.parseMapDate?.(dataService.getMapById(id)?.date)) }))
        .sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity));
      roles.set(dated[0].id, 'newer');
      for (const { id } of dated.slice(1)) roles.set(id, 'older');
    }
    for (const id of new Set([...(this.editionRoles?.keys() || []), ...roles.keys()])) {
      this.mapController?.setEditionRole?.(id, roles.get(id) === 'older' ? 'older' : null);
    }
    this.editionRoles = roles;
  }

  async unloadMap(mapId, options = {}) {
    if (!options.preserveTimelineAnimation && this.isTimelineAnimationLayer(mapId)) {
      await this.stopTimelineAnimation({ restoreOriginal: false });
    }
    if (this.unloadActiveElectionForLayer(mapId)) return;
    const mapConfig = dataService.getMapById(mapId);
    if (this.mapController.getLayerState(mapId)?.isGroup) {
      this.mapController.unloadLayer(mapId);
    } else if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      compositeChildIds(mapConfig).forEach((memberId) => this.mapController.unloadLayer(memberId));
      this.mapController.unloadLayer(mapId);
    } else if (mapConfig?.isGroup && Array.isArray(mapConfig.variants)) {
      mapConfig.variants.forEach((variant) => this.mapController.unloadLayer(variant.id));
      this.mapController.unloadLayer(mapId);
    } else {
      this.mapController.unloadLayer(mapId);
    }
  }

  unloadActiveElectionForLayer(mapId) {
    if (!mapId || !this.elections?.activeEntry) return false;
    if (!this.isActiveElectionLayerId(mapId)) return false;
    const backingLayerIds = this.getActiveElectionBackingLayerIds(mapId);
    this.elections.unloadElection({ unloadBackingLayer: false });
    for (const layerId of backingLayerIds) {
      if (this.mapController.getLayerState(layerId) || this.mapController.groupStates?.has(layerId)) {
        this.mapController.unloadLayer(layerId);
      }
    }
    return true;
  }

  isActiveElectionLayerId(mapId) {
    if (!mapId || !this.elections?.activeEntry) return false;
    const activeElectionIds = this.getActiveElectionLayerIds();
    const candidateIds = this.getMapUnloadCandidateIds(mapId);
    return [...candidateIds].some((candidateId) => activeElectionIds.has(candidateId));
  }

  getActiveElectionLayerIds() {
    if (!this.elections?.activeEntry) return new Set();
    const activeEntry = this.elections.activeEntry;
    const activeBundle = this.elections.activeBundle;
    return new Set([
      this.elections.getCanonicalLayerId?.(activeEntry),
      activeEntry?.sourceMapId,
      activeBundle?.sourceMapId,
      activeBundle?.layerId
    ].filter(Boolean));
  }

  getMapUnloadCandidateIds(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    return new Set([
      mapId,
      ...compositeChildIds(mapConfig),
      ...(Array.isArray(mapConfig?.variants) ? mapConfig.variants.map((variant) => variant?.id).filter(Boolean) : [])
    ].filter(Boolean));
  }

  getActiveElectionBackingLayerIds(mapId) {
    const activeEntry = this.elections?.activeEntry;
    const activeBundle = this.elections?.activeBundle;
    const backingIds = new Set([
      activeEntry?.sourceMapId,
      activeBundle?.sourceMapId,
      activeBundle?.layerId
    ].filter(Boolean));
    const candidateIds = this.getMapUnloadCandidateIds(mapId);
    const requestedBackingIds = [...candidateIds].filter((candidateId) => backingIds.has(candidateId));
    return requestedBackingIds.length ? requestedBackingIds : [...backingIds];
  }

  /**
   * options.focus: the reader opened or closed it (not a restored link), so focus goes with
   * it: into the panel on open, back to its button on close. It used to drop to <body>, leaving
   * a keyboard or screen-reader user at the top of the page (UX-TRIAGE T3-06).
   */
  setMapControlsOpen(open, options = {}) {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlPanel = document.getElementById('mapControlPanel');
    mapControlsToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    mapControlPanel?.classList.toggle('map-control-panel--collapsed', !open);
    mapControlPanel?.classList.toggle('map-control-panel--expanded', Boolean(open));
    if (options.focus) this.movePanelFocus(mapControlPanel, mapControlsToggle, open);
    this.updateURLState();
  }

  setActiveLayersPanelOpen(open, options = {}) {
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayers = document.getElementById('activeLayers');
    activeLayersToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    activeLayers?.classList.toggle('hidden', !open);
    if (options.focus) this.movePanelFocus(activeLayers, activeLayersToggle, open);
    this.updateURLState();
  }

  movePanelFocus(panel, toggle, open) {
    if (!panel) return;
    if (!open) {
      // Only when focus was inside, or would otherwise be lost: a click on the map that
      // closed it should not pull focus back to the button.
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) toggle?.focus({ preventScroll: true });
      return;
    }
    // After the panel is shown: a hidden element cannot take focus.
    requestAnimationFrame(() => {
      const target = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .find((el) => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      if (target) target.focus({ preventScroll: true });
      else {
        if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
      }
    });
  }

  /**
   * T1-06: apply a basemap, recording whether the user chose it deliberately.
   *
   * `userChoice` matters because the theme toggle also wants to change the
   * basemap, and must never override a deliberate pick. Both the basemap select
   * and a `?base=` URL parameter count as deliberate — a shared link carrying a
   * basemap is someone's choice, even if the person opening it is not the one who
   * made it.
   */
  async applyBaseMap(baseMapId, { userChoice = false } = {}) {
    this.baseMapId = baseMapId || 'osm-standard';
    if (userChoice) {
      this.userPickedBasemap = true;
      try { localStorage.setItem('basemapUserChoice', '1'); } catch { /* private mode */ }
    }
    const map = this.mapController?.map;
    if (!map) return;
    // Not map.once('load'): that fires once, on the first frame drawn, so a wait begun after
    // it (a tile still loading makes isStyleLoaded() false) never ended.
    await this.whenStyleLoaded();
    this.mapController.setBaseMap(this.baseMapId);
  }

  /**
   * Keep the basemap on OpenStreetMap.
   *
   * T1-06 originally made this follow the theme, switching to `cartodb-dark` in dark
   * mode so a white landmass did not sit beside a black panel. That is no longer
   * possible: CARTO's basemaps now require an API key, and rather than failing they
   * serve tiles with "API KEY REQUIRED — carto.com/basemaps/apikey" printed across
   * every one. Measured 2026-08-26: those requests return HTTP 200, so nothing in the
   * app could detect it -- the map simply rendered the watermark, and looked broken to
   * every visitor in dark mode.
   *
   * OSM has no dark variant, so dark mode now keeps the standard basemap. That gives up
   * T1-06's benefit and it is the right trade: a light basemap is a cosmetic mismatch,
   * a watermarked one is a broken map. Restoring a dark basemap means either a keyed
   * provider or a self-hosted style, which is a deliberate choice rather than a default.
   *
   * Kept as a method (rather than deleted) because callers and tests use its return
   * value, and because this is where a future dark basemap would be reinstated.
   */
  async syncBasemapToTheme() {
    if (this.userPickedBasemap) return null;
    const wanted = 'osm-standard';
    if (this.baseMapId === wanted) return null;
    await this.applyBaseMap(wanted);
    // Keep the Map Settings control honest about what is actually displayed.
    const select = document.getElementById('baseMapSelect');
    if (select) select.value = wanted;
    return wanted;
  }

  setupSourcePanel() {
    if (document.getElementById('test2SourcePanel')) return;
    const panel = document.createElement('aside');
    panel.id = 'test2SourcePanel';
    panel.className = 'test2-source-panel hidden';
    panel.setAttribute('aria-label', 'Layer sources');
    panel.innerHTML = `
      <div class="test2-source-panel__header">
        <h3>Sources</h3>
        <button type="button" id="test2SourcePanelClose" class="test2-source-panel__close" aria-label="Close sources">Close</button>
      </div>
      <div id="test2SourcePanelContent" class="test2-source-panel__content">Load a layer to inspect sources.</div>
    `;
    document.body.appendChild(panel);
    document.getElementById('test2SourcePanelClose')?.addEventListener('click', () => this.closeSourcePanel());
  }

  /**
   * "Features here": every feature of the visible layers under the point clicked, so a reader
   * can show another one (a ward under a constituency, the 1911 union under the 1851 one) in the
   * feature details without hunting for a spot where it is on top.
   */
  addFeaturesHereList(current) {
    const entries = this.mapController?.featuresAtLastClick?.() || [];
    const content = document.getElementById('featureInfoContent');
    const section = content?.querySelector('.feature-info__section');
    if (!section || entries.length < 2) return;
    const isCurrent = (entry) => current && entry.mapId === current.mapId
      && String(entry.featureName) === String(current.featureName || current.name || '');
    const wrap = document.createElement('div');
    wrap.className = 'feature-info__here';
    const listId = 'featureInfoHereList';
    wrap.innerHTML = `<button type="button" class="feature-info__here-btn" aria-expanded="false" aria-controls="${listId}">${entries.length} here</button>
      <ul id="${listId}" class="feature-info__here-list" hidden>${entries.map((entry, i) => `<li><button type="button" data-here="${i}"${isCurrent(entry) ? ' aria-current="true"' : ''}><span class="feature-info__here-name">${escapeHtml(entry.featureName)}</span><span class="feature-info__here-layer">${escapeHtml(entry.layerName || '')}</span></button></li>`).join('')}</ul>`;
    const toggle = wrap.querySelector('.feature-info__here-btn');
    const list = wrap.querySelector('ul');
    const setOpen = (open) => { list.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); };
    toggle.addEventListener('click', () => setOpen(list.hidden));
    list.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-here]');
      if (!button) return;
      this.featuresHereKeepOpen = true;
      this.mapController.selectFeatureAtClick(entries[Number(button.dataset.here)]);
    });
    // The button sits at the end of the layer-name line; the list opens beneath it.
    const headerRow = section.querySelector('.feature-info__header-row');
    if (headerRow) {
      headerRow.appendChild(toggle);
      headerRow.after(wrap);
    } else section.prepend(wrap);
    if (this.featuresHereKeepOpen) setOpen(true);
    this.featuresHereKeepOpen = false;
  }

  /**
   * A layer's name in the Active Layers list opens its page in the catalogue pane (what the "i"
   * button did, which went to save width; owner, 1 Nov 2026). Enter or Space does the same.
   */
  bindActiveLayerSourceButtons() {
    const rows = document.querySelectorAll('#activeLayersList .active-layer-item[data-map-id]');
    rows.forEach((row) => {
      const name = row.querySelector('.active-layer-item__name');
      const mapId = row.dataset.mapId;
      if (!name || !mapId || name.dataset.opensPage) return;
      name.dataset.opensPage = '1';
      name.classList.add('active-layer-item__name--link');
      name.setAttribute('role', 'button');
      name.setAttribute('tabindex', '0');
      name.title = "Open this map's page";
      const open = () => {
        // Reveal the catalogue pane if the app is in map-only mode.
        if (uiController.currentStateId === 'map-full') uiController.setSplitState('info-full');
        uiController.showCatalogueDetailView(mapId);
      };
      name.addEventListener('click', open);
      name.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        open();
      });
    });
  }

  openSourcePanel(mapId) {
    this.currentSourceMapId = mapId || null;
    const panel = document.getElementById('test2SourcePanel');
    if (!panel || !this.currentSourceMapId) return;
    panel.classList.remove('hidden');
    this.renderSourcePanel();
    this.updateURLState();
  }

  closeSourcePanel() {
    this.currentSourceMapId = null;
    document.getElementById('test2SourcePanel')?.classList.add('hidden');
    this.updateURLState();
  }

  async renderSourcePanel() {
    const content = document.getElementById('test2SourcePanelContent');
    if (!content) return;
    const records = await this.getSourceRecords(this.currentSourceMapId);
    if (!records.length) {
      content.textContent = 'No source metadata is available for this layer yet.';
      return;
    }
    content.innerHTML = records.map((record) => this.renderSourceRecord(record)).join('');
    content.querySelectorAll('[data-copy-source-link]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard?.writeText(button.dataset.copySourceLink || '');
          button.textContent = 'Copied';
        } catch {
          button.textContent = 'Failed';
        }
      });
    });
  }

  async getSourceRecords(mapId) {
    if (!mapId) return [];
    const groupState = this.mapController.getLayerState(mapId);
    const childIds = groupState?.isGroup
      ? groupState.childIds || []
      : this.getConvertedCompositeChildIds(dataService.getMapById(mapId));
    const ids = childIds.length ? childIds : [mapId];
    const records = ids
      .map((id) => {
        const layer = this.mapController.resolveLayer(id);
        const mainConfig = dataService.getMapById(id) || dataService.getMapById(layer?.sourceMapId) || null;
        if (!layer && !mainConfig) return null;
        return { id, layer, mainConfig };
      })
      .filter(Boolean);
    await Promise.all(records.map((record) => record.layer?.id
      ? this.metadataService.loadLayerDetails(record.layer.id).catch(() => null)
      : null));
    return records;
  }

  renderSourceRecord(record) {
    const layer = record.layer || {};
    const mainConfig = record.mainConfig || {};
    const title = layer.name || mainConfig.name || record.id;
    const provider = [layer.provider, mainConfig.provider].flat(2).filter(Boolean).join(', ');
    const sourceId = layer.sourceMapId || mainConfig.id || record.id;
    const references = [...(mainConfig.references || []), ...(layer.references || [])];
    const downloads = [...(mainConfig.sourceDownloads || []), ...(layer.sourceDownloads || [])];
    const technical = [
      layer.tileUrl ? { label: 'PMTiles archive', url: layer.tileUrl } : null,
      layer.metadataUrl ? { label: 'Tile metadata', url: layer.metadataUrl } : null,
      layer.tilesFallback ? { label: 'Directory tile fallback', url: layer.tilesFallback.replace('/{z}/{x}/{y}.pbf', '/metadata.json') } : null
    ].filter(Boolean);
    const share = this.buildLayerShareUrl(sourceId);
    return `
      <article class="test2-source-panel__record" data-source-map-id="${escapeHtml(sourceId)}">
        <header>
          <h4>${escapeHtml(title)}</h4>
          <button type="button" data-copy-source-link="${escapeHtml(share)}">Copy layer</button>
        </header>
        <dl>
          ${provider ? `<div><dt>Provider</dt><dd>${escapeHtml(provider)}</dd></div>` : ''}
          <div><dt>Source ID</dt><dd>${escapeHtml(sourceId)}</dd></div>
          ${layer.sourceType ? `<div><dt>Format</dt><dd>${escapeHtml(layer.sourceType)}</dd></div>` : ''}
        </dl>
        ${mainConfig.description || layer.description ? `<p>${escapeHtml(mainConfig.description || layer.description)}</p>` : ''}
        ${this.renderSourceLinks('References', references.map((item, index) => ({
          label: item.label || `Reference ${index + 1}`,
          url: item.url || item.file,
          note: item.note || item.description
        })))}
        ${this.renderSourceLinks('Downloads', downloads.map((item, index) => ({
          label: item.label || `Download ${index + 1}`,
          url: item.file || item.url,
          note: item.note || item.description
        })))}
        ${this.renderSourceLinks('Tiles', technical)}
      </article>
    `;
  }

  renderSourceLinks(title, links) {
    const validLinks = links.filter((link) => link.url);
    if (!validLinks.length) {
      return `<details class="test2-source-panel__group"><summary>${escapeHtml(title)} <span>0</span></summary><p>No ${escapeHtml(title.toLowerCase())} recorded.</p></details>`;
    }
    return `
      <details class="test2-source-panel__group" open>
        <summary>${escapeHtml(title)} <span>${validLinks.length}</span></summary>
        ${validLinks.map((link) => `
          <div class="test2-source-panel__link-row">
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}</a>
            ${link.note ? `<small>${escapeHtml(link.note)}</small>` : ''}
            <button type="button" data-copy-source-link="${escapeHtml(link.url)}">Copy</button>
          </div>
        `).join('')}
      </details>
    `;
  }

  buildLayerShareUrl(mapId) {
    const url = new URL(location.href);
    const params = this.getCurrentURLParams();
    params.set('layers', mapId);
    url.hash = params.toString();
    return url.toString();
  }

  getLoadedLayerIds() {
    const groupedChildIds = new Set();
    const ids = new Set();
    for (const [id, state] of this.mapController.groupStates.entries()) {
      if (!state.loaded) continue;
      ids.add(id);
      for (const childId of state.childIds || []) groupedChildIds.add(childId);
    }
    for (const [id, state] of this.mapController.layerStates.entries()) {
      if (state.loaded && !groupedChildIds.has(id)) ids.add(id);
    }
    for (const map of dataService.getAllMaps()) {
      const groupChildIds = compositeChildIds(map);
      if (map.isGroup && groupChildIds.length && groupChildIds.every((memberId) => ids.has(memberId))) {
        ids.add(map.id);
      }
    }
    return [...ids];
  }

  syncCatalogueMapState() {
    uiController.syncMapCatalogueState?.({
      visibleIds: this.mapController.getVisibleLayers(),
      loadedIds: this.getLoadedLayerIds()
    });
  }

  updateActiveLayers() {
    const loadedMaps = [];
    const visibilityMap = new Map();
    const partialLayerInfo = new Map();
    const groupedChildIds = new Set();
    for (const [id, state] of this.mapController.groupStates) {
      if (!state.loaded) continue;
      const config = dataService.getMapById(id) || state.config;
      if (config) loadedMaps.push(config);
      visibilityMap.set(id, state.visible);
      for (const childId of state.childIds || []) groupedChildIds.add(childId);
    }
    for (const [id, state] of this.mapController.layerStates) {
      if (groupedChildIds.has(id)) continue;
      const config = dataService.getMapById(id) || state.config;
      if (config) loadedMaps.push(config);
      visibilityMap.set(id, state.visible);
      const featureItems = this.mapController.getPartialFeatureItems?.(id) || [];
      if (featureItems.length > 0) {
        partialLayerInfo.set(id, {
          isPartial: this.mapController.isPartialLayer?.(id) || false,
          featureNames: this.mapController.getPartialFeatureNames?.(id) || featureItems.map((item) => item.name),
          featureItems
        });
      }
    }
    const activeOrder = this.getActiveLayerOrder(loadedMaps.map((map) => map.id));
    const orderIndex = new Map(activeOrder.map((id, index) => [id, index]));
    loadedMaps.sort((a, b) => {
      const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    uiController.updateActiveLayers(loadedMaps, visibilityMap, partialLayerInfo);
    this.bindActiveLayerSourceButtons();
    if (this.currentSourceMapId) this.renderSourcePanel();
    this.updateTimeline();
    this.updateEditionRoles();
    this.updateMapLegend();
  }

  /**
   * The map's legend (UX review 2026-10-30, #6). An election's colours were explained only in
   * a container inside the results pane's secondary views, so the map itself had no key: not
   * for the winner fills, not for the seat dots, and FF and SF are both greens. It now sits on
   * the map, open on a desktop and folded to a "Legend" button on a phone. Boundary maps are
   * listed by their colours when there is more than one to tell apart, or beside an election.
   */
  updateMapLegend() {
    const host = this.mapController?.map?.getContainer?.() || document.getElementById('map');
    if (!host) return;
    const election = this.elections?.legendModel?.() || null;
    const backing = new Set(election ? this.elections.getActiveElectionBackingLayerIds?.() || [] : []);
    // Census statistics are keyed by their classes, not listed as outlines.
    const statistics = this.getLoadedLayerIds()
      .filter((id) => this.isMapVisible(id))
      .map((id) => this.mapController?.getCensusOverlayLegend?.(id))
      .filter(Boolean);
    const statisticIds = new Set(statistics.map((s) => s.id));
    const layers = this.getLoadedLayerIds()
      .filter((id) => !backing.has(id) && !statisticIds.has(id) && this.isMapVisible(id))
      .map((id) => ({ id, name: this.mapLabel(id), colour: this.layerColour(id), role: this.editionRoles?.get(id) || null }))
      .filter((layer) => layer.colour);
    const showLayers = layers.length > 1 || ((election || statistics.length) && layers.length > 0);
    let legend = document.getElementById('test2MapLegend');
    if (!election && !showLayers && !statistics.length) {
      legend?.remove();
      return;
    }
    if (!legend) {
      legend = document.createElement('section');
      legend.id = 'test2MapLegend';
      legend.className = 'test2-map-legend';
      legend.setAttribute('aria-label', 'Map legend');
      // Folded on a phone, or over a short map (a laptop with the election pane up), where an
      // open key would cover much of what it explains.
      const roomy = !this.isPhoneLayout() && host.getBoundingClientRect().height >= 420;
      legend.innerHTML = `<details${roomy ? ' open' : ''}><summary class="test2-map-legend__summary"><span>Legend</span></summary><div class="test2-map-legend__body"></div></details>`;
      host.appendChild(legend);
    }
    const esc = (value) => escapeHtml(String(value ?? ''));
    const ink = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
      if (!m) return '#111827';
      const n = parseInt(m[1], 16);
      const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      return lum > 0.55 ? '#111827' : '#ffffff';
    };
    const parts = [];
    if (election) {
      const unit = election.unit ? `${election.unit === 'council' ? 'Councils' : election.unit === 'area' ? 'Areas' : 'Constituencies'} coloured by ${election.title.toLowerCase()}` : `${election.title}, low to high`;
      parts.push(`<p class="test2-map-legend__heading">${esc(unit)}</p>`);
      if (election.items.length) {
        const shown = election.items.slice(0, 14);
        parts.push(`<ul class="test2-map-legend__list">${shown.map((item) => `<li><span class="test2-map-legend__swatch" style="background:${esc(item.colour)};color:${ink(item.colour)}" aria-hidden="true">${esc(item.abbreviation.length <= 5 ? item.abbreviation : '')}</span><span class="test2-map-legend__name">${esc(item.name)}${item.abbreviation && item.abbreviation !== item.name ? ` <span class="test2-map-legend__abbr">(${esc(item.abbreviation)})</span>` : ''}</span><span class="test2-map-legend__count">${item.count}</span></li>`).join('')}</ul>`);
        if (election.items.length > shown.length) parts.push(`<p class="test2-map-legend__note">and ${election.items.length - shown.length} more</p>`);
      } else if (election.ramp) {
        parts.push(`<div class="test2-map-legend__ramp" style="background:${esc(election.ramp.gradient)}" aria-hidden="true"></div><p class="test2-map-legend__ramp-labels"><span>${esc(election.ramp.low)}</span><span>${esc(election.ramp.high)}</span></p>`);
      }
      if (election.seats) parts.push('<p class="test2-map-legend__note"><span class="test2-map-legend__dots" aria-hidden="true"><i></i><i></i><i></i></span>One dot per seat, in the colour of the party that won it</p>');
      else if (election.bars) parts.push('<p class="test2-map-legend__note">Bars: each party\'s share of the vote</p>');
    }
    for (const stat of statistics) {
      const entry = stat.entry;
      const source = entry.source || {};
      const sourceHtml = source.url
        ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || 'Source')}</a>`
        : esc(source.title || '');
      const licenceHtml = stat.licence
        ? (stat.licence.url ? `<a href="${esc(stat.licence.url)}" target="_blank" rel="noopener">${esc(stat.licence.short || stat.licence.name)}</a>` : esc(stat.licence.short || stat.licence.name))
        : '';
      // The summary already names a lone statistic; a heading is needed only to tell several apart.
      const titled = election || statistics.length > 1;
      parts.push(`<div class="test2-map-legend__statistic" data-census-legend="${esc(stat.id)}">`
        + (titled ? `<p class="test2-map-legend__heading">${esc(entry.name)}</p>` : '')
        + `<ul class="test2-map-legend__list test2-map-legend__list--classes">${stat.classes.map((cls) => `<li><span class="test2-map-legend__swatch" style="background:${esc(cls.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">${esc(cls.label)}</span><span class="test2-map-legend__count" title="Areas in this class">${cls.count}</span></li>`).join('')}`
        + (entry.noFigureNote ? '<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line" style="border-color:#374151" aria-hidden="true"></span><span class="test2-map-legend__name">No figure</span></li>' : '')
        + '</ul>'
        + (entry.legendNote ? `<p class="test2-map-legend__note">${esc(entry.legendNote)}</p>` : '')
        + (entry.noFigureNote ? `<p class="test2-map-legend__note">${esc(entry.noFigureNote)}</p>` : '')
        + ((sourceHtml || licenceHtml) ? `<p class="test2-map-legend__note test2-map-legend__source">Source: ${sourceHtml}${sourceHtml && licenceHtml ? ', ' : ''}${licenceHtml}</p>` : '')
        + '</div>');
    }
    if (showLayers) {
      // Two editions of one series: the older is drawn grey and dashed (updateEditionRoles).
      const edition = (layer) => (layer.role === 'older' ? ' <span class="test2-map-legend__abbr">(older edition, grey dashed)</span>'
        : layer.role === 'newer' ? ' <span class="test2-map-legend__abbr">(newer edition)</span>' : '');
      parts.push(`${election || statistics.length ? '<p class="test2-map-legend__heading">Other maps</p>' : ''}<ul class="test2-map-legend__list">${layers.map((layer) => `<li><span class="test2-map-legend__swatch test2-map-legend__swatch--line${layer.role === 'older' ? ' test2-map-legend__swatch--older' : ''}" style="border-color:${esc(layer.role === 'older' ? '#6b7280' : layer.colour)}" aria-hidden="true"></span><span class="test2-map-legend__name">${esc(layer.name)}${edition(layer)}</span></li>`).join('')}</ul>`);
    }
    // The election map as a Wikipedia-style SVG of this view, areas in their party colours.
    const electionMapId = election ? this.elections.getActiveElectionStyleSourceMapId?.() : null;
    if (electionMapId) parts.push(`<button type="button" class="test2-map-legend__export" data-map-image-export="${esc(electionMapId)}"><span data-export-label>Download map (SVG)</span></button>`);
    legend.querySelector('.test2-map-legend__body').innerHTML = parts.join('');
    legend.querySelector('[data-map-image-export]')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      this.exportMapImage(button.dataset.mapImageExport, 'svg', { trigger: button });
    });
    legend.querySelector('.test2-map-legend__summary span').textContent = election
      ? `Legend: ${election.title}`
      : statistics.length === 1 ? `Legend: ${statistics[0].entry.name}` : 'Legend';
  }

  /** The outline colour a loaded layer is drawn in, or '' (rasters and point clouds have none). */
  layerColour(mapId) {
    const testId = this.mapController?.mainToTest?.get(mapId) || mapId;
    const record = this.mapController?.renderer?.layers?.get(testId);
    if (!record || /raster|image|point-cloud/.test(record.config?.sourceType || '')) return '';
    return record.color || record.fillColor || '';
  }

  /**
   * T0-05. Remember how the last load of `mapId` ended, for the catalogue announcement.
   *
   * 'unavailable' is deliberately NOT stored: it means the adapter had no map to watch,
   * which is a test stub or a torn-down page, and recording it would let "we could not
   * observe this" harden into a claim about the layer.
   */
  recordSettleOutcome(mapId, outcome) {
    if (!mapId) return outcome;
    if (!this.settleOutcomes) this.settleOutcomes = new Map();
    if (outcome === 'settled' || outcome === 'timeout') this.settleOutcomes.set(mapId, outcome);
    else this.settleOutcomes.delete(mapId);
    return outcome;
  }

  isMapLoaded(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      return compositeChildIds(mapConfig).some((memberId) => this.mapController.isLayerLoaded(memberId));
    }
    return this.mapController.isLayerLoaded(mapId);
  }

  isMapVisible(mapId) {
    return this.mapController.isLayerVisible(mapId);
  }

  getPrimaryPartialFeatureURLState() {
    const states = this.mapController?.layerStates;
    if (!states?.[Symbol.iterator]) return null;
    for (const [mapId, state] of states) {
      if (!state?.isPartial || !state.loadedIndices?.size) continue;
      const featureId = [...state.loadedIndices][0];
      const featureName = state.featureNames?.get(featureId) || state.featureProperties?.get(featureId)?.name || '';
      return { mapId, featureId, featureName };
    }
    return null;
  }

  /*
   * Browser history (UX review 2026-10-30, #17). Every update used replaceState, so the page
   * had one history entry and Back left the app. A meaningful step -- a layer added or taken
   * off, an election opened or closed, a constituency chosen, a catalogue route -- now makes
   * a new entry; panning, zooming and scrubbing the slider still rewrite the current one.
   *
   * beginNavigation() is called BEFORE the change, because the change itself writes the
   * address on the way (a layer's onChange, a fit's moveend): the first write that differs from
   * the address is the one that pushes, and the rest rewrite the entry it made.
   * endNavigation() writes the final state and stops a step that changed nothing from turning
   * a later pan into a history entry.
   */
  beginNavigation(label) {
    // A message from an earlier step ("This link asks for something not found here", an old
    // "could not be loaded") goes once the reader does something else (UX review 2026-10-31, L6).
    this.dismissStaleMapMessage();
    if (this._restoringURLState) return;
    this._pushNextURL = label || 'Map';
  }

  endNavigation() {
    this.updateURLState();
    this._pushNextURL = null;
  }

  pushURLState(label) {
    this.beginNavigation(label);
    this.endNavigation();
  }

  /** A step that failed leaves no history entry behind: if one was pushed since `mark`, step
   * back over it, without restoring anything (the map is already as it was). */
  undoNavigationSince(mark) {
    if (!Number.isInteger(mark) || this.navIndex <= mark) return;
    this._ignoreHashChanges = (this._ignoreHashChanges || 0) + 1;
    history.go(mark - this.navIndex);
    // Forget the abandoned entry, so the History list does not offer it.
    this.navEntries = this.navEntries.slice(0, mark + 1);
    setTimeout(() => { this._ignoreHashChanges = Math.max(0, (this._ignoreHashChanges || 0) - 1); }, 500);
  }

  /** A label for a history entry pushed by something other than the app (the catalogue's
   * routes), from the address it goes to. */
  describeNavigation(url) {
    try {
      const params = new URLSearchParams(String(url || '').split('#')[1] || '');
      const route = params.get('cat') || '';
      const [view, a] = route.split('/');
      if (view === 'map' && a) return `Catalogue: ${this.mapLabel(a)}`;
      if (view === 'elections') return a === 'person' ? 'Elections: a person' : 'Catalogue: Elections';
      if (view) return `Catalogue: ${view.charAt(0).toUpperCase()}${view.slice(1).replace(/-/g, ' ')}`;
    } catch { /* fall through */ }
    return 'Map';
  }

  updateURLState() {
    if (this._suspendURLState || this._restoringURLState) return;
    const loaded = this.getLoadedLayerIds();
    const electionState = this.elections?.getURLState?.();
    const electionSourceIds = new Set([
      this.elections?.activeEntry?.sourceMapId,
      this.elections?.activeBundle?.sourceMapId,
      this.elections?.activeBundle?.layerId
    ].filter(Boolean));
    const urlLoaded = electionState?.layerId
      ? [electionState.layerId, ...loaded.filter((id) => !electionSourceIds.has(id))]
      : loaded;
    const hidden = urlLoaded.filter((id) => id !== electionState?.layerId && !electionSourceIds.has(id) && !this.isMapVisible(id));
    const layerOrder = this.getActiveLayerOrder(urlLoaded).filter((id) => urlLoaded.includes(id));
    const partialFeatureState = this.getPrimaryPartialFeatureURLState();
    const params = new URLSearchParams();
    const center = this.mapController.map?.getCenter?.();
    const zoom = this.mapController.map?.getZoom?.();
    if (urlLoaded.length) params.set('layers', urlLoaded.join(','));
    if (layerOrder.length > 1 && layerOrder.some((id, index) => id !== urlLoaded[index])) {
      params.set('layerOrder', layerOrder.join(','));
    }
    if (hidden.length) params.set('hidden', hidden.join(','));
    if (partialFeatureState?.mapId && partialFeatureState.featureId !== undefined && partialFeatureState.featureId !== null) {
      params.set('featureMap', partialFeatureState.mapId);
      params.set('featureId', String(partialFeatureState.featureId));
      if (partialFeatureState.featureName) params.set('featureName', partialFeatureState.featureName);
    }
    if (this.searchQuery) params.set('q', this.searchQuery);
    const detailViewOpen = !document.getElementById('catalogueDetailView')?.classList.contains('hidden');
    if (this.currentDetailMapId && detailViewOpen) {
      params.set('detail', this.currentDetailMapId);
    }
    // A party, person, constituency or feature page has an address of its own (UX review
    // 2026-10-31, H4), so it can be reloaded, bookmarked, shared and returned to with Back.
    if (this.currentPage && detailViewOpen) {
      const page = this.currentPage.kind === 'feature' ? `feature:${this.currentPage.key}` : pageParamOf(this.currentPage);
      if (page) params.set('page', page);
    }
    if (this.currentSourceMapId && !document.getElementById('test2SourcePanel')?.classList.contains('hidden')) {
      params.set('source', this.currentSourceMapId);
    }
    if (center) {
      params.set('lng', center.lng.toFixed(5));
      params.set('lat', center.lat.toFixed(5));
    }
    if (Number.isFinite(zoom)) params.set('zoom', zoom.toFixed(2));
    if (this.baseMapId && this.baseMapId !== 'osm-standard') params.set('base', this.baseMapId);
    if (document.getElementById('activeLayersToggle')?.getAttribute('aria-expanded') === 'true') params.set('activePanel', '1');
    if (document.getElementById('mapControlsToggle')?.getAttribute('aria-expanded') === 'true') params.set('controls', '1');
    if (electionState) {
      params.set('electionBody', electionState.body);
      params.set('electionDate', electionState.date);
      params.set('electionMode', electionState.mode);
      params.set('electionOverlay', electionState.overlay);
      params.set('electionView', electionState.view);
      params.set('electionLocalMode', electionState.localMode);
      if (electionState.geographyMode) params.set('electionGeographyMode', electionState.geographyMode);
      if (electionState.selected) params.set('electionSelected', electionState.selected);
      if (electionState.countDetail) params.set('electionCountDetail', '1');
      if (electionState.entityKind && electionState.entityKey) {
        params.set('electionEntityKind', electionState.entityKind);
        params.set('electionEntityKey', electionState.entityKey);
        if (electionState.entityReturnView) params.set('electionEntityReturnView', electionState.entityReturnView);
      }
    }
    const catalogueRoute = uiController.catalogueNextRoute?.();
    if (catalogueRoute) params.set('cat', catalogueRoute);
    const path = `${location.pathname}${location.search || ''}`;
    const next = params.toString() ? `${path}#${params.toString()}` : path;
    if (this._pushNextURL && next !== `${location.pathname}${location.search || ''}${location.hash}`) {
      this._pendingNavLabel = this._pushNextURL;
      this._pushNextURL = null;
      history.pushState(null, '', next);
    } else {
      history.replaceState(null, '', next);
    }
    this.syncDocumentTitle();
  }

  /**
   * T1-05 / T2-07: reflect the current view in document.title.
   *
   * The title was the literal string "Civgraph" in every state, so a tab, a
   * bookmark and a shared link were indistinguishable no matter what was open.
   * Called from updateURLState, which already runs whenever the view changes, so
   * the title and the URL cannot drift apart.
   */
  syncDocumentTitle() {
    const SUFFIX = 'Civgraph';
    let subject = null;
    try {
      const election = this.elections?.activeBundle;
      const page = this.currentPage && !document.getElementById('catalogueDetailView')?.classList.contains('hidden') ? this.currentPage : null;
      if (page?.title) {
        // "Ulster Unionist Party – Party – Civgraph": the page, not the election behind it.
        subject = `${page.title} – ${page.typeLabel || 'Page'}`;
      } else if (election?.displayTitle) {
        subject = election.displayTitle;
      } else if (this.currentDetailMapId) {
        subject = this.metadataService?.getLayer?.(this.currentDetailMapId)?.name
          || this.currentDetailMapId;
      } else {
        const loaded = this.getLoadedLayerIds?.() || [];
        if (loaded.length === 1) {
          subject = this.metadataService?.getLayer?.(loaded[0])?.name || null;
        } else if (loaded.length > 1) {
          subject = `${loaded.length} layers`;
        } else if (this.searchQuery) {
          subject = `Search: ${this.searchQuery}`;
        }
      }
    } catch {
      subject = null;
    }
    const next = subject
      ? `${String(subject).replace(/\s+/g, ' ').trim()} - ${SUFFIX}`
      : `${SUFFIX} - Maps of Irish administrative geography and history`;
    if (document.title !== next) document.title = next;
  }

  getCurrentURLParams() {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
  }

  async restoreURLState(options = {}) {
    this._restoringURLState = true;
    const shouldUpdateAfterRestore = options.updateAfterRestore !== false;
    const params = renameElectionDatesInParams(this.getCurrentURLParams());
    const query = params.get('q');
    try {
      if (options.sync) this.removeStateNotIn(params);
      this.searchQuery = query || '';
      const search = document.getElementById('searchInput');
      if (search) search.value = this.searchQuery;
      document.getElementById('searchClear')?.classList.toggle('visible', this.searchQuery.length > 0);
      this.updateMapList();
      // The results follow the address, not only the box (UX review 2026-10-31, L5): Back from
      // Browse restored "Ian Paisley" to the box with no results under it, and Back to an
      // address with no search cleared the box and left the old results showing.
      if (this.searchQuery !== String(uiController._catalogueSearchQuery || '').trim()) {
        uiController.onSearch?.(this.searchQuery);
      }

      const baseMap = params.get('base');
      if (baseMap) {
        const select = document.getElementById('baseMapSelect');
        if (select) select.value = baseMap;
        // T1-06: a ?base= in the URL is a deliberate choice too, so the theme
        // must not override it on load.
        await this.applyBaseMap(baseMap, { userChoice: true });
      }

      const layers = (params.get('layers') || '').split(',')
        .map((id) => resolveLegacyLayerId(id.trim())).filter(Boolean);
      const featureMapId = resolveLegacyLayerId(params.get('featureMap') || '');
      const featureIdParam = params.get('featureId') || '';
      const featureNameParam = params.get('featureName') || '';
      if (this.hasElectionURLState(params, layers)) {
        await this.ensureElections({ refreshCatalogue: true });
      }
      // Election ids are recognised by their SHAPE, not by a catalogue lookup.
      //
      // isCanonicalElectionLayerId answers by searching the election catalogue, so it
      // returns false while that catalogue is still loading -- and then the id falls
      // through to loadMap, which has no such layer and raises "election-... is not
      // converted for the MapLibre route yet". The election itself loads a moment later
      // when restoreURLState runs, so the page ends up correct with an error banner over
      // it, which is why every "Open in interactive map" link from Browse looked broken.
      //
      // hasElectionURLState above already trusts the prefix for exactly this reason. No
      // catalogue map or render layer begins with `election-`, checked against both.
      const mapLayers = layers.filter((id) => !String(id).startsWith('election-')
        && !this.elections?.isCanonicalElectionLayerId?.(id)
        && (!featureMapId || id !== featureMapId));
      // What the link asks for and this site does not have: listed for the reader instead of
      // being dropped from the address without a word (UX review 2026-10-30, #15).
      const missing = [];
      const knownLayer = (id) => Boolean(dataService.getMapById(id) || this.mapController.resolveLayer?.(id));
      const layersToLoad = mapLayers.filter((id) => {
        if (knownLayer(id)) return true;
        missing.push(`map “${id}”`);
        return false;
      });
      await Promise.all(layersToLoad.map((id) => this.loadMap(id).catch((error) => this.reportMapLoadFailure(id, error))));

      try {
        await this.elections?.restoreURLState?.(params);
      } catch (error) {
        if (/not found/i.test(error?.message || '')) {
          missing.push(`election “${[params.get('electionBody'), params.get('electionDate')].filter(Boolean).join(' ') || params.get('election')}”`);
        } else {
          this.showMapError(error, { retry: () => this.restoreURLState() });
        }
      }
      for (const id of layers.filter((value) => String(value).startsWith('election-'))) {
        if (this.elections && !this.elections.findEntryByCanonicalLayerId?.(id)) missing.push(`election “${id}”`);
      }
      if (missing.length) {
        this.showMapError(`This link asks for ${missing.length === 1 ? 'something' : 'things'} not found here, so ${missing.length === 1 ? 'it was' : 'they were'} left out: ${missing.join(', ')}.`, { kind: 'info' });
      }

      if (featureMapId && featureIdParam) {
        const mapConfig = dataService.getMapById(featureMapId);
        if (mapConfig) {
          await this.mapController.loadSingleFeature(mapConfig, featureIdParam, featureNameParam || featureIdParam, null, { isolate: true });
        }
      }

      const hidden = new Set((params.get('hidden') || '').split(',').map((id) => id.trim()).filter(Boolean));
      hidden.forEach((id) => this.mapController.hideLayer(id));
      this.restoreLayerOrder(params);
      this.syncCatalogueMapState();
      this.updateActiveLayers();

      const detailId = params.get('detail');
      const page = parsePageParam(params.get('page'));
      if (page) {
        // Not awaited: a constituency page loads its elections' results, and the map behind it
        // should not wait for that. The page shows its name and a skeleton meanwhile.
        this.restorePage(page, { initial: !options.sync });
      } else if (detailId && dataService.getMapById(detailId)) {
        uiController.showCatalogueDetailView(detailId, false);
        this.currentDetailMapId = detailId;
      } else if (!detailId && (this.currentDetailMapId || this.currentPage)) {
        uiController.showCatalogueListView(false);
      }

      const sourceId = params.get('source');
      if (sourceId) {
        this.currentSourceMapId = sourceId;
        document.getElementById('test2SourcePanel')?.classList.remove('hidden');
        await this.renderSourcePanel();
      } else {
        this.currentSourceMapId = null;
        document.getElementById('test2SourcePanel')?.classList.add('hidden');
      }

      const hasViewport = params.has('lng') && params.has('lat');
      const lng = hasViewport ? Number(params.get('lng')) : NaN;
      const lat = hasViewport ? Number(params.get('lat')) : NaN;
      const zoomParam = params.get('zoom') ?? params.get('z');
      const z = Number(zoomParam);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        this.mapController.map?.jumpTo({ center: [lng, lat], zoom: Number.isFinite(z) ? z : undefined });
      }

      this.setActiveLayersPanelOpen(params.get('activePanel') === '1');
      this.setMapControlsOpen(params.get('controls') === '1');
    } finally {
      this._restoringURLState = false;
      if (shouldUpdateAfterRestore) this.updateURLState();
      if (this._hashRestorePending) {
        this._hashRestorePending = false;
        setTimeout(() => this.restoreURLState({ updateAfterRestore: false, sync: true }).catch((error) => this.showMapError(error)), 0);
      }
    }
  }

  triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    if (filename) link.download = filename;
    // The `download` attribute is ignored for cross-origin URLs, and our FGBs
    // live on data.civgraph.net / archive.org (a different origin from the app).
    // Without this, a plain click is treated as a top-level navigation and the
    // whole app is replaced by the raw file URL — which reads as "the download
    // button does nothing". Open cross-origin targets in a new tab instead so the
    // app is preserved; the file downloads if the host sends an attachment
    // disposition, otherwise it opens for the user to save.
    let crossOrigin = false;
    try {
      crossOrigin = new URL(url, window.location.href).origin !== window.location.origin;
    } catch (_) { /* relative/blob URL — treat as same-origin */ }
    if (crossOrigin) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /**
   * "Download SVG" / "Download PNG": the map in the current view as a Wikipedia-style locator
   * map (app/src/map-image-export.js), the selected feature red, an election's areas in their
   * party colours. Large layers take a moment, so the trigger shows a busy state and the map
   * says what is happening; a view with too many features is refused with a reason.
   * options: { trigger?: HTMLElement, selection?: { properties, name } }
   */
  async exportMapImage(mapId, format = 'svg', options = {}) {
    if (!mapId) return null;
    if (this._mapImageExport) {
      this.showMapError(new Error('A map image is already being prepared.'), { kind: 'info' });
      return null;
    }
    const trigger = options.trigger || null;
    const label = trigger?.querySelector?.('[data-export-label]') || trigger;
    const original = label?.textContent;
    if (trigger) {
      trigger.setAttribute('aria-busy', 'true');
      trigger.disabled = true;
      if (label) label.textContent = 'Preparing…';
    }
    const progress = (text) => this.showMapError(new Error(text), { kind: 'info' });
    const work = (async () => {
      progress(`Preparing the ${format.toUpperCase()} of ${this.mapLabel(mapId)}…`);
      const { buildMapSvg, svgToPng } = await import('./map-image-export.js');
      const result = await buildMapSvg(this, mapId, { selection: options.selection || null, onProgress: progress });
      if (format === 'png') {
        const png = await svgToPng(result.svg, result.width, result.height, 2);
        uiController.triggerBlobDownload(png, result.filename.replace(/\.svg$/, '.png'));
      } else {
        uiController.triggerBlobDownload(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }), result.filename);
      }
      const what = result.selectedName ? ` with ${result.selectedName} highlighted` : '';
      progress(`Downloaded ${result.filename.replace(/\.svg$/, `.${format}`)}: ${result.featureCount.toLocaleString('en-GB')} features${what}.`);
      return result;
    })();
    this._mapImageExport = work;
    try {
      return await work;
    } catch (error) {
      this.showMapError(error);
      return null;
    } finally {
      this._mapImageExport = null;
      if (trigger) {
        trigger.removeAttribute('aria-busy');
        trigger.disabled = false;
        if (label && original !== undefined) label.textContent = original;
      }
    }
  }

  /** Say something to screen readers through the page's live region. Cleared first so the
   * same words twice ("… loaded" for two maps of one name) are still read out. */
  announce(message) {
    const announcer = document.getElementById('announcer');
    if (!announcer || !message) return;
    announcer.textContent = '';
    setTimeout(() => { announcer.textContent = message; }, 30);
  }

  /**
   * A failure the reader can see, dismiss and, where it makes sense, retry (UX review
   * 2026-10-30, #15). It used to be a line of text pinned over the map with no way to close it,
   * and most failures did not reach it at all: a layer whose tiles never came still said "On
   * map", and a bad id in a shared link was dropped from the address without a word.
   *
   * options.retry: called by the Retry button, after the notice closes.
   * options.kind: 'error' (default, role=alert) or 'info' (role=status, for what a link asked
   *   for that does not exist: nothing failed, but the reader should know).
   */
  showMapError(error, options = {}) {
    if (options.kind !== 'info') console.warn('[Test2]', error);
    const message = error?.message || String(error || '') || 'Map layer is not available in MapLibre yet.';
    let status = document.getElementById('test2Status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'test2Status';
      // On the map itself: the election pane covers the foot of .pane--map.
      (document.getElementById('map') || document.querySelector('.pane--map'))?.appendChild(status);
    }
    status.className = `map-error${options.kind === 'info' ? ' map-error--info' : ''}`;
    status.setAttribute('role', 'group');
    status.setAttribute('aria-label', options.kind === 'info' ? 'Message' : 'Error');
    status.hidden = false;
    status.innerHTML = '';
    const shownAt = Date.now();
    status.dataset.shownAt = String(shownAt);
    // A note (not an error) clears itself after a while; an error waits to be dismissed or retried.
    if (options.kind === 'info') {
      setTimeout(() => {
        if (status.dataset.shownAt === String(shownAt)) { status.hidden = true; status.innerHTML = ''; }
      }, 15000);
    }
    const text = document.createElement('span');
    text.className = 'map-error__text';
    text.textContent = message;
    status.appendChild(text);
    const close = () => {
      status.hidden = true;
      status.innerHTML = '';
    };
    if (typeof options.retry === 'function') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'map-error__retry';
      retry.textContent = options.retryLabel || 'Retry';
      retry.addEventListener('click', () => {
        close();
        Promise.resolve().then(options.retry).catch((err) => this.showMapError(err, options));
      });
      status.appendChild(retry);
    }
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'map-error__close';
    dismiss.setAttribute('aria-label', 'Dismiss this message');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', close);
    status.appendChild(dismiss);
    // Said through the page's one live region, as "… loaded" is, so a screen reader hears the
    // failure where it heard the success; the box itself is not a second live region.
    this.announce(message);
  }

  /** Hide the map message if it has been up for a moment: one raised by the step now starting
   * is newer than that, and stays. */
  dismissStaleMapMessage(minAgeMs = 1500) {
    const status = document.getElementById('test2Status');
    if (!status || status.hidden) return;
    const shownAt = Number(status.dataset.shownAt || 0);
    if (Date.now() - shownAt >= minAgeMs) this.hideMapError();
  }

  hideMapError() {
    const status = document.getElementById('test2Status');
    if (status) { status.hidden = true; status.innerHTML = ''; }
  }

  /** A map's name, for a message: its series and edition as the catalogue shows them
   * ("Townlands, Ireland"), else its catalogue name, else its id. */
  mapLabel(mapId) {
    const cat = uiController._catalogueNext;
    const series = cat?.seriesById?.get(cat.seriesOfMap?.get(mapId));
    if (series) {
      const member = [...(series.members || []), ...(series.local || [])].find((m) => m.id === mapId);
      if (member && (series.members.length > 1 || series.local?.some((m) => m.id === mapId))) return `${series.name}, ${member.label}`;
      return series.name;
    }
    const config = dataService.getMapById(mapId);
    return String(config?.name || this.metadataService?.getLayer?.(mapId)?.name || mapId).replace(/\s+/g, ' ').trim();
  }
}

const app = new Test2App();
app.init().catch((error) => {
  console.error('[Test2] Failed to start', error);
  const target = document.getElementById('map') || document.body;
  target.insertAdjacentHTML('beforeend', `<div class="map-error">Failed to start Civgraph: ${escapeHtml(error.message)}</div>`);
});

/**
 * Layer ids that have been renamed, mapped old -> new.
 *
 * A layer id is not private. It appears in `#layers=` share links, so renaming one
 * breaks every link anyone has posted, bookmarked or cited -- silently, as an empty map
 * rather than an error. This is the cost that makes id renames worth avoiding, and the
 * reason to accept a slightly wrong id is usually stronger than it looks.
 *
 * `roi-local-authorities-*` was renamed to `local-authorities-*` on 2026-08-22. The
 * prefix was wrong for four of the 26 layers outright -- 1915 and the three 1920 dates
 * cover the whole island, before partition -- and anachronistic for a dozen more, since
 * there was no republic before 1949. The fix was not a better jurisdiction prefix but
 * none at all: the display name carries the scope, and encoding a jurisdiction that
 * changes over the life of a series is what went wrong in the first place.
 *
 * Kept as a prefix rewrite rather than 26 entries so the table cannot fall out of step
 * with the rename.
 */
const LEGACY_LAYER_ID_PREFIXES = [
  ['roi-local-authorities-', 'local-authorities-'],
  // NI editions re-dated to the census date on 2026-11-01 (the id carries the date): Newtownards RD
  // was renamed North Down RD on 1 Aug 1954, not 1 Apr (Census 1961); Londonderry's wards were
  // reduced on 15 May 1938, not 16 May (Census 1951). The 1939 edition became a layer of its own
  // (Ballymena made a borough), and the 1957 "CED" edition was the county map counties-ireland-1957.
  ['admin-areas-1954-04-01', 'admin-areas-1954-08-01'],
  ['ded-1954-04-01', 'ded-1954-08-01'],
  ['county-ed-1954-04-01', 'county-ed-1954-08-01'],
  ['admin-areas-1938-05-16', 'admin-areas-1938-05-15'],
  ['ded-1938-05-16', 'ded-1938-05-15'],
  ['county-ed-1938-05-16', 'county-ed-1938-05-15'],
  ['admin-areas-1939-05-23-alias-test', 'admin-areas-1939-05-23-vector-test'],
  ['county-ed-1957-04-01-vector-test', 'counties-ireland-1957-vector-test']
];

// Elections whose polling date was corrected, which changed their keys: old links keep working.
// [body slug, old date, new date]
const RENAMED_ELECTION_DATES = [
  ['house-of-commons-of-the-united-kingdom', '1968-04-17', '1969-04-17'], // Mid Ulster by-election (Devlin)
  ['house-of-commons-of-the-united-kingdom', '2011-06-06', '2011-06-09'], // Belfast West by-election
  ['northern-ireland-assembly', '1983-04-27', '1983-04-20'] // Armagh by-election
];

function renameElectionDatesInParams(params) {
  for (const [name, value] of [...params.entries()]) {
    let next = value;
    for (const [body, from, to] of RENAMED_ELECTION_DATES) {
      next = next.split(`${body}__${from}`).join(`${body}__${to}`).split(`${body}:${from}`).join(`${body}:${to}`);
      if (name === 'electionDate' && next === from && slugifyBody(params.get('electionBody')) === body) next = to;
    }
    if (next !== value) params.set(name, next);
  }
  return params;
}

function slugifyBody(value) {
  return String(value || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-').replace(/-+/g, '-');
}

function resolveLegacyLayerId(id) {
  const value = String(id || '');
  if (!value) return value;
  for (const [from, to] of LEGACY_LAYER_ID_PREFIXES) {
    if (value.startsWith(from)) return `${to}${value.slice(from.length)}`;
  }
  return value;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function slugifyEntityKey(value) {
  return String(value || '')
    .split('|')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(party|candidate|person|name):/, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeEntityName(value) {
  return String(value || '')
    .split('|')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[''`]/g, '')
    .replace(/[-_/.,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function electionBodyFromEntityKey(key) {
  const bodyKey = String(key || '').split('__')[0];
  if (!bodyKey) return '';
  if (bodyKey.startsWith('local-government')) return 'Local Government Districts';
  const bodies = new Map([
    ['dail-eireann', 'Dáil Éireann'],
    ['house-of-commons-of-the-united-kingdom', 'House of Commons of the United Kingdom'],
    ['northern-ireland-assembly', 'Northern Ireland Assembly'],
    ['northern-ireland-forum-for-political-dialogue', 'Northern Ireland Forum for Political Dialogue'],
    ['northern-ireland-constitutional-convention', 'Northern Ireland Constitutional Convention'],
    ['parliament-of-northern-ireland', 'Parliament of Northern Ireland'],
    ['european-parliament', 'European Parliament'],
    ['ireland-european', 'European Parliament (Ireland)'],
    ['ireland-president', 'President of Ireland'],
    ['president-of-ireland', 'President of Ireland'],
    ['ireland-referendum', 'Referendum (Ireland)'],
    ['ireland-local', 'Local Government (Ireland)']
  ]);
  return bodies.get(bodyKey) || bodyKey.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function electionTypeFromEntityKey(key, title = '') {
  const bodyKey = String(key || '').split('__')[0];
  const label = `${bodyKey} ${title || ''}`;
  if (bodyKey.startsWith('local-government') || bodyKey === 'ireland-local') return 'Local';
  if (bodyKey === 'house-of-commons-of-the-united-kingdom') return 'Westminster';
  if (bodyKey === 'dail-eireann') return 'Dáil';
  if (bodyKey === 'northern-ireland-assembly') return 'Assembly';
  if (bodyKey === 'northern-ireland-forum-for-political-dialogue') return 'Forum';
  if (bodyKey === 'northern-ireland-constitutional-convention') return 'Convention';
  if (bodyKey === 'parliament-of-northern-ireland') return 'Parliament of NI';
  if (bodyKey === 'european-parliament' || bodyKey === 'ireland-european') return 'European';
  if (bodyKey === 'ireland-president' || bodyKey === 'president-of-ireland') return 'Presidential';
  if (/referendum/i.test(label)) return 'Referendum';
  // Belfast County Borough, Strabane Urban District and the like: councils, so local elections.
  if (/council|borough|urban-district|rural-district|corporation/i.test(bodyKey)) return 'Local';
  if (bodyKey === 'seanad-eireann') return 'Seanad';
  return bodyKey ? bodyKey.replace(/-/g, ' ') : 'Election';
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function shortCacheName(name) {
  return String(name || '')
    .replace(/^civgraph-test2-sw-v\d+-/, '')
    .replace(/^civgraph-/, '');
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The kinds of page the catalogue pane opens for an election entity; "person" is a candidate. */
const ENTITY_TYPE_LABEL = Object.freeze({
  party: 'Party',
  candidate: 'Person',
  constituency: 'Constituency',
  dea: 'District Electoral Area',
  lgd: 'Council',
  feature: 'Feature'
});

function canonicalEntityKind(kind) {
  const value = String(kind || '').toLowerCase();
  if (value === 'person' || value === 'candidate') return 'candidate';
  return ENTITY_TYPE_LABEL[value] && value !== 'feature' ? value : '';
}

/** How the address names a page: page=person:ian-paisley-48601, page=party:dup. */
function pageParamOf(page) {
  if (!page?.kind || !page.key) return '';
  return `${page.kind === 'candidate' ? 'person' : page.kind}:${page.key}`;
}

function parsePageParam(value) {
  const text = String(value || '');
  const at = text.indexOf(':');
  if (at <= 0) return null;
  const rawKind = text.slice(0, at);
  const key = text.slice(at + 1);
  if (!key) return null;
  if (rawKind === 'feature') return { kind: 'feature', key };
  const kind = canonicalEntityKind(rawKind);
  return kind ? { kind, key } : null;
}

/** A readable name for a page whose data has not arrived: the name part of a "Name|Party" key,
 * else the key, else for a bare person id, "Person 48601". */
function entityKeyLabel(kind, key) {
  const text = String(key || '').split('|')[0].trim();
  if (kind === 'candidate' && /^\d+$/.test(text)) return `Person ${text}`;
  if (kind === 'candidate' && /-\d+$/.test(text)) {
    return text.replace(/-\d+$/, '').split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }
  return text;
}

/** Where to look for a page in Browse when it cannot be opened here: a search of its section. */
function entityBrowseSearchUrl(kind, label) {
  const section = kind === 'party' ? 'parties' : kind === 'candidate' ? 'persons' : 'features';
  return `/browse/#/${section}?q=${encodeURIComponent(String(label || '').split('|')[0].trim())}`;
}

/** fn over items, at most `limit` at a time, results in the items' order. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
