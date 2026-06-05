#!/usr/bin/env node
/**
 * Bundle the isolated /test MapLibre rewrite app.
 */

import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';

mkdirSync('test/build', { recursive: true });
mkdirSync('build', { recursive: true });

await buildMainShellCss();

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

async function buildMainShellCss() {
  const sourcePath = 'assets/css/main.css';
  if (!existsSync(sourcePath)) return;
  const source = readFileSync(sourcePath, 'utf8');
  const marker = '/* ===CRITICAL-END===';
  const index = source.indexOf(marker);
  if (index < 0) {
    throw new Error('build-test-app.mjs: critical-CSS marker not found in assets/css/main.css');
  }
  mkdirSync('_tmp_css', { recursive: true });
  writeFileSync('_tmp_css/test-critical.css', source.slice(0, index));
  writeFileSync('_tmp_css/test-main.css', source.slice(index));
  await esbuild.build({
    entryPoints: ['_tmp_css/test-critical.css'],
    outfile: 'build/main.critical.css',
    minify: true,
    bundle: true,
    logLevel: 'silent'
  });
  await esbuild.build({
    entryPoints: ['_tmp_css/test-main.css'],
    outfile: 'build/main.css',
    minify: true,
    bundle: true,
    logLevel: 'silent'
  });
  try { unlinkSync('_tmp_css/test-critical.css'); } catch {}
  try { unlinkSync('_tmp_css/test-main.css'); } catch {}
  console.log('Test shell CSS generated: build/main.critical.css, build/main.css');
}
