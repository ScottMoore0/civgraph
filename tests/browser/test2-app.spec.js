const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');

const CIVIL_PARISHES_FALLBACK_DIR = path.join(__dirname, '..', '..', 'test', 'tiles', 'civil-parishes-v3');

async function loadCivilParishes(page) {
  const useLocalFallback = fs.existsSync(CIVIL_PARISHES_FALLBACK_DIR);
  return page.evaluate(async ({ useLocalFallback }) => {
    const app = window.__civgraphTest2.app;
    const layer = window.__civgraphTest2.metadataService.getLayer('civil-parishes-vector-test');
    if (useLocalFallback && layer?.tilesFallback) {
      layer.sourceType = 'mvt';
      layer.tiles = layer.tilesFallback;
    }
    await app.loadMap('civil-parishes-by-province');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
    return true;
  }, { useLocalFallback });
}

async function expectElectionFilterMenuInsideViewport(page) {
  const bounds = await page.locator('.election-filter-menu').evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const values = menu.querySelector('.election-filter-menu__values');
    const valuesRect = values?.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      valuesHeight: valuesRect?.height || 0,
      valuesClientHeight: values?.clientHeight || 0,
      valuesScrollHeight: values?.scrollHeight || 0
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.top).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
  expect(bounds.width).toBeGreaterThan(100);
  expect(bounds.height).toBeGreaterThan(100);
  expect(bounds.valuesHeight).toBeGreaterThan(20);
  expect(bounds.valuesScrollHeight + 2).toBeGreaterThanOrEqual(bounds.valuesClientHeight);
}

test('/test2 boots the production shell with the MapLibre adapter', async ({ page }) => {
  await page.goto('/test2/');
  await expect(page.getByRole('link', { name: 'Civgraph' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.locator('body.app-shell')).toBeVisible();
  await expect(page.locator('.app-main .pane--info')).toBeVisible();
  await expect(page.locator('.app-main .pane--map')).toBeVisible();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#catalogueFlatView')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.waitForFunction(() => document.querySelectorAll('#catalogueFlatView table tr').length > 10);
  await page.waitForFunction(() => document.querySelectorAll('#catalogueFlatView .flat-election-entry').length > 10);
  await page.waitForFunction(() => document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc .catalogue-flat__toc-decade-btn').length > 10);
  const state = await page.evaluate(() => ({
    hasMapLibre: Boolean(window.__civgraphTest2.mapController.map),
    layerCount: window.__civgraphTest2.metadataService.layers.length,
    rows: document.querySelectorAll('#catalogueFlatView table tr').length,
    electionRows: document.querySelectorAll('#catalogueFlatView .flat-election-entry').length,
    electionTocRows: document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc .flat-election-toc-link').length,
    decadeButtons: document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc .catalogue-flat__toc-decade-btn').length,
    firstElectionCard: (() => {
      const el = document.querySelector('#catalogueFlatView .flat-election-entry[data-election-placeholder="0"]');
      const rect = el?.getBoundingClientRect();
      return rect ? { text: el.textContent, top: rect.top, height: rect.height } : null;
    })(),
    hasLeaflet: Boolean(window.L)
  }));
  expect(state.hasMapLibre).toBe(true);
  expect(state.layerCount).toBeGreaterThan(10);
  expect(state.rows).toBeGreaterThan(10);
  expect(state.electionRows).toBeGreaterThan(10);
  expect(state.decadeButtons).toBeGreaterThan(10);
  expect(state.electionTocRows).toBe(0);
  expect(state.firstElectionCard).not.toBeNull();
  expect(state.firstElectionCard.text).toContain('Dáil');
  expect(state.hasLeaflet).toBe(false);
});

test('/test2 boots centred on Ireland when URL has no viewport state', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  const camera = await page.evaluate(() => {
    const center = window.__civgraphTest2.mapController.map.getCenter();
    return {
      lng: center.lng,
      lat: center.lat,
      zoom: window.__civgraphTest2.mapController.map.getZoom()
    };
  });
  expect(camera.lng).toBeGreaterThan(-12);
  expect(camera.lng).toBeLessThan(-4);
  expect(camera.lat).toBeGreaterThan(50);
  expect(camera.lat).toBeLessThan(56);
  expect(camera.zoom).toBeGreaterThan(4);
});

test('/test2 restores active Dail election catalogue, viewport, labels, and party table state', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelector('#catalogueFlatView .flat-election-entry--active'));

  const restored = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    const map = app.mapController.map;
    const activeRow = document.querySelector('#catalogueFlatView .flat-election-entry--active');
    const scroller = activeRow?.closest('.pane__content');
    const rowTexts = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)')]
      .slice(0, 4)
      .map((row) => row.children[1]?.textContent?.trim()?.replace(/\s+/g, ' '));
    const firstRowCells = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)')[0]?.children || []]
      .map((cell) => cell.textContent?.trim()?.replace(/\s+/g, ' '));
    const secondRowCells = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)')[1]?.children || []]
      .map((cell) => cell.textContent?.trim()?.replace(/\s+/g, ' '));
    return {
      path: location.pathname,
      hash: location.hash,
      activeRowText: activeRow?.textContent || '',
      activeRowTop: activeRow ? activeRow.getBoundingClientRect().top : null,
      scrollerTop: scroller ? scroller.getBoundingClientRect().top : null,
      lng: map.getCenter().lng,
      lat: map.getCenter().lat,
      zoom: map.getZoom(),
      domLabels: document.querySelectorAll('.maplibre-dom-label').length,
      rowTexts,
      firstRowCells,
      secondRowCells
    };
  });

  expect(restored.path).toBe('/test2/');
  expect(restored.hash).toContain('layers=election-dil-ireann-2024-11-29');
  expect(restored.hash).toContain('zoom=7.00');
  expect(restored.activeRowText).toContain('29 Nov 2024');
  expect(restored.activeRowText).toMatch(/D.il/);
  expect(restored.activeRowTop).toBeGreaterThanOrEqual(restored.scrollerTop - 4);
  expect(restored.lng).toBeCloseTo(-8.12, 1);
  expect(restored.lat).toBeCloseTo(53.48, 1);
  expect(restored.zoom).toBeCloseTo(7, 1);
  expect(restored.domLabels).toBe(0);
  expect(restored.rowTexts[0]).toMatch(/Fianna F.il/);
  expect(restored.rowTexts[1]).toMatch(/Sinn F.in/);
  expect(restored.rowTexts[2]).toBe('Fine Gael');
  expect(restored.rowTexts[3]).toBe('Independent');
  expect([restored.firstRowCells[0], restored.firstRowCells[2], restored.firstRowCells[4], restored.firstRowCells[8], restored.firstRowCells[10]]).toEqual([
    '1st',
    '82',
    '48',
    '481,414',
    '21.86%'
  ]);
  expect([restored.secondRowCells[0], restored.secondRowCells[2], restored.secondRowCells[4], restored.secondRowCells[8], restored.secondRowCells[10]]).toEqual([
    '2nd',
    '71',
    '39',
    '418,627',
    '19.01%'
  ]);

  await page.locator('#electionPaneContent th[data-leaf-col-idx="8"] .election-th-btn').click();
  await expect(page.locator('.election-filter-menu')).toBeVisible();
  await expect(page.locator('.election-filter-menu')).toContainText('Sort Largest to Smallest');
  await expectElectionFilterMenuInsideViewport(page);
  await page.locator('.election-filter-menu [data-action="sort-desc"]').click();
  const firstAfterSort = await page.locator('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)').first().textContent();
  expect(firstAfterSort).toMatch(/Fine Gael/);
  await expect(page.locator('#electionPaneContent th[data-leaf-col-idx="8"] .election-th-btn')).toHaveClass(/election-th-btn--active/);

  await page.locator('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn').click();
  await expect(page.locator('.election-filter-menu')).toBeVisible();
  await expect(page.locator('.election-filter-menu')).toContainText('Sort A to Z');
  await expectElectionFilterMenuInsideViewport(page);
  await page.locator('.election-filter-menu__search').fill('Sinn');
  await expect(page.locator('.election-filter-menu__value', { hasText: /Sinn/ })).toBeVisible();
  await expectElectionFilterMenuInsideViewport(page);
  await page.locator('.election-filter-menu [data-action="deselect-all"]').click();
  await page.locator('.election-filter-menu__value', { hasText: /Sinn/ }).locator('input').check();
  await page.locator('.election-filter-menu [data-action="apply"]').click();
  await expect(page.locator('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn')).toHaveClass(/election-th-btn--active/);
  const filteredRows = await page.locator('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)').allTextContents();
  expect(filteredRows.length).toBeGreaterThan(0);
  expect(filteredRows.every((row) => /Sinn/.test(row))).toBe(true);

  await page.locator('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn').click();
  await page.locator('.election-filter-menu [data-action="clear-filter"]').click();
  await expect(page.locator('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn')).not.toHaveClass(/election-th-btn--active/);
});

test('/test2 election sort/filter menu stays inside a constrained viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForSelector('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn');

  await page.locator('#electionPaneContent th[data-leaf-col-idx="1"] .election-th-btn').click();
  await expect(page.locator('.election-filter-menu')).toBeVisible();
  await expectElectionFilterMenuInsideViewport(page);

  await page.locator('.election-filter-menu__search').fill('Sinn');
  await expect(page.locator('.election-filter-menu__value', { hasText: /Sinn/ })).toBeVisible();
  await expectElectionFilterMenuInsideViewport(page);
});

test('/test2 Dail 2024 election pane matches the main DOM contract for the compared state', async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext({ viewport: { width: 960, height: 920 } });
  const mainPage = await context.newPage();
  const test2Page = await context.newPage();
  const hash = 'layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00';
  const extractPartyRows = async (page) => {
    await page.waitForSelector('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)', { timeout: 25000 });
    return page.evaluate(() => [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)')]
      .slice(0, 4)
      .map((row) => [...row.children].slice(0, 12).map((cell) => cell.textContent?.trim()?.replace(/\s+/g, ' '))));
  };

  await Promise.all([
    mainPage.goto('/'),
    test2Page.goto(`/test2/#${hash}`)
  ]);
  await mainPage.waitForFunction(() => window.uiController?.onLoadElection);
  await mainPage.evaluate(() => window.uiController.onLoadElection('Dáil Éireann', '2024-11-29'));
  await test2Page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await test2Page.evaluate(() => window.__civgraphTest2.restorePromise);

  const [mainRows, test2Rows] = await Promise.all([
    extractPartyRows(mainPage),
    extractPartyRows(test2Page)
  ]);

  expect(test2Rows).toEqual(mainRows);
  const rowsByParty = new Map(test2Rows.map((row) => [row[1], row]));
  const expectPartySummary = (party, { stood, seats, votes, share }) => {
    const row = rowsByParty.get(party);
    expect(row, `${party} row`).toBeTruthy();
    expect(row[2], `${party} candidates`).toBe(String(stood));
    expect(row[4], `${party} seats`).toBe(String(seats));
    expect(row[8], `${party} first preferences`).toBe(votes);
    expect(row[10], `${party} vote share`).toBe(share);
  };
  expect(test2Rows.map((row) => row[1])).toEqual(['Fianna F\u00e1il', 'Sinn F\u00e9in', 'Fine Gael', 'Independent']);
  expectPartySummary('Fianna F\u00e1il', { stood: 82, seats: 48, votes: '481,414', share: '21.86%' });
  expectPartySummary('Sinn F\u00e9in', { stood: 71, seats: 39, votes: '418,627', share: '19.01%' });
  expectPartySummary('Fine Gael', { stood: 80, seats: 38, votes: '458,134', share: '20.80%' });
  expectPartySummary('Independent', { stood: 171, seats: 16, votes: '290,748', share: '13.20%' });
  await context.close();
});

