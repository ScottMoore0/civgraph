const { test, expect } = require('@playwright/test');

// Verifies the Constituency/Counting-Area(NI) geography toggle on the
// 1998 and 2011 NI referendums: turnout mode swaps geometry + data + style.
test('/test2 2011 AV referendum geography toggle switches results <-> turnout', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.app);
  await page.evaluate(async () => {
    const elections = await window.__civgraphTest2.app.ensureElections();
    window.__civgraphTest2.elections = elections;
    await elections.loadElection('Referendum (Northern Ireland)', '2011-05-05-alternative-vote');
  });

  // Geography selector present with both options
  const options = await page.$$eval('#test2ElectionGeography option', (opts) => opts.map((o) => `${o.value}:${o.textContent.trim()}`));
  expect(options).toEqual(['results:Counting Area', 'turnout:Constituency']);

  // Default (results) mode
  const resultsState = await page.evaluate(() => {
    const e = window.__civgraphTest2.elections;
    return {
      src: e.getActiveElectionStyleSourceMapId(),
      turnout: e.isTurnoutGeographyMode(),
      rows: e.currentResults().length
    };
  });
  expect(resultsState.src).toBe('av-referendum-2011');
  expect(resultsState.turnout).toBe(false);
  expect(resultsState.rows).toBe(8);

  // Switch to Constituency (turnout)
  const turnoutState = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('turnout');
    const rows = e.currentResults();
    return {
      src: e.getActiveElectionStyleSourceMapId(),
      turnout: e.isTurnoutGeographyMode(),
      mode: e.activeMode,
      rows: rows.length,
      allHaveTurnout: rows.every((r) => Number.isFinite(Number(r.turnoutPct))),
      noteVisible: Boolean(document.querySelector('.test2-election-turnout__note')),
      tableRows: document.querySelectorAll('.test2-election-turnout table tbody tr').length
    };
  });
  expect(turnoutState.src).toBe('av-turnout-2011');
  expect(turnoutState.turnout).toBe(true);
  expect(turnoutState.mode).toBe('turnout');
  expect(turnoutState.rows).toBe(18);
  expect(turnoutState.allHaveTurnout).toBe(true);
  expect(turnoutState.noteVisible).toBe(true);
  expect(turnoutState.tableRows).toBe(18);

  // Switch back to results
  const backState = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('results');
    return { src: e.getActiveElectionStyleSourceMapId(), turnout: e.isTurnoutGeographyMode(), rows: e.currentResults().length };
  });
  expect(backState.src).toBe('av-referendum-2011');
  expect(backState.turnout).toBe(false);
  expect(backState.rows).toBe(8);
});

test('/test2 1998 GFA referendum offers NI vs Constituency turnout toggle', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.app);
  await page.evaluate(async () => {
    const elections = await window.__civgraphTest2.app.ensureElections();
    window.__civgraphTest2.elections = elections;
    await elections.loadElection('Referendum (Northern Ireland)', '1998-05-22-belfast-agreement');
  });
  const options = await page.$$eval('#test2ElectionGeography option', (opts) => opts.map((o) => `${o.value}:${o.textContent.trim()}`));
  expect(options).toEqual(['results:NI', 'turnout:Constituency']);

  const turnoutState = await page.evaluate(async () => {
    const e = window.__civgraphTest2.elections;
    await e.switchGeographyMode('turnout');
    return {
      src: e.getActiveElectionStyleSourceMapId(),
      rows: e.currentResults().length,
      tableRows: document.querySelectorAll('.test2-election-turnout table tbody tr').length
    };
  });
  expect(turnoutState.src).toBe('belfast-agreement-1998');
  expect(turnoutState.rows).toBe(18);
  expect(turnoutState.tableRows).toBe(18);
});
