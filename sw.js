/*
 * Civgraph root service worker for the promoted MapLibre shell.
 *
 * The root route now runs the MapLibre runtime generated under /app. Keep
 * /test2 as a tiny compatibility route, but let root own production navigation,
 * cache status, and stale-cache cleanup.
 */

const VERSION = 'root-maplibre-sw-91d7e081a445';
const STATIC_CACHE = `civgraph-root-maplibre-${VERSION}-static`;
const RUNTIME_CACHE = `civgraph-root-maplibre-${VERSION}-runtime`;
const CACHE_PREFIX = 'civgraph-root-maplibre-';
const MAX_RUNTIME_ENTRIES = 220;
const MAX_STATIC_ENTRIES = 320;
const QUOTA_CLEANUP_THRESHOLD = 0.75;

const ALL_CACHES = [STATIC_CACHE, RUNTIME_CACHE];
const LEGACY_ROOT_CACHE_PREFIXES = [
  CACHE_PREFIX,
  'civgraph-test2-',
  'civgraph-static-',
  'civgraph-runtime-',
  'civgraph-fgb-',
  'civgraph-thumb-',
  'civgraph-tile-'
];

const PRECACHE_URLS = ['/', '/index.html'];

const CACHE_FIRST_PATHS = [
  '/app/build/chunks/',
  '/assets/fonts/',
  '/assets/images/',
  '/assets/thumbnails/',
  '/test/metadata/layer-details-test2/',
  '/test/metadata/duplicate-feature-ids/',
  '/test/metadata/elections-test2-summaries/'
];

const NETWORK_FIRST_PATHS = [
  '/index.html',
  '/app/build/app.bundle.js',
  '/app/build/app.bundle.css',
  '/app/build/performance-dashboard.json',
  '/app/js/jquery-shim.js',
  '/app/js/libs/flatgeobuf-geojson.min.js',
  '/app/election-viewer-package/js/stages2.js',
  '/app/election-viewer-package/js/animation_preview.js',
  '/app/election-viewer-package/js/animation_preview_manager.js',
  '/app/election-viewer-package/js/election_viewer.js',
  '/app/election-viewer-package/css/stages.css',
  '/app/election-viewer-package/css/election-viewer.css',
  '/app/src/search-worker.js',
  '/app/src/overlay-worker.js',
  '/build/main.css',
  '/build/main.critical.css',
  '/build/about.css',
  '/manifest.json',
  '/test2/',
  '/test2/index.html',
  '/test/metadata/maps-test-index.json'
];

const NEVER_CACHE_PATTERNS = [
  /\/sw\.js(?:[?#]|$)/,
  /\/test2\/sw\.js(?:[?#]|$)/,
  /\.pmtiles(?:[?#]|$)/i,
  /\/test\/metadata\/elections-test2\//,
  /\/feature-indexes\//,
  /\/data\/browse\//,
  /\/browse\//
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response?.ok) await cache.put(url, response);
      } catch {
        // Install should not fail because the shell could not be warmed.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => LEGACY_ROOT_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .filter((name) => !ALL_CACHES.includes(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data?.type || event.data;
  if (type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (type === 'TEST2_SW_STATUS') {
    event.waitUntil(statusPayload().then((status) => {
      event.ports?.[0]?.postMessage?.(status);
    }));
  } else if (type === 'TEST2_SW_CLEAR') {
    event.waitUntil(clearCaches().then((status) => {
      event.ports?.[0]?.postMessage?.(status);
    }));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isTileUrl(url)) {
    event.respondWith(cacheFirstWithCap(request, STATIC_CACHE, MAX_STATIC_ENTRIES));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return;
  if (shouldNeverCache(url)) return;

  if (matchesPath(url, CACHE_FIRST_PATHS)) {
    event.respondWith(cacheFirstWithCap(request, STATIC_CACHE, MAX_STATIC_ENTRIES));
    return;
  }

  if (matchesPath(url, NETWORK_FIRST_PATHS) || isRuntimeJson(url)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

function shouldNeverCache(url) {
  const value = `${url.pathname}${url.search}`;
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(value));
}

function matchesPath(url, paths) {
  return paths.some((path) => url.pathname === path || url.pathname.startsWith(path));
}

function isRuntimeJson(url) {
  return url.pathname.endsWith('.json') && (
    url.pathname.startsWith('/data/database/') ||
    url.pathname.startsWith('/test/metadata/')
  );
}

function isTileUrl(url) {
  return url.hostname.endsWith('.tile.openstreetmap.org') || url.hostname === 'tile.openstreetmap.org';
}

async function cacheFirstWithCap(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    await safePut(cache, request, response, maxEntries);
    return response;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    await safePut(cache, request, response, MAX_RUNTIME_ENTRIES);
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/') || await cache.match('/index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: false });
  const networkPromise = fetch(request).then(async (response) => {
    await safePut(cache, request, response, MAX_RUNTIME_ENTRIES);
    return response;
  }).catch(() => cached);
  return cached || networkPromise;
}

async function safePut(cache, request, response, maxEntries) {
  if (!response || (!response.ok && response.type !== 'opaque')) return;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 2 * 1024 * 1024) return;
  await cache.put(request, response.clone());
  await enforceCacheBudget(cache, maxEntries);
}

async function enforceCacheBudget(cache, maxEntries) {
  const keys = await cache.keys();
  const estimate = await storageEstimate();
  const overQuota = estimate.quota > 0 && estimate.usage / estimate.quota > QUOTA_CLEANUP_THRESHOLD;
  if (keys.length <= maxEntries && !overQuota) return;
  const target = overQuota ? Math.max(40, Math.floor(maxEntries * 0.6)) : maxEntries;
  const deleteCount = Math.max(0, keys.length - target);
  await Promise.all(keys.slice(0, deleteCount).map((request) => cache.delete(request)));
}

async function statusPayload() {
  const names = await caches.keys();
  const cacheEntries = {};
  for (const name of names.filter((item) => item === STATIC_CACHE || item === RUNTIME_CACHE)) {
    cacheEntries[name] = (await caches.open(name).then((cache) => cache.keys())).length;
  }
  return {
    version: VERSION,
    scope: self.registration.scope,
    caches: cacheEntries,
    storage: await storageEstimate()
  };
}

async function clearCaches() {
  await Promise.all([caches.delete(STATIC_CACHE), caches.delete(RUNTIME_CACHE)]);
  return statusPayload();
}

async function storageEstimate() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      usage: Number(estimate?.usage || 0),
      quota: Number(estimate?.quota || 0)
    };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