test('/test2 Dail election candidate and count panes follow the main pane contract', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1120, height: 920 } });
  const mainPage = await context.newPage();
  const test2Page = await context.newPage();
  const hash = 'layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00';
  const tableSignature = async (page) => page.evaluate(() => ({
    renderer: document.querySelector('#electionPaneContent [data-election-renderer]')?.getAttribute('data-election-renderer') || '',
    headerTabs: [...document.querySelectorAll('#electionPaneHeaderRight .election-view-tab')].map((button) => button.textContent.trim()),
    detailToggle: document.querySelector('#electionPaneHeaderRight #test2ElectionCountDetail, #electionPaneHeaderRight [data-role="detail-toggle"]')?.textContent?.trim() || '',
    oldCountToolbar: Boolean(document.querySelector('#electionPaneContent .test2-election-count-toolbar')),
    tableClass: document.querySelector('#electionPaneContent table')?.className || '',
    headers: [...document.querySelectorAll('#electionPaneContent table thead th')].map((th) => th.textContent.trim().replace(/\s+/g, ' ')).slice(0, 18),
    firstRows: [...document.querySelectorAll('#electionPaneContent table tbody tr:not(.election-table-summary-row)')]
      .slice(0, 3)
      .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')).slice(0, 12))
  }));

  await Promise.all([
    mainPage.goto('/'),
    test2Page.goto(`/test2/#${hash}`)
  ]);
  await mainPage.waitForFunction(() => window.uiController?.onLoadElection);
  await mainPage.evaluate(() => window.uiController.onLoadElection('Dáil Éireann', '2024-11-29'));
  await test2Page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await test2Page.evaluate(() => window.__civgraphTest2.restorePromise);

  await mainPage.waitForSelector('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)');
  await test2Page.waitForSelector('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)');
  await mainPage.locator('#electionPaneHeaderRight .election-view-tab', { hasText: 'By Candidate' }).click();
  await test2Page.evaluate(() => window.__civgraphTest2.app.elections.renderPanel(null, 'candidate'));
  await mainPage.waitForSelector('#electionPaneContent .election-count-table--candidate-sticky3 tbody tr');
  await test2Page.waitForFunction(() => document.querySelectorAll('#electionPaneContent .election-count-table--candidate-sticky3 tbody tr').length > 0);
  const [mainCandidate, test2Candidate] = await Promise.all([tableSignature(mainPage), tableSignature(test2Page)]);
  expect(mainCandidate.headers.length).toBeGreaterThan(0);
  expect(test2Candidate.renderer).toBe('test2-main-pane-contract');
  expect(test2Candidate.headers).toEqual(mainCandidate.headers);
  expect(test2Candidate.firstRows[0].slice(0, 10)).toEqual(mainCandidate.firstRows[0].slice(0, 10));
  expect(test2Candidate.tableClass).toContain('election-count-table--candidate-sticky3');

  await test2Page.evaluate(() => {
    const manager = window.__civgraphTest2.app.elections;
    const result = manager.activeBundle.results.find((row) => row.hasCountDetail)
      || manager.activeBundle.results[0];
    manager.renderPanel(result, 'counts');
  });
  await test2Page.waitForSelector('#electionPaneContent .election-count-table tbody tr');
  const test2Count = await tableSignature(test2Page);
  expect(test2Count.renderer).toBe('test2-main-pane-contract');
  expect(test2Count.detailToggle).toMatch(/Detailed View: Off|Detailed View: On/);
  expect(test2Count.oldCountToolbar).toBe(false);
  expect(test2Count.headers.join(' ')).toMatch(/Name|Party|Status/);
  expect(test2Count.headers.join(' ')).toMatch(/1st\s*pref|Count/);
  expect(test2Count.tableClass).toContain('election-count-table');
  await context.close();
});

test('/test2 selected Dail constituency party pane matches main controller output', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1120, height: 920 } });
  const mainPage = await context.newPage();
  const test2Page = await context.newPage();
  const hash = 'layers=election-dil-ireann-2024-11-29&electionSelected=roscommon-galway&electionView=party&lng=-8.12&lat=53.48&zoom=7.00';
  const tableSignature = async (page) => page.evaluate(() => ({
    title: document.querySelector('#electionPaneTitle')?.textContent?.trim() || '',
    tabs: [...document.querySelectorAll('#electionPaneHeaderRight .election-view-tab')].map((button) => button.textContent.trim()),
    tableClass: document.querySelector('#electionPaneContent table')?.className || '',
    headers: [...document.querySelectorAll('#electionPaneContent table thead th')]
      .map((th) => th.textContent.trim().replace(/\s+/g, ' ')),
    firstRows: [...document.querySelectorAll('#electionPaneContent table tbody tr:not(.election-table-summary-row):not(.election-table-note-row)')]
      .slice(0, 8)
      .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')).slice(0, 11))
  }));

  await Promise.all([
    mainPage.goto('/'),
    test2Page.goto(`/test2/#${hash}`)
  ]);
  await mainPage.waitForFunction(() => window.uiController?.onLoadElection);
  await mainPage.evaluate(async () => {
    await window.uiController.onLoadElection('Dáil Éireann', '2024-11-29');
    await new Promise((resolve) => setTimeout(resolve, 500));
    let target = null;
    const candidates = [];
    const visitLayer = (layer) => {
      const props = layer?.feature?.properties || {};
      const label = String(props.CONSTITUENCY || props.Constituency || props.constituency || props.CONSTITUENCYNAME || props.ConstituencyName || props.Name || props.name || Object.values(props).find((value) => /roscommon/i.test(String(value))) || '');
      if (label) candidates.push(label);
      if (/roscommon[\s-]+galway/i.test(label)) target = layer;
      if (!target && typeof layer?.eachLayer === 'function') layer.eachLayer(visitLayer);
    };
    window.mapController.map.eachLayer(visitLayer);
    if (!target) throw new Error(`Main Roscommon Galway election feature not found. Candidates: ${candidates.slice(0, 30).join(' | ')}`);
    const latlng = target.getBounds?.().getCenter?.() || target.getLatLng?.() || window.mapController.map.getCenter();
    target.fire('click', { target, layer: target, latlng });
  });
  await test2Page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await test2Page.evaluate(() => window.__civgraphTest2.restorePromise);

  await mainPage.waitForSelector('#electionPaneContent .election-party-table tbody tr');
  await test2Page.waitForSelector('#electionPaneContent .election-party-table tbody tr');
  const [mainSignature, test2Signature] = await Promise.all([
    tableSignature(mainPage),
    tableSignature(test2Page)
  ]);

  expect(test2Signature.title).toBe(mainSignature.title);
  expect(test2Signature.tabs).toEqual(mainSignature.tabs);
  expect(test2Signature.tableClass).toContain('election-party-table');
  expect(test2Signature.headers).toEqual(mainSignature.headers);
  const withoutPctDelta = (rows) => rows.map((row) => row.filter((_, index) => index !== 10));
  expect(withoutPctDelta(test2Signature.firstRows)).toEqual(withoutPctDelta(mainSignature.firstRows));
  await context.close();
});

test('/test2 selected Dail 2024 Cork North-Central pane uses constituency source values', async ({ page }) => {
  const hash = 'layers=election-dil-ireann-2024-11-29&electionSelected=cork-north-central&electionView=party&lng=-8.12&lat=53.48&zoom=7.00';
  await page.goto(`/test2/#${hash}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForSelector('#electionPaneContent .election-party-table tbody tr');

  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row):not(.election-table-note-row)')]
      .slice(0, 5)
      .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')).slice(0, 11));
    const swatches = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row):not(.election-table-note-row) .election-party-dot')]
      .slice(0, 5)
      .map((dot) => getComputedStyle(dot).backgroundColor);
    const tabs = [...document.querySelectorAll('#electionPaneHeaderRight .election-view-tab')].map((button) => button.textContent.trim());
    const manager = window.__civgraphTest2.app.elections;
    const result = manager.activeBundle.results.find((row) => row.constituency === 'Cork North Central');
    return {
      rows,
      swatches,
      tabs,
      hasCountDetail: result?.hasCountDetail,
      countNumbers: result?.countNumbers || [],
      syntheticRowsAboveFirst: (result?.countGroup || []).filter((row) => Number(row.Count_Number) > 1).length
    };
  });

  expect(state.hasCountDetail).toBe(false);
  expect(state.countNumbers).toEqual([1]);
  expect(state.syntheticRowsAboveFirst).toBe(0);
  expect(state.tabs).not.toContain('Transfers');
  expect(state.rows.map((row) => row[2])).toEqual(['Fianna F\u00e1il', 'Sinn F\u00e9in', 'Fine Gael', 'Irish Labour', 'Independent Ireland']);
  expect(state.rows.map((row) => [row[3], row[5], row[7]])).toEqual([
    ['3', '1', '13,892'],
    ['2', '1', '10,293'],
    ['3', '1', '9,837'],
    ['2', '1', '6,016'],
    ['1', '1', '5,733']
  ]);
  expect(state.swatches).toEqual([
    'rgb(102, 187, 102)',
    'rgb(50, 103, 96)',
    'rgb(102, 153, 255)',
    'rgb(204, 0, 0)',
    'rgb(59, 238, 86)'
  ]);

  await page.evaluate(() => {
    const manager = window.__civgraphTest2.app.elections;
    const result = manager.activeBundle.results.find((row) => row.constituency === 'Cork North Central');
    manager.renderPanel(result, 'counts');
  });
  await page.waitForFunction(() => document.querySelectorAll('#electionPaneContent .election-count-table tbody tr').length >= 7);
  const candidates = await page.evaluate(() => [...document.querySelectorAll('#electionPaneContent .election-count-table tbody tr')]
    .slice(0, 7)
    .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')).slice(0, 10)));
  expect(candidates.map((row) => row[2])).toEqual(["P\u00e1draig O'Sullivan", 'Thomas Gould', 'Colm Burke', "Kenneth O'Flynn", 'Tony Fitzgerald', 'Mick Barry', 'Eoghan Kenny']);
  expect(candidates.map((row) => row[7])).toEqual(['7,708', '7,399', '5,736', '5,733', '4,084', '3,494', '3,329']);
});

test('/test2 selected Dail 2024 Galway East pane computes constituency percentages and resizes', async ({ page }) => {
  test.setTimeout(90000);
  const hash = 'layers=election-dil-ireann-2024-11-29&electionSelected=galway-east&electionView=party&lng=-8.12&lat=53.48&zoom=7.00';
  await page.goto(`/test2/#${hash}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 60000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForSelector('#electionPaneContent .election-party-table tbody tr');

  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row):not(.election-table-note-row)')]
      .slice(0, 6)
      .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')).slice(0, 11));
    const summary = [...document.querySelectorAll('#electionPaneContent .election-table-summary-row')]
      .map((row) => [...row.children].map((cell) => cell.textContent.trim().replace(/\s+/g, ' ')));
    const manager = window.__civgraphTest2.app.elections;
    const result = manager.activeBundle.results.find((row) => row.constituency === 'Galway East');
    return {
      rows,
      summary,
      validPoll: result?.validPoll,
      countInfoValidPoll: result?.countInfo?.Valid_Poll,
      syntheticRowsAboveFirst: (result?.countGroup || []).filter((row) => Number(row.Count_Number) > 1).length
    };
  });

  expect(state.validPoll).toBe(54214);
  expect(state.countInfoValidPoll).toBe('54214');
  expect(state.syntheticRowsAboveFirst).toBe(0);
  expect(state.rows.map((row) => [row[2], row[3], row[5], row[7], row[9]])).toEqual([
    ['Fianna F\u00e1il', '2', '1', '14,196', '26.19%'],
    ['Fine Gael', '3', '1', '11,744', '21.66%'],
    ['Independent', '3', '1', '11,000', '20.29%'],
    ['Sinn F\u00e9in', '1', '1', '7,459', '13.76%'],
    ['Independent Ireland', '1', '0', '5,150', '9.50%'],
    ['Aont\u00fa', '1', '0', '1,554', '2.87%']
  ]);
  expect(state.summary.map((row) => row[2])).toEqual(['Valid votes', 'Electorate']);
  expect(state.summary[0].slice(3, 11)).toEqual(['14', '0', '4', '0', '54,214', '+11,694', '61.75%', '+0.34']);

  const beforeResize = await page.evaluate(() => {
    const pane = document.getElementById('electionResultsPane').getBoundingClientRect();
    const appMain = document.querySelector('.app-main').getBoundingClientRect();
    const handle = document.querySelector('[data-election-pane-resize]').getBoundingClientRect();
    return {
      paneHeight: Math.round(pane.height),
      appMainHeight: Math.round(appMain.height),
      handleX: Math.round(handle.left + handle.width / 2),
      handleY: Math.round(handle.top + handle.height / 2)
    };
  });
  await page.mouse.move(beforeResize.handleX, beforeResize.handleY);
  await page.mouse.down();
  await page.mouse.move(beforeResize.handleX, beforeResize.handleY - 70);
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterResize = await page.evaluate(() => {
    const pane = document.getElementById('electionResultsPane').getBoundingClientRect();
    const appMain = document.querySelector('.app-main').getBoundingClientRect();
    return {
      paneHeight: Math.round(pane.height),
      appMainHeight: Math.round(appMain.height),
      cssHeight: getComputedStyle(document.body).getPropertyValue('--test2-election-pane-height').trim()
    };
  });
  expect(afterResize.paneHeight).toBeGreaterThan(beforeResize.paneHeight + 20);
  expect(afterResize.appMainHeight).toBeLessThan(beforeResize.appMainHeight - 20);
  expect(afterResize.cssHeight).toMatch(/px$/);
});

