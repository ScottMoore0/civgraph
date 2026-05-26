import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import './styles.css';

const TEST_ASSET_VERSION = 'test-004';
const METADATA_URL = `/test/metadata/maps-test.json?v=${TEST_ASSET_VERSION}`;
const IRELAND_BOUNDS = [[-10.75, 51.35], [-5.35, 55.55]];
const HOVER_MIN_ZOOM = 7;
const HOVER_THROTTLE_MS = 80;
const CLICK_TOLERANCE_PX = 6;
const DEFAULT_TEXT_SCALE = 100;
const DEFAULT_LABEL_MIN_ZOOM = 9;

const els = {
  catalogue: document.getElementById('catalogue'),
  activeLayers: document.getElementById('activeLayers'),
  diagnostics: document.getElementById('diagnostics'),
  featureDetails: document.getElementById('featureDetails'),
  mapSearch: document.getElementById('mapSearch'),
  toast: document.getElementById('toast')
};

class TestMapLibreController {
  constructor(container) {
    this.container = container;
    this.map = null;
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
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm'
          }
        ]
      },
      center: [-8.05, 53.4],
      zoom: 5.8,
      minZoom: 4,
      maxZoom: 16,
      attributionControl: true
    });

    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
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

    try {
      const source = this.buildSource(layer);
      this.map.addSource(sourceId, source);

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

      this.map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': layer.style?.color || '#5B21B6',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            Math.max(0.4, Number(layer.style?.weight || 1) * 0.55),
            12,
            Math.max(0.8, Number(layer.style?.weight || 1) * 1.4)
          ],
          'line-opacity': 0.88
        }
      });

      this.map.addLayer({
        id: hoverId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': '#F59E0B',
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
      });

      this.map.addLayer({
        id: selectedId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': '#111827',
          'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 0],
          'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.95, 0]
        }
      });

      const labelLayerIds = [];
      if (layer.labelProperty) {
        const labelMinZoom = getLabelMinZoom(layer);
        const labelStyle = getLabelStyle(layer);
        this.map.addLayer({
          id: labelId,
          type: 'symbol',
          source: sourceId,
          'source-layer': layer.sourceLayer,
          minzoom: labelMinZoom,
          maxzoom: Number.isFinite(Number(layer.labelMaxZoom)) ? Number(layer.labelMaxZoom) : undefined,
          filter: buildLabelFilter(layer),
          layout: {
            'text-field': buildLabelTextExpression(layer),
            'text-size': buildLabelTextSizeExpression(layer, DEFAULT_TEXT_SCALE),
            'text-font': buildLabelFontStack(labelStyle),
            'text-max-width': labelStyle.maxWidth,
            'text-line-height': labelStyle.lineHeight,
            'text-justify': 'center',
            'text-padding': 2,
            'text-allow-overlap': false,
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
        labelLayerIds.push(labelId);
      }

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
      emitDiagnostics(this);
    } catch (err) {
      showToast(`Could not load ${layer.name}: ${err.message}`);
      throw err;
    }
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
      renderFeatureDetails(null);
    }
    emitDiagnostics(this);
  }

  setOpacity(layerId, opacity) {
    const record = this.layers.get(layerId);
    if (!record) return;
    const fillId = `${layerId}-fill`;
    const lineId = `${layerId}-line`;
    if (this.map.getLayer(fillId)) this.map.setPaintProperty(fillId, 'fill-opacity', clamp(opacity, 0, 1));
    if (this.map.getLayer(lineId)) this.map.setPaintProperty(lineId, 'line-opacity', clamp(opacity + 0.35, 0, 1));
  }

  setLayerLabelsEnabled(layerId, enabled) {
    const record = this.layers.get(layerId);
    if (!record) return;
    record.labelsEnabled = Boolean(enabled);
    const visibility = record.labelsEnabled ? 'visible' : 'none';
    for (const labelLayerId of record.labelLayerIds || []) {
      if (this.map.getLayer(labelLayerId)) this.map.setLayoutProperty(labelLayerId, 'visibility', visibility);
    }
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
      return {
        type: 'vector',
        url: `pmtiles://${layer.tileUrl}`,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        promoteId: layer.promoteId
      };
    }

    if (layer.sourceType === 'mvt') {
      if (!layer.tiles) throw new Error('missing vector tile URL template');
      return {
        type: 'vector',
        tiles: [absoluteTileTemplate(layer.tiles)],
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        bounds: boundsToFlatBbox(layer.bounds),
        promoteId: layer.promoteId
      };
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
      const queryLayers = [labelId, fillId].filter((id) => id && this.map.getLayer(id));
      if (queryLayers.length === 0) return [];
      const geometry = radius > 0
        ? [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]]
        : point;
      return this.map.queryRenderedFeatures(geometry, { layers: queryLayers });
    };

    const runHoverQuery = () => {
      hoverFrame = 0;
      const event = pendingHoverEvent;
      pendingHoverEvent = null;
      if (!event || !this.layers.has(layer.id)) return;
      const sourceLoaded = typeof this.map.isSourceLoaded === 'function'
        ? this.map.isSourceLoaded(sourceId)
        : this.map.areTilesLoaded();
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
      renderFeatureDetails({ layer, feature });
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
    this.map.setFeatureState(
      { source: selection.sourceId, sourceLayer: selection.sourceLayer, id: selection.id },
      { [key]: false }
    );
  }

  waitForMap() {
    if (this.map.loaded()) return Promise.resolve();
    return new Promise((resolve) => this.map.once('load', resolve));
  }
}

