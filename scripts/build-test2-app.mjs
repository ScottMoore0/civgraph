#!/usr/bin/env node
/**
 * Bundle the /test2 main-shell + MapLibre adapter route.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

mkdirSync('test2/build', { recursive: true });
rmSync('test2/build/chunks', { recursive: true, force: true });
const emitSourceMaps = process.env.TEST2_SOURCEMAPS === '1' || process.argv.includes('--sourcemap');

const result = await esbuild.build({
  entryPoints: ['test2/src/app.js'],
  bundle: true,
  minify: true,
  sourcemap: emitSourceMaps,
  format: 'esm',
  splitting: true,
  outdir: 'test2/build',
  entryNames: 'test2.bundle',
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
  for (const outputPath of outputFiles('test2/build')) {
    if (/\.map$/.test(outputPath)) rmSync(outputPath, { force: true });
  }
}

for (const outputPath of outputFiles('test2/build')) {
  if (!/\.(js|css|map)$/.test(outputPath)) continue;
  const content = readFileSync(outputPath, 'utf8').replace(/[ \t]+$/gm, '');
  writeFileSync(outputPath, content);
}

const jsBytes = statSync('test2/build/test2.bundle.js').size;
const cssBytes = existsSync('test2/build/test2.bundle.css')
  ? statSync('test2/build/test2.bundle.css').size
  : 0;
const jsVersion = contentHash('test2/build/test2.bundle.js');
const cssVersion = existsSync('test2/build/test2.bundle.css')
  ? contentHash('test2/build/test2.bundle.css')
  : jsVersion;
copyAnimationRuntimeAssets();
updateHtmlVersions(jsVersion, cssVersion);
updateServiceWorkerVersion(jsVersion);

console.log(`Test2 bundle: ${(jsBytes / 1024).toFixed(1)} KB`);
console.log(`Test2 CSS: ${(cssBytes / 1024).toFixed(1)} KB`);
console.log(`Test2 entry versions: js=${jsVersion} css=${cssVersion}`);
console.log(`Test2 source maps: ${emitSourceMaps ? 'enabled' : 'disabled'}`);

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
  const htmlPath = 'test2/index.html';
  if (!existsSync(htmlPath)) return;
  const html = readFileSync(htmlPath, 'utf8')
    .replace(/\/test2\/build\/test2\.bundle\.js\?v=[^"']+/g, `/test2/build/test2.bundle.js?v=${jsVersion}`)
    .replace(/\/test2\/build\/test2\.bundle\.css\?v=[^"']+/g, `/test2/build/test2.bundle.css?v=${cssVersion}`);
  writeFileSync(htmlPath, html);
}

function updateServiceWorkerVersion(jsVersion) {
  const swPath = 'test2/sw.js';
  if (!existsSync(swPath)) return;
  const nextVersion = `test2-sw-${jsVersion}`;
  const source = readFileSync(swPath, 'utf8');
  const nextSource = source.replace(/const VERSION = 'test2-sw-[^']+';/, `const VERSION = '${nextVersion}';`);
  if (nextSource === source && !source.includes(`const VERSION = '${nextVersion}';`)) {
    throw new Error('Could not update /test2 service worker version');
  }
  writeFileSync(swPath, nextSource);
}

function copyAnimationRuntimeAssets() {
  const assets = [
    ['js/jquery-shim.js', 'test2/js/jquery-shim.js'],
    ['election-viewer-package/js/stages2.js', 'test2/election-viewer-package/js/stages2.js'],
    ['election-viewer-package/js/animation_preview.js', 'test2/election-viewer-package/js/animation_preview.js'],
    ['election-viewer-package/js/animation_preview_manager.js', 'test2/election-viewer-package/js/animation_preview_manager.js'],
    ['election-viewer-package/js/election_viewer.js', 'test2/election-viewer-package/js/election_viewer.js'],
    ['election-viewer-package/css/stages.css', 'test2/election-viewer-package/css/stages.css'],
    ['election-viewer-package/css/election-viewer.css', 'test2/election-viewer-package/css/election-viewer.css']
  ];
  for (const [source, target] of assets) {
    if (!existsSync(source)) {
      throw new Error(`Missing /test2 election animation runtime source asset: ${source}`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    const content = readFileSync(target, 'utf8').replace(/[ \t]+$/gm, '');
    writeFileSync(target, content);
  }
}
