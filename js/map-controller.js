/**
 * NI Boundaries - Map Controller
 * Handles Leaflet map initialization, layer management, base maps, overlays, and interactions
 */

import featureLoader from './feature-loader.js';
import dataService from './data-service.js';

class MapController {
    constructor() {
        this.map = null;
        this.layerStates = new Map();
        this._layerOrder = []; // bottom-to-top z-order of shown layers (map IDs)
        this.labelMarkers = [];
        this.labelsEnabled = true;
        this.onFeatureClick = null;
        this.baseLayer = null;
        this.overlayLayers = new Map();
        this.currentBaseMapId = 'osm-standard';
        this.textScale = 100;
        this.onLoadProgress = null;
        this.onSpatialLoadingChange = null;
        this.spatialLayers = new Set();  // Layers using chunked viewport loading
        this.currentLOD = new Map(); // mapId -> current LOD level
        this._spatialUpdatePending = false; // debounce flag for viewport updates
        this._lodCheckPending = false; // debounce flag for non-chunked LOD checks
        this._chunkIndexCache = new Map(); // mapId -> chunks-index.json data
        this._loadedChunks = new Map(); // mapId -> Map(chunkId -> { layer, features })
        this._featureIndexCache = new Map(); // mapId -> { features, chunks } from feature-index.json
        this._chunkDataCache = new Map(); // mapId -> Map(chunkFile -> features[])
        this._renderedFeatures = new Map(); // mapId -> Map(featureKey -> L.GeoJSON layer)
        this._spatialAbort = new Map(); // mapId -> AbortController
        this._lastPointClick = null; // fallback double-click detection for point layers
        this._lastMapClick = null; // fallback double-click detection at map level
        this._lastNativeDblClickTs = 0;
        this._lastFeatureSelection = null; // dedupe rapid duplicate emits
        this._activeHoveredPoint = null; // point currently hover-highlighted (orange)
        this._lastHoveredPoint = null; // short-lived post-hover memory for dblclick timing
        this._activeHoverGraceMs = 1800; // tolerate low-zoom mouseout jitter between clicks
        this._highlightedPointLayers = new Set(); // layers currently highlighted orange
        this._currentHoverLayer = null; // single source-of-truth hovered point layer
        this._armedHoverPoint = null; // strict hover-armed target used by dblclick selection
        this._pointSelectionV2 = true; // unified point hover/selection pipeline
        this._boundContainerDblClick = null; // capture-phase dblclick fallback
        this._boundContainerPointerUp = null; // synthetic dblclick fallback (pointerup pair)
        this._boundContainerMouseLeave = null;
        this._lastContainerPointerUp = null;
        this._lastSyntheticDblClickTs = 0;
        this._interactionDebug = {
            enabled: true,
            maxEntries: 400,
            events: []
        };
        this._loadMetrics = [];
        this._loadMetricSeq = 0;

        // Web Worker for FGB parsing (offloads decompression + deserialization)
        this._fgbWorker = null;
        this._fgbWorkerReady = false;
        this._fgbWorkerCallbacks = new Map(); // id -> { resolve, reject }
        this._fgbWorkerSeq = 0;
        this._initFgbWorker();

        // Feature loader is initialized lazily on first use (deferred to avoid
        // downloading the 24 MB spatial-index.json on every page load).
    }

    /**
     * Initialize Web Worker for FGB parsing.
     * Falls back gracefully to main-thread parsing if unavailable.
     */
    _initFgbWorker() {
        try {
            this._fgbWorker = new Worker('js/fgb-worker.js?v=2');
            this._fgbWorker.onmessage = (e) => {
                const { id, features, featureCount, skippedCount, compressed, durationMs, error } = e.data;
                const cb = this._fgbWorkerCallbacks.get(id);
                if (!cb) return;
                this._fgbWorkerCallbacks.delete(id);
                if (error) {
                    cb.reject(new Error(error));
                } else {
                    cb.resolve({ features, featureCount, skippedCount, compressed, durationMs });
                }
            };
            this._fgbWorker.onerror = () => {
                console.warn('[MapController] FGB Worker failed, falling back to main thread');
                this._fgbWorker = null;
                this._fgbWorkerReady = false;
            };
            this._fgbWorkerReady = true;
        } catch {
            this._fgbWorker = null;
            this._fgbWorkerReady = false;
        }
    }

    /**
     * Send an FGB parse job to the Web Worker.
     * Returns a Promise that resolves with { features, featureCount, skippedCount, compressed, durationMs }.
     */
    _parseFgbInWorker(url, minDiag = 0) {
        return new Promise((resolve, reject) => {
            const id = ++this._fgbWorkerSeq;
            this._fgbWorkerCallbacks.set(id, { resolve, reject });
            this._fgbWorker.postMessage({
                id,
                url,
                minDiag,
                useCompressed: typeof pako !== 'undefined' && url.toLowerCase().endsWith('.fgb')
            });
        });
    }

    _recordLoadMetric(type, payload = {}) {
        const entry = {
            seq: ++this._loadMetricSeq,
            ts: Date.now(),
            type,
            ...payload
        };
        this._loadMetrics.push(entry);
        if (this._loadMetrics.length > 1000) {
            this._loadMetrics.shift();
        }
        if (typeof window !== 'undefined') {
            window.__bwMapLoadMetrics = this._loadMetrics;
        }
        return entry;
    }

    clearLoadMetrics() {
        this._loadMetrics = [];
        this._loadMetricSeq = 0;
        if (typeof window !== 'undefined') {
            window.__bwMapLoadMetrics = this._loadMetrics;
        }
    }

    getLoadMetrics() {
        return [...this._loadMetrics];
    }

    _now() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    _elapsedMs(start) {
        return Number((this._now() - start).toFixed(2));
    }

    _traceInteraction(stage, payload = {}) {
        if (!this._interactionDebug?.enabled) return;
        const entry = { ts: new Date().toISOString(), stage, ...payload };
        this._interactionDebug.events.push(entry);
        if (this._interactionDebug.events.length > this._interactionDebug.maxEntries) {
            this._interactionDebug.events.shift();
        }
        if (typeof window !== 'undefined') {
            window.__bwPointInteractionDebug = this._interactionDebug.events;
        }
        try {
            console.debug('[PointInteraction]', stage, payload);
        } catch (_) {
            // Ignore console failures
        }
        try {
            if (typeof window !== 'undefined' && typeof window.__bwRuntimeLog === 'function') {
                window.__bwRuntimeLog('point-interaction', { stage, payload });
            }
        } catch (_) {
            // Ignore runtime logger failures
        }
    }

    _isAbortError(err) {
        return err?.name === 'AbortError';
    }

    _throwIfAborted(signal) {
        if (!signal?.aborted) return;
        throw new DOMException('Map loading was cancelled', 'AbortError');
    }

    _emitSpatialLoadingChange(mapId, state, loading, reason = 'viewport') {
        if (typeof this.onSpatialLoadingChange !== 'function') return;
        try {
            this.onSpatialLoadingChange({
                mapId,
                mapName: state?.config?.name || mapId,
                loading,
                reason
            });
        } catch (err) {
            console.warn('[MapController] Spatial loading callback failed:', err);
        }
    }

    /**
     * Create a circle marker for point features
     * Styled to match label text: white stroke (outline), colored fill
     * @param {L.LatLng} latlng - The point location
     * @param {Object} style - Style configuration with color property
     * @returns {L.CircleMarker} The styled circle marker
     */
    createPointMarker(latlng, style) {
        return L.circleMarker(latlng, {
            radius: style?.radius || 5,
            fillColor: style?.color || '#3388ff',
            fillOpacity: 1,
            color: '#000000',  // Black stroke for visible outline
            weight: 2,
            opacity: 1
        });
    }

    _attachFeatureHoverHandlers(layer) {
        if (!layer || typeof layer.on !== 'function') return;
        // Point-feature hover is now resolved centrally via map mousemove.
        if (typeof layer.getLatLng === 'function') return;
        layer.on('mouseover', () => this._setFeatureHover(layer, true));
        layer.on('mouseout', () => this._setFeatureHover(layer, false));
    }

    _pointPickPx(zoom = this.map?.getZoom?.() ?? 10) {
        return Math.max(32, 96 - (zoom * 4));
    }

    _forEachVisiblePointLayer(callback) {
        if (typeof callback !== 'function') return;
        this.layerStates.forEach((state) => {
            if (!state?.loaded || !state?.visible) return;
            this._forEachFeatureLayer(state, (layer) => {
                if (typeof layer.getLatLng !== 'function' || !layer.feature || !layer._mapId) return;
                callback(layer, state);
            });
        });
    }

    _resolvePointUnderCursor(containerPoint, zoom = this.map?.getZoom?.() ?? 10) {
        if (!this.map || !containerPoint) return null;
        const pickRadius = Math.max(this._pointPickPx(zoom), 72);
        let best = null;
        let bestDist = Infinity;
        this._forEachVisiblePointLayer((layer) => {
            const pt = this.map.latLngToContainerPoint(layer.getLatLng());
            const dist = containerPoint.distanceTo(pt);
            if (dist <= pickRadius && dist < bestDist) {
                bestDist = dist;
                best = layer;
            }
        });
        return best;
    }

    _setCurrentHoverLayer(layer) {
        if (this._currentHoverLayer === layer) return;

        const prev = this._currentHoverLayer;
        this._currentHoverLayer = layer || null;

        if (prev && prev !== layer && prev._map) {
            this._setFeatureHover(prev, false);
        }
        if (layer && layer !== prev && layer._map) {
            this._setFeatureHover(layer, true);
        }
        this._traceInteraction('hover-change', {
            prev: prev?._mapId || null,
            next: layer?._mapId || null,
            featureId: layer?.feature?.id ?? null
        });
    }

    _updatePointHoverFromMouseMove(e) {
        if (!this.map || !e?.containerPoint) return;
        const resolved = this._resolvePointUnderCursor(e.containerPoint, this.map.getZoom?.() ?? 10);
        this._setCurrentHoverLayer(resolved);
    }

    _attachHistoricPointDblClick(mapConfig, mapId, feature, layer) {
        if (this._pointSelectionV2) return;
        if (!layer || typeof layer.on !== 'function') return;
        const geomType = feature?.geometry?.type;
        if (!(geomType === 'Point' || geomType === 'MultiPoint' || typeof layer.getLatLng === 'function')) return;

        const emitSelection = () => this._emitFeatureSelection(mapId, feature);

        // Primary path: single click selects point features immediately.
        // This avoids renderer/browser dblclick inconsistencies for point layers.
        layer.on('click', (e) => {
            try {
                if (e?.originalEvent) {
                    L.DomEvent.stop(e.originalEvent);
                } else if (e) {
                    L.DomEvent.stop(e);
                }
            } catch (err) {
                // Selection should still emit.
            }
            emitSelection();
        });

        layer.on('dblclick', (e) => {
            try {
                if (e?.originalEvent) {
                    L.DomEvent.stop(e.originalEvent);
                } else if (e) {
                    L.DomEvent.stop(e);
                }
            } catch (err) {
                // Selection must still fire even if event stopping fails.
            }
            emitSelection();
        });

        // Keep an additional double-click fallback path.
        layer.on('click', () => {
            const now = Date.now();
            const layerId = layer._leaflet_id;
            const prev = this._lastPointClick;
            const withinWindow = prev && prev.layerId === layerId && (now - prev.ts) <= 450;
            if (withinWindow) this._lastPointClick = null;
            else this._lastPointClick = { layerId, ts: now };
        });
    }

    _emitFeatureSelection(mapId, feature) {
        if (!this.onFeatureClick || !feature) return;
        const now = Date.now();
        const key = `${mapId}|${feature?.id ?? ''}|${JSON.stringify(feature?.geometry?.coordinates ?? '')}`;
        const prev = this._lastFeatureSelection;
        if (prev && prev.key === key && (now - prev.ts) < 250) {
            this._traceInteraction('emit-deduped', { mapId, dtMs: now - prev.ts });
            return;
        }
        this._lastFeatureSelection = { key, ts: now };
        this._traceInteraction('emit-selection', { mapId, featureId: feature?.id ?? null });
        this.onFeatureClick([{
            mapId,
            properties: feature?.properties,
            geometry: feature?.geometry
        }]);
    }

    _setFeatureHover(layer, isHover) {
        if (!layer || typeof layer.setStyle !== 'function') return;

        if (!layer._baseStyle) {
            const opts = layer.options || {};
            layer._baseStyle = {
                color: opts.color,
                weight: opts.weight,
                opacity: opts.opacity,
                fillColor: opts.fillColor,
                fillOpacity: opts.fillOpacity,
                radius: opts.radius
            };
        }

        const base = layer._baseStyle || {};
        if (isHover) {
            layer._hoverRestoreStyle = { ...base };
            const hoverColor = '#ff7a1a';
            const hoverStyle = {
                color: hoverColor,
                opacity: 1
            };
            if (typeof base.weight === 'number') hoverStyle.weight = Math.max(base.weight + 1, 3);
            if (typeof base.fillOpacity === 'number') {
                hoverStyle.fillOpacity = Math.min(Math.max(base.fillOpacity, 0.15) + 0.1, 0.6);
            }
            if (base.fillColor !== undefined) hoverStyle.fillColor = hoverColor;
            if (typeof base.radius === 'number') hoverStyle.radius = base.radius + 2;
            layer.setStyle(hoverStyle);
            const state = layer._mapId ? this.layerStates.get(layer._mapId) : null;
            if (!state?.belowElectionZLock && typeof layer.bringToFront === 'function') layer.bringToFront();
        } else {
            const restoreBase = layer._hoverRestoreStyle || base;
            const restore = {};
            ['color', 'weight', 'opacity', 'fillColor', 'fillOpacity', 'radius'].forEach((k) => {
                if (restoreBase[k] !== undefined) restore[k] = restoreBase[k];
            });
            layer.setStyle(restore);
            layer._hoverRestoreStyle = null;
        }

        const labelEl = layer._labelMarker?.getElement?.();
        if (labelEl) {
            labelEl.classList.toggle('map-label--hover', !!isHover);
        }

        // Keep hovered-point state so click/dblclick selection is consistent
        // with the visual hover (orange highlight) behavior.
        if (typeof layer.getLatLng === 'function' && layer.feature) {
            if (!isHover) {
                this._highlightedPointLayers.delete(layer);
                if (this._armedHoverPoint?.layer === layer) {
                    this._armedHoverPoint = null;
                    this._traceInteraction('hover-armed-cleared', {
                        mapId: layer?._mapId || null,
                        featureId: layer?.feature?.id ?? null
                    });
                }
            }
            if (isHover) {
                this._highlightedPointLayers.add(layer);
                this._armedHoverPoint = {
                    layer,
                    mapId: layer._mapId,
                    feature: layer.feature
                };
                this._traceInteraction('hover-armed-set', {
                    mapId: layer?._mapId || null,
                    featureId: layer?.feature?.id ?? null
                });
                const candidate = {
                    layer,
                    mapId: layer._mapId,
                    feature: layer.feature,
                    latlng: layer.getLatLng(),
                    ts: Date.now(),
                    expiresAt: Number.POSITIVE_INFINITY
                };
                this._activeHoveredPoint = candidate;
                this._lastHoveredPoint = candidate;
            } else if (this._activeHoveredPoint?.layer === layer) {
                const now = Date.now();
                this._activeHoveredPoint = {
                    layer,
                    mapId: layer._mapId,
                    feature: layer.feature,
                    latlng: layer.getLatLng(),
                    ts: now,
                    expiresAt: now + this._activeHoverGraceMs
                };
                this._lastHoveredPoint = {
                    layer,
                    mapId: layer._mapId,
                    feature: layer.feature,
                    latlng: layer.getLatLng(),
                    ts: now
                };
            }
        }
    }

    _selectHighlightedPointAt(clickPoint) {
        if (!this.map || this._highlightedPointLayers.size === 0) return false;
        let bestLayer = null;
        let bestDist = Infinity;
        this._highlightedPointLayers.forEach((layer) => {
            if (!layer?._map || typeof layer.getLatLng !== 'function' || !layer.feature) return;
            const pt = this.map.latLngToContainerPoint(layer.getLatLng());
            const dist = clickPoint ? clickPoint.distanceTo(pt) : 0;
            if (dist < bestDist) {
                bestDist = dist;
                bestLayer = layer;
            }
        });
        if (!bestLayer) return false;
        this._emitFeatureSelection(bestLayer._mapId, bestLayer.feature);
        return true;
    }

