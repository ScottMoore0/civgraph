/**
 * Civgraph service worker — repeat-visit perf + offline tolerance.
 *
 * Strategy per resource class:
 *   static  — cache-first   (fingerprinted: build/*?v=N, Leaflet, fonts)
 *   runtime — network-first (HTML, JSON databases — server controls freshness)
 *   fgb     — cache-first + LRU cap (immutable per server headers, files can be 20MB+)
 *   thumb   — stale-while-revalidate (occasional updates; SWR shows stale + fetches new)
 *   tile    — cache-first   (OSM tiles)
 *
 * On activate, any cache not carrying the current CACHE_VERSION suffix is
 * deleted. Bump CACHE_VERSION when you change SW strategy logic; fingerprinted
 * resources (build/*?v=N) invalidate naturally via their URL.
 */

const CACHE_VERSION = 'v2'; // v2: SWR-max-age for thumbnails (bytes regression fix)
const STATIC_CACHE  = `civgraph-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `civgraph-runtime-${CACHE_VERSION}`;
const FGB_CACHE     = `civgraph-fgb-${CACHE_VERSION}`;
const THUMB_CACHE   = `civgraph-thumb-${CACHE_VERSION}`;
const TILE_CACHE    = `civgraph-tile-${CACHE_VERSION}`;

const ALL_CACHES = [STATIC_CACHE, RUNTIME_CACHE, FGB_CACHE, THUMB_CACHE, TILE_CACHE];

// Hard caps per cache. Browsers evict on quota pressure anyway, but bounding
// these explicitly stops a heavy user from hoarding 1 GB of FGBs.
const CAPS = {
    [FGB_CACHE]: 50,
    [THUMB_CACHE]: 800,
    [TILE_CACHE]: 600,
};

// Minimal precache so a cold-cache offline visit can at least render the shell.
const PRECACHE_URLS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(STATIC_CACHE);
        // Use {cache:'reload'} so install doesn't pick up a stale HTTP cache copy.
        await Promise.all(PRECACHE_URLS.map(u =>
            fetch(u, { cache: 'reload' }).then(r => r.ok && cache.put(u, r)).catch(() => {})
        ));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Drop any cache from a previous SW version.
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => k.startsWith('civgraph-') && !ALL_CACHES.includes(k))
                .map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); } catch { return; }

    // HTML navigations — network-first so deploys propagate immediately.
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req, RUNTIME_CACHE));
        return;
    }

    // Cross-origin: only handle ones we know about (data CDN, tile servers).
    const sameOrigin = url.origin === self.location.origin;

    // FGB map data — immutable; cache-first with LRU cap.
    if ((sameOrigin && url.pathname.startsWith('/data/maps/')) ||
        url.hostname === 'data.civgraph.net') {
        event.respondWith(cacheFirstWithCap(req, FGB_CACHE));
        return;
    }

    // OSM tiles — cache-first.
    if (url.hostname.endsWith('.tile.openstreetmap.org') ||
        url.hostname === 'tile.openstreetmap.org') {
        event.respondWith(cacheFirstWithCap(req, TILE_CACHE));
        return;
    }

    if (!sameOrigin) return; // let the browser handle other cross-origin requests

    // JSON databases — network-first; falls back to cached copy when offline.
    if (url.pathname.startsWith('/data/database/') && url.pathname.endsWith('.json')) {
        event.respondWith(networkFirst(req, RUNTIME_CACHE));
        return;
    }

    // Thumbnails — SWR with a 7-day freshness window. Cached copy serves
    // immediately. Background refresh only fires when the cached entry's
    // server-sent Date is older than the max-age, so repeat visits within
    // the window incur zero network bytes for thumbs. After 7 days a
    // fresh fetch lands and replaces the cache for the next visit —
    // bounded staleness, no townlands-forever trap.
    if (url.pathname.startsWith('/assets/thumbnails/')) {
        event.respondWith(staleWhileRevalidateMaxAge(req, THUMB_CACHE, 7 * 24 * 60 * 60 * 1000));
        return;
    }

    // Fingerprinted bundles + stable assets — cache-first.
    if (url.pathname.startsWith('/build/') ||
        url.pathname.startsWith('/assets/fonts/') ||
        url.pathname.startsWith('/assets/css/leaflet-') ||
        url.pathname.startsWith('/assets/js/') ||
        url.pathname.startsWith('/assets/images/') ||
        url.pathname === '/manifest.json') {
        event.respondWith(cacheFirstWithCap(req, STATIC_CACHE));
        return;
    }

    // Everything else — stale-while-revalidate keeps things snappy without
    // risking stale-forever.
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE));
});

async function cacheFirstWithCap(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
            await cache.put(req, res.clone());
            trim(cacheName).catch(() => {});
        }
        return res;
    } catch {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

async function networkFirst(req, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
    } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        // For navigations, fall through to the precached shell so the user
        // doesn't see a browser error page.
        if (req.mode === 'navigate') {
            const shell = await cache.match('/') || await cache.match('/index.html');
            if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
}

async function staleWhileRevalidate(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const networkPromise = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).then(() => trim(cacheName).catch(() => {})).catch(() => {});
        }
        return res;
    }).catch(() => cached);
    return cached || networkPromise;
}

// Variant of SWR that only triggers the background refresh once the cached
// entry's server-sent Date is older than maxAgeMs. Used for thumbnails where
// the SWR refresh on every visit was the byte regression flagged in RUM.
async function staleWhileRevalidateMaxAge(req, cacheName, maxAgeMs) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const refetch = () => fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
            cache.put(req, res.clone()).then(() => trim(cacheName).catch(() => {})).catch(() => {});
        }
        return res;
    }).catch(() => null);
    if (cached) {
        const d = cached.headers.get('date');
        const cachedAt = d ? Date.parse(d) : 0;
        if (!cachedAt || (Date.now() - cachedAt) > maxAgeMs) {
            refetch(); // background only — don't await
        }
        return cached;
    }
    // No cache entry — must fetch
    const fresh = await refetch();
    return fresh || new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function trim(cacheName) {
    const cap = CAPS[cacheName];
    if (!cap) return;
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= cap) return;
    // FIFO eviction — keys() returns insertion order. Drop the oldest excess.
    const drop = keys.length - cap;
    for (let i = 0; i < drop; i++) await cache.delete(keys[i]);
}
