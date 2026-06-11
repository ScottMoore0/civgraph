#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeStableGeneratedJson } from './lib/stable-generated-json.mjs';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test-index.json');
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const REPORT_PATH = resolve(ROOT, 'test/metadata/test2-cdn-validation-report.json');
const NETWORK = process.argv.includes('--network') || process.env.TEST2_CDN_VALIDATE === '1';
const MAX_NETWORK_CHECKS = Number(process.env.TEST2_CDN_MAX_CHECKS || 24);

if (!existsSync(METADATA_PATH)) {
  console.error('test/metadata/maps-test-index.json is missing; run npm run build:test2:metadata');
  process.exit(1);
}

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;
const manifestAssets = new Map((manifest?.assets || [])
  .filter((asset) => asset.kind === 'pmtiles')
  .flatMap((asset) => [
    [`layer:${asset.layerId}`, asset],
    [`url:${asset.cdnUrl}`, asset],
    [`local:${normalize(asset.localPath)}`, asset]
  ]));
const errors = [];
const warnings = [];
const notes = [];
const layers = (metadata.layers || []).filter((layer) => layer.sourceType === 'pmtiles');
const uniqueUrls = new Map();

for (const layer of layers) {
  const url = String(layer.tileUrl || '');
  if (!url) {
    errors.push(`${layer.id}: PMTiles layer has no tileUrl`);
    continue;
  }
  if (!/^https:\/\/data\.civgraph\.net\/data\/maps\/test\/pmtiles\/generated\/.+\.pmtiles(?:[?#].*)?$/i.test(url)) {
    errors.push(`${layer.id}: PMTiles tileUrl is not a promoted data.civgraph.net PMTiles URL`);
  }
  uniqueUrls.set(url, layer.id);
  const localPath = normalize(layer.tilePackage?.localPath || `test/pmtiles/generated/${layer.sourceMapId || layer.id}.pmtiles`);
  const represented = manifestAssets.has(`layer:${layer.id}`)
    || manifestAssets.has(`url:${url}`)
    || manifestAssets.has(`local:${localPath}`);
  if (manifest && !represented) warnings.push(`${layer.id}: PMTiles URL is not directly represented in cdn-upload-manifest.json`);
  if (layer.tilesFallback?.startsWith('/test/tiles/')) {
    notes.push(`${layer.id}: directory MVT fallback retained for development/recovery`);
  }
  if (layer.tilePackage?.serving && layer.tilePackage.serving !== 'cdn') {
    warnings.push(`${layer.id}: tilePackage.serving is ${layer.tilePackage.serving}, expected cdn`);
  }
}

let networkResults = [];
if (NETWORK) {
  networkResults = await validateByteRanges([...uniqueUrls.keys()].slice(0, MAX_NETWORK_CHECKS));
  for (const result of networkResults) {
    if (!result.ok) errors.push(`${result.url}: ${result.reason}`);
  }
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  networkMode: NETWORK,
  totals: {
    pmtilesLayers: layers.length,
    uniqueUrls: uniqueUrls.size,
    errors: errors.length,
    warnings: warnings.length,
    notes: notes.length,
    networkChecked: networkResults.length
  },
  errors,
  warnings,
  notes,
  networkResults
};
writeStableGeneratedJson(REPORT_PATH, report);

console.log('Civgraph /test2 PMTiles/CDN Validation');
console.log(`- PMTiles layers: ${layers.length}`);
console.log(`- unique URLs: ${uniqueUrls.size}`);
console.log(`- errors: ${errors.length}`);
console.log(`- warnings: ${warnings.length}`);
console.log(`- network checks: ${networkResults.length}`);
if (warnings.length) warnings.slice(0, 20).forEach((warning) => console.log(`- WARN: ${warning}`));
if (errors.length) {
  errors.slice(0, 40).forEach((error) => console.error(`- FAIL: ${error}`));
  process.exit(1);
}
console.log('PASS: /test2 PMTiles/CDN metadata is valid.');

async function validateByteRanges(urls) {
  const results = [];
  for (const url of urls) {
    try {
      const head = await fetch(url, { method: 'HEAD' });
      const range = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      const acceptRanges = String(head.headers.get('accept-ranges') || range.headers.get('accept-ranges') || '').toLowerCase();
      const contentLength = Number(head.headers.get('content-length') || 0);
      const ok = head.ok
        && range.status === 206
        && acceptRanges.includes('bytes')
        && contentLength > 0;
      results.push({
        url,
        ok,
        headStatus: head.status,
        rangeStatus: range.status,
        acceptRanges,
        contentLength,
        contentType: head.headers.get('content-type') || range.headers.get('content-type') || '',
        cacheControl: head.headers.get('cache-control') || range.headers.get('cache-control') || '',
        reason: ok ? '' : `expected HEAD 2xx, 206 range, Accept-Ranges bytes, and Content-Length; got HEAD ${head.status}, range ${range.status}, Accept-Ranges ${acceptRanges || 'missing'}, length ${contentLength || 'missing'}`
      });
    } catch (error) {
      results.push({ url, ok: false, reason: String(error?.message || error) });
    }
  }
  return results;
}

function normalize(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
}
