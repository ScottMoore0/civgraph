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

/**
 * How the last load of each map ended (recordSettleOutcome), made on first use; ui-wiring.js reads it.
 * @typedef {{ settleOutcomes?: Map<string, import('../../app/settle.js').SettleOutcome> | undefined }} SettleOutcomeState
 */
/** The app as these methods see it: they run once init has made the map controller. @typedef {import('./map-app').MapAppReady & LayerMethods & SettleOutcomeState} LayerApp */
/**
 * A catalogue map (data-service.js getMapById) as loading reads it: a group's variants (each a map
 * with its id), a composite's members and sources, its box.
 * @typedef {{ id: string, name?: string, isGroup?: boolean, bounds?: number[][], variants?: Array<{ id: string }>, compositeSources?: string[], members?: string[], classId?: string, slug?: string, [key: string]: unknown }} LayerMapConfig
 */
/** @typedef {import('../ui-controller-types.d.ts').MapRecord} MapRecord */
/** @typedef {import('./map-app').LayerOrGroupState} LayerOrGroupState */

export class LayerMethods {
  // Layer order parsing and normalising live in packages/map/src/app/layer-order.mjs (seam A1); the
  // storage access is here.
  /** @this {LayerApp} */
  readSavedLayerOrder() {
    try {
      return parseLayerOrder(localStorage.getItem(LAYER_ORDER_STORAGE_KEY));
    } catch {
      return [];
    }
  }

  /** @this {LayerApp} @param {unknown} order */
  writeSavedLayerOrder(order) {
    const value = serializeSavedLayerOrder(order);
    try {
      if (value !== null) localStorage.setItem(LAYER_ORDER_STORAGE_KEY, value);
      else localStorage.removeItem(LAYER_ORDER_STORAGE_KEY);
    } catch {
      // Storage can fail in private browsing or locked-down browser profiles.
    }
  }

  /**
   * (`this` in a parameter's default is typed as the class, not as the tag below says: it is the app, said so.)
   * @this {LayerApp} @param {unknown} order @param {string[]} [loadedIds]
   */
  normalizeLoadedLayerOrder(order, loadedIds = /** @type {LayerApp} */ (/** @type {unknown} */ (this)).getLoadedLayerIds()) {
    return normalizeLayerOrderToLoaded(order, loadedIds);
  }

  /** @this {LayerApp} @param {string[]} [loadedIds] */
  getActiveLayerOrder(loadedIds = /** @type {LayerApp} */ (/** @type {unknown} */ (this)).getLoadedLayerIds()) {
    const drawOrder = this.mapController?.getLayerDrawOrder?.({ loadedOnly: true }) || [];
    return this.normalizeLoadedLayerOrder(drawOrder, loadedIds);
  }

  /** The catalogue id a loaded layer's Active layers row carries (see rowOrderToLoadedIds). @this {LayerApp} @param {string} loadedId */
  activeLayerRowId(loadedId) {
    return dataService.getMapById(loadedId)?.id || loadedId;
  }

  /** @this {LayerApp} @param {unknown} order @param {{ persist?: boolean, notify?: boolean } | null} [options] */
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

  /** @this {LayerApp} @param {URLSearchParams} params */
  restoreLayerOrder(params) {
    const normalized = layerOrderToRestore(params, () => this.readSavedLayerOrder(), () => this.getLoadedLayerIds());
    if (normalized.length < 2) return;
    this.mapController?.setLayerDrawOrder?.(normalized);
  }

  /**
   * Wait for a newly added layer to draw, or to fail outright. waitUntilSettled() alone
   * waited out its full twenty seconds when the source itself could not load (a PMTiles
   * archive offline), with a spinner on the button and nothing to say why.
   * @this {LayerApp}
   * @param {string} mapId
   */
  waitForMapOutcome(mapId) {
    const settle = this.mapController.waitUntilSettled();
    /** @type {ReturnType<typeof setInterval> | 0} */
    let timer = 0;
    /** @type {Promise<'failed'>} */
    const failed = new Promise((resolve) => {
      timer = setInterval(() => {
        if (this.mapController.getLayerLoadFailure?.(mapId)?.kind === 'source') resolve('failed');
      }, 250);
    });
    return Promise.race([settle, failed]).finally(() => clearInterval(timer));
  }

  /** Tell the reader a layer did not load, with a Retry that tries the same layer again. @this {LayerApp} @param {string} mapId @param {unknown} error */
  reportMapLoadFailure(mapId, error) {
    this.showMapError(error, {
      retry: async () => {
        await uiController.onMapLoad(mapId);
        this.syncCatalogueMapState();
      },
    });
  }

