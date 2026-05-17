/**
 * Real-user monitoring endpoint — receives Core Web Vitals beacons.
 *
 * Usage: POST /_api/rum  with JSON body
 *   { metric, value, id, navigationType, rating, url, ua, ts }
 *
 * Body is structured-logged so the metric stream is visible in:
 *   - Cloudflare dashboard: Pages → civgraph → Functions → real-time logs
 *   - `wrangler pages tail civgraph` for live tail
 *
 * No PII collected: no IP, no user identifier. Only the metric, page URL
 * (path + sanitised query), and a coarse UA category (mobile/desktop).
 * The `id` field is a per-page-visit nonce from web-vitals, used only to
 * dedupe multiple emissions for the same metric (LCP can fire multiple
 * times as the largest element changes).
 *
 * Logging-only for now — the user can later wire this to Cloudflare
 * Analytics Engine, KV, D1, or an external endpoint without touching
 * the client snippet.
 */

export async function onRequestPost(context) {
    let body;
    try {
        body = await context.request.json();
    } catch {
        return new Response(null, { status: 204 });
    }

    // Tolerate bad input — drop the beacon silently.
    if (!body || typeof body !== 'object') return new Response(null, { status: 204 });

    const url = String(body.url || '');
    // Drop URL fragments/query that could carry session-specific data.
    const cleanUrl = url.split('#')[0].split('?')[0];

    const log = {
        evt: 'rum',
        metric: String(body.metric || ''),
        value: Number(body.value) || 0,
        rating: String(body.rating || ''),
        id: String(body.id || ''),
        navType: String(body.navigationType || ''),
        url: cleanUrl,
        ua: typeof body.ua === 'string' ? body.ua.slice(0, 32) : '',
        ts: Date.now(),
    };
    // Structured JSON line — easy to parse with `wrangler tail | jq`.
    console.log(JSON.stringify(log));

    return new Response(null, { status: 204 });
}

// Reject everything except POST so the route isn't probe-able.
export async function onRequest(context) {
    if (context.request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
    }
    return onRequestPost(context);
}
