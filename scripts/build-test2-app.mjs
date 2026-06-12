#!/usr/bin/env node
/**
 * Bundle the production main-shell + MapLibre adapter route.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APP_BASE = '/app';
const BUILD_DIR = 'app/build';
const ENTRY_JS = `${BUILD_DIR}/app.bundle.js`;
const ENTRY_CSS = `${BUILD_DIR}/app.bundle.css`;

mkdirSync(BUILD_DIR, { recursive: true });
for (const staleEntry of [
  'test2.bundle.js',
  'test2.bundle.css',
  'test2.bundle.js.map',
  'test2.bundle.css.map'
]) {
  rmSync(`${BUILD_DIR}/${staleEntry}`, { force: true });
}
rmSync(`${BUILD_DIR}/chunks`, { recursive: true, force: true });
const emitSourceMaps = process.env.TEST2_SOURCEMAPS === '1' || process.argv.includes('--sourcemap');

const result = await esbuild.build({
  entryPoints: ['app/src/boot.js'],
  bundle: true,
  minify: true,
  sourcemap: emitSourceMaps,
  format: 'esm',
  splitting: true,
  outdir: BUILD_DIR,
  entryNames: 'app.bundle',
  chunkNames: 'chunks/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  target: ['es2020'],
  logLevel: 'info',
  metafile: true,
  loader: {
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.woff2': 'file'
  }
});

if (result.errors.length) process.exit(1);

if (!emitSourceMaps) {
  for (const outputPath of outputFiles(BUILD_DIR)) {
    if (/\.map$/.test(outputPath)) rmSync(outputPath, { force: true });
  }
}

for (const outputPath of outputFiles(BUILD_DIR)) {
  if (!/\.(js|css|map)$/.test(outputPath)) continue;
  const content = readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, '');
  writeFileSync(outputPath, content);
}

const jsBytes = statSync(ENTRY_JS).size;
const cssBytes = existsSync(ENTRY_CSS)
  ? statSync(ENTRY_CSS).size
  : 0;
const jsVersion = contentHash(ENTRY_JS);
const cssVersion = existsSync(ENTRY_CSS)
  ? contentHash(ENTRY_CSS)
  : jsVersion;
copyAnimationRuntimeAssets();
updateHtmlVersions(jsVersion, cssVersion);
updateServiceWorkerVersion(jsVersion);

console.log(`MapLibre bundle: ${(jsBytes / 1024).toFixed(1)} KB`);
console.log(`MapLibre CSS: ${(cssBytes / 1024).toFixed(1)} KB`);
console.log(`MapLibre entry versions: js=${jsVersion} css=${cssVersion}`);
console.log(`MapLibre source maps: ${emitSourceMaps ? 'enabled' : 'disabled'}`);

function outputFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...outputFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function contentHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
}

function updateHtmlVersions(jsVersion, cssVersion) {
  const htmlPath = 'index.html';
  if (!existsSync(htmlPath)) return;
  const html = readFileSync(htmlPath, 'utf8')
    .replace(/\/(?:test2\/)?build\/test2\.bundle\.js\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.js?v=${jsVersion}`)
    .replace(/\/app\/build\/app\.bundle\.js\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.js?v=${jsVersion}`)
    .replace(/\/(?:test2\/)?build\/test2\.bundle\.css\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.css?v=${cssVersion}`)
    .replace(/\/app\/build\/app\.bundle\.css\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.css?v=${cssVersion}`);
  writeFileSync(htmlPath, html);
}

function updateServiceWorkerVersion(jsVersion) {
  const swPath = 'sw.js';
  if (!existsSync(swPath)) return;
  const nextVersion = `root-maplibre-sw-${jsVersion}`;
  const source = readFileSync(swPath, 'utf8');
  const nextSource = source.replace(/const VERSION = 'root-maplibre-sw-[^']+';/, `const VERSION = '${nextVersion}';`);
  if (nextSource === source && !source.includes(`const VERSION = '${nextVersion}';`)) {
    throw new Error('Could not update root service worker version');
  }
  writeFileSync(swPath, nextSource);
}

function copyAnimationRuntimeAssets() {
  const assets = [
    ['js/jquery-shim.js', 'app/js/jquery-shim.js'],
    ['election-viewer-package/js/stages2.js', 'app/election-viewer-package/js/stages2.js'],
    ['election-viewer-package/js/animation_preview.js', 'app/election-viewer-package/js/animation_preview.js'],
    ['election-viewer-package/js/animation_preview_manager.js', 'app/election-viewer-package/js/animation_preview_manager.js'],
    ['election-viewer-package/js/election_viewer.js', 'app/election-viewer-package/js/election_viewer.js'],
    ['election-viewer-package/css/stages.css', 'app/election-viewer-package/css/stages.css'],
    ['election-viewer-package/css/election-viewer.css', 'app/election-viewer-package/css/election-viewer.css']
  ];
  for (const [source, target] of assets) {
    if (!existsSync(source)) {
      throw new Error(`Missing election animation runtime source asset: ${source}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    const content = readFileSync(target, 'utf8').replace(/[ \t]+$/gm, '');
    writeFileSync(target, content);
  }
}
