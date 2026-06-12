const VERSION = 'test2-compat-cleanup-20260612';
const LEGACY_CACHE_PREFIXES = [
  'civgraph-test2-',
  'test2-sw-'
];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate' && (url.pathname === '/test2' || url.pathname.startsWith('/test2/'))) {
    const target = new URL('/', self.location.origin);
    target.search = url.search;
    event.respondWith(Response.redirect(target.href, 302));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'TEST2_SW_STATUS') {
    event.source?.postMessage({
      type: 'TEST2_SW_STATUS',
      version: VERSION,
      mode: 'compat-cleanup'
    });
  }
});
