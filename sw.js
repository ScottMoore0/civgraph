/**
 * Service Worker — Phase 1: Cache-first for immutable assets
 *
 * Caches .fgb map data and .woff2 font files on first fetch.
 * These files never change once deployed, so serving from cache
 * eliminates network round-trips on repeat visits.
 *
 * Mutable assets (HTML, JS, CSS, JSON) are NOT cached here —
 * they continue to use normal browser caching (ETags / 304s).
 *
 * To force a cache clear: increment CACHE_VERSION.
 * To remove the SW entirely: delete this file — app.js will
 * auto-unregister stale workers on next load.
 */

const CACHE_VERSION = 1;
const CACHE_NAME = `boundaries-immutable-v${CACHE_VERSION}`;

/**
 * Returns true if the request URL is an immutable asset that
 * should be served cache-first.
 */
function isImmutableAsset(url) {
    const path = new URL(url).pathname;
    return path.endsWith('.fgb') || path.endsWith('.fgb.gz') || path.endsWith('.woff2');
}

// ——— Install ———
// Claim immediately so returning users get caching on the next fetch,
// not the next full page load.
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// ——— Activate ———
// Clean up old cache versions and claim all open tabs.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key.startsWith('boundaries-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// ——— Fetch ———
// Cache-first for immutable assets; network-only for everything else.
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!isImmutableAsset(event.request.url)) return;

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) =>
            cache.match(event.request).then((cached) => {
                if (cached) return cached;

                return fetch(event.request).then((response) => {
                    // Only cache successful responses
                    if (response.ok) {
                        cache.put(event.request, response.clone());
                    }
                    return response;
                });
            })
        )
    );
});

// ——— Message ———
// Handle PREFETCH_FGB from app.js (prefetchNearbyMaps).
self.addEventListener('message', (event) => {
    if (event.data?.type !== 'PREFETCH_FGB') return;
    const urls = event.data.urls;
    if (!Array.isArray(urls) || urls.length === 0) return;

    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            for (const url of urls) {
                const fullUrl = new URL(url, self.location.origin).href;
                const existing = await cache.match(fullUrl);
                if (existing) continue;
                try {
                    const response = await fetch(fullUrl);
                    if (response.ok) {
                        await cache.put(fullUrl, response);
                    }
                } catch {
                    // Prefetch is best-effort — ignore network failures
                }
            }
        })
    );
});
