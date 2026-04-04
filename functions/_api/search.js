/**
 * Edge search — returns features matching a name query.
 *
 * Usage: GET /_api/search?q=Belfast&limit=25
 *
 * Falls back to reading the static names index from the origin when KV is not configured.
 */

// In-memory cache for the names index (persists across requests within the same Worker isolate)
let cachedNames = null;

async function getNames(context, origin) {
    if (cachedNames) return cachedNames;

    // Try KV first
    if (context.env.SPATIAL_INDEX) {
        const data = await context.env.SPATIAL_INDEX.get('names', 'json');
        if (data) {
            cachedNames = data;
            return cachedNames;
        }
    }

    // Fallback: fetch the static names index
    try {
        const resp = await fetch(new URL('/data/database/spatial-index/_names.json', origin).toString());
        if (resp.ok) {
            cachedNames = await resp.json();
            return cachedNames;
        }
    } catch {
        // ignore
    }

    return [];
}

export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const query = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 100);

    if (!query || query.length < 2) {
        return new Response(JSON.stringify({ results: [] }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const names = await getNames(context, url.origin);
    const lowerQuery = query.toLowerCase();
    const results = [];

    for (const feature of names) {
        if (results.length >= limit) break;
        const name = (feature.name || '').toLowerCase();
        if (name.includes(lowerQuery)) {
            results.push({
                ...feature,
                score: name.startsWith(lowerQuery) ? 2 : 1
            });
        }
    }

    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.name || '').localeCompare(b.name || '');
    });

    return new Response(JSON.stringify({ results }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
