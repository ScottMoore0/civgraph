/*
 * Civgraph root service worker for the promoted MapLibre shell.
 *
 * The root route now runs the MapLibre runtime generated under /app. Root owns
 * production navigation, cache status, and stale-cache cleanup. The retired apps'
 * workers (/render/, /test/, /test2/) are retired by their own kill switch,
 * render/sw.js; this worker never touches their scopes' registrations.
 */

// Bump this on any change that must invalidate client caches, not only on a bundle
// rebuild. activate() deletes every cache whose name does not derive from VERSION, so
// changing it is what flushes stale entries already sitting in visitors' browsers --
// necessary here because the browse indexes cached under the previous routing rule
// would otherwise outlive the fix below.
const VERSION = 'root-maplibre-sw-73b7155d3620';
const STATIC_CACHE = `civgraph-root-maplibre-${VERSION}-static`;
const RUNTIME_CACHE = `civgraph-root-maplibre-${VERSION}-runtime`;
const CACHE_PREFIX = 'civgraph-root-maplibre-';
const MAX_RUNTIME_ENTRIES = 220;
const MAX_STATIC_ENTRIES = 320;
const QUOTA_CLEANUP_THRESHOLD = 0.75;

const ALL_CACHES = [STATIC_CACHE, RUNTIME_CACHE];

// The worker's lifecycle (state-machine catalogue MA-14, REFACTOR-PLAN section 11; full weight).
// The browser runs it: this table only names the states this worker's global scope passes
// through and the order the platform guarantees, so a move outside it is reported, not obeyed.
//   parsed      the script ran; no lifecycle event yet. A worker the browser stopped and woke
//               again (to answer a fetch or a message) stays here: it is already active.
//   installing  the install event: the shell is precached (best effort)
//   installed   precache done and skipWaiting() called (ACTIVATION_POLICY)
//   activating  the activate event: caches of other versions are deleted (cacheVersionOf)
//   active      clients.claim() done: this worker controls the open pages
// parsed -> activating is the browser waking a stopped, installed worker to activate it.
// This is a classic worker script and cannot import assets/ui/state/machine.js, so the table is
// inline; tests/unit/service-worker-lifecycle.test.mjs builds it with defineMachine and checks
// that lifecycleMove() agrees with the helper's semantics.
const LIFECYCLE_TRANSITIONS = { parsed: ['installing', 'activating'], installing: ['installed'], installed: ['activating'], activating: ['active'], active: [] };
let lifecycleState = 'parsed';

/** Enter `next`; a move the table does not list is warned about, then taken (the platform decides). */
function lifecycleMove(next) {
  const allowed = LIFECYCLE_TRANSITIONS[lifecycleState] || [];
  if (allowed.indexOf(next) === -1) console.warn(`service worker lifecycle: ${lifecycleState} -> ${next} is not a transition`);
  lifecycleState = next;
  return lifecycleState;
}

// When a new version takes over: at once (skipWaiting at install, not when the last page
// using the old one closes) and over the pages already open (clients.claim at activate).
// The SKIP_WAITING message asks for the same thing early.
const ACTIVATION_POLICY = { skipWaitingOnInstall: true, claimOnActivate: true };

/**
 * A cache's standing against this VERSION: `current` (STATIC_CACHE or RUNTIME_CACHE), `retired`
 * (a root or legacy prefix under another version: deleted at activate) or `foreign` (another
 * worker's, such as the retired apps' kill switch: never touched).
 */
