/**
 * Edge search — returns features matching a name query.
 *
 * Usage: GET /_api/search?q=Belfast&limit=25
 *
 * Falls back to reading the static names index from the origin when KV is not configured.
 */

// In-memory cache for the names index, per Worker isolate.
//
// TTL, because an isolate can live for hours. Without one this was cached for
// the life of the isolate with no way to flush it short of a redeploy, so after
// the names index was rebuilt some edge locations served the old one and others
// the new one, indefinitely and with no way to tell which. That is principle 9 --
// the deployed artefact is not necessarily the running one -- in a place where
// nothing checked it.
//
// Five minutes: long enough that a burst of searches costs one fetch, short
// enough that a rebuild is picked up without anyone intervening.
const NAMES_TTL_MS = 5 * 60 * 1000;
let cachedNames = null;
let cachedAt = 0;

async function getNames(context, origin) {
    if (cachedNames && Date.now() - cachedAt < NAMES_TTL_MS) return cachedNames;

    // Try KV first
    if (context.env.SPATIAL_INDEX) {
        const data = await context.env.SPATIAL_INDEX.get('names', 'json');
        if (data) {
            cachedNames = data;
            cachedAt = Date.now();
            return cachedNames;
        }
    }

    // Fallback: fetch the static names index
    try {
        const resp = await fetch(new URL('/data/database/spatial-index/_names.json', origin).toString());
        if (resp.ok) {
            cachedNames = await resp.json();
            cachedAt = Date.now();
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
    const matches = [];

    // COLLECT EVERYTHING, THEN RANK, THEN TRUNCATE -- in that order.
    //
    // This used to `break` at `limit` inside the loop and sort afterwards, which
    // truncated in INDEX ORDER and then ranked whatever happened to survive. A
    // prefix match sitting at position 3,000 was never seen if 25 substring
    // matches appeared earlier in the file, so searching "Bel" returned
    // "Annabella" and "Campbelltown" while Belfast depended on where it sat in
    // the index. The scoring ran, produced a number, and changed nothing.
    //
    // The scan was already full-file in the worst case; only the truncation
    // point was wrong.
    for (const feature of names) {
        const name = (feature.name || '').toLowerCase();
        if (!name.includes(lowerQuery)) continue;
        matches.push({
            ...feature,
            score: name.startsWith(lowerQuery) ? 2 : 1
        });
    }

    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.name || '').localeCompare(b.name || '');
    });
    const results = matches.slice(0, limit);

    return new Response(JSON.stringify({ results }), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