test('/test2 dismisses stuck mobile thumbnail previews on outside tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.uiController?.ensureMobileThumbnailDismissal);
  const dismissed = await page.evaluate(() => {
    window.uiController.ensureMobileThumbnailDismissal();
    const zoom = document.createElement('span');
    zoom.className = 'catalogue-flat__toc-thumbzoom catalogue-flat__toc-thumbzoom--visible';
    document.body.appendChild(zoom);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }));
    const stillVisible = zoom.classList.contains('catalogue-flat__toc-thumbzoom--visible');
    zoom.remove();
    return !stillVisible;
  });
  expect(dismissed).toBe(true);
});

test('/test2 production overlay controls do not overlap MapLibre controls', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.map);
  await page.waitForSelector('#activeLayersToggle');
  await page.waitForSelector('.test2-main-zoom-control');
  await page.waitForSelector('.leaflet-control-compass');
  await page.waitForSelector('#mapControlsToggle');
  await page.waitForSelector('.test2-main-zoom-control');

  const layout = await page.evaluate(() => {
    const active = document.getElementById('activeLayersToggle')?.getBoundingClientRect();
    const zoom = document.querySelector('.test2-main-zoom-control')?.getBoundingClientRect();
    const compass = document.querySelector('.leaflet-control-compass')?.getBoundingClientRect();
    const settings = document.getElementById('mapControlsToggle')?.getBoundingClientRect();
    const nativeMapLibreControls = [...document.querySelectorAll('.maplibregl-ctrl-group, .maplibregl-ctrl-scale')]
      .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).length;
    const overlaps = (a, b) => Boolean(a && b
      && a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top);
    const rect = (value) => value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom } : null;
    return {
      activeZoomOverlaps: overlaps(active, zoom),
      visibleNativeMapLibreControls: nativeMapLibreControls,
      active: rect(active),
      zoom: rect(zoom),
      compass: rect(compass),
      settings: rect(settings),
      scale: null
    };
  });

  expect(layout.active).not.toBeNull();
  expect(layout.zoom).not.toBeNull();
  expect(layout.compass).not.toBeNull();
  expect(layout.settings).not.toBeNull();
  expect(layout.activeZoomOverlaps).toBe(false);
  expect(layout.visibleNativeMapLibreControls).toBe(0);
  expect(layout.zoom.left).toBeLessThan(layout.active.left);

  const resetBearing = await page.evaluate(async () => {
    const map = window.__civgraphTest2.mapController.map;
    map.jumpTo({ bearing: 35, pitch: 20 });
    document.querySelector('.leaflet-control-compass')?.click();
    await new Promise((resolve) => map.once('moveend', resolve));
    return {
      bearing: map.getBearing(),
      pitch: map.getPitch()
    };
  });
  expect(Math.abs(resetBearing.bearing)).toBeLessThan(0.5);
  expect(Math.abs(resetBearing.pitch)).toBeLessThan(0.5);
});

test('/test2 mobile map and catalogue controls do not collide', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.map);
  await page.waitForSelector('#mobileToggle');
  await page.waitForSelector('#activeLayersToggle');
  await page.waitForSelector('.test2-main-zoom-control');
  await page.waitForSelector('#mapControlsToggle');
  await page.waitForSelector('.test2-main-zoom-control');

  await page.evaluate(() => window.uiController?.setSplitState?.('map-full'));
  const mapLayout = await page.evaluate(() => {
    const rect = (el) => {
      const value = el?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom } : null;
    };
    const overlaps = (a, b) => Boolean(a && b
      && a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top);
    const active = rect(document.getElementById('activeLayersToggle'));
    const zoom = rect(document.querySelector('.test2-main-zoom-control'));
    const settings = rect(document.getElementById('mapControlsToggle'));
    const nativeMapLibreControls = [...document.querySelectorAll('.maplibregl-ctrl-group, .maplibregl-ctrl-scale')]
      .filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).length;
    return {
      active,
      zoom,
      settings,
      visibleNativeMapLibreControls: nativeMapLibreControls,
      activeZoomOverlaps: overlaps(active, zoom),
      settingsScaleOverlaps: false
    };
  });
  expect(mapLayout.activeZoomOverlaps).toBe(false);
  expect(mapLayout.settingsScaleOverlaps).toBe(false);
  expect(mapLayout.visibleNativeMapLibreControls).toBe(0);

  await page.evaluate(() => window.uiController?.setSplitState?.('info-full'));
  const catalogueLayout = await page.evaluate(() => {
    const rect = (el) => {
      const value = el?.getBoundingClientRect();
      return value ? { left: value.left, right: value.right, top: value.top, bottom: value.bottom } : null;
    };
    const overlaps = (a, b) => Boolean(a && b
      && a.left < b.right
      && a.right > b.left
      && a.top < b.bottom
      && a.bottom > b.top);
    const toggle = rect(document.getElementById('mobileToggle'));
    const header = rect(document.querySelector('.app-header'));
    const history = rect(document.getElementById('catalogueHistory'));
    const home = rect(document.getElementById('catalogueHome'));
    const toggleParent = document.getElementById('mobileToggle')?.parentElement?.className || '';
    return {
      toggle,
      header,
      history,
      home,
      toggleParent,
      toggleInsideHeader: Boolean(toggle && header
        && toggle.top >= header.top
        && toggle.bottom <= header.bottom
        && toggle.left >= header.left
        && toggle.right <= header.right),
      toggleHistoryOverlaps: overlaps(toggle, history),
      toggleHomeOverlaps: overlaps(toggle, home)
    };
  });
  expect(catalogueLayout.toggleParent).toContain('app-header');
  expect(catalogueLayout.toggleInsideHeader).toBe(true);
  expect(catalogueLayout.toggleHistoryOverlaps).toBe(false);
  expect(catalogueLayout.toggleHomeOverlaps).toBe(false);
});

test('/test2 mobile catalogue stays bounded and map gestures stay enabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.map);

  await page.evaluate(() => window.uiController?.setSplitState?.('info-full'));
  await page.waitForFunction(() => document.querySelector('#catalogueFlatView')?.dataset.rendered === 'true');

  const state = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const electionCards = document.querySelectorAll('#catalogueFlatView .c1-card[data-c1-id^="flat-elections"]').length;
    const mapCards = [...document.querySelectorAll('#catalogueFlatView .c1-card[data-c1-id]')]
      .filter((card) => !(card.dataset.c1Id || '').startsWith('flat-elections')).length;
    return {
      electionCards,
      mapCards,
      electionRows: document.querySelectorAll('#catalogueFlatView .flat-election-entry').length,
      showMore: Boolean(document.querySelector('#catalogueFlatView [data-mobile-catalogue-full]')),
      showAllMaps: window.uiController.showAllMaps,
      mapLimit: window.uiController._mobileInitialMapCardLimit,
      electionLimit: window.uiController._mobileInitialElectionCardLimit,
      dragPanEnabled: typeof map.dragPan?.isEnabled === 'function' ? map.dragPan.isEnabled() : true,
      dragRotateEnabled: typeof map.dragRotate?.isEnabled === 'function' ? map.dragRotate.isEnabled() : true,
      touchZoomEnabled: typeof map.touchZoomRotate?.isEnabled === 'function' ? map.touchZoomRotate.isEnabled() : true,
      touchPitchEnabled: typeof map.touchPitch?.isEnabled === 'function' ? map.touchPitch.isEnabled() : true,
      doubleClickZoomDisabled: typeof map.doubleClickZoom?.isEnabled === 'function' ? !map.doubleClickZoom.isEnabled() : true,
      canvasTouchAction: getComputedStyle(map.getCanvas()).touchAction,
      canvasContainerTouchAction: getComputedStyle(map.getCanvasContainer()).touchAction,
      hasTouchZoomRotateClass: map.getCanvasContainer().classList.contains('maplibregl-touch-zoom-rotate'),
      hasTouchDragPanClass: map.getCanvasContainer().classList.contains('maplibregl-touch-drag-pan')
    };
  });

  expect(state.showAllMaps).toBe(false);
  expect(state.showMore).toBe(true);
  expect(state.mapCards).toBeLessThanOrEqual(state.mapLimit);
  expect(state.electionCards).toBeLessThanOrEqual(state.electionLimit);
  expect(state.electionRows).toBeLessThanOrEqual(80);
  expect(state.dragPanEnabled).toBe(true);
  expect(state.dragRotateEnabled).toBe(true);
  expect(state.touchZoomEnabled).toBe(true);
  expect(state.touchPitchEnabled).toBe(true);
  expect(state.doubleClickZoomDisabled).toBe(true);
  expect(state.canvasTouchAction).toBe('none');
  expect(state.canvasContainerTouchAction).toBe('none');
  expect(state.hasTouchZoomRotateClass).toBe(true);
  expect(state.hasTouchDragPanClass).toBe(true);
});

test('/test2 mobile election seat-circle overlays do not block map gestures', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);

  const overlayState = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const mapElement = document.getElementById('map');
    const probe = document.createElement('div');
    probe.className = 'test2-election-seat-circle';
    mapElement.appendChild(probe);
    const ordinaryPointerEvents = getComputedStyle(probe).pointerEvents;
    probe.remove();
    const labelProbe = document.createElement('span');
    labelProbe.className = 'maplibre-dom-label';
    mapElement.appendChild(labelProbe);
    const labelPointerEvents = getComputedStyle(labelProbe).pointerEvents;
    labelProbe.remove();
    return {
      ordinaryPointerEvents,
      labelPointerEvents,
      canvasTouchAction: getComputedStyle(map.getCanvas()).touchAction,
      canvasContainerTouchAction: getComputedStyle(map.getCanvasContainer()).touchAction,
      dragPanEnabled: typeof map.dragPan?.isEnabled === 'function' ? map.dragPan.isEnabled() : true,
      dragRotateEnabled: typeof map.dragRotate?.isEnabled === 'function' ? map.dragRotate.isEnabled() : true,
      touchZoomEnabled: typeof map.touchZoomRotate?.isEnabled === 'function' ? map.touchZoomRotate.isEnabled() : true,
      touchPitchEnabled: typeof map.touchPitch?.isEnabled === 'function' ? map.touchPitch.isEnabled() : true
    };
  });

  expect(overlayState.ordinaryPointerEvents).toBe('none');
  expect(overlayState.labelPointerEvents).toBe('none');
  expect(overlayState.canvasTouchAction).toBe('none');
  expect(overlayState.canvasContainerTouchAction).toBe('none');
  expect(overlayState.dragPanEnabled).toBe(true);
  expect(overlayState.dragRotateEnabled).toBe(true);
  expect(overlayState.touchZoomEnabled).toBe(true);
  expect(overlayState.touchPitchEnabled).toBe(true);
});

