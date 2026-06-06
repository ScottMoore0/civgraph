#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const MAX_FILES = Number(process.env.MAX_PAGES_FILES || 20000);

const EXCLUDED_PREFIXES = [
  '.github/',
  'archive/',
  'boundary-gazette/',
  'data/census/',
  'docs/',
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

const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean);

const deployedFiles = trackedFiles.filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)));
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
  console.error(`FAIL: Pages asset output would exceed Cloudflare's ${MAX_FILES}-file limit.`);
  process.exit(1);
}

console.log('PASS: Pages deployable file count is under budget.');
