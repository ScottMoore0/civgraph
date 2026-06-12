#!/usr/bin/env node
/**
 * Build the archived Leaflet app bundle for debugging or rollback research.
 *
 * This script is deliberately not part of the normal production build now that
 * the root route is promoted to the MapLibre /test2 shell.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

const globalExternals = {
  leaflet: 'L',
  flatgeobuf: 'flatgeobuf',
  pako: 'pako',
  '@turf/turf': 'turf',
  'fuse.js': 'Fuse'
};

mkdirSync('build', { recursive: true });

const result = await esbuild.build({
  entryPoints: ['js/app.js'],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  sourcemap: true,
  outdir: 'build',
  chunkNames: 'chunks/v116/[name]-[hash]',
  target: ['es2020'],
  external: Object.keys(globalExternals),
  logLevel: 'info'
});

if (result.errors.length > 0) process.exit(1);

const src = 'build/app.js';
const dst = 'build/app.bundle.js';
if (existsSync(src)) {
  const content = readFileSync(src, 'utf8').replace('//# sourceMappingURL=app.js.map', '//# sourceMappingURL=app.bundle.js.map');
  writeFileSync(src, content);
  renameSync(src, dst);
  if (existsSync(`${src}.map`)) renameSync(`${src}.map`, `${dst}.map`);
  console.log(`Renamed ${src} -> ${dst}`);
}

const maxBytes = 365_000;
const bundleBytes = statSync(dst).size;
const status = bundleBytes > maxBytes ? 'OVER BUDGET' : 'ok';
console.log(`Legacy Leaflet bundle: ${(bundleBytes / 1024).toFixed(1)} KB / ${(maxBytes / 1024).toFixed(0)} KB ${status}`);
if (bundleBytes > maxBytes) {
  console.error('\nLegacy Leaflet build failed: performance budget exceeded.');
  process.exit(1);
}
