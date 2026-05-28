#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createTestStaticServer } from './test-static-server.mjs';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.TEST_PERF_PORT || 4182);
const REPORT_PATH = resolve(ROOT, 'test/metadata/mobile-performance-report.json');
const MAX_BOOT_MS = Number(process.env.TEST_PERF_MAX_BOOT_MS || 6000);
const MIN_FRAME_RATE = Number(process.env.TEST_PERF_MIN_FPS || 24);
const TEST_LAYERS = (process.env.TEST_PERF_LAYER_IDS || 'civil-parishes-vector-test,roi-garda-regions-vector-test,roi-townlands-vector-test').split(',').filter(Boolean);

const server = createTestStaticServer(PORT, ROOT);
await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

let browser;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  budgets: { maxBootMs: MAX_BOOT_MS, minFrameRate: MIN_FRAME_RATE },
  layers: [],
  pass: false
};

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: report.viewport,
    deviceScaleFactor: report.viewport.deviceScaleFactor,
    isMobile: true,
    hasTouch: true
  });
  const started = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/test/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length, null, { timeout: 30000 });
  report.bootMs = Date.now() - started;
  for (const layerId of TEST_LAYERS) {
    report.layers.push(await page.evaluate(async (id) => {
      const app = window.__civgraphTest;
      const layer = app.metadataService.getLayer(id);
      const startedAt = performance.now();
      await app.controller.loadLayer(layer);
      await new Promise((resolve) => app.controller.map.once('idle', resolve));
      const frames = await new Promise((resolve) => {
        let count = 0;
        const begin = performance.now();
        const tick = () => {
          count += 1;
          if (performance.now() - begin >= 1000) resolve(count);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const rendered = app.controller.map.queryRenderedFeatures().length;
      const memory = performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize || null,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit || null
      } : null;
      app.controller.unloadLayer(id);
      return {
        layerId: id,
        sourceType: layer.sourceType,
        loadMs: Math.round(performance.now() - startedAt),
        frameRate: frames,
        renderedFeatures: rendered,
        memory
      };
    }, layerId));
  }
  report.pass = report.bootMs <= MAX_BOOT_MS
    && report.layers.every((layer) => layer.frameRate >= MIN_FRAME_RATE)
    && report.layers.every((layer) => layer.loadMs <= 8000);
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
console.log(`Boot: ${report.bootMs}ms`);
for (const layer of report.layers) console.log(`- ${layer.layerId}: ${layer.loadMs}ms, ${layer.frameRate}fps, rendered ${layer.renderedFeatures}`);
if (!report.pass) process.exit(1);
