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
import { assertKnownFlags } from '../lib/safe-artefact-write.mjs';
import { layerLifecycle, mvtDirectoryState, pmtilesLayerState } from './layer-lifecycle.mjs';

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
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const MANIFEST_PATH = resolve(ROOT, 'render/metadata/cdn-upload-manifest.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-range-report.json');
const UPLOAD_REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-upload-report.json');

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const rangeReport = JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'));
const uploadReport = JSON.parse(readFileSync(UPLOAD_REPORT_PATH, 'utf8'));
const assetByLayer = new Map((manifest.assets || []).filter((asset) => asset.kind === 'pmtiles').map((asset) => [asset.layerId, asset]));
const mvtAssetByLayer = new Map((manifest.assets || []).filter((asset) => asset.kind === 'mvt-directory').map((asset) => [asset.layerId, asset]));
const verified = new Set((rangeReport.results || []).filter((result) => result.ok).map((result) => result.layerId));
// Each layer's range result: an ok one for the manifest's URL when there is one, else any.
const rangeByLayer = new Map();
for (const result of rangeReport.results || []) {
  if (!result?.layerId) continue;
  const held = rangeByLayer.get(result.layerId);
  const asset = assetByLayer.get(result.layerId);
  const rank = (r) => (r?.ok ? 2 : 0) + (r?.ok && asset && r.cdnUrl === asset.cdnUrl ? 1 : 0);
  if (!held || rank(result) > rank(held)) rangeByLayer.set(result.layerId, result);
}
const uploadByLayer = new Map();
for (const result of uploadReport.results || []) {
  if (!result?.layerId) continue;
  const held = uploadByLayer.get(result.layerId);
  if (!held || (result.ok && result.status === 'uploaded-directory')) uploadByLayer.set(result.layerId, result);
}
let switched = 0;
let switchedMvtDirectories = 0;
/** Layers with a passing range check the lifecycle refused to switch, and why. */
const refused = [];

const layers = (metadata.layers || []).map((layer) => {
  if (ONLY_IDS.size && !ONLY_IDS.has(layer.id)) return layer;
  const asset = assetByLayer.get(layer.id);
  const range = rangeByLayer.get(layer.id);
  // Switching is the lifecycle's `-> serving` transition (layer-lifecycle.mjs): a PMTiles layer
  // needs a passing range check of the very URL it will serve.
  const pmtilesVerdict = asset
    ? layerLifecycle.check(pmtilesLayerState({ layer, asset, range }), 'serving', { kind: 'pmtiles', cdnUrl: asset.cdnUrl, checkedUrl: range?.cdnUrl })
    : null;
  if (asset && range?.ok && pmtilesVerdict && !pmtilesVerdict.ok) refused.push(`${layer.id}: ${pmtilesVerdict.reason}`);
  if (!pmtilesVerdict?.ok) {
    const mvtAsset = mvtAssetByLayer.get(layer.id);
    if (!mvtAsset) return layer;
    const upload = uploadByLayer.get(layer.id);
    const mvtVerdict = layerLifecycle.check(mvtDirectoryState({ upload }), 'serving', { kind: 'mvt-directory', uploadStatus: upload?.status });
    if (!mvtVerdict.ok) return layer;
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
      localUrl: (layer.tilePackage?.url || layer.tileUrl || '').startsWith('/render/')
        ? (layer.tilePackage?.url || layer.tileUrl)
        : `/render/pmtiles/generated/${layer.id}.pmtiles`,
      byteRangeVerifiedAt: rangeReport.generatedAt
    }
  };
});

writeFileSync(METADATA_PATH, `${JSON.stringify({ ...metadata, layers }, null, 2)}\n`);
if (ONLY_IDS.size) console.log(`Scoped to ${ONLY_IDS.size} layer id(s); every other layer left exactly as it was.`);
console.log(`Switched ${switched} PMTiles layer(s) to CDN URLs.`);
console.log(`Switched ${switchedMvtDirectories} MVT director${switchedMvtDirectories === 1 ? 'y' : 'ies'} to CDN URL templates.`);
if (refused.length) {
  console.warn(`Refused ${refused.length} layer(s) with a passing range check:`);
  for (const line of refused.slice(0, 20)) console.warn(`  ${line}`);
}
if (switched !== verified.size) {
  console.warn(`Verified ${verified.size} layer(s), switched ${switched}.`);
}
