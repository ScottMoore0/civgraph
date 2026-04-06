/**
 * NI Boundaries - Feature Loader
 * Handles viewport-aware loading of pre-processed per-feature JSON files with LOD support.
 */

const FEATURE_THRESHOLD = 50;  // Only use LOD loading for maps with >50 features
const CONCURRENT_LOADS = 50;   // Max parallel fetch requests
const VIEWPORT_BUFFER = 0.2;   // 20% buffer around viewport

// --- IndexedDB cache for decoded features ---
const IDB_NAME = 'boundaries-feature-cache';
const IDB_VERSION = 1;
const IDB_STORE = 'features';

function openFeatureCache() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { resolve(null); return; }
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

function idbGet(db, key) {
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        } catch { resolve(null); }
    });
}

function idbPut(db, key, value) {
    try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
    } catch { /* best-effort */ }
}

class FeatureLoader {
    constructor() {
        this.spatialIndex = null;
        this.spatialIndexByMap = new Map();  // mapId -> [features]
        this.loadedFeatures = new Map();     // "mapId:index:lod" -> L.geoJSON layer
        this.pendingLoads = new Map();       // URL -> Promise
        this.initialized = false;
        this._initPromise = null;
        this._chunkManifest = null;         // Per-map chunk manifest
        this._chunkPromises = new Map();    // mapId -> Promise (dedup concurrent loads)
        this._idb = null;                   // IndexedDB handle (lazy-opened)
        this._idbReady = null;              // Promise for DB open
        // Chunked mode: load per-map spatial index chunks on demand instead of
        // the full 15 MB monolithic file. Disable with ?chunkedIndex=0 for debugging.
        this.useChunkedIndex = typeof window === 'undefined'
            || new URLSearchParams(window.location?.search).get('chunkedIndex') !== '0';
        // Open IndexedDB eagerly (non-blocking)
        this._idbReady = openFeatureCache().then(db => { this._idb = db; });
    }

    /**
     * Lazy initialization — call this before any method that needs the spatial index.
     * In chunked mode: loads only the 5 KB manifest.
     * In monolithic mode: loads the full spatial index.
     */
    async ensureInitialized() {
        if (this.initialized) return;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this.useChunkedIndex ? this._initFromManifest() : this._initMonolithic();
        return this._initPromise;
    }

