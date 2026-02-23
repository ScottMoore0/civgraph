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
        this.labelMarkers = [];
        this.labelsEnabled = true;
        this.onFeatureClick = null;
        this.baseLayer = null;
        this.overlayLayers = new Map();
        this.currentBaseMapId = 'osm-standard';
        this.textScale = 100;
        this.onLoadProgress = null;
        this.spatialLayers = new Set();  // Layers using chunked viewport loading
        this.currentLOD = new Map(); // mapId -> current LOD level
        this._spatialUpdatePending = false; // debounce flag for viewport updates
        this._chunkIndexCache = new Map(); // mapId -> chunks-index.json data
        this._loadedChunks = new Map(); // mapId -> Map(chunkId -> { layer, features })
        this._featureIndexCache = new Map(); // mapId -> { features, chunks } from feature-index.json
        this._chunkDataCache = new Map(); // mapId -> Map(chunkFile -> features[])
        this._renderedFeatures = new Map(); // mapId -> Map(featureKey -> L.GeoJSON layer)
        this._spatialAbort = new Map(); // mapId -> AbortController
        this._lastPointClick = null; // fallback double-click detection for point layers
        this._lastMapClick = null; // fallback double-click detection at map level
        this._lastNativeDblClickTs = 0;

        // Initialize feature loader
        featureLoader.init();
    }

    _isAbortError(err) {
        return err?.name === 'AbortError';
    }

    _throwIfAborted(signal) {
        if (!signal?.aborted) return;
        throw new DOMException('Map loading was cancelled', 'AbortError');
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
        layer.on('mouseover', () => this._setFeatureHover(layer, true));
        layer.on('mouseout', () => this._setFeatureHover(layer, false));
    }

    _attachHistoricPointDblClick(mapConfig, mapId, feature, layer) {
        if (!layer || typeof layer.on !== 'function') return;
        const geomType = feature?.geometry?.type;
        if (!(geomType === 'Point' || geomType === 'MultiPoint' || typeof layer.getLatLng === 'function')) return;

        const emitSelection = () => this._emitFeatureSelection(mapId, feature);

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

        // Canvas-rendered point layers can occasionally miss native `dblclick`.
        // Fallback to two rapid clicks on the same point layer.
        layer.on('click', (e) => {
            const now = Date.now();
            const layerId = layer._leaflet_id;
            const prev = this._lastPointClick;
            const withinWindow = prev && prev.layerId === layerId && (now - prev.ts) <= 450;
            if (withinWindow) {
                this._lastPointClick = null;
                try {
                    if (e?.originalEvent) {
                        L.DomEvent.stop(e.originalEvent);
                    } else if (e) {
                        L.DomEvent.stop(e);
                    }
                } catch (err) {
                    // No-op: selection should still emit.
                }
                emitSelection();
                return;
            }
            this._lastPointClick = { layerId, ts: now };
        });
    }

    _emitFeatureSelection(mapId, feature) {
        if (!this.onFeatureClick || !feature) return;
        this.onFeatureClick([{
            mapId,
            properties: feature?.properties,
            geometry: feature?.geometry
        }]);
    }

    _setFeatureHover(layer, isHover) {
        if (!layer || typeof layer.setStyle !== 'function') return;

        if (!layer._originalStyle) {
            const opts = layer.options || {};
            layer._originalStyle = {
                color: opts.color,
                weight: opts.weight,
                opacity: opts.opacity,
                fillColor: opts.fillColor,
                fillOpacity: opts.fillOpacity,
                radius: opts.radius
            };
        }

        const base = layer._originalStyle || {};
        if (isHover) {
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
            if (typeof layer.bringToFront === 'function') layer.bringToFront();
        } else {
            const restore = {};
            ['color', 'weight', 'opacity', 'fillColor', 'fillOpacity', 'radius'].forEach((k) => {
                if (base[k] !== undefined) restore[k] = base[k];
            });
            layer.setStyle(restore);
        }

        const labelEl = layer._labelMarker?.getElement?.();
        if (labelEl) {
            labelEl.classList.toggle('map-label--hover', !!isHover);
        }
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
        },
        'nhd-flowlines': {
            url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}',
            attribution: '&copy; USGS NHD',
            maxZoom: 16
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
        this.map.on('dblclick', (e) => {
            this._lastNativeDblClickTs = Date.now();
            this._lastMapClick = null;
            this.handleMapClick(e);
        });
        this.map.on('click', (e) => this._handleMapClickForSelection(e));

        // Spatial loading handlers - update visible features on pan/zoom
        this.map.on('moveend', () => this.updateSpatialLayers());
        this.map.on('zoomend', () => this.updateSpatialLayers());

        console.log('[MapController] Map initialized');
        return this;
    }

    _handleMapClickForSelection(e) {
        const now = Date.now();
        // If native dblclick just fired, skip synthetic detection.
        if (now - this._lastNativeDblClickTs <= 350) {
            this._lastMapClick = null;
            return;
        }

        const prev = this._lastMapClick;
        const currentPt = this.map?.latLngToContainerPoint(e.latlng);
        if (prev && prev.pt && currentPt) {
            const withinTime = (now - prev.ts) <= 450;
            const withinDistance = prev.pt.distanceTo(currentPt) <= 24;
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

        // Check if already loaded
        if (this.layerStates.has(id)) {
            const state = this.layerStates.get(id);
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

        if (!filePath && !rasterTemplate) {
            console.warn(`[MapController] No FGB/XYZ source for layer ${id}`);
            return null;
        }

        // Create layer state
        const state = {
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
            fgbPath: filePath    // Store the base FGB path for LOD resolution
        };
        this.layerStates.set(id, state);

        // Notify loading started
        if (this.onLoadProgress) {
            this.onLoadProgress(id, 0);
        }

        if (rasterTemplate) {
            return this.loadRasterTileLayer(mapConfig, state, show, { signal });
        }

        // Use chunked loading for large maps with spatial chunks
        if (this.shouldUseChunkedLoading(mapConfig)) {
            return this.loadLayerChunked(mapConfig, state, show, { signal });
        }

        try {
            this._throwIfAborted(signal);
            // Load the configured source directly.
            // For FGB-backed maps, do not substitute GeoJSON in the interactive pane.
            const features = await this.loadDataFile(filePath, (progress) => {
                state.progress = progress;
                if (this.onLoadProgress) {
                    this.onLoadProgress(id, progress);
                }
            }, signal);

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

            if (this.onLoadProgress) {
                this.onLoadProgress(id, 100);
            }

            if (show) {
                this.showLayer(id);
            }

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
                    pane.style.zIndex = '450';
                    pane.style.pointerEvents = 'none';
                }
                options.pane = paneName;
            }

            if (Array.isArray(mapConfig.bounds) && mapConfig.bounds.length === 2) {
                options.bounds = mapConfig.bounds;
            }

            const rasterLayer = L.tileLayer(tileTemplate, options);
            rasterLayer.addTo(state.group);

            state.rasterLayer = rasterLayer;
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
        const enforceChunkOnly = id === 'ni-townlands-1844';

        state.useSpatial = true;
        this.spatialLayers.add(id);
        this._loadedChunks.set(id, new Map());
        this._chunkDataCache.set(id, new Map());
        this._renderedFeatures.set(id, new Map());

        const zoom = this.map.getZoom();
        this.currentLOD.set(id, this.getLODLevel(zoom));

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
        const rect = this.boundsToRect(bounds, 0.5);
        const visibleChunks = this._getIntersectingChunks(chunkIndex, rect);

        console.log(`[MapController] Loading ${name} chunked (${visibleChunks.length}/${chunkIndex.chunks.length} chunks in viewport)`);

        try {
            let totalLoaded = 0;
            for (const chunk of visibleChunks) {
                this._throwIfAborted(signal);
                const chunkFile = this._resolveChunkFile(chunk, zoom);
                const features = await this._loadChunkFGBCached(id, chunkFile, zoom, signal);
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

            state.loaded = true;
            state.loading = false;
            state.geometryType = 'MultiPolygon';
            state.featureCount = chunkIndex.totalFeatures;
            state.progress = 100;
            state._lastZoom = zoom;

            if (this.onLoadProgress) this.onLoadProgress(id, 100);
            if (show) this.showLayer(id);

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

        try {
            const response = await fetch(indexPath, signal ? { signal } : undefined);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const index = await response.json();
            this._chunkIndexCache.set(mapId, index);
            return index;
        } catch (err) {
            console.warn(`[MapController] Chunk index not found: ${indexPath}`);
            this._chunkIndexCache.set(mapId, null);
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
    _resolveChunkFile(chunk, zoom) {
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
        const features = [];
        const shouldApplyMinDiag = mapId !== 'ni-townlands-1844';
        const minDiag = (zoom != null && shouldApplyMinDiag) ? this.getMinFeatureDiagDeg(zoom) : 0;
        let skippedCount = 0;

        const response = await fetch(filePath, signal ? { signal } : undefined);
        if (!response.ok) throw new Error(`Failed to fetch ${filePath}: ${response.status}`);

        for await (const feature of flatgeobuf.deserialize(response.body)) {
            // Screen-space area filtering
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
        return features;
    }

    /**
     * Add a single feature to a layer state
     */
    addFeatureToLayer(state, geojson, style, labelProperty, mapConfig) {
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
        state.geoJsonLayers.push(geoJsonLayer);

        // Apply active conditional style to dynamically-loaded chunks
        if (state._activeStyleFn) {
            geoJsonLayer.setStyle(state._activeStyleFn);
        }

        // Collect label entries — support fallback label properties for mixed data sources
        if (labelProperty) {
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

            const chunkIndex = this._chunkIndexCache.get(mapId);
            if (!chunkIndex) continue;

            const rect = this.boundsToRect(bounds);
            const visibleChunks = this._getIntersectingChunks(chunkIndex, rect);
            const loadedChunks = this._loadedChunks.get(mapId) || new Map();

            // Detect zoom level change — different zoom may need different chunk variants
            const lastZoom = state._lastZoom;
            const zoomBandChanged = lastZoom != null && this._zoomBandChanged(lastZoom, zoom);

            const visibleIds = new Set(visibleChunks.map(c => c.id));
            const loadedIds = new Set(loadedChunks.keys());

            const toLoad = visibleChunks.filter(c => !loadedIds.has(c.id));
            const toUnload = [...loadedIds].filter(id => !visibleIds.has(id));

            // If zoom band changed, force full reload with new variants
            const needFullReload = zoomBandChanged;

            if (!needFullReload && toLoad.length === 0 && toUnload.length === 0) continue;

            state.loading = true;

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
                    for (const chunk of visibleChunks) {
                        const chunkFile = this._resolveChunkFile(chunk, zoom);
                        const features = await this._loadChunkFGBCached(mapId, chunkFile, zoom);
                        for (const feature of features) {
                            const fKey = this._featureKey(chunk.id, feature);
                            if (!rendered.has(fKey)) {
                                const layer = this.addFeatureToLayer(state, feature, state.config.style, state.config.labelProperty, state.config);
                                rendered.set(fKey, layer);
                            }
                        }
                        loadedChunks.set(chunk.id, { file: chunkFile, chunk });
                    }
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
                    for (const chunk of toLoad) {
                        const chunkFile = this._resolveChunkFile(chunk, zoom);
                        const features = await this._loadChunkFGBCached(mapId, chunkFile, zoom);
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
                }

                state._lastZoom = zoom;
                state.loading = false;
                this.updateLabels();
            } catch (err) {
                console.warn(`[MapController] Chunk update failed for ${mapId}:`, err);
                state.loading = false;
            }
        }
    }

    /**
     * Check if zoom change crosses a zoom band boundary.
     * Zoom bands correspond to the build-time zoom level thresholds.
     */
    _zoomBandChanged(oldZoom, newZoom) {
        const getBand = (z) => {
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

        if (ext === 'fgb') {
            return this.loadFlatGeobuf(filePath, onProgress, signal);
        } else {
            const response = await fetch(filePath, signal ? { signal } : undefined);
            return response.json();
        }
    }

    /**
     * Load FlatGeobuf file (full download via fetch, no range requests)
     */
    async loadFlatGeobuf(url, onProgress = null, signal = null) {
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

        const response = await fetch(url, signal ? { signal } : undefined);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);

        // Primary path: stream parsing (lower memory footprint).
        if (response.body) {
            try {
                return await loadFromSource(response.body);
            } catch (streamErr) {
                console.warn(`[MapController] Stream FGB parse failed for ${url}, retrying via ArrayBuffer:`, streamErr);
            }
        }

        // Fallback path: parse from full bytes for broader browser compatibility.
        const retryResponse = response.bodyUsed ? await fetch(url, signal ? { signal } : undefined) : response;
        if (!retryResponse.ok) throw new Error(`Failed to refetch ${url}: ${retryResponse.status}`);
        const bytes = new Uint8Array(await retryResponse.arrayBuffer());
        return loadFromSource(bytes);
    }

    /**
     * Clean label text based on cleanup rule
     */
    cleanLabelText(text, cleanupRule) {
        if (!text || typeof text !== 'string') return text;

        if (cleanupRule === 'stripTrailingBracketNumber') {
            return text.replace(/\s*\([^()]*\)\s*$/, '').trim();
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
        state.visible = false;
        this.updateLabels();
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
        this.layerStates.delete(id);

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

        if (state) {
            // If it's a full map (not partial), just return it
            if (!state.isPartial) {
                return state;
            }
            // Otherwise, add this feature to the existing partial layer
        } else {
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
                featureVisibility: new Map()  // featureIndex -> visible boolean
            };
            this.layerStates.set(id, state);
        }

        // Check if this feature is already loaded
        if (state.loadedIndices.has(featureIndex)) {
            return state;
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

        // Add the feature to the layer
        const addedLayer = this.addFeatureToLayer(state, loadedFeature, style, labelProperty, mapConfig);
        state.loadedIndices.add(featureIndex);

        // Store feature metadata
        const resolvedName = featureName || loadedFeature?.properties?.[labelProperty] || `Feature ${featureIndex}`;
        state.featureNames.set(featureIndex, resolvedName);
        state.featureLayers.set(featureIndex, addedLayer);
        state.featureVisibility.set(featureIndex, true);

        // Show the layer
        this.showLayer(id);
        this.updateLabels();

        console.log(`[MapController] Loaded single feature ${featureIndex} from ${name} (partial load)`);
        return state;
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
        return state?.isPartial === true;
    }

    /**
     * Get loaded feature names for a partial layer
     */
    getPartialFeatureNames(id) {
        const state = this.layerStates.get(id);
        if (!state?.isPartial) return [];
        return Array.from(state.featureNames.values());
    }

    getPartialFeatureItems(id) {
        const state = this.layerStates.get(id);
        if (!state?.isPartial) return [];
        return Array.from(state.loadedIndices)
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
        if (!state?.isPartial) return;
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
        if (!state?.isPartial) return;
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

        if (state.loadedIndices.size === 0) {
            this.unloadLayer(mapId);
            return;
        }
        this.updateLabels();
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
                if (layer.setStyle) {
                    layer.setStyle({ fillOpacity });
                }
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
        const featuresFound = [];
        let nearestPoint = null;
        let nearestPointDistance = Infinity;
        const pointPickPx = 32;

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
        if (featuresFound.length === 0 && nearestPoint && nearestPointDistance <= 48) {
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
}

// Export singleton
const mapController = new MapController();
window.mapController = mapController; // Expose for debugging
export default mapController;
