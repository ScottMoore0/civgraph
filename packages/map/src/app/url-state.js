/**
 * The address: writing the app state to the URL (updateURLState), restoring it (restoreURLState,
 * restorePage), Back/Forward history entries, the document title and the hash route guard.
 * Old share links are translated by url-compat.mjs.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../../../../src/ui-controller.js';
import dataService from '../../../../src/data-service.js';
import { renameElectionDatesInParams, resolveLegacyLayerId } from './url-compat.mjs';
import { pageParamOf, parsePageParam } from './helpers.mjs';
import featureLoader from '../../../../src/feature-loader.js';
import { featureBoundsFromIndex, featureBoundsFromSpatial } from './feature-bounds.mjs';

/** A promise, or null after `ms`: an index that is slow to come must not hold the map. */
const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export class UrlStateMethods {
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

  /**
   * Where a feature is, for a link or a search result that carries no box: its bbox in the map's
   * spatial index (/_api/spatial), else a box from its centre and area in the layer's feature
   * index (featureIndexUrl). Null when neither knows it; the map then shows the layer.
   * packages/map/src/app/feature-bounds.mjs holds the matching rules.
   */
  async resolveFeatureBounds(mapConfig, featureId, featureName, layerConfig = null) {
    const mapId = mapConfig?.id;
    if (!mapId) return null;
    try {
      const entries = await within(featureLoader.loadMapIndex(mapId), 4000);
      const box = featureBoundsFromSpatial(entries, mapId, featureId, featureName);
      if (box) return box;
    } catch { /* fall through to the feature index */ }
    const url = layerConfig?.featureIndexUrl || mapConfig.featureIndexUrl;
    if (!url) return null;
    this.featureIndexRequests ||= new Map();
    if (!this.featureIndexRequests.has(url)) {
      this.featureIndexRequests.set(url, fetch(url, { cache: 'default' })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null));
    }
    const index = await within(this.featureIndexRequests.get(url), 4000);
    return featureBoundsFromIndex(index, featureId, featureName);
  }

  setupURLStateListener() {
    // Back and Forward between the entries pushState makes fire hashchange (their addresses
    // differ only in the hash), as does editing the hash by hand; both mean "show this".
    window.addEventListener('hashchange', () => {
      if (this.urlSuspend.on || this.hashListen.ignoring) return;
      // Back then Forward quickly: the second arrives while the first is still restoring. Do it
      // once that one is done, rather than drop it and leave the page on the wrong entry.
      if (this.urlRestore.active) {
        this.urlRestore.queue();
        return;
      }
      this.restoreURLState({ updateAfterRestore: false, sync: true }).catch((error) => this.showMapError(error));
    });
  }

  /**
   * Back and Forward: make the map match the entry's address. restoreURLState only ADDS what
   * an address names, which is right for a shared link on a fresh page but not for a step
   * back, where what the earlier entry did not have must come off: the layer just added, the
   * election just opened.
   */
  removeStateNotIn(params) {
    const wanted = new Set([...(params.get('layers') || '').split(','), params.get('featureMap') || '']
      .map((id) => resolveLegacyLayerId(id.trim(), this.isKnownLayerId)).filter(Boolean));
    const active = this.elections?.activeEntry;
    if (active) {
      const sameElection = (params.get('electionBody') === active.body && params.get('electionDate') === active.date)
        || wanted.has(this.elections.getCanonicalLayerId?.(active));
      if (!sameElection) this.elections.unloadElection();
    } else if (this.elections?.loadRun?.state() === 'loading') {
      // An election still loading that this entry does not have: cancel it, or it would open
      // after the step back (MA-03).
      const pending = this.elections.pendingLoad;
      if (!(pending && params.get('electionBody') === pending.body && params.get('electionDate') === pending.date)) {
        this.elections.cancelPendingLoad();
      }
    }
    const backing = new Set(this.elections?.activeEntry ? this.elections.getActiveElectionBackingLayerIds?.() || [] : []);
    for (const id of this.getLoadedLayerIds()) {
      if (!wanted.has(id) && !backing.has(id) && this.isMapLoaded(id)) this.unloadMapNow(id);
    }
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
    if (this.urlRestore.active) return;
    this.navigationPush.begin(label || 'Map');
  }

  endNavigation() {
    this.updateURLState();
    this.navigationPush.clear();
  }

  pushURLState(label) {
    this.beginNavigation(label);
    this.endNavigation();
  }

  /** A step that failed leaves no history entry behind: if one was pushed since `mark`, step
   * back over it, without restoring anything (the map is already as it was). */
  undoNavigationSince(mark) {
    if (!Number.isInteger(mark) || this.navIndex <= mark) return;
    this.hashListen.hold();
    history.go(mark - this.navIndex);
    // Forget the abandoned entry, so the History list does not offer it.
    this.navEntries = this.navEntries.slice(0, mark + 1);
    setTimeout(() => this.hashListen.release(), 500);
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
    if (this.urlSuspend.on || this.urlRestore.active) return;
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
    if (electionState?.niLocal) {
      // A year of pre-1973 Northern Ireland local elections: its level, votes or seats, members
      // and the area open in the pane (packages/map/app/ni-local-view.js).
      params.set('electionBody', electionState.body);
      params.set('electionDate', electionState.date);
      params.set('electionLevel', electionState.niLocal.level);
      params.set('electionShow', electionState.niLocal.show);
      if (electionState.niLocal.members === 'aldermen') params.set('electionMembers', 'aldermen');
      if (electionState.niLocal.area) params.set('electionArea', electionState.niLocal.area);
    } else if (electionState) {
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
    if (this.navigationPush.pending && next !== `${location.pathname}${location.search || ''}${location.hash}`) {
      this._pendingNavLabel = this.navigationPush.take();
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
      } else if (this.getPrimaryPartialFeatureURLState()?.featureName) {
        // A feature opened on its own (a feature link, a search result): "BELFAST WEST –
        // Parliamentary Constituencies 2023", not only the layer's name (QA 2026-11-11, H2).
        const feature = /** @type {{ mapId: string, featureName: string }} */ (this.getPrimaryPartialFeatureURLState());
        const layerName = this.metadataService?.getLayer?.(feature.mapId)?.name || dataService.getMapById?.(feature.mapId)?.name || '';
        subject = layerName ? `${feature.featureName} – ${layerName}` : feature.featureName;
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
    this.urlRestore.begin();
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
        .map((id) => resolveLegacyLayerId(id.trim(), this.isKnownLayerId)).filter(Boolean);
      const featureMapId = resolveLegacyLayerId(params.get('featureMap') || '', this.isKnownLayerId);
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

      // A feature link frames its feature, unless the address names a view of its own
      // (QA 2026-11-11, H2: a shared constituency opened on the whole island, nothing drawn).
      const hasViewport = params.has('lng') && params.has('lat');
      if (featureMapId && featureIdParam) {
        const mapConfig = dataService.getMapById(featureMapId);
        if (mapConfig) {
          await this.mapController.loadSingleFeature(mapConfig, featureIdParam, featureNameParam || featureIdParam, null, {
            isolate: true,
            smooth: false,
            resolveBounds: hasViewport ? null : (layerConfig) => this.resolveFeatureBounds(mapConfig, featureIdParam, featureNameParam, layerConfig)
          });
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
      // A hashchange that came in while restoring is replayed once this restore is done.
      const replay = this.urlRestore.end();
      if (shouldUpdateAfterRestore) this.updateURLState();
      if (replay) {
        setTimeout(() => this.restoreURLState({ updateAfterRestore: false, sync: true }).catch((error) => this.showMapError(error)), 0);
      }
    }
  }
}
