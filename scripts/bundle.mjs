#!/usr/bin/env node
/**
 * Bundle and minify the ES module JS files using esbuild.
 * Code-splitting is enabled — dynamic import() calls produce separate chunks.
 * Non-module scripts (election-viewer-package, jquery-shim) are excluded —
 * they set globals and remain as separate <script> tags.
 *
 * Usage:
 *   node scripts/bundle.mjs
 */

import * as esbuild from 'esbuild';
import { readFileSync, renameSync, existsSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';

// Globals provided by CDN script tags — esbuild must not try to bundle these
const globalExternals = {
    'leaflet': 'L',
    'flatgeobuf': 'flatgeobuf',
    'pako': 'pako',
    '@turf/turf': 'turf',
    'fuse.js': 'Fuse'
};

const result = await esbuild.build({
    entryPoints: ['js/app.js'],
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    sourcemap: true,
    outdir: 'build',
    target: ['es2020'],
    // Don't try to resolve these — they're browser globals loaded via CDN
    external: Object.keys(globalExternals),
    logLevel: 'info'
});

if (result.errors.length > 0) {
    process.exit(1);
}

// Maintain backwards-compatible output path: build/app.bundle.js
// esbuild with splitting + outdir writes to build/app.js
const src = 'build/app.js';
const dst = 'build/app.bundle.js';
if (existsSync(src) && src !== dst) {
    // Fix sourcemap reference before renaming
    let content = readFileSync(src, 'utf8');
    content = content.replace('//# sourceMappingURL=app.js.map', '//# sourceMappingURL=app.bundle.js.map');
    const { writeFileSync } = await import('fs');
    writeFileSync(src, content);
    renameSync(src, dst);
    if (existsSync(src + '.map')) {
        renameSync(src + '.map', dst + '.map');
    }
    console.log(`Renamed ${src} → ${dst}`);
}

console.log('Bundle created: build/app.bundle.js');

// Split main.css at the /* ===CRITICAL-END=== */ marker into two source
// chunks, then minify each. The critical chunk (~46 KB raw → ~12 KB minified)
// is inlined in index.html so first paint doesn't wait on a stylesheet
// roundtrip. The rest is loaded async via media=print + onload swap.
{
    const srcCss = readFileSync('assets/css/main.css', 'utf8');
    const marker = '/* ===CRITICAL-END===';
    const idx = srcCss.indexOf(marker);
    if (idx < 0) {
        throw new Error('bundle.mjs: critical-CSS marker not found in assets/css/main.css');
    }
    const criticalSrc = srcCss.slice(0, idx);
    const restSrc = srcCss.slice(idx);
    mkdirSync('_tmp_css', { recursive: true });
    writeFileSync('_tmp_css/critical.css', criticalSrc);
    writeFileSync('_tmp_css/rest.css', restSrc);

    await esbuild.build({
        entryPoints: ['_tmp_css/critical.css'],
        outfile: 'build/main.critical.css',
        minify: true, bundle: true, logLevel: 'silent'
    });
    await esbuild.build({
        entryPoints: ['_tmp_css/rest.css'],
        outfile: 'build/main.css',
        minify: true, bundle: true, logLevel: 'silent'
    });
    try { unlinkSync('_tmp_css/critical.css'); } catch {}
    try { unlinkSync('_tmp_css/rest.css'); } catch {}

    const critBytes = statSync('build/main.critical.css').size;
    const restBytes = statSync('build/main.css').size;
    console.log(`CSS split: critical ${(critBytes/1024).toFixed(1)} KB, deferred ${(restBytes/1024).toFixed(1)} KB`);
}

// Inline the critical CSS into index.html — saves one roundtrip on first paint.
// Replaces everything between the INLINE-CRITICAL-CSS:START and :END markers
// with a <style> block containing the minified critical CSS. Idempotent: each
// build re-replaces the block, so subsequent CSS edits are reflected without
// further markup changes.
{
    const indexPath = 'index.html';
    const html = readFileSync(indexPath, 'utf8');
    const startMarker = 'INLINE-CRITICAL-CSS:START';
    const endMarker = 'INLINE-CRITICAL-CSS:END';
    const startIdx = html.indexOf(startMarker);
    const endIdx = html.indexOf(endMarker);
    if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
        console.warn('  (skip) INLINE-CRITICAL-CSS markers not found in index.html');
    } else {
        const css = readFileSync('build/main.critical.css', 'utf8');
        // Find the start of the marker's opening comment '<!--' and the end of
        // the closing comment '-->', so we replace the full marker pair too —
        // and emit fresh markers along with the inline <style>.
        const openCommentStart = html.lastIndexOf('<!--', startIdx);
        const closeCommentEnd = html.indexOf('-->', endIdx) + 3;
        if (openCommentStart < 0 || closeCommentEnd <= 0) {
            console.warn('  (skip) could not locate marker comment boundaries');
        } else {
            const before = html.slice(0, openCommentStart);
            const after = html.slice(closeCommentEnd);
            const replacement =
                `<!-- INLINE-CRITICAL-CSS:START — inlined by scripts/bundle.mjs to save one roundtrip. -->\n` +
                `  <style>${css}</style>\n` +
                `  <!-- INLINE-CRITICAL-CSS:END -->`;
            writeFileSync(indexPath, before + replacement + after);
            console.log(`Inlined critical CSS into index.html (${(css.length/1024).toFixed(1)} KB)`);
        }
    }
}

// Generate minimal about.css (header + design tokens only, ~6 KB vs 203 KB).
// Now sourced from build/main.critical.css since tokens + .app-header rules
// live in the critical chunk after the CSS split above.
{
    const css = readFileSync('build/main.critical.css', 'utf8');
    const rootMatch = css.match(/:root\s*\{[^}]+\}/);
    const headerRules = css.match(/\.app-header[^{]*\{[^}]+\}/g) || [];
    const mediaBlocks = css.match(/@media[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g) || [];
    const headerMedia = mediaBlocks.filter(m => m.includes('app-header'));
    let about = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif}body{background:var(--surface-primary);color:var(--text-primary);line-height:1.6}a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}\n`;
    if (rootMatch) about += rootMatch[0] + '\n';
    about += headerRules.join('\n') + '\n';
    about += headerMedia.join('\n') + '\n';
    writeFileSync('build/about.css', about);
    console.log(`About CSS extracted: build/about.css (${(about.length / 1024).toFixed(1)} KB)`);
}

// Performance budgets — fail the build if assets grow unexpectedly

const budgets = [
    { file: 'build/app.bundle.js', max: 360_000, label: 'Main bundle' },
    { file: 'build/main.css',      max: 230_000, label: 'CSS' },
];

let budgetFailed = false;
for (const { file, max, label } of budgets) {
    const size = statSync(file).size;
    const status = size > max ? 'OVER BUDGET' : 'ok';
    console.log(`  ${label}: ${(size / 1024).toFixed(1)} KB / ${(max / 1024).toFixed(0)} KB ${status}`);
    if (size > max) budgetFailed = true;
}
if (budgetFailed) {
    console.error('\nBuild failed: performance budget exceeded.');
    process.exit(1);
}
