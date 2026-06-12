#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.TEST2_PERF_PORT || 5053);
const BASE = `http://127.0.0.1:${PORT}`;
const MODE = (process.env.TEST2_PERF_MODE || 'fixture').toLowerCase();
const USE_CDN = MODE === 'cdn' || MODE === 'production';
const REPORT_PATH = process.env.TEST2_PERF_REPORT || 'app/build/mobile-performance-report.json';
const BUDGETS = {
  bootMs: Number(process.env.TEST2_PERF_BOOT_MS || 5000),
  fixtureLayerMs: Number(process.env.TEST2_PERF_FIXTURE_LAYER_MS || 2000),
  layerLoadMs: Number(process.env.TEST2_PERF_LAYER_MS || 12000),
  electionBundleMs: Number(process.env.TEST2_PERF_ELECTION_BUNDLE_MS || 5000),
  electionLoadMs: Number(process.env.TEST2_PERF_ELECTION_MS || 16000),
  hoverMs: Number(process.env.TEST2_PERF_HOVER_MS || 250),
  seatCircleMs: Number(process.env.TEST2_PERF_SEAT_CIRCLE_MS || 2500),
  heapBytes: Number(process.env.TEST2_PERF_HEAP_BYTES || 450 * 1024 * 1024),
  maxFailedTiles: Number(process.env.TEST2_PERF_MAX_FAILED_TILES || (USE_CDN ? 8 : 0))
};

