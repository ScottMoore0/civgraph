import maplibregl from 'maplibre-gl';
import { PMTiles, Protocol } from 'pmtiles';
import {
  CLICK_TOLERANCE_PX,
  DEFAULT_TEXT_SCALE,
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
  getFeatureLabel,
  getLabelMaxZoom,
  getLabelMinZoom,
  getLabelStyle
} from './labels.js';
import { repairFeatureProperties } from './feature-property-repairs.js';
import { absoluteTileTemplate, boundsToFlatBbox, boundsToImageCoordinates, boundsToMapLibre, clamp } from './utils.js';

const INTERACTION_FILL_COLOR = '#FDBA74';
const INTERACTION_STROKE_COLOR = '#FF7A1A';
const DEFAULT_VECTOR_FILL_OPACITY = 0;
const EMPTY_FEATURE_COLLECTION = Object.freeze({
  type: 'FeatureCollection',
  features: []
});

function isLocalTestTileTemplate(value) {
  return typeof value === 'string' && value.startsWith('/test/tiles/');
}

function localTestTilesAvailable() {
  const hostname = globalThis.location?.hostname || '';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveFillOpacity(layer) {
  return clamp(layer?.style?.fillOpacity ?? DEFAULT_VECTOR_FILL_OPACITY, 0, 1);
}

function resolveLayerOpacity(layer) {
  if (layer?.sourceType === 'raster' || layer?.sourceType === 'image') {
    return clamp(layer.rasterOpacity ?? layer.style?.opacity ?? 0.85, 0, 1);
  }
  return resolveFillOpacity(layer);
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
    const hoverLineId = `${layer.id}-hover-line`;
    const selectedFillId = `${layer.id}-selected-fill`;
    const selectedId = `${layer.id}-selected`;
    const labelId = `${layer.id}-label`;

    await this.waitForMap();

    const source = this.buildSource(layer);
    this.map.addSource(sourceId, source);
    let interactionOverlayIds = { layerIds: [], sourceIds: [] };
    if (layer.sourceType === 'raster' || layer.sourceType === 'image') {
      this.addRasterLayer(layer, { sourceId, rasterId });
    } else {
      this.addGeometryLayers(layer, { sourceId, fillId, lineId, hoverId, selectedFillId, selectedId });
      interactionOverlayIds = this.addInteractionOverlayLayers(layer);
    }
    const labelLayerIds = this.addLabelLayers(layer, { sourceId, labelId });

    this.layers.set(layer.id, {
      config: layer,
      sourceId,
      sourceIds: [sourceId, ...interactionOverlayIds.sourceIds],
      layerIds: [
        fillId,
        lineId,
        hoverId,
        hoverLineId,
        selectedFillId,
        selectedId,
        ...interactionOverlayIds.layerIds,
        labelId,
        rasterId
      ].filter((id) => this.map.getLayer(id)),
      labelLayerIds,
      domLabelMarkers: new Map(),
      domLabelsScheduled: 0,
      labelsEnabled: true,
      textScale: DEFAULT_TEXT_SCALE,
      opacity: resolveLayerOpacity(layer),
      color: layer.style?.color || '#5B21B6',
      fillColor: layer.style?.fillColor || layer.style?.color || '#7C3AED'
    });
    this.applySavedLayerPreferences(layer.id);

    if (layer.sourceType !== 'raster' && layer.sourceType !== 'image') {
      this.interactionCleanups.set(layer.id, this.bindLayerInteractions(layer, fillId, labelId, sourceId));
      this.scheduleDomLabelRefresh(layer.id);
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
    const { sourceId, fillId, lineId, hoverId, selectedFillId, selectedId } = ids;
    const hoverLineId = `${layer.id}-hover-line`;
    if (layer.geometryType !== 'line' && layer.geometryType !== 'point') {
      this.map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': layer.style?.fillColor || layer.style?.color || '#7C3AED',
          'fill-opacity': resolveFillOpacity(layer)
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

    if (layer.geometryType === 'point') {
      this.map.addLayer({
        id: hoverId,
        type: 'circle',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
          'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 7, 0],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });
    } else if (layer.geometryType === 'line') {
      this.map.addLayer({
        id: hoverId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': INTERACTION_STROKE_COLOR,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });
    } else {
      this.map.addLayer({
        id: hoverId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.42, 0]
        }
      });
      this.map.addLayer({
        id: hoverLineId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': INTERACTION_STROKE_COLOR,
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });
    }

    if (layer.geometryType === 'point') {
      this.map.addLayer({
        id: selectedId,
        type: 'circle',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 0],
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, 0],
          'circle-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
        }
      });
      return;
    }

    if (layer.geometryType !== 'line') {
      this.map.addLayer({
        id: selectedFillId,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.42, 0]
        }
      });
    }
    this.map.addLayer({
      id: selectedId,
      type: 'line',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: {
        'line-color': INTERACTION_STROKE_COLOR,
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, 0],
        'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
      }
    });
  }

  addInteractionOverlayLayers(layer) {
    const hoverSourceId = `${layer.id}-fallback-hover-source`;
    const selectedSourceId = `${layer.id}-fallback-selected-source`;
    this.map.addSource(hoverSourceId, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
    this.map.addSource(selectedSourceId, { type: 'geojson', data: EMPTY_FEATURE_COLLECTION });
    const layerIds = [];
    const sourceIds = [hoverSourceId, selectedSourceId];
    const addPointLayer = (id, source, radius) => {
      this.map.addLayer({
        id,
        type: 'circle',
        source,
        paint: {
          'circle-color': INTERACTION_FILL_COLOR,
          'circle-stroke-color': INTERACTION_STROKE_COLOR,
          'circle-stroke-width': 2.5,
          'circle-radius': radius,
          'circle-opacity': 0.95
        }
      });
      layerIds.push(id);
    };
    const addLineLayer = (id, source, width = 3) => {
      this.map.addLayer({
        id,
        type: 'line',
        source,
        paint: {
          'line-color': INTERACTION_STROKE_COLOR,
          'line-width': width,
          'line-opacity': 0.95
        }
      });
      layerIds.push(id);
    };
    const addFillLayer = (id, source) => {
      this.map.addLayer({
        id,
        type: 'fill',
        source,
        paint: {
          'fill-color': INTERACTION_FILL_COLOR,
          'fill-opacity': 0.42
        }
      });
      layerIds.push(id);
    };

    if (layer.geometryType === 'point') {
      addPointLayer(`${layer.id}-fallback-hover`, hoverSourceId, 7);
      addPointLayer(`${layer.id}-fallback-selected`, selectedSourceId, 8);
    } else if (layer.geometryType === 'line') {
      addLineLayer(`${layer.id}-fallback-hover`, hoverSourceId, 3);
      addLineLayer(`${layer.id}-fallback-selected`, selectedSourceId, 3);
    } else {
      addFillLayer(`${layer.id}-fallback-hover-fill`, hoverSourceId);
      addLineLayer(`${layer.id}-fallback-hover`, hoverSourceId, 3);
      addFillLayer(`${layer.id}-fallback-selected-fill`, selectedSourceId);
      addLineLayer(`${layer.id}-fallback-selected`, selectedSourceId, 3);
    }
    return { layerIds, sourceIds };
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
        'text-opacity': 0
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
    this.clearDomLabels(layerId);
    for (const layerIdToRemove of [...record.layerIds].reverse()) {
      if (this.map.getLayer(layerIdToRemove)) this.map.removeLayer(layerIdToRemove);
    }
    for (const sourceId of [...(record.sourceIds || []), record.sourceId]) {
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    }
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
    for (const marker of record.domLabelMarkers?.values?.() || []) {
      marker.getElement().hidden = !record.labelsEnabled;
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
    this.scheduleDomLabelRefresh(layerId);
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
    this.setDomLabelSelected(this.selected?.layerId, this.selected?.id, false);
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
    this.setDomLabelSelected(layerId, featureId, true);
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
    let lastHoverAt = 0;
    let pendingHoverEvent = null;
    let hoverFrame = 0;
    const clearHover = () => this.clearHover();
    const queryAtPoint = (point, radius = 0) => {
      const queryLayers = [fillId, `${layer.id}-line`].filter((id) => id && this.map.getLayer(id));
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
      if (this.map.isMoving() || !sourceLoaded) {
        clearHover();
        return;
      }
      this.setHover(layer, queryAtPoint(event.point)[0]);
    };
    const onMouseMove = (event) => {
      const original = event.originalEvent;
      if (original && document.elementFromPoint(original.clientX, original.clientY)?.closest?.('.maplibre-dom-label')) {
        return;
      }
      pendingHoverEvent = event;
      const now = performance.now();
      if (now - lastHoverAt < HOVER_THROTTLE_MS) {
        if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
        return;
      }
      lastHoverAt = now;
      if (!hoverFrame) hoverFrame = requestAnimationFrame(runHoverQuery);
    };
    const onContainerPointerMove = (event) => {
      const labelElement = event.target?.closest?.('.maplibre-dom-label')
        || document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.maplibre-dom-label');
      if (labelElement?.dataset?.layerId !== layer.id) return;
      const feature = labelElement.__civgraphFeature;
      if (feature) this.setHover(layer, feature);
    };
    const onDoubleClick = (event) => {
      event.preventDefault?.();
      const feature = queryAtPoint(event.point, CLICK_TOLERANCE_PX)[0];
      if (feature) this.selectFeature(layer, feature);
    };
    const onUpdateLabels = () => this.scheduleDomLabelRefresh(layer.id);
    const mapContainer = this.map.getContainer();
    this.map.on('mousemove', onMouseMove);
    this.map.on('dblclick', onDoubleClick);
    this.map.on('movestart', clearHover);
    this.map.on('moveend', onUpdateLabels);
    this.map.on('zoomend', onUpdateLabels);
    this.map.on('idle', onUpdateLabels);
    mapContainer.addEventListener('pointermove', onContainerPointerMove, true);
    mapContainer.addEventListener('mouseleave', clearHover);
    return () => {
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      this.map.off('mousemove', onMouseMove);
      this.map.off('dblclick', onDoubleClick);
      this.map.off('movestart', clearHover);
      this.map.off('moveend', onUpdateLabels);
      this.map.off('zoomend', onUpdateLabels);
      this.map.off('idle', onUpdateLabels);
      mapContainer.removeEventListener('pointermove', onContainerPointerMove, true);
      mapContainer.removeEventListener('mouseleave', clearHover);
    };
  }

  readFeatureId(layer, feature) {
    return this.readFeatureIdentity(layer, feature).id;
  }

  readFeatureIdentity(layer, feature) {
    const idProperty = layer?.promoteId || 'id';
    const id = feature?.id ?? feature?.properties?.[idProperty] ?? feature?.properties?.id;
    if (id !== undefined && id !== null && id !== '') return { id, generated: false };
    const generated = generatedFeatureId(layer, feature);
    return generated ? { id: generated, generated: true } : { id: null, generated: true };
  }

  clearHover() {
    const previous = this.hovered;
    this.clearFeatureState(previous, 'hover');
    this.setDomLabelHover(previous?.layerId, previous?.id, false);
    this.hovered = null;
    if (this.map?.getCanvas) this.map.getCanvas().style.cursor = '';
  }

  setHover(layer, feature) {
    const { id, generated } = this.readFeatureIdentity(layer, feature);
    if (id === null) {
      this.clearHover();
      return;
    }
    if (this.hovered?.layerId === layer.id && this.hovered.id === id) return;
    this.clearHover();
    const record = this.layers.get(layer.id);
    this.hovered = {
      layerId: layer.id,
      sourceId: record?.sourceId,
      sourceLayer: layer.sourceLayer,
      id,
      generated
    };
    this.setDomLabelHover(layer.id, id, true);
    if (!generated) {
      try {
        this.map.setFeatureState({ source: record.sourceId, sourceLayer: layer.sourceLayer, id }, { hover: true });
      } catch {}
    }
    this.setInteractionOverlay(layer.id, 'hover', feature);
    this.map.getCanvas().style.cursor = 'pointer';
  }

  selectFeature(layer, feature) {
    const { id, generated } = this.readFeatureIdentity(layer, feature);
    if (id === null) return false;
    const record = this.layers.get(layer.id);
    if (!record) return false;
    this.setDomLabelSelected(this.selected?.layerId, this.selected?.id, false);
    this.clearFeatureState(this.selected, 'selected');
    const normalizedFeature = {
      ...feature,
      id,
      properties: repairFeatureProperties(layer, feature.properties || {}),
      geometry: feature.geometry || null
    };
    this.selected = {
      layerId: layer.id,
      sourceId: record.sourceId,
      sourceLayer: layer.sourceLayer,
      id,
      generated,
      properties: normalizedFeature.properties
    };
    if (!generated) {
      try {
        this.map.setFeatureState({ source: record.sourceId, sourceLayer: layer.sourceLayer, id }, { selected: true });
      } catch {}
    }
    this.setInteractionOverlay(layer.id, 'selected', normalizedFeature);
    this.setDomLabelSelected(layer.id, id, true);
    this.options.onSelection?.({ layer, feature: normalizedFeature });
    this.notifyChange();
    return true;
  }

  setInteractionOverlay(layerId, state, feature) {
    const record = this.layers.get(layerId);
    const sourceId = `${layerId}-fallback-${state}-source`;
    const source = record && this.map.getSource(sourceId);
    if (!source?.setData) return;
    const geometry = cloneGeometry(feature?.geometry);
    if (!geometry) {
      source.setData(EMPTY_FEATURE_COLLECTION);
      return;
    }
    source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry,
        properties: { ...(feature.properties || {}) }
      }]
    });
  }

  clearInteractionOverlay(layerId, state) {
    const source = layerId ? this.map.getSource(`${layerId}-fallback-${state}-source`) : null;
    if (source?.setData) source.setData(EMPTY_FEATURE_COLLECTION);
  }

  scheduleDomLabelRefresh(layerId) {
    const record = this.layers.get(layerId);
    if (!record || !record.config?.labelProperty || record.config.sourceType === 'raster' || record.config.sourceType === 'image') return;
    if (record.domLabelsScheduled) return;
    record.domLabelsScheduled = requestAnimationFrame(() => {
      record.domLabelsScheduled = 0;
      this.refreshDomLabels(layerId);
    });
  }

  refreshDomLabels(layerId) {
    const record = this.layers.get(layerId);
    if (!record || !record.config?.labelProperty) return;
    const layer = record.config;
    const queryLayers = [`${layerId}-fill`, `${layerId}-line`].filter((id) => this.map.getLayer(id));
    if (!queryLayers.length || !record.labelsEnabled || this.map.getZoom() < getLabelMinZoom(layer)) {
      this.clearDomLabels(layerId);
      return;
    }
    const features = this.map.queryRenderedFeatures({ layers: queryLayers });
    const nextKeys = new Set();
    const labelBoxes = [];
    for (const feature of features) {
      const id = this.readFeatureId(layer, feature);
      if (id === null) continue;
      const label = getFeatureLabel(layer, feature.properties);
      if (!label) continue;
      const lngLat = featureLabelLngLat(feature);
      if (!lngLat) continue;
      const key = String(id);
      if (nextKeys.has(key)) continue;
      const point = this.map.project(lngLat);
      const box = labelCollisionBox(point, label);
      if (labelBoxes.some((existing) => boxesOverlap(existing, box))) continue;
      labelBoxes.push(box);
      nextKeys.add(key);
      let marker = record.domLabelMarkers.get(key);
      if (!marker) {
        marker = this.createDomLabelMarker(layer, feature, id, label);
        record.domLabelMarkers.set(key, marker);
      }
      const element = marker.getElement();
      element.__civgraphFeature = feature;
      element.querySelector('div').textContent = label;
      element.classList.toggle('map-label--selected', this.selected?.layerId === layerId && String(this.selected.id) === key);
      element.hidden = !record.labelsEnabled;
      marker.setLngLat(lngLat);
      if (!element.isConnected) marker.addTo(this.map);
    }
    for (const [key, marker] of record.domLabelMarkers) {
      if (!nextKeys.has(key)) {
        marker.remove();
        record.domLabelMarkers.delete(key);
      }
    }
  }

  createDomLabelMarker(layer, feature, id, label) {
    const labelStyle = getLabelStyle(layer);
    const element = document.createElement('span');
    element.className = 'map-label map-label--clickable maplibre-dom-label';
    element.dataset.layerId = layer.id;
    element.dataset.featureId = String(id);
    element.__civgraphFeature = feature;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `Show details for ${label}`);
    const text = document.createElement('div');
    text.textContent = label;
    text.style.color = labelStyle.color;
    text.style.fontSize = `${buildLabelTextSizeExpression(layer, this.layers.get(layer.id)?.textScale || DEFAULT_TEXT_SCALE)}px`;
    element.appendChild(text);
    const select = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.selectFeature(layer, element.__civgraphFeature || feature);
    };
    element.addEventListener('click', select);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') select(event);
    });
    const hover = () => this.setHover(layer, element.__civgraphFeature || feature);
    element.addEventListener('mouseenter', hover);
    element.addEventListener('mouseover', hover);
    element.addEventListener('pointerenter', hover);
    element.addEventListener('mouseleave', () => this.clearHover());
    element.addEventListener('pointerleave', () => this.clearHover());
    return new maplibregl.Marker({ element, anchor: 'center' });
  }

  clearDomLabels(layerId) {
    const record = this.layers.get(layerId);
    if (!record?.domLabelMarkers) return;
    if (record.domLabelsScheduled) {
      cancelAnimationFrame(record.domLabelsScheduled);
      record.domLabelsScheduled = 0;
    }
    for (const marker of record.domLabelMarkers.values()) marker.remove();
    record.domLabelMarkers.clear();
  }

  setDomLabelHover(layerId, featureId, isHover) {
    const marker = this.layers.get(layerId)?.domLabelMarkers?.get(String(featureId));
    marker?.getElement().classList.toggle('map-label--hover', Boolean(isHover));
  }

  setDomLabelSelected(layerId, featureId, isSelected) {
    const marker = this.layers.get(layerId)?.domLabelMarkers?.get(String(featureId));
    marker?.getElement().classList.toggle('map-label--selected', Boolean(isSelected));
  }

  clearFeatureState(selection, key) {
    if (selection?.layerId) this.clearInteractionOverlay(selection.layerId, key);
    if (!selection?.sourceId || selection.id === undefined || selection.id === null) return;
    if (!this.map.getSource(selection.sourceId)) return;
    if (selection.generated) return;
    try {
      this.map.setFeatureState({ source: selection.sourceId, sourceLayer: selection.sourceLayer, id: selection.id }, { [key]: false });
    } catch {}
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

function featureLabelLngLat(feature) {
  const props = feature?.properties || {};
  const explicitLon = Number(props.label_lon ?? props.label_lng ?? props.lon ?? props.lng ?? props.longitude);
  const explicitLat = Number(props.label_lat ?? props.lat ?? props.latitude);
  if (Number.isFinite(explicitLon) && Number.isFinite(explicitLat)) return [explicitLon, explicitLat];
  const points = [];
  collectCoordinatePairs(feature?.geometry?.coordinates, points);
  if (!points.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function labelCollisionBox(point, label) {
  const width = Math.min(Math.max(String(label).length * 7.5, 34), 150);
  const height = Math.max(16, Math.ceil(String(label).length / 18) * 15);
  const padding = 4;
  return {
    left: point.x - width / 2 - padding,
    right: point.x + width / 2 + padding,
    top: point.y - height / 2 - padding,
    bottom: point.y + height / 2 + padding
  };
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function collectCoordinatePairs(value, out) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    out.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collectCoordinatePairs(item, out);
}

function generatedFeatureId(layer, feature) {
  const properties = feature?.properties || {};
  const label = getFeatureLabel(layer, properties) || '';
  const geometryKey = geometrySignature(feature?.geometry);
  const propertyKey = stablePropertySignature(properties, layer);
  const key = [label, propertyKey, geometryKey].filter(Boolean).join('|');
  return key ? `generated:${hashString(key)}` : null;
}

function geometrySignature(geometry) {
  const points = [];
  collectCoordinatePairs(geometry?.coordinates, points);
  if (!points.length) return '';
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return '';
  const first = points[0] || [];
  const middle = points[Math.floor(points.length / 2)] || [];
  const last = points[points.length - 1] || [];
  return [
    geometry?.type || 'Geometry',
    points.length,
    roundCoord(minLng),
    roundCoord(minLat),
    roundCoord(maxLng),
    roundCoord(maxLat),
    roundCoord(first[0]),
    roundCoord(first[1]),
    roundCoord(middle[0]),
    roundCoord(middle[1]),
    roundCoord(last[0]),
    roundCoord(last[1])
  ].join(':');
}

function stablePropertySignature(properties, layer) {
  const keys = [
    layer?.labelProperty,
    ...(layer?.labelPropertyFallbacks || []),
    ...(layer?.popupProperties || []),
    'name',
    'Name',
    'NAME'
  ].filter(Boolean);
  return [...new Set(keys)]
    .slice(0, 8)
    .map((key) => {
      const value = properties?.[key];
      return value === undefined || value === null ? '' : `${key}=${String(value).slice(0, 80)}`;
    })
    .filter(Boolean)
    .join(';');
}

function roundCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : '';
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cloneGeometry(geometry) {
  if (!geometry?.type || !geometry.coordinates) return null;
  return JSON.parse(JSON.stringify({
    type: geometry.type,
    coordinates: geometry.coordinates
  }));
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
