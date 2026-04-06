/**
 * Serve FGB map files from R2 with content-negotiated compression.
 *
 * - Checks Accept-Encoding for br (Brotli) or gzip
 * - Serves pre-compressed .fgb.br or .fgb.gz from R2 if available
 * - Falls back to uncompressed .fgb
 * - Sets immutable cache headers (files never change once deployed)
 */
export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    // path param captures everything after /data/maps/
    const key = `data/maps/${context.params.path.join('/')}`;
    const accept = (context.request.headers.get('Accept-Encoding') || '').toLowerCase();

    const bucket = context.env.MAPS_BUCKET;
    if (!bucket) {
        // R2 not bound — pass through to origin (static files)
        return context.next();
    }

    const headers = {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
    };

    // Try Brotli first
    if (accept.includes('br')) {
        const brObj = await bucket.get(key + '.br');
        if (brObj) {
            return new Response(brObj.body, {
                headers: { ...headers, 'Content-Encoding': 'br' }
            });
        }
    }

    // Try gzip
    if (accept.includes('gzip')) {
        const gzObj = await bucket.get(key + '.gz');
        if (gzObj) {
            return new Response(gzObj.body, {
                headers: { ...headers, 'Content-Encoding': 'gzip' }
            });
        }
    }

    // Uncompressed fallback
    const obj = await bucket.get(key);
    if (!obj) {
        return new Response('Not found', { status: 404 });
    }

    return new Response(obj.body, { headers });
}
