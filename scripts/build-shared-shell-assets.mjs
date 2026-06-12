#!/usr/bin/env node
/**
 * Build shared static shell assets for the promoted MapLibre root.
 *
 * This intentionally does not bundle the archived Leaflet app. The old Leaflet
 * runtime can still be built through `npm run build:legacy-leaflet` when needed
 * for archive/debug work, but the normal production build should only emit the
 * shared CSS/about/thumbnail assets plus the MapLibre runtime under /app.
 */

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';

const HTML_TARGETS = ['index.html'];
const CSS_BUDGET_BYTES = 230_000;

function hashFile(filePath, length = 12, salt = '') {
  const hash = createHash('sha256').update(readFileSync(filePath));
  if (salt) hash.update(salt);
  return hash.digest('hex').slice(0, length);
}

function writeTextIfChanged(filePath, content) {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return false;
  writeFileSync(filePath, content);
  return true;
}

function updateAssetVersion(html, assetPath, version) {
  const normalized = assetPath.replace(/^\/+/, '');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`/?${escaped}(?:\\?v=[^"'>\\s]+)?`, 'g');
  return html.replace(pattern, `/${normalized}?v=${version}`);
}

function removeLegacyLeafletBuildOutputs() {
  const staleFiles = [
    'build/app.js',
    'build/app.js.map',
    'build/app.bundle.js',
    'build/app.bundle.js.map'
  ];
  for (const filePath of staleFiles) {
    if (existsSync(filePath)) rmSync(filePath, { force: true });
  }
  rmSync('build/chunks/v116', { recursive: true, force: true });
}

function buildThumbnailManifest() {
  const thumbnailDir = 'assets/thumbnails';
  if (!existsSync(thumbnailDir)) return;

  let excludedTransparent = new Set();
  const excludedTransparentPath = `${thumbnailDir}/excluded-transparent.json`;
  if (existsSync(excludedTransparentPath)) {
    try {
      const rawExcluded = JSON.parse(readFileSync(excludedTransparentPath, 'utf8'));
      excludedTransparent = new Set(Array.isArray(rawExcluded) ? rawExcluded.map(String) : []);
    } catch (error) {
      console.warn(`Could not read ${excludedTransparentPath}: ${error.message}`);
    }
  }

  const ids = readdirSync(thumbnailDir)
    .filter((name) => name.toLowerCase().endsWith('.webp'))
    .map((name) => name.replace(/\.webp$/i, ''))
    .filter((id) => !excludedTransparent.has(id.replace(/-60$/, '')))
    .sort();

  writeTextIfChanged(`${thumbnailDir}/manifest.json`, JSON.stringify(ids));
  console.log(`Thumbnail manifest: ${ids.length} webp assets`);
}

async function buildMainCss() {
  const sourcePath = 'assets/css/main.css';
  const source = readFileSync(sourcePath, 'utf8');
  const marker = '/* ===CRITICAL-END===';
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('build-shared-shell-assets.mjs: critical-CSS marker not found in assets/css/main.css');
  }

  mkdirSync('build', { recursive: true });
  mkdirSync('_tmp_css', { recursive: true });
  writeFileSync('_tmp_css/shared-critical.css', source.slice(0, markerIndex));
  writeFileSync('_tmp_css/shared-rest.css', source.slice(markerIndex));

  await esbuild.build({
    entryPoints: ['_tmp_css/shared-critical.css'],
    outfile: 'build/main.critical.css',
    minify: true,
    bundle: true,
    logLevel: 'silent'
  });
  await esbuild.build({
    entryPoints: ['_tmp_css/shared-rest.css'],
    outfile: 'build/main.css',
    minify: true,
    bundle: true,
    logLevel: 'silent'
  });

  try { unlinkSync('_tmp_css/shared-critical.css'); } catch {}
  try { unlinkSync('_tmp_css/shared-rest.css'); } catch {}

  const criticalBytes = statSync('build/main.critical.css').size;
  const cssBytes = statSync('build/main.css').size;
  console.log(`CSS split: critical ${(criticalBytes / 1024).toFixed(1)} KB, deferred ${(cssBytes / 1024).toFixed(1)} KB`);
}

