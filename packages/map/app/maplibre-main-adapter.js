import maplibregl from 'maplibre-gl';
import { TestMapLibreController } from '../src/renderer/map-controller.js';
import { repairFeatureProperties } from '../src/renderer/feature-property-repairs.js';
import { boundsToMapLibre } from '../src/renderer/utils.js';
import { waitForMapSettle } from './settle.js';
import { compositeChildIds } from '../src/map-relations.mjs';
import { cdnUrl } from '../src/cdn-url.js';
import { CHOOSABLE_BASE_MAPS, resolveBaseMapId } from '../src/renderer/basemap.mjs';
import { overlayConfig } from '../src/renderer/overlays.mjs';
import {
  classCounts,
  fillColorExpression,
  joinRows,
  licenceFor,
  OVERLAY_FILL_OPACITY,
  overlayClasses,
  overlayRuntimeLayer,
  parseCsv,
  statisticFor
} from '../src/census-overlay.mjs';
import layerTypes from '../../registries/src/browser/layer-types.mjs';

// A census overlay is drawn on a vector geography: never on a raster, an image, terrain or a point
// cloud (the layer-types registry's rasterSource and threeD types).
const NON_VECTOR_SOURCE_TYPES = new Set([...layerTypes.behaviour.rasterSource, ...layerTypes.behaviour.threeD]);
import { MAP_COLOURS } from '../src/colours.mjs';

// The base maps (packages/map/src/renderer/basemap.mjs): 'osm-standard' is the default street map,
// not one tile server but the provider chain there (OpenFreeMap, then OpenStreetMap's own tiles as
// the last resort); CHOOSABLE_BASE_MAPS are the raster ones a reader can pick instead, each
// credited to its own provider. The Esri, CARTO and Stamen base maps were removed on 11 Nov 2026.

// The timeline's change highlight (setTimelineChanges). Magenta reads against the blues,
// greens and browns the boundary layers use and against the OSM base map.
const TIMELINE_CHANGE_ACCENT = MAP_COLOURS.timelineAccent;
const TIMELINE_CHANGE_GHOST = MAP_COLOURS.timelineGhost;
const TIMELINE_OLDER_EDITION_COLOUR = MAP_COLOURS.olderEdition;
const TIMELINE_CHANGE_MARKER_MIN_PX = 7;
const TIMELINE_CHANGE_LAYERS = Object.freeze({
  sourceId: 'test2-timeline-changes',
  markerSourceId: 'test2-timeline-change-markers',
  fillId: 'test2-timeline-changes-fill',
  outlineId: 'test2-timeline-changes-outline',
  newLineId: 'test2-timeline-changes-new',
  goneLineId: 'test2-timeline-changes-gone',
  markerId: 'test2-timeline-change-markers'
});

const DEFAULT_VECTOR_FILL_OPACITY = 0;

function normalizeBounds(bounds) {
  if (!Array.isArray(bounds)) return null;
  if (bounds.length === 4) {
    const values = bounds.map(Number);
    if (!values.every(Number.isFinite)) return null;
    return [[values[0], values[1]], [values[2], values[3]]];
  }
  const converted = boundsToMapLibre(bounds);
  if (!converted) return null;
  const values = converted.flat().map(Number);
  if (!values.every(Number.isFinite)) return null;
  return [[values[0], values[1]], [values[2], values[3]]];
}

function mergeBounds(current, next) {
  if (!next) return current;
  if (!current) return next;
  return [
    [
      Math.min(current[0][0], next[0][0]),
      Math.min(current[0][1], next[0][1])
    ],
    [
      Math.max(current[1][0], next[1][0]),
      Math.max(current[1][1], next[1][1])
    ]
  ];
}

