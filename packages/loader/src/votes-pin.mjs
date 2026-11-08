#!/usr/bin/env node
/**
 * The parliamentary division dataset stays outside the repository (CIVGRAPH_VOTES_DIR); this pins
 * it by checksum, so a records build can say exactly which copy it was built from and refuses a
 * copy that changed without the pin being updated.
 *
 *   node packages/loader/src/votes-pin.mjs --write   record the SHA-256 of each file the build
 *                                                 reads (VOTES_INPUTS) in
 *                                                 data/database/votes-source.json
 *   node packages/loader/src/votes-pin.mjs           check the copy at CIVGRAPH_VOTES_DIR against it
 *
 * The pin names files by their path under the dataset folder, never the folder's own location.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildVar } from '../../config/src/node.mjs';
import { REPO_ROOT } from './paths.mjs';

export const PIN_FILE = path.join(REPO_ROOT, 'data', 'database', 'votes-source.json');

/**
 * The files scripts/build/build_browse_votes.py reads, and only those: the dataset folder also holds
 * review sheets, pilot runs and reports that change while the dataset is worked on, and pinning
 * them would refuse a build whose inputs had not changed. The Stormont pair is optional (the
 * builder skips it when absent), so it is pinned when present.
 */
export const VOTES_INPUTS = ['tidy/divisions.csv', 'tidy/votes.csv', 'tidy/stormont/divisions.csv', 'tidy/stormont/votes.csv'];
const REQUIRED = new Set(['tidy/divisions.csv', 'tidy/votes.csv']);

/**
 * @param {string} votesDir
 */
export function checksumVotesDir(votesDir) {
  const tidy = path.join(votesDir, 'tidy');
  if (!existsSync(tidy)) throw new Error(`no tidy/ folder in ${votesDir}`);
  const out = [];
  for (const rel of VOTES_INPUTS) {
    const full = path.join(votesDir, ...rel.split('/'));
    if (!existsSync(full)) {
      if (REQUIRED.has(rel)) throw new Error(`${rel} is missing from ${votesDir}`);
      continue;
    }
    out.push({ file: rel, bytes: statSync(full).size, sha256: createHash('sha256').update(readFileSync(full)).digest('hex') });
  }
  return out;
}

/**
 * The votes dataset against its pin (state-machine catalogue RC-L, light): 'unpinned' (no pin
 * file), 'mismatch' (a pinned file differs or is missing), or 'pinned'.
 * @typedef {'unpinned'|'mismatch'|'pinned'} VotesPinState
 * @param {string} votesDir
 * @param {string} [pinFile]
 * @returns {{ state: VotesPinState, diffs: string[], pin: { files: { file: string, sha256: string }[] }|null }}
 */
export function votesPinState(votesDir, pinFile = PIN_FILE) {
  if (!existsSync(pinFile)) return { state: 'unpinned', diffs: [], pin: null };
  const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
  const actual = checksumVotesDir(votesDir);
  const want = new Map(pin.files.map((/** @type {{ file: string, sha256: string }} */ f) => [f.file, f.sha256]));
  const diffs = [];
  for (const f of actual) if (want.get(f.file) !== f.sha256) diffs.push(f.file);
  for (const f of pin.files) if (!actual.some((a) => a.file === f.file)) diffs.push(`${f.file} (missing)`);
  return { state: diffs.length ? 'mismatch' : 'pinned', diffs, pin };
}

/**
 * Throws unless the copy at votesDir matches the committed pin; returns the pin's digest.
 * @param {string} votesDir
 */
export function verifyVotesPin(votesDir) {
  const { state, diffs, pin } = votesPinState(votesDir);
  if (state === 'unpinned' || !pin) throw new Error('data/database/votes-source.json is missing: run node packages/loader/src/votes-pin.mjs --write');
  if (state === 'mismatch') throw new Error(`the votes dataset differs from its pin: ${diffs.slice(0, 8).join(', ')}`);
  return createHash('sha256').update(JSON.stringify(pin.files)).digest('hex').slice(0, 16);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'votes-pin.mjs') {
  const dir = buildVar('CIVGRAPH_VOTES_DIR');
  if (!dir) { console.error('set CIVGRAPH_VOTES_DIR to the division dataset folder'); process.exit(1); }
  if (process.argv.includes('--write')) {
    const files = checksumVotesDir(dir);
    writeFileSync(PIN_FILE, `${JSON.stringify({ schemaVersion: 1, description: 'SHA-256 of the parliamentary division dataset (kept outside the repository, CIVGRAPH_VOTES_DIR) that records:build reads. Update with node packages/loader/src/votes-pin.mjs --write when the dataset is refreshed.', files }, null, 2)}\n`);
    console.log(`pinned ${files.length} file(s) in ${path.relative(REPO_ROOT, PIN_FILE)}`);
  } else {
    try { console.log(`PASS: votes dataset matches its pin (${verifyVotesPin(dir)})`); } catch (e) { console.error(`FAIL: ${e.message}`); process.exit(1); }
  }
}
