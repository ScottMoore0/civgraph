const { test, expect } = require('@playwright/test');

/**
 * Prove the D1-backed election API is a drop-in for the static bundles, in a browser.
 *
 * The data diff already shows the API reproduces all 281 bundles field for field. That
 * is necessary and not sufficient: it says nothing about whether the client renders the
 * same thing from it, and the client takes the lite response, which deliberately omits
 * countGroup and elected and expects the renderer to cope.
 *
 * So this loads the same election twice against production -- once on the static path,
 * once with ?electionsApi=1 -- and compares what actually came out: the rendered pane
 * HTML, the constituency/candidate counts, and whether the animation payload the count
 * animation consumes is present and non-empty.
 *
 * It runs against https://civgraph.net rather than the local server, because Pages
 * Functions do not exist under `python -m http.server`, so /_api/elections would 404.
 */

const { BASE } = require('./helpers/base-url');
// Spread across bodies, eras and voting systems. The Dail entries matter most: their
// countGroup rows carry fields (Auto_Returned_Ceann_Comhairle, Synthetic_Scraper_Row)
// that later elections lack, and that shape variance is what defeated reconstruction.
const CASES = [
  { body: 'Northern Ireland Assembly', date: '2022-05-05' },
  { body: 'Northern Ireland Assembly', date: '1982-10-20' },
  { body: 'Dáil Éireann', date: '2024-11-29' },
  { body: 'Dáil Éireann', date: '1918-12-14' },
  { body: 'European Parliament (Ireland)', date: '1979-06-07' },
];

