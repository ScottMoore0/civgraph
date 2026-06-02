import maplibregl from 'maplibre-gl';
import { TestMapLibreController } from '../../test/src/map-controller.js';
import { repairFeatureProperties } from '../../test/src/feature-property-repairs.js';

const BASE_MAPS = {
  'osm-standard': ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  'osm-humanitarian': ['https://tile-{a-c}.openstreetmap.fr/hot/{z}/{x}/{y}.png'],
  'cartodb-positron': ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  'cartodb-dark': ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
  'cartodb-dark-nolabels': ['https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'],
  'cartodb-voyager': ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],
  'esri-satellite': ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  'esri-world-topo': ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
  'esri-natgeo': ['https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
  'esri-ocean': ['https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
  'opentopomap': ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
  'stamen-terrain': ['https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg'],
  'usgs-topo': ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}']
};

const OVERLAY_LAYERS = {
  'voyager-labels': {
    tiles: [
      'https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png'
    ],
    attribution: '&copy; CARTO',
    maxzoom: 20
  },
  'merit-catchments': {
    tiles: ['https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/MERIT_River_Basins_v1/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; MERIT-Basins',
    maxzoom: 12
  },
  'merit-rivers': {
    tiles: ['https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/MERIT_Rivers_v1/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; MERIT-Basins',
    maxzoom: 12
  }
};

const DEFAULT_VECTOR_FILL_OPACITY = 0;

function normalizeBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const a = bounds[0];
  const b = bounds[1];
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const looksLeaflet = Math.abs(Number(a[0])) <= 90 && Math.abs(Number(a[1])) > 90;
  return looksLeaflet ? [[Number(a[1]), Number(a[0])], [Number(b[1]), Number(b[0])]] : bounds;
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
    this.addressMarker = null;
    this.onFeatureClick = null;
  }

  init(container = this.container) {
    this.renderer = new TestMapLibreController(container, {
      onSelection: (selection) => this.handleSelection(selection),
      onChange: () => this.options.onChange?.(this),
      onMetric: (metric) => this.options.onMetric?.(metric),
      onFallback: (metric) => this.options.onFallback?.(metric)
    });
    this.renderer.init();
    this.map = this.renderer.map;
    this.map.invalidateSize = () => this.invalidateSize();
    this.installMainStyleMapControls();
    return this;
  }

  installMainStyleMapControls() {
    const map = this.map;
    const host = map?.getContainer?.();
    if (!map || !host || host.querySelector('.test2-main-zoom-control')) return;
    host.querySelectorAll([
      '.maplibregl-ctrl-top-left .maplibregl-ctrl-group',
      '.maplibregl-ctrl-top-right .maplibregl-ctrl-group',
      '.maplibregl-ctrl-bottom-left .maplibregl-ctrl-group',
      '.maplibregl-ctrl-bottom-right .maplibregl-ctrl-group',
      '.maplibregl-ctrl-scale'
    ].join(',')).forEach((element) => element.remove());
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
    host.appendChild(control);
  }

  async loadLayer(mapOrId, options = {}) {
    const mainId = typeof mapOrId === 'string' ? mapOrId : mapOrId?.id;
    const config = typeof mapOrId === 'object' && mapOrId ? mapOrId : null;
    if (!mainId) return null;

    if (!options.partial && this.layerStates.get(mainId)?.isPartial) {
      this.unloadLayer(mainId);
    }

    if (config?.isGroup && Array.isArray(config.members) && config.members.length) {
      const results = [];
      for (const memberId of config.members) results.push(await this.loadLayer(memberId, options));
      return results[0] || null;
    }

    const layer = this.resolveLayer(mainId);
    if (!layer) {
      const error = new Error(`${config?.name || mainId} is not converted for the /test2 MapLibre route yet.`);
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
    this.mainToTest.set(mainId, runtimeLayer.id);
    this.testToMain.set(runtimeLayer.id, mainId);
    await this.renderer.loadLayer(runtimeLayer);
    const state = this.createMainLayerState(mainId, runtimeLayer, mainConfig);
    this.layerStates.set(mainId, {
      ...state
    });
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
    return [
      ...[...this.layerStates.entries()].filter(([, state]) => state.visible).map(([id]) => id),
      ...[...this.groupStates.entries()].filter(([, state]) => state.visible).map(([id]) => id)
    ];
  }

  getLayerState(mainId) {
    if (this.groupStates.has(mainId)) return this.groupStates.get(mainId);
    return this.layerStates.get(mainId) || null;
  }

  markGroupLoaded(mainId, config, childIds = []) {
    const ids = childIds.filter(Boolean);
    if (!mainId || !ids.length) return;
    this.groupStates.set(mainId, {
      loaded: true,
      visible: ids.some((id) => this.isLayerVisible(id)),
      config,
      childIds: ids,
      isGroup: true
    });
    this.options.onChange?.(this);
  }

  setLayerDrawOrder(orderedIdsTopToBottom = []) {
    const orderedTestIds = orderedIdsTopToBottom
      .map((id) => this.mainToTest.get(id))
      .filter(Boolean);
    for (let i = orderedTestIds.length - 1; i >= 0; i -= 1) {
      const id = orderedTestIds[i];
      const record = this.renderer?.layers.get(id);
      for (const layerId of record?.layerIds || []) {
        if (this.map.getLayer(layerId)) this.map.moveLayer(layerId);
      }
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
    this.options.onChange?.(this);
  }

  setFillOpacity(mainId, opacity) {
    const state = this.layerStates.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const value = clamp01(opacity);
    state._fillOpacity = value;
    const fillId = `${testId}-fill`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', value);
    this.options.onChange?.(this);
  }

  setRasterOpacity(mainId, opacity) {
    const state = this.layerStates.get(mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const value = clamp01(opacity);
    state._rasterOpacity = value;
    const rasterId = `${testId}-raster`;
    if (this.map.getLayer(rasterId)) this.map.setPaintProperty(rasterId, 'raster-opacity', value);
    this.options.onChange?.(this);
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

  clearElectionStyle(mainId) {
    const state = this.layerStates.get(mainId)
      || [...this.layerStates.values()].find((candidate) => candidate.testLayerId === mainId);
    const testId = state?.testLayerId || this.mainToTest.get(mainId) || mainId;
    const record = this.renderer?.layers.get(testId);
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
    const tiles = BASE_MAPS[id] || BASE_MAPS['osm-standard'];
    if (!this.map) return;
    if (this.map.getLayer('osm')) this.map.removeLayer('osm');
    if (this.map.getSource('osm')) this.map.removeSource('osm');
    this.map.addSource('osm', {
      type: 'raster',
      tiles,
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors'
    });
    const firstLayer = this.map.getStyle().layers?.[0]?.id;
    this.map.addLayer({ id: 'osm', type: 'raster', source: 'osm' }, firstLayer);
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
    const config = OVERLAY_LAYERS[overlayId];
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

  fitToLayer(mainId) {
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.fitToLayer(testId);
  }

  fitToBounds(bounds, options = {}) {
    const normalized = normalizeBounds(bounds);
    if (!normalized || !this.map) return;
    this.map.fitBounds(normalized, { padding: 36, duration: options?.smooth === false ? 0 : 400, maxZoom: 14 });
  }

  invalidateSize() {
    if (!this.map) return;
    setTimeout(() => this.map.resize(), 0);
  }

  highlightFeature(mainId, featureId, options = {}) {
    const testId = this.mainToTest.get(mainId) || mainId;
    return this.renderer?.selectFeatureById(testId, featureId, options.properties || {}) || false;
  }

  async loadSingleFeature(mapConfig, featureId, featureName, bbox) {
    const mainId = mapConfig?.id;
    const alreadyFull = mainId ? this.layerStates.get(mainId)?.baseLoaded === true && !this.layerStates.get(mainId)?.isPartial : false;
    let state = this.layerStates.get(mainId);
    if (!state || !this.renderer?.layers.has(state.testLayerId)) {
      state = await this.loadLayer(mapConfig, { fit: false, partial: true });
    }
    this.ensurePartialFeatureState(state);
    const properties = { name: featureName || featureId };
    const requestedId = normalizeFeatureId(featureId);
    const existing = this.findRenderedFeature(mainId, requestedId, featureName);
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
    this.highlightFeature(mainId, id, { properties });
    if (bbox) this.fitToBounds(bbox);
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
    this.addressMarker = new maplibregl.Marker({ color: '#065a6e' })
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
    return this.metadataService.getLayer(mainId)
      || this.metadataService.layers.find((layer) => layer.sourceMapId === mainId && layer.loadable)
      || this.metadataService.layers.find((layer) => layer.migration?.sourceMapId === mainId && layer.loadable)
      || this.metadataService.layers.find((layer) => layer.parentId === mainId && layer.loadable)
      || null;
  }

  toRuntimeLayer(layer, mainConfig = null) {
    const styledLayer = this.applyMainStyle(layer, mainConfig);
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (localHost && styledLayer.sourceType === 'pmtiles' && styledLayer.tilesFallback) {
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
    const featureName = readFeatureName(layerConfig, properties, id);
    return {
      ...properties,
      id,
      mapId: mainId,
      mapName: state?.config?.name || layerConfig.name || mainId,
      layerName: state?.config?.name || layerConfig.name || mainId,
      featureName,
      name: properties.name || featureName,
      color: layerConfig.style?.color || layerConfig.style?.fillColor || '#3388ff',
      properties,
      geometry: feature.geometry || null,
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

  handleSelection(selection) {
    if (!selection) return;
    const mainId = this.testToMain.get(selection.layer.id) || selection.layer.sourceMapId || selection.layer.id;
    const state = this.layerStates.get(mainId);
    const record = this.renderer?.layers.get(state?.testLayerId || selection.layer.id);
    const feature = this.normalizeRenderedFeature(selection.feature, mainId, state, record);
    const enrichedFeature = this.options.enrichFeature?.(feature, selection) || feature;
    const features = [enrichedFeature];
    this.onFeatureClick?.(features);
    this.options.onFeatureClick?.(features);
  }
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
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
