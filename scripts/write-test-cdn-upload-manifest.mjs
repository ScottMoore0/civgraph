#!/usr/bin/env node
/**
 * Write a manifest of /test generated assets that need CDN/data-host upload.
 *
 * `remoteVerified` MARKS AN ARCHIVE THAT EXISTS ONLY IN R2 -- built once, uploaded, and
 * since deleted locally. It is the only record that the bytes are up there, so losing
 * it makes a published layer look unpublished.
 *
 * It was being recomputed from scratch on every run, from cdn-range-report.json alone.
 * On 2026-08-19 a scoped verify run truncated that report to five rows and this script
 * dutifully cleared the flag for 8 layers whose archives were fine. The verify tool is
 * fixed, but the shape of the fault was this script trusting one input to be complete;
 * a prior `remoteVerified` is now carried forward when the report has nothing to say
 * about a layer, so a partial input can no longer erase a positive result.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertKnownFlags } from './lib/safe-artefact-write.mjs';

assertKnownFlags([]);

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const OUTPUT_PATH = resolve(ROOT, 'render/metadata/cdn-upload-manifest.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-range-report.json');
const CDN_BASE = process.env.TEST_CDN_BASE || 'https://data.civgraph.net/data/maps/test';
const R2_PREFIX = process.env.TEST_R2_PREFIX || 'data/maps/test';

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const rangeReport = existsSync(RANGE_REPORT_PATH)
  ? JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'))
  : { results: [] };
const verifiedRemoteAssets = new Map(
  (rangeReport.results || [])
    .filter((item) => item?.ok && item.layerId)
    .map((item) => [item.layerId, item])
);
// What the last manifest already knew. Read for `remoteVerified` only: everything else
// here is derived from the metadata and the filesystem, which are authoritative.
const priorRemoteVerified = new Map(
  (existsSync(OUTPUT_PATH)
    ? (JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')).assets || [])
    : []
  )
    .filter((asset) => asset?.kind === 'pmtiles' && asset.remoteVerified && asset.layerId)
    .map((asset) => [asset.layerId, asset])
);

const assets = [];
let carriedForward = 0;

for (const layer of metadata.layers || []) {
  if (layer.loadable === false) continue;
  if (layer.aliasOf) continue;
  if (layer.sourceType === 'pmtiles' && layer.tileUrl) {
    addAsset(layer, `pmtiles/generated/${layer.id}.pmtiles`);
  } else if (layer.tilePackage?.localPath) {
    addAsset(layer, `pmtiles/generated/${layer.id}.pmtiles`);
  }
  if (layer.sourceType === 'mvt' && layer.tiles && !layer.tilePackage?.localPath) {
    const root = layer.tiles.replace('/{z}/{x}/{y}.pbf', '').replace(/^\//, '');
    assets.push({
      layerId: layer.id,
      kind: 'mvt-directory',
      localPath: root,
      targetPrefix: `${R2_PREFIX}/${root.replace(/^test\//, '')}`,
      cdnUrlTemplate: `${CDN_BASE}/${root.replace(/^test\//, '')}/{z}/{x}/{y}.pbf`,
      exists: existsSync(resolve(ROOT, root))
    });
  }
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  cdnBase: CDN_BASE,
  r2Prefix: R2_PREFIX,
  assets,
  commands: assets
    .filter((asset) => asset.kind === 'pmtiles' && asset.exists)
    .map((asset) => `npx wrangler r2 object put boundaries-data/${asset.targetKey} --file ${asset.localPath} --remote --content-type application/octet-stream`)
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
console.log(`Assets: ${assets.length}`);
if (carriedForward) {
  console.log(`Carried forward remoteVerified for ${carriedForward} layer(s) the range report did not cover.`);
}

function addAsset(layer, targetSuffix) {
  const configuredLocal = layer.tilePackage?.localPath || layer.tileUrl;
  const local = String(configuredLocal || '').replace(/^\//, '').replaceAll('\\', '/');
  const path = resolve(ROOT, local);
  const exists = existsSync(path);
  const remote = verifiedRemoteAssets.get(layer.id);
  const remoteBytes = parseContentRangeTotal(remote?.contentRange);
  const prior = priorRemoteVerified.get(layer.id);
  // Verified by THIS report, or -- when the report is silent about this layer -- still
  // verified by an earlier one. Absence of evidence is not evidence of absence, and a
  // range report can be silent simply because the run was scoped.
  const verifiedNow = !exists && Number.isFinite(remoteBytes);
  const verified = verifiedNow || (!exists && Boolean(prior));
  assets.push({
    layerId: layer.id,
    kind: 'pmtiles',
    localPath: local,
    targetKey: `${R2_PREFIX}/${targetSuffix}`,
    cdnUrl: `${CDN_BASE}/${targetSuffix}`,
    bytes: exists ? statSync(path).size : (remoteBytes ?? prior?.bytes ?? null),
    exists,
    remoteVerified: verified ? true : undefined,
    remoteVerifiedAt: verifiedNow ? remote?.checkedAt : (verified ? prior?.remoteVerifiedAt : undefined)
  });
  if (verified && !verifiedNow) carriedForward += 1;
}

function parseContentRangeTotal(value) {
  const match = String(value || '').match(/\/(\d+)$/);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : null;
}
