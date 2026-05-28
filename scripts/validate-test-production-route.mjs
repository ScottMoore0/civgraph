#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const REPORT_PATH = resolve(ROOT, 'test/metadata/production-route-report.json');
const index = readFileSync(resolve(ROOT, 'test/index.html'), 'utf8');
const sw = readFileSync(resolve(ROOT, 'test/sw.js'), 'utf8');
const checks = [];

check('Scoped service worker before cutover', index.includes("scope: '/test/'"), 'Current test service worker must not claim the main route.');
check('Versioned bundle references', /test\.bundle\.js\?v=test-\d+/.test(index) && /test\.bundle\.css\?v=test-\d+/.test(index), 'Bundle URLs must be cache-busted.');
check('Rollback runbook exists', existsSync(resolve(ROOT, 'test/metadata/rollback-runbook.md')), 'Rollback steps must be documented before promotion.');
check('Cutover PR checklist exists', existsSync(resolve(ROOT, 'test/metadata/cutover-pr-checklist.md')), 'Promotion PR checklist must exist.');
check('CDN invalidation procedure exists', existsSync(resolve(ROOT, 'test/metadata/cdn-cache-invalidation-procedure.md')), 'PMTiles/cache invalidation must be documented.');
check('Service worker cache limits exist', /TEST_MAX_CACHE_BYTES/.test(sw) && /trimCacheBytes/.test(sw), 'Scoped service worker must include quota discipline.');
check('Pages/R2 separation documented', /Pages\/R2|Pages output|R2/i.test(readFileSync(resolve(ROOT, 'test/metadata/test-to-main-promotion-checklist.md'), 'utf8')), 'Promotion docs must distinguish Pages shell from R2 data.');

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  promotionMode: 'test-route-rehearsal',
  checks,
  pass: checks.every((item) => item.ok)
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
for (const item of checks) console.log(`- ${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`);
if (!report.pass) process.exit(1);

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
}
