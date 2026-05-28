import maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import {
  CLICK_TOLERANCE_PX,
  DEFAULT_TEXT_SCALE,
  HOVER_MIN_ZOOM,
  HOVER_THROTTLE_MS,
  IRELAND_BOUNDS
} from './config.js';
import {
  buildLabelColorExpression,
  buildLabelFilter,
  buildLabelFontStack,
  buildLabelSortExpression,
  buildLabelTextExpression,
  buildLabelTextSizeExpression,
  getLabelMaxZoom,
  getLabelMinZoom,
  getLabelStyle
} from './labels.js';
import { absoluteTileTemplate, boundsToFlatBbox, boundsToImageCoordinates, boundsToMapLibre, clamp } from './utils.js';

function isLocalTestTileTemplate(value) {
  return typeof value === 'string' && value.startsWith('/test/tiles/');
}

function localTestTilesAvailable() {
  const hostname = globalThis.location?.hostname || '';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export class TestMapLibreController {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.map = null;
    this.maplibreVersion = maplibregl.version;
    this.protocol = new Protocol({ metadata: true });
    this.layers = new Map();
    this.selected = null;
    this.hovered = null;
    this.metrics = [];
    this.fallbackLayers = new Map();
    this.interactionCleanups = new Map();
    this.fallbackCleanups = new Map();
    maplibregl.addProtocol('pmtiles', this.protocol.tile);
  }

  init() {
    this.map = new maplibregl.Map({
      container: this.container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [-8.05, 53.4],
      zoom: 5.8,
      minZoom: 4,
      maxZoom: 16,
      attributionControl: true
    });

    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    this.map.on('moveend', () => this.notifyChange());
    this.map.on('idle', () => this.notifyChange());
    this.map.fitBounds(IRELAND_BOUNDS, { padding: 28, duration: 0 });
  }

  async loadLayer(layer) {
    if (layer.loadable === false || layer.sourceType === 'unconverted') {
      throw new Error(`${layer.name} is not yet converted for the /test MapLibre renderer`);
    }
    if (this.layers.has(layer.id)) {
      this.fitToLayer(layer.id);
      return;
    }

    const started = performance.now();
    const sourceId = `${layer.id}-source`;
    const fillId = `${layer.id}-fill`;
    const lineId = `${layer.id}-line`;
    const rasterId = `${layer.id}-raster`;
    const hoverId = `${layer.id}-hover`;
    const selectedId = `${layer.id}-selected`;
    const labelId = `${layer.id}-label`;

    await this.waitForMap();

    const source = this.buildSource(layer);
    this.map.addSource(sourceId, source);
    if (layer.sourceType === 'raster' || layer.sourceType === 'image') {
      this.addRasterLayer(layer, { sourceId, rasterId });
    } else {
      this.addGeometryLayers(layer, { sourceId, fillId, lineId, hoverId, selectedId });
    }
    const labelLayerIds = this.addLabelLayers(layer, { sourceId, labelId });

    this.layers.set(layer.id, {
      config: layer,
      sourceId,
      layerIds: [fillId, lineId, hoverId, selectedId, labelId, rasterId].filter((id) => this.map.getLayer(id)),
      labelLayerIds,
      labelsEnabled: true,
      textScale: DEFAULT_TEXT_SCALE,
      opacity: layer.style?.fillOpacity ?? layer.rasterOpacity ?? 0.18,
      color: layer.style?.color || '#5B21B6',
      fillColor: layer.style?.fillColor || layer.style?.color || '#7C3AED'
    });
    this.applySavedLayerPreferences(layer.id);

    if (layer.sourceType !== 'raster' && layer.sourceType !== 'image') {
      this.interactionCleanups.set(layer.id, this.bindLayerInteractions(layer, fillId, labelId, sourceId));
    }
    if (layer.sourceType === 'pmtiles') {
      this.fallbackCleanups.set(layer.id, this.monitorPmtilesFallback(layer, sourceId));
    }
    this.reorderFromSavedLayerOrder();
    this.fitToLayer(layer.id);
    this.recordMetric({
      layerId: layer.id,
      layerName: layer.name,
      event: 'load',
      durationMs: Math.round(performance.now() - started),
      sourceType: layer.sourceType
    });
    this.notifyChange();
  }

  addRasterLayer(layer, ids) {
    this.map.addLayer({
      id: ids.rasterId,
      type: 'raster',
      source: ids.sourceId,
      paint: {
        'raster-opacity': clamp(layer.rasterOpacity ?? layer.style?.opacity ?? 0.85, 0, 1)
      }
    });
  }

  addGeometryLayers(layer, ids) {
    const { sourceId, fillId, lineId, hoverId, selectedId } = ids;
    if (layer.geometryType !== 'line' && layer.geometryType !== 'point') {
      this.map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': layer.style?.fillColor || layer.style?.color || '#7C3AED',
          'fill-opacity': clamp(layer.style?.fillOpacity ?? 0.18, 0, 1)
        }
      });
    }

    this.map.addLayer({
      id: lineId,
      type: layer.geometryType === 'point' ? 'circle' : 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: layer.geometryType === 'point' ? {
        'circle-color': layer.style?.color || '#5B21B6',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 6],
        'circle-opacity': 0.88
      } : {
        'line-color': layer.style?.color || '#5B21B6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, Math.max(0.4, Number(layer.style?.weight || 1) * 0.55), 12, Math.max(0.8, Number(layer.style?.weight || 1) * 1.4)],
        'line-opacity': 0.88
      }
    });

    this.map.addLayer({
      id: hoverId,
      type: layer.geometryType === 'point' ? 'circle' : 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: layer.geometryType === 'point' ? {
        'circle-color': '#F59E0B',
        'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 0],
        'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
      } : {
        'line-color': '#F59E0B',
        'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
      }
    });

    this.map.addLayer({
      id: selectedId,
      type: layer.geometryType === 'point' ? 'circle' : 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: layer.geometryType === 'point' ? {
        'circle-color': '#111827',
        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, 0],
        'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
      } : {
        'line-color': '#111827',
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
      }
    });
  }

  addLabelLayers(layer, ids) {
    if (!layer.labelProperty) return [];
    const { sourceId, labelId } = ids;
    const labelMinZoom = getLabelMinZoom(layer);
    const labelMaxZoom = getLabelMaxZoom(layer);
    const labelStyle = getLabelStyle(layer);
    this.map.addLayer({
      id: labelId,
      type: 'symbol',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      minzoom: labelMinZoom,
      maxzoom: labelMaxZoom,
      filter: buildLabelFilter(layer),
      layout: {
        'text-field': buildLabelTextExpression(layer),
        'text-size': buildLabelTextSizeExpression(layer, DEFAULT_TEXT_SCALE),
        'text-font': buildLabelFontStack(labelStyle),
        'text-max-width': labelStyle.maxWidth,
        'text-line-height': labelStyle.lineHeight,
        'text-justify': 'center',
        'text-padding': 2,
        'text-allow-overlap': Boolean(layer.labelAllowOverlap),
        'text-ignore-placement': Boolean(layer.labelIgnorePlacement),
        'symbol-sort-key': buildLabelSortExpression(layer)
      },
      paint: {
        'text-color': buildLabelColorExpression(layer),
        'text-halo-color': labelStyle.haloColor,
        'text-halo-width': labelStyle.haloWidth,
        'text-halo-blur': labelStyle.haloBlur,
        'text-opacity': ['interpolate', ['linear'], ['zoom'], labelMinZoom - 0.1, 0, labelMinZoom + 0.4, 1]
      }
    });
    return [labelId];
  }

  unloadLayer(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return;
    this.clearFeatureState(this.hovered, 'hover');
    this.clearFeatureState(this.selected, 'selected');
    this.interactionCleanups.get(layerId)?.();
    this.interactionCleanups.delete(layerId);
    this.fallbackCleanups.get(layerId)?.();
    this.fallbackCleanups.delete(layerId);
    for (const layerIdToRemove of [...record.layerIds].reverse()) {
      if (this.map.getLayer(layerIdToRemove)) this.map.removeLayer(layerIdToRemove);
    }
    if (this.map.getSource(record.sourceId)) this.map.removeSource(record.sourceId);
    this.layers.delete(layerId);
    if (this.selected?.layerId === layerId) {
      this.selected = null;
      this.options.onSelection?.(null);
    }
    this.notifyChange();
  }

  setOpacity(layerId, opacity) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.opacity = clamp(opacity, 0, 1);
    const fillId = `${layerId}-fill`;
    const lineId = `${layerId}-line`;
    const rasterId = `${layerId}-raster`;
    if (this.map.getLayer(rasterId)) this.map.setPaintProperty(rasterId, 'raster-opacity', record.opacity);
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', record.opacity);
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity';
      this.map.setPaintProperty(lineId, property, clamp(record.opacity + 0.35, 0, 1));
    }
    this.notifyChange();
  }

  setLayerColor(layerId, color) {
    const record = this.layers.get(layerId);
    if (!record || !isColor(color)) return;
    record.color = color;
    const lineId = `${layerId}-line`;
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-color' : 'line-color';
      this.map.setPaintProperty(lineId, property, color);
    }
    this.notifyChange();
  }

  setLayerFillColor(layerId, color) {
    const record = this.layers.get(layerId);
    if (!record || !isColor(color)) return;
    record.fillColor = color;
    const fillId = `${layerId}-fill`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-color', color);
    this.notifyChange();
  }

  setLayerStrokeWidth(layerId, width) {
    const record = this.layers.get(layerId);
    if (!record) return;
    const lineId = `${layerId}-line`;
    if (!this.map.getLayer(lineId)) return;
    const value = clamp(width, 0.2, 8);
    if (record.config.geometryType === 'point') {
      this.map.setPaintProperty(lineId, 'circle-radius', value);
    } else {
      this.map.setPaintProperty(lineId, 'line-width', value);
    }
    record.strokeWidth = value;
    this.notifyChange();
  }

  setLayerAttributeFilter(layerId, attribute, value) {
    const record = this.layers.get(layerId);
    if (!record || !attribute) return false;
    const filter = value === undefined || value === null || value === ''
      ? null
      : ['==', ['to-string', ['get', attribute]], String(value)];
    for (const layerIdToFilter of record.layerIds || []) {
      if (!this.map.getLayer(layerIdToFilter) || /label|hover|selected/i.test(layerIdToFilter)) continue;
      this.map.setFilter(layerIdToFilter, filter);
    }
    record.attributeFilter = filter ? { attribute, value: String(value) } : null;
    this.notifyChange();
    return true;
  }

  clearLayerFilter(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return false;
    for (const layerIdToFilter of record.layerIds || []) {
      if (!this.map.getLayer(layerIdToFilter) || /label|hover|selected/i.test(layerIdToFilter)) continue;
      this.map.setFilter(layerIdToFilter, null);
    }
    record.attributeFilter = null;
    this.notifyChange();
    return true;
  }

  setLayerLabelsEnabled(layerId, enabled) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.labelsEnabled = Boolean(enabled);
    const visibility = record.labelsEnabled ? 'visible' : 'none';
    for (const labelLayerId of record.labelLayerIds || []) {
      if (this.map.getLayer(labelLayerId)) this.map.setLayoutProperty(labelLayerId, 'visibility', visibility);
    }
    this.notifyChange();
  }

  setLayerTextScale(layerId, scale) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.textScale = clamp(scale, 50, 200);
    for (const labelLayerId of record.labelLayerIds || []) {
      if (this.map.getLayer(labelLayerId)) {
        this.map.setLayoutProperty(labelLayerId, 'text-size', buildLabelTextSizeExpression(record.config, record.textScale));
      }
    }
    this.notifyChange();
  }

  moveLayerOrder(layerId, delta) {
    if (!this.layers.has(layerId) || !delta) return false;
    const entries = [...this.layers.entries()];
    const index = entries.findIndex(([id]) => id === layerId);
    const next = index + delta;
    if (next < 0 || next >= entries.length) return false;
    const [entry] = entries.splice(index, 1);
    entries.splice(next, 0, entry);
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
    writeLayerOrder([...this.layers.keys()]);
    this.notifyChange();
    return true;
  }

  moveLayerBefore(layerId, beforeLayerId) {
    if (!this.layers.has(layerId) || !this.layers.has(beforeLayerId) || layerId === beforeLayerId) return false;
    const entries = [...this.layers.entries()];
    const index = entries.findIndex(([id]) => id === layerId);
    const beforeIndex = entries.findIndex(([id]) => id === beforeLayerId);
    if (index < 0 || beforeIndex < 0) return false;
    const [entry] = entries.splice(index, 1);
    const targetIndex = entries.findIndex(([id]) => id === beforeLayerId);
    entries.splice(targetIndex < 0 ? beforeIndex : targetIndex, 0, entry);
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
    writeLayerOrder([...this.layers.keys()]);
    this.notifyChange();
    return true;
  }

  reorderFromSavedLayerOrder() {
    const order = readLayerOrder();
    if (!order.length || this.layers.size < 2) return;
    const ranked = new Map(order.map((id, index) => [id, index]));
    const entries = [...this.layers.entries()].sort((a, b) => {
      const rankA = ranked.has(a[0]) ? ranked.get(a[0]) : Number.MAX_SAFE_INTEGER;
      const rankB = ranked.has(b[0]) ? ranked.get(b[0]) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    });
    this.layers = new Map(entries);
    this.reapplyLayerOrder();
  }

  reapplyLayerOrder() {
    for (const record of this.layers.values()) {
      for (const id of record.layerIds || []) {
        if (this.map.getLayer(id)) this.map.moveLayer(id);
      }
    }
  }

  applySavedLayerPreferences(layerId) {
    const saved = readLayerPreferences(layerId);
    if (!saved) return;
    if (saved.opacity !== undefined) this.setOpacity(layerId, Number(saved.opacity));
    if (saved.strokeWidth !== undefined) this.setLayerStrokeWidth(layerId, Number(saved.strokeWidth));
    if (saved.color) this.setLayerColor(layerId, saved.color);
    if (saved.fillColor) this.setLayerFillColor(layerId, saved.fillColor);
    if (saved.labelsEnabled !== undefined) this.setLayerLabelsEnabled(layerId, Boolean(saved.labelsEnabled));
    if (saved.textScale !== undefined) this.setLayerTextScale(layerId, Number(saved.textScale));
  }

  selectFeatureById(layerId, featureId, properties = {}) {
    const record = this.layers.get(layerId);
    if (!record || featureId === undefined || featureId === null || record.config.sourceType === 'raster') return false;
    this.clearFeatureState(this.selected, 'selected');
    this.selected = {
      layerId,
      sourceId: record.sourceId,
      sourceLayer: record.config.sourceLayer,
      id: featureId,
      properties
    };
    this.map.setFeatureState({
      source: record.sourceId,
      sourceLayer: record.config.sourceLayer,
      id: featureId
    }, { selected: true });
    this.options.onSelection?.({ layer: record.config, feature: { id: featureId, properties } });
    this.notifyChange();
    return true;
  }

  fitToLayer(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return;
    this.fitToBounds(record.config.bounds);
  }

  fitToBounds(boundsValue) {
    const bounds = boundsToMapLibre(boundsValue);
    if (bounds) this.map.fitBounds(bounds, { padding: 36, duration: 400 });
  }

  buildSource(layer) {
    if (layer.sourceType === 'pmtiles') {
      if (!layer.tileUrl) throw new Error('missing PMTiles URL');
      this.protocol.add(new PMTiles(layer.tileUrl));
      return { type: 'vector', url: `pmtiles://${layer.tileUrl}`, minzoom: layer.minzoom, maxzoom: layer.maxzoom, promoteId: layer.promoteId };
    }
    if (layer.sourceType === 'mvt') {
      if (!layer.tiles) throw new Error('missing vector tile URL template');
      return { type: 'vector', tiles: [absoluteTileTemplate(layer.tiles)], minzoom: layer.minzoom, maxzoom: layer.maxzoom, bounds: boundsToFlatBbox(layer.bounds), promoteId: layer.promoteId };
    }
    if (layer.sourceType === 'raster') {
      if (!layer.tiles && !layer.tileUrl) throw new Error('missing raster tiles URL template');
      return {
        type: 'raster',
        tiles: [absoluteTileTemplate(layer.tiles || layer.tileUrl)],
        tileSize: layer.tileSize || 256,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        bounds: boundsToFlatBbox(layer.bounds)
      };
    }
    if (layer.sourceType === 'image') {
      const coordinates = boundsToImageCoordinates(layer.bounds);
      if (!coordinates) throw new Error('missing image bounds');
      if (!layer.imageUrl && !layer.url) throw new Error('missing image URL');
      return {
        type: 'image',
        url: layer.imageUrl || layer.url,
        coordinates
      };
    }
    throw new Error(`unsupported sourceType ${layer.sourceType}`);
  }

  monitorPmtilesFallback(layer, sourceId) {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      this.map.off('error', onError);
    }, 9000);
    const onError = (event) => {
      if (settled || !this.layers.has(layer.id)) return;
      const message = String(event?.error?.message || event?.error || '');
      const sourceMatches = !event.sourceId || event.sourceId === sourceId;
      const looksLikePmtilesFailure = /pmtiles|byte|range|content-length|fetch|network|failed/i.test(message);
      if (!sourceMatches || !looksLikePmtilesFailure) return;
      settled = true;
      clearTimeout(timer);
      this.map.off('error', onError);
      const metric = {
        layerId: layer.id,
        layerName: layer.name,
        event: 'pmtiles-fallback',
        sourceType: 'pmtiles',
        reason: message.slice(0, 240)
      };
      this.recordMetric(metric);
      const fallbackAvailable = layer.tilesFallback && (!isLocalTestTileTemplate(layer.tilesFallback) || localTestTilesAvailable());
      if (!fallbackAvailable) {
        const unavailableMetric = {
          ...metric,
          event: 'pmtiles-fallback-unavailable',
          fallbackUnavailable: true,
          reason: `${metric.reason}${metric.reason ? ' ' : ''}Directory MVT fallback is not deployed on production Pages.`
        };
        this.recordMetric(unavailableMetric);
        this.fallbackLayers.set(layer.id, unavailableMetric);
        this.options.onFallback?.(unavailableMetric);
        return;
      }
      const fallback = {
        ...layer,
        sourceType: 'mvt',
        tiles: layer.tilesFallback,
        tileUrl: undefined,
        fallbackFromPmtiles: true
      };
      this.unloadLayer(layer.id);
      this.loadLayer(fallback).catch((err) => {
        this.recordMetric({
          layerId: layer.id,
          layerName: layer.name,
          event: 'pmtiles-fallback-failed',
          sourceType: 'mvt',
          reason: String(err.message || err).slice(0, 240)
        });
        this.options.onError?.(err);
      });
      this.fallbackLayers.set(layer.id, metric);
      this.options.onFallback?.(metric);
    };
    this.map.on('error', onError);
    return () => {
      settled = true;
      clearTimeout(timer);
      this.map.off('error', onError);
    };
  }

  bindLayerInteractions(layer, fillId, labelId, sourceId) {
    const idProperty = layer.promoteId || 'id';
    let lastHoverAt = 0;
    let pendingHoverEvent = null;
    let hoverFrame = 0;
    const clearHover = () => {
      this.clearFeatureState(this.hovered, 'hover');
      this.hovered = null;
      this.map.getCanvas().style.cursor = '';
    };
    const readFeatureId = (feature) => {
      const id = feature?.id ?? feature?.properties?.[idProperty];
      return id === undefined || id === null || id === '' ? null : id;
    };
    const setHover = (feature) => {
      const id = readFeatureId(feature);
      if (id === null) {
        clearHover();
        return;
      }
      if (this.hovered?.layerId === layer.id && this.hovered.id === id) return;
      clearHover();
      this.hovered = { layerId: layer.id, sourceId, sourceLayer: layer.sourceLayer, id };
      this.map.setFeatureState({ source: sourceId, sourceLayer: layer.sourceLayer, id }, { hover: true });
      this.map.getCanvas().style.cursor = 'pointer';
    };
    const queryAtPoint = (point, radius = 0) => {
      const queryLayers = [labelId, fillId, `${layer.id}-line`].filter((id) => id && this.map.getLayer(id));
      if (queryLayers.length === 0) return [];
      const geometry = radius > 0 ? [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]] : point;
      return this.map.queryRenderedFeatures(geometry, { layers: queryLayers });
    };
    const runHoverQuery = () => {
      hoverFrame = 0;
      const event = pendingHoverEvent;
      pendingHoverEvent = null;
      if (!event || !this.layers.has(layer.id)) return;
      const sourceLoaded = typeof this.map.isSourceLoaded === 'function' ? this.map.isSourceLoaded(sourceId) : this.map.areTilesLoaded();
      if (this.map.isMoving() || this.map.getZoom() < HOVER_MIN_ZOOM || !sourceLoaded) {
        clearHover();
        return;
      }
      setHover(queryAtPoint(event.point)[0]);
    };
    const onMouseMove = (event) => {
      pendingHoverEvent = event;
      const now = performance.now();
      if (now - lastHoverAt < HOVER_THROTTLE_MS) {
        if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
        return;
      }
      lastHoverAt = now;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
    };
    const onClick = (event) => {
      const feature = queryAtPoint(event.point, CLICK_TOLERANCE_PX)[0];
      if (!feature) return;
      const id = readFeatureId(feature);
      if (id === null) return;
      this.clearFeatureState(this.selected, 'selected');
      this.selected = { layerId: layer.id, sourceId, sourceLayer: layer.sourceLayer, id, properties: feature.properties };
      this.map.setFeatureState({ source: sourceId, sourceLayer: layer.sourceLayer, id }, { selected: true });
      this.options.onSelection?.({ layer, feature });
      this.notifyChange();
    };
    const mapContainer = this.map.getContainer();
    this.map.on('mousemove', onMouseMove);
    this.map.on('click', onClick);
    this.map.on('movestart', clearHover);
    mapContainer.addEventListener('mouseleave', clearHover);
    return () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      this.map.off('mousemove', onMouseMove);
      this.map.off('click', onClick);
      this.map.off('movestart', clearHover);
      mapContainer.removeEventListener('mouseleave', clearHover);
    };
  }

  clearFeatureState(selection, key) {
    if (!selection?.sourceId || selection.id === undefined || selection.id === null) return;
    if (!this.map.getSource(selection.sourceId)) return;
    this.map.setFeatureState({ source: selection.sourceId, sourceLayer: selection.sourceLayer, id: selection.id }, { [key]: false });
  }

  waitForMap() {
    if (this.map.isStyleLoaded?.() || this.map.loaded()) return Promise.resolve();
    return new Promise((resolve) => {
      let timer = 0;
      const done = () => {
        clearTimeout(timer);
        this.map.off('load', done);
        this.map.off('styledata', onStyleData);
        resolve();
      };
      const onStyleData = () => {
        if (this.map.isStyleLoaded?.() || this.map.loaded()) done();
      };
      this.map.once('load', done);
      this.map.on('styledata', onStyleData);
      timer = setTimeout(done, 3000);
    });
  }

  notifyChange() {
    this.options.onChange?.(this);
  }

  recordMetric(metric) {
    this.metrics.push(metric);
    this.options.onMetric?.(metric);
  }
}

function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function readLayerPreferences(layerId) {
  try {
    return JSON.parse(localStorage.getItem(`civgraph:test:controls:${layerId}`) || 'null');
  } catch {
    return null;
  }
}

function readLayerOrder() {
  try {
    return JSON.parse(localStorage.getItem('civgraph:test:layer-order') || '[]');
  } catch {
    return [];
  }
}

function writeLayerOrder(order) {
  try {
    localStorage.setItem('civgraph:test:layer-order', JSON.stringify(order));
  } catch {}
}
