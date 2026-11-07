#!/usr/bin/env node
/**
 * The production-parity browser specs, against the deployed site (npm run verify:browser).
 *
 * Opt-in and remote, like the rest of `npm run verify`: these load https://civgraph.net (or
 * PARITY_BASE_URL) in a browser, so they never run in `check`, `check:full` or CI. They ran
 * nightly in CI until 7 Nov 2026; CI now queries nothing in production (CHECKS.md).
 * --retries 2 absorbs the timing assertions that failed that nightly on 2 and 4 November 2026
 * (ux-plan-items.spec.js) without hiding a real break.
 *
 *   npm run verify:browser
 *   PARITY_BASE_URL=https://<preview>.pages.dev npm run verify:browser
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '@civgraph/config/node';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPECS = [
  'tests/browser/ux-plan-items.spec.js',
  'tests/browser/ux-t1-05-t1-03.spec.js',
  'tests/browser/catalogue-load-a11y.spec.js',
  'tests/browser/eds-1931-1936.spec.js',
];

const env = { ...process.env, PARITY_BASE_URL: process.env.PARITY_BASE_URL || SITE.origin };
console.log(`verify:browser against ${env.PARITY_BASE_URL}`);
const res = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/@playwright/test/cli.js'), 'test', '--retries', '2', ...SPECS, ...process.argv.slice(2)], { cwd: ROOT, env, stdio: 'inherit' });
process.exitCode = res.status ?? 1;
