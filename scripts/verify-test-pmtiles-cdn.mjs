#!/usr/bin/env node
/**
 * Verify CDN byte-range serving for /test PMTiles archives.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-range-report.json');
const APPLY = process.argv.includes('--apply');
const ORIGIN = process.env.TEST_CDN_VERIFY_ORIGIN || 'https://civgraph.net';
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const assets = (manifest.assets || []).filter((asset) => asset.kind === 'pmtiles');
const results = [];

for (const [index, asset] of assets.entries()) {
  console.log(`[${index + 1}/${assets.length}] ${asset.cdnUrl}`);
  try {
    const response = await fetch(asset.cdnUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-15', Origin: ORIGIN },
      cache: 'no-store'
    });
    const body = new Uint8Array(await response.arrayBuffer());
    const headers = Object.fromEntries(response.headers.entries());
    const ok = response.status === 206
      && body.length === 16
      && /bytes/i.test(headers['accept-ranges'] || '')
      && /^bytes 0-15\//i.test(headers['content-range'] || '')
      && Number(headers['content-length']) === 16
      && (!headers['access-control-allow-origin'] || headers['access-control-allow-origin'] === ORIGIN || headers['access-control-allow-origin'] === '*');
    results.push({
      layerId: asset.layerId,
      cdnUrl: asset.cdnUrl,
      ok,
      status: response.status,
      bodyBytes: body.length,
      acceptRanges: headers['accept-ranges'] || null,
      contentLength: headers['content-length'] || null,
      contentRange: headers['content-range'] || null,
      accessControlAllowOrigin: headers['access-control-allow-origin'] || null,
      accessControlExposeHeaders: headers['access-control-expose-headers'] || null,
      cacheStatus: headers['cf-cache-status'] || null
    });
  } catch (err) {
    results.push({ layerId: asset.layerId, cdnUrl: asset.cdnUrl, ok: false, error: String(err.message).slice(0, 1000) });
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rangeRequest: 'bytes=0-15',
  origin: ORIGIN,
  totals: {
    assets: assets.length,
    ok: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length
  },
  results
};

writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${REPORT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
if (report.totals.failed) process.exit(1);

if (APPLY) {
  await import('./switch-test-pmtiles-to-cdn.mjs');
}
