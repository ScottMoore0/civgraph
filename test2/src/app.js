import 'maplibre-gl/dist/maplibre-gl.css';
import './test2.css';
import dataService from '../../js/data-service.js';
import featureLoader from '../../js/feature-loader.js';
import uiController from '../../js/ui-controller.js';
import { TestMetadataService } from '../../test/src/metadata-service.js';
import { Test2MapLibreMainAdapter } from './maplibre-main-adapter.js';

const TEST2_LAYER_ORDER_STORAGE_KEY = 'civgraph:test2:layer-order';

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
    this.currentSourceMapId = null;
    this.baseMapId = 'osm-standard';
    this.elections = null;
    this.timelineItems = [];
    this.timelineOnSelect = null;
    this.timelineApplying = false;
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
    this.installRouteGuard();
    this.registerServiceWorker();

    await dataService.init();
    dataService.fuse = null;
    this.booksPromise = this.loadBooks();

    this.metadataService = new TestMetadataService('/test/metadata/maps-test-index.json?v=test-022', undefined, {
      cache: 'force-cache',
      portPlanCache: 'force-cache'
    });
    await this.metadataService.load();

    this.mapController = new Test2MapLibreMainAdapter('map', this.metadataService, {
      onFeatureClick: (features) => {
        const feature = features?.[0] || null;
        if (feature && this.elections?.showFeatureResults(feature)) {
          uiController.hideFeatureInfo?.();
          return;
        }
        uiController.showFeatureInfo(features, dataService.getAllMaps());
      },
      getMainMap: (mapId) => dataService.getMapById(mapId),
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
    uiController.init();
    this.relocateMobileCatalogueToggle();
    this.configureCataloguePerformanceProfile();

    this._suspendURLState = true;
    this.mapController.init('map');
    window.__civgraphTest2 = {
      app: this,
      mapController: this.mapController,
      metadataService: this.metadataService,
      elections: null,
      restorePromise: null,
      serviceWorkerStatusPromise: this.serviceWorkerStatusPromise,
      getPerformanceStatus: () => this.collectPerformanceStatus()
    };
    this.prepareSearchWorker();
    this.renderCategoryPills();
    this.updateMapList();
    this.setupSearch();
    this.setupThemeToggle();
    this.setupSupportModal();
    this.setupMapControls();
    this.setupPerformanceDashboard();
    this.setupTimelineControls();
    this.setupElectionPaneResize();
    this.setupSourcePanel();
    this.setupURLStateListener();
    this.scheduleElectionCatalogueWarm();
    window.__civgraphTest2.restorePromise = this.restoreURLState()
      .catch((error) => this.showMapError(error))
      .finally(() => {
        this._suspendURLState = false;
        this.updateURLState();
      });
    await window.__civgraphTest2.restorePromise;
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      this.serviceWorkerStatusPromise = Promise.resolve({ available: false, reason: 'service-worker API unavailable' });
      return;
    }
    const path = window.location.pathname || '/';
    const canRegister = path.startsWith('/test2/') || path === '/test2';
    if (!canRegister) {
      this.serviceWorkerStatusPromise = Promise.resolve({ available: false, reason: 'outside /test2 scope' });
      return;
    }
    this.serviceWorkerStatusPromise = navigator.serviceWorker.register('/test2/sw.js', { scope: '/test2/' })
      .then(async (registration) => {
        await navigator.serviceWorker.ready.catch(() => registration);
        return this.getServiceWorkerStatus(registration);
      })
      .catch((error) => ({
        available: false,
        reason: String(error?.message || error)
      }));
  }

  async getServiceWorkerStatus(registration = null) {
    if (!('serviceWorker' in navigator)) return { available: false, reason: 'service-worker API unavailable' };
    const activeRegistration = registration || await navigator.serviceWorker.getRegistration('/test2/');
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
    this.performanceBudget = fetch('/test2/build/performance-dashboard.json', { cache: 'no-cache' })
      .then((response) => response.ok ? response.json() : null)
      .catch(() => null);
    return this.performanceBudget;
  }

  relocateMobileCatalogueToggle() {
    const toggle = document.getElementById('mobileToggle');
    const header = document.querySelector('.app-header');
    const menuButton = document.getElementById('mobileMenuBtn');
    if (!toggle || !header || !menuButton) return;
    toggle.classList.add('mobile-toggle--navbar');
    toggle.removeAttribute('style');
    toggle.setAttribute('aria-label', 'Show or hide catalogue');
    if (toggle.parentElement !== header) {
      header.insertBefore(toggle, menuButton);
    }
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
    const minPaneHeight = 120;
    const defaultPaneHeight = () => Math.round(Math.min(window.innerHeight * 0.38, Math.max(minPaneHeight, window.innerHeight * 0.32)));
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
    const clampPaneHeight = (height) => Math.max(minPaneHeight, Math.min(maxPaneHeight(), Math.round(height)));
    const invalidateMapSize = () => {
      requestAnimationFrame(() => this.mapController?.invalidateSize?.());
    };
    const setPaneHeight = (height, options = {}) => {
      const { invalidate = true } = options || {};
      const nextHeight = clampPaneHeight(height);
      document.body.style.setProperty('--test2-election-pane-height', `${nextHeight}px`);
      if (invalidate) invalidateMapSize();
      return nextHeight;
    };
    const startDrag = (event) => {
      const handle = event.target.closest?.('[data-election-pane-resize]');
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      event.preventDefault();
      handle.setPointerCapture?.(event.pointerId);
      document.body.classList.add('test2-election-pane-resizing');
      const onMove = (moveEvent) => {
        setPaneHeight(window.innerHeight - moveEvent.clientY, { invalidate: false });
      };
      const onEnd = () => {
        document.body.classList.remove('test2-election-pane-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        invalidateMapSize();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    };
    document.addEventListener('pointerdown', startDrag);
    document.addEventListener('keydown', (event) => {
      const handle = event.target.closest?.('[data-election-pane-resize]');
      if (!handle) return;
      const pane = document.getElementById('electionResultsPane');
      if (!pane?.classList.contains('election-results-pane--open')) return;
      const current = pane.getBoundingClientRect().height || defaultPaneHeight();
      const step = event.shiftKey ? 50 : 20;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setPaneHeight(current + step);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setPaneHeight(current - step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPaneHeight(maxPaneHeight());
      } else if (event.key === 'End') {
        event.preventDefault();
        setPaneHeight(minPaneHeight);
      }
    });
    document.addEventListener('dblclick', (event) => {
      if (!event.target.closest?.('[data-election-pane-resize]')) return;
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
    history.replaceState = (state, title, url) => nativeReplaceState(state, title, preserveCurrentPath(url));
    history.pushState = (state, title, url) => nativePushState(state, title, preserveCurrentPath(url));

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
      const response = await fetch('/data/database/books.json');
      if (response.ok) uiController.booksData = await response.json();
    } catch (error) {
      console.warn('[Test2] Could not load books data', error);
    }
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
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warm, { timeout: 2500 });
    } else {
      setTimeout(warm, 750);
    }
  }

  hasElectionURLState(params, layers = []) {
    if ([...layers].some((id) => String(id).startsWith('election-'))) return true;
    return params.has('electionBody') || params.has('electionDate') || params.has('electionMode') || params.has('electionView');
  }

  wireUiCallbacks() {
    uiController.onBuildElectionCatalogueCards = async () => {
      if (this.elections?.catalogue) return this.elections.buildCatalogueCards();
      this.scheduleElectionCatalogueWarm();
      return [];
    };
    uiController.onLoadElection = async (body, date) => {
      try {
        const elections = await this.ensureElections();
        await elections.loadElection(body, date);
        this.updateMapList();
        this.focusActiveElectionCatalogueEntry(this.elections?.activeEntry, { scroll: false });
      } catch (error) {
        this.showMapError(error);
      }
    };
    uiController.onUnloadElection = () => {
      this.elections?.unloadElection();
      this.updateMapList();
    };
    uiController.onCheckElectionLoaded = (body, date) => this.elections?.isElectionLoaded(body, date) || false;
    uiController.onSetupElectionTableControls = () => {};
    uiController.onOpenElectionEntityDetail = async (kind, key) => this.openElectionEntityDetailInCatalogue(kind, key);
    uiController.onOpenElectionConstituencyFeature = async ({ constituency, level }) => {
      const kind = level === 'council' ? 'lgd' : level === 'dea' ? 'dea' : 'constituency';
      return this.openElectionEntityDetailInCatalogue(kind, constituency);
    };

    uiController.onSplitChange = () => {
      this.mapController.invalidateSize();
      this.updateURLState();
    };

    uiController.onMapLoad = async (mapId) => {
      await this.loadMap(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };

    uiController.onMapUnload = async (mapId) => {
      if (this.unloadActiveElectionForLayer(mapId)) {
        this.updateMapList();
        return;
      }
      const mapConfig = dataService.getMapById(mapId);
      if (this.mapController.getLayerState(mapId)?.isGroup) {
        this.mapController.unloadLayer(mapId);
      } else if (mapConfig?.isGroup && Array.isArray(mapConfig.members)) {
        mapConfig.members.forEach((memberId) => this.mapController.unloadLayer(memberId));
      } else if (mapConfig?.isGroup && Array.isArray(mapConfig.variants)) {
        mapConfig.variants.forEach((variant) => this.mapController.unloadLayer(variant.id));
      } else {
        this.mapController.unloadLayer(mapId);
      }
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };

    uiController.onMapToggle = (mapId) => {
      this.mapController.toggleLayer(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };

    uiController.onHideMap = (mapId) => {
      this.mapController.hideLayer(mapId);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    };
    uiController.onCheckMapLoaded = (mapId) => this.isMapLoaded(mapId);
    uiController.onCheckMapVisible = (mapId) => this.isMapVisible(mapId);
    uiController.onReorderLayers = (ids) => this.setActiveLayerOrder(ids);
    uiController.onExpandToFullMap = async (mapId) => this.loadMap(mapId);
    uiController.onPartialFeatureToggle = () => {};
    uiController.onPartialFeatureUnload = () => {};
    uiController.onCheckFeatureLoaded = () => false;
    uiController.onCheckFeatureVisible = () => false;
    uiController.onFeatureLoad = async (mapId, featureIndex, featureName, bbox) => {
      const mapConfig = dataService.getMapById(mapId);
      if (!mapConfig) return;
      await this.mapController.loadSingleFeature(mapConfig, featureIndex, featureName, bbox);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
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
      const url = mapConfig?.downloads?.fgb || mapConfig?.files?.fgb;
      if (url) this.triggerDownload(url, url.split('/').pop());
    };
    uiController.onAddressSelect = (lat, lon, name) => this.mapController.addAddressMarker(lat, lon, name);
    uiController.onRemoveAddressMarker = () => this.mapController.removeAddressMarker();
    uiController.onCheckIntersection = async (lat, lon) => this.mapController.queryFeaturesAtLngLat(lat, lon);
    uiController.onGetLoadedFeatures = () => this.mapController.getLoadedFeatures();
    uiController.onZoomToBbox = (bounds, options) => this.mapController.fitToBounds(bounds, options);
    uiController.onHighlightFeature = (mapId, featureId, options) => this.mapController.highlightFeature(mapId, featureId, options);
    uiController.onLoadSingleFeature = async (mapId, featureId, featureName, bbox) => {
      const mapConfig = dataService.getMapById(mapId);
      if (!mapConfig) return;
      const result = await this.mapController.loadSingleFeature(mapConfig, featureId, featureName, bbox);
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      uiController.showFeatureInfo([{ ...result.feature, mapId, id: featureId }], dataService.getAllMaps());
    };
  }

  installCatalogueStateBridge() {
    if (uiController.__test2CatalogueStateBridgeInstalled) return;
    uiController.__test2CatalogueStateBridgeInstalled = true;

    const showDetail = uiController.showCatalogueDetailView.bind(uiController);
    uiController.showCatalogueDetailView = (mapId, addToHistory = true) => {
      const result = showDetail(mapId, addToHistory);
      this.currentDetailMapId = mapId || null;
      this.updateURLState();
      return result;
    };

    const showList = uiController.showCatalogueListView.bind(uiController);
    uiController.showCatalogueListView = (addToHistory = false) => {
      const result = showList(addToHistory);
      this.currentDetailMapId = null;
      this.updateURLState();
      return result;
    };
  }

  setupURLStateListener() {
    window.addEventListener('hashchange', () => {
      if (this._suspendURLState || this._restoringURLState) return;
      this.restoreURLState({ updateAfterRestore: false }).catch((error) => this.showMapError(error));
    });
  }

  async loadMap(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    if (mapConfig?.isGroup && Array.isArray(mapConfig.members) && mapConfig.members.length) {
      await Promise.all(mapConfig.members.map((memberId) => this.loadMap(memberId)));
      this.mapController.markGroupLoaded(mapId, mapConfig, mapConfig.members);
      return;
    }
    if (mapConfig?.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      const variantIds = mapConfig.variants
        .map((variant) => variant?.id)
        .filter((variantId) => this.mapController.resolveLayer(variantId)?.loadable);
      await Promise.all(variantIds.map((variantId) => this.mapController.loadLayer(variantId, { fit: false })));
      this.mapController.markGroupLoaded(mapId, mapConfig, variantIds);
      if (mapConfig.bounds) this.mapController.fitToBounds(mapConfig.bounds, { smooth: false });
      else this.mapController.fitToLayers(variantIds);
      return;
    }
    const directLayer = this.mapController.resolveLayer(mapConfig?.id || mapId);
    if (!directLayer?.loadable) {
      const childIds = this.getConvertedCompositeChildIds(mapConfig);
      if (childIds.length) {
        await Promise.all(childIds.map((childId) => this.mapController.loadLayer(childId, { fit: false })));
        this.mapController.markGroupLoaded(mapConfig.id, mapConfig, childIds);
        if (mapConfig.bounds) this.mapController.fitToBounds(mapConfig.bounds, { smooth: false });
        return;
      }
    }
    await this.mapController.loadLayer(mapConfig || mapId);
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
      totalMaps: allMaps.length
    });
  }

  focusActiveElectionCatalogueEntry(entry, options = {}) {
    if (!entry?.body || !entry?.date) return;
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
    const focusRow = (attempt = 0) => {
      const rows = [...document.querySelectorAll('#catalogueFlatView .flat-election-entry')];
      const target = rows.find((row) => row.dataset.electionBody === entry.body && row.dataset.electionDate === entry.date);
      if (!target && attempt === 0) {
        restoreCatalogueListState();
        requestAnimationFrame(() => focusRow(1));
        return;
      }
      if (!target) return;
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
    const originalInitializeFuse = uiController.initializeFuse?.bind(uiController);
    uiController.initializeFuse = () => {
      if (!this.searchWorker) originalInitializeFuse?.();
    };
    uiController.performSearch = async (query) => {
      const ids = await this.searchCatalogueWithWorker(query, 50);
      const idSet = new Set(ids);
      const results = dataService.getAllMaps()
        .filter((map) => idSet.has(map.id))
        .slice(0, 20)
        .map((item) => ({ item }));
      let addressResults = [];
      try {
        if (query && query.length >= 2) addressResults = await uiController.searchAddresses(query);
      } catch {}
      uiController.renderCombinedAutocomplete(results, [], addressResults, query);
    };
    uiController.onSearch = (query) => {
      this.searchQuery = query;
      if (query?.length >= 2) {
        this.searchCatalogueWithWorker(query, 1000).then((ids) => {
          if (this.searchQuery !== query) return;
          this.workerSearchQuery = query;
          this.workerSearchResultIds = ids;
          this.updateMapList();
        }).catch(() => {});
      } else {
        this.workerSearchQuery = '';
        this.workerSearchResultIds = null;
      }
      this.updateMapList();
      this.updateURLState();
    };
    uiController.setupSearch();
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.overflow-menu')) {
        document.querySelectorAll('.overflow-menu--open').forEach((menu) => menu.classList.remove('overflow-menu--open'));
      }
    });
  }

  prepareSearchWorker() {
    if (!('Worker' in window)) return;
    try {
      this.searchWorker = new Worker('/test2/src/search-worker.js?v=test2-search-001', { type: 'module' });
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
    if (!trimmed || trimmed.length < 2) return [];
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
    const toggles = [document.getElementById('themeToggle'), document.getElementById('themeToggleMobile')].filter(Boolean);
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = savedTheme || (prefersDark ? 'dark' : 'light');
    toggles.forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('theme', next);
      });
    });
  }

  setupSupportModal() {
    const modal = document.getElementById('supportModal');
    const buttons = [document.getElementById('supportBtn'), document.getElementById('mobileSupportBtn')].filter(Boolean);
    if (!modal || buttons.length === 0) return;
    const open = () => modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');
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

  setupMapControls() {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlPanel = document.getElementById('mapControlPanel');
    const mapControlsClose = document.getElementById('mapControlsClose');
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayers = document.getElementById('activeLayers');
    const activeLayersClose = document.getElementById('activeLayersClose');
    const featureInfoClose = document.getElementById('featureInfoClose');

    mapControlsToggle?.addEventListener('click', () => {
      this.setMapControlsOpen(mapControlsToggle.getAttribute('aria-expanded') !== 'true');
    });
    mapControlsClose?.addEventListener('click', () => this.setMapControlsOpen(false));

    const overlayToggle = document.getElementById('overlayToggle');
    const overlayList = document.getElementById('overlayList');
    overlayToggle?.addEventListener('click', () => {
      const open = overlayToggle.getAttribute('aria-expanded') !== 'true';
      overlayToggle.setAttribute('aria-expanded', String(open));
      overlayList?.classList.toggle('overlay-list--collapsed', !open);
      overlayList?.classList.toggle('overlay-list--expanded', open);
    });

    document.getElementById('baseMapSelect')?.addEventListener('change', async (event) => {
      await this.applyBaseMap(event.target.value || 'osm-standard');
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

    let textScale = Number(localStorage.getItem('ni-boundaries.textScale') || '100');
    const textSteps = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const textValue = document.getElementById('textSizeValue');
    const applyTextScale = () => {
      if (textValue) textValue.textContent = `${textScale}%`;
      this.mapController.setTextScale(textScale);
      localStorage.setItem('ni-boundaries.textScale', String(textScale));
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
      this.setActiveLayersPanelOpen(activeLayersToggle.getAttribute('aria-expanded') !== 'true');
    });
    activeLayersClose?.addEventListener('click', () => this.setActiveLayersPanelOpen(false));
    featureInfoClose?.addEventListener('click', () => uiController.hideFeatureInfo());

    document.getElementById('conditionalStylingBtn')?.addEventListener('click', () => {
      this.showMapError(new Error('Conditional styling controls for /test2 will use MapLibre expressions; this route currently supports base opacity, labels, and text scale.'));
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
    this.serviceWorkerStatusPromise?.finally(() => render());
    setTimeout(render, 1200);
  }

  async openElectionEntityDetailInCatalogue(kind, key) {
    const detail = await this.loadElectionEntityBrowseDetail(kind, key);
    if (!detail) return false;
    uiController.showElectionEntityDetailInCatalogue(detail, true);
    return true;
  }

  async loadElectionEntityBrowseDetail(kind, key) {
    const normalizedKind = String(kind || '').toLowerCase();
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
    if (detail) this.browseEntityDetailCache.set(cacheKey, detail);
    return detail;
  }

  async loadPartyBrowseDetail(key) {
    const slug = slugifyEntityKey(key);
    const candidates = [...new Set([slug, String(key || '').trim().toLowerCase()].filter(Boolean))];
    for (const candidateSlug of candidates) {
      try {
        const response = await fetch(`/data/browse/details/parties/${encodeURIComponent(candidateSlug)}.json`, { cache: 'force-cache' });
        if (!response.ok) continue;
        const detail = await response.json();
        const item = detail.item || detail;
        const persons = await this.loadBrowsePersonsIndex();
        return this.mapPartyBrowseItem(item, persons);
      } catch (error) {
        console.warn('[Test2] Party Browse detail unavailable', candidateSlug, error);
      }
    }
    return null;
  }

  async loadPersonBrowseDetail(key) {
    const persons = await this.loadBrowsePersonsIndex();
    const wanted = slugifyEntityKey(key);
    const rawName = String(key || '').split('|')[0].trim();
    const rawNameSlug = slugifyEntityKey(rawName);
    const item = persons.find((person) => {
      const slugs = [
        person.slug,
        person.id,
        person.name,
        person.title
      ].map(slugifyEntityKey);
      return slugs.includes(wanted) || (rawNameSlug && slugs.includes(rawNameSlug));
    });
    return item ? this.mapPersonBrowseItem(item) : null;
  }

  async loadAreaBrowseDetail(kind, key) {
    const name = String(key || '').trim();
    if (!name) return null;
    const elections = await this.ensureElections();
    const catalogueEntries = Array.isArray(elections?.catalogue?.elections) ? elections.catalogue.elections : [];
    const target = normalizeEntityName(name);
    const rows = [];
    for (const entry of catalogueEntries) {
      const candidateNames = kind === 'lgd'
        ? [...(entry.localBodies || []), entry.body]
        : (entry.constituencies || []);
      const mayContainTarget = candidateNames.some((candidate) => normalizeEntityName(candidate) === target);
      if (!mayContainTarget && !(kind === 'constituency' && entry.key === this.elections?.activeEntry?.key)) continue;
      let bundle = null;
      try {
        bundle = await elections.loadBundle(entry);
      } catch {
        continue;
      }
      const matchingResults = (bundle.results || []).filter((result) => {
        if (kind === 'lgd') {
          return normalizeEntityName(result.localBody || result.localGovernmentDistrict || result.council || result.bodyLabel || '') === target;
        }
        return normalizeEntityName(result.constituency || result.matchName || result.featureName || '') === target;
      });
      if (!matchingResults.length) continue;
      if (kind === 'lgd') {
        rows.push(this.mapCouncilAreaHistoryRow(entry, bundle, name, matchingResults));
      } else {
        for (const result of matchingResults) {
          rows.push(this.mapConstituencyAreaHistoryRow(entry, bundle, result, kind));
        }
      }
    }
    rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.electionDisplayName || '').localeCompare(String(b.electionDisplayName || '')));
    if (!rows.length) return null;
    const metrics = {
      elections: rows.length,
      districts: [...new Set(rows.map((row) => normalizeEntityName(row.localGovernmentDistrict)).filter(Boolean))].length,
      deas: kind === 'lgd'
        ? rows.reduce((sum, row) => sum + Number(row.deaCount || 0), 0)
        : rows.length,
      totalValidVotes: rows.reduce((sum, row) => sum + Number(row.validVotes || 0), 0),
      totalSeats: rows.reduce((sum, row) => sum + Number(row.seats || 0), 0),
      latestDate: rows[0]?.date || null
    };
    return {
      kind,
      key: slugifyEntityKey(name),
      name,
      colour: rows[0]?.winnerColour || '#64748b',
      subtitle: kind === 'lgd' ? 'Local Government District / Council' : kind === 'dea' ? 'District Electoral Area' : 'Constituency',
      metrics,
      historyRows: rows
    };
  }

  async loadBrowsePersonsIndex() {
    if (!this.browsePersonsIndexPromise) {
      this.browsePersonsIndexPromise = fetch('/data/browse/persons.json', { cache: 'force-cache' })
        .then((response) => {
          if (!response.ok) throw new Error(`Browse persons index failed: ${response.status}`);
          return response.json();
        })
        .then((payload) => Array.isArray(payload.items) ? payload.items : []);
    }
    return this.browsePersonsIndexPromise;
  }

  mapPartyBrowseItem(item, persons = []) {
    const related = Array.isArray(item.relatedElections) ? item.relatedElections : [];
    const latestByMatch = (pattern) => related.find((row) => pattern.test(`${row.key || ''} ${row.title || ''}`));
    const historyRows = related.map((row) => this.mapPartyHistoryRow(row));
    const candidateSummaries = this.buildPartyCandidateSummaries(item, persons);
    return {
      kind: 'party',
      key: item.slug || slugifyEntityKey(item.canonicalName || item.title),
      name: item.canonicalName || item.title || item.slug || '',
      latestWestminster: historyRows.find((row) => /Westminster/i.test(row.electionType)) || latestByMatch(/house-of-commons|UK general|Westminster/i),
      latestAssembly: historyRows.find((row) => /Assembly/i.test(row.electionType)) || latestByMatch(/northern-ireland-assembly|Assembly/i),
      historyRows,
      partySummaries: historyRows,
      candidateSummaries,
      totals: item.totals || {},
      observedNames: item.observedNames || [],
      knownAliases: item.knownAliases || [],
      firstYear: item.firstYear,
      lastYear: item.lastYear
    };
  }

  mapPersonBrowseItem(item) {
    const elections = Array.isArray(item.elections) ? item.elections : [];
    const latest = elections[0] || null;
    const appearances = elections.map((row) => this.mapPersonAppearanceRow(row));
    return {
      kind: 'candidate',
      key: item.slug || item.id || slugifyEntityKey(item.name || item.title),
      personId: item.id || item.slug || '',
      name: item.name || item.title || '',
      latestParty: latest?.party || item.parties?.[0]?.name || '',
      parties: (item.parties || []).map((party) => party.name || party).filter(Boolean),
      dates: [...new Set(elections.map((row) => String(row.year || row.date || '')).filter(Boolean))],
      constituencies: (item.constituencies || []).map((row) => row.name || row).filter(Boolean),
      constituencyEntries: elections.map((row) => ({
        body: electionBodyFromEntityKey(row.key),
        date: row.date || '',
        constituency: row.constituency || '',
        level: electionTypeFromEntityKey(row.key, row.title) === 'Local' ? 'dea' : 'constituency',
        elected: Boolean(row.elected),
        mapLayerYear: row.year || String(row.date || '').slice(0, 4)
      })),
      appearances,
      firstPrefs: item.totals?.firstPrefs || 0,
      electedCount: item.totals?.elected || 0,
      shareOfAllValid: null,
      latestAppearance: appearances[0] || latest
    };
  }

  mapPartyHistoryRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key) || row.body || '';
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    const totalSeats = row.totalSeats ?? null;
    const elected = row.seats ?? row.elected ?? null;
    const stood = row.stood ?? row.candidates ?? null;
    return {
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: body,
      date: row.date || '',
      electionType,
      rank: row.rank ?? null,
      rankDelta: row.rankDelta ?? null,
      contested: !/referendum|recall/i.test(`${row.title || ''} ${row.key || ''}`),
      isRecallPetition: /recall petition/i.test(`${row.title || ''} ${row.key || ''}`),
      isByElection: /by-election/i.test(`${row.title || ''} ${row.key || ''}`),
      stood,
      stoodDelta: row.stoodDelta ?? null,
      elected,
      electedDelta: row.electedDelta ?? row.seatsDelta ?? null,
      totalSeats,
      totalSeatsDelta: row.totalSeatsDelta ?? null,
      seatPct: totalSeats ? (Number(elected || 0) / Number(totalSeats) * 100) : null,
      seatPctDelta: row.seatPctDelta ?? null,
      constituenciesContested: row.constituenciesContested ?? row.constituencies ?? null,
      constituenciesContestedDelta: row.constituenciesContestedDelta ?? null,
      totalConstituencies: row.totalConstituencies ?? null,
      totalConstituenciesDelta: row.totalConstituenciesDelta ?? null,
      firstPrefs: row.votes ?? row.firstPrefs ?? null,
      firstPrefsDelta: row.votesDelta ?? row.firstPrefsDelta ?? null,
      validVotePct: row.share ?? row.validVotePct ?? null,
      validVotePctDelta: row.shareDelta ?? row.validVotePctDelta ?? null,
      bodyGroup: row.bodyGroup || null
    };
  }

  mapPersonAppearanceRow(row = {}) {
    const body = electionBodyFromEntityKey(row.key);
    const electionType = electionTypeFromEntityKey(row.key, row.title);
    const firstPref = row.firstPref ?? row.firstPrefs ?? row.votes ?? null;
    return {
      electionDisplayName: row.title || row.key || '',
      electionBodyForOpen: body,
      body,
      bodyLabel: electionType === 'Local' ? (row.localBody || row.bodyLabel || body) : body,
      date: row.date || '',
      constituency: row.constituency || '',
      party: row.party || '',
      status: row.status || (row.elected ? 'Elected' : ''),
      rank: row.rank || null,
      firstPref,
      firstPrefs: firstPref,
      firstPrefPct: row.firstPrefPct ?? row.share ?? null,
      elected: Boolean(row.elected),
      electionType,
      isByElection: /by-election/i.test(`${row.title || ''} ${row.key || ''}`),
      overallStandingNumber: row.overallStandingNumber ?? null,
      overallElectedNumber: row.overallElectedNumber ?? null,
      bodyStandingNumber: row.bodyStandingNumber ?? null,
      bodyElectedNumber: row.bodyElectedNumber ?? null
    };
  }

  buildPartyCandidateSummaries(item = {}, persons = []) {
    const aliases = new Set([
      item.canonicalName,
      item.title,
      ...(item.observedNames || []),
      ...(item.knownAliases || [])
    ].map(normalizeEntityName).filter(Boolean));
    const summaries = new Map();
    for (const person of persons || []) {
      for (const row of person.elections || []) {
        if (!aliases.has(normalizeEntityName(row.party))) continue;
        const personId = person.id || person.slug || slugifyEntityKey(person.name || person.title);
        if (!summaries.has(personId)) {
          summaries.set(personId, {
            personId,
            name: person.name || person.title || personId,
            totalFirstPrefs: 0,
            timesStood: 0,
            timesStoodLocal: 0,
            timesStoodDevolved: 0,
            timesStoodWestminster: 0,
            timesStoodEuropean: 0,
            timesElected: 0,
            timesElectedLocal: 0,
            timesElectedDevolved: 0,
            timesElectedWestminster: 0,
            timesElectedEuropean: 0,
            constituencyEntries: []
          });
        }
        const summary = summaries.get(personId);
        const electionType = electionTypeFromEntityKey(row.key, row.title);
        const bucket = electionTypeBucket(electionType);
        summary.totalFirstPrefs += Number(row.firstPref ?? row.firstPrefs ?? row.votes ?? 0) || 0;
        summary.timesStood += 1;
        if (bucket) summary[`timesStood${bucket}`] += 1;
        if (row.elected) {
          summary.timesElected += 1;
          if (bucket) summary[`timesElected${bucket}`] += 1;
        }
        if (row.constituency) {
          summary.constituencyEntries.push({
            body: electionBodyFromEntityKey(row.key),
            date: row.date || '',
            constituency: row.constituency,
            level: electionType === 'Local' ? 'dea' : 'constituency',
            elected: Boolean(row.elected),
            mapLayerYear: row.year || String(row.date || '').slice(0, 4)
          });
        }
      }
    }
    return [...summaries.values()].sort((a, b) => (
      b.timesElected - a.timesElected
        || b.totalFirstPrefs - a.totalFirstPrefs
        || b.timesStood - a.timesStood
        || a.name.localeCompare(b.name)
    ));
  }

  mapConstituencyAreaHistoryRow(entry, bundle, result, kind) {
    const party = result.winnerParty || result.leadingParty || '';
    const votes = result.leadingVotes ?? result.winnerVotes ?? null;
    const validVotes = result.validPoll ?? result.totalVotes ?? null;
    return {
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      localGovernmentDistrict: result.localBody || result.localGovernmentDistrict || '',
      winnerParty: party,
      winnerColour: result.winnerColour || result.leadingColour || result.colour || '#b0bec5',
      winnerVotes: votes,
      winnerPct: result.leadingPct ?? result.winnerPct ?? (validVotes && votes ? Number(votes) / Number(validVotes) * 100 : null),
      validVotes,
      seats: result.seatsTotal ?? result.seatsWon ?? null,
      isByElection: /by-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`),
      areaKind: kind
    };
  }

  mapCouncilAreaHistoryRow(entry, bundle, name, results) {
    const partyTotals = new Map();
    let validVotes = 0;
    let seats = 0;
    for (const result of results) {
      validVotes += Number(result.validPoll || 0);
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
      electionDisplayName: bundle.displayTitle || entry.displayTitle || entry.title || entry.key || '',
      electionBodyForOpen: bundle.body || entry.body || '',
      body: bundle.body || entry.body || '',
      date: bundle.date || entry.date || '',
      deaCount: results.length,
      districtElectoralAreas: results.map((result) => result.constituency).filter(Boolean),
      winnerParty: leading.party || '',
      winnerColour: leading.colour || '#b0bec5',
      winnerVotes: leading.votes || null,
      winnerPct: validVotes && leading.votes ? leading.votes / validVotes * 100 : null,
      validVotes,
      seats,
      isByElection: /by-election/i.test(`${bundle.displayTitle || entry.displayTitle || ''}`),
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
    const range = document.getElementById('timelineRange');
    const prev = document.getElementById('timelinePrev');
    const next = document.getElementById('timelineNext');
    const reset = document.getElementById('timelineReset');
    const applyIndex = async (index) => {
      if (!this.timelineItems.length || !this.timelineOnSelect) return;
      const safeIndex = Math.max(0, Math.min(this.timelineItems.length - 1, Number(index) || 0));
      if (range) range.value = String(safeIndex);
      this.updateTimelineLabel(safeIndex);
      await this.timelineOnSelect(this.timelineItems[safeIndex], safeIndex);
    };
    range?.addEventListener('change', (event) => applyIndex(event.target.value).catch((error) => this.showMapError(error)));
    range?.addEventListener('input', (event) => this.updateTimelineLabel(event.target.value));
    prev?.addEventListener('click', () => applyIndex((Number(range?.value) || 0) - 1).catch((error) => this.showMapError(error)));
    next?.addEventListener('click', () => applyIndex((Number(range?.value) || 0) + 1).catch((error) => this.showMapError(error)));
    reset?.addEventListener('click', () => {
      const latest = Math.max(0, this.timelineItems.length - 1);
      applyIndex(latest).catch((error) => this.showMapError(error));
    });
  }

  setTimelineItems(items, activeIndex, onSelect) {
    const slider = document.getElementById('timelineSlider');
    const range = document.getElementById('timelineRange');
    this.timelineItems = Array.isArray(items) ? items : [];
    this.timelineOnSelect = typeof onSelect === 'function' ? onSelect : null;
    if (!slider || !range || this.timelineItems.length < 2 || !this.timelineOnSelect) {
      this.hideTimeline();
      return;
    }
    const safeIndex = Math.max(0, Math.min(this.timelineItems.length - 1, Number(activeIndex) || 0));
    range.min = '0';
    range.max = String(this.timelineItems.length - 1);
    range.value = String(safeIndex);
    slider.classList.remove('hidden');
    this.updateTimelineLabel(safeIndex);
    this.notifyTimelineLayoutChanged();
  }

  updateTimelineLabel(index) {
    const item = this.timelineItems[Math.max(0, Math.min(this.timelineItems.length - 1, Number(index) || 0))];
    const label = document.getElementById('timelineLabel');
    if (label) label.textContent = this.formatTimelineItemLabel(item);
  }

  hideTimeline() {
    this.timelineItems = [];
    this.timelineOnSelect = null;
    document.getElementById('timelineSlider')?.classList.add('hidden');
    this.notifyTimelineLayoutChanged();
  }

  notifyTimelineLayoutChanged() {
    requestAnimationFrame(() => this.mapController?.invalidateSize?.());
  }

  updateTimeline() {
    if (this.timelineApplying) return;
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
    const timestamps = (dataService.getApplicableDates?.(chains) || [])
      .filter((timestamp) => Number.isFinite(Number(timestamp)))
      .sort((a, b) => a - b);
    if (timestamps.length < 2) {
      this.hideTimeline();
      return;
    }
    const currentTimestamp = this.getCurrentTimelineTimestamp(activeIds);
    const activeIndex = timestamps.findIndex((timestamp) => timestamp === currentTimestamp);
    const items = timestamps.map((timestamp) => ({
      timestamp,
      label: this.formatTimelineTimestamp(timestamp)
    }));
    this.setTimelineItems(items, activeIndex >= 0 ? activeIndex : timestamps.length - 1, async (item) => {
      await this.applyTimelineTimestamp(item.timestamp);
    });
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

  formatTimelineItemLabel(item) {
    if (!item) return '';
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
      const date = numeric > 9999 ? new Date(numeric) : new Date(Date.UTC(numeric, 0, 1));
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
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    });
  }

  async applyTimelineTimestamp(timestamp) {
    const activeIds = this.getLoadedLayerIds()
      .filter((id) => dataService.getMapById(id))
      .filter((id) => this.isMapVisible(id));
    const equivalents = dataService.getEquivalentMapsForDate?.(activeIds, timestamp) || {};
    this.timelineApplying = true;
    try {
      for (const [oldId, newId] of Object.entries(equivalents)) {
        if (!newId || newId === oldId || !dataService.getMapById(newId)) continue;
        await this.unloadMap(oldId);
        await this.loadMap(newId);
      }
      this.syncCatalogueMapState();
      this.updateActiveLayers();
      this.updateURLState();
    } finally {
      this.timelineApplying = false;
      this.updateTimeline();
    }
  }

  async unloadMap(mapId) {
    if (this.unloadActiveElectionForLayer(mapId)) return;
    const mapConfig = dataService.getMapById(mapId);
    if (this.mapController.getLayerState(mapId)?.isGroup) {
      this.mapController.unloadLayer(mapId);
    } else if (mapConfig?.isGroup && Array.isArray(mapConfig.members)) {
      mapConfig.members.forEach((memberId) => this.mapController.unloadLayer(memberId));
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
      ...(Array.isArray(mapConfig?.members) ? mapConfig.members : []),
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

  setMapControlsOpen(open) {
    const mapControlsToggle = document.getElementById('mapControlsToggle');
    const mapControlPanel = document.getElementById('mapControlPanel');
    mapControlsToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    mapControlPanel?.classList.toggle('map-control-panel--collapsed', !open);
    mapControlPanel?.classList.toggle('map-control-panel--expanded', Boolean(open));
    this.updateURLState();
  }

  setActiveLayersPanelOpen(open) {
    const activeLayersToggle = document.getElementById('activeLayersToggle');
    const activeLayers = document.getElementById('activeLayers');
    activeLayersToggle?.setAttribute('aria-expanded', String(Boolean(open)));
    activeLayers?.classList.toggle('hidden', !open);
    this.updateURLState();
  }

  async applyBaseMap(baseMapId) {
    this.baseMapId = baseMapId || 'osm-standard';
    const map = this.mapController?.map;
    if (!map) return;
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
      await new Promise((resolve) => map.once('load', resolve));
    }
    this.mapController.setBaseMap(this.baseMapId);
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

  bindActiveLayerSourceButtons() {
    const rows = document.querySelectorAll('#activeLayersList .active-layer-item[data-map-id]');
    rows.forEach((row) => {
      if (row.querySelector('.test2-source-btn')) return;
      const mapId = row.dataset.mapId;
      const actions = row.querySelector('.active-layer-item__actions');
      if (!actions || !mapId) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'active-layer-item__btn test2-source-btn';
      button.dataset.mapId = mapId;
      button.title = 'Sources';
      button.setAttribute('aria-label', `Show sources for ${row.querySelector('.active-layer-item__name')?.textContent || mapId}`);
      button.innerHTML = '<span aria-hidden="true">i</span>';
      button.addEventListener('click', () => this.openSourcePanel(mapId));
      actions.insertBefore(button, actions.firstChild);
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
      if (map.isGroup && Array.isArray(map.members) && map.members.every((memberId) => ids.has(memberId))) {
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
    }
    const activeOrder = this.getActiveLayerOrder(loadedMaps.map((map) => map.id));
    const orderIndex = new Map(activeOrder.map((id, index) => [id, index]));
    loadedMaps.sort((a, b) => {
      const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
    uiController.updateActiveLayers(loadedMaps, visibilityMap, new Map());
    this.bindActiveLayerSourceButtons();
    if (this.currentSourceMapId) this.renderSourcePanel();
    this.updateTimeline();
  }

  isMapLoaded(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    if (mapConfig?.isGroup && Array.isArray(mapConfig.members)) {
      return mapConfig.members.some((memberId) => this.mapController.isLayerLoaded(memberId));
    }
    return this.mapController.isLayerLoaded(mapId);
  }

  isMapVisible(mapId) {
    return this.mapController.isLayerVisible(mapId);
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
    const params = new URLSearchParams();
    const center = this.mapController.map?.getCenter?.();
    const zoom = this.mapController.map?.getZoom?.();
    if (urlLoaded.length) params.set('layers', urlLoaded.join(','));
    if (layerOrder.length > 1 && layerOrder.some((id, index) => id !== urlLoaded[index])) {
      params.set('layerOrder', layerOrder.join(','));
    }
    if (hidden.length) params.set('hidden', hidden.join(','));
    if (this.searchQuery) params.set('q', this.searchQuery);
    if (this.currentDetailMapId && !document.getElementById('catalogueDetailView')?.classList.contains('hidden')) {
      params.set('detail', this.currentDetailMapId);
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
      if (electionState.selected) params.set('electionSelected', electionState.selected);
      if (electionState.countDetail) params.set('electionCountDetail', '1');
      if (electionState.entityKind && electionState.entityKey) {
        params.set('electionEntityKind', electionState.entityKind);
        params.set('electionEntityKey', electionState.entityKey);
        if (electionState.entityReturnView) params.set('electionEntityReturnView', electionState.entityReturnView);
      }
    }
    const path = `${location.pathname}${location.search || ''}`;
    const next = params.toString() ? `${path}#${params.toString()}` : path;
    history.replaceState(null, '', next);
  }

  getCurrentURLParams() {
    return new URLSearchParams(location.hash.replace(/^#/, ''));
  }

  async restoreURLState(options = {}) {
    this._restoringURLState = true;
    const shouldUpdateAfterRestore = options.updateAfterRestore !== false;
    const params = this.getCurrentURLParams();
    const query = params.get('q');
    try {
      this.searchQuery = query || '';
      const search = document.getElementById('searchInput');
      if (search) search.value = this.searchQuery;
      document.getElementById('searchClear')?.classList.toggle('visible', this.searchQuery.length > 0);
      this.updateMapList();

      const baseMap = params.get('base');
      if (baseMap) {
        const select = document.getElementById('baseMapSelect');
        if (select) select.value = baseMap;
        await this.applyBaseMap(baseMap);
      }

      const layers = (params.get('layers') || '').split(',').map((id) => id.trim()).filter(Boolean);
      if (this.hasElectionURLState(params, layers)) {
        await this.ensureElections({ refreshCatalogue: true });
      }
      const mapLayers = layers.filter((id) => !this.elections?.isCanonicalElectionLayerId?.(id));
      await Promise.all(mapLayers.map((id) => this.loadMap(id).catch((error) => this.showMapError(error))));

      await this.elections?.restoreURLState?.(params);

      const hidden = new Set((params.get('hidden') || '').split(',').map((id) => id.trim()).filter(Boolean));
      hidden.forEach((id) => this.mapController.hideLayer(id));
      this.restoreLayerOrder(params);
      this.syncCatalogueMapState();
      this.updateActiveLayers();

      const detailId = params.get('detail');
      if (detailId && dataService.getMapById(detailId)) {
        uiController.showCatalogueDetailView(detailId, false);
        this.currentDetailMapId = detailId;
      } else if (!detailId && this.currentDetailMapId) {
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
    }
  }

  triggerDownload(url, filename) {
    const link = document.createElement('a');
    link.href = url;
    if (filename) link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  showMapError(error) {
    console.warn('[Test2]', error);
    const announcer = document.getElementById('announcer');
    const message = error?.message || 'Map layer is not available in /test2 yet.';
    if (announcer) announcer.textContent = message;
    let status = document.getElementById('test2Status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'test2Status';
      status.className = 'map-error';
      document.querySelector('.pane--map')?.appendChild(status);
    }
    status.textContent = message;
  }
}

const app = new Test2App();
app.init().catch((error) => {
  console.error('[Test2] Failed to start', error);
  const target = document.getElementById('map') || document.body;
  target.insertAdjacentHTML('beforeend', `<div class="map-error">Failed to start /test2: ${escapeHtml(error.message)}</div>`);
});

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
  return bodyKey ? bodyKey.replace(/-/g, ' ') : 'Election';
}

function electionTypeBucket(electionType) {
  if (/Local/i.test(electionType)) return 'Local';
  if (/Assembly|Forum|Convention|Parliament of NI/i.test(electionType)) return 'Devolved';
  if (/Westminster/i.test(electionType)) return 'Westminster';
  if (/European/i.test(electionType)) return 'European';
  return '';
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
