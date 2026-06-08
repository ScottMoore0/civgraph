const VERSION = 'test2-sw-13e2c0afbae3';
const STATIC_CACHE = `civgraph-${VERSION}-static`;
const RUNTIME_CACHE = `civgraph-${VERSION}-runtime`;
const CACHE_PREFIX = 'civgraph-test2-';
const MAX_RUNTIME_ENTRIES = 180;
const QUOTA_CLEANUP_THRESHOLD = 0.75;

const CACHE_FIRST_PATHS = [
  '/test2/build/chunks/',
  '/assets/fonts/',
  '/test/metadata/layer-details-test2/',
  '/test/metadata/duplicate-feature-ids/',
  '/test/metadata/elections-test2-summaries/'
];

const NETWORK_FIRST_PATHS = [
  '/test2/',
  '/test2/index.html',
  '/test2/build/test2.bundle.js',
  '/test2/build/test2.bundle.css',
  '/test2/build/performance-dashboard.json',
  '/test2/src/search-worker.js',
  '/test2/src/overlay-worker.js',
  '/test/metadata/maps-test-index.json'
];

const NEVER_CACHE_PATTERNS = [
  /\.pmtiles(?:[?#]|$)/i,
  /\/test\/metadata\/elections-test2\//,
  /\/feature-indexes\//,
  /\/data\/browse\//,
  /\/browse\//
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) || name.startsWith('civgraph-test2-'))
      .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'TEST2_SW_STATUS') {
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldNeverCache(url)) return;
  if (matchesPath(url, CACHE_FIRST_PATHS)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (matchesPath(url, NETWORK_FIRST_PATHS)) {
    event.respondWith(networkFirst(request));
  }
});

function shouldNeverCache(url) {
  const value = `${url.pathname}${url.search}`;
  return NEVER_CACHE_PATTERNS.some((pattern) => pattern.test(value));
}

function matchesPath(url, paths) {
  return paths.some((path) => url.pathname === path || url.pathname.startsWith(path));
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  await safePut(cache, request, response);
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    await safePut(cache, request, response);
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    throw error;
  }
}

async function safePut(cache, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return;
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > 2 * 1024 * 1024) return;
  await cache.put(request, response.clone());
  await enforceRuntimeBudget();
}

async function enforceRuntimeBudget() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  const estimate = await storageEstimate();
  const overQuota = estimate.quota > 0 && estimate.usage / estimate.quota > QUOTA_CLEANUP_THRESHOLD;
  if (keys.length <= MAX_RUNTIME_ENTRIES && !overQuota) return;
  const target = overQuota ? Math.max(40, Math.floor(MAX_RUNTIME_ENTRIES * 0.6)) : MAX_RUNTIME_ENTRIES;
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
