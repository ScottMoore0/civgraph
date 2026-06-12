#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.TEST2_PARITY_PORT || 5055);
const BASE = `http://127.0.0.1:${PORT}`;
const MATRIX_PATH = 'docs/test2-general-parity-matrix.json';
const REPORT_PATH = process.env.TEST2_PARITY_REPORT || 'app/build/test2-general-parity-report.json';
const REQUIRED_CLASSIFICATIONS = new Set(['must-match-main', 'maplibre-specific-equivalent']);

if (!existsSync(MATRIX_PATH)) {
  throw new Error(`${MATRIX_PATH} is missing`);
}

const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));
const matrixById = new Map((matrix.areas || []).map((area) => [area.id, area]));
const results = [];

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  stdio: 'ignore'
});

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`local static server did not start on ${BASE}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCheck(areaId, fn) {
  const area = matrixById.get(areaId);
  if (!area) throw new Error(`Unknown parity matrix area: ${areaId}`);
  const started = Date.now();
  try {
    const evidence = await fn();
    results.push({
      id: areaId,
      title: area.title,
      classification: area.classification,
      status: 'pass',
      durationMs: Date.now() - started,
      evidence
    });
  } catch (error) {
    results.push({
      id: areaId,
      title: area.title,
      classification: area.classification,
      status: REQUIRED_CLASSIFICATIONS.has(area.classification) ? 'fail' : 'warn',
      durationMs: Date.now() - started,
      message: error.message
    });
  }
}

async function bootMain(page, url = '/') {
  await page.goto(`${BASE}${url}`);
  await page.waitForSelector('body.app-shell', { timeout: 25000 });
  await page.waitForSelector('#catalogueFlatView', { state: 'attached', timeout: 25000 });
  await page.waitForSelector('#map', { timeout: 25000 });
}

async function bootTest2(page, hash = '') {
  await page.goto(`${BASE}/test2/${hash}`);
  await page.waitForSelector('body.app-shell', { timeout: 25000 });
  await page.waitForFunction(() => window.__civgraphTest2?.restorePromise, null, { timeout: 25000 });
  await page.evaluate(() => window.__civgraphTest2.restorePromise);
  await page.waitForSelector('#catalogueFlatView', { state: 'attached', timeout: 25000 });
  await page.waitForSelector('#map canvas', { timeout: 25000 });
}

async function extractShell(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    };
    return {
      path: location.pathname,
      bodyClasses: document.body.className,
      header: rect('.app-header'),
      infoPane: rect('.pane--info'),
      mapPane: rect('.pane--map'),
      search: rect('#searchInput'),
      searchPlaceholder: document.querySelector('#searchInput')?.getAttribute('placeholder') || '',
      navTexts: [...document.querySelectorAll('.app-header__link, .app-header__support, .support-btn, #supportBtn, #mobileSupportBtn')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean),
      hasCatalogue: Boolean(document.querySelector('#catalogueFlatView')),
      hasMainShell: Boolean(document.querySelector('body.app-shell .app-main .pane--info + .split-drag + .pane--map')),
      catalogueRows: document.querySelectorAll('#catalogueFlatView table tr').length,
      electionTocRows: document.querySelectorAll('#catalogueFlatView .flat-election-toc-link').length,
      decadeButtons: document.querySelectorAll('#catalogueFlatView .catalogue-flat__toc-decade-btn').length,
      hasMapCanvas: Boolean(document.querySelector('#map canvas')),
      hasLeafletAttribution: /Leaflet/.test(document.body.textContent || ''),
      hasMapLibreAttribution: /MapLibre/.test(document.body.textContent || '')
    };
  });
}

function compareShell(main, test2) {
  assert(test2.hasMainShell, '/test2 is missing the production shell structure');
  assert(test2.hasCatalogue, '/test2 is missing the production catalogue container');
  assert(test2.hasMapCanvas, '/test2 is missing the MapLibre canvas');
  assert(Math.abs(main.header.height - test2.header.height) <= 1, `header height mismatch: main=${main.header.height}, test2=${test2.header.height}`);
  assert(Math.abs(main.infoPane.width - test2.infoPane.width) <= 2, `catalogue pane width mismatch: main=${main.infoPane.width}, test2=${test2.infoPane.width}`);
  assert(main.searchPlaceholder === test2.searchPlaceholder, `search placeholder mismatch: main="${main.searchPlaceholder}", test2="${test2.searchPlaceholder}"`);
  for (const expected of ['Home', 'Browse', 'About', 'Support Us']) {
    assert(test2.navTexts.some((text) => text.includes(expected)), `/test2 navbar missing ${expected}`);
  }
}

async function extractElectionPartyRows(page) {
  await page.waitForSelector('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)', { timeout: 30000 });
  return page.evaluate(() => [...document.querySelectorAll('#electionPaneContent .election-party-table tbody tr:not(.election-table-summary-row)')]
    .slice(0, 5)
    .map((row) => [...row.children].slice(0, 12).map((cell) => cell.textContent?.trim()?.replace(/\s+/g, ' '))));
}

async function extractElectionPaneSnapshot(page, options = {}) {
  const waitForTable = options.waitForTable !== false;
  if (waitForTable) {
    await page.waitForSelector('#electionPaneContent table, #electionPaneContent .election-animation-container, #electionPaneContent .election-no-data', { timeout: 30000 });
  }
  return page.evaluate(() => {
    const pane = document.querySelector('#electionResultsPane') || document.querySelector('.election-results-pane');
    const content = document.querySelector('#electionPaneContent');
    const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const table = content?.querySelector('table');
    return {
      title: normalise(document.querySelector('#electionPaneTitle')?.textContent || pane?.querySelector('.election-results-title')?.textContent || ''),
      activeControls: [...document.querySelectorAll('.election-detail-toggle-btn--active, .election-results-pane__tab--active, [aria-pressed="true"]')]
        .map((el) => normalise(el.textContent)),
      controlTexts: [...document.querySelectorAll('#electionResultsPane button, .election-results-pane button')]
        .map((el) => normalise(el.textContent))
        .filter(Boolean),
      renderer: content?.querySelector('[data-election-renderer]')?.getAttribute('data-election-renderer') || '',
      tableClasses: table?.className || '',
      headers: table ? [...table.querySelectorAll('thead th')].slice(0, 20).map((th) => normalise(th.textContent)) : [],
      rows: table ? [...table.querySelectorAll('tbody tr:not(.election-table-summary-row)')].slice(0, 8).map((row) => [...row.children].slice(0, 12).map((cell) => normalise(cell.textContent))) : [],
      hasSortButtons: Boolean(content?.querySelector('.election-th-btn')),
      hasFilterMenuPrimitive: Boolean(content?.querySelector('[data-sort-key], [data-leaf-col-idx]')),
      hasEntityLinks: Boolean(content?.querySelector('[data-election-entity]')),
      hasAnimationContainer: Boolean(content?.querySelector('#electionAnimationContainer, .election-animation-container')),
      hasTransferScaffold: Boolean(content && /Stages|transfers|No transfer animation data|Loading transfer animation|Made Quota|Non-transferable|Electorate/i.test(content.textContent || '')),
      text: normalise(content?.textContent || '').slice(0, 1000)
    };
  });
}

async function clickElectionPaneControl(page, labelPattern) {
  await page.waitForSelector('#electionResultsPane, .election-results-pane', { timeout: 30000 });
  const clicked = await page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const buttons = [...document.querySelectorAll('#electionResultsPane button, .election-results-pane button')];
    const button = buttons.find((candidate) => pattern.test(String(candidate.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!button) return false;
    button.click();
    return true;
  }, labelPattern.source);
  assert(clicked, `Could not find election pane control matching ${labelPattern}`);
  await page.waitForTimeout(250);
}

async function loadMainDail2024(page) {
  await bootMain(page, '/');
  await page.waitForFunction(() => window.uiController?.onLoadElection, null, { timeout: 30000 });
  await page.evaluate(() => window.uiController.onLoadElection('D\u00e1il \u00c9ireann', '2024-11-29'));
}

async function selectMainRoscommonGalway(page) {
  await page.waitForFunction(() => window.mapController?.map || window.uiController, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const deadline = Date.now() + 20000;
    function findLayer(layer) {
      if (!layer) return null;
      if (typeof layer.getLayers === 'function') {
        for (const child of layer.getLayers()) {
          const found = findLayer(child);
          if (found) return found;
        }
      }
      const props = layer.feature?.properties || layer.options?.feature?.properties || {};
      const text = Object.values(props).map(String).join(' ').toLowerCase();
      if (text.includes('roscommon') && text.includes('galway')) return layer;
      return null;
    }
    while (Date.now() < deadline) {
      const map = window.mapController?.map;
      let found = null;
      if (map?.eachLayer) map.eachLayer((layer) => { if (!found) found = findLayer(layer); });
      if (found) {
        if (typeof found.fire === 'function') found.fire('click', { target: found });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Could not find Roscommon Galway feature on main');
  });
}

async function extractTimeline(page) {
  return page.evaluate(() => ({
    text: String(document.querySelector('.timeline-slider, #timeSlider, .time-slider')?.textContent || '').replace(/\s+/g, ' ').trim(),
    labels: [...document.querySelectorAll('.timeline-slider, #timeSlider, .time-slider, .timeline-date, .time-slider__label')]
      .map((el) => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }));
}

async function extractBrowseMapPage(page) {
  await page.goto(`${BASE}/browse/#/maps/admin-areas-1924-04-01`);
  await page.waitForSelector('main, .browse-shell, body', { timeout: 25000 });
  await page.waitForFunction(() => /Administrative Areas/.test(document.body.textContent || ''), null, { timeout: 25000 });
  return page.evaluate(() => ({
    title: String(document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim(),
    hasOpenMap: /Open in interactive map/.test(document.body.textContent || ''),
    hasThumbnail: Boolean(document.querySelector('img, canvas, .browse-thumbnail')),
    hasOverview: /Overview/.test(document.body.textContent || ''),
    hasTechnicalDetails: /Technical data|Technical details|Full technical details|All Browse Fields/i.test(document.body.textContent || ''),
    detailsCollapsed: [...document.querySelectorAll('details')].some((el) => /technical|details|fields/i.test(el.textContent || '') && !el.open),
    visibleTechnicalLeak: /label property|spatial index|sourceMapId|featureIndexUrl|generated/i.test([...document.querySelectorAll('main, .browse-main, body')]
      .map((el) => el.textContent || '').join(' '))
  }));
}