test('/test2 loads a converted layer through the main catalogue map callback', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await loadCivilParishes(page);
  const result = await page.evaluate(async () => {
    const renderedLayers = [
      'civil-parishes-vector-test-fill',
      'civil-parishes-vector-test-line',
      'civil-parishes-vector-test-label'
    ].filter((id) => window.__civgraphTest2.mapController.map.getLayer(id));
    return {
      loaded: window.__civgraphTest2.app.mapController.isLayerLoaded('civil-parishes-by-province'),
      visible: window.__civgraphTest2.app.mapController.isLayerVisible('civil-parishes-by-province'),
      features: window.__civgraphTest2.mapController.map.queryRenderedFeatures({ layers: renderedLayers }).length,
      canvasWidth: window.__civgraphTest2.mapController.map.getCanvas().width
    };
  });
  expect(result.loaded).toBe(true);
  expect(result.visible).toBe(true);
  expect(result.features).toBeGreaterThan(0);
  expect(result.canvasWidth).toBeGreaterThan(100);
  expect(new URL(page.url()).pathname).toBe('/test2/');
});

test('/test2 Settlements 2015 has labels, hover state, and feature details', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    await app.loadMap('settlements-2015');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
  });

  const state = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const layer = window.__civgraphTest2.metadataService.getLayer('settlements-2015-vector-test');
    const features = map.queryRenderedFeatures({
      layers: ['settlements-2015-vector-test-fill'].filter((id) => map.getLayer(id))
    });
    return {
      promoteId: layer.promoteId,
      idProperty: layer.idProperty,
      labelProperty: layer.labelProperty,
      featureCount: features.length,
      featureIds: features.slice(0, 8).map((feature) => feature.id ?? feature.properties?.[layer.promoteId]),
      labelCount: document.querySelectorAll('.maplibre-dom-label[data-layer-id="settlements-2015-vector-test"]:not([hidden])').length
    };
  });
  expect(state.promoteId).toBe('Code');
  expect(state.idProperty).toBe('Code');
  expect(state.labelProperty).toBe('Name');
  expect(state.featureCount).toBeGreaterThan(0);
  expect(state.featureIds.every((id) => id !== undefined && id !== null && id !== '')).toBe(true);
  expect(state.labelCount).toBeGreaterThan(0);

  const firstLabel = page.locator('.maplibre-dom-label[data-layer-id="settlements-2015-vector-test"]:not([hidden])').first();
  await expect(firstLabel).toBeVisible();
  await firstLabel.hover();
  await expect(firstLabel).toHaveClass(/map-label--hover/);
  await firstLabel.click();
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).toContainText(/Settlements 2015|Name|Code/i);
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
});

test('/test2 duplicate promoted IDs do not cross-highlight distant DEAs', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const state = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const adapter = window.__civgraphTest2.mapController;
    const layer = window.__civgraphTest2.metadataService.getLayer('deas-1972-vector-test');
    if (layer?.tilesFallback) {
      layer.sourceType = 'mvt';
      layer.tiles = layer.tilesFallback;
    }
    await app.loadMap('deas-1972');
    const map = adapter.map;
    await new Promise((resolve) => map.once('idle', resolve));
    const renderer = adapter.renderer;
    const record = renderer.layers.get('deas-1972-vector-test');
    const queryLayers = ['deas-1972-vector-test-fill', 'deas-1972-vector-test-line'].filter((id) => map.getLayer(id));
    const features = map.queryRenderedFeatures({ layers: queryLayers });
    const featureName = (feature) => String(feature?.properties?.NAME || feature?.properties?.label_name || '').toUpperCase();
    const down = features.find((feature) => featureName(feature) === 'DOWN AREA C');
    const belfast = features.find((feature) => featureName(feature) === 'BELFAST AREA H');
    const downIdentity = down ? renderer.readFeatureIdentity(record.config, down) : null;
    const belfastIdentity = belfast ? renderer.readFeatureIdentity(record.config, belfast) : null;
    if (down) renderer.setHover(record.config, down);
    const rawState = map.getFeatureState({
      source: record.sourceId,
      sourceLayer: record.config.sourceLayer,
      id: 28
    });
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 250);
      map.once('idle', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const overlayLayers = ['deas-1972-vector-test-fallback-hover-fill']
      .filter((id) => map.getLayer(id));
    return {
      duplicateIdDetected: record.duplicateFeatureIds?.has('28') || false,
      foundDown: Boolean(down),
      foundBelfast: Boolean(belfast),
      downId: downIdentity?.id || null,
      belfastId: belfastIdentity?.id || null,
      downGenerated: downIdentity?.generated || false,
      belfastGenerated: belfastIdentity?.generated || false,
      activeHoverId: renderer.hovered?.id || null,
      activeHoverGenerated: renderer.hovered?.generated || false,
      rawFeatureStateHover: rawState?.hover === true,
      hoverOverlayCount: overlayLayers.length ? map.queryRenderedFeatures({ layers: overlayLayers }).length : 0
    };
  });

  expect(state.duplicateIdDetected).toBe(true);
  expect(state.foundDown).toBe(true);
  expect(state.foundBelfast).toBe(true);
  expect(state.downGenerated).toBe(true);
  expect(state.belfastGenerated).toBe(true);
  expect(state.downId).not.toBe(state.belfastId);
  expect(state.activeHoverId).toBe(state.downId);
  expect(state.activeHoverGenerated).toBe(true);
  expect(state.rawFeatureStateHover).toBe(false);
  expect(state.hoverOverlayCount).toBeGreaterThan(0);
});

test('/test2 no-id vector layers still support labels, hover, and feature details', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    await app.loadMap('place-names-gazetteer');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
  });
  await page.waitForFunction(() =>
    document.querySelectorAll('.maplibre-dom-label[data-layer-id="place-names-gazetteer-vector-test"]:not([hidden])').length > 0
  );

  const state = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const layer = window.__civgraphTest2.metadataService.getLayer('place-names-gazetteer-vector-test');
    const queryLayers = ['place-names-gazetteer-vector-test-line'].filter((id) => map.getLayer(id));
    const features = map.queryRenderedFeatures({ layers: queryLayers });
    return {
      promoteId: layer.promoteId || '',
      idProperty: layer.idProperty || '',
      featureCount: features.length,
      nativeIds: features.slice(0, 8).map((feature) => feature.id ?? feature.properties?.id).filter(Boolean).length,
      labelCount: document.querySelectorAll('.maplibre-dom-label[data-layer-id="place-names-gazetteer-vector-test"]:not([hidden])').length
    };
  });
  expect(state.promoteId).toBe('');
  expect(state.idProperty).toBe('');
  expect(state.featureCount).toBeGreaterThan(0);
  expect(state.nativeIds).toBe(0);
  expect(state.labelCount).toBeGreaterThan(0);

  const firstLabel = page.locator('.maplibre-dom-label[data-layer-id="place-names-gazetteer-vector-test"]:not([hidden])').first();
  await expect(firstLabel).toBeVisible();
  await firstLabel.hover();
  await expect(firstLabel).toHaveClass(/map-label--hover/);
  const hoverOverlay = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    return map.queryRenderedFeatures({ layers: ['place-names-gazetteer-vector-test-fallback-hover'] }).length;
  });
  expect(hoverOverlay).toBeGreaterThan(0);
  await firstLabel.click();
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).toContainText(/Place Names Gazetteer|Name/i);
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
});

