#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 5053;
const BASE = `http://127.0.0.1:${PORT}`;
const BUDGETS = {
  bootMs: 5000,
  layerLoadMs: 9000,
  heapBytes: 450 * 1024 * 1024
};

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  stdio: 'ignore'
});

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['Pixel 5'] });
  const started = performance.now();
  await page.goto(`${BASE}/test2/`);
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  const bootMs = Math.round(performance.now() - started);
  const loadStarted = performance.now();
  const result = await page.evaluate(async () => {
    const app = window.__civgraphTest2.app;
    const layer = window.__civgraphTest2.metadataService.getLayer('civil-parishes-vector-test');
    if (layer?.tilesFallback) {
      layer.sourceType = 'mvt';
      layer.tiles = layer.tilesFallback;
    }
    await app.loadMap('civil-parishes-by-province');
    await new Promise((resolve) => window.__civgraphTest2.mapController.map.once('idle', resolve));
    const map = window.__civgraphTest2.mapController.map;
    return {
      layers: [...window.__civgraphTest2.mapController.layerStates.keys()],
      canvas: { width: map.getCanvas().width, height: map.getCanvas().height },
      features: map.queryRenderedFeatures({
        layers: ['civil-parishes-vector-test-fill', 'civil-parishes-vector-test-line'].filter((id) => map.getLayer(id))
      }).length,
      memory: performance.memory?.usedJSHeapSize || 0
    };
  });
  const layerLoadMs = Math.round(performance.now() - loadStarted);
  await browser.close();

  const failures = [];
  if (bootMs > BUDGETS.bootMs) failures.push(`mobile boot ${bootMs}ms > ${BUDGETS.bootMs}ms`);
  if (layerLoadMs > BUDGETS.layerLoadMs) failures.push(`mobile layer load ${layerLoadMs}ms > ${BUDGETS.layerLoadMs}ms`);
  if (result.features < 1) failures.push('civil parishes produced no rendered features');
  if (result.canvas.width < 100 || result.canvas.height < 100) failures.push('MapLibre canvas too small');
  if (result.memory && result.memory > BUDGETS.heapBytes) failures.push(`heap ${result.memory} bytes > ${BUDGETS.heapBytes} bytes`);

  if (failures.length) {
    console.error('Test2 Mobile Performance Validation');
    failures.forEach((failure) => console.error(`- FAIL: ${failure}`));
    process.exit(1);
  }
  console.log(`PASS: /test2 mobile smoke. boot=${bootMs}ms layer=${layerLoadMs}ms features=${result.features} heap=${result.memory || 'n/a'}`);
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
