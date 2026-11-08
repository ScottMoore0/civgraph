// The retired-app kill switch (render/sw.js, test2/sw.js, and /test/sw.js through a 200 rule in
// _redirects): its bytes, the addresses that serve it, and what it does when a browser installs it
// in place of a legacy worker. The browser half is tests/browser/retired-service-worker.spec.cjs.
//
//   node --test tests/unit/retired-service-worker.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { matchRedirect, parseRedirects } from '../../scripts/lib/pages-redirects.mjs';

// Pinned. A browser compares a worker byte for byte, and these bytes are what retire every legacy
// worker still installed in the field, so a change here must be deliberate: update the pin, run the
// browser spec, and keep both copies identical.
const KILL_SWITCH_SHA256 = 'da1d26a0d1f71824165491f3c00f7252b3c04e430eb865b008159ca3d815d253';
const COPIES = ['render/sw.js', 'site/test2/sw.js'];

const source = readFileSync('render/sw.js', 'utf8');
const rules = parseRedirects(readFileSync('site/_redirects', 'utf8'));

test('the kill switch is the pinned bytes, and every copy is identical', () => {
  for (const file of COPIES) {
    const bytes = readFileSync(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), KILL_SWITCH_SHA256, file);
    assert.ok(!bytes.includes(13), `${file} has a carriage return: the copies must be LF only`);
  }
});

test('every address a legacy worker was registered from answers with the kill switch, not a redirect', () => {
  // A browser refuses a redirect when it updates a worker, so each must be a 200.
  assert.equal(matchRedirect(rules, '/render/sw.js'), null, '/render/sw.js must reach the file');
  assert.equal(matchRedirect(rules, '/test2/sw.js'), null, '/test2/sw.js must reach the file');
  const testWorker = matchRedirect(rules, '/test/sw.js');
  assert.equal(testWorker?.status, 200, '/test/sw.js must be proxied, above the /test/* redirect');
  assert.equal(testWorker.location, '/render/sw.js');
});

test('the retired pages answer 301 to the map app, keeping the query', () => {
  for (const path of ['/render', '/render/', '/render/index.html', '/render/build/test.bundle.js',
    '/test2', '/test2/', '/test2/index.html', '/test', '/test/', '/test/index.html', '/maps/test', '/maps/test/']) {
    const hit = matchRedirect(rules, path, '?catalogue=next');
    assert.equal(hit?.status, 301, path);
    assert.equal(hit.location, '/maps/?catalogue=next', path);
  }
});

test('the data the old apps read keeps its addresses', () => {
  assert.equal(matchRedirect(rules, '/render/metadata/maps-test.json'), null);
  assert.equal(matchRedirect(rules, '/render/metadata/feature-indexes/lgd-2012-vector.json'), null);
  assert.deepEqual(
    matchRedirect(rules, '/test/metadata/maps-test-index.json')?.location,
    '/render/metadata/maps-test-index.json'
  );
});

test('the kill switch clears only the legacy caches, never the root worker\'s', () => {
  const prefixes = JSON.parse(source.match(/RETIRED_CACHE_PREFIXES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const rootPrefix = readFileSync('site/sw.js', 'utf8').match(/const CACHE_PREFIX = '([^']+)'/)[1];
  assert.ok(rootPrefix);
  for (const prefix of prefixes) assert.ok(!rootPrefix.startsWith(prefix), `${prefix} would delete ${rootPrefix}*`);
  // Each legacy worker's own cache names are covered.
  for (const name of ['civgraph-test-v65-static', 'civgraph-test-v65-pmtiles', 'civgraph-test2-sw-95c62849fe44-static', 'test2-sw-runtime']) {
    assert.ok(prefixes.some((prefix) => name.startsWith(prefix)), name);
  }
});

/** Run the worker in a fake ServiceWorkerGlobalScope and drive install and activate. */
async function runWorker({ scope, cacheNames, pages }) {
  const handlers = {};
  const log = [];
  const caches = {
    names: [...cacheNames],
    async keys() { return [...this.names]; },
    async delete(name) { log.push(`delete ${name}`); this.names = this.names.filter((n) => n !== name); return true; }
  };
  const clients = {
    async claim() { log.push('claim'); },
    async matchAll(options) {
      // Only the windows this worker controls (no includeUncontrolled): pages under the root
      // worker, such as /maps/ itself, are never navigated.
      assert.equal(options.type, 'window');
      assert.equal(options.includeUncontrolled, undefined);
      return pages.map((url) => ({ url, async navigate(to) { log.push(`navigate ${url} -> ${to}`); } }));
    }
  };
  const self = {
    clients,
    registration: { scope, async unregister() { log.push('unregister'); return true; } },
    async skipWaiting() { log.push('skipWaiting'); },
    addEventListener(type, handler) { handlers[type] = handler; }
  };
  vm.runInNewContext(source, { self, caches, URL, URLSearchParams });
  for (const type of ['install', 'activate']) {
    const waits = [];
    handlers[type]({ waitUntil: (promise) => waits.push(promise) });
    await Promise.all(waits);
  }
  return { handlers, log, caches };
}

test('installed over a legacy worker, it takes over, clears, unregisters, then moves its pages to /maps/', async () => {
  const origin = 'https://civgraph.net';
  const { handlers, log, caches } = await runWorker({
    scope: `${origin}/render/`,
    cacheNames: ['civgraph-test-v65-static', 'civgraph-test-v65-tiles', 'civgraph-root-maplibre-root-maplibre-sw-x-static', 'civgraph-test2-sw-1-runtime'],
    pages: [
      `${origin}/render/#layers=lgd-2012-vector&lng=-6.5&lat=54.6&z=8.250`,
      `${origin}/render/index.html?debug=1#layers=a,b&zoom=7&z=3`,
      `${origin}/render/`
    ]
  });
  assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'install'], 'no fetch handler: every request goes to the network');
  assert.deepEqual(caches.names, ['civgraph-root-maplibre-root-maplibre-sw-x-static']);
  assert.deepEqual(log, [
    'skipWaiting',
    'delete civgraph-test-v65-static',
    'delete civgraph-test-v65-tiles',
    'delete civgraph-test2-sw-1-runtime',
    'claim',
    'unregister',
    `navigate ${origin}/render/#layers=lgd-2012-vector&lng=-6.5&lat=54.6&z=8.250 -> ${origin}/maps/#layers=lgd-2012-vector&lng=-6.5&lat=54.6&zoom=8.250`,
    // zoom already given: z is left alone (the map app reads zoom first).
    `navigate ${origin}/render/index.html?debug=1#layers=a,b&zoom=7&z=3 -> ${origin}/maps/?debug=1#layers=a,b&zoom=7&z=3`,
    `navigate ${origin}/render/ -> ${origin}/maps/`
  ]);
});

test('a page that cannot be navigated does not stop the others', async () => {
  const handlers = {};
  const navigated = [];
  const self = {
    clients: {
      async claim() {},
      async matchAll() {
        return [
          { url: 'https://civgraph.net/test2/#zoom=6', async navigate() { throw new TypeError('not controlled'); } },
          { url: 'https://civgraph.net/test2/', async navigate(to) { navigated.push(to); } }
        ];
      }
    },
    registration: { scope: 'https://civgraph.net/test2/', async unregister() { return true; } },
    async skipWaiting() {},
    addEventListener(type, handler) { handlers[type] = handler; }
  };
  vm.runInNewContext(source, { self, caches: { async keys() { return []; }, async delete() { return true; } }, URL });
  const waits = [];
  handlers.activate({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
  assert.deepEqual(navigated, ['https://civgraph.net/maps/']);
});