async function loadElection(page, { api, body, date }) {
  const requests = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/_api/elections') || u.includes('elections-test2/')) requests.push(u);
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  // The API path is now the default, so the static run must opt out explicitly.
  await page.goto(`${BASE}/?electionsApi=${api ? '1' : '0'}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest2?.elections, null, { timeout: 60000 });

  const result = await page.evaluate(async ({ body, date }) => {
    const mgr = window.__civgraphTest2.elections;
    // The catalogue is loaded lazily; findEntry() is empty until this resolves.
    await mgr.load();
    await mgr.loadElection(body, date);
    await new Promise((r) => setTimeout(r, 2500));
    const bundle = mgr.activeBundle;
    const results = bundle?.results || [];
    return {
      key: bundle?.key || null,
      displayTitle: bundle?.displayTitle || null,
      resultCount: results.length,
      candidateTotal: results.reduce((s, r) => s + (r.candidates || []).length, 0),
      firstPrefTotal: results.reduce(
        (s, r) => s + (r.candidates || []).reduce((t, c) => t + (Number(c.firstPrefs) || 0), 0), 0),
      matchedCount: bundle?.matchedCount ?? null,
      loadable: bundle?.loadable ?? null,
      // Measured BEFORE the panel is driven: on the lite path every payload should be
      // absent at this point, which is what makes the 32.7% saving real.
      animationRowsBeforeOpen: results.map((r) => (r.animationPayload?.Constituency?.countGroup || []).length),
      // countGroup resolves via animationPayload, which lite fetches lazily, so this
      // is legitimately empty on the API path until a constituency is opened.
      countGroupRowsBeforeOpen: results.map((r) => (r.countGroup
        || r.animationPayload?.Constituency?.countGroup || []).length),
      countGroupOnBundle: results.some((r) => Array.isArray(r.countGroup)),
      // Lite omits animationPayload entirely; it is fetched per constituency on open.
      animationPayloadOnBundle: results.some((r) => Boolean(r.animationPayload)),
      hasAnimation: results.map((r) => Boolean(mgr.resultHasAnimation?.(r))),
      // Actually drive the count animation rather than just checking its input exists.
      // This is the path with no other coverage, and the one that consumes
      // animationPayload directly.
      animationRun: await (async () => {
        const idx = results.findIndex((r) => mgr.resultHasAnimation?.(r));
        if (idx < 0) return { state: 'no-animatable-constituency' };
        const target = results[idx];
        try {
          // renderPanel(result, 'animation') is what injects #electionAnimationContainer
          // and schedules runAnimation. Calling runAnimation directly is NOT a test: it
          // returns early and silently when that container is absent, so it reports
          // success without having run.
          mgr.renderPanel(target, 'animation');
          await new Promise((r) => setTimeout(r, 3500));
          const container = document.getElementById('electionAnimationContainer');
          if (!container) return { state: 'no-container' };
          const status = (document.getElementById('test2ElectionAnimationStatus')?.textContent || '').trim();
          if (/could not load|not available/i.test(status)) return { state: `engine: ${status}` };
          return {
            state: 'ran',
            index: idx,
            display: container.style.display || '',
            hasChildren: container.childNodes.length > 0,
            // After opening, the payload for THIS constituency must be present on both
            // paths -- on the API path only because the lazy fetch resolved it.
            rowsAfterOpen: (target.animationPayload?.Constituency?.countGroup || []).length,
            countGroupAfterOpen: (target.countGroup
              || target.animationPayload?.Constituency?.countGroup || []).length,
            // The panel that actually consumes countGroup, rendered from it.
            panelHTML: document.getElementById('electionPaneContent')?.innerHTML || '',
          };
        } catch (e) {
          return { state: `threw: ${e && e.message ? e.message : e}` };
        }
      })(),
      paneHTML: document.getElementById('electionPaneContent')?.innerHTML || '',
      paneTitle: document.getElementById('electionPaneTitle')?.textContent || '',
    };
  }, { body, date });

  return { ...result, requests, consoleErrors };
}

// /_api/elections is a Pages Function. It does not exist under the static test server,
// so against a local BASE the app correctly falls back to the static bundle and the
// "the API path used the API" assertion fails -- reporting a working fallback as a
// broken API. Probe once and skip with a reason rather than fail.
//
// Skipping is right ONLY because this spec's whole subject is the deployed transport.
// The scheduled production-parity CI job runs it against civgraph.net, where the
// endpoint exists and a failure means something.
let apiAvailable = null;
async function ensureApiAvailable(request) {
  if (apiAvailable !== null) return apiAvailable;
  try {
    const response = await request.get(`${BASE}/_api/elections?lite=1&limit=1`, { timeout: 20000 });
    apiAvailable = response.status() < 400;
  } catch {
    apiAvailable = false;
  }
  return apiAvailable;
}

for (const { body, date } of CASES) {
  test(`D1 election API renders identically to the static bundle: ${body} ${date}`, async ({ page, request }) => {
    test.setTimeout(240000);
    test.skip(!(await ensureApiAvailable(request)),
      `/_api/elections is not served by ${BASE} — set PARITY_BASE_URL to an origin with Pages Functions`);

    const staticRun = await loadElection(page, { api: false, body, date });
    const apiRun = await loadElection(page, { api: true, body, date });

    // Each path must actually have used the transport it claims to.
    expect(staticRun.requests.some((u) => u.includes('elections-test2/'))).toBe(true);
    expect(apiRun.requests.some((u) => u.includes('/_api/elections'))).toBe(true);
    expect(apiRun.requests.some((u) => u.includes('lite=1'))).toBe(true);
    expect(apiRun.requests.some((u) => u.includes(`elections-test2/${staticRun.key}`))).toBe(false);

    // The data the renderer actually saw.
    expect(apiRun.key).toBe(staticRun.key);
    expect(apiRun.resultCount).toBe(staticRun.resultCount);
    expect(apiRun.candidateTotal).toBe(staticRun.candidateTotal);
    expect(apiRun.firstPrefTotal).toBe(staticRun.firstPrefTotal);
    expect(apiRun.matchedCount).toBe(staticRun.matchedCount);
    expect(apiRun.loadable).toBe(staticRun.loadable);

    // Guard against a vacuous pass: an election with no candidates would satisfy
    // every equality above.
    expect(staticRun.resultCount).toBeGreaterThan(0);
    expect(staticRun.candidateTotal).toBeGreaterThan(0);
    expect(staticRun.firstPrefTotal).toBeGreaterThan(0);

    // countGroup and animationPayload are both absent from the lite bundle by design.
    expect(apiRun.countGroupOnBundle).toBe(false);
    expect(staticRun.countGroupOnBundle).toBe(true);
    expect(staticRun.countGroupRowsBeforeOpen.some((n) => n > 0)).toBe(true);
    expect(apiRun.countGroupRowsBeforeOpen.every((n) => n === 0)).toBe(true);

    // The animation payload must NOT have been shipped with the bundle on the API
    // path, and must be present on the static one -- that is the 32.7% saving.
    expect(staticRun.animationPayloadOnBundle).toBe(true);
    expect(apiRun.animationPayloadOnBundle).toBe(false);

    // Before opening, the API path must carry no payloads at all.
    expect(staticRun.animationRowsBeforeOpen.some((n) => n > 0)).toBe(true);
    expect(apiRun.animationRowsBeforeOpen.every((n) => n === 0)).toBe(true);

    expect(apiRun.hasAnimation).toEqual(staticRun.hasAnimation);

    // The animation itself: same constituency chosen, a real container, and the
    // lazily fetched payload matching the static one row for row.
    expect(apiRun.animationRun.state).toBe('ran');
    expect(staticRun.animationRun.state).toBe('ran');
    expect(apiRun.animationRun.index).toBe(staticRun.animationRun.index);
    expect(apiRun.animationRun.display).toBe('block');
    expect(apiRun.animationRun.hasChildren).toBe(true);
    expect(apiRun.animationRun.rowsAfterOpen).toBe(staticRun.animationRun.rowsAfterOpen);
    expect(apiRun.animationRun.rowsAfterOpen).toBeGreaterThan(0);
    // Once opened, countGroup resolves to the same rows as the static path...
    expect(apiRun.animationRun.countGroupAfterOpen).toBe(staticRun.animationRun.countGroupAfterOpen);
    // ...and the panel rendered from it is identical.
    expect(apiRun.animationRun.panelHTML.length).toBeGreaterThan(0);
    expect(apiRun.animationRun.panelHTML).toBe(staticRun.animationRun.panelHTML);

    // And the rendered output itself -- the whole point of the exercise.
    expect(staticRun.paneHTML.length).toBeGreaterThan(0);
    expect(apiRun.paneHTML.length).toBeGreaterThan(0);
    expect(apiRun.paneTitle).toBe(staticRun.paneTitle);
    expect(apiRun.paneHTML).toBe(staticRun.paneHTML);

    expect(apiRun.consoleErrors).toEqual([]);
  });
}