    /**
     * Monolithic init — loads the full spatial index (original behaviour)
     */
    async _initMonolithic() {
        if (this.initialized) return;

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
     * Chunked init — loads only the manifest. Feature data is loaded per-map on demand.
     */
    async _initFromManifest() {
        if (this.initialized) return;

        const manifest = await this._loadChunkManifest();
        if (!manifest) {
            console.warn('[FeatureLoader] Chunk manifest not found, falling back to monolithic');
            return this._initMonolithic();
        }

        this.initialized = true;
        console.log(`[FeatureLoader] Chunked mode: manifest loaded (${manifest.maps.length} maps)`);
    }

    /**
     * Lazy-load the names index for global search (~3 MB vs 8 MB monolithic).
     * Contains only { name, mapId, id } — enough for name search.
     * Falls back to full monolithic if names index is unavailable.
     */
    async _ensureFullIndex() {
        if (this.spatialIndex && this.spatialIndex.length > 0) return;
        try {
            // Try lightweight names index first
            let resp = await fetch('data/database/spatial-index/_names.json');
            if (resp.ok) {
                this.spatialIndex = await resp.json();
                console.log(`[FeatureLoader] Loaded names index for search: ${this.spatialIndex.length} features`);
                return;
            }
            // Fall back to monolithic
            resp = await fetch('data/database/spatial-index.json');
            if (!resp.ok) return;
            const data = await resp.json();
            this.spatialIndex = data.features || [];
            console.log(`[FeatureLoader] Loaded full index for search: ${this.spatialIndex.length} features`);
        } catch (err) {
            console.warn('[FeatureLoader] Failed to load search index:', err);
            if (!this.spatialIndex) this.spatialIndex = [];
        }
    }

    /**
     * Search via the edge API. Returns results directly, or null if the API is unavailable.
     */
    async searchViaAPI(query, limit = 20) {
        try {
            const resp = await fetch(`/_api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
            if (!resp.ok) return null;
            const data = await resp.json();
            return data.results || null;
        } catch {
            return null;
        }
    }

    /**
     * Load the chunk manifest (tiny file listing available per-map chunks).
     * Does NOT load any feature data — just the map list.
     */
    async _loadChunkManifest() {
        if (this._chunkManifest) return this._chunkManifest;
        try {
            const resp = await fetch('data/database/spatial-index/_manifest.json');
            if (!resp.ok) return null;
            this._chunkManifest = await resp.json();
            return this._chunkManifest;
        } catch {
            return null;
        }
    }

    /**
     * Load a single map's spatial index chunk on demand.
     * Returns the features array, or [] if not available.
     * De-duplicates concurrent loads for the same mapId.
     */
    async loadMapIndex(mapId) {
        // Already loaded (from chunk or monolithic)
        if (this.spatialIndexByMap.has(mapId)) {
            return this.spatialIndexByMap.get(mapId);
        }

        // De-duplicate concurrent loads
        if (this._chunkPromises.has(mapId)) {
            return this._chunkPromises.get(mapId);
        }

        const promise = (async () => {
            try {
                // Try edge API first (Cloudflare Pages Function)
                let features;
                try {
                    const resp = await fetch(`/_api/spatial?mapId=${encodeURIComponent(mapId)}`);
                    if (resp.ok) {
                        const data = await resp.json();
                        features = data.features || [];
                    }
                } catch {
                    // API not available (local dev or non-Cloudflare host)
                }

                // Fallback to static chunk file
                if (!features) {
                    const resp = await fetch(`data/database/spatial-index/${mapId}.json`);
                    if (!resp.ok) return [];
                    features = await resp.json();
                }

                this.spatialIndexByMap.set(mapId, features);
                if (this.spatialIndex) {
                    this.spatialIndex.push(...features);
                }
                return features;
            } catch {
                return [];
            } finally {
                this._chunkPromises.delete(mapId);
            }
        })();

        this._chunkPromises.set(mapId, promise);
        return promise;
    }

    /**
     * Check if a map supports per-feature loading
     */
    supportsLOD(mapId) {
        if (!this.initialized && !this.spatialIndexByMap.has(mapId)) return false;
        const features = this.spatialIndexByMap.get(mapId);
        // Features must have 'id' field (format "mapId:index") for per-feature loading
        // Features without 'id' were indexed for search/bbox only
        return features && features.length >= FEATURE_THRESHOLD && features[0]?.id != null;
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
     * Load a single feature at specified LOD.
     * Checks IndexedDB first to avoid re-fetching across sessions.
     */
    async loadFeature(mapId, index, lod) {
        const url = `data/features/${mapId}/${index}-lod-${lod}.json`;
        const cacheKey = `${mapId}:${index}:${lod}`;

        // Check in-memory cache
        if (this.loadedFeatures.has(cacheKey)) {
            return this.loadedFeatures.get(cacheKey);
        }

        // Check if already loading
        if (this.pendingLoads.has(url)) {
            return this.pendingLoads.get(url);
        }

        const promise = (async () => {
            // Check IndexedDB cache
            await this._idbReady;
            if (this._idb) {
                const cached = await idbGet(this._idb, cacheKey);
                if (cached) {
                    this.loadedFeatures.set(cacheKey, cached);
                    this.pendingLoads.delete(url);
                    return cached;
                }
            }

            // Fetch from network
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const geojson = await res.json();
                this.loadedFeatures.set(cacheKey, geojson);
                // Persist to IndexedDB (non-blocking)
                if (this._idb) idbPut(this._idb, cacheKey, geojson);
                return geojson;
            } catch (err) {
                console.warn(`[FeatureLoader] Failed to load ${url}:`, err.message);
                return null;
            } finally {
                this.pendingLoads.delete(url);
            }
        })();

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
     *
     * Tries the edge API first (no client-side index needed).
     * Falls back to local index search if the API is unavailable.
     */
    async searchFeaturesByName(query, limit = 20) {
        if (!this.initialized || !query || query.length < 2) return [];

        // Try edge API first — avoids downloading the 3 MB names index
        const apiResults = await this.searchViaAPI(query, limit);
        if (apiResults) return apiResults;

        // Fallback: local index search
        if (this.useChunkedIndex && (!this.spatialIndex || this.spatialIndex.length === 0)) {
            this._ensureFullIndex();
            return [];
        }

        const lowerQuery = query.toLowerCase();
        const results = [];

        for (const feature of (this.spatialIndex || [])) {
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
