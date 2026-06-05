#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.TEST2_PARITY_PORT || 5055);
const BASE = `http://127.0.0.1:${PORT}`;
const MATRIX_PATH = 'docs/test2-general-parity-matrix.json';
const REPORT_PATH = process.env.TEST2_PARITY_REPORT || 'test2/build/test2-general-parity-report.json';
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

function normalise(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

  await runCheck('elections.map-overlays', async () => {
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

  results.push({
    id: 'data.coverage',
    title: matrixById.get('data.coverage')?.title || 'Full catalogue data coverage',
    classification: 'blocked-on-data',
    status: 'reported-only',
    evidence: {
      note: 'Full catalogue coverage still depends on converted/loadable vector tiles or explicit not-yet-converted states for every main catalogue entry.'
    }
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
