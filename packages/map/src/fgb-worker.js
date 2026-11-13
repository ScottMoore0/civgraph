/**
 * Web Worker for FlatGeobuf parsing — offloads decompression and
 * deserialization from the main thread to keep the UI responsive.
 */

/* global flatgeobuf, pako */
importScripts(
    '/js/libs/flatgeobuf-geojson.min.js',
    'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js'
);

/**
 * Compute bounding-box diagonal for a geometry (degrees).
 * Used for screen-space filtering of tiny features.
 * @param {{ type?: string, coordinates?: unknown } | null | undefined} geometry
 */
function bboxDiag(geometry) {
    if (!geometry || !geometry.coordinates) return Infinity;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    /**
     * @param {unknown} coords  nested arrays of positions, `depth` levels deep
     * @param {number} depth
     */
    function walk(coords, depth) {
        if (depth === 0) {
            // coords is [lng, lat]
            if (/** @type {number[]} */ (coords)[0] < minX) minX = /** @type {number[]} */ (coords)[0];
            if (/** @type {number[]} */ (coords)[0] > maxX) maxX = /** @type {number[]} */ (coords)[0];
            if (/** @type {number[]} */ (coords)[1] < minY) minY = /** @type {number[]} */ (coords)[1];
            if (/** @type {number[]} */ (coords)[1] > maxY) maxY = /** @type {number[]} */ (coords)[1];
        } else {
            for (let i = 0; i < /** @type {unknown[]} */ (coords).length; i++) walk(/** @type {unknown[]} */ (coords)[i], depth - 1);
        }
    }

    const t = geometry.type;
    if (t === 'Point') return Infinity; // Points always pass
    const depth = t === 'Polygon' || t === 'MultiLineString' ? 2
        : t === 'MultiPolygon' ? 3
        : t === 'LineString' ? 1
        : 0;
    walk(geometry.coordinates, depth);
    if (!isFinite(minX)) return Infinity;
    const dx = maxX - minX;
    const dy = maxY - minY;
    return Math.sqrt(dx * dx + dy * dy);
}

self.onmessage = async (event) => {
    /** @type {{ id: unknown, url: string, minDiag: number, useCompressed: boolean }} the map loader's request (zoom, also sent, is not read) */
    let { id, url, minDiag, useCompressed } = event.data;
    const start = performance.now();

    // Dev proxy: rewrite remote URLs on localhost
    if ((self.location?.hostname === 'localhost' || self.location?.href?.includes('localhost'))
        && url.includes('://data.civgraph.net/')) {
        // arch-ok R6: a classic worker loaded on its own (importScripts), outside the bundle: it cannot import the config
        url = url.replace('https://data.civgraph.net/', self.location.origin + '/_r/');
    }

    // Resolve relative URLs against the page origin. Inside a Web Worker
    // `fetch()` resolves relatives against the worker script URL (e.g.
    // /js/fgb-worker.js), so a path like `data/maps/...` would otherwise be
    // looked up under /js/data/... and 404. Force same-origin root resolution.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith('/')) {
        url = self.location.origin + '/' + url;
    }

    try {
        let source = null;
        let compressed = false;

        // Try pre-compressed .fgb.gz first
        if (useCompressed && typeof pako !== 'undefined' && url.toLowerCase().endsWith('.fgb')) {
            try {
                const gzResp = await fetch(url + '.gz');
                if (gzResp.ok) {
                    const buf = new Uint8Array(await gzResp.arrayBuffer());
                    source = pako.ungzip(buf);
                    compressed = true;
                }
            } catch { /* fall through */ }
        }

        if (!source) {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
            source = new Uint8Array(await resp.arrayBuffer());
        }

        const features = [];
        let skippedCount = 0;

        for await (const feature of flatgeobuf.deserialize(source)) {
            if (minDiag > 0) {
                if (bboxDiag(feature.geometry) < minDiag) {
                    skippedCount++;
                    continue;
                }
            }
            features.push(feature);
        }

        self.postMessage({
            id,
            features,
            featureCount: features.length,
            skippedCount,
            compressed,
            durationMs: Math.round(performance.now() - start)
        });
    } catch (err) {
        // fetch, the reads and the throw above each reject with an Error.
        self.postMessage({ id, error: /** @type {Error} */ (err).message });
    }
};
