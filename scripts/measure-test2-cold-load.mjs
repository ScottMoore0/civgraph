#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const PORT = Number(process.env.TEST2_COLD_PORT || 5054);
const BASE = `http://127.0.0.1:${PORT}`;
const REPORT_PATH = process.env.TEST2_COLD_REPORT || 'test-results/test2-cold-load-report.json';
const BUDGETS = {
  shellReadyMs: Number(process.env.TEST2_COLD_SHELL_MS || 1800),
  runtimeReadyMs: Number(process.env.TEST2_COLD_RUNTIME_MS || 5500),
  initialJsBytes: Number(process.env.TEST2_COLD_INITIAL_JS_BYTES || 140 * 1024),
  initialCssBytes: Number(process.env.TEST2_COLD_INITIAL_CSS_BYTES || 340 * 1024)
};

const server = spawn('python', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });

try {
  await waitForServer();
  const browser = await chromium.launch();
  const scenarios = [
    { name: 'desktop', options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'mobile', options: { ...devices['Pixel 5'] } }
  ];
  const results = [];
  for (const scenario of scenarios) {
    const context = await browser.newContext(scenario.options);
    const page = await context.newPage();
    const started = Date.now();
    await page.goto(`${BASE}/test2/`, { waitUntil: 'domcontentloaded' });
    const shellReadyMs = Date.now() - started;
    await page.waitForFunction(() => window.__civgraphTest2?.runtimeReadyAt, null, { timeout: BUDGETS.runtimeReadyMs + 4000 }).catch(() => null);
    const runtimeReadyMs = Date.now() - started;
    const metrics = await page.evaluate(() => {
      const resources = performance.getEntriesByType('resource')
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          transferSize: entry.transferSize || 0,
          encodedBodySize: entry.encodedBodySize || 0,
          decodedBodySize: entry.decodedBodySize || 0,
          duration: Math.round(entry.duration || 0),
          startTime: Math.round(entry.startTime || 0)
        }));
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, Math.round(entry.startTime)]));
      return {
        navigation: nav ? {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize || 0,
          encodedBodySize: nav.encodedBodySize || 0
        } : null,
        civgraph: {
          runtimeImportStartedAt: Math.round(window.__civgraphTest2RuntimeImportStartedAt || 0),
          runtimeInitStartedAt: Math.round(window.__civgraphTest2?.runtimeInitStartedAt || 0),
          runtimeReadyAt: Math.round(window.__civgraphTest2?.runtimeReadyAt || 0)
        },
        paint,
        resources
      };
    });
    const splitAtMs = metrics.civgraph.runtimeImportStartedAt || shellReadyMs + 50;
    const initialResources = metrics.resources.filter((entry) => entry.startTime < splitAtMs);
    const runtimeResources = metrics.resources.filter((entry) => entry.startTime >= splitAtMs);
    const initialJsBytes = sumBytes(initialResources.filter((entry) => /\.js(?:[?#]|$)/.test(entry.name)));
    const initialCssBytes = sumBytes(initialResources.filter((entry) => /\.css(?:[?#]|$)/.test(entry.name)));
    const runtimeJsBytes = sumBytes(runtimeResources.filter((entry) => /\.js(?:[?#]|$)/.test(entry.name)));
    const runtimeCssBytes = sumBytes(runtimeResources.filter((entry) => /\.css(?:[?#]|$)/.test(entry.name)));
    results.push({
      name: scenario.name,
      shellReadyMs,
      runtimeReadyMs,
      initialJsBytes,
      initialCssBytes,
      runtimeJsBytes,
      runtimeCssBytes,
      splitAtMs,
      resourceCount: metrics.resources.length,
      largestResources: metrics.resources
        .slice()
        .sort((a, b) => (b.transferSize || b.encodedBodySize || 0) - (a.transferSize || a.encodedBodySize || 0))
        .slice(0, 16),
      metrics
    });
    await context.close();
  }
  await browser.close();

  const failures = [];
  for (const result of results) {
    if (result.shellReadyMs > BUDGETS.shellReadyMs) failures.push(`${result.name} shell ${result.shellReadyMs}ms > ${BUDGETS.shellReadyMs}ms`);
    if (result.runtimeReadyMs > BUDGETS.runtimeReadyMs) failures.push(`${result.name} runtime ${result.runtimeReadyMs}ms > ${BUDGETS.runtimeReadyMs}ms`);
    if (result.initialJsBytes > BUDGETS.initialJsBytes) failures.push(`${result.name} initial JS ${result.initialJsBytes} bytes > ${BUDGETS.initialJsBytes}`);
    if (result.initialCssBytes > BUDGETS.initialCssBytes) failures.push(`${result.name} initial CSS ${result.initialCssBytes} bytes > ${BUDGETS.initialCssBytes}`);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    budgets: BUDGETS,
    summary: failures.length ? 'Cold-load budget warnings present' : 'Cold-load budgets pass',
    failures,
    results
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log('Civgraph /test2 cold-load measurement');
  console.log(`- output: ${REPORT_PATH}`);
  for (const result of results) {
    console.log(`- ${result.name}: shell ${result.shellReadyMs}ms, runtime ${result.runtimeReadyMs}ms, initial JS ${formatBytes(result.initialJsBytes)}, initial CSS ${formatBytes(result.initialCssBytes)}, runtime JS ${formatBytes(result.runtimeJsBytes)}`);
  }
  if (process.argv.includes('--validate') && failures.length) {
    failures.forEach((failure) => console.error(`- WARN: ${failure}`));
    process.exit(1);
  }
} finally {
  server.kill();
}

function sumBytes(resources) {
  return resources.reduce((sum, entry) => sum + Number(entry.transferSize || entry.encodedBodySize || 0), 0);
}

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for local server on ${BASE}`);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes || 0);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
