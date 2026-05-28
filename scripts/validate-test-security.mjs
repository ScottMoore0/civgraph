#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const REPORT_PATH = resolve(ROOT, 'test/metadata/security-dependency-report.json');
const files = {
  index: readFileSync(resolve(ROOT, 'test/index.html'), 'utf8'),
  utils: readFileSync(resolve(ROOT, 'test/src/utils.js'), 'utf8'),
  telemetry: readFileSync(resolve(ROOT, 'test/src/telemetry.js'), 'utf8'),
  sourcePanel: readFileSync(resolve(ROOT, 'test/src/source-panel.js'), 'utf8'),
  activeLayers: readFileSync(resolve(ROOT, 'test/src/active-layers.js'), 'utf8')
};

const checks = [];
check('No third-party scripts in /test shell', !/<script[^>]+src=["']https?:\/\//i.test(files.index), 'The /test shell should not add third-party script execution.');
check('Service worker scoped to /test', /scope:\s*['"]\/test\/['"]/.test(files.index), 'Service worker registration must stay scoped before promotion.');
check('External support links use noopener noreferrer', !/target=["']_blank["'](?![^>]+rel=["'][^"']*noopener[^"']*noreferrer)/i.test(files.index), 'External links should not expose opener.');
check('Clipboard writes use guarded helper', files.sourcePanel.includes('copyText(') && files.activeLayers.includes('copyText('), 'Clipboard calls should go through copyText.');
check('Telemetry is sanitized and same-origin gated', files.telemetry.includes('sanitizeEvent') && files.telemetry.includes("sendBeacon('/_api/rum'") && /civgraph\\\.net|civgraph\.net/.test(files.telemetry), 'Runtime telemetry must be sanitized and same-origin.');
check('Diagnostics avoid raw secrets', !/token=|authorization|cookie/i.test(files.index), 'The static shell should not contain sensitive tokens.');

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  npmAuditDecision: 'npm audit currently reports dependency issues; do not run automated audit fix without reviewing transitive risk and native dependency compatibility.',
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
