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
    this._restoringURLState = false;
    this.currentDetailMapId = null;
    this.currentSourceMapId = null;
    this.baseMapId = 'osm-standard';
  }

  async init() {
    this.installRouteGuard();

    await dataService.init();
    await this.loadBooks();

    this.metadataService = new TestMetadataService();
    await this.metadataService.load();

    this.mapController = new Test2MapLibreMainAdapter('map', this.metadataService, {
      onFeatureClick: (features) => uiController.showFeatureInfo(features, dataService.getAllMaps()),
      getMainMap: (mapId) => dataService.getMapById(mapId),
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
    this.setupSourcePanel();
    this.setupURLStateListener();
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
    const directLayer = this.mapController.resolveLayer(mapConfig?.id || mapId);
    if (!directLayer?.loadable) {
      const childIds = this.getConvertedCompositeChildIds(mapConfig);
      if (childIds.length) {
        for (const childId of childIds) await this.mapController.loadLayer(childId, { fit: false });
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
      this.updateURLState();
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

  renderSourcePanel() {
    const content = document.getElementById('test2SourcePanelContent');
    if (!content) return;
    const records = this.getSourceRecords(this.currentSourceMapId);
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

  getSourceRecords(mapId) {
    if (!mapId) return [];
    const groupState = this.mapController.getLayerState(mapId);
    const childIds = groupState?.isGroup
      ? groupState.childIds || []
      : this.getConvertedCompositeChildIds(dataService.getMapById(mapId));
    const ids = childIds.length ? childIds : [mapId];
    return ids
      .map((id) => {
        const layer = this.mapController.resolveLayer(id);
        const mainConfig = dataService.getMapById(id) || dataService.getMapById(layer?.sourceMapId) || null;
        if (!layer && !mainConfig) return null;
        return { id, layer, mainConfig };
      })
      .filter(Boolean);
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
    const ids = new Set([...this.mapController.layerStates.entries()]
      .filter(([, state]) => state.loaded)
      .map(([id]) => id));
    for (const [id, state] of this.mapController.groupStates.entries()) {
      if (state.loaded) ids.add(id);
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
    for (const [id, state] of this.mapController.layerStates) {
      const config = dataService.getMapById(id) || state.config;
      if (config) loadedMaps.push(config);
      visibilityMap.set(id, state.visible);
    }
    uiController.updateActiveLayers(loadedMaps, visibilityMap, new Map());
    this.bindActiveLayerSourceButtons();
    if (this.currentSourceMapId) this.renderSourcePanel();
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
    const hidden = loaded.filter((id) => !this.isMapVisible(id));
    const params = new URLSearchParams();
    const center = this.mapController.map?.getCenter?.();
    const zoom = this.mapController.map?.getZoom?.();
    if (loaded.length) params.set('layers', loaded.join(','));
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
    if (Number.isFinite(zoom)) params.set('z', zoom.toFixed(2));
    if (this.baseMapId && this.baseMapId !== 'osm-standard') params.set('base', this.baseMapId);
    if (document.getElementById('activeLayersToggle')?.getAttribute('aria-expanded') === 'true') params.set('activePanel', '1');
    if (document.getElementById('mapControlsToggle')?.getAttribute('aria-expanded') === 'true') params.set('controls', '1');
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
      await Promise.all(layers.map((id) => this.loadMap(id).catch((error) => this.showMapError(error))));

      const hidden = new Set((params.get('hidden') || '').split(',').map((id) => id.trim()).filter(Boolean));
      hidden.forEach((id) => this.mapController.hideLayer(id));
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
        this.renderSourcePanel();
      } else {
        this.currentSourceMapId = null;
        document.getElementById('test2SourcePanel')?.classList.add('hidden');
      }

      const hasViewport = params.has('lng') && params.has('lat');
      const lng = hasViewport ? Number(params.get('lng')) : NaN;
      const lat = hasViewport ? Number(params.get('lat')) : NaN;
      const z = Number(params.get('z') || params.get('zoom'));
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
