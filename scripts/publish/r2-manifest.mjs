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
import { assertKnownFlags, mergeArtefactRecords } from '../../packages/maps-pipeline/src/safe-artefact-write.mjs';
import { pmtilesTargetSuffix } from './pmtiles-keys.mjs';
import { contentRangeTotal } from './layer-lifecycle.mjs';
import { SITE } from '../../packages/config/src/node.mjs';

assertKnownFlags([]);

/**
 * A PMTiles archive in render/metadata/cdn-upload-manifest.json `assets`.
 * @typedef {object} PmtilesAsset
 * @property {string} layerId
 * @property {'pmtiles'} kind
 * @property {string} localPath             repository-relative
 * @property {boolean} exists               the local archive is on disk
 * @property {string} targetKey             the R2 key
 * @property {string} cdnUrl
 * @property {number | null} bytes          null when neither on disk nor verified remotely
 * @property {true} [remoteVerified]        the archive exists only in R2 (see the header)
 * @property {string} [remoteVerifiedAt]
 */
/**
 * A directory of MVT tiles in the manifest's `assets`.
 * @typedef {object} MvtDirectoryAsset
 * @property {string} layerId
 * @property {'mvt-directory'} kind
 * @property {string} localPath             repository-relative
 * @property {boolean} exists               the local directory is on disk
 * @property {string} targetPrefix          the R2 prefix of the tiles
 * @property {string} cdnUrlTemplate
 */
/**
 * One entry of render/metadata/cdn-upload-manifest.json `assets`: written here, read by
 * r2-upload-pmtiles.mjs, verify-pmtiles-cdn.mjs, verify-pmtiles-cdn-urls.mjs and
 * switch-pmtiles-to-cdn.mjs.
 * @typedef {PmtilesAsset | MvtDirectoryAsset} CdnUploadAsset
 */
/** @typedef {import('../../packages/types/index.js').LayerEntry & import('./pmtiles-keys.mjs').PmtilesLayer} ManifestLayer */

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'render/metadata/maps-test.json');
const OUTPUT_PATH = resolve(ROOT, 'render/metadata/cdn-upload-manifest.json');
const RANGE_REPORT_PATH = resolve(ROOT, 'render/metadata/cdn-range-report.json');
const CDN_BASE = process.env.TEST_CDN_BASE || `${SITE.dataOrigin}/data/maps/test`;
const R2_PREFIX = process.env.TEST_R2_PREFIX || 'data/maps/test';

/** @type {{ layers?: ManifestLayer[] }} */
const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
/** @type {{ results?: import('./verify-pmtiles-cdn.mjs').RangeCheck[] }} */
const rangeReport = existsSync(RANGE_REPORT_PATH)
  ? JSON.parse(readFileSync(RANGE_REPORT_PATH, 'utf8'))
  : { results: [] };
/** @type {Map<string, import('./verify-pmtiles-cdn.mjs').RangeCheck>} */
const verifiedRemoteAssets = new Map(
  (rangeReport.results || [])
    .filter((item) => item?.ok && item.layerId)
    .map((item) => [item.layerId, item])
);
// What the last manifest already knew. Read for `remoteVerified`, and for the R2 key of an
// archive that is neither on disk nor named by its layer (pmtiles-keys.mjs): everything else
// here is derived from the metadata and the filesystem, which are authoritative.
/** @type {Map<string, PmtilesAsset>} */
const priorPmtiles = new Map(
  /** @type {CdnUploadAsset[]} */ (existsSync(OUTPUT_PATH)
    ? (JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')).assets || [])
    : []
  )
    .filter((asset) => asset?.kind === 'pmtiles' && asset.layerId)
    .map((asset) => [asset.layerId, /** @type {PmtilesAsset} */ (asset)])
);
const priorRemoteVerified = new Map([...priorPmtiles].filter(([, asset]) => asset.remoteVerified));
/** @type {Record<string, number>} how many keys came from each KeySource */
const keySources = {};

/** @type {CdnUploadAsset[]} the pmtiles and mvt-directory entries */
const assets = [];
let carriedForward = 0;

for (const layer of metadata.layers || []) {
  if (layer.loadable === false) continue;
  if (layer.aliasOf) continue;
  if (layer.sourceType === 'pmtiles' && layer.tileUrl) {
    addAsset(layer);
  } else if (layer.tilePackage?.localPath) {
    addAsset(layer);
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
    .map((asset) => `npx wrangler r2 object put boundaries-data/${/** @type {PmtilesAsset} */ (asset).targetKey} --file ${asset.localPath} --remote --content-type application/octet-stream`)
};

// MERGE, DO NOT REPLACE.
//
// This is derived from the CURRENT metadata, so an archive still on disk that has
// dropped out of maps-test.json -- superseded by a clone alias, or made non-loadable --
// vanishes from the manifest entirely. check:test then reports "local PMTiles archive
// is not represented in CDN manifest" for a file that was represented yesterday, and
// the natural fix (revert the manifest) undoes whatever change prompted the
// regeneration. That loop cost two rounds on 2026-08-22.
//
// Same shape as the three tools fixed on 2026-08-20: a generator producing a subset and
// writing it as though it were the whole.
const mergedAssets = mergeArtefactRecords(OUTPUT_PATH, assets, { collection: 'assets', idKey: 'layerId' });
manifest.assets = mergedAssets.records;

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${OUTPUT_PATH.replace(`${ROOT}\\`, '').replaceAll('\\', '/')}`);
console.log(`Assets: ${manifest.assets.length} (${mergedAssets.kept} carried forward from earlier runs).`);
console.log(`PMTiles keys from: ${Object.entries(keySources).map(([source, n]) => `${source} ${n}`).join(', ') || 'none'}.`);
if (carriedForward) {
  console.log(`Carried forward remoteVerified for ${carriedForward} layer(s) the range report did not cover.`);
}

/**
 * @param {ManifestLayer} layer
 */
function addAsset(layer) {
  const configuredLocal = layer.tilePackage?.localPath || layer.tileUrl;
  const local = String(configuredLocal || '').replace(/^\//, '').replaceAll('\\', '/');
  const path = resolve(ROOT, local);
  const exists = existsSync(path);
  // The archive's existing key, never one rebuilt from the (renamed) layer id.
  const { suffix: targetSuffix, source } = pmtilesTargetSuffix(layer, {
    exists, r2Prefix: R2_PREFIX, cdnBase: CDN_BASE, prior: priorPmtiles.get(layer.id)
  });
  keySources[source] = (keySources[source] || 0) + 1;
  const remote = verifiedRemoteAssets.get(layer.id);
  const remoteBytes = contentRangeTotal(remote?.contentRange);
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
