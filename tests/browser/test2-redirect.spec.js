const { test, expect } = require('@playwright/test');

/**
 * `/test2/` is a compatibility redirect, and these are the only two things about it that
 * are still true and still worth guarding.
 *
 * It used to be the staging app. The MapLibre stack was promoted to `/` and test2/ was
 * reduced to two files: an index.html that preserves search and hash and calls
 * location.replace('/'), and a service worker whose only job is to unregister the legacy
 * /test2/ worker and clear its caches.
 *
 * test2-app.spec.js was that app's acceptance suite. Forty-two tests kept navigating to a
 * route that immediately became `/`, so thirty passed for the wrong reason and twelve
 * failed on assertions about a path that no longer serves anything. That file is now
 * pointed at `/`, where it belongs, and the /test2/-specific behaviour lives here.
 *
 * Two tests, not forty-two. A redirect has very little surface, and pretending otherwise
 * is what produced a suite asserting things nobody had checked in months.
 *
 * WHY test2/ IS KEPT AT ALL: a _redirects rule could do the first of these and cannot do
 * the second. A redirect never runs, so it can never unregister a service worker, and
 * anyone who loaded /test2/ before June 2026 still has that worker installed.
 */

test('/test2/ reaches the app with search and hash intact', async ({ page }) => {
  const hash = '#layers=__none&lng=-8.12&lat=53.48&zoom=7.00';
  await page.goto(`/test2/${hash}`);

  // The redirect is client-side, so wait for it rather than reading the URL immediately.
  await page.waitForFunction(() => window.location.pathname === '/', null, { timeout: 30000 });

  expect(new URL(page.url()).pathname).toBe('/');
  // The hash is the whole point: it carries the layers, viewport and panel state that
  // make an old shared link still resolve to what it described.
  expect(page.url()).toContain('layers=__none');
  expect(page.url()).toContain('zoom=7.00');
});

test('/test2/ serves a service worker whose job is to unregister the legacy one', async ({ page }) => {
  const response = await page.request.get('/test2/sw.js');
  expect(response.status()).toBe(200);
  const body = await response.text();

  // Asserting intent, not implementation: it must clear the legacy caches and unregister
  // itself. If someone ever replaces this with a real worker, that is a decision worth
  // stopping on rather than discovering from a stale cache in the field.
  expect(body).toMatch(/civgraph-test2-|test2-sw-/);
  expect(body).toMatch(/unregister|caches\.delete/);
});
