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
import { absoluteTileTemplate, boundsToFlatBbox, boundsToMapLibre, clamp } from './utils.js';

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
    this.interactionCleanups = new Map();
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
    if (this.layers.has(layer.id)) {
      this.fitToLayer(layer.id);
      return;
    }

    const started = performance.now();
    const sourceId = `${layer.id}-source`;
    const fillId = `${layer.id}-fill`;
    const lineId = `${layer.id}-line`;
    const hoverId = `${layer.id}-hover`;
    const selectedId = `${layer.id}-selected`;
    const labelId = `${layer.id}-label`;

    await this.waitForMap();

    const source = this.buildSource(layer);
    this.map.addSource(sourceId, source);
    this.addGeometryLayers(layer, { sourceId, fillId, lineId, hoverId, selectedId });
    const labelLayerIds = this.addLabelLayers(layer, { sourceId, labelId });

    this.layers.set(layer.id, {
      config: layer,
      sourceId,
      layerIds: [fillId, lineId, hoverId, selectedId, labelId].filter((id) => this.map.getLayer(id)),
      labelLayerIds,
      labelsEnabled: true,
      textScale: DEFAULT_TEXT_SCALE
    });

    this.interactionCleanups.set(layer.id, this.bindLayerInteractions(layer, fillId, labelId, sourceId));
    this.fitToLayer(layer.id);
    this.metrics.push({
      layerId: layer.id,
      event: 'load',
      durationMs: Math.round(performance.now() - started),
      sourceType: layer.sourceType
    });
    this.notifyChange();
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
    const fillId = `${layerId}-fill`;
    const lineId = `${layerId}-line`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', clamp(opacity, 0, 1));
    if (this.map.getLayer(lineId)) {
      const property = record.config.geometryType === 'point' ? 'circle-opacity' : 'line-opacity';
      this.map.setPaintProperty(lineId, property, clamp(opacity + 0.35, 0, 1));
    }
    this.notifyChange();
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

  fitToLayer(layerId) {
    const record = this.layers.get(layerId);
    if (!record) return;
    const bounds = boundsToMapLibre(record.config.bounds);
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
    throw new Error(`unsupported sourceType ${layer.sourceType}`);
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
    if (this.map.loaded()) return Promise.resolve();
    return new Promise((resolve) => this.map.once('load', resolve));
  }

  notifyChange() {
    this.options.onChange?.(this);
  }
}
