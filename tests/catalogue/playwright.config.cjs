// Browser tests for the rebuilt catalogue, against the local test site (tools/test-site/), which
// switches the rebuilt catalogue on. npx playwright test --config tests/catalogue/playwright.config.cjs
const { defineConfig } = require('@playwright/test');

// Port 4177: the data.civgraph.net CORS rules allow it (and 5050), not 8790. On 8790 every tile
// failed, which passed only while a layer whose data never arrived still read as loaded.
module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.cjs$/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tools/dev-site/server.mjs --port 4177 --catalogue next',
    url: 'http://127.0.0.1:4177/maps/',
    reuseExistingServer: true,
    timeout: 30000,
    cwd: require('node:path').join(__dirname, '..', '..'),
  },
});
