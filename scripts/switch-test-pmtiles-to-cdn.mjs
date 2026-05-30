#!/usr/bin/env node
/**
 * Rewrite /test PMTiles metadata to use verified CDN URLs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const MANIFEST_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-range-report.json');
const UPLOAD_REPORT_PATH = resolve(ROOT, 'test/metadata/cdn-upload-report.json');

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const rangeReport = JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'));
const uploadReport = JSON.parse(readFileSync(UPLOAD_REPORT_PATH, 'utf8'));
const assetByLayer = new Map((manifest.assets || []).filter((asset) => asset.kind === 'pmtiles').map((asset) => [asset.layerId, asset]));
const mvtAssetByLayer = new Map((manifest.assets || []).filter((asset) => asset.kind === 'mvt-directory').map((asset) => [asset.layerId, asset]));
const verified = new Set((rangeReport.results || []).filter((result) => result.ok).map((result) => result.layerId));
const uploadedMvtDirectories = new Set((uploadReport.results || [])
  .filter((result) => result.ok && result.status === 'uploaded-directory')
  .map((result) => result.layerId));
let switched = 0;
let switchedMvtDirectories = 0;

const layers = (metadata.layers || []).map((layer) => {
  const asset = assetByLayer.get(layer.id);
  if (!asset || !verified.has(layer.id)) {
    const mvtAsset = mvtAssetByLayer.get(layer.id);
    if (!mvtAsset || !uploadedMvtDirectories.has(layer.id)) return layer;
    switchedMvtDirectories += 1;
    return {
      ...layer,
      tiles: mvtAsset.cdnUrlTemplate,
      tilePackage: {
        ...(layer.tilePackage || {}),
        preferred: true,
        serving: 'cdn-mvt-directory',
        cdnUrlTemplate: mvtAsset.cdnUrlTemplate,
        r2Prefix: mvtAsset.targetPrefix,
        localTilesUrl: layer.tiles
      }
    };
  }
  switched += 1;
  return {
    ...layer,
    sourceType: 'pmtiles',
    tileUrl: asset.cdnUrl,
    tilesFallback: layer.tilesFallback || layer.tiles || layer.tilePackage?.fallback || null,
    tilePackage: {
      ...(layer.tilePackage || {}),
      preferred: true,
      serving: 'cdn',
      cdnUrl: asset.cdnUrl,
      r2Key: asset.targetKey,
      localPath: asset.localPath,
      localUrl: (layer.tilePackage?.url || layer.tileUrl || '').startsWith('/test/')
        ? (layer.tilePackage?.url || layer.tileUrl)
        : `/test/pmtiles/generated/${layer.id}.pmtiles`,
      byteRangeVerifiedAt: rangeReport.generatedAt
    }
  };
});

writeFileSync(METADATA_PATH, `${JSON.stringify({ ...metadata, layers }, null, 2)}\n`);
console.log(`Switched ${switched} PMTiles layer(s) to CDN URLs.`);
console.log(`Switched ${switchedMvtDirectories} MVT director${switchedMvtDirectories === 1 ? 'y' : 'ies'} to CDN URL templates.`);
if (switched !== verified.size) {
  console.warn(`Verified ${verified.size} layer(s), switched ${switched}.`);
}
