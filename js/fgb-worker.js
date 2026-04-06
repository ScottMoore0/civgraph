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
 */
function bboxDiag(geometry) {
    if (!geometry || !geometry.coordinates) return Infinity;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    function walk(coords, depth) {
        if (depth === 0) {
            // coords is [lng, lat]
            if (coords[0] < minX) minX = coords[0];
            if (coords[0] > maxX) maxX = coords[0];
            if (coords[1] < minY) minY = coords[1];
            if (coords[1] > maxY) maxY = coords[1];
        } else {
            for (let i = 0; i < coords.length; i++) walk(coords[i], depth - 1);
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
    const { id, url, zoom, minDiag, useCompressed } = event.data;
    const start = performance.now();

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
        self.postMessage({ id, error: err.message });
    }
};