async function extractBrowseRoute(page, hash) {
  await page.goto(`${BASE}/browse/${hash}`);
  await page.waitForSelector('main, .browse-shell, body', { timeout: 25000 });
  await page.waitForFunction(() => document.body.textContent && document.body.textContent.length > 200, null, { timeout: 25000 });
  await page.waitForFunction(() => {
    const text = document.body.textContent || '';
    return document.querySelectorAll('.browse-card').length > 0
      || document.querySelectorAll('details').length > 0
      || /Open in interactive map|Open election layer/i.test(text);
  }, null, { timeout: 25000 });
  return page.evaluate(() => {
    const normalise = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    return {
      hash: location.hash,
      title: normalise(document.querySelector('h1')?.textContent || ''),
      recordCountText: normalise([...document.querySelectorAll('main, .browse-main, body')]
        .map((el) => el.textContent || '')
        .join(' ')
        .match(/\b\d[\d,]* of \d[\d,]* records\b|\b\d[\d,]* records\b/i)?.[0] || ''),
      cards: document.querySelectorAll('.browse-card, .browse-list-item, .browse-record-card, article').length,
      links: [...document.querySelectorAll('a, button')].map((el) => normalise(el.textContent)).filter(Boolean).slice(0, 20),
      hasThumbnail: Boolean(document.querySelector('img, canvas, .browse-thumbnail')),
      hasOpenMap: /Open in interactive map/.test(document.body.textContent || ''),
      hasOpenElection: /Open election layer/.test(document.body.textContent || ''),
      hasTechnicalDetails: /Technical data|Technical details|Full technical details|All Browse Fields/i.test(document.body.textContent || ''),
      collapsedDetails: [...document.querySelectorAll('details')].filter((el) => !el.open).length
    };
  });
}

