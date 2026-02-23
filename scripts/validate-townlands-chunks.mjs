#!/usr/bin/env node
/**
 * Validate Townlands chunk deployment readiness.
 *
 * Checks:
 * 1) chunk index exists and parses
 * 2) every chunk/zoom file path exists on disk
 * 3) file header looks like FlatGeobuf (starts with "fgb")
 * 4) file is not a Git LFS pointer text file
 *
 * Usage:
 *   node scripts/validate-townlands-chunks.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const INDEX_PATH = resolve(ROOT, 'data/maps/townlands/ni-townlands-1844-chunks.json');

function isLfsPointer(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8');
  return sample.includes('version https://git-lfs.github.com/spec/v1');
}

function hasFgbSignature(buf) {
  if (!buf || buf.length < 3) return false;
  return buf[0] === 0x66 && buf[1] === 0x67 && buf[2] === 0x62; // "fgb"
}

function main() {
  const problems = [];
  const stats = {
    chunksListed: 0,
    filesChecked: 0,
    missing: 0,
    lfsPointers: 0,
    badSignature: 0
  };

  if (!existsSync(INDEX_PATH)) {
    console.error(`ERROR: Missing chunk index: ${INDEX_PATH}`);
    process.exit(2);
  }

  let index;
  try {
    index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Failed to parse chunk index: ${err.message}`);
    process.exit(2);
  }

  const entries = [];
  for (const chunk of index.chunks || []) {
    stats.chunksListed += 1;
    if (chunk.file) entries.push({ id: chunk.id, kind: 'base', path: chunk.file });
    const zf = chunk.zoomFiles || {};
    for (const [zName, zVal] of Object.entries(zf)) {
      if (zVal?.file) entries.push({ id: chunk.id, kind: zName, path: zVal.file });
    }
  }

  for (const entry of entries) {
    stats.filesChecked += 1;
    const abs = resolve(ROOT, entry.path);
    if (!existsSync(abs)) {
      stats.missing += 1;
      problems.push(`MISSING: ${entry.path} (${entry.id}/${entry.kind})`);
      continue;
    }

    let buf;
    try {
      buf = readFileSync(abs);
    } catch (err) {
      problems.push(`READ-ERROR: ${entry.path} (${err.message})`);
      continue;
    }

    if (isLfsPointer(buf)) {
      stats.lfsPointers += 1;
      problems.push(`LFS-POINTER: ${entry.path} (${entry.id}/${entry.kind})`);
      continue;
    }

    if (!hasFgbSignature(buf)) {
      stats.badSignature += 1;
      problems.push(`BAD-SIGNATURE: ${entry.path} (${entry.id}/${entry.kind})`);
    }
  }

  const ok = stats.missing === 0 && stats.lfsPointers === 0 && stats.badSignature === 0;
  console.log('Townlands Chunk Validation');
  console.log(`- chunks listed: ${stats.chunksListed}`);
  console.log(`- files checked: ${stats.filesChecked}`);
  console.log(`- missing: ${stats.missing}`);
  console.log(`- lfs pointers: ${stats.lfsPointers}`);
  console.log(`- bad signatures: ${stats.badSignature}`);

  if (!ok) {
    console.log('\nProblems:');
    for (const p of problems.slice(0, 200)) console.log(`- ${p}`);
    if (problems.length > 200) console.log(`- ... and ${problems.length - 200} more`);
    process.exit(1);
  }

  console.log('\nPASS: Townlands chunk files are deployment-ready.');
}

main();

