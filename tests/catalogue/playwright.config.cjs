// Browser tests for the rebuilt catalogue, against the local test site (tools/test-site/), which
// switches the rebuilt catalogue on. npx playwright test --config tests/catalogue/playwright.config.cjs
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.cjs$/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8790',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tools/test-site/server.mjs --port 8790 --catalogue next',
    url: 'http://127.0.0.1:8790/maps/',
    reuseExistingServer: true,
    timeout: 30000,
    cwd: require('node:path').join(__dirname, '..', '..'),
  },
});
