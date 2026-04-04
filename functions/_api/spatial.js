/**
 * Edge spatial query — returns features for a given mapId within a bounding box.
 *
 * Usage: GET /_api/spatial?mapId=lgd-2012&bbox=minLng,minLat,maxLng,maxLat
 *
 * Falls back to reading static chunk files from the origin when KV is not configured.
 */

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const mapId = url.searchParams.get('mapId');
    const bboxParam = url.searchParams.get('bbox');

    if (!mapId) {
        return new Response(JSON.stringify({ error: 'mapId required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    let features;

    // Try KV first (faster, no origin fetch)
    if (context.env.SPATIAL_INDEX) {
        const data = await context.env.SPATIAL_INDEX.get(`map:${mapId}`, 'json');
        features = data || [];
    } else {
        // Fallback: fetch the static chunk file from the origin
        try {
            const chunkUrl = new URL(`/data/database/spatial-index/${mapId}.json`, url.origin);
            const resp = await fetch(chunkUrl.toString());
            if (!resp.ok) {
                return new Response(JSON.stringify({ features: [] }), {
                    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
                });
            }
            features = await resp.json();
        } catch {
            features = [];
        }
    }

    // Apply bbox filter if provided
    if (bboxParam && features.length > 0) {
        const parts = bboxParam.split(',').map(Number);
        if (parts.length === 4 && parts.every(Number.isFinite)) {
            const [minLng, minLat, maxLng, maxLat] = parts;
            // 20% buffer
            const latBuf = (maxLat - minLat) * 0.2;
            const lngBuf = (maxLng - minLng) * 0.2;
            const bMinLng = minLng - lngBuf;
            const bMinLat = minLat - latBuf;
            const bMaxLng = maxLng + lngBuf;
            const bMaxLat = maxLat + latBuf;

            features = features.filter(f => {
                if (!f.bbox || f.bbox.length < 4) return false;
                const [fMinLng, fMinLat, fMaxLng, fMaxLat] = f.bbox;
                return !(fMaxLng < bMinLng || fMinLng > bMaxLng || fMaxLat < bMinLat || fMinLat > bMaxLat);
            });
        }
    }

    return new Response(JSON.stringify({ features }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