test('/test2 loads generated election entries with MapLibre styling and enriched feature details', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.elections?.catalogue?.elections?.length);

  const loaded = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const entry = app.elections.catalogue.elections.find((item) =>
      item.body === 'House of Commons of the United Kingdom'
      && item.date === '2024-07-04'
      && item.loadable
    );
    if (!entry) return null;
    const loadPromise = app.elections.loadElection(entry.body, entry.date);
    const loadingText = document.getElementById('electionResultsPane')?.textContent || '';
    await loadPromise;
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
    const map = window.__civgraphTest2.mapController.map;
    map.jumpTo({ zoom: 8.4 });
    await new Promise((resolve) => map.once('idle', resolve));
    const state = app.mapController.getLayerState(entry.sourceMapId);
    if (state?.testLayerId) app.mapController.renderer?.refreshDomLabels?.(state.testLayerId);
    await app.elections.waitForSeatCircleOverlay();
    const seatState = app.elections.getSeatCircleOverlayState();
    const seatGroups = [...document.querySelectorAll('.test2-election-seat-circle')];
    const firstSeatGroup = seatGroups[0]?.getBoundingClientRect();
    const firstSeatDot = seatGroups[0]?.querySelector('.seat-dot');
    const firstSeatDotStyle = firstSeatDot ? getComputedStyle(firstSeatDot) : null;
    const expectedSeatCount = app.elections.activeBundle.results
      .reduce((sum, result) => sum + app.elections.seatCandidatesForResult(result).length, 0);
    return {
      key: entry.key,
      sourceMapId: entry.sourceMapId,
      matchedCount: entry.matchedCount,
      layerLoaded: app.mapController.isLayerLoaded(entry.sourceMapId),
      loadingText,
      panelVisible: document.getElementById('electionResultsPane')?.classList.contains('election-results-pane--open'),
      timelineVisible: !document.getElementById('timelineSlider')?.classList.contains('hidden'),
      timelineLabel: document.getElementById('timelineLabel')?.textContent || '',
      fillColour: map.getPaintProperty('pc-2023-vector-test-fill', 'fill-color'),
      fillOpacity: map.getPaintProperty('pc-2023-vector-test-fill', 'fill-opacity'),
      lineColour: map.getPaintProperty('pc-2023-vector-test-line', 'line-color'),
      lineOpacity: map.getPaintProperty('pc-2023-vector-test-line', 'line-opacity'),
      lineWidth: map.getPaintProperty('pc-2023-vector-test-line', 'line-width'),
      seatHaloLayer: Boolean(map.getLayer('test2-election-seat-halo-layer')),
      seatCircleLayer: Boolean(map.getLayer('test2-election-seat-layer')),
      seatOverlay: Boolean(document.getElementById('test2-election-seat-overlay')),
      seatGroupCount: seatGroups.length,
      seatDotCount: seatState.dotCount,
      seatFirstGroup: firstSeatGroup ? { width: firstSeatGroup.width, height: firstSeatGroup.height } : null,
      seatDotBorder: firstSeatDotStyle?.borderColor || '',
      seatDotShadow: firstSeatDotStyle?.boxShadow || '',
      urlLayers: new URL(location.href).hash,
      expectedSeatCount,
      labels: document.querySelectorAll('.maplibre-dom-label:not([hidden])').length,
      mainParityRenderer: Boolean(document.querySelector('[data-election-renderer="test2-main-pane-contract"]')),
      groupedPartyTable: Boolean(document.querySelector('[data-election-renderer="test2-main-pane-contract"] .election-party-table--grouped')),
      paneTitle: document.getElementById('electionPaneTitle')?.textContent || '',
      headerTabs: [...document.querySelectorAll('#electionPaneHeaderRight .election-view-tab')].map((button) => button.textContent.trim()),
      headerHasStyleControl: Boolean(document.querySelector('#electionPaneHeaderRight #test2ElectionMode')),
      mapDisplayControl: Boolean(document.querySelector('.test2-election-map-display #test2ElectionMode'))
    };
  });

  expect(loaded).toBeTruthy();
  expect(loaded.sourceMapId).toBe('pc-2023');
  expect(loaded.loadingText).toContain('Loading election results');
  expect(loaded.matchedCount).toBe(18);
  expect(loaded.layerLoaded).toBe(true);
  expect(loaded.panelVisible).toBe(true);
  expect(loaded.timelineVisible).toBe(true);
  expect(loaded.timelineLabel).toBe('04 Jul 2024');
  expect(JSON.stringify(loaded.fillColour)).toContain('match');
  expect(JSON.stringify(loaded.fillColour)).toContain('#dfe4ec');
  expect(JSON.stringify(loaded.fillOpacity)).toContain('0.6');
  expect(JSON.stringify(loaded.fillOpacity)).toContain('0.42');
  expect(JSON.stringify(loaded.lineColour)).toContain('#333');
  expect(JSON.stringify(loaded.lineColour)).toContain('#a1aab8');
  expect(loaded.lineOpacity).toBe(0.8);
  expect(loaded.lineWidth).toBe(1.5);
  expect(loaded.seatHaloLayer).toBe(false);
  expect(loaded.seatCircleLayer).toBe(false);
  expect(loaded.seatOverlay).toBe(true);
  expect(loaded.seatGroupCount).toBeGreaterThan(0);
  expect(loaded.seatDotCount).toBeGreaterThan(0);
  expect(loaded.seatDotCount).toBeLessThanOrEqual(loaded.expectedSeatCount);
  expect(loaded.seatFirstGroup.width).toBeGreaterThanOrEqual(12);
  expect(loaded.seatFirstGroup.height).toBeGreaterThanOrEqual(12);
  expect(loaded.seatDotBorder).toMatch(/0, 0, 0|black|rgb\(0 0 0/i);
  expect(loaded.seatDotShadow).toMatch(/0, 0, 0|black|rgb\(0 0 0/i);
  expect(loaded.seatDotShadow).toMatch(/255, 255, 255|white|rgb\(255 255 255/i);
  expect(loaded.urlLayers).toContain('layers=election-house-of-commons-of-the-united-kingdom-2024-07-04');
  expect(loaded.urlLayers).not.toContain('layers=pc-2023');
  expect(loaded.labels).toBe(0);
  expect(loaded.mainParityRenderer).toBe(true);
  expect(loaded.groupedPartyTable).toBe(true);
  expect(loaded.paneTitle).toContain('Westminster');
  expect(loaded.headerTabs).toEqual(['By Party', 'By Candidate', 'By Local Party']);
  expect(loaded.headerHasStyleControl).toBe(false);
  expect(loaded.mapDisplayControl).toBe(true);

  await expect(page.locator('#electionResultsPane')).toContainText('Westminster');
  await expect(page.locator('#electionResultsPane')).toContainText('1st preferences');
  await page.locator('#electionPaneHeaderRight [data-election-view="candidate"]').click();
  await expect(page.locator('#electionPaneContent')).toContainText('Constituency');
  await expect(page.locator('#electionPaneContent .election-count-table--candidate-sticky3')).toHaveCount(1);
  await page.locator('#electionPaneHeaderRight [data-election-view="party"]').click();
  await page.locator('.test2-election-map-display summary').click();
  await page.locator('#test2ElectionMode').selectOption('voteShare');
  await expect(page.locator('#electionResultsPane')).toContainText('Vote share');
  await page.locator('#test2ElectionOverlay').selectOption('bars');
  await page.waitForFunction(() => window.__civgraphTest2.mapController.map.getLayer('test2-election-vote-bar-layer'));
  const barOverlay = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const source = map.getSource('test2-election-vote-bar-source');
    return {
      hasBars: Boolean(map.getLayer('test2-election-vote-bar-layer')),
      hasSeatCircles: Boolean(document.querySelector('.test2-election-seat-circle')),
      barCount: source?._data?.features?.length || map.queryRenderedFeatures({ layers: ['test2-election-vote-bar-layer'] }).length
    };
  });
  expect(barOverlay.hasBars).toBe(true);
  expect(barOverlay.hasSeatCircles).toBe(false);
  expect(barOverlay.barCount).toBeGreaterThan(0);
  await page.locator('#test2ElectionOverlay').selectOption('circles');
  await page.evaluate(() => window.uiController?.setSplitState?.('map-full'));
  await page.waitForTimeout(100);

  await expect(page.locator('.maplibre-dom-label:not([hidden])')).toHaveCount(0);
  const selectedGeometry = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    const mapController = window.__civgraphTest2.mapController;
    const state = app.mapController.getLayerState('pc-2023');
    const testLayerId = state?.testLayerId || 'pc-2023-vector-test';
    const record = mapController.renderer?.layers.get(testLayerId);
    const layerIds = [`${testLayerId}-fill`, `${testLayerId}-line`].filter((id) => mapController.map.getLayer(id));
    const feature = mapController.map.queryRenderedFeatures({ layers: layerIds })
      .find((candidate) => candidate?.properties);
    if (!record || !feature) return null;
    mapController.renderer.selectFeature(record.config, feature);
    return feature.properties?.name || feature.properties?.Name || feature.id || true;
  });
  expect(selectedGeometry).toBeTruthy();
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).toContainText('Election');
  await expect(page.locator('#featureInfoContent')).toContainText(/Leading party|Winning party/);
  await expect(page.locator('#electionResultsPane')).toContainText(/Candidate|Party|Votes/);
  await expect(page.locator('#electionPaneContent .election-results-table--constituency-party')).toHaveCount(1);
});

test('/test2 active-layers remove unloads election seat-circle markers', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelectorAll('.test2-election-seat-circle').length > 0);

  const before = await page.evaluate(() => ({
    activeBody: window.__civgraphTest2.app.elections.activeEntry?.body || '',
    sourceMapId: window.__civgraphTest2.app.elections.activeEntry?.sourceMapId || '',
    backingLoaded: window.__civgraphTest2.app.mapController.isLayerLoaded('dail-2023'),
    markerCount: window.__civgraphTest2.app.elections.seatCircleMarkers?.length || 0,
    seatDomCount: document.querySelectorAll('.test2-election-seat-circle').length
  }));
  expect(before.activeBody).toBe('Dáil Éireann');
  expect(before.sourceMapId).toBe('dail-2023');
  expect(before.backingLoaded).toBe(true);
  expect(before.markerCount).toBeGreaterThan(0);
  expect(before.seatDomCount).toBeGreaterThan(0);

  await page.evaluate(() => {
    window.__civgraphTest2.app.setActiveLayersPanelOpen(true);
    document.querySelector('#activeLayersList .active-layer-item[data-map-id="dail-2023"] .remove-btn')?.click();
  });
  await expect(page.locator('.test2-election-seat-circle')).toHaveCount(0);
  await expect(page.locator('#test2-election-seat-overlay')).toHaveCount(0);

  const after = await page.evaluate(() => ({
    activeEntry: window.__civgraphTest2.app.elections.activeEntry,
    activeBundle: window.__civgraphTest2.app.elections.activeBundle,
    backingLoaded: window.__civgraphTest2.app.mapController.isLayerLoaded('dail-2023'),
    activeLayerIds: [...window.__civgraphTest2.app.mapController.layerStates.keys()],
    markerCount: window.__civgraphTest2.app.elections.seatCircleMarkers?.length || 0,
    hash: location.hash
  }));
  expect(after.activeEntry).toBeNull();
  expect(after.activeBundle).toBeNull();
  expect(after.backingLoaded).toBe(false);
  expect(after.activeLayerIds).not.toContain('dail-2023');
  expect(after.markerCount).toBe(0);
  expect(after.hash).not.toContain('election-dil-ireann-2024-11-29');
  expect(after.hash).not.toContain('electionBody=');
});

test('/test2 direct election unload removes the backing feature layer', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => window.__civgraphTest2.app.mapController.isLayerLoaded('dail-2023'));

  const state = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    const beforeLoaded = app.mapController.isLayerLoaded('dail-2023');
    app.elections.unloadElection();
    return {
      beforeLoaded,
      activeEntry: app.elections.activeEntry,
      activeBundle: app.elections.activeBundle,
      backingLoaded: app.mapController.isLayerLoaded('dail-2023'),
      activeLayerIds: [...app.mapController.layerStates.keys()],
      markerCount: app.elections.seatCircleMarkers?.length || 0,
      hash: location.hash
    };
  });

  expect(state.beforeLoaded).toBe(true);
  expect(state.activeEntry).toBeNull();
  expect(state.activeBundle).toBeNull();
  expect(state.backingLoaded).toBe(false);
  expect(state.activeLayerIds).not.toContain('dail-2023');
  expect(state.markerCount).toBe(0);
  expect(state.hash).not.toContain('election-dil-ireann-2024-11-29');
});

test('/test2 ROI elections use ROI-wide aggregate percent labels', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelector('#electionPaneContent .election-party-table'));

  const labels = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    app.elections.renderPanel(null, 'candidate');
    const candidateHeader = [...document.querySelectorAll('#electionPaneContent th')]
      .map((cell) => cell.textContent.trim().replace(/\s+/g, ' '))
      .find((text) => text.includes('% of')) || '';
    const party = app.elections.activeBundle.entityIndex?.parties?.[0];
    if (party) app.elections.renderEntityPanel('party', party.name);
    return {
      candidateHeader,
      entityLabels: [...document.querySelectorAll('#electionPaneContent .election-entity-metric__label')]
        .map((label) => label.textContent.trim().replace(/\s+/g, ' ')),
      entityText: document.getElementById('electionPaneContent')?.textContent || ''
    };
  });

  expect(labels.candidateHeader).toBe('% of ROI');
  expect(labels.entityLabels).toContain('% of ROI');
  expect(labels.entityText).not.toContain('% of NI');
});

test('/test2 DOM seat circles keep main-style fixed dots while zooming', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelector('.test2-election-seat-circle .seat-dot'));

  const samples = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const map = app.mapController.map;
    const zooms = [5.5, 6.5, 7, 8.4, 9.5];
    const results = [];
    for (const zoom of zooms) {
      map.jumpTo({ zoom });
      await new Promise((resolve) => map.once('idle', resolve));
      await app.elections.renderElectionOverlay();
      await app.elections.waitForSeatCircleOverlay();
      const state = app.elections.getSeatCircleOverlayState();
      const firstGroup = document.querySelector('.test2-election-seat-circle');
      const firstDot = firstGroup?.querySelector('.seat-dot');
      const groupRect = firstGroup?.getBoundingClientRect();
      const dotRect = firstDot?.getBoundingClientRect();
      const dotStyle = firstDot ? getComputedStyle(firstDot) : null;
      results.push({
        zoom,
        groupCount: state.groups.length,
        dotCount: state.dotCount,
        firstGroupWidth: groupRect?.width || 0,
        firstGroupHeight: groupRect?.height || 0,
        firstDotWidth: dotRect?.width || 0,
        firstDotHeight: dotRect?.height || 0,
        firstDotBorder: dotStyle?.borderColor || '',
        firstDotShadow: dotStyle?.boxShadow || ''
      });
    }
    return results;
  });

  expect(samples).toHaveLength(5);
  for (const sample of samples) {
    expect(sample.groupCount, `seat groups at zoom ${sample.zoom}`).toBeGreaterThan(0);
    expect(sample.dotCount, `seat dots at zoom ${sample.zoom}`).toBeGreaterThan(0);
    expect(sample.firstGroupWidth).toBeGreaterThanOrEqual(12);
    expect(sample.firstGroupHeight).toBeGreaterThanOrEqual(12);
    expect(sample.firstDotWidth).toBeCloseTo(12, 0);
    expect(sample.firstDotHeight).toBeCloseTo(12, 0);
    expect(sample.firstDotBorder).toMatch(/0, 0, 0|black|rgb\(0 0 0/i);
    expect(sample.firstDotShadow).toMatch(/255, 255, 255|white|rgb\(255 255 255/i);
  }
});

