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

const BASE = process.env.PARITY_BASE_URL || 'https://civgraph.net';
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

  await page.goto(`${BASE}/${api ? '?electionsApi=1' : ''}`, { waitUntil: 'domcontentloaded' });
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
      // The count animation reads this object directly; empty here means a broken feature.
      animationRows: results.map((r) => (r.animationPayload?.Constituency?.countGroup || []).length),
      // What the renderer actually resolves. On the lite path countGroup is absent
      // from the bundle by design and derived at the point of use, so comparing the
      // raw field would test an implementation detail rather than behaviour.
      countGroupRows: results.map((r) => (r.countGroup
        || r.animationPayload?.Constituency?.countGroup || []).length),
      countGroupOnBundle: results.some((r) => Array.isArray(r.countGroup)),
      hasAnimation: results.map((r) => Boolean(mgr.resultHasAnimation?.(r))),
      // Actually drive the count animation rather than just checking its input exists.
      // This is the path with no other coverage, and the one that consumes
      // animationPayload directly.
      animationRun: await (async () => {
        const target = results.find((r) => mgr.resultHasAnimation?.(r));
        if (!target) return 'no-animatable-constituency';
        try {
          // renderPanel(result, 'animation') is what injects #electionAnimationContainer
          // and schedules runAnimation. Calling runAnimation directly is NOT a test:
          // it returns early and silently when that container is absent, so it reports
          // success without having run. Go through the panel instead, then assert the
          // container exists and the engine actually populated it.
          mgr.renderPanel(target, 'animation');
          await new Promise((r) => setTimeout(r, 3000));
          const container = document.getElementById('electionAnimationContainer');
          if (!container) return 'no-container';
          const status = document.getElementById('test2ElectionAnimationStatus');
          const statusText = (status?.textContent || '').trim();
          if (/could not load|not available/i.test(statusText)) return `engine: ${statusText}`;
          return JSON.stringify({
            display: container.style.display || '',
            childNodes: container.childNodes.length,
            status: statusText,
          });
        } catch (e) {
          return `threw: ${e && e.message ? e.message : e}`;
        }
      })(),
      paneHTML: document.getElementById('electionPaneContent')?.innerHTML || '',
      paneTitle: document.getElementById('electionPaneTitle')?.textContent || '',
    };
  }, { body, date });

  return { ...result, requests, consoleErrors };
}

for (const { body, date } of CASES) {
  test(`D1 election API renders identically to the static bundle: ${body} ${date}`, async ({ page }) => {
    test.setTimeout(240000);

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

    // countGroup: absent from the lite bundle by design, but the rows the renderer
    // resolves must be identical to the static path.
    expect(apiRun.countGroupOnBundle).toBe(false);
    expect(staticRun.countGroupOnBundle).toBe(true);
    expect(apiRun.countGroupRows).toEqual(staticRun.countGroupRows);

    // The animation feature.
    expect(apiRun.animationRows).toEqual(staticRun.animationRows);
    expect(apiRun.hasAnimation).toEqual(staticRun.hasAnimation);
    expect(apiRun.animationRun).toBe(staticRun.animationRun);
    // Must have got as far as a real container, not an early return.
    expect(apiRun.animationRun).not.toBe('no-container');
    expect(apiRun.animationRun).not.toMatch(/^threw:/);

    // And the rendered output itself -- the whole point of the exercise.
    expect(staticRun.paneHTML.length).toBeGreaterThan(0);
    expect(apiRun.paneHTML.length).toBeGreaterThan(0);
    expect(apiRun.paneTitle).toBe(staticRun.paneTitle);
    expect(apiRun.paneHTML).toBe(staticRun.paneHTML);

    expect(apiRun.consoleErrors).toEqual([]);
  });
}
