/**
 * Layer management: loading and unloading maps (composites and variants included), the draw order
 * (saved in localStorage; parsing in layer-order.mjs), the loaded-layer list and the Active layers panel.
 *
 * Methods of the map app (Test2App, packages/map/app/app.js), installed on its prototype by installMethods: `this` is the app.
 */

import {
  LAYER_ORDER_STORAGE_KEY,
  layerOrderToRestore,
  normalizeLoadedLayerOrder as normalizeLayerOrderToLoaded,
  parseLayerOrder,
  rowOrderToLoadedIds,
  serializeSavedLayerOrder
} from './layer-order.mjs';
import uiController from '../ui-controller.js';
import dataService from '../data-service.js';
import { compositeChildIds } from '../map-relations.mjs';

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

export class LayerMethods {
  // Layer order parsing and normalising live in packages/map/src/app/layer-order.mjs (seam A1); the
  // storage access is here.
  readSavedLayerOrder() {
    try {
      return parseLayerOrder(localStorage.getItem(LAYER_ORDER_STORAGE_KEY));
    } catch {
      return [];
    }
  }

  writeSavedLayerOrder(order) {
    const value = serializeSavedLayerOrder(order);
    try {
      if (value !== null) localStorage.setItem(LAYER_ORDER_STORAGE_KEY, value);
      else localStorage.removeItem(LAYER_ORDER_STORAGE_KEY);
    } catch {
      // Storage can fail in private browsing or locked-down browser profiles.
    }
  }

  normalizeLoadedLayerOrder(order, loadedIds = this.getLoadedLayerIds()) {
    return normalizeLayerOrderToLoaded(order, loadedIds);
  }

  getActiveLayerOrder(loadedIds = this.getLoadedLayerIds()) {
    const drawOrder = this.mapController?.getLayerDrawOrder?.({ loadedOnly: true }) || [];
    return this.normalizeLoadedLayerOrder(drawOrder, loadedIds);
  }

  /** The catalogue id a loaded layer's Active layers row carries (see rowOrderToLoadedIds). */
  activeLayerRowId(loadedId) {
    return dataService.getMapById(loadedId)?.id || loadedId;
  }

  setActiveLayerOrder(order, options = {}) {
    const { persist = true, notify = false } = options || {};
    // The panel's rows carry catalogue ids; the order is kept in loaded ids.
    const loadedIds = this.getLoadedLayerIds();
    const normalized = this.normalizeLoadedLayerOrder(
      rowOrderToLoadedIds(order, loadedIds, (id) => this.activeLayerRowId(id)),
      loadedIds
    );
    if (normalized.length < 2) return normalized;
    this.mapController?.setLayerDrawOrder?.(normalized, { notify });
    if (persist) this.writeSavedLayerOrder(normalized);
    this.syncCatalogueMapState();
    this.updateActiveLayers();
    this.updateURLState();
    return normalized;
  }

  restoreLayerOrder(params) {
    const normalized = layerOrderToRestore(params, () => this.readSavedLayerOrder(), () => this.getLoadedLayerIds());
    if (normalized.length < 2) return;
    this.mapController?.setLayerDrawOrder?.(normalized);
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

  async loadMap(mapId, options = {}) {
    // A map drawn: its features may carry election results, so the election catalogue is
    // fetched now if it has not been (warmElectionCatalogueWhenWanted).
    this.scheduleElectionCatalogueWarm();
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

  getMapUnloadCandidateIds(mapId) {
    const mapConfig = dataService.getMapById(mapId);
    return new Set([
      mapId,
      ...compositeChildIds(mapConfig),
      ...(Array.isArray(mapConfig?.variants) ? mapConfig.variants.map((variant) => variant?.id).filter(Boolean) : [])
    ].filter(Boolean));
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
    // Each row's loaded id: its config's id is the catalogue's, which for a layer loaded under
    // another id (lgd-2012-vector, shown as lgd-2012) is not in the draw order.
    const loadedIdOf = new Map();
    const visibilityMap = new Map();
    const partialLayerInfo = new Map();
    const groupedChildIds = new Set();
    for (const [id, state] of this.mapController.groupStates) {
      if (!state.loaded) continue;
      const config = dataService.getMapById(id) || state.config;
      if (config) { loadedMaps.push(config); loadedIdOf.set(config, id); }
      visibilityMap.set(id, state.visible);
      for (const childId of state.childIds || []) groupedChildIds.add(childId);
    }
    for (const [id, state] of this.mapController.layerStates) {
      if (groupedChildIds.has(id)) continue;
      const config = dataService.getMapById(id) || state.config;
      if (config) { loadedMaps.push(config); loadedIdOf.set(config, id); }
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
    const rowKey = (map) => loadedIdOf.get(map) || map.id;
    const activeOrder = this.getActiveLayerOrder(loadedMaps.map(rowKey));
    const orderIndex = new Map(activeOrder.map((id, index) => [id, index]));
    loadedMaps.sort((a, b) => {
      const ai = orderIndex.has(rowKey(a)) ? orderIndex.get(rowKey(a)) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(rowKey(b)) ? orderIndex.get(rowKey(b)) : Number.MAX_SAFE_INTEGER;
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
}
