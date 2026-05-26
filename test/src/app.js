import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import './styles.css';

const METADATA_URL = '/test/metadata/maps-test.json';
const IRELAND_BOUNDS = [[-10.75, 51.35], [-5.35, 55.55]];

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
        filter: ['==', ['get', layer.promoteId || 'id'], ''],
        paint: {
          'line-color': '#F59E0B',
          'line-width': 3,
          'line-opacity': 0.95
        }
      });

      this.map.addLayer({
        id: selectedId,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        filter: ['==', ['get', layer.promoteId || 'id'], ''],
        paint: {
          'line-color': '#111827',
          'line-width': 4,
          'line-opacity': 0.95
        }
      });

      if (layer.labelProperty) {
        this.map.addLayer({
          id: labelId,
          type: 'symbol',
          source: sourceId,
          'source-layer': layer.sourceLayer,
          minzoom: 9,
          layout: {
            'text-field': ['coalesce', ['get', layer.labelProperty], ''],
            'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-max-width': 12,
            'text-padding': 2,
            'text-allow-overlap': false
          },
          paint: {
            'text-color': '#111827',
            'text-halo-color': '#FFFFFF',
            'text-halo-width': 1.2,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 8.9, 0, 9.4, 1]
          }
        });
      }

      this.layers.set(layer.id, {
        config: layer,
        sourceId,
        layerIds: [fillId, lineId, hoverId, selectedId, labelId].filter((id) => this.map.getLayer(id))
      });

      this.bindLayerInteractions(layer, fillId, hoverId, selectedId);
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

  bindLayerInteractions(layer, fillId, hoverId, selectedId) {
    const idProperty = layer.promoteId || 'id';

    this.map.on('mousemove', fillId, (event) => {
      this.map.getCanvas().style.cursor = 'pointer';
      const feature = event.features?.[0];
      const id = feature?.properties?.[idProperty];
      if (id === undefined || id === null || this.hovered === id) return;
      this.hovered = id;
      this.map.setFilter(hoverId, ['==', ['get', idProperty], id]);
    });

    this.map.on('mouseleave', fillId, () => {
      this.map.getCanvas().style.cursor = '';
      this.hovered = null;
      this.map.setFilter(hoverId, ['==', ['get', idProperty], '']);
    });

    this.map.on('click', fillId, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const id = feature.properties?.[idProperty];
      this.selected = { layerId: layer.id, id, properties: feature.properties };
      this.map.setFilter(selectedId, ['==', ['get', idProperty], id ?? '']);
      renderFeatureDetails({ layer, feature });
    });
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
    row.className = 'active-layer';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(record.config.name)}</strong>
        <span>${escapeHtml(record.config.sourceType)} · z${record.config.minzoom}-${record.config.maxzoom}</span>
      </div>
      <label>
        Opacity
        <input type="range" min="0" max="1" step="0.05" value="${record.config.style?.fillOpacity ?? 0.18}">
      </label>
    `;
    row.querySelector('input').addEventListener('input', (event) => {
      controller.setOpacity(id, Number(event.target.value));
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
    <h3>${escapeHtml(props[layer.labelProperty] || layer.name)}</h3>
    <dl>${rows}</dl>
  `;
}

function emitDiagnostics(controller) {
  const data = {
    renderer: 'maplibre-gl',
    maplibreVersion: maplibregl.version,
    loadedLayers: [...controller.layers.keys()],
    zoom: controller.map ? Number(controller.map.getZoom().toFixed(3)) : null,
    center: controller.map ? controller.map.getCenter().toArray().map((value) => Number(value.toFixed(5))) : null,
    metrics: controller.metrics.slice(-8)
  };
  els.diagnostics.textContent = JSON.stringify(data, null, 2);
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
