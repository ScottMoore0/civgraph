/**
 * Civgraph /test service worker.
 *
 * Scope is intentionally limited to /test/. It does not cache or intercept the
 * production root app. Keep this simple while the MapLibre rewrite is under
 * active development.
 */

const TEST_CACHE_VERSION = 'test-v3';
const TEST_STATIC_CACHE = `civgraph-${TEST_CACHE_VERSION}-static`;
const TEST_RUNTIME_CACHE = `civgraph-${TEST_CACHE_VERSION}-runtime`;
const TEST_TILE_CACHE = `civgraph-${TEST_CACHE_VERSION}-tiles`;
const TEST_CACHES = [TEST_STATIC_CACHE, TEST_RUNTIME_CACHE, TEST_TILE_CACHE];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(TEST_STATIC_CACHE);
    await Promise.all([
      cache.add('/test/').catch(() => {}),
      cache.add('/test/index.html').catch(() => {})
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('civgraph-test-') || key.startsWith('civgraph-test-v'))
        .filter((key) => !TEST_CACHES.includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_TEST_CACHES') {
    event.waitUntil(Promise.all(TEST_CACHES.map((name) => caches.delete(name))));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin || !url.pathname.startsWith('/test/')) {
    return;
  }

  if (req.mode === 'navigate' || url.pathname === '/test/' || url.pathname === '/test/index.html') {
    event.respondWith(networkFirst(req, TEST_RUNTIME_CACHE));
    return;
  }

  if (url.pathname === '/test/sw.js' || url.pathname.startsWith('/test/metadata/')) {
    event.respondWith(networkFirst(req, TEST_RUNTIME_CACHE));
    return;
  }

  if (url.pathname.startsWith('/test/build/')) {
    event.respondWith(cacheFirst(req, TEST_STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith('/test/tiles/')) {
    event.respondWith(cacheFirst(req, TEST_TILE_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(req, TEST_RUNTIME_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || network;
}
