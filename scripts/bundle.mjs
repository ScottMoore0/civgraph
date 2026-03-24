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
import { readFileSync, renameSync, existsSync } from 'fs';

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

// Minify CSS
await esbuild.build({
    entryPoints: ['assets/css/main.css'],
    outfile: 'build/main.css',
    minify: true,
    bundle: true,
    logLevel: 'info'
});

console.log('CSS minified: build/main.css');

// Performance budgets — fail the build if assets grow unexpectedly
import { statSync } from 'fs';

const budgets = [
    { file: 'build/app.bundle.js', max: 320_000, label: 'Main bundle' },
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
