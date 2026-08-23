/**
 * Which origin a spec measures.
 *
 * Six specs used to hardcode `process.env.PARITY_BASE_URL || 'https://civgraph.net'`,
 * while playwright.config.js pointed `baseURL` at the local server. So a single
 * `npx playwright test` run silently split in two: most specs tested the working tree,
 * and those six tested the deployed site.
 *
 * That is the wrong default in both directions. A green local run said nothing about
 * local changes in those six, and a broken deployment failed a developer's local run for
 * reasons unrelated to their edit.
 *
 * Local is now the default, because a test run should measure the code you have. Testing
 * production is a deliberate act: set PARITY_BASE_URL, which CI does in its own job.
 *
 *   npx playwright test                                    # local
 *   PARITY_BASE_URL=https://civgraph.net npx playwright test tests/browser/ux-plan-items.spec.js
 */
const LOCAL = 'http://127.0.0.1:5050';

const BASE = process.env.PARITY_BASE_URL || LOCAL;
const IS_PRODUCTION = BASE !== LOCAL;

module.exports = { BASE, LOCAL, IS_PRODUCTION };
