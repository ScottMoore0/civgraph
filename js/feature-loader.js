/**
 * NI Boundaries - Feature Loader
 * Handles viewport-aware loading of pre-processed per-feature JSON files with LOD support.
 */

const FEATURE_THRESHOLD = 50;  // Only use LOD loading for maps with >50 features
const CONCURRENT_LOADS = 50;   // Max parallel fetch requests
const VIEWPORT_BUFFER = 0.2;   // 20% buffer around viewport

class FeatureLoader {
    constructor() {
        this.spatialIndex = null;
        this.spatialIndexByMap = new Map();  // mapId -> [features]
        this.loadedFeatures = new Map();     // "mapId:index:lod" -> L.geoJSON layer
        this.pendingLoads = new Map();       // URL -> Promise
        this.initialized = false;
    }

    /**
     * Load the spatial index from disk
     */
    async init() {
        if (this.initialized) return;

        // Add cache-busting for development - use URL search param or timestamp
        const urlParams = new URLSearchParams(window.location.search);
        const cacheBuster = urlParams.get('v') || Date.now();

        try {
            const response = await fetch(`data/database/spatial-index.json?v=${cacheBuster}`);
            if (!response.ok) {
                console.warn('[FeatureLoader] Spatial index not found');
                return;
            }

            const data = await response.json();
            this.spatialIndex = data.features || [];

            // Group by mapId for faster queries
            for (const feature of this.spatialIndex) {
                if (!this.spatialIndexByMap.has(feature.mapId)) {
                    this.spatialIndexByMap.set(feature.mapId, []);
                }
                this.spatialIndexByMap.get(feature.mapId).push(feature);
            }

            this.initialized = true;
            console.log(`[FeatureLoader] Loaded spatial index: ${this.spatialIndex.length} features across ${this.spatialIndexByMap.size} maps`);
        } catch (err) {
            console.warn('[FeatureLoader] Failed to load spatial index:', err);
        }
    }

    /**
     * Check if a map supports per-feature loading
     */
    supportsLOD(mapId) {
        if (!this.initialized) return false;
        const features = this.spatialIndexByMap.get(mapId);
        return features && features.length >= FEATURE_THRESHOLD;
    }

    /**
     * Get feature count for a map
     */
    getFeatureCount(mapId) {
        return this.spatialIndexByMap.get(mapId)?.length || 0;
    }

    /**
     * Determine LOD level based on zoom
     * - lod-0: tolerance 0.01, simplified for zoom 0-8
     * - lod-1: tolerance 0.001, medium for zoom 8-12
     * - lod-2: tolerance 0, full detail for zoom 12+
     */
    getLODForZoom(zoom) {
        if (zoom >= 12) return 2;  // Full detail
        if (zoom >= 8) return 1;   // Medium detail
        return 0;                   // Simplified
    }

    /**
     * Add buffer to bounds for smoother panning
     */
    getBufferedBounds(bounds) {
        const latDiff = bounds.getNorth() - bounds.getSouth();
        const lngDiff = bounds.getEast() - bounds.getWest();

        return L.latLngBounds(
            [bounds.getSouth() - latDiff * VIEWPORT_BUFFER, bounds.getWest() - lngDiff * VIEWPORT_BUFFER],
            [bounds.getNorth() + latDiff * VIEWPORT_BUFFER, bounds.getEast() + lngDiff * VIEWPORT_BUFFER]
        );
    }

    /**
     * Get features that intersect with given bounds
     */
    getFeaturesInBounds(mapId, bounds) {
        const features = this.spatialIndexByMap.get(mapId);
        if (!features) return [];

        const bufferedBounds = this.getBufferedBounds(bounds);
        const minLng = bufferedBounds.getWest();
        const maxLng = bufferedBounds.getEast();
        const minLat = bufferedBounds.getSouth();
        const maxLat = bufferedBounds.getNorth();

        return features.filter(f => {
            const [fMinLng, fMinLat, fMaxLng, fMaxLat] = f.bbox;
            // Check if bboxes intersect
            return !(fMaxLng < minLng || fMinLng > maxLng || fMaxLat < minLat || fMinLat > maxLat);
        });
    }

    /**
     * Parse feature index from id (format: "mapId:index")
     */
    parseFeatureId(id) {
        const parts = id.split(':');
        return parseInt(parts[1], 10);
    }

    /**
     * Load a single feature at specified LOD
     */
    async loadFeature(mapId, index, lod) {
        const url = `data/features/${mapId}/${index}-lod-${lod}.json`;
        const cacheKey = `${mapId}:${index}:${lod}`;

        // Check if already loaded
        if (this.loadedFeatures.has(cacheKey)) {
            return this.loadedFeatures.get(cacheKey);
        }

        // Check if already loading
        if (this.pendingLoads.has(url)) {
            return this.pendingLoads.get(url);
        }

        // Fetch the feature
        const promise = fetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(geojson => {
                this.loadedFeatures.set(cacheKey, geojson);
                this.pendingLoads.delete(url);
                return geojson;
            })
            .catch(err => {
                this.pendingLoads.delete(url);
                console.warn(`[FeatureLoader] Failed to load ${url}:`, err.message);
                return null;
            });

        this.pendingLoads.set(url, promise);
        return promise;
    }

    /**
     * Load multiple features with concurrency control
     */
    async loadFeatures(mapId, indices, lod) {
        const results = [];

        // Process in batches to limit concurrency
        for (let i = 0; i < indices.length; i += CONCURRENT_LOADS) {
            const batch = indices.slice(i, i + CONCURRENT_LOADS);
            const batchResults = await Promise.all(
                batch.map(index => this.loadFeature(mapId, index, lod))
            );
            results.push(...batchResults.filter(r => r !== null));
        }

        return results;
    }

    /**
     * Get indices of features that need loading (not already loaded at same/better LOD)
     * Note: Higher LOD = more detail (LOD-2 is full res, LOD-0 is simplified)
     */
    getFeaturesToLoad(mapId, featureIds, targetLOD) {
        const toLoad = [];

        for (const id of featureIds) {
            const index = this.parseFeatureId(id);

            // Check if already loaded at same or better (higher) LOD
            let hasGoodEnoughLOD = false;
            for (let lod = targetLOD; lod <= 2; lod++) {
                if (this.loadedFeatures.has(`${mapId}:${index}:${lod}`)) {
                    hasGoodEnoughLOD = true;
                    break;
                }
            }

            if (!hasGoodEnoughLOD) {
                toLoad.push(index);
            }
        }

        return toLoad;
    }

    /**
     * Search features by name (case-insensitive, partial match)
     * Returns: [{ id, mapId, name, bbox }]
     */
    searchFeaturesByName(query, limit = 20) {
        if (!this.initialized || !query || query.length < 2) return [];

        const lowerQuery = query.toLowerCase();
        const results = [];

        for (const feature of this.spatialIndex) {
            if (feature.name && feature.name.toLowerCase().includes(lowerQuery)) {
                results.push(feature);
                if (results.length >= limit) break;
            }
        }

        return results;
    }

    /**
     * Clear loaded features for a map
     */
    clearMap(mapId) {
        for (const key of this.loadedFeatures.keys()) {
            if (key.startsWith(mapId + ':')) {
                this.loadedFeatures.delete(key);
            }
        }
    }
}

// Export singleton
const featureLoader = new FeatureLoader();
export default featureLoader;
