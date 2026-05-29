#!/usr/bin/env node
/**
 * Bundle the /test2 main-shell + MapLibre adapter route.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

mkdirSync('test2/build', { recursive: true });

const result = await esbuild.build({
  entryPoints: ['test2/src/app.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: 'test2/build/test2.bundle.js',
  target: ['es2020'],
  logLevel: 'info',
  loader: {
    '.png': 'dataurl',
    '.svg': 'dataurl',
    '.woff2': 'file'
  }
});

if (result.errors.length) process.exit(1);

for (const path of ['test2/build/test2.bundle.js', 'test2/build/test2.bundle.css']) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8').replace(/[ \t]+$/gm, '');
  writeFileSync(path, content);
}

const jsBytes = statSync('test2/build/test2.bundle.js').size;
const cssBytes = existsSync('test2/build/test2.bundle.css')
  ? statSync('test2/build/test2.bundle.css').size
  : 0;

console.log(`Test2 bundle: ${(jsBytes / 1024).toFixed(1)} KB`);
console.log(`Test2 CSS: ${(cssBytes / 1024).toFixed(1)} KB`);
