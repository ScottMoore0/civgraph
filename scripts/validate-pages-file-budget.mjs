#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const MAX_FILES = Number(process.env.MAX_PAGES_FILES || 18500);
const MAX_FILE_BYTES = Number(process.env.MAX_PAGES_FILE_BYTES || 25 * 1024 * 1024);

const EXCLUDED_PREFIXES = [
  '.github/',
  'archive/',
  'boundary-gazette/',
  'data/census/',
  'data/timeline-transitions/',
  'docs/',
  'election-viewer-package/data/elections/',
  'electionsni-reference/',
  'node_modules/',
  'ocr_output/',
  'scripts/',
  'tasks/',
  'test/pmtiles/generated/',
  'test/tiles/civil-parishes-v3/',
  'test/tiles/generated/',
  'tests/'
];

const EXCLUDED_FILES = new Set([
  'data/database/approved-publication-sources.json'
]);

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean);

const deployedFiles = trackedFiles.filter((file) => (
  !EXCLUDED_FILES.has(file) &&
  !EXCLUDED_PREFIXES.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix))
));
const byTopLevel = new Map();
for (const file of deployedFiles) {
  const top = file.split('/')[0] || file;
  byTopLevel.set(top, (byTopLevel.get(top) || 0) + 1);
}

console.log('Cloudflare Pages File Budget');
console.log(`- tracked files: ${trackedFiles.length}`);
console.log(`- deployable files after clean exclusions: ${deployedFiles.length}/${MAX_FILES}`);
for (const [name, count] of [...byTopLevel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  - ${name}: ${count}`);
}

if (deployedFiles.length > MAX_FILES) {
  console.error(`FAIL: Pages asset output would exceed the local ${MAX_FILES}-file guardrail before Cloudflare's 20,000-file hard limit.`);
  process.exit(1);
}

const oversizedFiles = deployedFiles
  .map((file) => ({ file, bytes: statSync(file).size }))
  .filter((entry) => entry.bytes > MAX_FILE_BYTES)
  .sort((a, b) => b.bytes - a.bytes);

if (oversizedFiles.length) {
  console.error(`FAIL: ${oversizedFiles.length} deployable file(s) exceed Cloudflare Pages' ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB per-file limit.`);
  for (const entry of oversizedFiles.slice(0, 20)) {
    console.error(`  - ${entry.file}: ${(entry.bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  process.exit(1);
}

console.log('PASS: Pages deployable file count and per-file sizes are under budget.');
