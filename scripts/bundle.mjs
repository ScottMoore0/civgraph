#!/usr/bin/env node
/**
 * Bundle and minify the ES module JS files into a single file using esbuild.
 * Non-module scripts (election-viewer-package, jquery-shim) are excluded —
 * they set globals and remain as separate <script> tags.
 *
 * Usage:
 *   node scripts/bundle.mjs
 */

import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

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
    format: 'esm',
    minify: true,
    sourcemap: true,
    outfile: 'build/app.bundle.js',
    target: ['es2020'],
    // Don't try to resolve these — they're browser globals loaded via CDN
    external: Object.keys(globalExternals),
    logLevel: 'info'
});

if (result.errors.length > 0) {
    process.exit(1);
}

console.log('Bundle created: build/app.bundle.js');