function cacheVersionOf(name) {
  if (ALL_CACHES.includes(name)) return 'current';
  if (LEGACY_ROOT_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'retired';
  return 'foreign';
}
const LEGACY_ROOT_CACHE_PREFIXES = [
  CACHE_PREFIX,
  'civgraph-test2-',
  'civgraph-static-',
  'civgraph-runtime-',
  'civgraph-fgb-',
  'civgraph-thumb-',
  'civgraph-tile-'
];

// /offline.html is precached DELIBERATELY: it is the one page that must be available
// when the network is not, so fetching it on demand would defeat its own purpose.
const PRECACHE_URLS = ['/', '/index.html', '/offline.html'];

const CACHE_FIRST_PATHS = [
  '/app/build/chunks/',
  '/assets/fonts/',
  '/assets/images/',
  '/assets/thumbnails/'
  // The layer-details, duplicate-feature-ids and elections-test2-summaries sidecars were
  // here. They are rebuilt by data deploys, which do not change VERSION, so cache-first
  // kept serving the previous edition's copy until the next app release. As
  // /render/metadata/ JSON they now take the network-first route in isRuntimeJson().
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
  '/manifest.json'
];

const NEVER_CACHE_PATTERNS = [
  /\/sw\.js(?:[?#]|$)/,
  /\/test2\/sw\.js(?:[?#]|$)/,
  /\.pmtiles(?:[?#]|$)/i,
  /\/test\/metadata\/elections-test2\//,
  /\/feature-indexes\//,
  /\/data\/browse\//,
  /\/browse\//,
  // Who is signed in, and contributions, are never kept: they are per person, not records.
  /\/_api\/(?:auth|contributions|rum)(?:[/?#]|$)/
];

self.addEventListener('install', (event) => {
  lifecycleMove('installing');
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
    if (ACTIVATION_POLICY.skipWaitingOnInstall) await self.skipWaiting();
    lifecycleMove('installed');
  })());
});

self.addEventListener('activate', (event) => {
  lifecycleMove('activating');
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => cacheVersionOf(name) === 'retired')
      .map((name) => caches.delete(name)));
    if (ACTIVATION_POLICY.claimOnActivate) await self.clients.claim();
    lifecycleMove('active');
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

  // The thumbnail images never change under a name, but the manifest listing them does:
  // cache-first kept serving the old list, so new thumbnails stayed blank until the
  // worker's version changed. It is fetched network-first, like the other indexes.
  if (url.pathname === '/assets/thumbnails/manifest.json') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

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
  // Catalogue and discovery JSON must be network-first, because it is regenerated on
  // every data change while the app bundle stays put.
  //
  // /data/browse/ was missing here and that is a real bug, not a tidy-up: it fell
  // through to staleWhileRevalidate, which returns `cached || networkPromise`. So a
  // returning visitor was served the browse index AS IT WAS ON THEIR LAST VISIT and only
  // picked up new layers on a subsequent load. Since VERSION is tied to the app bundle
  // hash, a data-only deploy never bumped it, so activate() never purged the runtime
  // cache and the stale entry survived indefinitely. Net effect: newly published map
  // layers were invisible in Browse to anyone who had used the site before, while
  // appearing correctly for a first-time visitor -- which is exactly how it was reported.
  //
  // /_api/ (data design phase 2): records come from D1, and a load changes them without
  // changing VERSION, so they are network-first too -- staleWhileRevalidate showed a returning
  // visitor the previous publish's records once. Offline, the runtime cache still answers.
  // /data/graph/ left: Browse reads the graph from /_api/graph. /data/browse/ stays while the
  // map records, features and the index are still read from it (until phase 3).
  if (url.pathname.startsWith('/_api/')) return true;
  return url.pathname.endsWith('.json') && (
    url.pathname.startsWith('/data/database/') ||
    url.pathname.startsWith('/data/browse/') ||
    url.pathname.startsWith('/render/metadata/')
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
    return offlineResponse(request);
  }
}

/**
 * What to serve when the network is gone.
 *
 * This used to be `new Response('Offline')` -- the single word, with an empty <title>, no
 * branding, no explanation and no way back. A user who lost connection got what looked
 * like a broken blank page with no indication it was even Civgraph.
 *
 * A NAVIGATION gets the real offline page. Anything else -- a tile, a JSON shard, a
 * bundle -- gets a plain 503, because handing HTML to code expecting JSON turns a clear
 * network failure into a parse error somewhere further away.
 */
async function offlineResponse(request) {
  if (request.mode === 'navigate') {
    const cache = await caches.open(STATIC_CACHE);
    const page = await cache.match('/offline.html');
    if (page) {
      return new Response(await page.blob(), {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
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
    return offlineResponse(request);
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