class TestCatalogue {
  constructor(controller) {
    this.controller = controller;
    this.layers = [];
    this.filteredLayers = [];
  }

  async init() {
    const response = await fetch(METADATA_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`failed to load ${METADATA_URL}: ${response.status}`);
    const metadata = await response.json();
    this.layers = metadata.layers || [];
    this.filteredLayers = this.layers;
    this.render();
    els.mapSearch.addEventListener('input', () => this.filter(els.mapSearch.value));
  }

  filter(query) {
    const normalized = query.trim().toLowerCase();
    this.filteredLayers = normalized
      ? this.layers.filter((layer) => `${layer.name} ${layer.category} ${layer.sourceMapId}`.toLowerCase().includes(normalized))
      : this.layers;
    this.render();
  }

  render() {
    els.catalogue.innerHTML = '';
    if (this.filteredLayers.length === 0) {
      els.catalogue.textContent = 'No test layers match that search.';
      return;
    }

    for (const layer of this.filteredLayers) {
      const card = document.createElement('article');
      card.className = 'catalogue-card';
      card.dataset.layerId = layer.id;
      card.innerHTML = `
        <div class="catalogue-card__main">
          <div>
            <p>${escapeHtml(layer.category || 'Map')}</p>
            <h3>${escapeHtml(layer.name)}</h3>
          </div>
          <span>${escapeHtml(layer.sourceType)}</span>
        </div>
        <p class="catalogue-card__notes">${escapeHtml(layer.notes || '')}</p>
        <div class="catalogue-card__actions">
          <button type="button" data-action="load">Load</button>
          <button type="button" data-action="fit">Fit</button>
          <button type="button" data-action="unload">Unload</button>
        </div>
      `;
      card.addEventListener('click', async (event) => {
        const action = event.target?.dataset?.action;
        if (!action) return;
        try {
          if (action === 'load') await this.controller.loadLayer(layer);
          if (action === 'fit') this.controller.fitToLayer(layer.id);
          if (action === 'unload') this.controller.unloadLayer(layer.id);
          renderActiveLayers(this.controller, this);
        } catch (err) {
          console.error(err);
        }
      });
      els.catalogue.appendChild(card);
    }
  }
}

