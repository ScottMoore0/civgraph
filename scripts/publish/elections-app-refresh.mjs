#!/usr/bin/env node
/**
 * The publish step that keeps the Elections app's R2 extracts in step with D1 (scripts/publish/publish.sh,
 * after the records load and before the push).
 *
 *   node scripts/publish/elections-app-refresh.mjs            build, check, upload if the manifest changed
 *   node scripts/publish/elections-app-refresh.mjs --dry-run  build and check; say whether it would upload
 *
 * 1. npm run build:elections-app: the extracts from the records build the publish has just loaded.
 * 2. npm run check:elections-app-extracts -- --strict: current, publishable columns only, no private
 *    values; strict, so a missing records build or missing extracts fail rather than skip.
 * 3. The new extracts/manifest.json is compared with the one on R2
 *    (https://data.civgraph.net/data/elections-app/v1/extracts/manifest.json). Only when they differ
 *    (or R2 has none yet) does it run scripts/publish/elections-app-r2-upload.mjs --upload, which
 *    re-checks everything, passes the publication gate, skips objects already there and sends
 *    index.json last. That upload needs the vendored DuckDB WebAssembly built locally
 *    (npm run build:elections-app:vendor; check:elections-app-vendor).
 *
 * Any failure exits non-zero with the reason, and publish.sh aborts (aborted-after-load: D1 is
 * loaded, nothing pushed). The R2 files are read by the Elections app only; the prefix is unlisted in
 * the public data index while the app is not public (data/database/r2-publication-allowlist.json).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../../packages/config/src/node.mjs';
import { SOURCES } from '../../site/apps/elections/config.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL_MANIFEST = path.join(REPO, 'site/apps/elections/extracts/manifest.json');

/**
 * True when the local manifest differs from the one on R2 (null when R2 has none). Compared as
 * parsed JSON, so whitespace never forces an upload.
 * @param {string} localText
 * @param {string | null} remoteText
 */
export function manifestChanged(localText, remoteText) {
  if (remoteText === null) return true;
  try {
    return JSON.stringify(JSON.parse(localText)) !== JSON.stringify(JSON.parse(remoteText));
  } catch {
    return true;
  }
}

/** The manifest on R2, or null when it is not there (404). Any other answer throws. */
async function remoteManifest() {
  const url = `${SOURCES.r2.extracts}manifest.json`;
  const res = await fetch(url, { headers: { 'User-Agent': SITE.userAgent }, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

function npm(args) {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: REPO, stdio: 'inherit', shell: process.platform === 'win32' });
}

/** @returns {Promise<number>} the exit code */
async function main() {
  const dry = process.argv.includes('--dry-run');
  const fail = (/** @type {string} */ msg) => { console.error(`FAIL: elections-app refresh: ${msg}`); return 1; };
  try { npm(['run', '-s', 'build:elections-app']); } catch { return fail('npm run build:elections-app failed'); }
  try { npm(['run', '-s', 'check:elections-app-extracts', '--', '--strict']); } catch { return fail('the extracts are not current or not publishable (check:elections-app-extracts --strict)'); }
  const local = readFileSync(LOCAL_MANIFEST, 'utf8');
  let remote;
  try { remote = await remoteManifest(); } catch (err) { return fail(`could not read the R2 manifest: ${/** @type {Error} */ (err).message}`); }
  const sha = createHash('sha256').update(local).digest('hex').slice(0, 12);
  if (!manifestChanged(local, remote)) {
    console.log(`elections-app: R2 manifest unchanged (${sha}); nothing to upload`);
    return 0;
  }
  console.log(`elections-app: manifest ${sha} differs from R2's${remote === null ? ' (R2 has none yet)' : ''}`);
  if (dry) {
    console.log('(dry run) would run: node scripts/publish/elections-app-r2-upload.mjs --upload');
    return 0;
  }
  try {
    execFileSync(process.execPath, [path.join(REPO, 'scripts/publish/elections-app-r2-upload.mjs'), '--upload'], { cwd: REPO, stdio: 'inherit' });
  } catch {
    return fail('the R2 upload failed (scripts/publish/elections-app-r2-upload.mjs --upload)');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // exitCode, not process.exit(): exiting while fetch's sockets close trips a libuv assertion on Windows.
  process.exitCode = await main();
}
