#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';

const MAX_FILES = Number(process.env.MAX_PAGES_FILES || 18500);
const MAX_FILE_BYTES = Number(process.env.MAX_PAGES_FILE_BYTES || 25 * 1024 * 1024);

// Exclusions come from .cfignore, because that is the file Cloudflare actually obeys.
//
// This script used to carry its own hand-maintained EXCLUDED_PREFIXES list. The two
// drifted, and on 2026-08-03 the drift hid a real overage: the list here excluded
// election-viewer-package/data/elections/ (7,402 files) while .cfignore did not, so
// this check reported a comfortable 13,562/18,500 while the deployment Cloudflare
// would actually build was about 20,944 -- over the 20,000 hard limit. A guardrail
// measuring a different thing from the one being guarded is worse than no guardrail,
// because it is trusted.
//
// git applies gitignore semantics to .cfignore for us, so there is nothing to
// reimplement and nothing left to keep in sync.
function cfignoredFiles() {
  const out = execFileSync('git', ['ls-files', '-c', '-i', '-X', '.cfignore'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return new Set(out.split(/\r?\n/).filter(Boolean).map((f) => f.replace(/\\/g, '/')));
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const output = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = dir + '/' + entry.name;
    if (entry.isDirectory()) output.push(...listFilesRecursive(full));
    else if (entry.isFile()) output.push(full.replace(/\\/g, '/'));
  }
  return output;
}

const gitFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean);
const fileSet = new Set(gitFiles.filter((file) => existsSync(file)));
for (const file of listFilesRecursive('app/build')) fileSet.add(file);
const missingTrackedFiles = gitFiles.filter((file) => !existsSync(file));
const trackedFiles = Array.from(fileSet).sort((a, b) => a.localeCompare(b));

const excluded = cfignoredFiles();
const deployedFiles = trackedFiles.filter((file) => !excluded.has(file));
const byTopLevel = new Map();
for (const file of deployedFiles) {
  const top = file.split('/')[0] || file;
  byTopLevel.set(top, (byTopLevel.get(top) || 0) + 1);
}

console.log('Cloudflare Pages File Budget');
console.log(`- tracked/current files: ${trackedFiles.length}`);
if (missingTrackedFiles.length) {
  console.log(`- ignored missing tracked paths after local build: ${missingTrackedFiles.length}`);
}
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