function renderActiveLayers(controller, catalogue) {
  if (controller.layers.size === 0) {
    els.activeLayers.textContent = 'No active layers.';
    emitDiagnostics(controller);
    return;
  }

  els.activeLayers.innerHTML = '';
  for (const [id, record] of controller.layers) {
    const row = document.createElement('div');
    const hasLabels = (record.labelLayerIds || []).length > 0;
    row.className = 'active-layer';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(record.config.name)}</strong>
        <span>${escapeHtml(record.config.sourceType)} &middot; z${record.config.minzoom}-${record.config.maxzoom}</span>
      </div>
      <label>
        Opacity
        <input data-control="opacity" type="range" min="0" max="1" step="0.05" value="${record.config.style?.fillOpacity ?? 0.18}">
      </label>
      ${hasLabels ? `
        <label class="active-layer__check">
          <input data-control="labels" type="checkbox" ${record.labelsEnabled ? 'checked' : ''}>
          <span>Labels</span>
        </label>
        <label>
          Text
          <input data-control="text-scale" type="range" min="50" max="200" step="10" value="${record.textScale || DEFAULT_TEXT_SCALE}">
        </label>
      ` : ''}
    `;
    row.querySelector('[data-control="opacity"]').addEventListener('input', (event) => {
      controller.setOpacity(id, Number(event.target.value));
    });
    row.querySelector('[data-control="labels"]')?.addEventListener('change', (event) => {
      controller.setLayerLabelsEnabled(id, event.target.checked);
    });
    row.querySelector('[data-control="text-scale"]')?.addEventListener('input', (event) => {
      controller.setLayerTextScale(id, Number(event.target.value));
    });
    els.activeLayers.appendChild(row);
  }
  catalogue.render();
  emitDiagnostics(controller);
}

function renderFeatureDetails(selection) {
  if (!selection) {
    els.featureDetails.textContent = 'Click a rendered feature.';
    return;
  }

  const { layer, feature } = selection;
  const props = feature.properties || {};
  const rows = (layer.popupProperties || Object.keys(props)).map((key) => {
    const value = props[key];
    return `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd>`;
  }).join('');

  els.featureDetails.innerHTML = `
    <h3>${escapeHtml(getFeatureLabel(layer, props) || layer.name)}</h3>
    <dl>${rows}</dl>
  `;
}

function emitDiagnostics(controller) {
  const data = {
    renderer: 'maplibre-gl',
    assetVersion: TEST_ASSET_VERSION,
    maplibreVersion: maplibregl.version,
    loadedLayers: [...controller.layers.keys()],
    zoom: controller.map ? Number(controller.map.getZoom().toFixed(3)) : null,
    center: controller.map ? controller.map.getCenter().toArray().map((value) => Number(value.toFixed(5))) : null,
    metrics: controller.metrics.slice(-8)
  };
  els.diagnostics.textContent = JSON.stringify(data, null, 2);
}

function getLabelMinZoom(layer) {
  const value = Number(layer.labelMinZoom);
  return Number.isFinite(value) ? value : DEFAULT_LABEL_MIN_ZOOM;
}

function getLabelStyle(layer) {
  const style = layer.labelStyle || {};
  const baseColor = resolveLabelColor(layer, style.color || layer.labelTextColor || 'layer');
  return {
    color: baseColor,
    hoverColor: resolveLabelColor(layer, style.hoverColor || '#ff7a1a'),
    selectedColor: resolveLabelColor(layer, style.selectedColor || '#111827'),
    haloColor: resolveLabelColor(layer, style.haloColor || '#ffffff'),
    haloWidth: clamp(style.haloWidth ?? 1.4, 0, 4),
    haloBlur: clamp(style.haloBlur ?? 0, 0, 2),
    fontSize: clamp(style.fontSize ?? 12, 6, 32),
    fontWeight: style.fontWeight === 'regular' ? 'regular' : 'bold',
    maxWidth: clamp(style.maxWidth ?? 14, 4, 30),
    lineHeight: clamp(style.lineHeight ?? 1.25, 0.8, 2)
  };
}

function resolveLabelColor(layer, value) {
  if (value === 'layer') return layer.style?.color || '#3388ff';
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '#3388ff';
}

function buildLabelColorExpression(layer) {
  const style = getLabelStyle(layer);
  return [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    style.selectedColor,
    ['boolean', ['feature-state', 'hover'], false],
    style.hoverColor,
    style.color
  ];
}

function buildLabelFontStack(labelStyle) {
  return labelStyle.fontWeight === 'bold'
    ? ['Open Sans Bold', 'Arial Unicode MS Bold']
    : ['Open Sans Regular', 'Arial Unicode MS Regular'];
}

function getLabelProperties(layer) {
  const props = [
    layer.labelCanonicalProperty || 'label_name',
    layer.labelProperty,
    ...(Array.isArray(layer.labelPropertyFallbacks) ? layer.labelPropertyFallbacks : [])
  ].filter(Boolean);
  return [...new Set(props)];
}

function buildLabelTextExpression(layer) {
  const props = getLabelProperties(layer);
  if (props.length === 0) return '';
  return ['coalesce', ...props.map((prop) => ['get', prop]), ''];
}

function buildLabelFilter(layer) {
  const props = getLabelProperties(layer);
  const hasAnyLabel = props.length > 0 ? ['any', ...props.map((prop) => ['has', prop])] : true;
  return [
    'all',
    hasAnyLabel,
    ['<=', ['to-number', ['get', layer.labelMinZoomProperty || 'label_minzoom'], getLabelMinZoom(layer)], ['zoom']]
  ];
}

function buildLabelTextSizeExpression(layer, scale) {
  const style = getLabelStyle(layer);
  const multiplier = clamp(scale, 50, 200) / 100;
  return style.fontSize * multiplier;
}

function buildLabelSortExpression(layer) {
  return ['*', -1, ['to-number', ['get', layer.labelRankProperty || 'label_rank'], 0]];
}

function getFeatureLabel(layer, props) {
  for (const prop of getLabelProperties(layer)) {
    const value = cleanLabelValue(props?.[prop], layer.labelCleanup);
    if (value) return value;
  }
  return '';
}

function cleanLabelValue(value, cleanupRule) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (cleanupRule === 'stripTrailingBracketNumber') return text.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (cleanupRule && typeof cleanupRule === 'object' && cleanupRule.type === 'mapValues') {
    const mapped = cleanupRule.map?.[text];
    if (typeof mapped === 'string' && mapped.trim()) return mapped.trim();
  }
  return text;
}

function boundsToMapLibre(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return null;
  const [[south, west], [north, east]] = bounds;
  return [[west, south], [east, north]];
}

function absoluteTileTemplate(template) {
  if (/^https?:\/\//i.test(template)) return template;
  const origin = location.origin.replace(/\/$/, '');
  return template.startsWith('/') ? `${origin}${template}` : `${origin}/${template}`;
}

function boundsToFlatBbox(bounds) {
  const converted = boundsToMapLibre(bounds);
  if (!converted) return undefined;
  return [converted[0][0], converted[0][1], converted[1][0], converted[1][1]];
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 5000);
}

async function main() {
  const controller = new TestMapLibreController('map');
  controller.init();
  const catalogue = new TestCatalogue(controller);
  await catalogue.init();
  emitDiagnostics(controller);
}

main().catch((err) => {
  console.error(err);
  showToast(err.message);
  els.diagnostics.textContent = `Startup failed: ${err.stack || err.message}`;
});
