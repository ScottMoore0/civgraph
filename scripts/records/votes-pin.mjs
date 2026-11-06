#!/usr/bin/env node
/**
 * The parliamentary division dataset stays outside the repository (CIVGRAPH_VOTES_DIR); this pins
 * it by checksum, so a records build can say exactly which copy it was built from and refuses a
 * copy that changed without the pin being updated.
 *
 *   node scripts/records/votes-pin.mjs --write   record the SHA-256 of every tidy/**.csv file
 *                                                 in data/database/votes-source.json
 *   node scripts/records/votes-pin.mjs           check the copy at CIVGRAPH_VOTES_DIR against it
 *
 * The pin names files by their path under the dataset folder, never the folder's own location.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './paths.mjs';

export const PIN_FILE = path.join(REPO_ROOT, 'data', 'database', 'votes-source.json');

function listCsv(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listCsv(full, base));
    else if (entry.name.endsWith('.csv')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

export function checksumVotesDir(votesDir) {
  const tidy = path.join(votesDir, 'tidy');
  if (!existsSync(tidy)) throw new Error(`no tidy/ folder in ${votesDir}`);
  return listCsv(tidy).map((rel) => {
    const full = path.join(tidy, ...rel.split('/'));
    return { file: `tidy/${rel}`, bytes: statSync(full).size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') };
  });
}

/** Throws unless the copy at votesDir matches the committed pin; returns the pin's digest. */
export function verifyVotesPin(votesDir) {
  if (!existsSync(PIN_FILE)) throw new Error('data/database/votes-source.json is missing: run node scripts/records/votes-pin.mjs --write');
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8'));
  const actual = checksumVotesDir(votesDir);
  const want = new Map(pin.files.map((f) => [f.file, f.sha256]));
  const diffs = [];
  for (const f of actual) if (want.get(f.file) !== f.sha256) diffs.push(f.file);
  for (const f of pin.files) if (!actual.some((a) => a.file === f.file)) diffs.push(`${f.file} (missing)`);
  if (diffs.length) throw new Error(`the votes dataset differs from its pin: ${diffs.slice(0, 8).join(', ')}`);
  return createHash('sha256').update(JSON.stringify(pin.files)).digest('hex').slice(0, 16);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  const dir = process.env.CIVGRAPH_VOTES_DIR;
  if (!dir) { console.error('set CIVGRAPH_VOTES_DIR to the division dataset folder'); process.exit(1); }
  if (process.argv.includes('--write')) {
    const files = checksumVotesDir(dir);
    writeFileSync(PIN_FILE, `${JSON.stringify({ schemaVersion: 1, description: 'SHA-256 of the parliamentary division dataset (kept outside the repository, CIVGRAPH_VOTES_DIR) that records:build reads. Update with node scripts/records/votes-pin.mjs --write when the dataset is refreshed.', files }, null, 2)}\n`);
    console.log(`pinned ${files.length} file(s) in ${path.relative(REPO_ROOT, PIN_FILE)}`);
  } else {
    try { console.log(`PASS: votes dataset matches its pin (${verifyVotesPin(dir)})`); } catch (e) { console.error(`FAIL: ${e.message}`); process.exit(1); }
  }
}