    _getHoverSelectionCandidate(clickPoint, pointPickPx) {
        const now = Date.now();
        const hoverSelectPx = Math.max(pointPickPx, 72);

        // Primary: if currently orange-hovered, prefer this exact point.
        // Do NOT apply time or secondary distance gates here: orange hover is
        // the source-of-truth signal for selection eligibility.
        const active = this._activeHoveredPoint;
        if (active) {
            // Guard against stale references when a layer is hidden/unloaded.
            const notExpired = !Number.isFinite(active.expiresAt) || now <= active.expiresAt;
            if (active.layer?._map && notExpired) {
                return {
                    mapId: active.mapId,
                    feature: active.feature,
                    properties: active.feature?.properties,
                    geometry: active.feature?.geometry
                };
            }
            this._activeHoveredPoint = null;
        }

        // Secondary: preserve last hovered point briefly across hover flicker between clicks.
        const recent = this._lastHoveredPoint;
        if (!recent || (now - recent.ts) > 1800) return null;

        const hoveredPoint = this.map?.latLngToContainerPoint(recent.latlng);
        const distPx = (clickPoint && hoveredPoint) ? clickPoint.distanceTo(hoveredPoint) : Infinity;
        if (distPx <= hoverSelectPx) {
            return {
                mapId: recent.mapId,
                feature: recent.feature,
                properties: recent.feature?.properties,
                geometry: recent.feature?.geometry
            };
        }
        return null;
    }

    _clearHoverCandidatesForMap(mapId) {
        if (!mapId) return;
        if (this._activeHoveredPoint?.mapId === mapId) this._activeHoveredPoint = null;
        if (this._lastHoveredPoint?.mapId === mapId) this._lastHoveredPoint = null;
        if (this._armedHoverPoint?.mapId === mapId) this._armedHoverPoint = null;
        if (this._currentHoverLayer?._mapId === mapId) this._currentHoverLayer = null;
        this._highlightedPointLayers.forEach((layer) => {
            if (layer?._mapId === mapId) this._highlightedPointLayers.delete(layer);
        });
    }

    /**
     * Base map configurations - All verified working
     */
    static BASE_MAPS = {
        // Default - OpenStreetMap
        'osm-standard': {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        },
        // Dark & Modern
        'cartodb-dark': {
            url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            maxZoom: 20
        },
        'cartodb-voyager': {
            url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            maxZoom: 20
        },
        // Other Street Maps
        'osm-humanitarian': {
            url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
            attribution: '&copy; OpenStreetMap contributors, Humanitarian OSM Team',
            maxZoom: 19
        },
        // Satellite & Imagery
        'esri-satellite': {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri, Maxar, Earthstar Geographics',
            maxZoom: 19
        },
        'esri-world-topo': {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri, USGS, NOAA',
            maxZoom: 19
        },
        'esri-natgeo': {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri, National Geographic',
            maxZoom: 16
        },
        'esri-ocean': {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; Esri, GEBCO, NOAA',
            maxZoom: 13
        },
        // Terrain & Topographic
        'stamen-terrain': {
            url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png',
            attribution: '&copy; Stadia Maps &copy; Stamen Design',
            maxZoom: 18
        },
        'opentopomap': {
            url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '&copy; OpenStreetMap, SRTM | &copy; OpenTopoMap',
            maxZoom: 17
        },
        'usgs-topo': {
            url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; USGS',
            maxZoom: 16
        },
        // Minimal
        'cartodb-positron': {
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            maxZoom: 20
        },
        'cartodb-dark-nolabels': {
            url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            maxZoom: 20
        }
    };

    /**
     * Overlay layer configurations - Global Watersheds overlays
     */
    static OVERLAY_LAYERS = {
        'voyager-labels': {
            url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
            attribution: '&copy; CARTO',
            maxZoom: 20
        },
        'merit-catchments': {
            url: 'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/MERIT_River_Basins_v1/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; MERIT-Basins',
            maxZoom: 12
        },
        'merit-rivers': {
            url: 'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/MERIT_Rivers_v1/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; MERIT-Basins',
            maxZoom: 12
        }
    };

    /**
     * Initialize the Leaflet map
     */
    init(containerId, options = {}) {
        const defaultCenter = [54.6, -6.5];
        const defaultZoom = 8;

        this.map = L.map(containerId, {
            center: options.center || defaultCenter,
            zoom: options.zoom || defaultZoom,
            zoomControl: true,
            attributionControl: true,
            doubleClickZoom: false, // Disabled: dblclick is used for feature selection
            preferCanvas: true  // Canvas renderer: handles 20k+ features vs SVG crash at ~3k
        });

        // Add default base layer
        this.setBaseMap(this.currentBaseMapId);

        // Set up event handlers
        this.map.on('moveend zoomend', () => this.updateLabels());
        this.map.on('mousemove', (e) => this._updatePointHoverFromMouseMove(e));
        if (!this._pointSelectionV2) {
            this.map.on('dblclick', (e) => {
                this._lastNativeDblClickTs = Date.now();
                this._lastMapClick = null;
                this.handleMapClick(e);
            });
            this.map.on('click', (e) => this._handleMapClickForSelection(e));
        }
        const container = this.map.getContainer?.();
        if (container && !this._boundContainerDblClick) {
            this._boundContainerDblClick = (evt) => this._handleContainerDblClick(evt);
            container.addEventListener('dblclick', this._boundContainerDblClick, true);
        }
        if (container && !this._boundContainerPointerUp) {
            this._boundContainerPointerUp = (evt) => this._handleContainerPointerUp(evt);
            container.addEventListener('pointerup', this._boundContainerPointerUp, true);
        }
        if (container && !this._boundContainerMouseLeave) {
            this._boundContainerMouseLeave = () => {
                this._setCurrentHoverLayer(null);
                this._lastContainerPointerUp = null;
                this._armedHoverPoint = null;
                this._traceInteraction('hover-armed-cleared', { reason: 'container-mouseleave' });
            };
            container.addEventListener('mouseleave', this._boundContainerMouseLeave, true);
        }

        // Spatial loading handlers - update visible features on pan/zoom
        this.map.on('moveend', () => this.updateSpatialLayers());
        this.map.on('zoomend', () => this.updateSpatialLayers());
        this.map.on('moveend zoomend', () => this._scheduleNonChunkedLODCheck());

        console.log('[MapController] Map initialized');
        return this;
    }

    _selectPointFromInteraction(clickPoint, source = 'unknown') {
        if (!this.map || !clickPoint) return false;
        if (this._armedHoverPoint?.feature && this._armedHoverPoint?.mapId && this._armedHoverPoint?.layer?._map) {
            this._traceInteraction('select-armed-hover', {
                source,
                mapId: this._armedHoverPoint.mapId
            });
            this._emitFeatureSelection(this._armedHoverPoint.mapId, this._armedHoverPoint.feature);
            return true;
        }
        if (this._currentHoverLayer?.feature && this._currentHoverLayer?._mapId) {
            this._traceInteraction('select-current-hover', {
                source,
                mapId: this._currentHoverLayer._mapId
            });
            this._emitFeatureSelection(this._currentHoverLayer._mapId, this._currentHoverLayer.feature);
            return true;
        }
        const resolvedPoint = this._resolvePointUnderCursor(clickPoint, this.map.getZoom?.() ?? 10);
        if (resolvedPoint?._mapId && resolvedPoint?.feature) {
            this._traceInteraction('select-resolved-point', {
                source,
                mapId: resolvedPoint._mapId
            });
            this._emitFeatureSelection(resolvedPoint._mapId, resolvedPoint.feature);
            return true;
        }
        this._traceInteraction('select-point-miss', { source });
        return false;
    }

    _handlePointDoubleActivate(point, source) {
        if (!this.map || !point) return;
        this._traceInteraction('double-activate', { source });
        if (this._selectPointFromInteraction(point, source)) return;
        const latlng = this.map.containerPointToLatLng(point);
        this._traceInteraction('double-activate-fallback-map-hit', { source });
        this.handleMapClick({ latlng });
    }

    _handleContainerPointerUp(evt) {
        if (!this._pointSelectionV2 || !this.map || !evt) return;
        if (typeof evt.button === 'number' && evt.button !== 0) return;

        const container = this.map.getContainer?.();
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const point = L.point(evt.clientX - rect.left, evt.clientY - rect.top);
        const now = Date.now();
        const zoom = this.map.getZoom?.() ?? 10;
        const pairPx = Math.max(24, 44 - (zoom * 1.5));
        const pairMs = 700;

        const prev = this._lastContainerPointerUp;
        this._lastContainerPointerUp = { ts: now, pt: point };
        if (!prev?.pt) return;
        if ((now - prev.ts) > pairMs) return;
        if (prev.pt.distanceTo(point) > pairPx) return;

        // Robust synthetic dblclick path for cases where click/dblclick events are suppressed.
        this._lastSyntheticDblClickTs = now;
        this._handlePointDoubleActivate(point, 'synthetic-pointerup');
    }

    _handleContainerDblClick(evt) {
        if (!this.map || !evt) return;
        const now = Date.now();
        if (now - this._lastSyntheticDblClickTs <= 280) {
            this._traceInteraction('native-dblclick-skipped-after-synthetic', { dtMs: now - this._lastSyntheticDblClickTs });
            return;
        }
        const container = this.map.getContainer?.();
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const clickPoint = L.point(evt.clientX - rect.left, evt.clientY - rect.top);
        this._handlePointDoubleActivate(clickPoint, 'native-dblclick');
    }

    _handleMapClickForSelection(e) {
        // Always attempt selection on click first; _emitFeatureSelection de-dupes rapid duplicates.
        this.handleMapClick(e);

        const now = Date.now();
        // If native dblclick just fired, skip synthetic detection.
        if (now - this._lastNativeDblClickTs <= 350) {
            this._lastMapClick = null;
            return;
        }

        const prev = this._lastMapClick;
        const currentPt = this.map?.latLngToContainerPoint(e.latlng);
        const zoom = this.map?.getZoom?.() ?? 10;
        const clickPairPx = Math.max(24, 44 - (zoom * 1.5));
        const clickPairMs = 650;
        if (prev && prev.pt && currentPt) {
            const withinTime = (now - prev.ts) <= clickPairMs;
            const withinDistance = prev.pt.distanceTo(currentPt) <= clickPairPx;
            if (withinTime && withinDistance) {
                this._lastMapClick = null;
                this.handleMapClick(e);
                return;
            }
        }

        this._lastMapClick = { ts: now, pt: currentPt };
    }

