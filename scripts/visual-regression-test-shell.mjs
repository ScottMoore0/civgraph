#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createTestStaticServer } from './test-static-server.mjs';

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.TEST_VISUAL_PORT || 4181);
const OUT_DIR = resolve(ROOT, 'test/metadata/visual-snapshots');
const REPORT_PATH = resolve(ROOT, 'test/metadata/visual-regression-report.json');
const MAX_HEADER_HEIGHT_DELTA = Number(process.env.TEST_VISUAL_MAX_HEADER_DELTA || 12);
const MAX_SIDEBAR_WIDTH_DELTA = Number(process.env.TEST_VISUAL_MAX_SIDEBAR_DELTA || 24);
mkdirSync(OUT_DIR, { recursive: true });

const server = createTestStaticServer(PORT, ROOT);
await new Promise((resolveListen) => server.listen(PORT, '127.0.0.1', resolveListen));

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  viewport: { width: 1366, height: 768 },
  checks: [],
  screenshots: {},
  pass: false
};

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: report.viewport });
  const main = await inspectShell(page, `http://127.0.0.1:${PORT}/`, 'main');
  const test = await inspectShell(page, `http://127.0.0.1:${PORT}/test/`, 'test');
  report.main = main.metrics;
  report.test = test.metrics;
  report.screenshots = { main: main.screenshot, test: test.screenshot };
  addCheck('main header visible', Boolean(main.metrics.header), main.metrics.header ? 'Main header detected.' : 'Main header was not detected.');
  addCheck('test header visible', Boolean(test.metrics.header), test.metrics.header ? 'Test header detected.' : 'Test header was not detected.');
  addCheck(
    'header height parity',
    main.metrics.header && test.metrics.header && Math.abs(main.metrics.header.height - test.metrics.header.height) <= MAX_HEADER_HEIGHT_DELTA,
    main.metrics.header && test.metrics.header
      ? `Main ${main.metrics.header.height}px, test ${test.metrics.header.height}px.`
      : 'Header comparison unavailable.'
  );
  addCheck('test catalogue visible', Boolean(test.metrics.sidebar), test.metrics.sidebar ? `Catalogue width ${test.metrics.sidebar.width}px.` : 'Test catalogue/sidebar missing.');
  addCheck('test map visible', Boolean(test.metrics.map), test.metrics.map ? `Map ${test.metrics.map.width}x${test.metrics.map.height}px.` : 'Test map missing.');
  addCheck(
    'catalogue width parity',
    main.metrics.sidebar && test.metrics.sidebar && Math.abs(main.metrics.sidebar.width - test.metrics.sidebar.width) <= MAX_SIDEBAR_WIDTH_DELTA,
    main.metrics.sidebar && test.metrics.sidebar
      ? `Main ${main.metrics.sidebar.width}px, test ${test.metrics.sidebar.width}px.`
      : 'Catalogue width comparison unavailable.'
  );
  addCheck(
    'test uses main pane structure',
    Boolean(test.metrics.mainPane && test.metrics.infoPane && test.metrics.mapPane),
    test.metrics.mainPane && test.metrics.infoPane && test.metrics.mapPane
      ? 'Main app/pane structure detected.'
      : 'Missing .app-main, .pane--info, or .pane--map.'
  );
  addCheck(
    'test has no product header above catalogue',
    !test.metrics.testProductHeader,
    test.metrics.testProductHeader ? 'Found /test product header.' : 'No /test product header detected.'
  );
  addCheck(
    'test default catalogue is compact table',
    Boolean(test.metrics.compactRows),
    test.metrics.compactRows ? `${test.metrics.compactRows} compact catalogue rows detected.` : 'No compact catalogue rows detected.'
  );
  report.pass = report.checks.every((check) => check.ok);
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
for (const check of report.checks) console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
if (!report.pass) process.exit(1);

async function inspectShell(page, url, name) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (name === 'test') await page.waitForFunction(() => window.__civgraphTest?.metadataService?.layers?.length, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const screenshot = `test/metadata/visual-snapshots/${name}-shell.png`;
  await page.screenshot({ path: resolve(ROOT, screenshot), fullPage: false });
  const metrics = await page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        background: style.backgroundColor,
        color: style.color
      };
    };
    return {
      header: box('.app-header, .test-app-header, header'),
      brand: box('.app-header__brand, .brand, header a'),
      sidebar: box('#testSidebar, #sidebar, .sidebar, aside'),
      map: box('#map, .map, .leaflet-container, .test-map'),
      mainPane: box('.app-main'),
      infoPane: box('.pane--info'),
      mapPane: box('.pane--map'),
      testProductHeader: Boolean(document.querySelector('.test-header')),
      compactRows: document.querySelectorAll('.catalogue-flat__toc-table .catalogue-flat__toc-row').length,
      filterContainers: document.querySelectorAll('.category-pills-container, .provider-pills-container').length
    };
  });
  return { metrics, screenshot };
}

function addCheck(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
}
