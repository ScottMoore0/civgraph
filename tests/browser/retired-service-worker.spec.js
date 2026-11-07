const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The legacy map apps' service workers retire in a real browser.
 *
 * /test/ (until August 2026), /render/ and /test2/ each registered a worker scoped to its own
 * path. Those pages now answer 301 to /maps/ (_redirects), and a redirect cannot remove a worker
 * that is already installed. render/sw.js and test2/sw.js are a kill switch instead (see the file;
 * its bytes and its logic are unit-tested in tests/unit/retired-service-worker.test.mjs).
 *
 * Each test serves one origin of its own, in two phases:
 *   legacy  -- the worker that address served before (tests/browser/fixtures/legacy-service-workers,
 *              copied from git history) and a page that registers it as the old app did;
 *   retired -- the tree as it is now: _redirects applied as Pages applies it (first match, 301s
 *              and the 200 proxy of /test/sw.js), the kill switch at the worker addresses.
 * A browser installs the old worker in the first phase and is then watched retiring it in the
 * second. /maps/ is a stub page that runs only the map app's sweep (retire-legacy-workers.mjs):
 * what is tested is the worker's life, not the map app.
 *
 * Self-contained: no records build, no network beyond 127.0.0.1, so it runs in CI with the map specs.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'legacy-service-workers');
const LEGACY_WORKERS = {
  render: 'render-sw.js', // render/sw.js before 7 Nov 2026 (cache civgraph-test-v65-*)
  test: 'test-sw.js', // test/sw.js before the rename to render/ (dd30268b7b^)
  test2: 'test2-sw.js' // the June 2026 /test2/ compatibility worker, which never unregistered
};
const SWEEP = 'src/map/app/retire-legacy-workers.mjs';
const ROOT_CACHE = 'civgraph-root-maplibre-root-maplibre-sw-kept-static';

async function startSite() {
  const { parseRedirects, matchRedirect } = await import('../../scripts/lib/pages-redirects.mjs');
  const rules = parseRedirects(fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8'));
  const site = { phase: 'legacy' };
  const send = (res, status, type, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const legacyPage = (scope) => `<!doctype html><title>legacy /${scope}/</title><body>
    <script>
      navigator.serviceWorker.register('/${scope}/sw.js', { scope: '/${scope}/', updateViaCache: 'none' });
    </script></body>`;
  site.server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/maps/') {
      // In the retired phase the stub runs the map app's own sweep, the code /maps/ runs on load.
      const sweep = site.phase === 'retired'
        ? `<script type="module">import { retireLegacyServiceWorkers } from '/${SWEEP}';
             window.swept = retireLegacyServiceWorkers(navigator.serviceWorker);</script>`
        : '';
      return send(res, 200, 'text/html', `<!doctype html><title>maps</title><p>map app stub</p>${sweep}`);
    }
    if (site.phase === 'retired' && url.pathname === `/${SWEEP}`) {
      return send(res, 200, 'text/javascript', fs.readFileSync(path.join(ROOT, SWEEP)));
    }
    if (site.phase === 'legacy') {
      const scope = url.pathname.split('/')[1];
      if (LEGACY_WORKERS[scope]) {
        if (url.pathname === `/${scope}/sw.js`) {
          return send(res, 200, 'text/javascript', fs.readFileSync(path.join(FIXTURES, LEGACY_WORKERS[scope])));
        }
        if (url.pathname === `/${scope}/` || url.pathname === `/${scope}/index.html`) {
          return send(res, 200, 'text/html', legacyPage(scope));
        }
      }
      return send(res, 404, 'text/plain', 'not found');
    }
    const hit = matchRedirect(rules, url.pathname, url.search);
    let file = url.pathname;
    if (hit && hit.status !== 200) return send(res, hit.status, 'text/plain', '', { Location: hit.location });
    if (hit) file = hit.location.split('?')[0];
    if (!/^\/(render|test2)\/sw\.js$/.test(file)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/javascript', fs.readFileSync(path.join(ROOT, file)));
  });
  await new Promise((resolve) => site.server.listen(0, '127.0.0.1', resolve));
  site.origin = `http://127.0.0.1:${site.server.address().port}`;
  return site;
}

/** Install the old worker at /<scope>/ and seed caches as a visitor's browser would hold them. */
async function installLegacyWorker(page, site, scope, hash) {
  await page.goto(`${site.origin}/${scope}/${hash}`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
  await page.evaluate(async (rootCache) => {
    // The old apps' caches (the /render/ worker also made its own on install) and the live root
    // worker's, which must survive.
    for (const name of ['civgraph-test-v65-runtime', 'civgraph-test2-sw-95c62849fe44-static', rootCache]) {
      await (await caches.open(name)).put('/probe', new Response('x'));
    }
  }, ROOT_CACHE);
  const before = await page.evaluate(async () => ({
    scopes: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    caches: await caches.keys()
  }));
  expect(before.scopes).toEqual([`/${scope}/`]);
  expect(before.caches).toContain(ROOT_CACHE);
}

async function workerState(page) {
  return page.evaluate(async () => ({
    scopes: (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname),
    caches: (await caches.keys()).sort()
  }));
}

let site;
test.beforeEach(async () => { site = await startSite(); });
test.afterEach(async () => { await new Promise((resolve) => site.server.close(resolve)); });

for (const scope of Object.keys(LEGACY_WORKERS)) {
  test(`an open /${scope}/ page: the kill switch unregisters, clears the old caches and moves it to /maps/`, async ({ page }) => {
    await installLegacyWorker(page, site, scope, '#layers=lgd-2012-vector&lng=-6.50000&lat=54.60000&z=8.250');
    site.phase = 'retired';
    // What the old page does on its next load, or the browser on its own schedule: check for an update.
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).catch(() => {}));
    await page.waitForURL((url) => url.pathname === '/maps/', { timeout: 15000 });
    // The old app's z= becomes the map app's zoom=; the rest of the state is kept.
    expect(new URL(page.url()).hash).toBe('#layers=lgd-2012-vector&lng=-6.50000&lat=54.60000&zoom=8.250');
    await expect.poll(() => workerState(page), { timeout: 10000 }).toEqual({ scopes: [], caches: [ROOT_CACHE] });
  });

  test(`a returning visitor to /${scope}/: the old worker hands over to the 301, then retires`, async ({ page }) => {
    await installLegacyWorker(page, site, scope, '');
    await page.goto(`${site.origin}/maps/`);
    site.phase = 'retired';
    // A shared link to the old app, opened while the old worker is still installed. It answers the
    // navigation first; the network's 301 (or, at /test2/, the old worker's own redirect) lands on
    // /maps/ with the hash. The browser does not check the old worker for an update here (the
    // redirect took the page out of its scope: seen in Chromium), so the map app asks it to.
    await page.goto(`${site.origin}/${scope}/?from=share#layers=lgd-2012-vector&z=7`);
    await page.waitForURL((url) => url.pathname === '/maps/', { timeout: 15000 });
    const landed = new URL(page.url());
    expect(landed.search).toBe('?from=share');
    expect(landed.hash).toBe('#layers=lgd-2012-vector&z=7');
    await expect.poll(() => workerState(page), { timeout: 15000 }).toEqual({ scopes: [], caches: [ROOT_CACHE] });
    // And the next visit goes straight to the network: nothing is left to answer it.
    const response = await page.goto(`${site.origin}/${scope}/`);
    expect(response.url()).toBe(`${site.origin}/maps/`);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
  });
}