function inlineCriticalCss(htmlPath) {
  if (!existsSync(htmlPath)) return;

  const html = readFileSync(htmlPath, 'utf8');
  const startMarker = 'INLINE-CRITICAL-CSS:START';
  const endMarker = 'INLINE-CRITICAL-CSS:END';
  const startIndex = html.indexOf(startMarker);
  const endIndex = html.indexOf(endMarker);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    console.warn(`  (skip) INLINE-CRITICAL-CSS markers not found in ${htmlPath}`);
    return;
  }

  const openCommentStart = html.lastIndexOf('<!--', startIndex);
  const closeCommentEnd = html.indexOf('-->', endIndex) + 3;
  if (openCommentStart < 0 || closeCommentEnd <= 0) {
    console.warn(`  (skip) could not locate marker comment boundaries in ${htmlPath}`);
    return;
  }

  const css = readFileSync('build/main.critical.css', 'utf8');
  const replacement =
    '<!-- INLINE-CRITICAL-CSS:START - inlined by scripts/build-shared-shell-assets.mjs. -->\n' +
    `  <style>${css}</style>\n` +
    '  <!-- INLINE-CRITICAL-CSS:END -->';
  const nextHtml = html.slice(0, openCommentStart) + replacement + html.slice(closeCommentEnd);
  writeTextIfChanged(htmlPath, nextHtml);
  console.log(`Inlined critical CSS into ${htmlPath} (${(css.length / 1024).toFixed(1)} KB)`);
}

function buildAboutCss() {
  const css = readFileSync('build/main.critical.css', 'utf8');
  const rootMatch = css.match(/:root\s*\{[^}]+\}/);
  const headerRules = css.match(/\.app-header[^{]*\{[^}]+\}/g) || [];
  const mediaBlocks = css.match(/@media[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g) || [];
  const headerMedia = mediaBlocks.filter((block) => block.includes('app-header'));
  let about = "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif}body{background:var(--surface-primary);color:var(--text-primary);line-height:1.6}a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}\n";
  if (rootMatch) about += `${rootMatch[0]}\n`;
  about += `${headerRules.join('\n')}\n`;
  about += `${headerMedia.join('\n')}\n`;
  writeTextIfChanged('build/about.css', about);
  console.log(`About CSS extracted: build/about.css (${(about.length / 1024).toFixed(1)} KB)`);
}

function versionSharedCss() {
  const entryPolicyVersion = ['_headers', 'sw.js']
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => hashFile(filePath))
    .join(':');
  const cssVersion = hashFile('build/main.css', 12, entryPolicyVersion);

  for (const htmlPath of HTML_TARGETS) {
    if (!existsSync(htmlPath)) continue;
    const html = readFileSync(htmlPath, 'utf8');
    writeTextIfChanged(htmlPath, updateAssetVersion(html, '/build/main.css', cssVersion));
  }

  console.log(`Shared CSS version: ${cssVersion}`);
}

function enforceBudgets() {
  const cssBytes = statSync('build/main.css').size;
  const status = cssBytes > CSS_BUDGET_BYTES ? 'OVER BUDGET' : 'ok';
  console.log(`  CSS: ${(cssBytes / 1024).toFixed(1)} KB / ${(CSS_BUDGET_BYTES / 1024).toFixed(0)} KB ${status}`);
  if (cssBytes > CSS_BUDGET_BYTES) {
    console.error('\nBuild failed: shared CSS performance budget exceeded.');
    process.exit(1);
  }
}

removeLegacyLeafletBuildOutputs();
buildThumbnailManifest();
await buildMainCss();
for (const htmlPath of HTML_TARGETS) inlineCriticalCss(htmlPath);
buildAboutCss();
versionSharedCss();
enforceBudgets();