test('/test2 DOM seat circles stay anchored while panning', async ({ page }) => {
  await page.goto('/test2/#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForFunction(() => document.querySelector('.test2-election-seat-circle[data-lng][data-lat]'));

  const samples = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const map = app.mapController.map;
    const sample = () => {
      const group = document.querySelector('.test2-election-seat-circle[data-lng][data-lat]');
      const mapRect = map.getContainer().getBoundingClientRect();
      const groupRect = group.getBoundingClientRect();
      const lng = Number(group.dataset.lng);
      const lat = Number(group.dataset.lat);
      const projected = map.project([lng, lat]);
      const groupCenter = {
        x: groupRect.left - mapRect.left + groupRect.width / 2,
        y: groupRect.top - mapRect.top + groupRect.height / 2
      };
      return {
        groupCenter,
        projected: { x: projected.x, y: projected.y },
        dx: Math.abs(groupCenter.x - projected.x),
        dy: Math.abs(groupCenter.y - projected.y)
      };
    };

    const before = sample();
    map.panBy([140, 0], { duration: 400, essential: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const during = sample();
    if (map.isMoving()) {
      await new Promise((resolve) => map.once('moveend', resolve));
    }
    app.elections.updateSeatCircleOverlayPositions();
    const after = sample();
    return { before, during, after };
  });

  for (const key of ['before', 'during', 'after']) {
    expect(samples[key].dx, `${key} seat-circle x anchor drift`).toBeLessThan(3);
    expect(samples[key].dy, `${key} seat-circle y anchor drift`).toBeLessThan(3);
  }
  expect(Math.abs(samples.during.groupCenter.x - samples.before.groupCenter.x)).toBeGreaterThan(5);
});

test('/test2 election bundles cover representative main-site election types', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.elections?.catalogue?.elections?.length);

  const coverage = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const examples = [
      { key: 'dail', find: (entry) => entry.body === 'Dáil Éireann' && entry.loadable },
      { key: 'westminster', find: (entry) => entry.body === 'House of Commons of the United Kingdom' && entry.date === '2024-07-04' },
      { key: 'assembly', find: (entry) => entry.body === 'Northern Ireland Assembly' && entry.loadable },
      { key: 'forum1996', find: (entry) => entry.body === 'Northern Ireland Forum for Political Dialogue' && entry.date === '1996-05-30' },
      { key: 'deas1972', find: (entry) => entry.body === 'Local Government Districts' && entry.date === '1973-05-30' },
      { key: 'localGovernment', find: (entry) => entry.bodyGroup === 'local-government' && entry.loadable },
      { key: 'referendum', find: (entry) => entry.body === 'Referendum (Ireland)' && entry.loadable },
      { key: 'recallOrPlaceholder', find: (entry) => /recall/i.test(entry.body) || /recall/i.test(entry.key) || entry.placeholder }
    ];
    const output = {};
    for (const example of examples) {
      const entry = app.elections.catalogue.elections.find(example.find);
      if (!entry) {
        output[example.key] = null;
        continue;
      }
      const bundle = entry.loadable ? await app.elections.loadBundle(entry) : null;
      output[example.key] = {
        body: entry.body,
        date: entry.date,
        loadable: entry.loadable,
        placeholder: entry.placeholder,
        anchorUrl: entry.anchorUrl,
        previousKey: entry.previousKey,
        matchedCount: entry.matchedCount,
        totalConstituencies: entry.totalConstituencies,
        localBodies: entry.localBodies?.length || 0,
        displayTitle: entry.displayTitle || '',
        resultCount: bundle?.results?.length || 0,
        syntheticRegions: bundle?.results?.filter((result) => result.syntheticRegion).length || 0,
        boundedAnchors: bundle?.results?.filter((result) => result.anchor?.bounds).length || 0,
        partySummary: bundle?.partySummary?.length || 0,
        entityParties: bundle?.entityIndex?.parties?.length || 0,
        hasCounts: Boolean(bundle?.results?.some((result) => result.hasCountDetail || result.countGroup?.length || result.candidates?.some((candidate) => candidate.counts?.length)))
      };
    }
    return output;
  });

  for (const key of ['dail', 'westminster', 'assembly', 'forum1996', 'deas1972', 'localGovernment', 'referendum']) {
    expect(coverage[key], `${key} example should exist`).toBeTruthy();
    expect(coverage[key].loadable, `${key} example should be loadable`).toBe(true);
    expect(coverage[key].resultCount, `${key} should carry result rows`).toBeGreaterThan(0);
    expect(coverage[key].partySummary, `${key} should carry party summary rows`).toBeGreaterThan(0);
  }
  expect(coverage.westminster.anchorUrl).toMatch(/election-anchors-test2/);
  expect(coverage.westminster.previousKey).toBeTruthy();
  expect(coverage.westminster.boundedAnchors).toBeGreaterThan(0);
  expect(coverage.forum1996.matchedCount).toBe(coverage.forum1996.totalConstituencies);
  expect(coverage.forum1996.syntheticRegions).toBe(1);
  expect(coverage.deas1972.localBodies).toBeGreaterThan(1);
  expect(coverage.deas1972.displayTitle).toContain('Northern Ireland local election');
  expect(coverage.assembly.hasCounts).toBe(true);
  expect(coverage.recallOrPlaceholder).toBeTruthy();
});

test('/test2 election pane supports local-government aggregates and detailed counts', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.elections?.catalogue?.elections?.length);

  const state = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const localEntry = app.elections.catalogue.elections.find((entry) => entry.bodyGroup === 'local-government' && entry.loadable);
    await app.elections.loadElection(localEntry.body, localEntry.date);
    await app.elections.renderElectionOverlay();
    const deaSeatState = app.elections.getSeatCircleOverlayState();
    const deaSeatCount = deaSeatState.dotCount;
    app.elections.renderPanel(null, 'local-party');
    const localText = document.getElementById('electionResultsPane')?.textContent || '';
    const localPartyTable = Boolean(document.querySelector('#electionPaneContent .election-party-table--district-local-party-sticky4'));
    app.elections.activeLocalMode = 'district';
    app.elections.renderPanel(null, 'council');
    await app.elections.renderElectionOverlay();
    const aggregateSeatState = app.elections.getSeatCircleOverlayState();
    const aggregateTypes = [...new Set((aggregateSeatState.groups || []).map((group) => group.aggregateType).filter(Boolean))];
    const aggregateSeatCount = aggregateSeatState.dotCount;
    const councilText = document.getElementById('electionResultsPane')?.textContent || '';
    const firstParty = app.elections.activeBundle.entityIndex?.parties?.[0]?.name || null;
    if (firstParty) app.elections.renderEntityPanel('party', firstParty);
    app.updateURLState();
    const entityParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const assemblyEntry = app.elections.catalogue.elections.find((entry) => entry.body === 'Northern Ireland Assembly' && entry.loadable);
    await app.elections.loadElection(assemblyEntry.body, assemblyEntry.date);
    const countResult = app.elections.activeBundle.results.find((result) => result.hasCountDetail);
    app.elections.renderPanel(countResult, 'counts');
    const before = document.getElementById('electionResultsPane')?.textContent || '';
    const countTable = Boolean(document.querySelector('#electionPaneContent .election-count-table'));
    document.getElementById('test2ElectionCountDetail')?.click();
    const after = document.getElementById('electionResultsPane')?.textContent || '';
    const countWrapper = Boolean(document.querySelector('#electionPaneContent .election-count-wrapper--pane-sticky'));
    return {
      localBody: localEntry.body,
      localBodies: localEntry.localBodies?.length || 0,
      deaSeatCount,
      aggregateSeatCount,
      aggregateTypes,
      localText,
      localPartyTable,
      councilText,
      entityKind: entityParams.get('electionEntityKind'),
      entityKey: entityParams.get('electionEntityKey'),
      countResult: countResult?.constituency || null,
      countTable,
      countWrapper,
      before,
      after
    };
  });

  expect(state.localText).toContain('By Local Party');
  expect(state.localText).toMatch(/DEA|1st preferences|Candidates|Seats/);
  expect(state.localPartyTable).toBe(true);
  expect(state.localBody).toBe('Local Government Districts');
  expect(state.localBodies).toBeGreaterThan(1);
  expect(state.deaSeatCount).toBeGreaterThan(0);
  expect(state.aggregateSeatCount).toBeGreaterThan(0);
  expect(state.aggregateSeatCount).toBeLessThanOrEqual(state.deaSeatCount);
  expect(state.aggregateTypes).toContain('council');
  expect(state.councilText).toMatch(/By Council|Councils|Leading party/);
  expect(state.councilText).toMatch(/Seat change|Vote change|Turnout change/);
  expect(state.entityKind).toBe('party');
  expect(state.entityKey).toBeTruthy();
  expect(state.countResult).toBeTruthy();
  expect(state.countTable).toBe(true);
  expect(state.countWrapper).toBe(true);
  expect(state.before).toContain('Detailed View: Off');
  expect(state.after).toContain('Detailed View: On');
  expect(state.after).toMatch(/Valid votes|transfer|Count/i);
});

test('/test2 supports catalogue detail, unsupported notices, and URL restore', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.locator('#searchInput').fill('civil parishes');
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalogueFlatView')).toContainText('Civil Parishes');
  await page.evaluate(async () => window.__civgraphTest2.app.loadMap('civil-parishes-by-province'));
  await expect(page).toHaveURL(/layers=civil-parishes-by-province/);
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await page.reload();
  await page.waitForFunction(() => window.__civgraphTest2?.mapController?.isLayerLoaded('civil-parishes-by-province'));
  await expect(page.locator('#catalogueFlatView')).toContainText('Civil Parishes');

  const message = await page.evaluate(async () => {
    const layer = window.__civgraphTest2.metadataService.layers.find((item) => item.loadable === false && item.sourceMapId);
    try {
      await window.__civgraphTest2.app.loadMap(layer.sourceMapId);
      return '';
    } catch (error) {
      window.__civgraphTest2.app.showMapError(error);
      return error.message;
    }
  });
  expect(message).toMatch(/not converted|not yet converted/i);
  await expect(page.locator('#test2Status')).toContainText(/converted/i);
});

