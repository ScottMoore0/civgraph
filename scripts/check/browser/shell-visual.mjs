#!/usr/bin/env node
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const PORT = 5052;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  stdio: 'ignore'
});

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

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#catalogueFlatView table');
  const main = await measure(page);

  await page.goto(`${BASE}/test2/`);
  await page.waitForFunction(() => window.__civgraphTest2?.metadataService?.layers?.length);
  await page.waitForSelector('#catalogueFlatView table tr');
  await page.waitForSelector('#map canvas');
  const test2 = await measure(page);
  await browser.close();

  const failures = [];
  if (Math.abs(main.headerHeight - test2.headerHeight) > 1) failures.push(`header height mismatch: main ${main.headerHeight}, test2 ${test2.headerHeight}`);
  if (Math.abs(main.infoWidth - test2.infoWidth) > 2) failures.push(`catalogue pane width mismatch: main ${main.infoWidth}, test2 ${test2.infoWidth}`);
  if (!test2.hasMainShell) failures.push('/test2 missing production shell classes');
  if (!test2.hasCatalogueRows) failures.push('/test2 catalogue rows missing');
  if (!test2.hasMapCanvas) failures.push('/test2 MapLibre canvas missing');

  if (failures.length) {
    console.error('Test2 Visual Shell Regression');
    failures.forEach((failure) => console.error(`- FAIL: ${failure}`));
    process.exit(1);
  }
  console.log(`PASS: /test2 shell matches main metrics. Header ${test2.headerHeight}px, catalogue ${test2.infoWidth}px.`);
} finally {
  server.kill();
}

async function measure(page) {
  return page.evaluate(() => {
    const header = document.querySelector('.app-header')?.getBoundingClientRect();
    const info = document.querySelector('.pane--info')?.getBoundingClientRect();
    return {
      headerHeight: Math.round(header?.height || 0),
      infoWidth: Math.round(info?.width || 0),
      hasMainShell: Boolean(document.querySelector('body.app-shell .app-main .pane--info + .split-drag + .pane--map')),
      hasCatalogueRows: document.querySelectorAll('#catalogueFlatView table tr').length > 10,
      hasMapCanvas: Boolean(document.querySelector('#map canvas'))
    };
  });
}
