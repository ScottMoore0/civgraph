// Browser tests for the interface-language preview (assets/i18n/i18n.js).
//   npx playwright test --config tests/i18n/playwright.config.cjs      (npm run test:i18n)
// Its own port, and never an already-running server: a server left on a shared port by another
// checkout would serve that checkout's files and the tests would pass or fail against them.
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.I18N_TEST_PORT || 4179);

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.cjs$/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `node tools/test-site/server.mjs --port ${PORT} --catalogue next`,
    url: `http://127.0.0.1:${PORT}/pages/about.html`,
    reuseExistingServer: false,
    timeout: 30000,
    cwd: path.join(__dirname, '..', '..'),
  },
});
