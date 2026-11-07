const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5050',
    // scripts/test-server.py is static: it has no Pages Functions, so /_api/elections, the map
    // app's default election transport, answers 404 and no election loads. The app's own opt-out
    // (localStorage civgraph.electionsApi = '0', src/map/election/transport.mjs useElectionsApi)
    // sends it to the bundle URLs instead, which production serves from D1 through the
    // compatibility Functions and the test server from the records build: the same documents.
    // The API itself is tested against the records database by records:check (tests/records/).
    // Only for this origin, so specs pointed at production (PARITY_BASE_URL) use the API.
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://127.0.0.1:5050', localStorage: [{ name: 'civgraph.electionsApi', value: '0' }] }],
    },
    browserName: 'chromium',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'python scripts/test-server.py 5050',
    url: 'http://127.0.0.1:5050',
    // Never silently reuse a server already on the port: one left by another checkout or
    // worktree serves that checkout's files, and the specs pass or fail against them (seen
    // 7 Nov 2026 with several worktrees open). Set PW_REUSE_SERVER=1 to reuse your own.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 30000
  }
});
