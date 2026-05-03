/**
 * Serve map data files from R2.
 *
 * For binary FGB streams, callers fetch `.fgb.gz` explicitly and decompress
 * with pako, so we serve the pre-compressed `.br` / `.gz` keys directly
 * with the appropriate Content-Encoding when the client advertises support.
 *
 * For JSON files (chunk indices, feature indices) the browser uses
 * fetch().json() which relies on the runtime to auto-decode the body. The
 * Pages-Function path through Cloudflare does not reliably decode a
 * manually-set `Content-Encoding: br` for the browser, so JSON is served
 * uncompressed from the base key — Cloudflare's edge compresses it on the
 * wire to the client.
 */
export async function onRequestGet(context) {
    const key = `data/maps/${context.params.path.join('/')}`;
    const accept = (context.request.headers.get('Accept-Encoding') || '').toLowerCase();
    const lowerKey = key.toLowerCase();
    const isJson = lowerKey.endsWith('.json');

    const bucket = context.env.MAPS_BUCKET;
    if (!bucket) {
        // R2 not bound — pass through to origin (static files)
        return context.next();
    }

    const baseHeaders = {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
    };

    if (isJson) {
        const obj = await bucket.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
            headers: { ...baseHeaders, 'Content-Type': 'application/json' }
        });
    }

    const binaryHeaders = { ...baseHeaders, 'Content-Type': 'application/octet-stream' };

    // Try Brotli first
    if (accept.includes('br')) {
        const brObj = await bucket.get(key + '.br');
        if (brObj) {
            return new Response(brObj.body, {
                headers: { ...binaryHeaders, 'Content-Encoding': 'br' }
            });
        }
    }

    // Try gzip
    if (accept.includes('gzip')) {
        const gzObj = await bucket.get(key + '.gz');
        if (gzObj) {
            return new Response(gzObj.body, {
                headers: { ...binaryHeaders, 'Content-Encoding': 'gzip' }
            });
        }
    }

    // Uncompressed fallback
    const obj = await bucket.get(key);
    if (!obj) return new Response('Not found', { status: 404 });
    return new Response(obj.body, { headers: binaryHeaders });
}
