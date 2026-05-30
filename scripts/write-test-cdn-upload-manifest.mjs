#!/usr/bin/env node
/**
 * Write a manifest of /test generated assets that need CDN/data-host upload.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const METADATA_PATH = resolve(ROOT, 'test/metadata/maps-test.json');
const OUTPUT_PATH = resolve(ROOT, 'test/metadata/cdn-upload-manifest.json');
const CDN_BASE = process.env.TEST_CDN_BASE || 'https://data.civgraph.net/data/maps/test';
const R2_PREFIX = process.env.TEST_R2_PREFIX || 'data/maps/test';

const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'));
const assets = [];

for (const layer of metadata.layers || []) {
  if (layer.loadable === false) continue;
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

function addAsset(layer, targetSuffix) {
  const configuredLocal = layer.tilePackage?.localPath || layer.tileUrl;
  const local = String(configuredLocal || '').replace(/^\//, '').replaceAll('\\', '/');
  const path = resolve(ROOT, local);
  assets.push({
    layerId: layer.id,
    kind: 'pmtiles',
    localPath: local,
    targetKey: `${R2_PREFIX}/${targetSuffix}`,
    cdnUrl: `${CDN_BASE}/${targetSuffix}`,
    bytes: existsSync(path) ? statSync(path).size : null,
    exists: existsSync(path)
  });
}
