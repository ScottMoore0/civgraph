import maplibregl from 'maplibre-gl';
import { TestMapLibreController } from '../../test/src/map-controller.js';

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

    this.mainToTest.set(mainId, layer.id);
    this.testToMain.set(layer.id, mainId);
    await this.renderer.loadLayer(layer);
    this.layerStates.set(mainId, {
      loaded: true,
      visible: true,
      config: config || this.toMainConfig(layer),
      testLayerId: layer.id,
      layerIds: [layer.id],
      geoJsonLayers: [],
      group: null
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
    return this.layerStates.has(mainId) || this.renderer?.layers.has(mainId) || false;
  }

  isLayerVisible(mainId) {
    return this.layerStates.get(mainId)?.visible || false;
  }

  getVisibleLayers() {
    return [...this.layerStates.entries()].filter(([, state]) => state.visible).map(([id]) => id);
  }

  getLayerState(mainId) {
    return this.layerStates.get(mainId) || null;
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

  setTextScale(scale) {
    for (const testId of this.mainToTest.values()) {
      this.renderer?.setLayerTextScale(testId, scale);
    }
  }

  setLayerLabelsHidden(mainId, hidden) {
    const testId = this.mainToTest.get(mainId) || mainId;
    this.renderer?.setLayerLabelsEnabled(testId, !hidden);
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