  /**
   * @this {LayerApp} @param {string} mapId
   * @param {{ fit?: boolean, paletteKey?: string }} [options]  paletteKey: the map whose load-order
   *   colour this one shares (a composite's own id, for its members: layer-palette.mjs)
   */
  async loadMap(mapId, options = {}) {
    // A map drawn: its features may carry election results, so the election catalogue is
    // fetched now if it has not been (warmElectionCatalogueWhenWanted).
    this.scheduleElectionCatalogueWarm();
    const mapConfig = /** @type {LayerMapConfig | undefined} */ (dataService.getMapById(mapId));
    if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      const childIds = compositeChildIds(mapConfig);
      await Promise.all(childIds.map((memberId) => this.loadMap(memberId, { fit: options.fit !== false, paletteKey: options.paletteKey || mapId })));
      this.mapController.markGroupLoaded(mapId, mapConfig, childIds);
      return;
    }
    if (mapConfig?.isGroup && Array.isArray(mapConfig.variants) && mapConfig.variants.length) {
      const variantIds = mapConfig.variants
        .map((variant) => variant?.id)
        .filter((variantId) => this.mapController.resolveLayer(variantId)?.loadable);
      await Promise.all(variantIds.map((variantId) => this.mapController.loadLayer(variantId, { fit: false, paletteKey: options.paletteKey || mapId })));
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
        const groupConfig = mapConfig || /** @type {LayerMapConfig | undefined} */ (dataService.getMapById('civil-parishes-by-province')) || {
          id: mapId,
          name: 'Civil Parishes of Ireland'
        };
        await Promise.all(civilParishChildIds.map((childId) => this.mapController.loadLayer(childId, { fit: false, paletteKey: options.paletteKey || groupConfig.id || mapId })));
        this.mapController.markGroupLoaded(groupConfig.id || mapId, groupConfig, civilParishChildIds);
        if (options.fit !== false) {
          if (groupConfig.bounds) this.mapController.fitToBounds(groupConfig.bounds, { smooth: false });
          else this.mapController.fitToLayers(civilParishChildIds);
        }
        return;
      }
      const childIds = this.getConvertedCompositeChildIds(mapConfig);
      if (childIds.length) {
        await Promise.all(childIds.map((childId) => this.mapController.loadLayer(childId, { fit: false, paletteKey: options.paletteKey || mapId })));
        // Composite children were found, so there is a config (getConvertedCompositeChildIds).
        this.mapController.markGroupLoaded(/** @type {LayerMapConfig} */ (mapConfig).id, mapConfig, childIds);
        if (options.fit !== false && /** @type {LayerMapConfig} */ (mapConfig).bounds) this.mapController.fitToBounds(/** @type {LayerMapConfig} */ (mapConfig).bounds, { smooth: false });
        return;
      }
    }
    await this.mapController.loadLayer(mapConfig || mapId, { fit: options.fit !== false, ...(options.paletteKey ? { paletteKey: options.paletteKey } : {}) });
  }

  /** Take a map off, with its members if it is a group or composite. @this {LayerApp} @param {string} mapId */
  unloadMapNow(mapId) {
    const mapConfig = /** @type {LayerMapConfig | undefined} */ (dataService.getMapById(mapId));
    if (/** @type {LayerOrGroupState | null | undefined} */ (this.mapController.getLayerState(mapId))?.isGroup) {
      this.mapController.unloadLayer(mapId);
    } else if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      compositeChildIds(mapConfig).forEach((memberId) => this.mapController.unloadLayer(memberId));
    } else if (mapConfig?.isGroup && Array.isArray(mapConfig.variants)) {
      mapConfig.variants.forEach((variant) => this.mapController.unloadLayer(variant.id));
    } else {
      this.mapController.unloadLayer(mapId);
    }
  }

  /** @this {LayerApp} @param {string} mapId @param {LayerMapConfig | null | undefined} mapConfig */
  getCivilParishesCompositeChildIds(mapId, mapConfig) {
    const requestedIds = /** @type {Set<string>} */ (new Set([
      mapId,
      mapConfig?.id,
      mapConfig?.classId,
      mapConfig?.slug
    ].filter(Boolean)));
    const shouldUseComposite = [...requestedIds].some((id) => CIVIL_PARISHES_COMPOSITE_PARENT_IDS.has(id));
    if (!shouldUseComposite) return [];
    return CIVIL_PARISHES_COMPOSITE_CHILD_IDS
      .filter((childId) => this.mapController.resolveLayer(childId)?.loadable);
  }

  /** @this {LayerApp} @param {LayerMapConfig | null | undefined} mapConfig */
  getConvertedCompositeChildIds(mapConfig) {
    if (!mapConfig) return [];
    const explicitSources = Array.isArray(mapConfig.compositeSources) ? mapConfig.compositeSources : [];
    const variantSources = !mapConfig.isGroup && Array.isArray(mapConfig.variants)
      ? mapConfig.variants.map((variant) => variant.id)
      : [];
    const candidates = [...new Set([...explicitSources, ...variantSources].filter(Boolean))];
    return candidates.filter((id) => this.mapController.resolveLayer(id)?.loadable);
  }

  /** @this {LayerApp} @param {string} mapId @param {{ preserveTimelineAnimation?: boolean }} [options] */
  async unloadMap(mapId, options = {}) {
    if (!options.preserveTimelineAnimation && this.isTimelineAnimationLayer(mapId)) {
      await this.stopTimelineAnimation({ restoreOriginal: false });
    }
    if (this.unloadActiveElectionForLayer(mapId)) return;
    const mapConfig = /** @type {LayerMapConfig | undefined} */ (dataService.getMapById(mapId));
    if (/** @type {LayerOrGroupState | null | undefined} */ (this.mapController.getLayerState(mapId))?.isGroup) {
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

  /** @this {LayerApp} @param {string} mapId */
  getMapUnloadCandidateIds(mapId) {
    const mapConfig = /** @type {LayerMapConfig | undefined} */ (dataService.getMapById(mapId));
    return new Set([
      mapId,
      ...compositeChildIds(mapConfig),
      ...(Array.isArray(mapConfig?.variants) ? mapConfig.variants.map((variant) => variant?.id).filter(Boolean) : [])
    ].filter(Boolean));
  }

  /** @this {LayerApp} */
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

  /** @this {LayerApp} */
  syncCatalogueMapState() {
    uiController.syncMapCatalogueState?.({
      visibleIds: this.mapController.getVisibleLayers(),
      loadedIds: this.getLoadedLayerIds()
    });
  }

  /** @this {LayerApp} */
  updateActiveLayers() {
    // The maps listed, each the catalogue's record or the one the adapter made from the layer
    // (toMainConfig): the Active layers list reads either as a catalogue map.
    /** @type {MapRecord[]} */
    const loadedMaps = [];
    // Each row's loaded id: its config's id is the catalogue's, which for a layer loaded under
    // another id (lgd-2012-vector, shown as lgd-2012) is not in the draw order.
    /** @type {Map<MapRecord, string>} */
    const loadedIdOf = new Map();
    /** @type {Map<string, boolean>} */
    const visibilityMap = new Map();
    /** @type {Map<string, { isPartial?: boolean, featureNames?: unknown[], featureItems: Array<{ index: string | number, name?: unknown, visible?: boolean }> }>} */
    const partialLayerInfo = new Map();
    /** @type {Set<string>} */
    const groupedChildIds = new Set();
    for (const [id, state] of this.mapController.groupStates) {
      if (!state.loaded) continue;
      const config = /** @type {MapRecord | null | undefined} */ (dataService.getMapById(id) || state.config);
      if (config) { loadedMaps.push(config); loadedIdOf.set(config, id); }
      visibilityMap.set(id, state.visible);
      for (const childId of state.childIds || []) groupedChildIds.add(childId);
    }
    for (const [id, state] of this.mapController.layerStates) {
      if (groupedChildIds.has(id)) continue;
      const config = /** @type {MapRecord | null | undefined} */ (dataService.getMapById(id) || state.config);
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
    /** @param {MapRecord} map */
    const rowKey = (map) => loadedIdOf.get(map) || map.id;
    const activeOrder = this.getActiveLayerOrder(loadedMaps.map(rowKey));
    const orderIndex = new Map(activeOrder.map((id, index) => [id, index]));
    loadedMaps.sort((a, b) => {
      const ai = orderIndex.has(rowKey(a)) ? /** @type {number} */ (orderIndex.get(rowKey(a))) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(rowKey(b)) ? /** @type {number} */ (orderIndex.get(rowKey(b))) : Number.MAX_SAFE_INTEGER;
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
   * @template {string} T
   * @this {LayerApp}
   * @param {string} mapId
   * @param {T} outcome
   * @returns {T}
   */
  recordSettleOutcome(mapId, outcome) {
    if (!mapId) return outcome;
    if (!this.settleOutcomes) this.settleOutcomes = new Map();
    if (outcome === 'settled' || outcome === 'timeout') this.settleOutcomes.set(mapId, outcome);
    else this.settleOutcomes.delete(mapId);
    return outcome;
  }

  /** @this {LayerApp} @param {string} mapId */
  isMapLoaded(mapId) {
    const mapConfig = /** @type {LayerMapConfig | undefined} */ (dataService.getMapById(mapId));
    if (mapConfig?.isGroup && compositeChildIds(mapConfig).length) {
      return compositeChildIds(mapConfig).some((memberId) => this.mapController.isLayerLoaded(memberId));
    }
    return this.mapController.isLayerLoaded(mapId);
  }

  /** @this {LayerApp} @param {string} mapId */
  isMapVisible(mapId) {
    return this.mapController.isLayerVisible(mapId);
  }
}
