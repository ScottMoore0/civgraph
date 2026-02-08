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
        this.lodLayers = new Set();  // Layers using LOD loading
        this.currentLOD = new Map(); // mapId -> current LOD level

        // Initialize feature loader
        featureLoader.init();
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
            attributionControl: true
        });

        // Add default base layer
        this.setBaseMap(this.currentBaseMapId);

        // Set up event handlers
        this.map.on('moveend zoomend', () => this.updateLabels());
        this.map.on('click', (e) => this.handleMapClick(e));

        // LOD loading handlers - update visible features on pan/zoom
        this.map.on('moveend', () => this.updateLODLayers());
        this.map.on('zoomend', () => this.updateLODLayers());

        console.log('[MapController] Map initialized');
        return this;
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
     * Load a map layer from the database
     */
    async loadLayer(mapConfig, show = true) {
        const { id, files, style, labelProperty, name } = mapConfig;

        // Check if already loaded
        if (this.layerStates.has(id)) {
            const state = this.layerStates.get(id);
            if (show && !state.visible) {
                this.showLayer(id);
            }
            return state;
        }

        // Get the FGB file path - for clone maps, resolve from source
        let filePath = files?.fgb || files?.geojson;

        // If no files and this is a clone, get files from source map
        if (!filePath && mapConfig.cloneOf) {
            const sourceMap = dataService.getMapById(mapConfig.cloneOf);
            if (sourceMap?.files) {
                filePath = sourceMap.files.fgb || sourceMap.files.geojson;
                console.log(`[MapController] Clone map ${id} using files from ${mapConfig.cloneOf}`);
            }
        }

        if (!filePath) {
            console.warn(`[MapController] No file path for layer ${id}`);
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
            useLOD: false  // Will be set if using LOD loading
        };
        this.layerStates.set(id, state);

        // Notify loading started
        if (this.onLoadProgress) {
            this.onLoadProgress(id, 0);
        }

        // Check if this map supports LOD loading
        if (featureLoader.supportsLOD(id)) {
            return this.loadLayerWithLOD(mapConfig, state, show);
        }

        try {
            // Load the data with progress
            const features = await this.loadDataFile(filePath, (progress) => {
                state.progress = progress;
                if (this.onLoadProgress) {
                    this.onLoadProgress(id, progress);
                }
            });

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
            return null;
        }
    }

    /**
     * Load a layer using LOD (Level of Detail) progressive loading
     */
    async loadLayerWithLOD(mapConfig, state, show) {
        const { id, style, labelProperty, name } = mapConfig;

        state.useLOD = true;
        this.lodLayers.add(id);

        const featureCount = featureLoader.getFeatureCount(id);
        console.log(`[MapController] Loading ${name} with LOD (${featureCount} features)`);

        // Get current viewport and zoom
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        const lod = featureLoader.getLODForZoom(zoom);

        this.currentLOD.set(id, lod);

        // Find features in viewport
        const visibleFeatures = featureLoader.getFeaturesInBounds(id, bounds);
        const indices = featureLoader.getFeaturesToLoad(id, visibleFeatures.map(f => f.id), lod);

        console.log(`[MapController] Loading ${indices.length} of ${visibleFeatures.length} visible features at LOD-${lod}`);

        // Load features in batches
        const totalToLoad = indices.length;
        let loaded = 0;

        const batchSize = 50;
        for (let i = 0; i < indices.length; i += batchSize) {
            const batch = indices.slice(i, i + batchSize);
            const features = await featureLoader.loadFeatures(id, batch, lod);

            // Add features to the layer
            for (const geojson of features) {
                this.addFeatureToLayer(state, geojson, style, labelProperty, mapConfig);
            }

            loaded += batch.length;
            state.progress = Math.round((loaded / totalToLoad) * 100);
            if (this.onLoadProgress) {
                this.onLoadProgress(id, state.progress);
            }
        }

        state.loaded = true;
        state.loading = false;
        state.featureCount = featureCount;

        if (this.onLoadProgress) {
            this.onLoadProgress(id, 100);
        }

        if (show) {
            this.showLayer(id);
        }

        console.log(`[MapController] Loaded LOD layer: ${name} (${loaded} features)`);
        return state;
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
            pointToLayer: (feature, latlng) => {
                return this.createPointMarker(latlng, style);
            },
            onEachFeature: (feature, layer) => {
                layer._mapId = state.id;

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
    }

    /**
     * Update LOD layers when viewport changes
     */
    async updateLODLayers() {
        if (!this.map || this.lodLayers.size === 0) return;

        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        const newLOD = featureLoader.getLODForZoom(zoom);

        for (const mapId of this.lodLayers) {
            const state = this.layerStates.get(mapId);
            if (!state || !state.visible) continue;

            const currentLOD = this.currentLOD.get(mapId);
            const lodChanged = currentLOD !== newLOD;

            // Find features in viewport
            const visibleFeatures = featureLoader.getFeaturesInBounds(mapId, bounds);
            const indices = featureLoader.getFeaturesToLoad(mapId, visibleFeatures.map(f => f.id), newLOD);

            // If LOD changed, we need to clear and reload all visible features at new LOD
            if (lodChanged) {
                console.log(`[MapController] LOD changed ${currentLOD} -> ${newLOD} for ${mapId}, reloading visible features`);

                // Clear existing layers
                for (const layer of state.geoJsonLayers) {
                    state.group.removeLayer(layer);
                }
                state.geoJsonLayers = [];
                state.labelEntries = [];

                // Clear cached features at old LOD
                featureLoader.clearMap(mapId);

                // Load all visible features at new LOD
                const allIndices = visibleFeatures.map(f => featureLoader.parseFeatureId(f.id));
                if (allIndices.length > 0) {
                    const features = await featureLoader.loadFeatures(mapId, allIndices, newLOD);
                    for (const geojson of features) {
                        this.addFeatureToLayer(state, geojson, state.config.style, state.config.labelProperty, state.config);
                    }
                }

                this.currentLOD.set(mapId, newLOD);
                this.updateLabels();
            } else if (indices.length > 0) {
                // Same LOD, just load new features for expanded viewport
                const features = await featureLoader.loadFeatures(mapId, indices, newLOD);
                for (const geojson of features) {
                    this.addFeatureToLayer(state, geojson, state.config.style, state.config.labelProperty, state.config);
                }
                this.updateLabels();
            }
        }
    }

    /**
     * Load a data file (FGB or GeoJSON)
     */
    async loadDataFile(filePath, onProgress = null) {
        const ext = filePath.split('.').pop()?.toLowerCase();

        if (ext === 'fgb') {
            return this.loadFlatGeobuf(filePath, onProgress);
        } else {
            const response = await fetch(filePath);
            return response.json();
        }
    }

    /**
     * Load FlatGeobuf file
     */
    async loadFlatGeobuf(url, onProgress = null) {
        const features = [];
        let featureCount = 0;

        try {
            for await (const feature of flatgeobuf.deserialize(url)) {
                features.push(feature);
                featureCount++;

                // Report progress every 100 features
                if (onProgress && featureCount % 100 === 0) {
                    const estimatedProgress = Math.min(90, Math.log10(featureCount) * 30);
                    onProgress(estimatedProgress);
                }
            }
        } catch (err) {
            // Fallback to full download if range requests fail
            console.warn('[MapController] Range request failed, falling back to full download');
            const response = await fetch(url);
            for await (const feature of flatgeobuf.deserialize(response.body)) {
                features.push(feature);
            }
        }
        return features;
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

        // Clean up LOD state if applicable
        if (this.lodLayers.has(id)) {
            this.lodLayers.delete(id);
            this.currentLOD.delete(id);
            featureLoader.clearMap(id);
        }

        this.updateLabels();
    }

    /**
     * Load a single feature (for search results)
     * Creates a partial layer containing only the selected feature
     */
    async loadSingleFeature(mapConfig, featureIndex, featureName = null) {
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
                useLOD: false,
                isPartial: true,              // Flag: this is a partial load
                loadedIndices: new Set(),     // Track which features are loaded
                featureNames: new Map()       // Track feature names for display
            };
            this.layerStates.set(id, state);
        }

        // Check if this feature is already loaded
        if (state.loadedIndices.has(featureIndex)) {
            return state;
        }

        // Determine LOD based on zoom level
        const zoom = this.map ? this.map.getZoom() : 10;
        const lod = featureLoader.getLODForZoom(zoom);

        // Load the single feature
        const geojson = await featureLoader.loadFeature(id, featureIndex, lod);
        if (!geojson) {
            console.warn(`[MapController] Failed to load feature ${featureIndex} from ${id}`);
            return null;
        }

        // Add the feature to the layer
        this.addFeatureToLayer(state, geojson, style, labelProperty, mapConfig);
        state.loadedIndices.add(featureIndex);

        // Store feature name if provided
        if (featureName) {
            state.featureNames.set(featureIndex, featureName);
        }

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
            if (state.loaded && state.visible) {
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
                        className: 'map-label',
                        html: `<div style="color:${info.color};text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff;font-weight:bold;font-size:${fontSize}px;text-align:center;width:${maxWidth}px;word-break:keep-all;overflow-wrap:normal;position:absolute;left:50%;transform:translateX(-50%);">${info.text}</div>`,
                        iconSize: null,
                        iconAnchor: [0, 0]
                    })
                });
                marker.addTo(this.map);
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
        const featuresFound = [];

        this.layerStates.forEach(state => {
            if (!state.loaded || !state.visible) return;

            state.geoJsonLayers.forEach(geoJsonLayer => {
                geoJsonLayer.eachLayer(layer => {
                    if (!layer.feature) return;

                    const geomType = layer.feature.geometry?.type;

                    if (geomType === 'Point') {
                        if (clickLatLng.distanceTo(layer.getLatLng()) < 10) {
                            featuresFound.push({
                                mapId: layer._mapId,
                                properties: layer.feature.properties,
                                geometry: layer.feature.geometry
                            });
                        }
                    } else if (layer.getBounds?.().contains(clickLatLng)) {
                        // For polygons and lines, use point-in-polygon test
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
        });

        if (this.onFeatureClick && featuresFound.length > 0) {
            this.onFeatureClick(featuresFound);
        }
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
            }
        } catch (err) {
            // Ignore bounds errors
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
}

// Export singleton
const mapController = new MapController();
export default mapController;
