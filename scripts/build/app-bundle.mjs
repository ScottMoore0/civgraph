#!/usr/bin/env node
/**
 * Bundle the production main-shell + MapLibre adapter route.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const APP_BASE = '/app';
const BUILD_DIR = 'site/app/build';
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

// Content hash of the startup metadata index, injected as __METADATA_INDEX_VERSION__. Unused by the
// app since data design phase 3 (the index comes from /_api/layers?view=index, versioned by its
// ETag); kept defined so an older source that still names it builds.
//
// The index URL previously carried a hand-edited '?v=test-066'. That is safe
// only while the file is served must-revalidate: cache it immutably with a
// token nobody remembers to bump and every browser pins a stale copy of the
// entire layer catalogue permanently. There is already a commit in this repo
// titled "move off a poisoned chunk URL", so that failure mode is not
// hypothetical. Deriving the token from the bytes makes the URL change exactly
// when the content does, which is what immutable caching requires.
const metadataIndexVersion = createHash('sha256')
  .update(readFileSync('render/metadata/maps-test-index.json'))
  .digest('hex')
  .slice(0, 12);

// Content hashes of the election animation runtime, injected as __VIEWER_ASSET_VERSIONS__.
//
// The same failure as above, and it did happen: /app/election-viewer-package/* and
// /app/js/* are served immutable for a year, and the loader asked for stages2.js?v=2 and
// the rest with no token at all. The edge kept serving the old stages2.js hours after a
// deploy changed it, and a stages.css 43 days old. The files are copied first so their
// hashes exist when the bundle that requests them is built.
const viewerAssetVersions = Object.fromEntries(
  copyAnimationRuntimeAssets().map((target) => [`/${target.replace(/^site\//, '')}`, contentHash(target)])
);

const result = await esbuild.build({
  entryPoints: ['packages/map/app/boot.js'],
  bundle: true,
  minify: true,
  define: {
    __METADATA_INDEX_VERSION__: JSON.stringify(metadataIndexVersion),
    __VIEWER_ASSET_VERSIONS__: JSON.stringify(viewerAssetVersions)
  },
  // Keep inline @license banners that packages ship in their source. Only
  // maplibre-gl has one; the rest declare a licence but carry no comment, which
  // is why build-third-party-notices.mjs assembles the full set from their
  // LICENSE files instead.
  legalComments: 'eof',
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

// Persist the metafile: build-third-party-notices.mjs reads it to determine what
// actually landed in the bundle, which is not the same as the dependency list.
// Output paths are written as served (app/build/...): site/ is the served root (8 Nov 2026).
writeFileSync(`${BUILD_DIR}/metafile.json`, JSON.stringify(result.metafile, null, 2).replaceAll('"site/app/build/', '"app/build/'));

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
updateHtmlVersions(jsVersion, cssVersion, viewerAssetVersions);
writeCatalogueTestPage();
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

function updateHtmlVersions(jsVersion, cssVersion, viewerAssetVersions) {
  // maps/index.html is the MapLibre app since the landing page took the root. Only
  // index.html was stamped, and it loads none of these, so the app's tokens had frozen.
  for (const htmlPath of ['site/index.html', 'site/maps/index.html']) {
    if (!existsSync(htmlPath)) continue;
    let html = readFileSync(htmlPath, 'utf8')
      .replace(/\/(?:test2\/)?build\/test2\.bundle\.js\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.js?v=${jsVersion}`)
      .replace(/\/app\/build\/app\.bundle\.js\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.js?v=${jsVersion}`)
      .replace(/\/(?:test2\/)?build\/test2\.bundle\.css\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.css?v=${cssVersion}`)
      .replace(/\/app\/build\/app\.bundle\.css\?v=[^"']+/g, `${APP_BASE}/build/app.bundle.css?v=${cssVersion}`);
    for (const assetPath of ['/app/election-viewer-package/css/stages.css', '/app/election-viewer-package/css/election-viewer.css']) {
      const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`${escaped}(?:\\?v=[^"'>\\s]+)?`, 'g'), `${assetPath}?v=${viewerAssetVersions[assetPath]}`);
    }
    writeFileSync(htmlPath, html);
  }
}

// The rebuilt catalogue (src/catalogue/) became civgraph.net/maps on 2026-10-12. One more page is
// written from maps/index.html on every build, so it never drifts from it, and kept out of search
// engines (maps/test, where the catalogue was reviewed, was written here too until 7 Nov 2026; its
// address answers 301 to /maps/ in _redirects):
//   maps/classic  -- the archived classic pane, kept in case anything is needed from it or the
//                    switch is reverted (git tag maps-classic-2026-10-12 is the last commit that
//                    served it at /maps).
function writeCatalogueTestPage() {
  const source = 'site/maps/index.html';
  if (!existsSync(source)) return;
  const base = readFileSync(source, 'utf8');
  const page = (dir, flag) => {
    const html = base
      .replace(/<head>/i, `<head>\n  <meta name="robots" content="noindex, nofollow">\n  <script>window.CIVGRAPH_CATALOGUE = '${flag}';</script>`)
      .replace('<meta property="og:url" content="https://civgraph.net/maps/">', `<meta property="og:url" content="https://civgraph.net/maps/${dir}/">`)
      .replace('<link rel="canonical" href="https://civgraph.net/maps/">', `<link rel="canonical" href="https://civgraph.net/maps/${dir}/">`);
    if (!html.includes(`window.CIVGRAPH_CATALOGUE = '${flag}'`)) throw new Error(`site/maps/${dir}: could not set the catalogue switch`);
    mkdirSync(`site/maps/${dir}`, { recursive: true });
    writeFileSync(`site/maps/${dir}/index.html`, html);
  };
  page('classic', 'classic');
}

function updateServiceWorkerVersion(jsVersion) {
  const swPath = 'site/sw.js';
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
    ['src/jquery-shim.js', 'site/app/js/jquery-shim.js'],
    // packages/map/app/app.js loads this at runtime via
    // loadClassicScript('/app/js/libs/flatgeobuf-geojson.min.js', 'flatgeobuf'),
    // but it was never copied here, so that path did not exist in the deploy.
    // Pages' SPA fallback then answered the request with index.html at HTTP 200,
    // and `x-content-type-options: nosniff` made the browser refuse to execute
    // the HTML as a script -- so every FlatGeobuf layer load failed while the
    // URL still looked healthy to anything checking status codes.
    ['src/libs/flatgeobuf-geojson.min.js', 'site/app/js/libs/flatgeobuf-geojson.min.js'],
    ['data/elections-source/js/stages2.js', 'site/app/election-viewer-package/js/stages2.js'],
    ['data/elections-source/js/animation_preview.js', 'site/app/election-viewer-package/js/animation_preview.js'],
    ['data/elections-source/js/animation_preview_manager.js', 'site/app/election-viewer-package/js/animation_preview_manager.js'],
    ['data/elections-source/js/election_viewer.js', 'site/app/election-viewer-package/js/election_viewer.js'],
    ['data/elections-source/css/stages.css', 'site/app/election-viewer-package/css/stages.css'],
    ['data/elections-source/css/election-viewer.css', 'site/app/election-viewer-package/css/election-viewer.css']
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
  return assets.map(([, target]) => target);
}
