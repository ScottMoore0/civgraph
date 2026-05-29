#!/usr/bin/env node
/**
 * Upload /test PMTiles archives from the CDN manifest to Cloudflare R2.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-upload-report.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-range-report.json');
const BUCKET = process.env.TEST_R2_BUCKET || 'boundaries-data';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_IDS = new Set([
  ...(process.env.TEST_UPLOAD_LAYER_IDS || '').split(','),
  ...readArgList('--ids')
].map((value) => value.trim()).filter(Boolean));
const IS_WINDOWS = platform() === 'win32';

if (process.argv.includes('--failed-range-report')) {
  if (!existsSync(RANGE_REPORT_PATH)) {
    console.error('No CDN range report found. Run `npm run verify:test:pmtiles-cdn` first.');
    process.exit(1);
  }
  const rangeReport = JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'));
  for (const item of rangeReport.results || []) {
    if (!item.ok && item.layerId) ONLY_IDS.add(item.layerId);
  }
  if (!ONLY_IDS.size) {
    console.log('No failed CDN range-report entries to upload.');
    process.exit(0);
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const assets = (manifest.assets || [])
  .filter((asset) => asset.kind === 'pmtiles')
  .filter((asset) => !ONLY_IDS.size || ONLY_IDS.has(asset.layerId));
const results = [];

if (!assets.length) {
  console.error(ONLY_IDS.size
    ? `No PMTiles assets matched: ${Array.from(ONLY_IDS).join(', ')}`
    : 'No PMTiles assets found in CDN upload manifest.');
  process.exit(1);
}

for (const [index, asset] of assets.entries()) {
  const filePath = resolve(ROOT, asset.localPath || '');
  if (!existsSync(filePath)) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: false, status: 'missing-local-file' });
    continue;
  }
  const bytes = statSync(filePath).size;
  console.log(`[${index + 1}/${assets.length}] ${asset.targetKey} (${formatBytes(bytes)})`);
  if (DRY_RUN) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: true, status: 'dry-run', bytes });
    continue;
  }
  try {
    const output = await runWrangler([
      'r2', 'object', 'put',
      `${BUCKET}/${asset.targetKey}`,
      '--file', filePath,
      '--remote',
      '--content-type', 'application/octet-stream'
    ]);
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: true, status: 'uploaded', bytes, output: output.slice(-1000) });
  } catch (err) {
    results.push({ layerId: asset.layerId, targetKey: asset.targetKey, ok: false, status: 'upload-failed', bytes, error: String(err.message).slice(0, 2000) });
  }
  writeReport();
}

const report = writeReport();
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
if (report.totals.failed) process.exit(1);

function writeReport() {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    bucket: BUCKET,
    dryRun: DRY_RUN,
    selectedIds: Array.from(ONLY_IDS),
    totals: {
      assets: assets.length,
      processed: results.length,
      ok: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      bytes: results.reduce((sum, item) => sum + Number(item.bytes || 0), 0)
    },
    results
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function runWrangler(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npx', ['wrangler', ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WINDOWS
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`wrangler exited ${code}: ${stderr || stdout}`));
    });
    child.on('error', rejectPromise);
  });
}

function formatBytes(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function readArgList(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === name && process.argv[index + 1]) {
      values.push(...process.argv[index + 1].split(','));
      index += 1;
    } else if (arg.startsWith(`${name}=`)) {
      values.push(...arg.slice(name.length + 1).split(','));
    }
  }
  return values;
}