test('/test2 restores and persists detail, source, hidden layer, and panel URL state', async ({ page }) => {
  const hash = [
    'layers=civil-parishes-by-province',
    'hidden=civil-parishes-by-province',
    'q=civil%20parishes',
    'detail=civil-parishes-by-province',
    'source=civil-parishes-by-province',
    'activePanel=1',
    'controls=1',
    'base=cartodb-positron',
    'lng=-7.20',
    'lat=53.35',
    'zoom=6.25'
  ].join('&');
  await page.goto(`/test2/#${hash}`);
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise);
  await page.evaluate(() => window.__civgraphTest2.restorePromise);

  await expect(page.locator('#searchInput')).toHaveValue('civil parishes');
  await expect(page.locator('#catalogueDetailView')).toBeVisible();
  await expect(page.locator('#catalogueDetailView')).toContainText('Civil Parishes');
  await expect(page.locator('#test2SourcePanel')).toBeVisible();
  await expect(page.locator('#test2SourcePanel')).toContainText('Civil Parishes');
  await expect(page.locator('#test2SourcePanel')).toContainText(/References|Downloads|Tiles/);
  await expect(page.locator('#test2SourcePanel')).toHaveCSS('position', 'fixed');
  await expect.poll(() => page.locator('#test2SourcePanel').evaluate((panel) => Number(getComputedStyle(panel).zIndex))).toBeGreaterThan(500);
  await expect(page.locator('#activeLayers')).toBeVisible();
  await expect(page.locator('#activeLayersList')).toContainText('Civil Parishes');
  await expect(page.locator('#activeLayersList .test2-source-btn').first()).toBeVisible();
  await expect(page.locator('#mapControlPanel')).toHaveClass(/map-control-panel--expanded/);
  await expect(page.locator('#baseMapSelect')).toHaveValue('cartodb-positron');

  const restored = await page.evaluate(() => {
    const app = window.__civgraphTest2.app;
    const center = app.mapController.map.getCenter();
    return {
      loaded: app.isMapLoaded('civil-parishes-by-province'),
      visible: app.isMapVisible('civil-parishes-by-province'),
      detail: app.currentDetailMapId,
      source: app.currentSourceMapId,
      lng: center.lng,
      lat: center.lat,
      zoom: app.mapController.map.getZoom()
    };
  });
  expect(restored.loaded).toBe(true);
  expect(restored.visible).toBe(false);
  expect(restored.detail).toBe('civil-parishes-by-province');
  expect(restored.source).toBe('civil-parishes-by-province');
  expect(restored.lng).toBeCloseTo(-7.2, 1);
  expect(restored.lat).toBeCloseTo(53.35, 1);
  expect(restored.zoom).toBeCloseTo(6.25, 1);
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/hidden=civil-parishes-by-province/);
  await expect(page).toHaveURL(/detail=civil-parishes-by-province/);
  await expect(page).toHaveURL(/source=civil-parishes-by-province/);
  await expect(page).toHaveURL(/activePanel=1/);
  await expect(page).toHaveURL(/controls=1/);
  await expect(page).toHaveURL(/zoom=6\.25/);

  await page.locator('#test2SourcePanelClose').click();
  await expect(page.locator('#test2SourcePanel')).toBeHidden();
  await expect(page).not.toHaveURL(/source=civil-parishes-by-province/);

  await page.locator('#catalogueBackLink').click();
  await expect(page.locator('#catalogueListView')).toBeVisible();
  await expect(page).not.toHaveURL(/detail=civil-parishes-by-province/);

  await page.locator('#activeLayersClose').click();
  await expect(page.locator('#activeLayers')).toBeHidden();
  await expect(page).not.toHaveURL(/activePanel=1/);
});

test('/test2 loads converted child layers for main catalogue composite parents', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const result = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const calls = [];
    const fitted = [];
    const originalResolveLayer = app.mapController.resolveLayer.bind(app.mapController);
    app.mapController.loadLayer = async (id, options = {}) => {
      calls.push({ id, fit: options.fit });
      app.mapController.layerStates.set(id, {
        loaded: true,
        visible: true,
        config: { id, name: id },
        testLayerId: `${id}-vector-test`,
        layerIds: []
      });
      return app.mapController.layerStates.get(id);
    };
    app.mapController.map.fitBounds = (bounds, options) => {
      fitted.push({ bounds, options });
    };
    app.mapController.resolveLayer = (id) => {
      const layer = originalResolveLayer(id);
      if (id === 'all-ireland-townlands' || id === 'eds-1926') return layer ? { ...layer, loadable: false } : { loadable: false };
      return layer;
    };

    await app.loadMap('all-ireland-townlands');
    const afterTownlands = {
      calls: calls.map((call) => call.id),
      fitFlags: calls.map((call) => call.fit),
      loaded: app.isMapLoaded('all-ireland-townlands'),
      visible: app.isMapVisible('all-ireland-townlands'),
      loadedIds: app.getLoadedLayerIds(),
      visibleIds: app.mapController.getVisibleLayers(),
      group: app.mapController.getLayerState('all-ireland-townlands')
    };
    app.updateActiveLayers();
    afterTownlands.activeRows = [...document.querySelectorAll('#activeLayersList .active-layer-item[data-map-id]')]
      .map((row) => row.dataset.mapId);

    calls.length = 0;
    await app.loadMap('eds-1926');
    const afterEds = {
      calls: calls.map((call) => call.id),
      loaded: app.isMapLoaded('eds-1926'),
      group: app.mapController.getLayerState('eds-1926')
    };

    return { afterTownlands, afterEds, fitted };
  });

  expect(result.afterTownlands.calls).toEqual(['ni-townlands', 'roi-townlands']);
  expect(result.afterTownlands.fitFlags).toEqual([false, false]);
  expect(result.afterTownlands.loaded).toBe(true);
  expect(result.afterTownlands.visible).toBe(true);
  expect(result.afterTownlands.loadedIds).toContain('all-ireland-townlands');
  expect(result.afterTownlands.visibleIds).toContain('all-ireland-townlands');
  expect(result.afterTownlands.visibleIds).not.toContain('ni-townlands');
  expect(result.afterTownlands.visibleIds).not.toContain('roi-townlands');
  expect(result.afterTownlands.activeRows).toEqual(['all-ireland-townlands']);
  expect(result.afterTownlands.group.childIds).toEqual(['ni-townlands', 'roi-townlands']);
  expect(result.fitted[0].bounds).toEqual([
    [-10.618624, 51.419897],
    [-5.432784, 55.435141]
  ]);
  expect(result.afterEds.calls).toEqual([
    'eds-connacht-1926',
    'eds-leinster-1926',
    'eds-munster-1926',
    'eds-ulster-1926',
    'deds-ni-1926'
  ]);
  expect(result.afterEds.loaded).toBe(true);
  expect(result.afterEds.group.childIds).toEqual(result.afterEds.calls);
  expect(result.fitted.length).toBeGreaterThanOrEqual(1);
});

test('/test2 adapter supports overlays, partial features, and rich loaded-feature payloads', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);

  const overlayState = await page.evaluate(() => {
    const adapter = window.__civgraphTest2.app.mapController;
    const shown = adapter.toggleOverlay('voyager-labels', true);
    const visible = adapter.map.getLayoutProperty('test2-overlay-voyager-labels', 'visibility') || 'visible';
    const hidden = adapter.toggleOverlay('voyager-labels', false);
    return {
      shown,
      hidden,
      layerExists: Boolean(adapter.map.getLayer('test2-overlay-voyager-labels')),
      visible,
      hiddenVisibility: adapter.map.getLayoutProperty('test2-overlay-voyager-labels', 'visibility'),
      unsupported: adapter.toggleOverlay('missing-overlay', true)
    };
  });
  expect(overlayState.shown).toBe(true);
  expect(overlayState.hidden).toBe(true);
  expect(overlayState.layerExists).toBe(true);
  expect(overlayState.visible).toBe('visible');
  expect(overlayState.hiddenVisibility).toBe('none');
  expect(overlayState.unsupported).toBe(false);

  await loadCivilParishes(page);
  const richPayload = await page.evaluate(() => {
    const features = window.__civgraphTest2.app.mapController.getLoadedFeatures(25);
    const ids = features.map((feature) => `${feature.mapId}:${feature.id}`);
    return {
      count: features.length,
      unique: new Set(ids).size,
      first: features[0]
    };
  });
  expect(richPayload.count).toBeGreaterThan(0);
  expect(richPayload.unique).toBe(richPayload.count);
  expect(richPayload.first.mapId).toBe('civil-parishes-by-province');
  expect(richPayload.first.mapName).toMatch(/Civil Parishes/i);
  expect(richPayload.first.featureName).toBeTruthy();
  expect(richPayload.first.properties).toBeTruthy();
  expect(richPayload.first.geometry).toBeTruthy();

  const partialState = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const adapter = app.mapController;
    const map = window.__civgraphTest2.mapController.map;
    const mapConfig = {
      id: 'civil-parishes-by-province',
      name: 'Civil Parishes by Province',
      labelProperty: 'name',
      style: {}
    };
    const first = map.queryRenderedFeatures({ layers: ['civil-parishes-vector-test-fill'] })[0];
    const featureId = first.id ?? first.properties?.id;
    const featureName = first.properties?.name || first.properties?.NAME || first.properties?.Name || String(featureId);

    adapter.unloadLayer('civil-parishes-by-province');
    await adapter.loadSingleFeature(mapConfig, featureId, featureName, null);
    await new Promise((resolve) => map.once('idle', resolve));
    const afterLoadFeatures = map.queryRenderedFeatures({ layers: ['civil-parishes-vector-test-fill'] });
    const afterLoadIds = [...new Set(afterLoadFeatures.map((feature) => feature.id ?? feature.properties?.id).map(String))];
    const state = adapter.getLayerState('civil-parishes-by-province');
    const afterLoadFeatureNames = [...state.featureNames.values()];

    adapter.togglePartialFeature('civil-parishes-by-province', featureId);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const afterHideCount = map.queryRenderedFeatures({ layers: ['civil-parishes-vector-test-fill'] }).length;
    const hiddenVisible = adapter.isFeatureVisible('civil-parishes-by-province', featureId);

    adapter.togglePartialFeature('civil-parishes-by-province', featureId);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const afterShowCount = map.queryRenderedFeatures({ layers: ['civil-parishes-vector-test-fill'] }).length;
    const shownVisible = adapter.isFeatureVisible('civil-parishes-by-province', featureId);

    adapter.unloadPartialFeature('civil-parishes-by-province', featureId);
    const unloaded = adapter.isLayerLoaded('civil-parishes-by-province');

    await adapter.loadSingleFeature(mapConfig, featureId, featureName, null);
    await adapter.expandToFullMap(mapConfig);
    await new Promise((resolve) => map.once('idle', resolve));
    const expandedCount = map.queryRenderedFeatures({ layers: ['civil-parishes-vector-test-fill'] }).length;
    const expandedState = adapter.getLayerState('civil-parishes-by-province');

    return {
      featureId: String(featureId),
      partial: state.isPartial,
      baseLoaded: state.baseLoaded,
      loaded: adapter.isFeatureLoaded('civil-parishes-by-province', featureId),
      featureNames: afterLoadFeatureNames,
      afterLoadCount: afterLoadFeatures.length,
      afterLoadIds,
      afterHideCount,
      hiddenVisible,
      afterShowCount,
      shownVisible,
      unloaded,
      expandedCount,
      expandedPartial: expandedState.isPartial,
      expandedBaseLoaded: expandedState.baseLoaded
    };
  });

  expect(partialState.partial).toBe(true);
  expect(partialState.baseLoaded).toBe(false);
  expect(partialState.loaded).toBe(true);
  expect(partialState.featureNames[0]).toBeTruthy();
  expect(partialState.afterLoadCount).toBeGreaterThan(0);
  expect(partialState.afterLoadIds).toEqual([partialState.featureId]);
  expect(partialState.afterHideCount).toBe(0);
  expect(partialState.hiddenVisible).toBe(false);
  expect(partialState.afterShowCount).toBeGreaterThan(0);
  expect(partialState.shownVisible).toBe(true);
  expect(partialState.unloaded).toBe(false);
  expect(partialState.expandedCount).toBeGreaterThan(partialState.afterShowCount);
  expect(partialState.expandedPartial).toBe(false);
  expect(partialState.expandedBaseLoaded).toBe(true);
});

test('/test2 hash-only shell links and legacy hash writers preserve the test2 path', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);

  await page.locator('a[href="#flat-section-maps"]').first().click();
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#flat-section-maps$/);

  await page.evaluate(() => history.replaceState(null, '', '#manual-hash-state'));
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#manual-hash-state$/);

  await page.evaluate(() => history.pushState(null, '', '#manual-push-state'));
  expect(new URL(page.url()).pathname).toBe('/test2/');
  await expect(page).toHaveURL(/#manual-push-state$/);
});

