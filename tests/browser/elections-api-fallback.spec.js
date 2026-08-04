const { test, expect } = require('@playwright/test');

/**
 * Prove the fallback works AND is observable.
 *
 * The API is the default path, so a failure degrades to the static bundle rather than
 * breaking the viewer. That is the right behaviour and a monitoring hazard: a broken
 * API looks like a working site. This forces the API to fail, then asserts the election
 * still loads from the static bundle and that a beacon reached /_api/rum -- because a
 * fallback nobody can see is indistinguishable from one that never fires.
 */
const BASE = process.env.PARITY_BASE_URL || 'https://civgraph.net';

test('a failing elections API falls back to the static bundle and reports it', async ({ page }) => {
  test.setTimeout(180000);

  const beacons = [];
  const staticFetches = [];
  // Fail every bundle-mode API call.
  await page.route('**/_api/elections?*format=bundle*', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: '{"error":"forced failure"}',
  }));
  await page.route('**/_api/rum', async (route) => {
    beacons.push(route.request().postData() || '');
    await route.fulfill({ status: 204, body: '' });
  });
  page.on('request', (r) => {
    if (/elections-test2\/.*\.json/.test(r.url())) staticFetches.push(r.url());
  });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.elections, null, { timeout: 60000 });

  const loaded = await page.evaluate(async () => {
    const mgr = window.__civgraphTest2.elections;
    await mgr.load();
    await mgr.loadElection('Northern Ireland Assembly', '2022-05-05');
    await new Promise((r) => setTimeout(r, 2500));
    const b = mgr.activeBundle;
    return {
      key: b?.key || null,
      constituencies: (b?.results || []).length,
      candidates: (b?.results || []).reduce((s, r) => s + (r.candidates || []).length, 0),
      paneLength: document.getElementById('electionPaneContent')?.innerHTML.length || 0,
    };
  });

  // The election still loaded, from the static bundle.
  expect(loaded.key).toBe('northern-ireland-assembly__2022-05-05');
  expect(loaded.constituencies).toBe(18);
  expect(loaded.candidates).toBeGreaterThan(0);
  expect(loaded.paneLength).toBeGreaterThan(0);
  expect(staticFetches.length).toBeGreaterThan(0);

  // And the degradation was reported rather than swallowed.
  await page.waitForTimeout(1500);
  const parsed = beacons.map((b) => { try { return JSON.parse(b); } catch { return {}; } });
  const fallback = parsed.filter((b) => b.metric === 'elections-api-fallback');
  expect(fallback.length).toBeGreaterThan(0);
  expect(fallback[0].source).toBe('elections');
  expect(fallback[0].event?.reason).toContain('500');
  expect(fallback[0].event?.layerId).toBe('northern-ireland-assembly__2022-05-05');
});