    /**
     * Set base map
     */
    setBaseMap(baseMapId) {
        const config = MapController.BASE_MAPS[baseMapId];
        if (!config) {
            console.warn(`[MapController] Unknown base map: ${baseMapId}`);
            return;
        }

        // Remove current base layer
        if (this.baseLayer && this.map) {
            this.map.removeLayer(this.baseLayer);
        }

        // Create new base layer
        this.baseLayer = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: config.maxZoom
        });

        if (this.map) {
            this.baseLayer.addTo(this.map);
            this.baseLayer.bringToBack();
        }

        this.currentBaseMapId = baseMapId;
        console.log(`[MapController] Base map set to: ${baseMapId}`);
    }

    /**
     * Toggle overlay layer
     */
    toggleOverlay(overlayId, enabled) {
        if (enabled) {
            this.showOverlay(overlayId);
        } else {
            this.hideOverlay(overlayId);
        }
    }

    /**
     * Show overlay layer
     */
    showOverlay(overlayId) {
        if (this.overlayLayers.has(overlayId)) return;

        const config = MapController.OVERLAY_LAYERS[overlayId];
        if (!config || !this.map) return;

        const layer = L.tileLayer(config.url, {
            attribution: config.attribution,
            maxZoom: config.maxZoom || 20,
            pane: 'overlayPane'
        });

        layer.addTo(this.map);
        this.overlayLayers.set(overlayId, layer);
        console.log(`[MapController] Overlay enabled: ${overlayId}`);
    }

    /**
     * Hide overlay layer
     */
    hideOverlay(overlayId) {
        const layer = this.overlayLayers.get(overlayId);
        if (layer && this.map) {
            this.map.removeLayer(layer);
            this.overlayLayers.delete(overlayId);
            console.log(`[MapController] Overlay disabled: ${overlayId}`);
        }
    }

    /**
     * Invalidate map size (call after container resize)
     */
    invalidateSize() {
        if (this.map) {
            setTimeout(() => this.map.invalidateSize(), 100);
        }
    }

    /**
     * Resolve LOD FGB file path based on zoom level
     * LOD-0 (zoom 0-8): {name}-lod0.fgb  (simplified ~500m)
     * LOD-1 (zoom 8-12): {name}-lod1.fgb  (simplified ~50m)
     * LOD-2 (zoom 12+): {name}.fgb        (original full resolution)
     */
    getLODFilePath(baseFgbPath, zoom) {
        const lod = this.getLODLevel(zoom);
        if (lod >= 2) return baseFgbPath; // Full resolution
        const lodPath = baseFgbPath.replace(/\.fgb$/i, `-lod${lod}.fgb`);
        return lodPath;
    }

    /**
     * Get LOD level from zoom
     */
    getLODLevel(zoom) {
        if (zoom >= 12) return 2;
        if (zoom >= 8) return 1;
        return 0;
    }

    /**
     * Resolve the preferred vector source for an opt-in LOD-backed map.
     * Falls back to the original FGB path at full-resolution zooms or when
     * the map is not marked for LOD-first loading.
     */
    getPreferredVectorFilePath(mapConfig, baseFgbPath, zoom) {
        if (!mapConfig?.useLOD) return baseFgbPath;
        if (!String(baseFgbPath || '').toLowerCase().endsWith('.fgb')) return baseFgbPath;
        const resolved = this.getLODFilePath(baseFgbPath, zoom);
        this._recordLoadMetric('lod-source-selected', {
            mapId: mapConfig?.id || null,
            zoom,
            source: resolved,
            baseSource: baseFgbPath,
            lodLevel: this.getLODLevel(zoom)
        });
        return resolved;
    }

    _isTownlandMap(mapConfigOrId) {
        const id = typeof mapConfigOrId === 'string' ? mapConfigOrId : mapConfigOrId?.id;
        return id === 'ni-townlands-1844' || id === 'ni-townlands' || id === 'roi-townlands' || id === 'all-ireland-townlands';
    }

    shouldUseOverviewLOD(mapConfig, zoom) {
        return this._isTownlandMap(mapConfig) && zoom <= 7;
    }

    getInitialChunkBuffer(mapConfig) {
        if (this._isTownlandMap(mapConfig)) return 0.05;
        return 0.5;
    }

    shouldPreferFullChunkGeometry(mapId, zoom) {
        return this._isTownlandMap(mapId) && zoom >= 10;
    }

    getChunkLoadConcurrency(mapConfig) {
        const requested = Number(mapConfig?.chunkLoadConcurrency ?? 1);
        if (!Number.isFinite(requested) || requested < 1) return 1;
        return Math.min(Math.max(Math.floor(requested), 1), 8);
    }

    async _mapWithConcurrency(items, concurrency, worker) {
        if (!Array.isArray(items) || items.length === 0) return [];
        const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
        const results = new Array(items.length);
        let cursor = 0;
        const run = async () => {
            while (true) {
                const index = cursor++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        };
        await Promise.all(Array.from({ length: limit }, run));
        return results;
    }

    _validateChunkIndex(mapId, chunkIndex) {
        if (!chunkIndex || !Array.isArray(chunkIndex.chunks)) {
            console.warn(`[MapController] Invalid chunk index for ${mapId}: missing chunks array`);
            this._recordLoadMetric('chunk-index-invalid', { mapId, reason: 'missing-chunks-array' });
            return null;
        }

        const validChunks = chunkIndex.chunks.filter((chunk) => {
            const bbox = chunk?.bbox;
            const ok = !!chunk?.id
                && typeof chunk?.file === 'string'
                && Array.isArray(bbox)
                && bbox.length === 4
                && bbox.every((value) => Number.isFinite(Number(value)));
            if (!ok) {
                this._recordLoadMetric('chunk-index-invalid-chunk', {
                    mapId,
                    chunkId: chunk?.id || null
                });
            }
            return ok;
        });

        if (validChunks.length !== chunkIndex.chunks.length) {
            console.warn(`[MapController] Filtered invalid chunks for ${mapId}: kept ${validChunks.length}/${chunkIndex.chunks.length}`);
        }

        if (validChunks.length === 0) {
            this._recordLoadMetric('chunk-index-invalid', { mapId, reason: 'no-valid-chunks' });
            return null;
        }

        return {
            ...chunkIndex,
            chunks: validChunks
        };
    }

    _clearRenderedLayerState(id, state) {
        if (!state?.group) return;
        state.group.clearLayers();
        state.geoJsonLayers = [];
        state.labelEntries = [];
        state.featureNames = new Map();
        state.featureLayers = new Map();
        state.featureVisibility = new Map();
        state._overviewLOD = false;

        const rendered = this._renderedFeatures.get(id);
        if (rendered) rendered.clear();
    }

    async _loadOverviewLODState(mapConfig, state, show, signal = null) {
        const zoom = this.map?.getZoom?.() ?? 10;
        const overviewPath = this.getPreferredVectorFilePath(mapConfig, state.fgbPath, zoom);
        const { id, style, labelProperty, name } = mapConfig;
        const loadStart = this._now();

        this._clearRenderedLayerState(id, state);

        const features = await this.loadDataFile(overviewPath, (progress) => {
            state.progress = progress;
            if (this.onLoadProgress) this.onLoadProgress(id, progress);
        }, signal);

        const geojsonData = Array.isArray(features)
            ? { type: 'FeatureCollection', features }
            : features;

        const geoJsonLayer = L.geoJSON(geojsonData, {
            style: (feature) => {
                if (feature.geometry?.type === 'Point') return {};
                return {
                    color: style?.color || '#3388ff',
                    weight: style?.weight || 2,
                    fillOpacity: style?.fillOpacity ?? 0,
                    opacity: 1
                };
            },
            pointToLayer: (feature, latlng) => this.createPointMarker(latlng, style),
            onEachFeature: (feature, layer) => {
                layer._mapId = id;
                this._attachFeatureHoverHandlers(layer);
                this._attachHistoricPointDblClick(mapConfig, id, feature, layer);

                if (labelProperty && feature.properties?.[labelProperty]) {
                    const labelText = this.cleanLabelText(
                        feature.properties[labelProperty],
                        mapConfig.labelCleanup
                    );
                    if (labelText && (layer.getBounds || layer.getLatLng)) {
                        const priorityProp = mapConfig.priorityProperty || mapConfig.significanceProperty;
                        const priority = priorityProp ? (parseFloat(feature.properties[priorityProp]) || 0) : 0;

                        state.labelEntries.push({
                            layer,
                            feature,
                            text: labelText,
                            color: style?.color || '#3388ff',
                            priority
                        });
                    }
                }
            }
        });

        geoJsonLayer.addTo(state.group);
        state.geoJsonLayers.push(geoJsonLayer);
        state.featureCount = geojsonData.features?.length || 0;
        state.geometryType = geojsonData.features?.[0]?.geometry?.type || '';
        state.baseLoaded = true;
        state.isPartial = false;
        state.loaded = true;
        state.loading = false;
        state.progress = 100;
        state._overviewLOD = true;
        state._lastZoom = zoom;

        if (this.onLoadProgress) this.onLoadProgress(id, 100);
        if (show) this.showLayer(id);

        this._recordLoadMetric('lod-overview-loaded', {
            mapId: id,
            source: overviewPath,
            lodLevel: this.getLODLevel(zoom),
            featureCount: state.featureCount,
            durationMs: this._elapsedMs(loadStart)
        });
        console.log(`[MapController] Loaded overview LOD layer: ${name} (${overviewPath})`);
        return state;
    }

    /**
     * Convert Leaflet bounds to FlatGeobuf rect with buffer
     */
    boundsToRect(bounds, buffer = 0.2) {
        const latDiff = bounds.getNorth() - bounds.getSouth();
        const lngDiff = bounds.getEast() - bounds.getWest();
        return {
            minX: bounds.getWest() - lngDiff * buffer,
            minY: bounds.getSouth() - latDiff * buffer,
            maxX: bounds.getEast() + lngDiff * buffer,
            maxY: bounds.getNorth() + latDiff * buffer
        };
    }

    /**
     * Check if a map should use chunked viewport-based loading.
     * Returns true if the map has chunked:true flag in its config.
     */
    shouldUseChunkedLoading(mapConfig) {
        return mapConfig.chunked === true;
    }

    /**
     * Load a map layer from the database
     */
    async loadLayer(mapConfig, show = true, options = {}) {
        const { id, files, style, labelProperty, name } = mapConfig;
        const signal = options?.signal;
        const loadStart = this._now();

        // Check if already loaded as a full/base layer.
        let state = this.layerStates.get(id);
        if (state?.baseLoaded) {
            if (show && !state.visible) {
                this.showLayer(id);
            }
            return state;
        }

        // Vector layers in interactive pane are FGB-only.
        let filePath = files?.fgb;

        // If no files and this is a clone, get files from source map
        if (!filePath && mapConfig.cloneOf) {
            const sourceMap = dataService.getMapById(mapConfig.cloneOf);
            if (sourceMap?.files) {
                filePath = sourceMap.files.fgb;
                console.log(`[MapController] Clone map ${id} using files from ${mapConfig.cloneOf}`);
            }
        }

        const rasterTemplate = files?.xyz || files?.tiles || files?.webpTiles;

        const imageOverlayUrl = files?.image;
        if (!filePath && !rasterTemplate && !imageOverlayUrl) {
            console.warn(`[MapController] No FGB/XYZ/image source for layer ${id}`);
            return null;
        }

        // Create or promote layer state.
        if (!state) {
            state = {
                id,
                config: mapConfig,
                group: L.layerGroup(),
                geoJsonLayers: [],
                labelEntries: [],
                loaded: false,
                loading: true,
                visible: false,
                progress: 0,
                useSpatial: false,  // Will be set if using spatial/LOD loading
                fgbPath: filePath,   // Store the base FGB path for LOD resolution
                baseLoaded: false,
                featureNames: new Map(),
                featureLayers: new Map(),
                featureVisibility: new Map()
            };
            this.layerStates.set(id, state);
        } else {
            state.config = mapConfig;
            state.loading = true;
            state.progress = 0;
            state.useSpatial = false;
            state.fgbPath = filePath;
        }

        // Notify loading started
        if (this.onLoadProgress) {
            this.onLoadProgress(id, 0);
        }

        if (rasterTemplate) {
            return this.loadRasterTileLayer(mapConfig, state, show, { signal });
        }

        // Single-image raster overlay (e.g., georeferenced historic map scans)
        const imageUrl = imageOverlayUrl;
        const imageBounds = mapConfig.bounds;
        if (imageUrl && imageBounds) {
            const overlay = L.imageOverlay(imageUrl, imageBounds, {
                opacity: mapConfig.opacity ?? 0.8,
                interactive: false,
                className: 'raster-tile--pixelated'
            });
            overlay.addTo(state.group);
            state.loaded = true;
            state.loading = false;
            state.baseLoaded = true;
            state.isRasterOverlay = true;
            if (show) this.showLayer(id);
            this._recordLoadMetric('raster-overlay-loaded', { mapId: id, source: imageUrl });

            return state;
        }

        // Use chunked loading for large maps with spatial chunks
        if (this.shouldUseChunkedLoading(mapConfig)) {
            return this.loadLayerChunked(mapConfig, state, show, { signal });
        }

        try {
            this._throwIfAborted(signal);
            // Load the configured source directly.
            // For FGB-backed maps, do not substitute GeoJSON in the interactive pane.
            const zoom = this.map?.getZoom?.() ?? 10;
            const preferredFilePath = this.getPreferredVectorFilePath(mapConfig, filePath, zoom);
            let features;
            try {
                features = await this.loadDataFile(preferredFilePath, (progress) => {
                    state.progress = progress;
                    if (this.onLoadProgress) {
                        this.onLoadProgress(id, progress);
                    }
                }, signal);
            } catch (preferredErr) {
                if (preferredFilePath !== filePath) {
                    this._recordLoadMetric('lod-fallback-full', {
                        mapId: id,
                        preferredSource: preferredFilePath,
                        fallbackSource: filePath,
                        zoom
                    });
                    console.warn(`[MapController] Preferred LOD source failed for ${id} (${preferredFilePath}); retrying full source ${filePath}`, preferredErr);
                    features = await this.loadDataFile(filePath, (progress) => {
                        state.progress = progress;
                        if (this.onLoadProgress) {
                            this.onLoadProgress(id, progress);
                        }
                    }, signal);
                } else {
                    throw preferredErr;
                }
            }

            const geojsonData = Array.isArray(features)
                ? { type: 'FeatureCollection', features }
                : features;

            // Create GeoJSON layer
            const geoJsonLayer = L.geoJSON(geojsonData, {
                style: (feature) => {
                    // Don't apply polygon style to points - they use pointToLayer
                    if (feature.geometry?.type === 'Point') return {};
                    return {
                        color: style?.color || '#3388ff',
                        weight: style?.weight || 2,
                        fillOpacity: style?.fillOpacity ?? 0,
                        opacity: 1
                    };
                },
                pointToLayer: (feature, latlng) => {
                    return this.createPointMarker(latlng, style);
                },
                onEachFeature: (feature, layer) => {
                    layer._mapId = id;
                    this._attachFeatureHoverHandlers(layer);
                    this._attachHistoricPointDblClick(mapConfig, id, feature, layer);

                    // Collect label entries
                    if (labelProperty && feature.properties?.[labelProperty]) {
                        const labelText = this.cleanLabelText(
                            feature.properties[labelProperty],
                            mapConfig.labelCleanup
                        );
                        if (labelText && (layer.getBounds || layer.getLatLng)) {
                            // Get priority value from priorityProperty (or significanceProperty as fallback)
                            const priorityProp = mapConfig.priorityProperty || mapConfig.significanceProperty;
                            const priority = priorityProp ? (parseFloat(feature.properties[priorityProp]) || 0) : 0;

                            state.labelEntries.push({
                                layer,
                                feature,
                                text: labelText,
                                color: style?.color || '#3388ff',
                                priority
                            });
                        }
                    }
                }
            });

            geoJsonLayer.addTo(state.group);
            state.geoJsonLayers.push(geoJsonLayer);
            state.featureCount = geojsonData.features?.length || 0;
            // Detect geometry type from first feature
            const firstGeoType = geojsonData.features?.[0]?.geometry?.type || '';
            state.geometryType = firstGeoType;
            state.loaded = true;
            state.loading = false;
            state.progress = 100;

            // Track initial LOD level for non-chunked LOD maps
            if (mapConfig?.useLOD) {
                this.currentLOD.set(id, this.getLODLevel(zoom));
            }

            if (this.onLoadProgress) {
                this.onLoadProgress(id, 100);
            }

            if (show) {
                this.showLayer(id);
            }

            this._recordLoadMetric('vector-layer-loaded', {
                mapId: id,
                source: preferredFilePath,
                featureCount: state.featureCount,
                durationMs: this._elapsedMs(loadStart),
                mode: mapConfig?.useLOD ? 'lod-fullfile' : 'fullfile'
            });
            console.log(`[MapController] Loaded layer: ${name}`);
            return state;
        } catch (err) {
            console.error(`[MapController] Failed to load layer ${id}:`, err);
            state.loading = false;
            this.layerStates.delete(id);
            if (this._isAbortError(err)) throw err;
            return null;
        }
    }

    /**
     * Load a raster XYZ/WebP tile layer
     */
    async loadRasterTileLayer(mapConfig, state, show, options = {}) {
        const { id, name, files, style } = mapConfig;
        const signal = options?.signal;
        const tileTemplate = files?.xyz || files?.tiles || files?.webpTiles;
        if (!tileTemplate) {
            console.warn(`[MapController] No raster tile template for layer ${id}`);
            this.layerStates.delete(id);
            return null;
        }

        try {
            this._throwIfAborted(signal);
            const rasterStyle = mapConfig.rasterStyle || {};
            const opacity = Math.max(0, Math.min(1, Number(
                rasterStyle.opacity ?? style?.fillOpacity ?? style?.opacity ?? 0.78
            )));
            const maxZoom = Number(rasterStyle.maxZoom ?? mapConfig.maxZoom ?? 13);
            const minZoom = Number(rasterStyle.minZoom ?? mapConfig.minZoom ?? 5);
            const maxNativeZoom = Number(rasterStyle.maxNativeZoom ?? mapConfig.maxNativeZoom ?? maxZoom);
            const pixelated = rasterStyle.pixelated !== false;

            const options = {
                opacity,
                maxZoom,
                minZoom,
                maxNativeZoom,
                zIndex: 350,
                updateWhenZooming: false,
                keepBuffer: 2,
                className: pixelated ? 'raster-tile raster-tile--pixelated' : 'raster-tile'
            };

            if (id === 'copernicus-dem-30m-ireland' && this.map) {
                const paneName = 'copernicus-dem-pane';
                let pane = this.map.getPane(paneName);
                if (!pane) {
                    pane = this.map.createPane(paneName);
                    // Keep DEM beneath vector overlays/layers.
                    pane.style.zIndex = '250';
                    pane.style.pointerEvents = 'none';
                }
                options.pane = paneName;
                options.zIndex = 250;
            }

            if (Array.isArray(mapConfig.bounds) && mapConfig.bounds.length === 2) {
                options.bounds = mapConfig.bounds;
            }

            const rasterLayer = L.tileLayer(tileTemplate, options);
            rasterLayer.addTo(state.group);

            state.rasterLayer = rasterLayer;
            state.baseLoaded = true;
            state.isPartial = false;
            state.loaded = true;
            state.loading = false;
            state.progress = 100;
            state.geometryType = 'Raster';
            state.featureCount = 0;

            if (this.onLoadProgress) this.onLoadProgress(id, 100);
            if (show) this.showLayer(id);

            console.log(`[MapController] Loaded raster layer: ${name}`);
            return state;
        } catch (err) {
            console.error(`[MapController] Failed to load raster layer ${id}:`, err);
            state.loading = false;
            this.layerStates.delete(id);
            if (this._isAbortError(err)) throw err;
            return null;
        }
    }

    /**
     * Load a layer using chunk-based spatial loading.
     * Uses feature index for visibility decisions and chunk caching.
     */
    async loadLayerChunked(mapConfig, state, show, options = {}) {
        const { id, style, labelProperty, name } = mapConfig;
        const signal = options?.signal;
        const fgbPath = state.fgbPath;
        const remoteFgb = mapConfig?.downloads?.fgb;
        const enforceChunkOnly = this._isTownlandMap(id);
        const loadStart = this._now();

        state.useSpatial = true;
        this.spatialLayers.add(id);
        this._loadedChunks.set(id, new Map());
        this._chunkDataCache.set(id, new Map());
        this._renderedFeatures.set(id, new Map());

        const zoom = this.map.getZoom();
        this.currentLOD.set(id, this.getLODLevel(zoom));

        if (this.shouldUseOverviewLOD(mapConfig, zoom)) {
            try {
                return await this._loadOverviewLODState(mapConfig, state, show, signal);
            } catch (lodErr) {
                if (this._isAbortError(lodErr)) throw lodErr;
                // Overview LOD (-lod0.fgb etc.) isn't available for every
                // townland variant on disk. Fall through to chunk loading.
                console.warn(`[MapController] Overview LOD unavailable for ${id}, falling back to chunked flow:`, lodErr?.message || lodErr);
                this._clearRenderedLayerState(id, state);
                state.progress = 0;
                if (this.onLoadProgress) this.onLoadProgress(id, 0);
            }
        }

        // Load chunk index
        const chunkIndex = await this._loadChunkIndex(id, fgbPath, signal);
        if (!chunkIndex) {
            if (enforceChunkOnly) {
                console.error(`[MapController] Townlands requires chunk index and chunk files; chunk index unavailable for ${id}`);
                state.loading = false;
                this.layerStates.delete(id);
                return null;
            }
            console.warn(`[MapController] No chunk index for ${id}, falling back to full load`);
            state.useSpatial = false;
            this.spatialLayers.delete(id);
            try {
                const features = await this.loadFlatGeobuf(fgbPath, null, signal);
                const geojsonData = { type: 'FeatureCollection', features };
                const geoJsonLayer = L.geoJSON(geojsonData, {
                    style: (f) => f.geometry?.type === 'Point' ? {} : {
                        color: style?.color || '#3388ff', weight: style?.weight || 2,
                        fillOpacity: style?.fillOpacity ?? 0, opacity: 1
                    },
                    pointToLayer: (f, ll) => this.createPointMarker(ll, style),
                    onEachFeature: (f, l) => {
                        l._mapId = id;
                        this._attachFeatureHoverHandlers(l);
                        this._attachHistoricPointDblClick(mapConfig, id, f, l);
                    }
                });
                geoJsonLayer.addTo(state.group);
                state.geoJsonLayers.push(geoJsonLayer);
                state.baseLoaded = true;
                state.isPartial = false;
                state.loaded = true;
                state.loading = false;
                state.progress = 100;
                if (this.onLoadProgress) this.onLoadProgress(id, 100);
                if (show) this.showLayer(id);
                return state;
            } catch (err) {
                console.warn(`[MapController] Full local load failed for ${id}:`, err);
                if (remoteFgb && /^https?:\/\//i.test(remoteFgb)) {
                    try {
                        console.warn(`[MapController] Retrying ${id} from remote FGB: ${remoteFgb}`);
                        const features = await this.loadFlatGeobuf(remoteFgb, null, signal);
                        const geojsonData = { type: 'FeatureCollection', features };
                        const geoJsonLayer = L.geoJSON(geojsonData, {
                            style: (f) => f.geometry?.type === 'Point' ? {} : {
                                color: style?.color || '#3388ff', weight: style?.weight || 2,
                                fillOpacity: style?.fillOpacity ?? 0, opacity: 1
                            },
                            pointToLayer: (f, ll) => this.createPointMarker(ll, style),
                            onEachFeature: (f, l) => {
                                l._mapId = id;
                                this._attachFeatureHoverHandlers(l);
                                this._attachHistoricPointDblClick(mapConfig, id, f, l);
                            }
                        });
                        geoJsonLayer.addTo(state.group);
                        state.geoJsonLayers.push(geoJsonLayer);
                        state.baseLoaded = true;
                        state.isPartial = false;
                        state.loaded = true;
                        state.loading = false;
                        state.progress = 100;
                        if (this.onLoadProgress) this.onLoadProgress(id, 100);
                        if (show) this.showLayer(id);
                        return state;
                    } catch (remoteErr) {
                        console.error(`[MapController] Remote fallback failed for ${id}:`, remoteErr);
                    }
                }
                state.loading = false;
                this.layerStates.delete(id);
                return null;
            }
        }

        // Load feature index if available
        await this._loadFeatureIndex(id, fgbPath, signal);

        // Initial visibility pass — use wider buffer to preload nearby chunks
        const bounds = this.map.getBounds();
        const rect = this.boundsToRect(bounds, this.getInitialChunkBuffer(mapConfig));
        const visibleChunks = this._getIntersectingChunks(chunkIndex, rect);

        console.log(`[MapController] Loading ${name} chunked (${visibleChunks.length}/${chunkIndex.chunks.length} chunks in viewport)`);

        try {
            const concurrency = this.getChunkLoadConcurrency(mapConfig);
            const chunkResults = await this._mapWithConcurrency(visibleChunks, concurrency, async (chunk) => {
                this._throwIfAborted(signal);
                const chunkFile = this._resolveChunkFile(id, chunk, zoom);
                const features = await this._loadChunkFGBCached(id, chunkFile, zoom, signal);
                return { chunk, chunkFile, features };
            });

            let totalLoaded = 0;
            for (const result of chunkResults) {
                const { chunk, chunkFile, features } = result;
                for (const feature of features) {
                    const fKey = this._featureKey(chunk.id, feature);
                    if (!this._renderedFeatures.get(id).has(fKey)) {
                        const layer = this.addFeatureToLayer(state, feature, style, labelProperty, mapConfig);
                        this._renderedFeatures.get(id).set(fKey, layer);
                    }
                }
                this._loadedChunks.get(id).set(chunk.id, { file: chunkFile, chunk });
                totalLoaded += features.length;
            }

            state.baseLoaded = true;
            state.isPartial = false;
            state.loaded = true;
            state.loading = false;
            state.geometryType = 'MultiPolygon';
            state.featureCount = chunkIndex.totalFeatures;
            state.progress = 100;
            state._lastZoom = zoom;

            if (this.onLoadProgress) this.onLoadProgress(id, 100);
            if (show) this.showLayer(id);

            this._recordLoadMetric('chunked-layer-loaded', {
                mapId: id,
                visibleChunkCount: visibleChunks.length,
                totalChunkCount: chunkIndex.chunks.length,
                totalFeatureCount: totalLoaded,
                concurrency,
                durationMs: this._elapsedMs(loadStart)
            });
            console.log(`[MapController] Loaded chunked layer: ${name} (${totalLoaded} features from ${visibleChunks.length} chunks)`);
            return state;
        } catch (err) {
            console.error(`[MapController] Failed to load chunked layer ${id}:`, err);
            if (this._isAbortError(err)) {
                state.loading = false;
                this.layerStates.delete(id);
                throw err;
            }
            if (enforceChunkOnly) {
                console.error(`[MapController] Townlands is configured as chunk-only; full-file fallback disabled for ${id}`);
                state.loading = false;
                this.layerStates.delete(id);
                return null;
            }

            // Fallback path: chunk load failed, retry full-file load before giving up.
            try {
                console.warn(`[MapController] Retrying ${id} as full file after chunk failure`);
                state.useSpatial = false;
                this.spatialLayers.delete(id);
                this._loadedChunks.delete(id);
                this._chunkDataCache.delete(id);
                this._renderedFeatures.delete(id);

                const isFgbPrimary = String(fgbPath || '').toLowerCase().endsWith('.fgb');
                const preferredFgbPath = isFgbPrimary ? this.getLODFilePath(fgbPath, 10) : fgbPath;

                let features = await this.loadDataFile(preferredFgbPath, null, signal);

                const geojsonData = Array.isArray(features) ? { type: 'FeatureCollection', features } : features;
                const geoJsonLayer = L.geoJSON(geojsonData, {
                    style: (f) => f.geometry?.type === 'Point' ? {} : {
                        color: style?.color || '#3388ff',
                        weight: style?.weight || 2,
                        fillOpacity: style?.fillOpacity ?? 0,
                        opacity: 1
                    },
                    pointToLayer: (f, ll) => this.createPointMarker(ll, style),
                    onEachFeature: (f, l) => {
                        l._mapId = id;
                        this._attachFeatureHoverHandlers(l);
                        this._attachHistoricPointDblClick(mapConfig, id, f, l);
                    }
                });
                geoJsonLayer.addTo(state.group);
                state.geoJsonLayers.push(geoJsonLayer);
                state.featureCount = geojsonData.features?.length || 0;
                state.baseLoaded = true;
                state.isPartial = false;
                state.loaded = true;
                state.loading = false;
                state.progress = 100;
                if (this.onLoadProgress) this.onLoadProgress(id, 100);
                if (show) this.showLayer(id);
                return state;
            } catch (fallbackErr) {
                console.warn(`[MapController] Full local fallback failed for ${id}:`, fallbackErr);
                if (!enforceChunkOnly && remoteFgb && /^https?:\/\//i.test(remoteFgb)) {
                    try {
                        console.warn(`[MapController] Retrying ${id} fallback from remote FGB: ${remoteFgb}`);
                        const features = await this.loadFlatGeobuf(remoteFgb, null, signal);
                        const geojsonData = { type: 'FeatureCollection', features };
                        const geoJsonLayer = L.geoJSON(geojsonData, {
                            style: (f) => f.geometry?.type === 'Point' ? {} : {
                                color: style?.color || '#3388ff',
                                weight: style?.weight || 2,
                                fillOpacity: style?.fillOpacity ?? 0,
                                opacity: 1
                            },
                            pointToLayer: (f, ll) => this.createPointMarker(ll, style),
                            onEachFeature: (f, l) => {
                                l._mapId = id;
                                this._attachFeatureHoverHandlers(l);
                                this._attachHistoricPointDblClick(mapConfig, id, f, l);
                            }
                        });
                        geoJsonLayer.addTo(state.group);
                        state.geoJsonLayers.push(geoJsonLayer);
                        state.featureCount = geojsonData.features?.length || 0;
                        state.baseLoaded = true;
                        state.isPartial = false;
                        state.loaded = true;
                        state.loading = false;
                        state.progress = 100;
                        if (this.onLoadProgress) this.onLoadProgress(id, 100);
                        if (show) this.showLayer(id);
                        return state;
                    } catch (remoteErr) {
                        console.error(`[MapController] Remote fallback failed for ${id}:`, remoteErr);
                    }
                }
                state.loading = false;
                this.layerStates.delete(id);
                return null;
            }
        }
    }

    /**
     * Generate a unique key for a feature within a chunk
     */
    _featureKey(chunkId, feature) {
        // Use chunk ID + feature properties to create a unique key
        const name = feature.properties?.TOWNLAND || feature.properties?.NAME || feature.properties?.name || '';
        const geomHash = feature.geometry?.coordinates?.[0]?.[0]?.join(',') || '';
        return `${chunkId}::${name}::${geomHash}`;
    }

    /**
     * Load feature index for a map (precomputed spatial index)
     */
    async _loadFeatureIndex(mapId, fgbPath, signal = null) {
        if (this._featureIndexCache.has(mapId)) return this._featureIndexCache.get(mapId);

        const dir = fgbPath.substring(0, fgbPath.lastIndexOf('/') + 1) || fgbPath.substring(0, fgbPath.lastIndexOf('\\') + 1);
        const indexUrl = `${dir}${mapId}-feature-index.json`;

        try {
            const response = await fetch(indexUrl, signal ? { signal } : undefined);
            if (!response.ok) return null;
            const data = await response.json();
            this._featureIndexCache.set(mapId, data);
            console.log(`[MapController] Feature index loaded for ${mapId}: ${data.totalFeatures} features`);
            return data;
        } catch (err) {
            console.log(`[MapController] No feature index for ${mapId}`);
            return null;
        }
    }

    /**
     * Load and cache chunk FGB data. Returns cached data if already loaded.
     */
    async _loadChunkFGBCached(mapId, filePath, zoom, signal = null) {
        const cache = this._chunkDataCache.get(mapId);
        if (cache?.has(filePath)) return cache.get(filePath);

        const features = await this._loadChunkFGB(mapId, filePath, zoom, signal);
        if (cache) cache.set(filePath, features);
        return features;
    }

    /**
     * Load chunk index for a map. Resolves the index path from the FGB path.
     * Caches the result for subsequent calls.
     */
    async _loadChunkIndex(mapId, fgbPath, signal = null) {
        if (this._chunkIndexCache.has(mapId)) {
            return this._chunkIndexCache.get(mapId);
        }

        // Resolve chunk index path: same directory as FGB, named {mapId}-chunks.json
        const dir = fgbPath.substring(0, fgbPath.lastIndexOf('/') + 1) || fgbPath.substring(0, fgbPath.lastIndexOf('\\') + 1);
        const indexPath = dir + mapId + '-chunks.json';
        const start = this._now();

        try {
            const response = await fetch(this._rewriteForDevProxy(indexPath), signal ? { signal } : undefined);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const rawIndex = await response.json();
            const index = this._validateChunkIndex(mapId, rawIndex);
            this._chunkIndexCache.set(mapId, index);
            if (index) {
                this._recordLoadMetric('chunk-index-loaded', {
                    mapId,
                    source: indexPath,
                    chunkCount: index.chunks.length,
                    durationMs: this._elapsedMs(start)
                });
            }
            return index;
        } catch (err) {
            console.warn(`[MapController] Chunk index not found: ${indexPath}`);
            this._chunkIndexCache.set(mapId, null);
            this._recordLoadMetric('chunk-index-missing', {
                mapId,
                source: indexPath,
                durationMs: this._elapsedMs(start)
            });
            return null;
        }
    }

    /**
     * Get chunks from the index that intersect the given viewport rect.
     */
    _getIntersectingChunks(chunkIndex, rect) {
        return chunkIndex.chunks.filter(chunk => {
            const [cMinX, cMinY, cMaxX, cMaxY] = chunk.bbox;
            return !(cMaxX < rect.minX || cMinX > rect.maxX ||
                cMaxY < rect.minY || cMinY > rect.maxY);
        });
    }

    /**
     * Resolve the best FGB file for a chunk at the given zoom level.
     * Uses pre-built zoom-filtered variants when available — these contain
     * only features large enough to be visible at that zoom, preventing
     * download and deserialization of invisible features.
     *
     * Falls back to the full chunk file at high zoom levels.
     */
    _resolveChunkFile(mapId, chunk, zoom) {
        if (this.shouldPreferFullChunkGeometry(mapId, zoom)) {
            return chunk.file;
        }
        if (!chunk.zoomFiles) return chunk.file;

        // Find the zoom variant whose maxZoom >= current zoom
        // zoomFiles are keyed by level name (e.g. 'z7', 'z10')
        // Each has { file, count, maxZoom }
        let bestVariant = null;
        for (const [levelName, variant] of Object.entries(chunk.zoomFiles)) {
            if (zoom <= variant.maxZoom) {
                // This variant covers the current zoom
                if (!bestVariant || variant.maxZoom < bestVariant.maxZoom) {
                    bestVariant = variant; // Pick the tightest match
                }
            }
        }

        if (bestVariant) {
            return bestVariant.file;
        }
        return chunk.file; // Full file for high zoom
    }

    /**
     * Load a single chunk FGB file and apply screen-space filtering.
     * Uses full HTTP fetch (no Range requests needed).
     * @param {string} mapId - Map ID for map-specific filter policy
     * @param {string} filePath - Path to the chunk FGB file
     * @param {number} [zoom] - Current zoom for screen-space filtering
     * @returns {Array} Filtered GeoJSON features
     */
    async _loadChunkFGB(mapId, filePath, zoom = null, signal = null) {
        const start = this._now();
        const minDiag = zoom != null ? this.getMinFeatureDiagDeg(zoom) : 0;

        // Try Web Worker path
        if (this._fgbWorkerReady && this._fgbWorker) {
            try {
                const result = await this._parseFgbInWorker(filePath, minDiag);
                if (result.skippedCount > 0) {
                    console.log(`[MapController] Chunk ${filePath}: kept ${result.featureCount}, skipped ${result.skippedCount} (too small at zoom ${zoom?.toFixed(1)})`);
                }
                this._recordLoadMetric('chunk-file-loaded', {
                    mapId,
                    source: filePath,
                    zoom,
                    keptFeatureCount: result.featureCount,
                    skippedFeatureCount: result.skippedCount,
                    durationMs: result.durationMs,
                    worker: true
                });
                return result.features;
            } catch (workerErr) {
                console.warn(`[MapController] Worker chunk parse failed for ${filePath}, falling back to main thread:`, workerErr);
            }
        }

        // Main-thread fallback
        const features = [];
        let skippedCount = 0;

        const fetchPath = this._rewriteForDevProxy(filePath);
        let source = null;
        if (typeof pako !== 'undefined' && filePath.toLowerCase().endsWith('.fgb')) {
            try {
                const gzResponse = await fetch(fetchPath + '.gz', signal ? { signal } : undefined);
                if (gzResponse.ok) {
                    const compressed = new Uint8Array(await gzResponse.arrayBuffer());
                    source = pako.ungzip(compressed);
                }
            } catch (gzErr) { /* fall through */ }
        }
        if (!source) {
            const response = await fetch(fetchPath, signal ? { signal } : undefined);
            if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);
            source = response.body || new Uint8Array(await response.arrayBuffer());
        }

        for await (const feature of flatgeobuf.deserialize(source)) {
            if (minDiag > 0) {
                const diag = this.computeFeatureBboxDiag(feature.geometry);
                if (diag < minDiag) {
                    skippedCount++;
                    continue;
                }
            }
            features.push(feature);
        }

        if (skippedCount > 0) {
            console.log(`[MapController] Chunk ${filePath}: kept ${features.length}, skipped ${skippedCount} (too small at zoom ${zoom?.toFixed(1)})`);
        }
        this._recordLoadMetric('chunk-file-loaded', {
            mapId,
            source: filePath,
            zoom,
            keptFeatureCount: features.length,
            skippedFeatureCount: skippedCount,
            durationMs: this._elapsedMs(start)
        });
        return features;
    }

    /**
     * Add a single feature to a layer state
     */
    addFeatureToLayer(state, geojson, style, labelProperty, mapConfig, options = {}) {
        const registerInGeoJsonLayers = options.registerInGeoJsonLayers !== false;
        const registerLabels = options.registerLabels !== false;
        const geoJsonLayer = L.geoJSON(geojson, {
            style: (feature) => {
                // Don't apply polygon style to points - they use pointToLayer
                if (feature.geometry?.type === 'Point') return {};
                return {
                    color: style?.color || '#3388ff',
                    weight: style?.weight || 2,
                    fillOpacity: style?.fillOpacity ?? 0,
                    opacity: 1
                };
            },
            pointToLayer: (feature, latlng) => this.createPointMarker(latlng, style),
            onEachFeature: (feature, layer) => {
                layer._mapId = state.id;
                this._attachFeatureHoverHandlers(layer);
                this._attachHistoricPointDblClick(mapConfig, state.id, feature, layer);
            }
        });

        geoJsonLayer.addTo(state.group);
        if (registerInGeoJsonLayers) {
            state.geoJsonLayers.push(geoJsonLayer);
        }

        // Apply active conditional style to dynamically-loaded chunks
        if (state._activeStyleFn) {
            geoJsonLayer.setStyle(state._activeStyleFn);
        }

        // Collect label entries — support fallback label properties for mixed data sources
        if (labelProperty && registerLabels) {
            const labelProps = mapConfig.labelPropertyFallbacks
                ? [labelProperty, ...mapConfig.labelPropertyFallbacks]
                : [labelProperty];

            geoJsonLayer.eachLayer((layer) => {
                const feature = layer.feature;
                // Try each property name until we find a value
                let rawLabel = null;
                for (const prop of labelProps) {
                    rawLabel = feature?.properties?.[prop];
                    if (rawLabel) break;
                }
                const labelText = this.cleanLabelText(rawLabel, mapConfig.labelCleanup);
                if (labelText && (layer.getBounds || layer.getLatLng)) {
                    const priorityProp = mapConfig.priorityProperty || mapConfig.significanceProperty;
                    const priority = priorityProp ? (parseFloat(feature.properties[priorityProp]) || 0) : 0;

                    state.labelEntries.push({
                        layer,
                        feature,
                        text: labelText,
                        color: style?.color || '#3388ff',
                        priority
                    });
                }
            });
        }

        return geoJsonLayer;
    }

    /**
     * Update chunked layers when viewport changes (pan/zoom).
     * Loads new chunks entering the viewport, unloads chunks leaving.
     * On zoom change, reloads ALL chunks with the appropriate zoom variant.
     * Called on moveend/zoomend events.
     */
    async updateSpatialLayers() {
        if (this.spatialLayers.size === 0) return;
        if (this._spatialUpdatePending) return;
        this._spatialUpdatePending = true;

        await new Promise(r => setTimeout(r, 150));
        this._spatialUpdatePending = false;

        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();

        for (const mapId of this.spatialLayers) {
            const state = this.layerStates.get(mapId);
            if (!state || !state.visible || state.loading) continue;
            const updateStart = this._now();

            if (this.shouldUseOverviewLOD(state.config, zoom)) {
                if (!state._overviewLOD) {
                    state.loading = true;
                    this._emitSpatialLoadingChange(mapId, state, true, 'lod');
                    try {
                        await this._loadOverviewLODState(state.config, state, true);
                    } catch (err) {
                        console.warn(`[MapController] Overview LOD load failed for ${mapId}:`, err);
                        state.loading = false;
                    } finally {
                        this._emitSpatialLoadingChange(mapId, state, false, 'lod');
                    }
                }
                continue;
            }

            if (state._overviewLOD) {
                this._clearRenderedLayerState(mapId, state);
            }

            let chunkIndex = this._chunkIndexCache.get(mapId);
            if (chunkIndex === undefined) {
                chunkIndex = await this._loadChunkIndex(mapId, state.fgbPath, null);
            }
            if (!chunkIndex) continue;

            const rect = this.boundsToRect(bounds);
            const visibleChunks = this._getIntersectingChunks(chunkIndex, rect);
            const loadedChunks = this._loadedChunks.get(mapId) || new Map();

            // Detect zoom level change — different zoom may need different chunk variants
            const lastZoom = state._lastZoom;
            const zoomBandChanged = lastZoom != null && this._zoomBandChanged(mapId, lastZoom, zoom);

            const visibleIds = new Set(visibleChunks.map(c => c.id));
            const loadedIds = new Set(loadedChunks.keys());

            const toLoad = visibleChunks.filter(c => !loadedIds.has(c.id));
            const toUnload = [...loadedIds].filter(id => !visibleIds.has(id));

            // If zoom band changed, force full reload with new variants
            const needFullReload = zoomBandChanged;

            if (!needFullReload && toLoad.length === 0 && toUnload.length === 0) continue;

            state.loading = true;
            this._emitSpatialLoadingChange(mapId, state, true, needFullReload ? 'lod' : 'viewport');

            try {
                const rendered = this._renderedFeatures.get(mapId) || new Map();
                const chunkDataCache = this._chunkDataCache.get(mapId) || new Map();

                if (needFullReload) {
                    // Zoom band changed — clear all rendered features and reload
                    console.log(`[MapController] Zoom band changed for ${mapId} (${lastZoom?.toFixed(1)} → ${zoom.toFixed(1)}), reloading`);

                    // Remove all rendered features
                    for (const [fKey, layer] of rendered) {
                        state.group.removeLayer(layer);
                    }
                    rendered.clear();
                    state.geoJsonLayers = [];
                    state.labelEntries = [];
                    loadedChunks.clear();

                    // Clear chunk data cache when zoom band changes (different variants needed)
                    chunkDataCache.clear();

                    // Load visible chunks with correct zoom variants
                    const concurrency = this.getChunkLoadConcurrency(state.config);
                    const chunkResults = await this._mapWithConcurrency(visibleChunks, concurrency, async (chunk) => {
                        const chunkFile = this._resolveChunkFile(mapId, chunk, zoom);
                        const features = await this._loadChunkFGBCached(mapId, chunkFile, zoom);
                        return { chunk, chunkFile, features };
                    });
                    for (const result of chunkResults) {
                        const { chunk, chunkFile, features } = result;
                        for (const feature of features) {
                            const fKey = this._featureKey(chunk.id, feature);
                            if (!rendered.has(fKey)) {
                                const layer = this.addFeatureToLayer(state, feature, state.config.style, state.config.labelProperty, state.config);
                                rendered.set(fKey, layer);
                            }
                        }
                        loadedChunks.set(chunk.id, { file: chunkFile, chunk });
                    }
                    this._recordLoadMetric('chunked-viewport-reload', {
                        mapId,
                        reason: 'zoom-band-changed',
                        chunkCount: visibleChunks.length,
                        concurrency,
                        durationMs: this._elapsedMs(updateStart)
                    });
                } else {
                    // Same zoom band — incremental per-chunk load/unload

                    // Unload chunks that left viewport
                    for (const chunkId of toUnload) {
                        // Remove features belonging to this chunk
                        for (const [fKey, layer] of rendered) {
                            if (fKey.startsWith(chunkId + '::')) {
                                state.group.removeLayer(layer);
                                rendered.delete(fKey);
                            }
                        }
                        loadedChunks.delete(chunkId);
                    }
                    if (toUnload.length > 0) {
                        // Rebuild geoJsonLayers array from rendered features
                        state.geoJsonLayers = [...rendered.values()].filter(l => l);
                        console.log(`[MapController] Unloaded ${toUnload.length} chunks from ${mapId}`);
                    }

                    // Load new chunks entering viewport
                    const concurrency = this.getChunkLoadConcurrency(state.config);
                    const chunkResults = await this._mapWithConcurrency(toLoad, concurrency, async (chunk) => {
                        const chunkFile = this._resolveChunkFile(mapId, chunk, zoom);
                        const features = await this._loadChunkFGBCached(mapId, chunkFile, zoom);
                        return { chunk, chunkFile, features };
                    });
                    for (const result of chunkResults) {
                        const { chunk, chunkFile, features } = result;
                        for (const feature of features) {
                            const fKey = this._featureKey(chunk.id, feature);
                            if (!rendered.has(fKey)) {
                                const layer = this.addFeatureToLayer(state, feature, state.config.style, state.config.labelProperty, state.config);
                                rendered.set(fKey, layer);
                            }
                        }
                        loadedChunks.set(chunk.id, { file: chunkFile, chunk });
                        console.log(`[MapController] Loaded chunk ${chunk.id} for ${mapId} (${features.length} features)`);
                    }
                    this._recordLoadMetric('chunked-viewport-reload', {
                        mapId,
                        reason: 'viewport-update',
                        loadedChunkCount: toLoad.length,
                        unloadedChunkCount: toUnload.length,
                        concurrency,
                        durationMs: this._elapsedMs(updateStart)
                    });
                }

                state._lastZoom = zoom;
                state.loading = false;
                this.updateLabels();
            } catch (err) {
                console.warn(`[MapController] Chunk update failed for ${mapId}:`, err);
                state.loading = false;
            } finally {
                this._emitSpatialLoadingChange(mapId, state, false, needFullReload ? 'lod' : 'viewport');
            }
        }
    }

    /**
     * Schedule a debounced check for non-chunked LOD maps.
     * Fires on both moveend and zoomend for reliable mobile coverage.
     */
    _scheduleNonChunkedLODCheck() {
        if (this._lodCheckPending) return;
        this._lodCheckPending = true;
        setTimeout(() => {
            this._lodCheckPending = false;
            this._checkNonChunkedLOD();
        }, 200);
    }

    /**
     * Check non-chunked LOD maps for zoom-level changes that require reloading
     * with a different LOD file (e.g. switching from lod0 to full resolution).
     */
    async _checkNonChunkedLOD() {
        const zoom = this.map.getZoom();
        for (const [mapId, state] of this.layerStates) {
            if (!state.visible || !state.loaded) continue;
            if (this.spatialLayers.has(mapId)) continue; // chunked maps handled by updateSpatialLayers
            const mapConfig = state.config;
            if (!mapConfig?.useLOD) continue;

            const currentLOD = this.currentLOD.get(mapId);
            const newLOD = this.getLODLevel(zoom);
            if (currentLOD === newLOD) continue;

            // Skip if already reloading — but schedule a re-check for when it finishes
            if (state.loading) {
                console.log(`[MapController] LOD check skipped for ${mapId} (loading), will re-check`);
                continue;
            }

            console.log(`[MapController] LOD change for ${mapId}: ${currentLOD} → ${newLOD} at zoom ${zoom}`);
            this.currentLOD.set(mapId, newLOD);

            const baseFgbPath = state.fgbPath;
            const newFilePath = this.getPreferredVectorFilePath(mapConfig, baseFgbPath, zoom);
            console.log(`[MapController] LOD reloading ${mapId} from ${newFilePath}`);

            state.loading = true;
            try {
                const features = await this.loadDataFile(newFilePath, (progress) => {
                    state.progress = progress;
                    if (this.onLoadProgress) this.onLoadProgress(mapId, progress);
                });

                const geojsonData = Array.isArray(features)
                    ? { type: 'FeatureCollection', features }
                    : features;

                // Remove old GeoJSON layers
                for (const layer of state.geoJsonLayers) {
                    state.group.removeLayer(layer);
                }
                state.geoJsonLayers = [];
                state.labelEntries = [];

                // Recreate with new LOD data
                const style = mapConfig.style;
                const labelProperty = mapConfig.labelProperty;
                const geoJsonLayer = L.geoJSON(geojsonData, {
                    style: (feature) => {
                        if (feature.geometry?.type === 'Point') return {};
                        return {
                            color: style?.color || '#3388ff',
                            weight: style?.weight || 2,
                            fillOpacity: style?.fillOpacity ?? 0,
                            opacity: 1
                        };
                    },
                    pointToLayer: (feature, latlng) => {
                        return this.createPointMarker(latlng, style);
                    },
                    onEachFeature: (feature, layer) => {
                        layer._mapId = mapId;
                        this._attachFeatureHoverHandlers(layer);
                        this._attachHistoricPointDblClick(mapConfig, mapId, feature, layer);
                        if (labelProperty && feature.properties?.[labelProperty]) {
                            const labelText = this.cleanLabelText(
                                feature.properties[labelProperty],
                                mapConfig.labelCleanup
                            );
                            if (labelText && (layer.getBounds || layer.getLatLng)) {
                                const priorityProp = mapConfig.priorityProperty || mapConfig.significanceProperty;
                                const priority = priorityProp ? (parseFloat(feature.properties[priorityProp]) || 0) : 0;
                                state.labelEntries.push({ layer, feature, text: labelText, color: style?.color || '#3388ff', priority });
                            }
                        }
                    }
                });

                geoJsonLayer.addTo(state.group);
                state.geoJsonLayers.push(geoJsonLayer);
                state.featureCount = geojsonData.features?.length || 0;

                this._recordLoadMetric('lod-zoom-reload', {
                    mapId,
                    zoom,
                    source: newFilePath,
                    lodLevel: newLOD,
                    previousLodLevel: currentLOD
                });

                this.updateLabels();
                console.log(`[MapController] Reloaded ${mapId} at LOD ${newLOD} (${geojsonData.features?.length} features)`);
            } catch (err) {
                console.warn(`[MapController] LOD reload failed for ${mapId}:`, err);
                // Revert LOD tracking so next check retries
                if (currentLOD !== undefined) {
                    this.currentLOD.set(mapId, currentLOD);
                } else {
                    this.currentLOD.delete(mapId);
                }
            } finally {
                state.loading = false;
            }

            // Re-check in case zoom changed during the async load
            const postZoom = this.map.getZoom();
            if (this.getLODLevel(postZoom) !== newLOD) {
                console.log(`[MapController] Zoom changed during LOD load for ${mapId}, scheduling re-check`);
                this._scheduleNonChunkedLODCheck();
            }
        }
    }

    /**
     * Check if zoom change crosses a zoom band boundary.
     * Zoom bands correspond to the build-time zoom level thresholds.
     */
    _zoomBandChanged(mapId, oldZoom, newZoom) {
        const getBand = (z) => {
            if (this._isTownlandMap(mapId)) {
                if (z <= 7) return 0;   // overview LOD
                if (z <= 9) return 1;   // z10 chunk variant
                return 2;               // full chunk geometry
            }
            if (z <= 8) return 0;   // z7 variant
            if (z <= 11) return 1;  // z10 variant
            return 2;               // full
        };
        return getBand(oldZoom) !== getBand(newZoom);
    }

    /**
     * Check if outer rect fully contains inner rect
     */
    _rectContains(outer, inner) {
        return inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
            inner.minY >= outer.minY && inner.maxY <= outer.maxY;
    }

    /**
     * Get the minimum feature bbox diagonal (in degrees) that would be visible
     * at the given zoom level. Features smaller than this are filtered out.
     * Uses ~4 pixels as the visibility threshold.
     *
     * At zoom 0, one tile = 360°/256px ≈ 1.406°/px
     * At zoom z, degrees/px = 360 / (256 * 2^z)
     * Minimum visible diagonal = 4px * degrees/px
     */
    getMinFeatureDiagDeg(zoom) {
        const MIN_PIXELS = 4;
        const degreesPerPixel = 360 / (256 * Math.pow(2, zoom));
        return MIN_PIXELS * degreesPerPixel;
    }

    /**
     * Compute the bounding box diagonal of a GeoJSON geometry in degrees.
     * Fast approximation — walks coordinates to find extent.
     */
    computeFeatureBboxDiag(geometry) {
        if (!geometry || !geometry.coordinates) return Infinity; // Points always pass
        if (geometry.type === 'Point') return Infinity; // Points always visible

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        const walk = (coords) => {
            if (typeof coords[0] === 'number') {
                if (coords[0] < minX) minX = coords[0];
                if (coords[0] > maxX) maxX = coords[0];
                if (coords[1] < minY) minY = coords[1];
                if (coords[1] > maxY) maxY = coords[1];
            } else {
                for (const c of coords) walk(c);
            }
        };

        walk(geometry.coordinates);
        const dx = maxX - minX;
        const dy = maxY - minY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Load a data file (FGB or GeoJSON)
     */
    async loadDataFile(filePath, onProgress = null, signal = null) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const start = this._now();

        if (ext === 'fgb') {
            const data = await this.loadFlatGeobuf(filePath, onProgress, signal);
            this._recordLoadMetric('data-file-loaded', {
                source: filePath,
                kind: 'fgb',
                featureCount: Array.isArray(data) ? data.length : null,
                durationMs: this._elapsedMs(start)
            });
            return data;
        } else {
            const response = await fetch(filePath, signal ? { signal } : undefined);
            const data = await response.json();
            this._recordLoadMetric('data-file-loaded', {
                source: filePath,
                kind: ext || 'json',
                featureCount: Array.isArray(data?.features) ? data.features.length : null,
                durationMs: this._elapsedMs(start)
            });
            return data;
        }
    }

    /**
     * Load FlatGeobuf file (full download via fetch, no range requests).
     * Load a map layer with a feature filter function applied.
     * Creates a standalone layer entry that appears in Active Layers.
     */
    async loadLayerFilteredByIndex(layerId, sourceMapConfig, indexSet, displayName = null) {
        const fgbPath = sourceMapConfig.files?.fgb;
        if (!fgbPath) return null;
        const features = await this.loadFlatGeobuf(fgbPath);
        const filtered = features.filter((_, i) => indexSet.has(i));
        console.log(`[MapController] loadLayerFilteredByIndex ${layerId}: ${filtered.length}/${features.length} features`);
        return this._createFilteredLayer(layerId, sourceMapConfig, filtered, displayName);
    }

    async loadLayerFiltered(layerId, sourceMapConfig, filterFn, displayName = null) {
        const fgbPath = sourceMapConfig.files?.fgb;
        if (!fgbPath) return null;
        const features = await this.loadFlatGeobuf(fgbPath);
        const filtered = features.filter(filterFn);
        console.log(`[MapController] loadLayerFiltered ${layerId}: ${filtered.length}/${features.length} features`);
        return this._createFilteredLayer(layerId, sourceMapConfig, filtered, displayName);
    }

    _createFilteredLayer(layerId, sourceMapConfig, filtered, displayName) {
        const state = {
            id: layerId,
            config: { ...sourceMapConfig, id: layerId, name: displayName || sourceMapConfig.name },
            group: L.layerGroup(),
            geoJsonLayers: [],
            labelEntries: [],
            loaded: true,
            loading: false,
            visible: true,
            progress: 100,
            useSpatial: false,
            baseLoaded: true,
            featureNames: new Map(),
            featureLayers: new Map(),
            featureVisibility: new Map()
        };
        this.layerStates.set(layerId, state);

        for (const feature of filtered) {
            this.addFeatureToLayer(state, feature, sourceMapConfig.style,
                sourceMapConfig.labelProperty, sourceMapConfig);
        }

        state.group.addTo(this.map);
        state.visible = true;
        return state;
    }

    /**
     * Delegates to Web Worker when available, falls back to main-thread parsing.
     */
    /**
     * Rewrite `https://data.civgraph.net/...` → `/_r/...` when running on
     * localhost, so dev-server CORS proxy handles the cross-origin fetch.
     * Accepts non-matching URLs unchanged.
     */
    _rewriteForDevProxy(url) {
        if (typeof url !== 'string') return url;
        if (typeof window === 'undefined') return url;
        if (window.location?.hostname !== 'localhost') return url;
        if (url.startsWith('https://data.civgraph.net/')) {
            return '/_r/' + url.slice('https://data.civgraph.net/'.length);
        }
        if (url.startsWith('http://data.civgraph.net/')) {
            return '/_r/' + url.slice('http://data.civgraph.net/'.length);
        }
        return url;
    }

    async loadFlatGeobuf(url, onProgress = null, signal = null) {
        const start = this._now();

        // Dev proxy: rewrite remote URLs to go through local CORS proxy on localhost
        url = this._rewriteForDevProxy(url);

        // Try Web Worker path (offloads parsing from main thread)
        if (this._fgbWorkerReady && this._fgbWorker) {
            try {
                const result = await this._parseFgbInWorker(url);
                this._recordLoadMetric('flatgeobuf-loaded', {
                    source: url,
                    featureCount: result.featureCount,
                    durationMs: result.durationMs,
                    compressed: result.compressed,
                    worker: true
                });
                return result.features;
            } catch (workerErr) {
                console.warn(`[MapController] Worker FGB parse failed for ${url}, falling back to main thread:`, workerErr);
            }
        }

        // Main-thread fallback
        const loadFromSource = async (source) => {
            const features = [];
            let featureCount = 0;

            for await (const feature of flatgeobuf.deserialize(source)) {
                features.push(feature);
                featureCount++;

                if (onProgress && featureCount % 100 === 0) {
                    const estimatedProgress = Math.min(90, Math.log10(featureCount) * 30);
                    onProgress(estimatedProgress);
                }
            }

            return features;
        };

        // Try pre-compressed .fgb.gz first (client-side Pako decompression)
        if (typeof pako !== 'undefined' && url.toLowerCase().endsWith('.fgb')) {
            try {
                const gzResponse = await fetch(url + '.gz', signal ? { signal } : undefined);
                if (gzResponse.ok) {
                    const compressed = new Uint8Array(await gzResponse.arrayBuffer());
                    const decompressed = pako.ungzip(compressed);
                    const data = await loadFromSource(decompressed);
                    this._recordLoadMetric('flatgeobuf-loaded', {
                        source: url + '.gz',
                        featureCount: data.length,
                        durationMs: this._elapsedMs(start),
                        compressed: true
                    });
                    return data;
                }
            } catch (gzErr) {
                // .gz not available or decompression failed — fall back to uncompressed
            }
        }

        const response = await fetch(url, signal ? { signal } : undefined);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

        // Primary path: stream parsing (lower memory footprint).
        if (response.body) {
            try {
                const data = await loadFromSource(response.body);
                this._recordLoadMetric('flatgeobuf-loaded', {
                    source: url,
                    featureCount: data.length,
                    durationMs: this._elapsedMs(start)
                });
                return data;
            } catch (streamErr) {
                console.warn(`[MapController] Stream FGB parse failed for ${url}, retrying via ArrayBuffer:`, streamErr);
            }
        }

        // Fallback path: parse from full bytes for broader browser compatibility.
        const retryResponse = response.bodyUsed ? await fetch(url, signal ? { signal } : undefined) : response;
        if (!retryResponse.ok) throw new Error(`Failed to refetch ${url}: ${retryResponse.status}`);
        const bytes = new Uint8Array(await retryResponse.arrayBuffer());
        const data = await loadFromSource(bytes);
        this._recordLoadMetric('flatgeobuf-loaded', {
            source: url,
            featureCount: data.length,
            durationMs: this._elapsedMs(start)
        });
        return data;
    }

    /**
     * Clean label text based on cleanup rule
     */
    cleanLabelText(text, cleanupRule) {
        if (!text || typeof text !== 'string') return text;

        if (cleanupRule === 'stripTrailingBracketNumber') {
            return text.replace(/\s*\([^()]*\)\s*$/, '').trim();
        }

        if (cleanupRule && typeof cleanupRule === 'object' && cleanupRule.type === 'mapValues') {
            const mapped = cleanupRule.map?.[text];
            if (typeof mapped === 'string' && mapped.trim()) {
                return mapped.trim();
            }
        }

        return text;
    }

    /**
     * Show a loaded layer
     */
    showLayer(id) {
        const state = this.layerStates.get(id);
        if (!state || !state.loaded || !this.map) return;

        if (!this.map.hasLayer(state.group)) {
            state.group.addTo(this.map);
            const idx = this._layerOrder.indexOf(id);
            if (idx >= 0) this._layerOrder.splice(idx, 1);
            this._layerOrder.push(id);
        }
        state.visible = true;
        this.updateLabels();
    }

    /**
     * Hide a layer
     */
    hideLayer(id) {
        const state = this.layerStates.get(id);
        if (!state || !this.map) return;

        if (this.map.hasLayer(state.group)) {
            this.map.removeLayer(state.group);
        }
        const idx = this._layerOrder.indexOf(id);
        if (idx >= 0) this._layerOrder.splice(idx, 1);
        this._clearHoverCandidatesForMap(id);
        state.visible = false;
        this.updateLabels();
    }

    /**
     * Snapshot of currently visible layers in z-order (bottom to top).
     */
    getVisibleLayerOrder() {
        return this._layerOrder.filter(id => this.layerStates.get(id)?.visible);
    }

    /**
     * Apply a z-order to currently visible layers by calling bringToFront
     * on each in sequence (bottom to top). IDs not present as visible layers
     * are ignored; visible layers not in the list keep their relative position
     * at the top of the stack.
     */
    applyLayerOrder(orderedIds) {
        const seen = new Set();
        for (const id of orderedIds) {
            if (seen.has(id)) continue;
            seen.add(id);
            const state = this.layerStates.get(id);
            if (!state?.visible || !state.group) continue;
            state.group.eachLayer((layer) => {
                if (typeof layer.bringToFront === 'function') layer.bringToFront();
            });
        }
        const remaining = this._layerOrder.filter(id => !seen.has(id));
        this._layerOrder = [...remaining, ...orderedIds.filter(id => this.layerStates.get(id)?.visible)];
    }

    /**
     * Check if a layer is currently loaded
     */
    isLayerLoaded(id) {
        const state = this.layerStates.get(id);
        return state && state.loaded;
    }

    /**
     * Toggle layer visibility
     */
    toggleLayer(id) {
        const state = this.layerStates.get(id);
        if (!state) return;

        if (state.visible) {
            this.hideLayer(id);
        } else {
            this.showLayer(id);
        }
    }

    /**
     * Unload a layer completely
     */
    unloadLayer(id) {
        const state = this.layerStates.get(id);
        if (!state) return;

        this.hideLayer(id);
        this._clearHoverCandidatesForMap(id);
        this.layerStates.delete(id);
        const idx = this._layerOrder.indexOf(id);
        if (idx >= 0) this._layerOrder.splice(idx, 1);

        // Clean up spatial/LOD state if applicable
        if (this.spatialLayers.has(id)) {
            this.spatialLayers.delete(id);
            this.currentLOD.delete(id);
        }
        featureLoader.clearMap(id);

        this.updateLabels();
    }

    /**
     * Load a single feature (for search results)
     * Creates a partial layer containing only the selected feature
     */
    async loadSingleFeature(mapConfig, featureIndex, featureName = null, featureBbox = null) {
        const { id, style, labelProperty, name } = mapConfig;

        // Check if layer already exists
        let state = this.layerStates.get(id);

        if (!state) {
            // Create new partial layer state
            state = {
                id,
                config: mapConfig,
                group: L.layerGroup(),
                geoJsonLayers: [],
                labelEntries: [],
                loaded: true,
                loading: false,
                visible: false,
                progress: 100,
                useSpatial: false,
                isPartial: true,              // Flag: this is a partial load
                loadedIndices: new Set(),     // Track which features are loaded
                featureNames: new Map(),      // Track feature names for display
                featureLayers: new Map(),     // featureIndex -> L.GeoJSON layer
                featureVisibility: new Map(), // featureIndex -> visible boolean
                baseLoaded: false
            };
            this.layerStates.set(id, state);
        } else {
            state.featureNames ||= new Map();
            state.featureLayers ||= new Map();
            state.featureVisibility ||= new Map();
            state.loadedIndices ||= new Set(state.featureLayers.keys());
        }

        // Check if this feature is already loaded
        if (state.featureLayers.has(featureIndex)) {
            // Extract the cached GeoJSON feature from the existing Leaflet layer
            // so callers (e.g. search-result click → info card) can re-display it.
            const existingLayer = state.featureLayers.get(featureIndex);
            let existingFeature = null;
            if (existingLayer && typeof existingLayer.eachLayer === 'function') {
                existingLayer.eachLayer((sub) => {
                    if (!existingFeature && sub?.feature) existingFeature = sub.feature;
                });
            }
            return { state, feature: existingFeature };
        }

        // Get the FGB file path
        let fgbPath = mapConfig.files?.fgb;
        if (!fgbPath && mapConfig.cloneOf) {
            const src = dataService.getMapById(mapConfig.cloneOf);
            fgbPath = src?.files?.fgb;
        }

        let loadedFeature = null;

        if (fgbPath && featureBbox) {
            // Load the full FGB and find the feature by bbox match
            const features = await this.loadFlatGeobuf(fgbPath);
            // Filter to features within the target bbox
            const bboxFeatures = features.filter(f => {
                const diag = this.computeFeatureBboxDiag(f.geometry);
                if (diag === Infinity) return true; // Points always match
                // Simple bbox overlap check
                return true; // FGB already has all features, match by name below
            });

            // Match by name if provided (bbox may return neighbours)
            if (featureName && features.length > 1) {
                loadedFeature = features.find(f => {
                    const lp = labelProperty || 'name';
                    return f.properties?.[lp]?.trim() === featureName.trim();
                }) || features[0];
            } else {
                loadedFeature = features[0];
            }
        }

        if (!loadedFeature) {
            // Fallback: try legacy per-feature JSON approach
            const zoom = this.map ? this.map.getZoom() : 10;
            const lod = this.getLODLevel(zoom);
            loadedFeature = await featureLoader.loadFeature(id, featureIndex, lod);
        }

        if (!loadedFeature) {
            console.warn(`[MapController] Failed to load feature ${featureIndex} from ${id}`);
            return null;
        }

        const featureStyle = {
            ...style,
            weight: (style?.weight || 2) + 1,
            radius: (style?.radius || 5) + 1
        };

        // Add the feature as an independent overlay instance instead of replacing the full map.
        const addedLayer = this.addFeatureToLayer(
            state,
            loadedFeature,
            featureStyle,
            labelProperty,
            mapConfig,
            {
                registerInGeoJsonLayers: false,
                // Partial-only feature loads need their own labels; additive feature loads
                // over a full base layer should not duplicate labels that already exist.
                registerLabels: !state.baseLoaded
            }
        );
        state.loadedIndices ||= new Set();
        state.loadedIndices.add(featureIndex);

        // Store feature metadata
        const resolvedName = featureName || loadedFeature?.properties?.[labelProperty] || `Feature ${featureIndex}`;
        state.featureNames.set(featureIndex, resolvedName);
        state.featureLayers.set(featureIndex, addedLayer);
        state.featureVisibility.set(featureIndex, true);
        state.loaded = true;

        // Show the layer
        this.showLayer(id);
        this.updateLabels();

        console.log(`[MapController] Loaded single feature ${featureIndex} from ${name} (partial load)`);
        return { state, feature: loadedFeature };
    }

    /**
     * Expand a partial layer to load the full map
     * Replaces individual features with the complete layer
     */
    async expandToFullMap(mapConfig) {
        const { id, name } = mapConfig;

        // Get current state
        const existingState = this.layerStates.get(id);
        const wasVisible = existingState?.visible ?? true;

        // Unload the partial layer
        if (existingState) {
            this.unloadLayer(id);
        }

        // Clear the feature loader cache for this map
        // This ensures all features are loaded fresh (including the one we had individually)
        featureLoader.clearMap(id);

        console.log(`[MapController] Expanding to full map: ${name}`);

        // Load the full map
        return this.loadLayer(mapConfig, wasVisible);
    }

    /**
     * Check if a layer is a partial load (individual features only)
     */
    isPartialLayer(id) {
        const state = this.layerStates.get(id);
        return state?.isPartial === true && state?.baseLoaded !== true;
    }

    /**
     * Get loaded feature names for a partial layer
     */
    getPartialFeatureNames(id) {
        const state = this.layerStates.get(id);
        if (!state?.featureNames) return [];
        return Array.from(state.featureNames.values());
    }

    getPartialFeatureItems(id) {
        const state = this.layerStates.get(id);
        if (!state?.featureLayers || state.featureLayers.size === 0) return [];
        const indices = state.loadedIndices ? Array.from(state.loadedIndices) : Array.from(state.featureLayers.keys());
        return indices
            .sort((a, b) => {
                const an = Number(a);
                const bn = Number(b);
                if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
                return String(a).localeCompare(String(b));
            })
            .map((index) => ({
                index,
                name: state.featureNames.get(index) || `Feature ${index}`,
                visible: state.featureVisibility.get(index) !== false
            }));
    }

    togglePartialFeature(mapId, featureIndex) {
        const state = this.layerStates.get(mapId);
        if (!state?.featureLayers) return;
        const featureLayer = state.featureLayers.get(featureIndex);
        if (!featureLayer) return;

        const currentlyVisible = state.featureVisibility.get(featureIndex) !== false;
        if (currentlyVisible) {
            state.group.removeLayer(featureLayer);
            state.featureVisibility.set(featureIndex, false);
        } else {
            state.group.addLayer(featureLayer);
            state.featureVisibility.set(featureIndex, true);
        }
        this.updateLabels();
    }

    unloadPartialFeature(mapId, featureIndex) {
        const state = this.layerStates.get(mapId);
        if (!state?.featureLayers) return;
        const featureLayer = state.featureLayers.get(featureIndex);
        if (!featureLayer) return;

        const removedLayers = new Set();
        featureLayer.eachLayer((l) => removedLayers.add(l));
        state.labelEntries = state.labelEntries.filter((entry) => !removedLayers.has(entry.layer));

        state.group.removeLayer(featureLayer);
        state.geoJsonLayers = state.geoJsonLayers.filter((layer) => layer !== featureLayer);
        state.loadedIndices.delete(featureIndex);
        state.featureLayers.delete(featureIndex);
        state.featureNames.delete(featureIndex);
        state.featureVisibility.delete(featureIndex);

        if (state.loadedIndices.size === 0 && !state.baseLoaded) {
            this.unloadLayer(mapId);
            return;
        }
        this.updateLabels();
    }

    isFeatureLoaded(mapId, featureIndex) {
        const state = this.layerStates.get(mapId);
        return !!state?.featureLayers?.has(featureIndex);
    }

    isFeatureVisible(mapId, featureIndex) {
        const state = this.layerStates.get(mapId);
        if (!state?.featureLayers?.has(featureIndex)) return false;
        return state.featureVisibility.get(featureIndex) !== false;
    }

    /**
     * Search features across all loaded layers by name
     * @param {string} query - search string
     * @param {number} limit - max results
     * @returns {Array<{mapId, name, bounds}>}
     */
    searchLoadedFeatures(query, limit = 8) {
        if (!query || !query.trim()) return [];
        const q = query.toLowerCase().trim();
        const results = [];

        for (const [mapId, state] of this.layerStates) {
            if (!state.loaded) continue;
            for (const entry of state.labelEntries) {
                if (entry.text && entry.text.toLowerCase().includes(q)) {
                    // Get bounds from the Leaflet layer
                    let bounds = null;
                    if (entry.layer.getBounds) {
                        try { bounds = entry.layer.getBounds(); } catch (_) { }
                    } else if (entry.layer.getLatLng) {
                        const ll = entry.layer.getLatLng();
                        bounds = L.latLngBounds(ll, ll);
                    }
                    results.push({ mapId, name: entry.text, bounds });
                    if (results.length >= limit) return results;
                }
            }
        }
        return results;
    }

    /**
     * Set transparency (stroke opacity) for all layers
     */
    setTransparency(value) {
        const opacity = 1 - (value / 100);
        this.strokeOpacity = opacity;
        this.layerStates.forEach(state => {
            state.group.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ opacity });
                }
            });
        });
    }

    /**
     * Set fill transparency for all layers
     */
    setFillTransparency(value) {
        const fillOpacity = 1 - (value / 100);
        this.fillOpacity = fillOpacity;
        this.layerStates.forEach(state => {
            state.group.eachLayer(layer => {
                if (!layer || typeof layer.setStyle !== 'function') return;
                if (!layer._baseStyle) {
                    const opts = layer.options || {};
                    layer._baseStyle = {
                        color: opts.color,
                        weight: opts.weight,
                        opacity: opts.opacity,
                        fillColor: opts.fillColor,
                        fillOpacity: opts.fillOpacity,
                        radius: opts.radius
                    };
                }
                layer._baseStyle.fillOpacity = fillOpacity;
                if (layer._hoverRestoreStyle) {
                    layer._hoverRestoreStyle.fillOpacity = fillOpacity;
                }
                layer.setStyle({ fillOpacity });
            });
        });
    }

    /**
     * Toggle labels on/off
     */
    setLabelsEnabled(enabled) {
        this.labelsEnabled = enabled;
        this.updateLabels();
    }

    /**
     * Hide/show labels for a specific layer (without affecting visibility)
     */
    setLayerLabelsHidden(mapId, hidden) {
        const state = this.layerStates.get(mapId);
        if (state) {
            state.labelsHidden = hidden;
            this.updateLabels();
        }
    }

    /**
     * Set text scale for labels
     */
    setTextScale(scale) {
        this.textScale = scale;
        this.updateLabels();
    }

    /**
     * Update visible labels with priority-based placement
     * Labels are placed in descending priority order, skipping any
     * that would overlap or overcrowd existing labels.
     */
    updateLabels() {
        if (!this.map) return;

        // Clear existing labels
        this.labelMarkers.forEach(m => this.map.removeLayer(m));
        this.labelMarkers = [];

        if (!this.labelsEnabled) return;

        const bounds = this.map.getBounds();
        const fontSize = Math.round(12 * (this.textScale / 100));
        const padding = 8; // Minimum spacing between labels in pixels

        // Track placed label bounding boxes for overlap detection
        const placedLabels = [];

        // Collect all visible label entries
        const allLabels = [];
        this.layerStates.forEach(state => {
            if (state.loaded && state.visible && !state.labelsHidden) {
                allLabels.push(...state.labelEntries);
            }
        });

        // Step 1: Sort by priority (descending) - higher priority labels first
        allLabels.sort((a, b) => (b.priority || 0) - (a.priority || 0));

        // Step 2-N: Try to place each label in priority order
        for (const info of allLabels) {
            // Handle both polygon layers (getBounds) and point layers (getLatLng)
            let layerBounds;
            let center;

            if (info.layer.getBounds) {
                layerBounds = info.layer.getBounds();
                if (!layerBounds || !bounds.intersects(layerBounds)) continue;
            } else if (info.layer.getLatLng) {
                center = info.layer.getLatLng();
                if (!bounds.contains(center)) continue;
                // Create a synthetic bounds for the point
                layerBounds = L.latLngBounds([center, center]);
            } else {
                continue;
            }

            try {
                // Get center point for label
                if (!center) {
                    if (typeof turf !== 'undefined') {
                        const pointOnFeature = turf.pointOnFeature(info.feature);
                        center = L.latLng(
                            pointOnFeature.geometry.coordinates[1],
                            pointOnFeature.geometry.coordinates[0]
                        );
                    } else {
                        center = layerBounds.getCenter();
                    }
                }

                // Convert to container coordinates for collision detection
                const containerPt = this.map.latLngToContainerPoint(center);

                // Calculate label dimensions more accurately
                // Use a slightly larger character width estimate to be conservative
                const charWidth = fontSize * 0.65;
                const lineHeight = fontSize * 1.5;
                const phi = 1.618;
                const totalTextWidth = info.text.length * charWidth;
                const area = totalTextWidth * lineHeight;
                const idealMaxWidth = Math.sqrt(area * phi);

                // Find longest word to ensure it fits without overflow
                const words = info.text.split(/\s+/);
                const longestWord = words.reduce((a, b) => a.length > b.length ? a : b, '');
                const minWidthForLongestWord = longestWord.length * charWidth + 10;
                const maxWidth = Math.max(minWidthForLongestWord, Math.min(180, Math.round(idealMaxWidth)));

                // Calculate actual label width (could be less than maxWidth if text is short)
                const actualLabelWidth = Math.min(totalTextWidth, maxWidth);

                // Estimate the number of lines by simulating word wrapping
                let currentLineWidth = 0;
                let numLines = 1;
                for (const word of words) {
                    const wordWidth = word.length * charWidth;
                    if (currentLineWidth + wordWidth > maxWidth && currentLineWidth > 0) {
                        numLines++;
                        currentLineWidth = wordWidth;
                    } else {
                        currentLineWidth += wordWidth + charWidth; // +charWidth for space
                    }
                }

                const labelHeight = numLines * lineHeight;

                // Create bounding box for this label
                // The label CSS uses: iconAnchor [0,0], left:50%, transform:translateX(-50%)
                // This means the label is centered horizontally on the point,
                // and extends downward from the point (top of label at anchor)
                const labelBox = {
                    left: containerPt.x - actualLabelWidth / 2 - padding,
                    right: containerPt.x + actualLabelWidth / 2 + padding,
                    top: containerPt.y - padding,
                    bottom: containerPt.y + labelHeight + padding
                };

                // Check for overlap with any existing labels
                const overlaps = placedLabels.some(existing =>
                    !(labelBox.right < existing.left ||
                        labelBox.left > existing.right ||
                        labelBox.bottom < existing.top ||
                        labelBox.top > existing.bottom)
                );

                // Skip this label if it would overlap with existing labels
                if (overlaps) continue;

                // No overlap - place the label
                placedLabels.push(labelBox);

                // Create label marker
                const marker = L.marker(center, {
                    icon: L.divIcon({
                        className: 'map-label map-label--clickable',
                        html: `<div style="color:${info.color};text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;font-weight:bold;font-size:${fontSize}px;text-align:center;width:${maxWidth}px;word-break:keep-all;overflow-wrap:normal;position:absolute;left:50%;transform:translateX(-50%);cursor:pointer;">${info.text}</div>`,
                        iconSize: null,
                        iconAnchor: [0, 0]
                    })
                });
                // Single-click on label triggers feature info
                marker.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (this.onFeatureClick) {
                        this.onFeatureClick([{
                            mapId: info.layer._mapId,
                            properties: info.feature?.properties,
                            geometry: info.feature?.geometry
                        }]);
                    }
                });
                marker.on('mouseover', () => this._setFeatureHover(info.layer, true));
                marker.on('mouseout', () => this._setFeatureHover(info.layer, false));
                marker.addTo(this.map);
                info.layer._labelMarker = marker;
                this.labelMarkers.push(marker);
            } catch (err) {
                // Ignore label placement errors
            }
        }
    }

    /**
     * Handle map click events
     */
    handleMapClick(e) {
        const clickLatLng = e.latlng;
        const clickPoint = this.map?.latLngToContainerPoint(clickLatLng);
        if (this._currentHoverLayer?._map && this._currentHoverLayer?.feature) {
            this._emitFeatureSelection(this._currentHoverLayer._mapId, this._currentHoverLayer.feature);
            return;
        }
        const featuresFound = [];
        let nearestPoint = null;
        let nearestPointDistance = Infinity;
        const zoom = this.map?.getZoom?.() ?? 10;
        // Wider tolerance at lower zooms to keep point selection usable.
        const pointPickPx = this._pointPickPx(zoom);
        const nearestFallbackPx = pointPickPx + 40;

        // Use the same signal as orange hover highlighting first.
        const hoveredCandidate = this._getHoverSelectionCandidate(clickPoint, pointPickPx);
        if (hoveredCandidate) {
            if (hoveredCandidate.mapId && hoveredCandidate.feature) {
                this._emitFeatureSelection(hoveredCandidate.mapId, hoveredCandidate.feature);
            } else if (this.onFeatureClick) {
                this.onFeatureClick([hoveredCandidate]);
            }
            return;
        }

        this.layerStates.forEach(state => {
            if (!state.loaded || !state.visible) return;

            this._forEachFeatureLayer(state, (layer) => {
                const geomType = layer.feature.geometry?.type;

                if (typeof layer.getLatLng === 'function') {
                    const featurePoint = this.map?.latLngToContainerPoint(layer.getLatLng());
                    const pixelDistance = (clickPoint && featurePoint) ? clickPoint.distanceTo(featurePoint) : Infinity;
                    if (pixelDistance < nearestPointDistance) {
                        nearestPointDistance = pixelDistance;
                        nearestPoint = {
                            mapId: layer._mapId,
                            properties: layer.feature.properties,
                            geometry: layer.feature.geometry
                        };
                    }
                    if (pixelDistance <= pointPickPx) {
                        featuresFound.push({
                            mapId: layer._mapId,
                            properties: layer.feature.properties,
                            geometry: layer.feature.geometry
                        });
                    }
                } else if (layer.getBounds?.().contains(clickLatLng)) {
                    // For polygons and lines, use point-in-polygon test.
                    if (typeof turf !== 'undefined' && geomType?.includes('Polygon')) {
                        const point = turf.point([clickLatLng.lng, clickLatLng.lat]);
                        if (turf.booleanPointInPolygon(point, layer.feature)) {
                            featuresFound.push({
                                mapId: layer._mapId,
                                properties: layer.feature.properties,
                                geometry: layer.feature.geometry
                            });
                        }
                    } else {
                        featuresFound.push({
                            mapId: layer._mapId,
                            properties: layer.feature.properties,
                            geometry: layer.feature.geometry
                        });
                    }
                }
            });
        });

        // Robust fallback for point features: if no point was captured within threshold,
        // still select the nearest visible point when it is reasonably close.
        if (featuresFound.length === 0 && nearestPoint && nearestPointDistance <= nearestFallbackPx) {
            featuresFound.push(nearestPoint);
        }

        if (this.onFeatureClick && featuresFound.length > 0) {
            this.onFeatureClick(featuresFound);
        }
    }

    _forEachFeatureLayer(state, callback) {
        if (!state?.group || typeof callback !== 'function') return;
        const walk = (layer) => {
            if (!layer) return;
            if (layer.feature) {
                callback(layer);
                return;
            }
            if (typeof layer.eachLayer === 'function') {
                layer.eachLayer(walk);
            }
        };
        state.group.eachLayer(walk);
    }

    _featureLayerBounds(layer) {
        if (!layer) return null;
        try {
            if (typeof layer.getBounds === 'function') {
                const bounds = layer.getBounds();
                if (bounds?.isValid?.()) return bounds;
            }
        } catch (_) { }
        try {
            if (typeof layer.getLatLng === 'function') {
                const ll = layer.getLatLng();
                if (ll) return L.latLngBounds(ll, ll);
            }
        } catch (_) { }
        return null;
    }

    _matchesFeatureLayer(layer, featureId, options = {}) {
        if (!layer?.feature) return false;
        if (featureId !== undefined && featureId !== null && layer.feature?.id === featureId) {
            return true;
        }

        const featureName = options?.featureName;
        const labelProperty = options?.labelProperty;
        if (featureName && labelProperty && layer.feature?.properties?.[labelProperty] === featureName) {
            return true;
        }
        if (featureName && options?.labelPropertyFallbacks?.length) {
            for (const key of options.labelPropertyFallbacks) {
                if (layer.feature?.properties?.[key] === featureName) return true;
            }
        }

        const bbox = options?.bbox;
        if (Array.isArray(bbox) && bbox.length === 4) {
            const layerBounds = this._featureLayerBounds(layer);
            if (layerBounds?.isValid?.()) {
                const targetBounds = L.latLngBounds(
                    [bbox[1], bbox[0]],
                    [bbox[3], bbox[2]]
                );
                if (layerBounds.intersects(targetBounds) || targetBounds.contains(layerBounds.getCenter())) {
                    return true;
                }
            }
        }

        return false;
    }

    highlightFeature(mapId, featureId, options = {}) {
        const state = this.layerStates.get(mapId);
        if (!state) return false;

        const matches = [];
        this._forEachFeatureLayer(state, (layer) => {
            if (this._matchesFeatureLayer(layer, featureId, options)) {
                matches.push(layer);
            }
        });

        const targets = matches.length > 0 ? matches : [];
        if (targets.length === 0) return false;

        targets.forEach((layer) => {
            this._setFeatureHover(layer, true);
            setTimeout(() => this._setFeatureHover(layer, false), 2000);
        });
        return true;
    }

    findFeatureLayer(mapId, featureId, options = {}) {
        const state = this.layerStates.get(mapId);
        if (!state) return null;

        let match = null;
        this._forEachFeatureLayer(state, (layer) => {
            if (!match && this._matchesFeatureLayer(layer, featureId, options)) {
                match = layer;
            }
        });

        return match;
    }

    /**
     * Fit map to layer bounds
     */
    fitToLayer(id) {
        const state = this.layerStates.get(id);
        if (!state || !this.map) return;

        try {
            const bounds = state.group.getBounds();
            if (bounds.isValid()) {
                this.map.fitBounds(bounds, { padding: [20, 20] });
                return;
            }
        } catch (err) {
            // Ignore bounds errors
        }

        const cfgBounds = state.config?.bounds;
        if (Array.isArray(cfgBounds) && cfgBounds.length === 2) {
            this.map.fitBounds(cfgBounds, { padding: [20, 20] });
        }
    }

    /**
     * Get layer state
     */
    getLayerState(id) {
        return this.layerStates.get(id);
    }

    /**
     * Check if layer is visible
     */
    isLayerVisible(id) {
        return this.layerStates.get(id)?.visible || false;
    }

    /**
     * Get all visible layer IDs
     */
    getVisibleLayers() {
        const visible = [];
        this.layerStates.forEach((state, id) => {
            if (state.visible) visible.push(id);
        });
        return visible;
    }

    /**
     * Get current map state for URL
     */
    getMapState() {
        const center = this.map?.getCenter();
        const zoom = this.map?.getZoom();
        return {
            layers: this.getVisibleLayers(),
            zoom: zoom,
            lat: center?.lat?.toFixed(4),
            lng: center?.lng?.toFixed(4),
            baseMap: this.currentBaseMapId
        };
    }

    /**
     * Apply map state from URL
     */
    applyMapState(state) {
        if (state.baseMap) {
            this.setBaseMap(state.baseMap);
        }
        if (state.lat && state.lng && state.zoom) {
            this.map?.setView([parseFloat(state.lat), parseFloat(state.lng)], parseInt(state.zoom));
        }
    }

    /**
     * Get loaded polygon/multipolygon layers only
     * @returns {Array<{id, name, state}>}
     */
    getPolygonLayers() {
        const result = [];
        this.layerStates.forEach((state, id) => {
            const gType = (state.geometryType || '').toLowerCase();
            if (gType.includes('polygon') && state.loaded) {
                result.push({ id, name: state.config?.name || id, state });
            }
        });
        return result;
    }

    /**
     * Get numeric attribute stats for a loaded layer's features.
     * Returns { attributes: [{name, min, max}], featureCount }
     */
    getLayerFeatureProperties(layerId) {
        const state = this.layerStates.get(layerId);
        if (!state || !state.loaded) return null;

        const attrStats = new Map(); // name -> {min, max}
        let featureCount = 0;

        state.geoJsonLayers.forEach(gjLayer => {
            gjLayer.eachLayer(layer => {
                featureCount++;
                const props = layer.feature?.properties;
                if (!props) return;
                for (const [key, val] of Object.entries(props)) {
                    if (typeof val !== 'number' || isNaN(val)) continue;
                    if (!attrStats.has(key)) {
                        attrStats.set(key, { min: val, max: val });
                    } else {
                        const s = attrStats.get(key);
                        if (val < s.min) s.min = val;
                        if (val > s.max) s.max = val;
                    }
                }
            });
        });

        return {
            attributes: Array.from(attrStats.entries()).map(([name, s]) => ({
                name, min: s.min, max: s.max
            })),
            featureCount
        };
    }

    /**
     * Apply a style function to a loaded layer
     */
    applyLayerStyle(layerId, styleFn) {
        const state = this.layerStates.get(layerId);
        if (!state) return;
        state._activeStyleFn = styleFn; // Persist for dynamically-loaded chunks
        state.geoJsonLayers.forEach(gjLayer => {
            gjLayer.setStyle(styleFn);
        });
    }

    /**
     * Reset a layer to its original config style
     */
    resetLayerStyle(layerId) {
        const state = this.layerStates.get(layerId);
        if (!state) return;
        delete state._activeStyleFn; // Clear persistent style
        const style = state.config?.style;
        state.geoJsonLayers.forEach(gjLayer => {
            gjLayer.setStyle(feature => {
                if (feature.geometry?.type === 'Point') return {};
                return {
                    color: style?.color || '#3388ff',
                    weight: style?.weight || 2,
                    fillOpacity: style?.fillOpacity ?? 0,
                    opacity: 1
                };
            });
        });
    }
    // === TEMPORARY: Raster offset + GCP placement tool ===
    _addRasterOffsetTool(overlay, originalBounds, mapId) {
        const existing = document.getElementById('raster-offset-tool');
        if (existing) existing.remove();

        const sw = L.latLng(originalBounds[0][0], originalBounds[0][1]);
        const ne = L.latLng(originalBounds[1][0], originalBounds[1][1]);
        let latOff = 0, lngOff = 0;

        // GCP state
        const gcps = []; // [{raster: {lat,lng}, vector: {lat,lng}}]
        const gcpMarkers = []; // Leaflet markers/lines
        let gcpMode = false;
        let pendingRasterClick = null; // waiting for second click

        const panel = document.createElement('div');
        panel.id = 'raster-offset-tool';
        panel.innerHTML = `
            <div style="position:fixed;bottom:20px;right:20px;z-index:10000;background:#1a1a2e;color:#e0e0e0;
                padding:14px;border-radius:8px;font-family:monospace;font-size:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);
                border:1px solid #333;min-width:320px;max-width:400px;max-height:85vh;overflow-y:auto;user-select:none;">

                <div style="font-weight:bold;margin-bottom:8px;color:#7eb8da;font-size:14px;">Raster Georef Tools</div>

                <!-- OFFSET SECTION -->
                <details open style="margin-bottom:10px;">
                    <summary style="cursor:pointer;color:#aaa;font-size:11px;margin-bottom:6px;">Offset Tool</summary>
                    <div style="margin-bottom:6px;">
                        <label>Lat: <input type="number" id="rot-lat" value="0" step="0.001" style="width:90px;background:#111;color:#fff;border:1px solid #555;padding:2px 4px;font-size:11px;"></label>
                        <span id="rot-lat-m" style="color:#888;margin-left:4px;font-size:11px;">0m</span>
                    </div>
                    <div style="margin-bottom:6px;">
                        <label>Lng: <input type="number" id="rot-lng" value="0" step="0.001" style="width:90px;background:#111;color:#fff;border:1px solid #555;padding:2px 4px;font-size:11px;"></label>
                        <span id="rot-lng-m" style="color:#888;margin-left:4px;font-size:11px;">0m</span>
                    </div>
                    <div style="margin-bottom:6px;">
                        <label>Step: <select id="rot-step" style="background:#111;color:#fff;border:1px solid #555;padding:2px;font-size:11px;">
                            <option value="0.01">~1110m</option>
                            <option value="0.005">~555m</option>
                            <option value="0.002">~222m</option>
                            <option value="0.001" selected>~111m</option>
                            <option value="0.0005">~56m</option>
                            <option value="0.0002">~22m</option>
                            <option value="0.0001">~11m</option>
                        </select></label>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:3px;width:110px;margin:6px auto;">
                        <div></div><button id="rot-n" style="padding:3px 6px;cursor:pointer;">N</button><div></div>
                        <button id="rot-w" style="padding:3px 6px;cursor:pointer;">W</button>
                        <button id="rot-reset" style="padding:3px 6px;cursor:pointer;font-size:9px;">0</button>
                        <button id="rot-e" style="padding:3px 6px;cursor:pointer;">E</button>
                        <div></div><button id="rot-s" style="padding:3px 6px;cursor:pointer;">S</button><div></div>
                    </div>
                </details>

                <!-- GCP SECTION -->
                <details open>
                    <summary style="cursor:pointer;color:#aaa;font-size:11px;margin-bottom:6px;">GCP Placement</summary>
                    <div style="margin-bottom:6px;font-size:11px;color:#ccc;">
                        Click 1: where the raster feature <b style="color:#ff6b6b;">IS</b><br>
                        Click 2: where it <b style="color:#4caf50;">SHOULD BE</b>
                    </div>
                    <div style="margin-bottom:8px;">
                        <button id="gcp-toggle" style="padding:4px 12px;cursor:pointer;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;font-size:12px;">
                            Start placing GCPs
                        </button>
                        <button id="gcp-undo" style="padding:4px 8px;cursor:pointer;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;font-size:11px;margin-left:4px;">
                            Undo
                        </button>
                        <button id="gcp-clear" style="padding:4px 8px;cursor:pointer;background:#333;color:#e0e0e0;border:1px solid #555;border-radius:4px;font-size:11px;margin-left:4px;">
                            Clear
                        </button>
                    </div>
                    <div id="gcp-status" style="font-size:11px;color:#888;margin-bottom:6px;"></div>
                    <div id="gcp-list" style="font-size:10px;color:#ccc;max-height:200px;overflow-y:auto;margin-bottom:6px;"></div>
                    <div style="margin-top:6px;">
                        <button id="gcp-copy" style="padding:4px 12px;cursor:pointer;background:#1a3a4a;color:#7eb8da;border:1px solid #555;border-radius:4px;font-size:11px;">
                            Copy GCPs to clipboard
                        </button>
                    </div>
                </details>
            </div>
        `;
        document.body.appendChild(panel);

        // === OFFSET LOGIC ===
        const latInput = document.getElementById('rot-lat');
        const lngInput = document.getElementById('rot-lng');
        const latM = document.getElementById('rot-lat-m');
        const lngM = document.getElementById('rot-lng-m');
        const stepSel = document.getElementById('rot-step');

        const updateOffset = () => {
            const newSW = L.latLng(sw.lat + latOff, sw.lng + lngOff);
            const newNE = L.latLng(ne.lat + latOff, ne.lng + lngOff);
            overlay.setBounds(L.latLngBounds(newSW, newNE));
            latInput.value = latOff.toFixed(6);
            lngInput.value = lngOff.toFixed(6);
            latM.textContent = `${(latOff * 111320).toFixed(0)}m`;
            lngM.textContent = `${(lngOff * 111320 * Math.cos(54.7 * Math.PI / 180)).toFixed(0)}m`;
        };

        const getStep = () => parseFloat(stepSel.value);
        document.getElementById('rot-n').onclick = () => { latOff += getStep(); updateOffset(); };
        document.getElementById('rot-s').onclick = () => { latOff -= getStep(); updateOffset(); };
        document.getElementById('rot-e').onclick = () => { lngOff += getStep(); updateOffset(); };
        document.getElementById('rot-w').onclick = () => { lngOff -= getStep(); updateOffset(); };
        document.getElementById('rot-reset').onclick = () => { latOff = 0; lngOff = 0; updateOffset(); };
        latInput.onchange = () => { latOff = parseFloat(latInput.value) || 0; updateOffset(); };
        lngInput.onchange = () => { lngOff = parseFloat(lngInput.value) || 0; updateOffset(); };
        updateOffset();

        // === GCP LOGIC ===
        const gcpToggle = document.getElementById('gcp-toggle');
        const gcpStatus = document.getElementById('gcp-status');
        const gcpList = document.getElementById('gcp-list');
        const map = this.map;

        const redIcon = L.divIcon({
            className: '',
            html: '<div style="width:12px;height:12px;background:#ff6b6b;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [12, 12], iconAnchor: [6, 6]
        });
        const greenIcon = L.divIcon({
            className: '',
            html: '<div style="width:12px;height:12px;background:#4caf50;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>',
            iconSize: [12, 12], iconAnchor: [6, 6]
        });

        const updateGcpList = () => {
            gcpStatus.textContent = `${gcps.length} GCP pair(s) placed`;
            gcpList.innerHTML = gcps.map((g, i) => {
                const dLat = (g.vector.lat - g.raster.lat) * 111320;
                const dLng = (g.vector.lng - g.raster.lng) * 111320 * Math.cos(54.7 * Math.PI / 180);
                const dist = Math.sqrt(dLat*dLat + dLng*dLng);
                return `<div style="margin-bottom:3px;padding:2px 4px;background:#111;border-radius:3px;">
                    #${i+1}: <span style="color:#ff6b6b;">(${g.raster.lat.toFixed(5)},${g.raster.lng.toFixed(5)})</span>
                    &rarr; <span style="color:#4caf50;">(${g.vector.lat.toFixed(5)},${g.vector.lng.toFixed(5)})</span>
                    <span style="color:#888;">${dist.toFixed(0)}m</span>
                </div>`;
            }).join('');
        };

        const onMapClick = (e) => {
            if (!gcpMode) return;
            const ll = e.latlng;

            if (!pendingRasterClick) {
                // First click: raster position (where feature IS)
                pendingRasterClick = { lat: ll.lat, lng: ll.lng };
                const marker = L.marker(ll, { icon: redIcon }).addTo(map);
                gcpMarkers.push(marker);
                gcpStatus.innerHTML = '<span style="color:#ff6b6b;">Raster point placed.</span> Now click where it <b style="color:#4caf50;">SHOULD BE</b>.';
            } else {
                // Second click: vector position (where feature SHOULD BE)
                const vectorPt = { lat: ll.lat, lng: ll.lng };
                const rasterPt = pendingRasterClick;
                gcps.push({ raster: rasterPt, vector: vectorPt });

                // Green marker + connecting line
                const marker = L.marker(ll, { icon: greenIcon }).addTo(map);
                const line = L.polyline(
                    [[rasterPt.lat, rasterPt.lng], [vectorPt.lat, vectorPt.lng]],
                    { color: '#ffeb3b', weight: 2, dashArray: '4,4', opacity: 0.8 }
                ).addTo(map);
                gcpMarkers.push(marker, line);

                pendingRasterClick = null;
                updateGcpList();
                gcpStatus.innerHTML = 'Click where the next raster feature <b style="color:#ff6b6b;">IS</b>.';
            }
        };

        gcpToggle.onclick = () => {
            gcpMode = !gcpMode;
            if (gcpMode) {
                gcpToggle.textContent = 'Stop placing GCPs';
                gcpToggle.style.background = '#4a1a1a';
                gcpToggle.style.borderColor = '#ff6b6b';
                gcpStatus.innerHTML = 'Click where a raster feature <b style="color:#ff6b6b;">IS</b>.';
                map.getContainer().style.cursor = 'crosshair';
                map.on('click', onMapClick);
            } else {
                gcpToggle.textContent = 'Start placing GCPs';
                gcpToggle.style.background = '#333';
                gcpToggle.style.borderColor = '#555';
                gcpStatus.textContent = `${gcps.length} GCP pair(s) placed`;
                map.getContainer().style.cursor = '';
                map.off('click', onMapClick);
                pendingRasterClick = null;
            }
        };

        document.getElementById('gcp-undo').onclick = () => {
            if (pendingRasterClick) {
                // Remove the pending raster marker
                const m = gcpMarkers.pop();
                if (m) map.removeLayer(m);
                pendingRasterClick = null;
                gcpStatus.innerHTML = 'Click where a raster feature <b style="color:#ff6b6b;">IS</b>.';
            } else if (gcps.length > 0) {
                gcps.pop();
                // Remove line, green marker, red marker (3 items)
                for (let i = 0; i < 3 && gcpMarkers.length; i++) {
                    const m = gcpMarkers.pop();
                    if (m) map.removeLayer(m);
                }
                updateGcpList();
            }
        };

        document.getElementById('gcp-clear').onclick = () => {
            gcps.length = 0;
            pendingRasterClick = null;
            gcpMarkers.forEach(m => map.removeLayer(m));
            gcpMarkers.length = 0;
            updateGcpList();
        };

        document.getElementById('gcp-copy').onclick = () => {
            const data = gcps.map((g, i) => ({
                id: i + 1,
                raster_lat: +g.raster.lat.toFixed(6),
                raster_lng: +g.raster.lng.toFixed(6),
                vector_lat: +g.vector.lat.toFixed(6),
                vector_lng: +g.vector.lng.toFixed(6),
            }));
            const text = JSON.stringify(data, null, 2);
            navigator.clipboard.writeText(text);
            const btn = document.getElementById('gcp-copy');
            btn.textContent = 'Copied!';
            btn.style.background = '#1a4a1a';
            setTimeout(() => { btn.textContent = 'Copy GCPs to clipboard'; btn.style.background = '#1a3a4a'; }, 1500);
        };
    }
}

// Export singleton
const mapController = new MapController();
window.mapController = mapController; // Expose for debugging
export default mapController;
