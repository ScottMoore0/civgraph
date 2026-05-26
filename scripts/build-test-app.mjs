#!/usr/bin/env node
/**
 * Bundle the isolated /test MapLibre rewrite app.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

mkdirSync('test/build', { recursive: true });

const result = await esbuild.build({
  entryPoints: ['test/src/app.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: 'test/build/test.bundle.js',
  target: ['es2020'],
  logLevel: 'info',
  loader: {
    '.png': 'dataurl',
    '.svg': 'dataurl'
  }
});

if (result.errors.length) process.exit(1);

for (const path of ['test/build/test.bundle.js', 'test/build/test.bundle.css']) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, 'utf8').replace(/[ \t]+$/gm, '');
  writeFileSync(path, content);
}

const jsBytes = statSync('test/build/test.bundle.js').size;
const cssBytes = existsSync('test/build/test.bundle.css')
  ? statSync('test/build/test.bundle.css').size
  : 0;

console.log(`Test bundle: ${(jsBytes / 1024).toFixed(1)} KB`);
console.log(`Test CSS: ${(cssBytes / 1024).toFixed(1)} KB`);