async function extractMobileState(page) {
  await page.setViewportSize({ width: 390, height: 760 });
  await bootTest2(page);
  return page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    };
    const overlaps = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const header = rect('.app-header');
    const mobileToggle = rect('#mobileToggle');
    const zoom = rect('.test2-main-zoom-control');
    const timeline = rect('.timeline-slider');
    const settings = rect('.test2-map-settings, #mapSettingsButton, .leaflet-control-settings');
    return {
      header,
      mobileToggle,
      zoom,
      timeline,
      settings,
      toggleInHeader: Boolean(header && mobileToggle && mobileToggle.top >= header.top && mobileToggle.bottom <= header.bottom + 2),
      toggleOverlapsZoom: overlaps(mobileToggle, zoom),
      settingsOverlapsTimeline: overlaps(settings, timeline)
    };
  });
}

async function extractMobileElectionState(page, viewport) {
  await page.setViewportSize(viewport);
  await bootTest2(page, '#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
  return page.evaluate(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height)
      };
    };
    const overlaps = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const header = rect('.app-header');
    const mobileToggle = rect('#mobileToggle');
    const zoom = rect('.test2-main-zoom-control');
    const timeline = rect('.timeline-slider');
    const pane = rect('#electionResultsPane');
    return {
      header,
      mobileToggle,
      zoom,
      timeline,
      pane,
      toggleInHeader: Boolean(header && mobileToggle && mobileToggle.top >= header.top && mobileToggle.bottom <= header.bottom + 2),
      toggleOverlapsZoom: overlaps(mobileToggle, zoom),
      paneVisible: Boolean(pane && pane.height > 30),
      timelineVisible: Boolean(timeline && timeline.width > 120)
    };
  });
}

