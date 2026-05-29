import maplibregl from 'maplibre-gl';
import { TestMapLibreController } from '../../test/src/map-controller.js';

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

function normalizeBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const a = bounds[0];
  const b = bounds[1];
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const looksLeaflet = Math.abs(Number(a[0])) <= 90 && Math.abs(Number(a[1])) > 90;
  return looksLeaflet ? [[Number(a[1]), Number(a[0])], [Number(b[1]), Number(b[0])]] : bounds;
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
    return this;
  }

  async loadLayer(mapOrId, options = {}) {
    const mainId = typeof mapOrId === 'string' ? mapOrId : mapOrId?.id;
    const config = typeof mapOrId === 'object' && mapOrId ? mapOrId : null;
    if (!mainId) return null;

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

    const runtimeLayer = this.toRuntimeLayer(layer);
    this.mainToTest.set(mainId, runtimeLayer.id);
    this.testToMain.set(runtimeLayer.id, mainId);
    await this.renderer.loadLayer(runtimeLayer);
    const state = this.createMainLayerState(mainId, runtimeLayer, config);
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
    const state = this.layerStates.get(mainId);
    if (!state) return;
    this.setLayerVisibility(mainId, !state.visible);
  }

  setLayerVisibility(mainId, visible) {
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
    return [...this.layerStates.entries()].filter(([, state]) => state.visible).map(([id]) => id);
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
    return false;
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
    const state = await this.loadLayer(mapConfig, { fit: false });
    this.highlightFeature(mapConfig.id, featureId, { properties: { name: featureName || featureId } });
    if (bbox) this.fitToBounds(bbox);
    return { state, feature: { id: featureId, name: featureName, mapId: mapConfig.id } };
  }

  togglePartialFeature() {}
  unloadPartialFeature() {}
  isFeatureLoaded() { return false; }
  isFeatureVisible() { return false; }
  findFeaturesAtPoint() { return []; }

  getLoadedFeatures(limit = 500) {
    const features = [];
    for (const [mainId, state] of this.layerStates) {
      const record = this.renderer?.layers.get(state.testLayerId);
      const queryLayers = (record?.layerIds || []).filter((id) => this.map.getLayer(id) && !/hover|selected/i.test(id));
      if (!queryLayers.length) continue;
      const rendered = this.map.queryRenderedFeatures({ layers: queryLayers });
      for (const feature of rendered) {
        features.push({
          ...(feature.properties || {}),
          id: feature.id,
          mapId: mainId,
          mapName: state.config?.name || mainId
        });
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
      const record = this.renderer?.layers.get(state.testLayerId);
      layers.push(...(record?.layerIds || []).filter((id) => this.map.getLayer(id) && !/hover|selected/i.test(id)));
    }
    if (!layers.length) return [];
    const features = this.map.queryRenderedFeatures(
      [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]],
      { layers }
    );
    return features.map((feature) => {
      const layerId = feature.layer?.id?.replace(/-(fill|line|label|raster)$/, '');
      const mainId = this.testToMain.get(layerId) || layerId;
      return {
        ...(feature.properties || {}),
        id: feature.id,
        mapId: mainId,
        mapName: this.layerStates.get(mainId)?.config?.name || mainId
      };
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

  toRuntimeLayer(layer) {
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (localHost && layer.sourceType === 'pmtiles' && layer.tilesFallback) {
      return {
        ...layer,
        sourceType: 'mvt',
        tiles: layer.tilesFallback,
        tileUrl: undefined
      };
    }
    return layer;
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
      _fillOpacity: layer.style?.fillOpacity ?? 0.18,
      _rasterOpacity: layer.rasterOpacity ?? layer.style?.opacity ?? 0.85
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
    const feature = {
      ...(selection.feature?.properties || {}),
      id: selection.feature?.id,
      mapId: mainId,
      mapName: selection.layer.name
    };
    const features = [feature];
    this.onFeatureClick?.(features);
    this.options.onFeatureClick?.(features);
  }
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
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
