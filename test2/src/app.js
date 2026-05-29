import 'maplibre-gl/dist/maplibre-gl.css';
import './test2.css';
import dataService from '../../js/data-service.js';
import featureLoader from '../../js/feature-loader.js';
import uiController from '../../js/ui-controller.js';
import { TestMetadataService } from '../../test/src/metadata-service.js';
import { Test2MapLibreMainAdapter } from './maplibre-main-adapter.js';

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
  }

  async init() {
    this.installRouteGuard();

    await dataService.init();
    await this.loadBooks();

    this.metadataService = new TestMetadataService();
    await this.metadataService.load();

    this.mapController = new Test2MapLibreMainAdapter('map', this.metadataService, {
      onFeatureClick: (features) => uiController.showFeatureInfo(features, dataService.getAllMaps()),
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
    uiController.init();
    uiController.showAllMaps = true;

    this._suspendURLState = true;
    this.mapController.init('map');
    window.__civgraphTest2 = {
      app: this,
      mapController: this.mapController,
      metadataService: this.metadataService,
      restorePromise: null
    };
    this.renderCategoryPills();
    this.updateMapList();
    this.setupSearch();
    this.setupThemeToggle();
    this.setupSupportModal();
    this.setupMapControls();
    window.__civgraphTest2.restorePromise = this.restoreURLState()
      .catch((error) => this.showMapError(error))
      .finally(() => {
        this._suspendURLState = false;
        this.updateURLState();
      });
    await window.__civgraphTest2.restorePromise;
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

  wireUiCallbacks() {
    uiController.onBuildElectionCatalogueCards = async () => [];
    uiController.onLoadElection = async () => this.showMapError(new Error('Election map workflows are not converted for /test2 yet.'));
    uiController.onUnloadElection = () => {};
    uiController.onCheckElectionLoaded = () => false;
    uiController.onSetupElectionTableControls = () => {};

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
      const mapConfig = dataService.getMapById(mapId);
      if (mapConfig?.isGroup && Array.isArray(mapConfig.members)) {
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

    uiController.onHideMap = (mapId) => this.mapController.hideLayer(mapId);
    uiController.onCheckMapLoaded = (mapId) => this.isMapLoaded(mapId);
    uiController.onCheckMapVisible = (mapId) => this.isMapVisible(mapId);
    uiController.onReorderLayers = (ids) => this.mapController.setLayerDrawOrder(ids);
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
    };
    uiController.onProviderCategoryChange = (providerId, providers) => {
      this.currentProviderCategory = providerId;
      this.currentProviderList = providers || [];
      this.updateMapList();
    };
    uiController.onAuthorFilter = (authors) => {
      this.currentAuthor = !authors || authors.length === 0 ? 'all' : authors;
      this.updateMapList();
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

  async loadMap(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    if (mapConfig?.isGroup && Array.isArray(mapConfig.members) && mapConfig.members.length) {
      for (const memberId of mapConfig.members) await this.loadMap(memberId);
      this.mapController.markGroupLoaded(mapId, mapConfig, mapConfig.members);
      return;
    }
    if (mapConfig?.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      const variantId = mapConfig.variants[0].id;
      await this.mapController.loadLayer(variantId);
      this.mapController.markGroupLoaded(mapId, mapConfig, [variantId]);
      return;
    }
    await this.mapController.loadLayer(mapConfig || mapId);
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
      maps = dataService.searchMaps(this.searchQuery);
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

  setupSearch() {
    uiController.onSearch = (query) => {
      this.searchQuery = query;
      this.updateMapList();
    };
    uiController.setupSearch();
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.overflow-menu')) {
        document.querySelectorAll('.overflow-menu--open').forEach((menu) => menu.classList.remove('overflow-menu--open'));
      }
    });
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

    const setControlsOpen = (open) => {
      mapControlsToggle?.setAttribute('aria-expanded', String(open));
      mapControlPanel?.classList.toggle('map-control-panel--collapsed', !open);
      mapControlPanel?.classList.toggle('map-control-panel--expanded', open);
      this.updateURLState();
    };

    mapControlsToggle?.addEventListener('click', () => {
      setControlsOpen(mapControlsToggle.getAttribute('aria-expanded') !== 'true');
    });
    mapControlsClose?.addEventListener('click', () => setControlsOpen(false));

    const overlayToggle = document.getElementById('overlayToggle');
    const overlayList = document.getElementById('overlayList');
    overlayToggle?.addEventListener('click', () => {
      const open = overlayToggle.getAttribute('aria-expanded') !== 'true';
      overlayToggle.setAttribute('aria-expanded', String(open));
      overlayList?.classList.toggle('overlay-list--collapsed', !open);
      overlayList?.classList.toggle('overlay-list--expanded', open);
    });

    document.getElementById('baseMapSelect')?.addEventListener('change', (event) => {
      this.mapController.setBaseMap(event.target.value);
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
      const open = activeLayersToggle.getAttribute('aria-expanded') !== 'true';
      activeLayersToggle.setAttribute('aria-expanded', String(open));
      activeLayers?.classList.toggle('hidden', !open);
      this.updateURLState();
    });
    activeLayersClose?.addEventListener('click', () => {
      activeLayers?.classList.add('hidden');
      activeLayersToggle?.setAttribute('aria-expanded', 'false');
      this.updateURLState();
    });
    featureInfoClose?.addEventListener('click', () => uiController.hideFeatureInfo());

    document.getElementById('conditionalStylingBtn')?.addEventListener('click', () => {
      this.showMapError(new Error('Conditional styling controls for /test2 will use MapLibre expressions; this route currently supports base opacity, labels, and text scale.'));
    });

    this.mapController.map?.on('moveend', () => this.updateURLState());
  }

  getLoadedLayerIds() {
    const ids = [...this.mapController.layerStates.entries()]
      .filter(([, state]) => state.loaded)
      .map(([id]) => id);
    for (const map of dataService.getAllMaps()) {
      if (map.isGroup && Array.isArray(map.members) && map.members.every((memberId) => ids.includes(memberId))) {
        ids.push(map.id);
      }
    }
    return ids;
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
    for (const [id, state] of this.mapController.layerStates) {
      const config = dataService.getMapById(id) || state.config;
      if (config) loadedMaps.push(config);
      visibilityMap.set(id, state.visible);
    }
    uiController.updateActiveLayers(loadedMaps, visibilityMap, new Map());
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
    if (this._suspendURLState) return;
    const loaded = this.getLoadedLayerIds();
    const params = new URLSearchParams();
    const center = this.mapController.map?.getCenter?.();
    const zoom = this.mapController.map?.getZoom?.();
    if (loaded.length) params.set('layers', loaded.join(','));
    if (this.searchQuery) params.set('q', this.searchQuery);
    if (center) {
      params.set('lng', center.lng.toFixed(5));
      params.set('lat', center.lat.toFixed(5));
    }
    if (Number.isFinite(zoom)) params.set('z', zoom.toFixed(2));
    if (document.getElementById('activeLayersToggle')?.getAttribute('aria-expanded') === 'true') params.set('activePanel', '1');
    if (document.getElementById('mapControlsToggle')?.getAttribute('aria-expanded') === 'true') params.set('controls', '1');
    const path = `${location.pathname}${location.search || ''}`;
    const next = params.toString() ? `${path}#${params.toString()}` : path;
    history.replaceState(null, '', next);
  }

  async restoreURLState() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = params.get('q');
    if (query) {
      this.searchQuery = query;
      const search = document.getElementById('searchInput');
      if (search) search.value = query;
      this.updateMapList();
    }
    const layers = (params.get('layers') || '').split(',').map((id) => id.trim()).filter(Boolean);
    await Promise.all(layers.map((id) => this.loadMap(id).catch((error) => this.showMapError(error))));
    const lng = Number(params.get('lng'));
    const lat = Number(params.get('lat'));
    const z = Number(params.get('z'));
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      this.mapController.map?.jumpTo({ center: [lng, lat], zoom: Number.isFinite(z) ? z : undefined });
    }
    if (params.get('activePanel') === '1') document.getElementById('activeLayersToggle')?.click();
    if (params.get('controls') === '1') document.getElementById('mapControlsToggle')?.click();
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
