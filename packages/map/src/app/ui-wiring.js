/**
 * The callbacks that connect the catalogue pane (src/ui-controller.js) to the map, and the bridge that
 * records catalogue navigation in the address.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import uiController from '../../../../src/ui-controller.js';
import { normalizeEntityName } from './helpers.mjs';
import dataService, { resolveMapDownloadUrl } from '../../../../src/data-service.js';

export class UiWiringMethods {
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
        this.navigationPush.clear();
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
      // A result with no box (the names index omits them) is still framed: the app looks the
      // feature up in the spatial and feature indexes (QA 2026-11-11, H2).
      const result = await this.mapController.loadSingleFeature(mapConfig, featureId, featureName, bbox, {
        isolate: options.isolate !== false,
        resolveBounds: (layerConfig) => this.resolveFeatureBounds(mapConfig, featureId, featureName, layerConfig)
      });
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
}