test('/test2 MapLibre controls handle opacity, labels, feature details, and active layers', async ({ page }) => {
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await loadCivilParishes(page);
  await expect(page.locator('.maplibre-dom-label:not([hidden])').first()).toBeVisible();
  const styleParity = await page.evaluate(() => {
    const adapter = window.__civgraphTest2.app.mapController;
    const layer = { id: 'synthetic', style: { color: '#abcdef', fillOpacity: 0.18, weight: 1 } };
    return {
      transparentDefault: adapter.applyMainStyle(layer, { style: { color: '#123456', weight: 2 } }).style,
      explicitFill: adapter.applyMainStyle(layer, { style: { color: '#123456', fillOpacity: 0.4, weight: 2 } }).style
    };
  });
  expect(styleParity.transparentDefault.fillOpacity).toBeUndefined();
  expect(styleParity.explicitFill.fillOpacity).toBe(0.4);
  const defaultFillOpacity = await page.evaluate(() => (
    window.__civgraphTest2.mapController.map.getPaintProperty('civil-parishes-vector-test-fill', 'fill-opacity')
  ));
  expect(defaultFillOpacity).toBe(0);
  const labelState = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.maplibre-dom-label:not([hidden])')];
    return {
      count: labels.length,
      uniqueFeatureIds: new Set(labels.map((label) => `${label.dataset.layerId}:${label.dataset.featureId}`)).size,
      nativeLabelOpacity: window.__civgraphTest2.mapController.map.getPaintProperty('civil-parishes-vector-test-label', 'text-opacity')
    };
  });
  expect(labelState.count).toBeGreaterThan(0);
  expect(labelState.uniqueFeatureIds).toBe(labelState.count);
  expect(labelState.nativeLabelOpacity).toBe(0);

  const firstLabel = page.locator('.maplibre-dom-label:not([hidden])').first();
  const firstLabelText = await firstLabel.textContent();
  await firstLabel.hover();
  await expect(firstLabel).toHaveClass(/map-label--hover/);
  const hoverState = await firstLabel.evaluate((label) => {
    const app = window.__civgraphTest2;
    const id = label.dataset.featureId;
    const labelStyle = getComputedStyle(label.querySelector('div'));
    return {
      color: labelStyle.color,
      decoration: labelStyle.textDecorationLine,
      textShadow: labelStyle.textShadow,
      fillColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-hover', 'fill-color'),
      baseFillAntialias: app.mapController.map.getPaintProperty('civil-parishes-vector-test-fill', 'fill-antialias'),
      hoverFillAntialias: app.mapController.map.getPaintProperty('civil-parishes-vector-test-hover', 'fill-antialias'),
      hoverLineLayerExists: Boolean(app.mapController.map.getLayer('civil-parishes-vector-test-hover-line')),
      fallbackHoverCount: app.mapController.map.queryRenderedFeatures({
        layers: ['civil-parishes-vector-test-fallback-hover-fill'].filter((layerId) => app.mapController.map.getLayer(layerId))
      }).length,
      featureHover: app.mapController.map.getFeatureState({
        source: 'civil-parishes-vector-test-source',
        sourceLayer: app.metadataService.getLayer('civil-parishes-vector-test').sourceLayer,
        id
      }).hover === true
    };
  });
  expect(hoverState.color).toBe('rgb(255, 122, 26)');
  expect(hoverState.decoration).toContain('underline');
  expect(hoverState.textShadow).toContain('rgb(255, 255, 255)');
  expect(hoverState.textShadow).not.toContain('255, 122, 26');
  expect(hoverState.fillColor).toBe('#FDBA74');
  expect(hoverState.baseFillAntialias).toBe(false);
  expect(hoverState.hoverFillAntialias).toBe(false);
  expect(hoverState.hoverLineLayerExists).toBe(false);
  expect(hoverState.fallbackHoverCount).toBe(0);
  expect(hoverState.featureHover).toBe(true);

  await firstLabel.click();
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(firstLabel).toHaveClass(/map-label--selected/);
  await expect(page.locator('#featureInfoContent')).toContainText(/Civil Parishes|Parish|Name/i);
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
  await expect(page.locator('#featureInfoContent .feature-info__primary-name').first()).toContainText(firstLabelText.trim());
  const selectedStyle = await firstLabel.evaluate((label) => {
    const app = window.__civgraphTest2;
    const id = label.dataset.featureId;
    const labelStyle = getComputedStyle(label.querySelector('div'));
    return {
      labelColor: labelStyle.color,
      labelDecoration: labelStyle.textDecorationLine,
      fillColor: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected-fill', 'fill-color'),
      fillOpacity: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected-fill', 'fill-opacity'),
      selectedFillAntialias: app.mapController.map.getPaintProperty('civil-parishes-vector-test-selected-fill', 'fill-antialias'),
      selectedLineLayerExists: Boolean(app.mapController.map.getLayer('civil-parishes-vector-test-selected')),
      fallbackSelectedCount: app.mapController.map.queryRenderedFeatures({
        layers: ['civil-parishes-vector-test-fallback-selected-fill'].filter((layerId) => app.mapController.map.getLayer(layerId))
      }).length,
      featureSelected: app.mapController.map.getFeatureState({
        source: 'civil-parishes-vector-test-source',
        sourceLayer: app.metadataService.getLayer('civil-parishes-vector-test').sourceLayer,
        id
      }).selected === true
    };
  });
  expect(selectedStyle.labelColor).toBe('rgb(255, 122, 26)');
  expect(selectedStyle.labelDecoration).toContain('underline');
  expect(selectedStyle.fillColor).toBe('#FDBA74');
  expect(selectedStyle.fillOpacity).toEqual(['case', ['boolean', ['feature-state', 'selected'], false], 0.42, 0]);
  expect(selectedStyle.selectedFillAntialias).toBe(false);
  expect(selectedStyle.selectedLineLayerExists).toBe(false);
  expect(selectedStyle.fallbackSelectedCount).toBe(0);
  expect(selectedStyle.featureSelected).toBe(true);
  const featureCardPosition = await page.evaluate(() => {
    const mapPane = document.querySelector('.pane--map').getBoundingClientRect();
    const card = document.getElementById('featureInfo').getBoundingClientRect();
    return {
      topDelta: card.top - mapPane.top,
      rightDelta: mapPane.right - card.right
    };
  });
  expect(featureCardPosition.topDelta).toBeGreaterThanOrEqual(0);
  expect(featureCardPosition.topDelta).toBeLessThan(40);
  expect(featureCardPosition.rightDelta).toBeGreaterThanOrEqual(0);
  expect(featureCardPosition.rightDelta).toBeLessThan(40);

  const target = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const feature = map.queryRenderedFeatures({
      layers: ['civil-parishes-vector-test-fill'].filter((id) => map.getLayer(id))
    })[0];
    const coords = [];
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coords.push([value[0], value[1]]);
        return;
      }
      value.forEach(walk);
    };
    walk(feature?.geometry?.coordinates);
    const lng = coords.reduce((sum, coord) => sum + coord[0], 0) / coords.length;
    const lat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
    const point = map.project([lng, lat]);
    const rect = map.getContainer().getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  });
  await page.locator('#featureInfoClose').click();
  await expect(page.locator('#featureInfo')).toBeHidden();
  await page.mouse.dblclick(target.x, target.y);
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');

  await page.locator('#mapControlsToggle').click();
  await expect(page.locator('#mapControlPanel')).toHaveClass(/map-control-panel--expanded/);
  await page.locator('#transparencySlider').fill('35');
  await page.locator('#fillTransparencySlider').fill('65');
  await page.locator('#labelsToggle').uncheck();
  const paints = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    return {
      lineOpacity: map.getPaintProperty('civil-parishes-vector-test-line', 'line-opacity'),
      fillOpacity: map.getPaintProperty('civil-parishes-vector-test-fill', 'fill-opacity'),
      labelsVisibility: map.getLayoutProperty('civil-parishes-vector-test-label', 'visibility'),
      domLabelsHidden: [...document.querySelectorAll('.maplibre-dom-label')].every((label) => label.hidden)
    };
  });
  expect(Number(paints.lineOpacity)).toBeCloseTo(0.65, 1);
  expect(Number(paints.fillOpacity)).toBeCloseTo(0.35, 1);
  expect(paints.labelsVisibility).toBe('none');
  expect(paints.domLabelsHidden).toBe(true);

  await page.locator('#featureInfoClose').click();
  await expect(page.locator('#featureInfo')).toBeHidden();
  await page.locator('#activeLayersToggle').click();
  await expect(page.locator('#activeLayers')).toBeVisible();
  await expect(page.locator('#activeLayersList')).toContainText('Civil Parishes');

  const selected = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const feature = map.queryRenderedFeatures({
      layers: ['civil-parishes-vector-test-fill', 'civil-parishes-vector-test-line'].filter((id) => map.getLayer(id))
    })[0];
    const id = feature?.id ?? feature?.properties?.id;
    if (id === undefined || id === null) return false;
    return window.__civgraphTest2.mapController.renderer.selectFeatureById(
      'civil-parishes-vector-test',
      id,
      feature.properties
    );
  });
  expect(selected).toBe(true);
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).toContainText(/Civil Parishes|Parish|Name/i);
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
});

test('/test2 mobile-sized feature taps select geometry without double-tap zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.evaluate(() => window.uiController?.setSplitState?.('map-full'));
  await loadCivilParishes(page);
  await page.waitForFunction(() => {
    const map = window.__civgraphTest2?.mapController?.map;
    if (!map) return false;
    const layers = ['civil-parishes-vector-test-fill'].filter((id) => map.getLayer(id));
    if (layers.length === 0) return false;
    const hasCoordinates = (value) => {
      if (!Array.isArray(value)) return false;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') return true;
      return value.some(hasCoordinates);
    };
    return map.queryRenderedFeatures({ layers }).some((feature) => hasCoordinates(feature?.geometry?.coordinates));
  }, { timeout: 15000 });

  const target = await page.evaluate(() => {
    const map = window.__civgraphTest2.mapController.map;
    const features = map.queryRenderedFeatures({
      layers: ['civil-parishes-vector-test-fill'].filter((id) => map.getLayer(id))
    });
    const coords = [];
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coords.push([value[0], value[1]]);
        return;
      }
      value.forEach(walk);
    };
    const feature = features.find((candidate) => {
      coords.length = 0;
      walk(candidate?.geometry?.coordinates);
      return coords.length > 0;
    });
    if (!feature || coords.length === 0) throw new Error('No civil parish geometry was available to tap');
    const lng = coords.reduce((sum, coord) => sum + coord[0], 0) / coords.length;
    const lat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
    const point = map.project([lng, lat]);
    const rect = map.getContainer().getBoundingClientRect();
    return {
      x: rect.left + point.x,
      y: rect.top + point.y,
      zoom: map.getZoom()
    };
  });

  const doubleClickZoomDisabled = await page.evaluate(() => {
    const handler = window.__civgraphTest2.mapController.map.doubleClickZoom;
    return typeof handler?.isEnabled === 'function' ? handler.isEnabled() === false : true;
  });
  expect(doubleClickZoomDisabled).toBe(true);

  await page.mouse.dblclick(target.x, target.y);
  await expect(page.locator('#featureInfo')).toBeVisible();
  await expect(page.locator('#featureInfoContent')).not.toContainText('Unnamed Feature');
  const zoomAfter = await page.evaluate(() => window.__civgraphTest2.mapController.map.getZoom());
  expect(Math.abs(zoomAfter - target.zoom)).toBeLessThan(0.25);
});

test('/test2 mobile shell, support modal, theme toggle, and accessibility smoke pass', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileMenu')).toBeVisible();
  await page.locator('#mobileSupportBtn').click();
  await expect(page.locator('#supportModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#supportModal')).toBeHidden();
  await page.evaluate(() => document.getElementById('themeToggle')?.click());
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const results = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('/test2 does not register the production service worker', async ({ page }) => {
  await page.addInitScript(() => {
    window.__registeredServiceWorkers = [];
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: async (url) => {
          window.__registeredServiceWorkers.push(url);
          return {};
        }
      }
    });
  });
  await page.goto('/test2/');
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await expect.poll(() => page.evaluate(() => window.__registeredServiceWorkers)).toEqual([]);
});