function normalise(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractDataCoverageState() {
  const plan = JSON.parse(readFileSync('test/metadata/main-site-port-plan.json', 'utf8'));
  const metadata = JSON.parse(readFileSync('test/metadata/maps-test.json', 'utf8'));
  const actionableStatuses = new Set(['needsVectorTileConversion', 'needsRasterStrategy', 'needsMapLibreSourceMapping']);
  const actionableRows = (plan.rows || []).filter((row) => actionableStatuses.has(row.conversionStatus));
  const metadataOnlyRows = (plan.rows || []).filter((row) => row.conversionStatus === 'metadataOnly');
  const civilAlias = (metadata.layers || []).find((layer) => layer.sourceMapId === 'civil-parishes' && layer.aliasTargetLayerId === 'civil-parishes-vector-test');
  const townlands = (plan.rows || []).find((row) => row.sourceMapId === 'all-ireland-townlands');
  const civilPlan = (plan.rows || []).find((row) => row.sourceMapId === 'civil-parishes');
  return {
    totals: plan.totals,
    actionableRows: actionableRows.map((row) => ({ id: row.sourceMapId, status: row.conversionStatus, name: row.name })).slice(0, 20),
    metadataOnlyCount: metadataOnlyRows.length,
    metadataOnlySample: metadataOnlyRows.slice(0, 12).map((row) => ({ id: row.sourceMapId, name: row.name, reason: row.unsupportedReason })),
    townlands,
    civilPlan,
    civilAlias: civilAlias ? {
      id: civilAlias.id,
      sourceMapId: civilAlias.sourceMapId,
      aliasOf: civilAlias.aliasOf,
      aliasTargetLayerId: civilAlias.aliasTargetLayerId
    } : null
  };
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const mainPage = await context.newPage();
  const test2Page = await context.newPage();

  await runCheck('shell.desktop', async () => {
    await bootMain(mainPage);
    await bootTest2(test2Page);
    const main = await extractShell(mainPage);
    const test2 = await extractShell(test2Page);
    compareShell(main, test2);
    return { main, test2 };
  });

  await runCheck('catalogue.default', async () => {
    const test2 = await extractShell(test2Page);
    assert(test2.catalogueRows > 10, `/test2 catalogue has too few rows: ${test2.catalogueRows}`);
    assert(test2.decadeButtons > 5, `/test2 election decade cards are missing: ${test2.decadeButtons}`);
    assert(test2.electionTocRows === 0, `/test2 should not expose individual election rows in the top TOC: ${test2.electionTocRows}`);
    return test2;
  });

  await runCheck('map.controls', async () => {
    const state = await test2Page.evaluate(() => ({
      customZoom: Boolean(document.querySelector('.test2-main-zoom-control')),
      compass: Boolean(document.querySelector('.test2-main-zoom-control__compass')),
      nativeControlsHidden: getComputedStyle(document.querySelector('#map .maplibregl-ctrl-top-left') || document.body).display === 'none',
      timeline: Boolean(document.querySelector('.timeline-slider')),
      activeLayers: Boolean(document.querySelector('#activeLayersList, .active-layers-panel'))
    }));
    assert(state.customZoom, '/test2 custom main-style zoom control is missing');
    assert(state.compass, '/test2 compass/reset-north button is missing');
    assert(state.timeline, '/test2 timeline slider is missing');
    return state;
  });

  await runCheck('ordinary.maps', async () => {
    const state = await test2Page.evaluate(async () => {
      const app = window.__civgraphTest2.app;
      await app.loadMap('settlements-2015');
      await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
      const map = window.__civgraphTest2.mapController.map;
      const layers = map.getStyle().layers || [];
      const fillLayer = layers.find((layer) => /settlements-2015/.test(layer.id) && layer.type === 'fill');
      return {
        loaded: app.loadedMaps?.has?.('settlements-2015') || app.loadedMapIds?.has?.('settlements-2015') || Boolean(fillLayer),
        fillOpacity: fillLayer ? map.getPaintProperty(fillLayer.id, 'fill-opacity') : null,
        domLabels: document.querySelectorAll('.maplibre-dom-label').length,
        activeLayerText: document.querySelector('#activeLayersList')?.textContent || ''
      };
    });
    assert(state.loaded, '/test2 did not load the representative ordinary map');
    assert(String(state.activeLayerText).toLowerCase().includes('settlement'), '/test2 active layer panel does not show the ordinary map');
    return state;
  });

  await runCheck('ordinary.maps.multilayer', async () => {
    const state = await test2Page.evaluate(async () => {
      const app = window.__civgraphTest2.app;
      const map = window.__civgraphTest2.mapController.map;
      const requestedIds = ['settlements-2015', 'deas-1972', 'admin-areas-1924-04-01'];
      const cases = [];
      for (const id of requestedIds) {
        const layer = window.__civgraphTest2.metadataService.getLayer(id);
        if (!layer) {
          cases.push({ id, exists: false });
          continue;
        }
        await app.loadMap(id);
        await new Promise((resolve) => map.once('idle', resolve));
        const styleLayers = map.getStyle().layers || [];
        const layerIds = styleLayers.filter((styleLayer) => styleLayer.id.includes(id)).map((styleLayer) => styleLayer.id);
        const queryLayers = layerIds.filter((layerId) => map.getLayer(layerId) && !/label|hover|selected/i.test(layerId));
        const rendered = queryLayers.length ? map.queryRenderedFeatures({ layers: queryLayers }).slice(0, 10) : [];
        const fillLayer = styleLayers.find((styleLayer) => styleLayer.id.includes(id) && styleLayer.type === 'fill');
        cases.push({
          id,
          exists: true,
          loaded: app.loadedMaps?.has?.(id) || app.loadedMapIds?.has?.(id) || layerIds.length > 0,
          titleVisible: (document.querySelector('#activeLayersList')?.textContent || '').includes(layer.name || id),
          geometryType: layer.geometryType || '',
          styleLayerCount: layerIds.length,
          renderedFeatureCount: rendered.length,
          fillOpacity: fillLayer ? map.getPaintProperty(fillLayer.id, 'fill-opacity') : null
        });
      }
      return { cases, activeLayerText: document.querySelector('#activeLayersList')?.textContent || '' };
    });
    const loadedCases = state.cases.filter((entry) => entry.exists);
    assert(loadedCases.length >= 3, `/test2 ordinary multi-layer coverage has too few available cases: ${loadedCases.length}`);
    for (const entry of loadedCases) {
      assert(entry.loaded, `/test2 did not load representative ordinary layer ${entry.id}`);
      assert(entry.styleLayerCount > 0, `/test2 ordinary layer ${entry.id} has no MapLibre style layers`);
    }
    return state;
  });

  await runCheck('feature.cards', async () => {
    const state = await test2Page.evaluate(async () => {
      const app = window.__civgraphTest2.app;
      const adapter = window.__civgraphTest2.mapController;
      const map = adapter.map;
      const index = await fetch('/test/metadata/feature-indexes/deas-1972-vector-test.json').then((response) => response.json());
      const indexed = (index.items || []).find((item) => item.name === 'BELFAST AREA H')
        || (index.items || []).find((item) => /BELFAST AREA/i.test(item.name || ''))
        || (index.items || []).find((item) => item.name && !/Unnamed Feature/i.test(item.name));
      if (!indexed) return { featureFound: false, indexedFeatureCount: index.items?.length || 0 };
      if (Array.isArray(indexed.center)) {
        map.jumpTo({ center: indexed.center, zoom: 10 });
        await new Promise((resolve) => map.once('idle', resolve));
      }
      await app.loadMap('deas-1972');
      await new Promise((resolve) => map.once('idle', resolve));
      const mainMapConfig = window.dataService?.getMapById?.('deas-1972') || { id: 'deas-1972', name: 'District Electoral Areas - 1972' };
      const loaded = await adapter.loadSingleFeature(mainMapConfig, indexed.id, indexed.name);
      await new Promise((resolve) => map.once('idle', resolve));
      const feature = loaded?.feature || {
        id: indexed.id,
        name: indexed.name,
        properties: { name: indexed.name, NAME: indexed.name },
        geometry: null
      };
      const id = feature.id || indexed.id || feature.name;
      window.uiController?.showFeatureInfo?.([{
        mapId: 'deas-1972',
        id,
        name: feature.name,
        featureName: feature.name,
        properties: feature.properties || {},
        geometry: feature.geometry || null
      }], [mainMapConfig]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const panel = document.querySelector('#featureInfo, .feature-info, #featureInfoPanel');
      return {
        featureFound: true,
        indexedFeatureCount: index.items?.length || 0,
        selectedName: feature.name,
        panelVisible: Boolean(panel && panel.getBoundingClientRect().width > 50 && panel.getBoundingClientRect().height > 50),
        panelText: String(panel?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
        panelRight: panel ? Math.round(window.innerWidth - panel.getBoundingClientRect().right) : null
      };
    });
    assert(state.featureFound, `/test2 could not find a representative indexed feature for feature-card coverage; count=${state.indexedFeatureCount}`);
    assert(state.panelVisible, '/test2 feature card did not become visible');
    assert(!/Unnamed Feature/i.test(state.panelText), '/test2 feature card contains Unnamed Feature');
    return state;
  });

  await runCheck('elections.overall-pane', async () => {
    const electionHash = '#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00';
    await loadMainDail2024(mainPage);
    await bootTest2(test2Page, electionHash);
    const [mainRows, test2Rows] = await Promise.all([
      extractElectionPartyRows(mainPage),
      extractElectionPartyRows(test2Page)
    ]);
    assert(JSON.stringify(test2Rows.slice(0, 4)) === JSON.stringify(mainRows.slice(0, 4)), '/test2 Dail 2024 overall party rows differ from main');
    return { mainRows: mainRows.slice(0, 4), test2Rows: test2Rows.slice(0, 4) };
  });

  await runCheck('elections.selected-pane', async () => {
    await loadMainDail2024(mainPage);
    await selectMainRoscommonGalway(mainPage);
    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&electionSelected=roscommon-galway&electionView=party&lng=-8.12&lat=53.48&zoom=7.00');
    const [mainRows, test2Rows] = await Promise.all([
      extractElectionPartyRows(mainPage),
      extractElectionPartyRows(test2Page)
    ]);
    assert(JSON.stringify(test2Rows.slice(0, 8)) === JSON.stringify(mainRows.slice(0, 8)), '/test2 selected Roscommon Galway party rows differ from main');
    return { mainRows: mainRows.slice(0, 8), test2Rows: test2Rows.slice(0, 8) };
  });

  await runCheck('elections.mode-coverage', async () => {
    await loadMainDail2024(mainPage);
    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');

    const modeEvidence = {};
    await clickElectionPaneControl(mainPage, /By Candidate/);
    await clickElectionPaneControl(test2Page, /By Candidate/);
    const [mainCandidate, test2Candidate] = await Promise.all([
      extractElectionPaneSnapshot(mainPage),
      extractElectionPaneSnapshot(test2Page)
    ]);
    assert(JSON.stringify(test2Candidate.headers.slice(0, 8)) === JSON.stringify(mainCandidate.headers.slice(0, 8)), '/test2 overall candidate pane headers differ from main');
    assert(JSON.stringify(test2Candidate.rows.slice(0, 5).map((row) => row.slice(0, 6))) === JSON.stringify(mainCandidate.rows.slice(0, 5).map((row) => row.slice(0, 6))), '/test2 overall candidate pane first rows differ from main');
    modeEvidence.candidate = { main: mainCandidate, test2: test2Candidate };

    await loadMainDail2024(mainPage);
    await selectMainRoscommonGalway(mainPage);
    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&electionSelected=roscommon-galway&electionView=party&lng=-8.12&lat=53.48&zoom=7.00');

    modeEvidence.party = await extractElectionPaneSnapshot(test2Page);
    assert(/Roscommon Galway/i.test(modeEvidence.party.title), `/test2 selected party pane title mismatch: ${modeEvidence.party.title}`);
    assert(modeEvidence.party.headers.some((header) => /\bParty\b/i.test(header)), '/test2 selected party pane missing Party header');
    assert(modeEvidence.party.hasSortButtons, '/test2 selected party pane missing main-style sort/filter buttons');

    await clickElectionPaneControl(mainPage, /By Count/);
    await clickElectionPaneControl(test2Page, /By Count/);
    const [mainCount, test2Count] = await Promise.all([
      extractElectionPaneSnapshot(mainPage),
      extractElectionPaneSnapshot(test2Page)
    ]);
    assert(JSON.stringify(test2Count.headers.slice(0, 8)) === JSON.stringify(mainCount.headers.slice(0, 8)), '/test2 selected count pane headers differ from main');
    assert(JSON.stringify(test2Count.rows.slice(0, 5).map((row) => row.slice(0, 6))) === JSON.stringify(mainCount.rows.slice(0, 5).map((row) => row.slice(0, 6))), '/test2 selected count pane first rows differ from main');
    modeEvidence.count = { main: mainCount, test2: test2Count };

    await clickElectionPaneControl(mainPage, /Transfers/);
    await clickElectionPaneControl(test2Page, /Transfers/);
    const [mainTransfers, test2Transfers] = await Promise.all([
      extractElectionPaneSnapshot(mainPage, { waitForTable: false }),
      extractElectionPaneSnapshot(test2Page, { waitForTable: false })
    ]);
    assert(test2Transfers.hasTransferScaffold, `/test2 transfer pane missing transfer/animation scaffold; text="${test2Transfers.text}" controls="${test2Transfers.controlTexts.join(' | ')}"`);
    assert(test2Transfers.hasAnimationContainer || /No transfer animation data|Loading transfer animation|Stages|Made Quota|Non-transferable|Electorate/i.test(test2Transfers.text), '/test2 transfer pane did not expose main-style transfer state');
    modeEvidence.transfers = { main: mainTransfers, test2: test2Transfers };

    await bootTest2(test2Page, '#layers=election-house-of-commons-of-the-united-kingdom-2024-07-04&lng=-6.8&lat=54.6&zoom=7.00');
    const westminster = await extractElectionPaneSnapshot(test2Page);
    assert(/Westminster|House of Commons/i.test(westminster.text + westminster.title), '/test2 representative non-Dail election did not load the expected pane');
    assert(westminster.rows.length > 0 || /constituencies/i.test(westminster.text), '/test2 representative non-Dail election pane has no result evidence');
    modeEvidence.nonDail = westminster;

    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&electionSelected=roscommon-galway&electionView=party&lng=-8.12&lat=53.48&zoom=7.00');
    const entityState = await test2Page.evaluate(() => {
      const link = document.querySelector('#electionPaneContent [data-election-entity]');
      if (!link) return { hasEntityLink: false };
      link.click();
      return {
        hasEntityLink: true,
        entityKind: link.getAttribute('data-election-entity'),
        hashAfterClick: location.hash
      };
    });
    await test2Page.waitForTimeout(200);
    const entitySnapshot = await extractElectionPaneSnapshot(test2Page, { waitForTable: false });
    assert(entityState.hasEntityLink, '/test2 selected election pane has no entity links');
    assert(/electionEntityKind=/.test(entityState.hashAfterClick) || /Party Information|Candidate Information/i.test(entitySnapshot.text), '/test2 election entity link did not preserve entity route state');
    modeEvidence.entity = { entityState, entitySnapshot };
    return modeEvidence;
  });

  await runCheck('elections.map-overlays', async () => {
    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00');
    const state = await test2Page.evaluate(() => ({
      seatCircles: document.querySelectorAll('.test2-election-seat-circle .seat-dot').length,
      renderer: document.querySelector('[data-election-renderer]')?.getAttribute('data-election-renderer') || '',
      labels: document.querySelectorAll('.maplibre-dom-label').length,
      layers: (window.__civgraphTest2.mapController.map.getStyle().layers || []).filter((layer) => /election/.test(layer.id)).map((layer) => layer.id)
    }));
    assert(state.seatCircles > 20, `/test2 election seat circles missing or too few: ${state.seatCircles}`);
    assert(state.renderer === 'test2-main-pane-contract', `/test2 election pane renderer mismatch: ${state.renderer}`);
    assert(state.labels === 0, `/test2 should suppress ordinary feature labels for election layers: ${state.labels}`);
    return state;
  });

  await runCheck('timeline', async () => {
    const state = await extractTimeline(test2Page);
    const text = [state.text, ...state.labels].join(' ');
    assert(/\b\d{2} [A-Z][a-z]{2} \d{4}\b/.test(text), `/test2 timeline does not expose DD MMM YYYY text: ${text}`);
    return state;
  });

  await runCheck('browse', async () => {
    const browsePage = await context.newPage();
    const state = await extractBrowseMapPage(browsePage);
    await browsePage.close();
    assert(/Administrative Areas/.test(state.title), `Browse title mismatch: ${state.title}`);
    assert(state.hasOpenMap, 'Browse page missing Open in interactive map action');
    assert(state.hasThumbnail, 'Browse page missing thumbnail media');
    assert(state.hasOverview, 'Browse page missing Overview section');
    assert(state.hasTechnicalDetails, 'Browse page missing technical details section');
    assert(state.detailsCollapsed, 'Browse technical details should be collapsed by default');
    return state;
  });

  await runCheck('browse.coverage', async () => {
    const browsePage = await context.newPage();
    const routes = [
      { hash: '#/maps', title: /Maps/i, minCards: 1 },
      { hash: '#/elections', title: /Elections/i, minCards: 1, action: 'election' },
      { hash: '#/features', title: /Features/i, minCards: 1 },
      { hash: '#/parties', title: /Parties|Labels/i, minCards: 1 },
      { hash: '#/persons', title: /Persons/i, minCards: 1 },
      { hash: '#/sources', title: /Sources|Books|Tables/i, minCards: 1 },
      { hash: '#/elections/dail-eireann__2024-11-29', title: /2024|Irish general|D.il/i, minCards: 0, action: 'electionDetail' },
      { hash: '#/sources/map-source-admin-areas-1924-04-01', title: /Administrative Areas|source/i, minCards: 0, detail: true }
    ];
    const evidence = [];
    for (const route of routes) {
      const state = await extractBrowseRoute(browsePage, route.hash);
      assert(route.title.test(state.title), `Browse route ${route.hash} title mismatch: ${state.title}`);
      assert(state.cards >= route.minCards, `Browse route ${route.hash} has too few cards/items: ${state.cards}`);
      if (route.action === 'election') assert(state.links.some((text) => /Open election layer/i.test(text)) || state.hasOpenElection, `Browse route ${route.hash} missing election action`);
      if (route.action === 'electionDetail') assert(state.hasOpenElection, `Browse election detail ${route.hash} missing Open election layer action`);
      if (route.detail) assert(state.hasTechnicalDetails && state.collapsedDetails > 0, `Browse detail ${route.hash} missing collapsed technical details`);
      evidence.push(state);
    }
    await browsePage.close();
    return { routes: evidence };
  });

  await runCheck('url.restore', async () => {
    await bootTest2(test2Page, '#layers=election-dil-ireann-2024-11-29&lng=-8.12&lat=53.48&zoom=7.00&hidden=settlements-2015');
    const state = await test2Page.evaluate(() => {
      const map = window.__civgraphTest2.mapController.map;
      const center = map.getCenter();
      return {
        path: location.pathname,
        hash: location.hash,
        lng: center.lng,
        lat: center.lat,
        zoom: map.getZoom(),
        activeElection: document.querySelector('#catalogueFlatView .flat-election-entry--active')?.textContent || ''
      };
    });
    assert(state.path === '/test2/', `/test2 URL restore left the route: ${state.path}`);
    assert(state.hash.includes('layers=election-dil-ireann-2024-11-29'), '/test2 URL restore lost active layer state');
    assert(Math.abs(state.lng - -8.12) < 0.8 && Math.abs(state.lat - 53.48) < 0.8, `/test2 viewport restore drifted: ${state.lng}, ${state.lat}`);
    assert(/29 Nov 2024/.test(state.activeElection), '/test2 active election catalogue row was not restored');
    return state;
  });

  await runCheck('mobile', async () => {
    const mobileContext = await browser.newContext({ ...devices['Pixel 5'] });
    const mobilePage = await mobileContext.newPage();
    const state = await extractMobileState(mobilePage);
    await mobileContext.close();
    assert(state.toggleInHeader, '/test2 mobile catalogue toggle is not in the navbar');
    assert(!state.toggleOverlapsZoom, '/test2 mobile catalogue toggle overlaps zoom controls');
    assert(!state.settingsOverlapsTimeline, '/test2 settings/accessibility control overlaps the timeline');
    return state;
  });

  await runCheck('mobile.landscape', async () => {
    const landscapeContext = await browser.newContext({ viewport: { width: 812, height: 390 }, isMobile: true, hasTouch: true });
    const landscapePage = await landscapeContext.newPage();
    const state = await extractMobileElectionState(landscapePage, { width: 812, height: 390 });
    await landscapeContext.close();
    assert(state.toggleInHeader, '/test2 landscape mobile catalogue toggle is not in the navbar');
    assert(!state.toggleOverlapsZoom, '/test2 landscape mobile catalogue toggle overlaps zoom controls');
    assert(state.timelineVisible, '/test2 landscape mobile election timeline is not visible');
    assert(state.paneVisible, '/test2 landscape mobile election pane is not visible');
    return state;
  });

  await runCheck('data.coverage', async () => {
    const state = extractDataCoverageState();
    assert(state.actionableRows.length === 0, `/test2 has actionable unconverted catalogue rows: ${JSON.stringify(state.actionableRows.slice(0, 5))}`);
    assert(state.townlands?.conversionStatus === 'convertedComposite', '/test2 all-Ireland Townlands is not recorded as a converted composite');
    assert(/ni-townlands/.test(state.townlands?.testLayerId || '') && /roi-townlands/.test(state.townlands?.testLayerId || ''), '/test2 all-Ireland Townlands composite does not include both NI and ROI child layers');
    assert(state.civilPlan?.conversionStatus === 'convertedAlias', '/test2 Civil Parishes legacy route is not recorded as a converted alias');
    assert(state.civilAlias?.aliasTargetLayerId === 'civil-parishes-vector-test', '/test2 Civil Parishes alias is missing from maps-test metadata');
    return state;
  });

  results.push({
    id: 'engine.internals',
    title: matrixById.get('engine.internals')?.title || 'Rendering-engine internals',
    classification: 'acceptable-engine-difference',
    status: 'reported-only',
    evidence: {
      note: 'Leaflet DOM/SVG internals and MapLibre canvas/source internals are expected to differ; visible UI behaviour remains the parity target.'
    }
  });

  await browser.close();
} finally {
  server.kill();
}

const summary = {
  generatedAt: new Date().toISOString(),
  matrixVersion: matrix.version,
  totals: {
    pass: results.filter((result) => result.status === 'pass').length,
    fail: results.filter((result) => result.status === 'fail').length,
    warn: results.filter((result) => result.status === 'warn').length,
    reportedOnly: results.filter((result) => result.status === 'reported-only').length
  },
  results
};

mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`);

for (const result of results) {
  const prefix = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : result.status === 'warn' ? 'WARN' : 'INFO';
  console.log(`${prefix}: ${result.id} (${result.classification})`);
  if (result.message) console.log(`  ${result.message}`);
}

if (summary.totals.fail) {
  console.error(`General /test2 parity audit failed: ${summary.totals.fail} required area(s) failed. Report: ${REPORT_PATH}`);
  process.exit(1);
}

console.log(`PASS: General /test2 parity audit completed. Report: ${REPORT_PATH}`);
