const path = require('node:path');
const { defineConfig } = require('@playwright/test');

// In config/ since 8 Nov 2026: paths are from the repository root, one level up.
const ROOT = path.join(__dirname, '..');

module.exports = defineConfig({
  testDir: path.join(ROOT, 'tests', 'browser'),
  outputDir: path.join(ROOT, 'test-results'),
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5050',
    // scripts/dev/test-server.py serves the tree statically. It answers the records API
    // (/_api/parties, /_api/persons, /_api/elections ...) with the real Functions run against the
    // records build (packages/loader/src/local-api.mjs), but the map app's elections still load by
    // their bundle URLs here, as before: the app's own opt-out (localStorage
    // civgraph.electionsApi = '0', packages/map/src/election/transport.mjs useElectionsApi) sends it to the
    // bundle URLs, which production serves from D1 through the compatibility Functions and the
    // test server from the records build: the same documents. The API itself is tested against
    // the records database by records:check (tests/records/).
    // Only for this origin, so specs pointed at production (PARITY_BASE_URL) use the API.
    storageState: {
      cookies: [],
      // civgraph.basemap = osm-tiles: the raster base map, as before 11 Nov 2026. The default vector
      // base map (packages/map/src/renderer/basemap.mjs) is drawn by software GL here and costs
      // seconds a test; tests/browser/basemap.spec.cjs tests it on its own.
      origins: [{ origin: 'http://127.0.0.1:5050', localStorage: [{ name: 'civgraph.electionsApi', value: '0' }, { name: 'civgraph.basemap', value: 'osm-tiles' }] }],
    },
    browserName: 'chromium',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'python scripts/dev/test-server.py 5050',
    cwd: ROOT,
    url: 'http://127.0.0.1:5050',
    // Never silently reuse a server already on the port: one left by another checkout or
    // worktree serves that checkout's files, and the specs pass or fail against them (seen
    // 7 Nov 2026 with several worktrees open). Set PW_REUSE_SERVER=1 to reuse your own.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 30000
  }
});
