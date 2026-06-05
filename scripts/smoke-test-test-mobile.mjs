#!/usr/bin/env node
/**
 * Mobile-sized smoke test for /test converted MapLibre layers.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/mobile-smoke-report.json');
const PORT = Number(process.env.TEST_SMOKE_PORT || 4177);
const MAX_LAYER_MS = Number(process.env.TEST_SMOKE_MAX_LAYER_MS || 5000);
const DEFAULT_LAYER_IDS = [
  'civil-parishes-vector-test',
  'roi-garda-regions-vector-test',
  'roi-townlands-vector-test'
];
const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const requestedLayerIds = process.env.TEST_SMOKE_LAYER_IDS
  ? process.env.TEST_SMOKE_LAYER_IDS.split(',').map((item) => item.trim()).filter(Boolean)
  : (process.env.TEST_SMOKE_ALL === '1' ? null : DEFAULT_LAYER_IDS);
const candidateLayers = (metadata.layers || [])
  .filter((layer) => layer.loadable !== false && ['pmtiles', 'mvt'].includes(layer.sourceType))
  .filter((layer) => !requestedLayerIds || requestedLayerIds.includes(layer.id));
const MAX_TOTAL_MS = Number(process.env.TEST_SMOKE_MAX_TOTAL_MS || Math.max(60000, candidateLayers.length * 1800));

const server = createStaticServer();
await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

const consoleErrors = [];
const failedResponses = [];
const layerResults = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        status: response.status(),
        url: response.url()
      });
    }
  });
  await page.goto(`http://127.0.0.1:${PORT}/test/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length, null, { timeout: 30000 });

  const suiteStarted = Date.now();
  for (const [index, layer] of candidateLayers.entries()) {
    console.log(`[${index + 1}/${candidateLayers.length}] ${layer.id}`);
    const result = await page.evaluate(async ({ layerId, maxLayerMs }) => {
      const withTimeout = (promise, timeoutMs, status) => Promise.race([
        promise,
        new Promise((resolve) => {
          setTimeout(() => resolve({ timeout: true, status }), Math.max(1, timeoutMs));
        })
      ]);
      const app = window.__civgraphTest;
      const layerConfig = app.metadataService.getLayer(layerId);
      const started = performance.now();
      const loadStatus = await withTimeout(app.controller.loadLayer(layerConfig), maxLayerMs, 'load-timeout');
      if (loadStatus?.timeout) {
        return {
          layerId,
          sourceType: layerConfig.sourceType,
          durationMs: Math.round(performance.now() - started),
          controllerDurationMs: null,
          renderedFeatures: 0,
          activeLayers: app.controller.layers.size,
          status: loadStatus.status
        };
      }
      const idleStatus = await withTimeout(
        new Promise((resolve) => app.controller.map.once('idle', () => resolve({ status: 'idle' }))),
        Math.max(1000, maxLayerMs - Math.round(performance.now() - started)),
        'idle-timeout'
      );
      const rendered = app.controller.map.queryRenderedFeatures().length;
      const metric = app.controller.metrics.filter((item) => item.layerId === layerId && item.event === 'load').slice(-1)[0] || null;
      return {
        layerId,
        sourceType: layerConfig.sourceType,
        durationMs: Math.round(performance.now() - started),
        controllerDurationMs: metric?.durationMs ?? null,
        renderedFeatures: rendered,
        activeLayers: app.controller.layers.size,
        status: idleStatus?.status || 'loaded'
      };
    }, { layerId: layer.id, maxLayerMs: MAX_LAYER_MS });
    layerResults.push(result);
    await page.evaluate((layerId) => {
      window.__civgraphTest.controller.unloadLayer(layerId);
    }, layer.id);
  }
  var totalDurationMs = Date.now() - suiteStarted;
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  testedLayers: candidateLayers.map((layer) => layer.id),
  budgets: {
    maxLayerMs: MAX_LAYER_MS,
    maxTotalMs: MAX_TOTAL_MS
  },
  totalDurationMs: typeof totalDurationMs === 'number' ? totalDurationMs : null,
  layerResults,
  consoleErrors,
  failedResponses,
  pass: layerResults.length > 0
    && layerResults.every((result) => result.durationMs < MAX_LAYER_MS)
    && layerResults.every((result) => !String(result.status || '').includes('timeout'))
    && (typeof totalDurationMs !== 'number' || totalDurationMs < MAX_TOTAL_MS)
    && consoleErrors.length === 0
    && failedResponses.length === 0
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Mobile smoke tested ${layerResults.length} layer(s).`);
for (const result of layerResults) {
  console.log(`- ${result.layerId}: ${result.durationMs}ms, rendered ${result.renderedFeatures}, ${result.status || 'loaded'}`);
}
if (consoleErrors.length) {
  console.log('\nConsole errors:');
  for (const error of consoleErrors) console.log(`- ${error}`);
}
if (failedResponses.length) {
  console.log('\nFailed responses:');
  for (const response of failedResponses) console.log(`- ${response.status} ${response.url}`);
}
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
if (!report.pass) process.exit(1);

function createStaticServer() {
  return createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    path = decodeURIComponent(path).replace(/^\/+/, '');
    let filePath = resolve(ROOT, path);
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html');
    if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const buffer = readFileSync(filePath);
    const range = req.headers.range;
    const headers = {
      'content-type': contentType(filePath),
      'accept-ranges': 'bytes'
    };
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, headers);
        res.end();
        return;
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : buffer.length - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= buffer.length || end < start) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${buffer.length}` });
        res.end();
        return;
      }
      const safeEnd = Math.min(end, buffer.length - 1);
      res.writeHead(206, {
        ...headers,
        'content-length': safeEnd - start + 1,
        'content-range': `bytes ${start}-${safeEnd}/${buffer.length}`
      });
      res.end(buffer.subarray(start, safeEnd + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': buffer.length });
    res.end(buffer);
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.pbf')) return 'application/x-protobuf';
  if (filePath.endsWith('.pmtiles')) return 'application/octet-stream';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.html')) return 'text/html';
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extname(filePath).toLowerCase())) return `image/${extname(filePath).slice(1).replace('jpg', 'jpeg')}`;
  return 'application/octet-stream';
}
