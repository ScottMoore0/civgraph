#!/usr/bin/env node
/**
 * Rewrite /test PMTiles metadata to use verified CDN URLs.
 *
 * `--ids` IS NEW, AND ITS ABSENCE WAS THE BUG. On 2026-08-19 this was invoked with
 * `--ids <five layers>` to finish a scoped correction. It has never parsed argv, so the
 * flag was discarded in silence and all 809 verified layers were restamped, while the
 * operator believed five were in scope. Nothing failed; the damage was found later, by
 * hand. A flag that is ignored is worse than one that is rejected -- the caller asked
 * for less and got everything.
 *
 * Unrecognised flags now abort. That guard matters more than the scoping it protects:
 * it converts every future "this tool does not support that yet" from a silent
 * over-run into a refusal.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertKnownFlags } from './lib/safe-artefact-write.mjs';

assertKnownFlags(['--ids']);

/** Layers this run may touch. Empty means all, which stays the default. */
const IDS_AT = process.argv.indexOf('--ids');
const ONLY_IDS = new Set(
  IDS_AT === -1
    ? []
    : String(process.argv[IDS_AT + 1] || '').split(',').map((value) => value.trim()).filter(Boolean)
);
// `--ids` with nothing after it reads as "limit me", and silently meaning "everything"
// is the exact inversion this guard exists to stop.
if (IDS_AT !== -1 && !ONLY_IDS.size) {
  console.error('FAIL: --ids was given with no layer ids. Refusing to fall back to all layers.');
  process.exit(2);
}

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
  if (ONLY_IDS.size && !ONLY_IDS.has(layer.id)) return layer;
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
if (ONLY_IDS.size) console.log(`Scoped to ${ONLY_IDS.size} layer id(s); every other layer left exactly as it was.`);
console.log(`Switched ${switched} PMTiles layer(s) to CDN URLs.`);
console.log(`Switched ${switchedMvtDirectories} MVT director${switchedMvtDirectories === 1 ? 'y' : 'ies'} to CDN URL templates.`);
if (switched !== verified.size) {
  console.warn(`Verified ${verified.size} layer(s), switched ${switched}.`);
}