const CDN_LAYER_SCENARIOS = [
  { label: 'Civil Parishes', ids: ['civil-parishes-vector-test'] },
  { label: 'Townlands', ids: ['antrim-townlands-vector-test', 'down-townlands-vector-test'] },
  { label: 'Small Areas', ids: ['roi-small-areas-2022-vector-test', 'roi-small-areas-2011-vector-test'] },
  { label: 'Counties', ids: ['counties-ireland-vector-test', 'counties-ireland-1957-vector-test'] }
];

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  stdio: 'ignore'
});

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['Pixel 5'] });
  const requestStats = { failedTiles: 0, pmtilesRequests: 0, fallbackTileRequests: 0 };

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('.pmtiles')) requestStats.pmtilesRequests += 1;
    if (url.includes('/test/tiles/generated/') || url.includes('.pbf')) requestStats.fallbackTileRequests += 1;
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (/\.(pmtiles|pbf)(?:[?#]|$)|\/tiles\//.test(url)) requestStats.failedTiles += 1;
  });
  page.on('response', (response) => {
    const url = response.url();
    if ((/\.(pmtiles|pbf)(?:[?#]|$)|\/tiles\//.test(url)) && response.status() >= 400) {
      requestStats.failedTiles += 1;
    }
  });

  await page.addInitScript((useCdn) => {
    window.__civgraphUseLocalTileFallback = !useCdn;
    window.__civgraphPerformanceSmoke = true;
  }, USE_CDN);

  const started = performance.now();
  await page.goto(`${BASE}/test2/`);
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const bootMs = Math.round(performance.now() - started);

  const result = await page.evaluate(async ({ budgets, cdnScenarios, useCdn }) => {
    const app = window.__civgraphTest2.app;
    const metadata = window.__civgraphTest2.metadataService;
    const controller = window.__civgraphTest2.mapController;
    const map = controller.map;
    const scenarios = [];

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const waitForIdle = (timeoutMs = 8000) => new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      map.once('idle', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });

    const countRenderedFor = (id) => {
      const layerIds = [
        `${id}-fill`,
        `${id}-line`,
        `${id}-circle`,
        `${id}-symbol`,
        `${id}-labels`
      ].filter((layerId) => map.getLayer(layerId));
      if (!layerIds.length) return 0;
      return map.queryRenderedFeatures({ layers: layerIds }).length;
    };

    const waitForRendered = async (id, timeoutMs = 8000) => {
      const deadline = performance.now() + timeoutMs;
      let count = countRenderedFor(id);
      while (count < 1 && performance.now() < deadline) {
        await wait(200);
        await waitForIdle(1000);
        await nextFrame();
        count = countRenderedFor(id);
      }
      return count;
    };

    const findLayer = (ids) => {
      for (const id of ids) {
        const layer = metadata.getLayer?.(id) || metadata.layers.find((candidate) => candidate.id === id);
        if (layer?.loadable) return layer;
      }
      return metadata.layers.find((candidate) => (
        candidate.loadable
        && ids.some((id) => `${candidate.id} ${candidate.sourceMapId || ''} ${candidate.name || ''}`.includes(id.replace('-vector-test', '')))
      ));
    };

    const runFixtureLayer = async () => {
      const id = 'test2-mobile-fixture';
      const sourceId = `${id}-source`;
      const started = performance.now();
      if (map.getLayer(`${id}-fill`)) map.removeLayer(`${id}-fill`);
      if (map.getLayer(`${id}-line`)) map.removeLayer(`${id}-line`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Mobile fixture north' },
              geometry: { type: 'Polygon', coordinates: [[[-9.8, 54.8], [-8.8, 54.8], [-8.8, 55.25], [-9.8, 55.25], [-9.8, 54.8]]] }
            },
            {
              type: 'Feature',
              properties: { name: 'Mobile fixture west' },
              geometry: { type: 'Polygon', coordinates: [[[-10.3, 52.5], [-9.2, 52.5], [-9.2, 53.1], [-10.3, 53.1], [-10.3, 52.5]]] }
            },
            {
              type: 'Feature',
              properties: { name: 'Mobile fixture east' },
              geometry: { type: 'Polygon', coordinates: [[[-7.2, 53.0], [-6.2, 53.0], [-6.2, 53.55], [-7.2, 53.55], [-7.2, 53.0]]] }
            }
          ]
        }
      });
      map.addLayer({
        id: `${id}-fill`,
        type: 'fill',
        source: sourceId,
        paint: { 'fill-color': '#88c1ff', 'fill-opacity': 0.35 }
      });
      map.addLayer({
        id: `${id}-line`,
        type: 'line',
        source: sourceId,
        paint: { 'line-color': '#143c6b', 'line-width': 1.5 }
      });
      map.fitBounds([[-10.6, 52.1], [-5.9, 55.45]], { duration: 0, padding: 18 });
      await waitForIdle(2000);
      await nextFrame();
      const durationMs = Math.round(performance.now() - started);
      const features = await waitForRendered(id, 1500);
      return { label: 'Offline vector fixture', mode: 'fixture', durationMs, features };
    };

    const runCdnLayer = async (scenario) => {
      const layer = findLayer(scenario.ids);
      if (!layer) return { label: scenario.label, mode: 'cdn', skipped: true, reason: 'no converted candidate' };
      const started = performance.now();
      await controller.loadLayer(layer.id, { fit: true });
      await waitForIdle(10000);
      await wait(350);
      const features = await waitForRendered(layer.id, 8000);
      const durationMs = Math.round(performance.now() - started);
      const hoverStarted = performance.now();
      map.fire('mousemove', {
        point: map.project(map.getCenter()),
        lngLat: map.getCenter(),
        originalEvent: new MouseEvent('mousemove')
      });
      await nextFrame();
      const hoverMs = Math.round(performance.now() - hoverStarted);
      controller.unloadLayer(layer.id);
      return { label: scenario.label, mode: 'cdn', layerId: layer.id, durationMs, features, hoverMs };
    };

    const runElectionScenario = async () => {
      const manager = await app.ensureElections({ refreshCatalogue: false });
      const entries = manager.catalogue?.elections || [];
      const dail = entries.find((entry) => entry.key === 'dail-eireann__2024-11-29');
      const local = entries.find((entry) => entry.key === 'local-government-local-government-districts__2023-05-18');
      const targets = [dail, local].filter(Boolean);
      const out = [];
      for (const entry of targets) {
        if (useCdn) {
          const started = performance.now();
          await manager.loadElection(entry.body, entry.date);
          await waitForIdle(12000);
          await wait(350);
          const overlay = manager.getSeatCircleOverlayState?.() || { groups: [], dotCount: 0 };
          out.push({
            label: entry.key === 'dail-eireann__2024-11-29' ? 'Dail election layer' : 'Local-government election layer',
            mode: 'cdn',
            election: entry.key,
            durationMs: Math.round(performance.now() - started),
            seatCircleMs: Number(manager.lastSeatCircleRenderMs || 0),
            seatGroups: overlay.groups?.length || 0,
            seatDots: overlay.dotCount || 0
          });
          manager.unloadElection({ unloadBackingLayer: true });
        } else {
          const started = performance.now();
          const bundle = await manager.loadBundle(entry);
          out.push({
            label: entry.key === 'dail-eireann__2024-11-29' ? 'Dail election bundle' : 'Local-government election bundle',
            mode: 'fixture',
            election: entry.key,
            durationMs: Math.round(performance.now() - started),
            results: bundle.results?.length || 0
          });
        }
      }
      return out;
    };

    if (useCdn) {
      for (const scenario of cdnScenarios) scenarios.push(await runCdnLayer(scenario));
    } else {
      scenarios.push(await runFixtureLayer());
    }
    scenarios.push(...await runElectionScenario());

    return {
      mode: useCdn ? 'cdn' : 'fixture',
      scenarios,
      canvas: { width: map.getCanvas().width, height: map.getCanvas().height },
      memory: performance.memory?.usedJSHeapSize || 0,
      serviceWorker: await app.getServiceWorkerStatus?.().catch((error) => ({
        available: false,
        reason: String(error?.message || error)
      })),
      budgets
    };
  }, { budgets: BUDGETS, cdnScenarios: CDN_LAYER_SCENARIOS, useCdn: USE_CDN });

  await browser.close();

  const failures = [];
  if (bootMs > BUDGETS.bootMs) failures.push(`mobile boot ${bootMs}ms > ${BUDGETS.bootMs}ms`);
  if (result.canvas.width < 100 || result.canvas.height < 100) failures.push('MapLibre canvas too small');
  if (result.memory && result.memory > BUDGETS.heapBytes) failures.push(`heap ${result.memory} bytes > ${BUDGETS.heapBytes} bytes`);
  if (requestStats.failedTiles > BUDGETS.maxFailedTiles) failures.push(`failed tile requests ${requestStats.failedTiles} > ${BUDGETS.maxFailedTiles}`);

  for (const scenario of result.scenarios) {
    if (scenario.skipped) continue;
    const layerBudget = scenario.mode === 'cdn' ? BUDGETS.layerLoadMs : BUDGETS.fixtureLayerMs;
    if (/election bundle/i.test(scenario.label) && scenario.durationMs > BUDGETS.electionBundleMs) {
      failures.push(`${scenario.label} ${scenario.durationMs}ms > ${BUDGETS.electionBundleMs}ms`);
    } else if (/election layer/i.test(scenario.label) && scenario.durationMs > BUDGETS.electionLoadMs) {
      failures.push(`${scenario.label} ${scenario.durationMs}ms > ${BUDGETS.electionLoadMs}ms`);
    } else if (!/election/i.test(scenario.label) && scenario.durationMs > layerBudget) {
      failures.push(`${scenario.label} ${scenario.durationMs}ms > ${layerBudget}ms`);
    }
    if (scenario.features !== undefined && scenario.features < 1) failures.push(`${scenario.label} produced no rendered features`);
    if (scenario.hoverMs !== undefined && scenario.hoverMs > BUDGETS.hoverMs) failures.push(`${scenario.label} hover ${scenario.hoverMs}ms > ${BUDGETS.hoverMs}ms`);
    if (scenario.seatCircleMs && scenario.seatCircleMs > BUDGETS.seatCircleMs) failures.push(`${scenario.label} seat circles ${scenario.seatCircleMs}ms > ${BUDGETS.seatCircleMs}ms`);
  }

  if (USE_CDN && requestStats.pmtilesRequests < 1) failures.push('CDN mode did not request any PMTiles archives');
  if (!USE_CDN && result.scenarios.every((scenario) => !scenario.features && !scenario.results)) {
    failures.push('fixture mode did not exercise any local rendering or bundle path');
  }

  writeReport({
    generatedAt: new Date().toISOString(),
    mode: result.mode,
    bootMs,
    canvas: result.canvas,
    memory: result.memory,
    serviceWorker: result.serviceWorker || null,
    requestStats,
    budgets: BUDGETS,
    scenarios: result.scenarios,
    failures
  });

  if (failures.length) {
    console.error('Test2 Mobile Performance Validation');
    console.error(`mode=${result.mode} boot=${bootMs}ms heap=${result.memory || 'n/a'} pmtiles=${requestStats.pmtilesRequests} fallbackTiles=${requestStats.fallbackTileRequests} failedTiles=${requestStats.failedTiles}`);
    result.scenarios.forEach((scenario) => console.error(`- ${scenario.label}: ${JSON.stringify(scenario)}`));
    failures.forEach((failure) => console.error(`- FAIL: ${failure}`));
    process.exit(1);
  }

  console.log(`PASS: /test2 mobile smoke mode=${result.mode} boot=${bootMs}ms heap=${result.memory || 'n/a'} pmtiles=${requestStats.pmtilesRequests} fallbackTiles=${requestStats.fallbackTileRequests} failedTiles=${requestStats.failedTiles}`);
  result.scenarios.forEach((scenario) => console.log(`- ${scenario.label}: ${JSON.stringify(scenario)}`));
} finally {
  server.kill();
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('local static server did not start');
}

function writeReport(report) {
  mkdirSync('app/build', { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}