function normalizeOrderIds(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const result = [];
  for (const rawId of ids) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function resolveFillOpacity(layer) {
  return clamp01(layer?.style?.fillOpacity ?? DEFAULT_VECTOR_FILL_OPACITY);
}

export class Test2MapLibreMainAdapter {
  constructor(container, metadataService, options = {}) {
    this.container = container;
    this.metadataService = metadataService;
    this.options = options;
    this.renderer = null;
    this.map = null;
    this.layerStates = new Map();
    this.groupStates = new Map();
    this.mainToTest = new Map();
    this.testToMain = new Map();
    this.overlayLayers = new Map();
    this.timelineChanges = null;
    // Main/test layer-order convention is top-to-bottom for the active-card UI.
    // Internally we keep bottom-to-top because MapLibre moveLayer() promotes
    // each moved style layer above the previous one.
    this._rememberedOrder = [];
    this.addressMarker = null;
    this.onFeatureClick = null;
    this.resizeFrame = 0;
    this.lastResizeSize = null;
  }

  init(container = this.container) {
    this.renderer = new TestMapLibreController(container, {
      onSelection: (selection) => this.handleSelection(selection),
      shouldSuppressLayerInteraction: (event) => this.isTimelineChangeEventAtPoint(event),
      onChange: () => this.options.onChange?.(this),
      onMetric: (metric) => this.options.onMetric?.(metric),
      onFallback: (metric) => this.options.onFallback?.(metric)
    });
    this.renderer.init();
    this.map = this.renderer.map;
    this.map.invalidateSize = () => this.invalidateSize();
    // Where the reader last clicked, so the feature details can list everything under that point.
    this.map.on('click', (event) => { this.lastClickPoint = event.point; this.lastClickAt = Date.now(); });
    this.installMainStyleMapControls();
    this.applyMobileTouchContract();
    return this;
  }

  applyMobileTouchContract() {
    this.renderer?.applyMobileTouchContract?.();
  }

  getMobileGestureDiagnostics() {
    return this.renderer?.getMobileGestureDiagnostics?.() || null;
  }

  installMainStyleMapControls() {
    const map = this.map;
    const host = map?.getContainer?.();
    if (!map || !host || host.querySelector('.test2-main-control-stack')) return;
    host.querySelectorAll([
      '.maplibregl-ctrl-top-left .maplibregl-ctrl-group',
      '.maplibregl-ctrl-top-right .maplibregl-ctrl-group',
      '.maplibregl-ctrl-bottom-left .maplibregl-ctrl-group',
      '.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group',
      '.maplibregl-ctrl-scale'
    ].join(',')).forEach((element) => element.remove());
    const stack = document.createElement('div');
    stack.className = 'test2-main-control-stack';
    stack.setAttribute('aria-label', 'Map controls');
    const control = document.createElement('div');
    control.className = 'leaflet-control leaflet-bar leaflet-control-zoom test2-main-zoom-control';
    control.setAttribute('aria-label', 'Zoom controls');
    control.innerHTML = `
      <button type="button" class="leaflet-control-zoom-in test2-main-zoom-control__button" aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" class="leaflet-control-zoom-out test2-main-zoom-control__button" aria-label="Zoom out" title="Zoom out">-</button>
      <button type="button" class="leaflet-control-compass test2-main-zoom-control__button test2-main-zoom-control__compass" aria-label="Reset north" title="Reset north">
        <svg class="test2-main-zoom-control__compass-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 2l5 18-5-3-5 3 5-18z"></path>
        </svg>
      </button>
    `;
    control.querySelector('.leaflet-control-zoom-in')?.addEventListener('click', (event) => {
      event.preventDefault();
      map.zoomIn({ duration: 150 });
    });
    control.querySelector('.leaflet-control-zoom-out')?.addEventListener('click', (event) => {
      event.preventDefault();
      map.zoomOut({ duration: 150 });
    });
    const compassButton = control.querySelector('.leaflet-control-compass');
    const compassIcon = control.querySelector('.test2-main-zoom-control__compass-icon');
    const updateCompass = () => {
      const bearing = Number(map.getBearing?.() || 0);
      if (compassIcon) compassIcon.style.transform = `rotate(${-bearing}deg)`;
      compassButton?.classList.toggle('test2-main-zoom-control__compass--active', Math.abs(bearing) > 0.1);
    };
    compassButton?.addEventListener('click', (event) => {
      event.preventDefault();
      map.easeTo({ bearing: 0, pitch: 0, duration: 150 });
    });
    map.on('rotate', updateCompass);
    map.on('rotateend', updateCompass);
    map.on('pitch', updateCompass);
    updateCompass();
    stack.appendChild(control);
    host.appendChild(stack);
  }

  async loadLayer(mapOrId, options = {}) {
    const mainId = typeof mapOrId === 'string' ? mapOrId : mapOrId?.id;
    const config = typeof mapOrId === 'object' && mapOrId ? mapOrId : null;
    if (!mainId) return null;

    if (!options.partial && this.layerStates.get(mainId)?.isPartial) {
      this.unloadLayer(mainId);
    }

    // compositeChildIds, not config.members: this branch and app.js's used DIFFERENT
    // fields for the same relation, so which one expanded a composite depended on which
    // field the map happened to carry. See packages/map/src/map-relations.mjs.
    const groupChildIds = compositeChildIds(config);
    if (config?.isGroup && groupChildIds.length) {
      const results = await Promise.all(groupChildIds.map((memberId) => this.loadLayer(memberId, {
        ...options,
        fit: false
      })));
      if (options.fit !== false) this.fitToLayers(groupChildIds);
      return results[0] || null;
    }

    const layer = this.resolveLayer(mainId);
    if (!layer) {
      const error = new Error(`${config?.name || mainId} is not converted for the MapLibre route yet.`);
      this.options.onError?.(error, { mainId, config });
      throw error;
    }
    if (!layer.loadable) {
      const error = new Error(`${layer.name || config?.name || mainId} is listed in the catalogue but is not yet converted.`);
      this.options.onError?.(error, { mainId, config, layer });
      throw error;
    }

    const mainConfig = config || this.options.getMainMap?.(mainId) || this.options.getMainMap?.(layer.sourceMapId) || null;
    const runtimeLayer = this.toRuntimeLayer(layer, mainConfig);
    // A census statistic: its figures are fetched before the layer is added, so the
    // boundaries never flash up unshaded and a missing CSV fails the load outright.
    const overlay = runtimeLayer.censusOverlay ? await this.prepareCensusOverlay(runtimeLayer.censusOverlay) : null;
    this.mainToTest.set(mainId, runtimeLayer.id);
    this.testToMain.set(runtimeLayer.id, mainId);
    await this.renderer.loadLayer(runtimeLayer, { fit: options.fit !== false });
    // Taken off while it loaded (the renderer's layer-load machine cancelled it): record nothing.
    if (this.renderer.layers instanceof Map && !this.renderer.layers.has(runtimeLayer.id)) return null;
    const state = this.createMainLayerState(mainId, runtimeLayer, mainConfig);
    if (overlay) {
      state.censusOverlay = overlay;
      state._fillOpacity = OVERLAY_FILL_OPACITY;
      this.applyCensusOverlayPaint(runtimeLayer.id, overlay);
    }
    this.layerStates.set(mainId, {
      ...state
    });
    this._rememberLayerOrderId(mainId);
    this._applyRememberedOrderToMap();
    if (options.fit !== false) this.fitToLayer(mainId);
    this.options.onChange?.(this);
    return this.layerStates.get(mainId);
  }

  loadLayerFilteredByIndex(layerId, sourceMapConfig) {
    return this.loadLayer(sourceMapConfig?.id || layerId, { fit: true });
  }

  async expandToFullMap(mapConfig) {
    const mainId = typeof mapConfig === 'string' ? mapConfig : mapConfig?.id;
    if (mainId && this.layerStates.get(mainId)?.isPartial) this.unloadLayer(mainId);
    return this.loadLayer(mapConfig);
  }

  /** Why a loaded layer drew nothing (the renderer's getLayerLoadFailure), or null. A group has
   * failed only when every member has: one member drawn is a partial success, not an error. */
  getLayerLoadFailure(mainId) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) {
      const failures = (groupState.childIds || []).map((childId) => this.getLayerLoadFailure(childId));
      return failures.length && failures.every(Boolean) ? failures[0] : null;
    }
    const testId = this.mainToTest.get(mainId) || mainId;
    return this.renderer?.getLayerLoadFailure?.(testId) || null;
  }

  unloadLayer(mainId) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) {
      for (const childId of groupState.childIds || []) this.unloadLayer(childId);
      this.groupStates.delete(mainId);
      this.options.onChange?.(this);
      return;
    }
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.unloadLayer(testId);
    this.mainToTest.delete(mainId);
    this.testToMain.delete(testId);
    this.layerStates.delete(mainId);
    this.options.onChange?.(this);
  }

  showLayer(mainId) {
    this.setLayerVisibility(mainId, true);
  }

  hideLayer(mainId) {
    this.setLayerVisibility(mainId, false);
  }

  toggleLayer(mainId) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) {
      this.setLayerVisibility(mainId, !groupState.visible);
      return;
    }
    const state = this.layerStates.get(mainId);
    if (!state) return;
    this.setLayerVisibility(mainId, !state.visible);
  }

  setLayerVisibility(mainId, visible) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) {
      for (const childId of groupState.childIds || []) this.setLayerVisibility(childId, visible);
      groupState.visible = Boolean(visible);
      this._applyRememberedOrderToMap();
      this.options.onChange?.(this);
      return;
    }
    const state = this.layerStates.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (!record) return;
    for (const layerId of record.layerIds || []) {
      if (this.map.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }
    if (state) state.visible = Boolean(visible);
    this._applyRememberedOrderToMap();
    this.options.onChange?.(this);
  }

  isLayerLoaded(mainId) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) return groupState.childIds.every((id) => this.isLayerLoaded(id));
    return this.layerStates.has(mainId) || this.renderer?.layers.has(mainId) || false;
  }

  isLayerVisible(mainId) {
    const groupState = this.groupStates.get(mainId);
    if (groupState) return groupState.childIds.some((id) => this.isLayerVisible(id));
    return this.layerStates.get(mainId)?.visible || false;
  }

  getVisibleLayers() {
    const groupedChildIds = new Set();
    const visibleGroups = [...this.groupStates.entries()]
      .filter(([, state]) => state.visible)
      .map(([id, state]) => {
        for (const childId of state.childIds || []) groupedChildIds.add(childId);
        return id;
      });
    const visibleLayers = [...this.layerStates.entries()]
      .filter(([id, state]) => state.visible && !groupedChildIds.has(id))
      .map(([id]) => id);
    return [...visibleGroups, ...visibleLayers];
  }

  getLayerState(mainId) {
    if (this.groupStates.has(mainId)) return this.groupStates.get(mainId);
    return this.layerStates.get(mainId) || null;
  }

  markGroupLoaded(mainId, config, childIds = []) {
    const ids = childIds.filter(Boolean);
    if (!mainId || !ids.length) return;
    const state = {
      loaded: true,
      visible: ids.some((id) => this.isLayerVisible(id)),
      config,
      childIds: ids,
      isGroup: true,
      _strokeOpacity: 1,
      _fillOpacity: resolveFillOpacity(config),
      _rasterOpacity: config?.rasterOpacity ?? config?.style?.opacity ?? 0.85
    };
    state.geoJsonLayers = [{
      setStyle: (style = {}) => {
        if (style.opacity !== undefined) {
          state._strokeOpacity = clamp01(style.opacity);
          for (const childId of ids) this.setStrokeOpacity(childId, style.opacity);
        }
        if (style.fillOpacity !== undefined) {
          state._fillOpacity = clamp01(style.fillOpacity);
          for (const childId of ids) this.setFillOpacity(childId, style.fillOpacity);
        }
      }
    }];
    state.group = {
      eachLayer: (callback) => {
        callback({
          setOpacity: (opacity) => {
            state._rasterOpacity = clamp01(opacity);
            for (const childId of ids) this.setRasterOpacity(childId, opacity);
          }
        });
      }
    };
    this.groupStates.set(mainId, state);
    this._rememberLayerOrderId(mainId);
    this._applyRememberedOrderToMap();
    this.options.onChange?.(this);
  }

  getLayerDrawOrder(options = {}) {
    const { loadedOnly = true } = options || {};
    this._ensureRememberedOrderCoverage();
    const topToBottom = [...this._rememberedOrder].reverse();
    if (!loadedOnly) return topToBottom;
    const groupedChildIds = this._getGroupedChildIds();
    return topToBottom.filter((id) => {
      if (groupedChildIds.has(id)) return false;
      const groupState = this.groupStates.get(id);
      if (groupState) return Boolean(groupState.loaded);
      const state = this.layerStates.get(id);
      return Boolean(state?.loaded);
    });
  }

  setLayerDrawOrder(orderedIdsTopToBottom = [], options = {}) {
    const { notify = false } = options || {};
    const incomingTop = normalizeOrderIds(orderedIdsTopToBottom);
    if (!incomingTop.length) return;
    this._ensureRememberedOrderCoverage();
    const incomingBottom = [...incomingTop].reverse();
    const incomingSet = new Set(incomingBottom);
    const existing = this._rememberedOrder.filter((id) => !incomingSet.has(id));
    this._rememberedOrder = [...existing, ...incomingBottom];
    this._applyRememberedOrderToMap();
    if (notify) this.options.onChange?.(this);
  }

  _rememberLayerOrderId(mainId) {
    if (!mainId || this._rememberedOrder.includes(mainId)) return;
    this._rememberedOrder.push(mainId);
  }

  _ensureRememberedOrderCoverage() {
    for (const [id, state] of this.groupStates.entries()) {
      if (state?.loaded) this._rememberLayerOrderId(id);
    }
    for (const [id, state] of this.layerStates.entries()) {
      if (state?.loaded) this._rememberLayerOrderId(id);
    }
  }

  _getGroupedChildIds() {
    const ids = new Set();
    for (const state of this.groupStates.values()) {
      for (const childId of state?.childIds || []) ids.add(childId);
    }
    return ids;
  }

  _moveMainLayerToTop(mainId) {
    const testId = this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (!record || !this.map) return;
    for (const layerId of record.layerIds || []) {
      if (this.map.getLayer(layerId)) this.map.moveLayer(layerId);
    }
  }

  _applyRememberedOrderToMap() {
    if (!this.map || !this.renderer) return;
    this._ensureRememberedOrderCoverage();
    const groupedChildIds = this._getGroupedChildIds();
    for (const mainId of this._rememberedOrder) {
      const groupState = this.groupStates.get(mainId);
      if (groupState?.loaded) {
        for (const childId of groupState.childIds || []) {
          this._moveMainLayerToTop(childId);
        }
        continue;
      }
      if (groupedChildIds.has(mainId)) continue;
      if (this.layerStates.get(mainId)?.loaded) this._moveMainLayerToTop(mainId);
    }
  }

  setOpacity(mainId, opacity) {
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.setOpacity(testId, opacity);
  }

  setStrokeOpacity(mainId, opacity) {
    const state = this.layerStates.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (!record) return;
    const value = clamp01(opacity);
    state._strokeOpacity = value;
    const lineId = `${testId}-line`;
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity';
      this.map.setPaintProperty(lineId, property, value);
    }
    // No onChange(): opacity is a live paint change and isn't part of URL/catalogue
    // state. Firing it here re-renders the Active Layers list, which collapses the
    // opacity panel and destroys the slider mid-drag (the "control disappears" bug).
  }

  setFillOpacity(mainId, opacity) {
    const state = this.layerStates.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const value = clamp01(opacity);
    state._fillOpacity = value;
    const fillId = `${testId}-fill`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', value);
    // See setStrokeOpacity: no onChange() — avoids collapsing the opacity panel mid-drag.
  }

  setRasterOpacity(mainId, opacity) {
    // Look up the state in either map (single layers vs groups) and guard against
    // a missing state/layer — otherwise this threw (unlike setStroke/FillOpacity,
    // which guard), leaving the raster's opacity un-applied.
    const state = this.layerStates.get(mainId) || this.groupStates?.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const rasterId = `${testId}-raster`;
    if (!this.map.getLayer(rasterId)) return;
    const value = clamp01(opacity);
    if (state) state._rasterOpacity = value;
    this.map.setPaintProperty(rasterId, 'raster-opacity', value);
    // See setStrokeOpacity: no onChange() — avoids collapsing the opacity panel mid-drag.
  }

  setTransparency(value) {
    const opacity = 1 - clamp01(Number(value) / 100);
    for (const id of this.layerStates.keys()) this.setStrokeOpacity(id, opacity);
  }

  setFillTransparency(value) {
    const opacity = 1 - clamp01(Number(value) / 100);
    for (const id of this.layerStates.keys()) this.setFillOpacity(id, opacity);
  }

  setLabelsEnabled(enabled) {
    for (const testId of this.mainToTest.values()) {
      this.renderer?.setLayerLabelsEnabled(testId, Boolean(enabled));
    }
  }

  setTextScale(scale) {
    for (const testId of this.mainToTest.values()) {
      this.renderer?.setLayerTextScale(testId, scale);
    }
  }

  setLayerLabelsHidden(mainId, hidden) {
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.setLayerLabelsEnabled(testId, !hidden);
  }

  applyElectionStyle(mainId, style = {}) {
    const state = this.layerStates.get(mainId)
      || [...this.layerStates.values()].find((candidate) => candidate.testLayerId === mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (!record) return;

    record._electionOriginalPaint ||= {};
    const fillId = `${testId}-fill`;
    const lineId = `${testId}-line`;
    if (this.map.getLayer(fillId)) {
      record._electionOriginalPaint.fillColor ??= this.map.getPaintProperty(fillId, 'fill-color');
      record._electionOriginalPaint.fillOpacity ??= this.map.getPaintProperty(fillId, 'fill-opacity');
      if (style.fillColorExpression !== undefined) {
        this.map.setPaintProperty(fillId, 'fill-color', style.fillColorExpression);
      }
      if (style.fillOpacityExpression !== undefined) {
        this.map.setPaintProperty(fillId, 'fill-opacity', style.fillOpacityExpression);
      } else if (style.fillOpacity !== undefined) {
        this.map.setPaintProperty(fillId, 'fill-opacity', clamp01(style.fillOpacity));
      }
    }
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-color' : 'line-color';
      record._electionOriginalPaint.lineColor ??= this.map.getPaintProperty(lineId, property);
      record._electionOriginalPaint.lineOpacity ??= this.map.getPaintProperty(lineId, record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity');
      record._electionOriginalPaint.lineWidth ??= this.map.getPaintProperty(lineId, record.config.geometryType === 'point' ? 'circle-radius' : 'line-width');
      this.map.setPaintProperty(lineId, property, style.lineColorExpression || style.fillColorExpression);
      if (style.lineOpacityExpression !== undefined) {
        this.map.setPaintProperty(lineId, record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity', style.lineOpacityExpression);
      } else if (style.lineOpacity !== undefined) {
        this.map.setPaintProperty(lineId, record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity', clamp01(style.lineOpacity));
      }
      if (style.lineWidth !== undefined && record.config.geometryType !== 'point') {
        this.map.setPaintProperty(lineId, 'line-width', style.lineWidth);
      }
    }
    if (Number.isFinite(Number(style.labelMinZoomOverride))) {
      record.config.test2LabelMinZoomOverride = Number(style.labelMinZoomOverride);
      this.renderer?.refreshDomLabels?.(testId);
    }
    if (style.hideLabels === true) {
      record._electionOriginalPaint.labelsEnabled ??= record.labelsEnabled;
      this.renderer?.setLayerLabelsEnabled(testId, false);
    }
    record.electionStyle = {
      mode: style.mode || 'winner'
    };
    this.options.onChange?.(this);
  }

  /**
   * Grey diagonal hatching over the features an election cannot fully show (results missing or
   * incomplete), drawn above the election fill and below the outlines. `options`: { matchInput,
   * keys, theme: 'light'|'dark' }; null removes it. The layer joins the record's layers, so it is
   * hidden, reordered and unloaded with them.
   */
  setElectionHatch(mainId, options = null) {
    const state = this.layerStates.get(mainId)
      || [...this.layerStates.values()].find((candidate) => candidate.testLayerId === mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (!record || !this.map) return false;
    const hatchId = `${testId}-election-hatch`;
    if (this.map.getLayer(hatchId)) this.map.removeLayer(hatchId);
    record.layerIds = (record.layerIds || []).filter((id) => id !== hatchId);
    const keys = [...new Set((options?.keys || []).map(String).filter(Boolean))];
    if (!keys.length || !options?.matchInput) return false;
    const fillId = `${testId}-fill`;
    const fill = this.map.getLayer(fillId);
    if (!fill) return false;
    const image = options.theme === 'dark' ? 'civgraph-election-hatch-dark' : 'civgraph-election-hatch-light';
    ensureHatchImage(this.map, image, options.theme === 'dark');
    const match = ['match', options.matchInput, keys, true, false];
    const existing = this.map.getFilter(fillId);
    const layer = {
      id: hatchId,
      type: 'fill',
      source: fill.source,
      filter: existing ? ['all', existing, match] : match,
      paint: { 'fill-pattern': image, 'fill-opacity': 0.9 },
      layout: { visibility: this.map.getLayoutProperty(fillId, 'visibility') || 'visible' }
    };
    if (fill.sourceLayer) layer['source-layer'] = fill.sourceLayer;
    const lineId = `${testId}-line`;
    this.map.addLayer(layer, this.map.getLayer(lineId) ? lineId : undefined);
    const fillIndex = record.layerIds.indexOf(fillId);
    record.layerIds.splice(fillIndex >= 0 ? fillIndex + 1 : record.layerIds.length, 0, hatchId);
    return true;
  }

  clearElectionStyle(mainId) {
    const state = this.layerStates.get(mainId)
      || [...this.layerStates.values()].find((candidate) => candidate.testLayerId === mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
    if (record && this.map?.getLayer(`${testId}-election-hatch`)) this.setElectionHatch(mainId, null);
    if (!record?._electionOriginalPaint) return;
    const fillId = `${testId}-fill`;
    const lineId = `${testId}-line`;
    if (this.map.getLayer(fillId)) {
      if (record._electionOriginalPaint.fillColor !== undefined) {
        this.map.setPaintProperty(fillId, 'fill-color', record._electionOriginalPaint.fillColor);
      }
      if (record._electionOriginalPaint.fillOpacity !== undefined) {
        this.map.setPaintProperty(fillId, 'fill-opacity', record._electionOriginalPaint.fillOpacity);
      }
    }
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-color' : 'line-color';
      if (record._electionOriginalPaint.lineColor !== undefined) {
        this.map.setPaintProperty(lineId, property, record._electionOriginalPaint.lineColor);
      }
      if (record._electionOriginalPaint.lineOpacity !== undefined) {
        this.map.setPaintProperty(lineId, record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity', record._electionOriginalPaint.lineOpacity);
      }
      if (record._electionOriginalPaint.lineWidth !== undefined && record.config.geometryType !== 'point') {
        this.map.setPaintProperty(lineId, 'line-width', record._electionOriginalPaint.lineWidth);
      }
    }
    if (record._electionOriginalPaint.labelsEnabled !== undefined) {
      this.renderer?.setLayerLabelsEnabled(testId, Boolean(record._electionOriginalPaint.labelsEnabled));
    }
    delete record.config.test2LabelMinZoomOverride;
    this.renderer?.refreshDomLabels?.(testId);
    delete record._electionOriginalPaint;
    delete record.electionStyle;
    this.options.onChange?.(this);
  }

  setBaseMap(id) {
    const basemap = this.renderer?.basemap;
    if (!this.map || !basemap) return;
    const chosen = resolveBaseMapId(id);
    const provider = CHOOSABLE_BASE_MAPS[chosen];
    if (!provider) {
      basemap.useDefault();
      return;
    }
    basemap.useRaster({ id: chosen, label: chosen, tiles: provider.tiles, attribution: provider.attribution });
  }

  toggleOverlay() {
    const [overlayId, enabled = true] = arguments;
    if (enabled) return this.showOverlay(overlayId);
    return this.hideOverlay(overlayId);
  }

  showOverlay(overlayId) {
    if (!this.map || !overlayId) return false;
    if (this.overlayLayers.has(overlayId)) {
      const overlay = this.overlayLayers.get(overlayId);
      const layerId = overlay.layerId;
      if (this.map.getLayer(layerId)) this.map.setLayoutProperty(layerId, 'visibility', 'visible');
      overlay.visible = true;
      return true;
    }
    const config = overlayConfig(overlayId);
    if (!config) return false;
    const sourceId = `test2-overlay-${overlayId}-source`;
    const layerId = `test2-overlay-${overlayId}`;
    if (!this.map.getSource(sourceId)) {
      this.map.addSource(sourceId, {
        type: 'raster',
        tiles: config.tiles,
        tileSize: 256,
        attribution: config.attribution,
        maxzoom: config.maxzoom
      });
    }
    if (!this.map.getLayer(layerId)) {
      this.map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': 0.82 }
      });
    }
    this.overlayLayers.set(overlayId, { sourceId, layerId, visible: true });
    this.options.onChange?.(this);
    return true;
  }

  hideOverlay(overlayId) {
    const overlay = this.overlayLayers.get(overlayId);
    if (!this.map || !overlay) return false;
    if (this.map.getLayer(overlay.layerId)) this.map.setLayoutProperty(overlay.layerId, 'visibility', 'none');
    overlay.visible = false;
    this.options.onChange?.(this);
    return true;
  }


  /**
   * Boundary changes between two editions of a series (data/timeline-changes/, built by
   * scripts/build/timeline-changes.py), drawn whenever the timeline steps.
   *
   *   change areas    translucent fill in the accent colour, thin outline
   *   new lines       solid accent lines (lines in the edition now shown, not in the other)
   *   gone lines      a faint dashed ghost
   *   markers         a circle at each change's label point, never smaller than
   *                   TIMELINE_CHANGE_MARKER_MIN_PX, so a change of a few townlands is still
   *                   visible at island zoom; it fades as the areas themselves become legible
   *
   * `geojson` holds the pair files' features; `options.reversed` is set when stepping
   * backwards, which swaps which lines are new and which are gone. `options.points` is the
   * change list's label points ({ id, lng, lat }).
   */
  setTimelineChanges(geojson, options = {}) {
    if (!this.map) return false;
    const reversed = options.reversed === true;
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const shown = features.map((feature) => {
      const role = feature?.properties?.role;
      const drawn = role === 'added' ? (reversed ? 'gone' : 'new') : role === 'removed' ? (reversed ? 'new' : 'gone') : 'area';
      return { ...feature, properties: { ...(feature.properties || {}), drawn } };
    });
    const points = (Array.isArray(options.points) ? options.points : [])
      .filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat))
      .map((point) => ({
        type: 'Feature',
        properties: { changeId: point.id, drawn: 'marker' },
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] }
      }));
    const data = { type: 'FeatureCollection', features: shown };
    const markerData = { type: 'FeatureCollection', features: points };
    const accent = TIMELINE_CHANGE_ACCENT;
    const { sourceId, markerSourceId, fillId, outlineId, newLineId, goneLineId, markerId } = TIMELINE_CHANGE_LAYERS;
    if (this.map.getSource(sourceId)) this.map.getSource(sourceId).setData(data);
    else this.map.addSource(sourceId, { type: 'geojson', data });
    if (this.map.getSource(markerSourceId)) this.map.getSource(markerSourceId).setData(markerData);
    else this.map.addSource(markerSourceId, { type: 'geojson', data: markerData });
    const ensure = (spec) => {
      if (!this.map.getLayer(spec.id)) this.map.addLayer(spec);
      // Above every boundary layer, including one loaded since the last step.
      this.map.moveLayer(spec.id);
    };
    ensure({
      id: fillId, type: 'fill', source: sourceId, filter: ['==', ['get', 'drawn'], 'area'],
      paint: { 'fill-color': accent, 'fill-opacity': 0.3, 'fill-antialias': false }
    });
    ensure({
      id: outlineId, type: 'line', source: sourceId, filter: ['==', ['get', 'drawn'], 'area'],
      paint: { 'line-color': accent, 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.4] }
    });
    ensure({
      id: goneLineId, type: 'line', source: sourceId, filter: ['==', ['get', 'drawn'], 'gone'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': TIMELINE_CHANGE_GHOST,
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 1.8],
        'line-dasharray': [2, 2]
      }
    });
    ensure({
      id: newLineId, type: 'line', source: sourceId, filter: ['==', ['get', 'drawn'], 'new'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': accent, 'line-opacity': 0.95, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 3.5] }
    });
    ensure({
      id: markerId, type: 'circle', source: markerSourceId,
      paint: {
        'circle-color': accent,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, TIMELINE_CHANGE_MARKER_MIN_PX, 10, TIMELINE_CHANGE_MARKER_MIN_PX + 3],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 11.5, 0],
        'circle-stroke-color': MAP_COLOURS.circleStroke,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 9, 1, 11.5, 0]
      }
    });
    this.installTimelineChangeHandlers();
    this.timelineChanges = {
      key: options.key || null,
      reversed,
      markers: points.length,
      areas: shown.filter((feature) => feature.properties.drawn === 'area').length,
      newLines: shown.filter((feature) => feature.properties.drawn === 'new').length,
      goneLines: shown.filter((feature) => feature.properties.drawn === 'gone').length
    };
    return true;
  }

  /** A click on a change marker zooms to that change instead of selecting the boundary under it. */
  installTimelineChangeHandlers() {
    if (this._timelineChangeHandlersInstalled || !this.map) return;
    this._timelineChangeHandlersInstalled = true;
    const { markerId } = TIMELINE_CHANGE_LAYERS;
    this.map.on('click', markerId, (event) => {
      if (this.map.getZoom() >= 11.5) return;
      const id = event?.features?.[0]?.properties?.changeId;
      if (id) this.options.onTimelineChangeClick?.(id);
    });
    this.map.on('mouseenter', markerId, () => {
      if (this.map.getZoom() < 11.5 && this.map?.getCanvas?.()) this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', markerId, () => { if (this.map?.getCanvas?.()) this.map.getCanvas().style.cursor = ''; });
  }

  isTimelineChangeEventAtPoint(event) {
    if (!this.map || !this.timelineChanges?.markers || !event?.point) return false;
    const { markerId } = TIMELINE_CHANGE_LAYERS;
    if (!this.map.getLayer(markerId)) return false;
    // Markers are drawn only at low zoom; a transparent one must not swallow clicks.
    if (this.map.getZoom() >= 11.5) return false;
    return this.map.queryRenderedFeatures(event.point, { layers: [markerId] }).length > 0;
  }

  clearTimelineChanges() {
    if (!this.map) return false;
    const empty = { type: 'FeatureCollection', features: [] };
    const { sourceId, markerSourceId } = TIMELINE_CHANGE_LAYERS;
    this.map.getSource(sourceId)?.setData(empty);
    this.map.getSource(markerSourceId)?.setData(empty);
    this.timelineChanges = null;
    return true;
  }

  /** What the change highlight currently holds (null when nothing is drawn), for tests. */
  getTimelineChangesState() {
    return this.timelineChanges ? { ...this.timelineChanges } : null;
  }

  /**
   * Two editions of one series switched on together used to be drawn identically. The older
   * one is now grey and dashed (role 'older'); null restores the layer's own style.
   */
  setEditionRole(mainId, role) {
    if (!this.map) return;
    const group = this.groupStates?.get(mainId);
    const ids = Array.isArray(group?.childIds) && group.childIds.length ? group.childIds : [mainId];
    for (const id of ids) {
      const state = this.layerStates.get(id);
      const testId = state?.testLayerId || this.mainToTest.get(id) || id;
      const record = this.renderer?.layers.get(testId);
      if (!record || record.config?.geometryType === 'point') continue;
      const lineId = `${testId}-line`;
      const fillId = `${testId}-fill`;
      if (!this.map.getLayer(lineId)) continue;
      if (role === 'older') {
        if (record._editionOriginalPaint) continue;
        record._editionOriginalPaint = {
          lineColor: this.map.getPaintProperty(lineId, 'line-color'),
          lineDash: this.map.getPaintProperty(lineId, 'line-dasharray'),
          lineWidth: this.map.getPaintProperty(lineId, 'line-width'),
          fillOpacity: this.map.getLayer(fillId) ? this.map.getPaintProperty(fillId, 'fill-opacity') : undefined
        };
        this.map.setPaintProperty(lineId, 'line-color', TIMELINE_OLDER_EDITION_COLOUR);
        // Its dotted approximate stretches go grey with it, so the newer edition's dots stand out.
        if (this.map.getLayer(`${testId}-approx`)) this.map.setPaintProperty(`${testId}-approx`, 'line-color', TIMELINE_OLDER_EDITION_COLOUR);
        this.map.setPaintProperty(lineId, 'line-dasharray', [3, 2]);
        // Thinner than the newer edition, so where the two agree the newer line still shows
        // either side of the dashes whichever is drawn on top.
        this.map.setPaintProperty(lineId, 'line-width', ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 1.6]);
        if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', 0);
        record.editionRole = 'older';
      } else if (record._editionOriginalPaint) {
        const original = record._editionOriginalPaint;
        this.map.setPaintProperty(lineId, 'line-color', original.lineColor);
        if (this.map.getLayer(`${testId}-approx`)) this.map.setPaintProperty(`${testId}-approx`, 'line-color', original.lineColor);
        this.map.setPaintProperty(lineId, 'line-dasharray', original.lineDash ?? null);
        if (original.lineWidth !== undefined) this.map.setPaintProperty(lineId, 'line-width', original.lineWidth);
        if (this.map.getLayer(fillId) && original.fillOpacity !== undefined) this.map.setPaintProperty(fillId, 'fill-opacity', original.fillOpacity);
        delete record._editionOriginalPaint;
        delete record.editionRole;
      }
    }
  }

  clearTransientHighlight(options = {}) {
    this.renderer?.clearHover?.();
    if (options.clearSelection === false || !this.renderer?.selected) return;
    const selected = this.renderer.selected;
    this.renderer.clearFeatureState?.(selected, 'selected');
    this.renderer.setDomLabelSelected?.(selected.layerId, selected.id, false);
    this.renderer.selected = null;
    this.renderer.notifyChange?.();
  }
  fitToLayer(mainId) {
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.fitToLayer(testId);
  }

  fitToLayers(mainIds = []) {
    const bounds = mainIds.reduce((acc, mainId) => {
      const state = this.layerStates.get(mainId);
      const normalized = normalizeBounds(state?.config?.bounds);
      if (!normalized) return acc;
      return mergeBounds(acc, normalized);
    }, null);
    if (bounds) this.fitToBounds(bounds, { smooth: false });
  }

  fitToBounds(bounds, options = {}) {
    const normalized = normalizeBounds(bounds);
    if (!normalized || !this.map) return;
    if (this.renderer?.flattenAfter3d?.(normalized, { mapLibre: true })) return;
    this.map.fitBounds(normalized, { padding: this.renderer?.fitPadding?.() ?? 36, duration: options?.smooth === false ? 0 : 400, maxZoom: 14 });
  }

  /**
   * Resolve once the map has actually finished drawing what was just asked of it.
   *
   * loadLayer() resolves as soon as the source and layer are added to the style -- tens of
   * milliseconds -- long before a single tile has arrived. That is the right contract for
   * callers, but it is the wrong thing to hang a spinner on: tied to it, the catalogue
   * spinner vanished about 30ms after the click while the layer was still loading, which
   * is indistinguishable from having no spinner at all.
   *
   * A single 'idle' is not enough either. MapLibre reports idle whenever it is not moving
   * and has no outstanding tiles, so the tick right after addLayer -- before any tile
   * request has been issued -- often qualifies. This therefore waits for idle AND for
   * areTilesLoaded(), and keeps waiting through further idles until both hold.
   *
   * The timeout is a guarantee rather than an optimisation: a stalled tile request must
   * never leave a spinner turning forever, so this resolves regardless at the deadline.
   *
   * T0-05: it resolves with WHICH of those two happened, and that distinction is the
   * whole point. Before, both paths resolved undefined, so the catalogue asked
   * isLayerLoaded() instead -- which reports style membership, not tiles. A layer whose
   * tiles never arrived is still in the style, so a twenty-second stall was announced to
   * the user as "loaded" over a blank map. Returning the outcome is what lets the caller
   * tell "the tiles are drawn" from "we stopped waiting".
   *
   *   'settled'     -- idle with areTilesLoaded() true. The tiles are drawn.
   *   'timeout'     -- the deadline passed first. Say so; do not claim success.
   *   'unavailable' -- no map to observe. Distinct from success on purpose: a caller
   *                    must not read "could not tell" as "worked".
   */
  waitUntilSettled({ timeoutMs = 20000 } = {}) {
    return waitForMapSettle(this.map, { timeoutMs });
  }

  invalidateSize() {
    if (!this.map) return;
    this.applyMobileTouchContract();
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      this.applyMobileTouchContract();
      const nextSize = this.readMapContainerSize();
      if (!this.shouldResizeMap(nextSize)) return;
      this.lastResizeSize = nextSize;
      this.map.resize();
    });
  }

  readMapContainerSize() {
    const container = this.map?.getContainer?.();
    const rect = container?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10
    };
  }

  shouldResizeMap(nextSize) {
    if (!nextSize || nextSize.width <= 0 || nextSize.height <= 0) return false;
    const previous = this.lastResizeSize;
    if (!previous) return true;
    const sizeChanged = Math.abs(nextSize.width - previous.width) > 1 || Math.abs(nextSize.height - previous.height) > 1;
    if (sizeChanged) return true;
    const canvasRect = this.map?.getCanvas?.()?.getBoundingClientRect?.();
    if (!canvasRect) return false;
    return Math.abs(canvasRect.width - nextSize.width) > 1 || Math.abs(canvasRect.height - nextSize.height) > 1;
  }

  highlightFeature(mainId, featureId, options = {}) {
    const testId = this.mainToTest.get(mainId) || mainId;
    return this.renderer?.selectFeatureById(testId, featureId, options.properties || {}) || false;
  }

  waitForMapRender(timeout = 700) {
    if (!this.map) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeout);
      this.map.once?.('idle', finish);
      this.map.triggerRepaint?.();
    });
  }

  async loadSingleFeature(mapConfig, featureId, featureName, bbox, options = {}) {
    const mainId = mapConfig?.id;
    if (options.isolate && mainId) {
      const existingState = this.layerStates.get(mainId);
      if (existingState?.baseLoaded === true && !existingState?.isPartial) {
        this.unloadLayer(mainId);
      }
    }
    const alreadyFull = mainId ? this.layerStates.get(mainId)?.baseLoaded === true && !this.layerStates.get(mainId)?.isPartial : false;
    let state = this.layerStates.get(mainId);
    if (!state || !this.renderer?.layers.has(state.testLayerId)) {
      state = await this.loadLayer(mapConfig, { fit: false, partial: true });
    }
    this.ensurePartialFeatureState(state);
    const properties = { name: featureName || featureId };
    const requestedId = normalizeFeatureId(featureId);
    let existing = this.findRenderedFeature(mainId, requestedId, featureName);
    const id = requestedId || normalizeFeatureId(existing?.id) || normalizeFeatureId(featureName);
    if (existing?.properties) Object.assign(properties, existing.properties);
    if (!alreadyFull) {
      state.isPartial = true;
      state.baseLoaded = false;
      state.loadedIndices.add(id);
      state.featureNames.set(id, featureName || existing?.featureName || `Feature ${featureId}`);
      state.featureVisibility.set(id, true);
      state.featureProperties.set(id, properties);
      if (existing?.geometry) state.featureGeometry.set(id, existing.geometry);
      this.applyPartialFeatureFilter(mainId);
    }
    // No box given (a shared link, a search result from the names index): ask the caller where
    // the feature is (options.resolveBounds, from the spatial and feature indexes), and failing
    // that show the whole layer, so the feature is at least on screen (QA 2026-11-11, H2).
    let frame = bbox;
    let smooth = true;
    if (!frame && typeof options.resolveBounds === 'function') {
      const layerConfig = this.renderer?.layers.get(state.testLayerId)?.config || state.config || null;
      try {
        frame = await options.resolveBounds(layerConfig);
      } catch {
        frame = null;
      }
      frame ||= state.config?.bounds || layerConfig?.bounds || null;
      smooth = options.smooth !== false;
    }
    if (frame) {
      this.fitToBounds(frame, { smooth });
      await this.waitForMapRender();
    }
    if (!existing) {
      existing = this.findRenderedFeature(mainId, id, featureName);
      if (existing?.properties) Object.assign(properties, existing.properties);
      if (existing?.geometry) state.featureGeometry.set(id, existing.geometry);
      state.featureProperties.set(id, properties);
    }
    this.highlightFeature(mainId, id, { properties });
    return {
      state,
      feature: {
        id,
        mapId: mainId,
        name: featureName || existing?.featureName || properties.name,
        featureName: featureName || existing?.featureName || properties.name,
        properties,
        geometry: existing?.geometry || state.featureGeometry.get(id) || null
      }
    };
  }

  togglePartialFeature(mapId, featureId) {
    const state = this.layerStates.get(mapId);
    const id = normalizeFeatureId(featureId);
    if (!state?.featureVisibility?.has(id)) return;
    state.featureVisibility.set(id, state.featureVisibility.get(id) === false);
    this.applyPartialFeatureFilter(mapId);
    this.options.onChange?.(this);
  }

  unloadPartialFeature(mapId, featureId) {
    const state = this.layerStates.get(mapId);
    const id = normalizeFeatureId(featureId);
    if (!state?.loadedIndices?.has(id)) return;
    state.loadedIndices.delete(id);
    state.featureNames?.delete(id);
    state.featureVisibility?.delete(id);
    state.featureProperties?.delete(id);
    state.featureGeometry?.delete(id);
    if (this.renderer?.selected?.layerId === state.testLayerId && normalizeFeatureId(this.renderer.selected.id) === id) {
      this.renderer.clearFeatureState?.(this.renderer.selected, 'selected');
      this.renderer.setDomLabelSelected?.(state.testLayerId, id, false);
      this.renderer.selected = null;
    }
    if (state.loadedIndices.size === 0 && state.isPartial && !state.baseLoaded) {
      this.unloadLayer(mapId);
      return;
    }
    this.applyPartialFeatureFilter(mapId);
    this.options.onChange?.(this);
  }

  isFeatureLoaded(mapId, featureId) {
    const state = this.layerStates.get(mapId);
    if (!state) return false;
    if (state.baseLoaded && !state.isPartial) return true;
    return state.loadedIndices?.has(normalizeFeatureId(featureId)) || false;
  }

  isFeatureVisible(mapId, featureId) {
    const state = this.layerStates.get(mapId);
    if (!state) return false;
    if (state.baseLoaded && !state.isPartial) return this.isLayerVisible(mapId);
    const id = normalizeFeatureId(featureId);
    return Boolean(state.loadedIndices?.has(id) && state.featureVisibility?.get(id) !== false && state.visible);
  }

  isPartialLayer(mapId) {
    return !!this.layerStates.get(mapId)?.isPartial;
  }

  getPartialFeatureNames(mapId) {
    const state = this.layerStates.get(mapId);
    if (!state?.loadedIndices) return [];
    return [...state.loadedIndices].map((id) => state.featureNames?.get(id) || state.featureProperties?.get(id)?.name || `Feature ${id}`);
  }

  getPartialFeatureItems(mapId) {
    const state = this.layerStates.get(mapId);
    if (!state?.loadedIndices) return [];
    return [...state.loadedIndices].map((id) => ({
      index: id,
      name: state.featureNames?.get(id) || state.featureProperties?.get(id)?.name || `Feature ${id}`,
      visible: state.featureVisibility?.get(id) !== false && state.visible !== false
    }));
  }

  findFeaturesAtPoint(lat, lon, radius = 8) {
    return this.queryFeaturesAtLngLat(lat, lon, radius);
  }

  getLoadedFeatures(limit = 500) {
    const features = [];
    const seen = new Set();
    for (const [mainId, state] of this.layerStates) {
      if (!state.visible) continue;
      const record = this.renderer?.layers.get(state.testLayerId);
      const queryLayers = this.getQueryableLayerIds(record);
      if (!queryLayers.length) continue;
      const rendered = this.map.queryRenderedFeatures({ layers: queryLayers });
      for (const feature of rendered) {
        const normalized = this.normalizeRenderedFeature(feature, mainId, state, record);
        const key = featureDedupeKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        features.push(normalized);
        if (features.length >= limit) return features;
      }
    }
    return features;
  }

  /**
   * Every feature of the visible layers under the point last clicked, one per feature, for the
   * feature details' "Features here" list. Each entry can be passed to selectFeatureAtClick.
   */
  featuresAtLastClick(radius = 4) {
    const point = this.lastClickPoint;
    // Only for a selection made by that click (or from this list), not one made from search later.
    if (!this.map || !point || Date.now() - (this.lastClickAt || 0) > 15000) return [];
    const out = [];
    const seen = new Set();
    for (const [mainId, state] of this.layerStates) {
      if (!state.visible) continue;
      const record = this.renderer?.layers.get(state.testLayerId);
      const layers = this.getQueryableLayerIds(record);
      if (!layers.length) continue;
      const rendered = this.map.queryRenderedFeatures(
        [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]], { layers });
      for (const raw of rendered) {
        const feature = this.normalizeRenderedFeature(raw, mainId, state, record);
        const key = `${feature.mapId}|${featureDedupeKey(feature)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, mapId: feature.mapId, layerName: feature.layerName, featureName: feature.featureName || feature.name || 'Unnamed feature', layer: record?.config, raw });
      }
    }
    return out;
  }

  /** Show one of featuresAtLastClick's entries in the feature details, as a click on it would. */
  selectFeatureAtClick(entry) {
    if (!entry?.layer || !entry.raw) return false;
    this.lastClickAt = Date.now();
    return this.renderer?.selectFeature(entry.layer, entry.raw) || false;
  }

  queryFeaturesAtLngLat(lat, lon, radius = 8) {
    if (!this.map) return [];
    const point = this.map.project([Number(lon), Number(lat)]);
    const layers = [];
    for (const state of this.layerStates.values()) {
      if (!state.visible) continue;
      const record = this.renderer?.layers.get(state.testLayerId);
      layers.push(...this.getQueryableLayerIds(record));
    }
    if (!layers.length) return [];
    const features = this.map.queryRenderedFeatures(
      [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]],
      { layers }
    );
    const seen = new Set();
    return features.map((feature) => {
      const layerId = feature.layer?.id?.replace(/-(fill|line|label|raster)$/, '');
      const mainId = this.testToMain.get(layerId) || layerId;
      const state = this.layerStates.get(mainId);
      return this.normalizeRenderedFeature(feature, mainId, state, this.renderer?.layers.get(state?.testLayerId));
    }).filter((feature) => {
      const key = featureDedupeKey(feature);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  addAddressMarker(lat, lon, name) {
    this.removeAddressMarker();
    if (!this.map) return;
    this.addressMarker = new maplibregl.Marker({ color: MAP_COLOURS.addressMarker })
      .setLngLat([Number(lon), Number(lat)])
      .setPopup(new maplibregl.Popup().setHTML(`<strong>${escapeHtml(name || 'Selected location')}</strong>`))
      .addTo(this.map);
    this.addressMarker.togglePopup();
    this.map.flyTo({ center: [Number(lon), Number(lat)], zoom: 14, essential: true });
  }

  removeAddressMarker() {
    this.addressMarker?.remove();
    this.addressMarker = null;
  }

  resolveLayer(mainId) {
    const directLayer = this.metadataService.getLayer(mainId);
    if (directLayer?.loadable) return directLayer;
    const layers = this.metadataService.layers || [];
    return layers.find((layer) => layer.sourceMapId === mainId && layer.loadable)
      || layers.find((layer) => layer.migration?.sourceMapId === mainId && layer.loadable)
      || layers.find((layer) => layer.parentId === mainId && layer.loadable)
      || this.resolveCensusOverlayLayer(mainId)
      || directLayer
      || null;
  }

  /**
   * A census statistic (data/database/data-entries.json) has no layer of its own in the map
   * index: it is drawn as its geography's tiles under its own id, so it can sit on the map
   * beside the plain boundaries and come off without taking them with it.
   */
  resolveCensusOverlayLayer(mainId) {
    // getDataEntry looks among the 80 statistics only; getMainMap would scan every map and
    // variant, and resolveLayer runs for every id the catalogue checks.
    const entry = this.options.getDataEntry
      ? this.options.getDataEntry(mainId)
      : (this.options.getMainMap?.(mainId)?.isDataEntry ? this.options.getMainMap(mainId) : null);
    if (!entry || !entry.geography || !entry.csv || entry.geography === mainId) return null;
    this.censusOverlayLayers ||= new Map();
    if (this.censusOverlayLayers.has(mainId)) return this.censusOverlayLayers.get(mainId);
    const geography = this.resolveLayer(entry.geography);
    const usable = geography?.loadable && !NON_VECTOR_SOURCE_TYPES.has(geography.sourceType);
    const layer = usable ? overlayRuntimeLayer(entry, geography) : null;
    if (layer) this.censusOverlayLayers.set(mainId, layer);
    return layer;
  }

  /** Fetch a statistic's CSV (and crosswalk), join it and work out its classes and colours. */
  async prepareCensusOverlay(entry) {
    this.censusOverlayFiles ||= new Map();
    const fetchText = (url) => {
      if (!this.censusOverlayFiles.has(url)) {
        const pending = fetch(url, { cache: 'default' }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        });
        // A failed fetch is not remembered: Retry must try again.
        pending.catch(() => this.censusOverlayFiles.delete(url));
        this.censusOverlayFiles.set(url, pending);
      }
      return this.censusOverlayFiles.get(url);
    };
    let csvText;
    let crosswalk = null;
    try {
      [csvText, crosswalk] = await Promise.all([
        fetchText(cdnUrl(entry.csv)),
        entry.joinCrosswalk
          ? fetchText(`/${String(entry.joinCrosswalk).replace(/^\/+/, '')}`).then((text) => JSON.parse(text))
          : null
      ]);
    } catch (error) {
      const failure = new Error(`${entry.name}: its figures could not be loaded (${error?.message || error}).`);
      failure.code = 'census-overlay-data-failed';
      this.options.onError?.(failure, { mainId: entry.id, config: entry });
      throw failure;
    }
    const { rows } = parseCsv(csvText);
    const joined = joinRows(entry, rows, crosswalk);
    const classes = overlayClasses(entry);
    return {
      entry,
      rows,
      joined,
      classes,
      counts: classCounts(entry, joined, classes),
      licence: licenceFor(entry),
      fillColor: fillColorExpression(entry, joined, classes)
    };
  }

  applyCensusOverlayPaint(testId, overlay) {
    const fillId = `${testId}-fill`;
    if (!this.map?.getLayer(fillId)) return;
    this.map.setPaintProperty(fillId, 'fill-color', overlay.fillColor);
    this.map.setPaintProperty(fillId, 'fill-opacity', OVERLAY_FILL_OPACITY);
  }

  /** Everything the legend needs for a loaded statistic, or null when mainId is not one. */
  getCensusOverlayLegend(mainId) {
    const overlay = this.layerStates.get(mainId)?.censusOverlay;
    if (!overlay) return null;
    return {
      id: mainId,
      entry: overlay.entry,
      classes: overlay.classes.map((cls, i) => ({ ...cls, count: overlay.counts[i] || 0 })),
      areaCount: overlay.joined.byTileValue.size,
      licence: overlay.licence
    };
  }

  /** The figures behind a rendered feature of a statistic, for the feature details. */
  censusStatisticFor(state, properties) {
    const overlay = state?.censusOverlay;
    if (!overlay) return null;
    const row = overlay.joined.byTileValue.get(String(properties?.[overlay.joined.tileKey] ?? ''));
    const source = overlay.entry.source || {};
    return {
      ...(row ? statisticFor(overlay.entry, row) : { entryId: overlay.entry.id, valueLabel: overlay.entry.name, valueText: '', missing: true }),
      entryName: overlay.entry.name,
      sourceTitle: source.title || '',
      sourceUrl: source.url || '',
      licence: overlay.licence
    };
  }

  toRuntimeLayer(layer, mainConfig = null) {
    const styledLayer = this.applyMainStyle(layer, mainConfig);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    const shouldUseLocalFallback = globalThis.__civgraphUseLocalTileFallback === true;
    if (shouldUseLocalFallback && localHost && styledLayer.sourceType === 'pmtiles' && styledLayer.tilesFallback) {
      // tilesFallback points at directory MVT output under render/tiles/, which is
      // .cfignore'd and untracked deliberately -- a local convenience, not a
      // distributed asset. The path is a correct pointer to where tiles WOULD be
      // written, not a promise that they exist, and a fresh clone has none of the
      // 861 layers' worth. Switching silently produces a wall of 404s that reads
      // as a broken layer rather than an unbuilt one.
      if (!this._warnedLocalTileFallback) {
        this._warnedLocalTileFallback = true;
        console.warn(
          '[civgraph] __civgraphUseLocalTileFallback is on: serving layers from directory MVT under '
          + '/render/tiles/generated/ instead of PMTiles. Those tiles are untracked and never deployed, '
          + 'so unless you generated them locally every tile request will 404. Unset the flag to '
          + 'return to PMTiles.'
        );
      }
      return {
        ...styledLayer,
        sourceType: 'mvt',
        tiles: styledLayer.tilesFallback,
        tileUrl: undefined
      };
    }
    return styledLayer;
  }

  applyMainStyle(layer, mainConfig = null) {
    const mainStyle = mainConfig?.style || {};
    const style = { ...(layer.style || {}) };
    for (const key of ['color', 'fillColor', 'fillOpacity', 'weight', 'opacity', 'radius']) {
      if (mainStyle[key] !== undefined) style[key] = mainStyle[key];
    }
    if (mainStyle.fillOpacity === undefined) delete style.fillOpacity;
    return { ...layer, style };
  }

  createMainLayerState(mainId, layer, config) {
    const mainConfig = config || this.toMainConfig(layer);
    const state = {
      loaded: true,
      visible: true,
      config: mainConfig,
      testLayerId: layer.id,
      layerIds: [layer.id],
      geoJsonLayers: [],
      group: null,
      _strokeOpacity: 1,
      _fillOpacity: resolveFillOpacity(layer),
      _rasterOpacity: layer.rasterOpacity ?? layer.style?.opacity ?? 0.85,
      isPartial: false,
      baseLoaded: true,
      loadedIndices: new Set(),
      featureNames: new Map(),
      featureVisibility: new Map(),
      featureProperties: new Map(),
      featureGeometry: new Map()
    };
    state.geoJsonLayers = [{
      setStyle: (style = {}) => {
        if (style.opacity !== undefined) this.setStrokeOpacity(mainId, Number(style.opacity));
        if (style.fillOpacity !== undefined) this.setFillOpacity(mainId, Number(style.fillOpacity));
      }
    }];
    state.group = {
      eachLayer: (callback) => callback({
        setOpacity: (opacity) => this.setRasterOpacity(mainId, Number(opacity))
      })
    };
    return state;
  }

  ensurePartialFeatureState(state) {
    state.loadedIndices ||= new Set();
    state.featureNames ||= new Map();
    state.featureVisibility ||= new Map();
    state.featureProperties ||= new Map();
    state.featureGeometry ||= new Map();
  }

  applyPartialFeatureFilter(mainId) {
    const state = this.layerStates.get(mainId);
    if (!state?.isPartial) return;
    this.ensurePartialFeatureState(state);
    const record = this.renderer?.layers.get(state.testLayerId);
    if (!record) return;
    const visibleIds = [...state.loadedIndices].filter((id) => state.featureVisibility.get(id) !== false);
    const filter = buildFeatureFilter(record.config, visibleIds, state);
    for (const layerId of this.getQueryableLayerIds(record, { includeHidden: true })) {
      if (this.map.getLayer(layerId)) this.map.setFilter(layerId, filter);
    }
    this.renderer?.scheduleDomLabelRefresh?.(state.testLayerId);
  }

  getQueryableLayerIds(record, options = {}) {
    if (!record) return [];
    return (record.layerIds || []).filter((id) => {
      if (!this.map.getLayer(id)) return false;
      if (/-((hover)|(hover-line)|(selected)|(selected-fill)|(label)|(raster))$/.test(id)) return false;
      if (options.includeHidden) return true;
      return this.map.getLayoutProperty(id, 'visibility') !== 'none';
    });
  }

  findRenderedFeature(mainId, featureId, featureName = null) {
    const state = this.layerStates.get(mainId);
    const record = this.renderer?.layers.get(state?.testLayerId);
    const queryLayers = this.getQueryableLayerIds(record);
    if (!queryLayers.length) return null;
    const targetId = normalizeFeatureId(featureId);
    const targetName = normalizeSearchValue(featureName);
    const features = this.map.queryRenderedFeatures({ layers: queryLayers });
    for (const feature of features) {
      const normalized = this.normalizeRenderedFeature(feature, mainId, state, record);
      if (normalizeFeatureId(normalized.id) === targetId) return normalized;
      if (targetName && normalizeSearchValue(normalized.featureName) === targetName) return normalized;
    }
    return null;
  }

  normalizeRenderedFeature(feature, mainId, state, record) {
    const layerConfig = record?.config || state?.config || {};
    const properties = repairFeatureProperties(layerConfig, { ...(feature.properties || {}) });
    const id = feature.id ?? properties[layerConfig.promoteId || 'id'] ?? properties.id;
    const statistic = this.censusStatisticFor(state, properties);
    // The statistic's own name for the area ("Aldergrove_1") reads better than a tile code.
    const featureName = statistic?.areaName || readFeatureName(layerConfig, properties, id);
    return {
      ...(statistic ? { statistic } : {}),
      ...properties,
      id,
      mapId: mainId,
      mapName: state?.config?.name || layerConfig.name || mainId,
      layerName: state?.config?.name || layerConfig.name || mainId,
      featureName,
      name: properties.name || featureName,
      color: layerConfig.style?.color || layerConfig.style?.fillColor || MAP_COLOURS.layer,
      properties,
      geometry: feature.geometry || null,
      // Geometry from queryRenderedFeatures is CLIPPED to the tile it was drawn in, so a
      // polygon crossing a tile boundary arrives as whichever piece was under the cursor.
      // Deriving area or perimeter from it measures that piece, not the feature: Lisburn
      // 1984 read 71 km² against a district of roughly 440. The feature details pane
      // showed one figure when a layer was loaded from the search results, where geometry
      // comes whole from the source, and a different one after clicking the same feature
      // on the map.
      //
      // The flag says which kind this is, so the consumer can decline to measure rather
      // than measure the wrong thing. Stored attributes such as Shape_Area are duplicated
      // onto every fragment and stay correct either way.
      geometryIsClipped: true,
      sourceLayer: feature.sourceLayer || layerConfig.sourceLayer || null
    };
  }

  toMainConfig(layer) {
    return {
      id: layer.sourceMapId || layer.id,
      name: layer.name,
      category: layer.category,
      group: layer.group,
      date: layer.date || layer.dateEffective,
      provider: Array.isArray(layer.provider) ? layer.provider : layer.provider ? [layer.provider] : [],
      style: layer.style || {}
    };
  }

  async handleSelection(selection) {
    if (!selection) return;
    const token = (this.selectionToken = (this.selectionToken || 0) + 1);
    const mainId = this.testToMain.get(selection.layer.id) || selection.layer.sourceMapId || selection.layer.id;
    const state = this.layerStates.get(mainId);
    const record = this.renderer?.layers.get(state?.testLayerId || selection.layer.id);
    const feature = this.normalizeRenderedFeature(selection.feature, mainId, state, record);
    const metrics = await this.wholeFeatureMetrics(record?.config || selection.layer, feature);
    if (token !== this.selectionToken) return;
    if (metrics) Object.assign(feature, metrics);
    const enrichedFeature = this.options.enrichFeature?.(feature, selection) || feature;
    const features = [enrichedFeature];
    this.onFeatureClick?.(features);
    this.options.onFeatureClick?.(features);
  }

  // The clicked geometry is one tile's piece of the polygon (see normalizeRenderedFeature),
  // so its own area is only "Part area". The feature index carries the whole feature's
  // geodesic area and perimeter, measured from the source at build time; match the click
  // to its item by id, or by name where the name is unique. Bounded wait: a slow index
  // fetch falls back to the part figures rather than holding up the details pane.
  async wholeFeatureMetrics(layerConfig, feature) {
    const url = layerConfig?.featureIndexUrl;
    const geom = String(layerConfig?.geometryType || '').toLowerCase();
    if (!url || !feature || (geom !== 'polygon' && geom !== 'multipolygon')) return null;
    this.featureMetricIndexes ||= new Map();
    if (!this.featureMetricIndexes.has(url)) {
      this.featureMetricIndexes.set(url, fetch(url, { cache: 'default' })
        .then((response) => (response.ok ? response.json() : null))
        .then((index) => {
          const byId = new Map();
          const byName = new Map();
          for (const item of index?.items || []) {
            if (!(item?.areaM2 > 0)) continue;
            byId.set(String(item.id), item);
            const name = normalizeSearchValue(item.name);
            byName.set(name, byName.has(name) ? null : item);
          }
          return { byId, byName };
        })
        .catch(() => ({ byId: new Map(), byName: new Map() })));
    }
    const lookup = await Promise.race([
      this.featureMetricIndexes.get(url),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    ]);
    if (!lookup) return null;
    const item = lookup.byId.get(String(feature.id))
      || lookup.byName.get(normalizeSearchValue(feature.featureName))
      || null;
    return item ? { wholeAreaM2: item.areaM2, wholePerimeterM: item.perimeterM } : null;
  }
}


function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

/** The election hatch: grey diagonals on a clear ground, darker on a light map, lighter on a dark one. */
function ensureHatchImage(map, name, dark) {
  if (!map || map.hasImage?.(name)) return;
  const size = 10;
  const ratio = Math.max(1, Math.round(globalThis.devicePixelRatio || 1));
  const px = size * ratio;
  const data = new Uint8ClampedArray(px * px * 4);
  // A grey line with a pale edge (a dark edge on a dark map), so the hatching reads over a light
  // base map, a dark one and any party colour alike.
  const core = dark ? [214, 222, 232, 225] : [70, 78, 90, 205];
  const edge = dark ? [17, 24, 39, 150] : [255, 255, 255, 150];
  const coreWidth = 1.4 * ratio;
  const edgeWidth = coreWidth + 1.6 * ratio;
  for (let y = 0; y < px; y += 1) {
    for (let x = 0; x < px; x += 1) {
      // Distance from the diagonal x + y = px (wrapping), so the tiles join into continuous lines.
      const d = Math.min(Math.abs(((x + y) % px)), px - ((x + y) % px)) / Math.SQRT2;
      const colour = d <= coreWidth / 2 ? core : (d <= edgeWidth / 2 ? edge : null);
      if (colour) {
        const i = (y * px + x) * 4;
        data[i] = colour[0]; data[i + 1] = colour[1]; data[i + 2] = colour[2]; data[i + 3] = colour[3];
      }
    }
  }
  map.addImage(name, { width: px, height: px, data }, { pixelRatio: ratio });
}

function normalizeFeatureId(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  const text = String(value ?? '').trim();
  if (text !== '' && /^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function normalizeSearchValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function buildFeatureFilter(layer, ids, state = null) {
  if (!ids.length) return noVisibleFeatureFilter();
  const rawValues = [...new Set(ids.filter((id) => id !== undefined && id !== null && id !== ''))];
  const nameValues = ids
    .map((id) => state?.featureNames?.get(id))
    .filter((value) => value !== undefined && value !== null && String(value).trim());
  const stringValues = [...new Set([...rawValues, ...nameValues].map((id) => String(id)))];
  if (!stringValues.length) return noVisibleFeatureFilter();
  const clauses = [];
  for (const property of [layer?.promoteId, 'id'].filter(Boolean)) {
    clauses.push(['in', ['to-string', ['get', property]], ['literal', stringValues]]);
  }
  for (const property of featureNameProperties(layer)) {
    clauses.push(['in', ['to-string', ['get', property]], ['literal', stringValues]]);
  }
  return ['any', ...clauses];
}

function noVisibleFeatureFilter() {
  return ['==', ['get', '__civgraph_no_visible_feature__'], '__civgraph_visible_feature__'];
}

function readFeatureName(layer, properties, fallbackId) {
  const candidates = featureNameProperties(layer);
  for (const key of candidates) {
    const value = properties?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallbackId !== undefined && fallbackId !== null && fallbackId !== '' ? `Feature ${fallbackId}` : 'Unnamed feature';
}

function featureNameProperties(layer) {
  return [...new Set([
    layer?.labelProperty,
    layer?.nameProperty,
    'name',
    'Name',
    'NAME',
    'label',
    'LABEL',
    'title',
    'TITLE'
  ].filter(Boolean))];
}

function featureDedupeKey(feature) {
  if (feature?.id !== undefined && feature?.id !== null && feature?.id !== '') return `${feature.mapId}:${feature.id}`;
  const geometryKey = JSON.stringify(feature?.geometry?.coordinates || '').slice(0, 120);
  return `${feature?.mapId}:${feature?.featureName || feature?.name || 'feature'}:${geometryKey}`;
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

