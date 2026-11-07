/*
 * Civgraph retired-app service worker: a kill switch.
 *
 * The legacy map apps at /test/ (renamed /render/ in August 2026), /render/ and /test2/
 * registered service workers scoped to their own paths. Those apps are retired: their pages
 * answer 301 to /maps/ (_redirects). A redirect cannot remove a worker that is already
 * installed, because the worker answers before the network is asked, and a worker script
 * cannot itself be redirected (the browser refuses the update). So this file is served,
 * byte for byte the same, at each address a worker was registered from:
 *
 *   /render/sw.js   render/sw.js
 *   /test2/sw.js    test2/sw.js
 *   /test/sw.js     render/sw.js, proxied by a 200 rule in _redirects
 *
 * When a browser that still holds one of the old workers checks it for an update (on the
 * next visit to any address in its scope, or when the open page asks), it installs this
 * one instead, which:
 *   1. takes over at once (skipWaiting, then clients.claim for any open page in its scope);
 *   2. deletes the legacy apps' caches (prefixes below), and nothing of the live site's
 *      (sw.js at the root keeps civgraph-root-maplibre-*);
 *   3. unregisters itself, so the scope falls back to the root worker or to none;
 *   4. sends each page it controlled to the same view at /maps/, keeping the query and the
 *      hash, with the old app's `z=` written as the map app's `zoom=`.
 *
 * It has no fetch handler, so from the moment it is installed every request goes to the
 * network. tests/unit/retired-service-worker.test.mjs pins these bytes and runs it against a
 * fake worker scope; tests/browser/retired-service-worker.spec.js installs each old worker in
 * Chromium and watches this one retire it. Keep the copies identical.
 */
'use strict';

const RETIRED_CACHE_PREFIXES = ['civgraph-test-', 'civgraph-test2-', 'test2-sw-'];

/** Where a page of a retired app now lives: /maps/, with its query and hash kept. */
function retiredAppDestination(href) {
  const from = new URL(href);
  const to = new URL('/maps/', from.origin);
  to.search = from.search;
  let hash = from.hash.replace(/^#/, '');
  if (/(?:^|&)z=/.test(hash) && !/(?:^|&)zoom=/.test(hash)) hash = hash.replace(/(^|&)z=/, '$1zoom=');
  to.hash = hash;
  return to.href;
}

async function retire() {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => RETIRED_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .map((name) => caches.delete(name)));
  await self.clients.claim();
  const pages = await self.clients.matchAll({ type: 'window' });
  await self.registration.unregister();
  await Promise.all(pages.map((page) => page.navigate(retiredAppDestination(page.url)).catch(() => null)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retire());
});
