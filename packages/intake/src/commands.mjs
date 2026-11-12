/**
 * The R2 and post-upload side of a batch, as calls to the repository's existing scripts.
 * Nothing here talks to R2 itself: each step is one `node scripts/<existing>.mjs ...` command,
 * built the way the hand-written upload.ps1 files of past batches built them.
 *
 *   upload       FGBs (upload-fgb-r2), files per sub-prefix (upload-tree-r2, then --verify-only),
 *                Cache-Control (set-r2-cache-control), PMTiles (write-test-cdn-upload-manifest,
 *                upload-test-pmtiles-r2, verify-test-pmtiles-cdn), cache tokens
 *                (stamp-map-cache-tokens --write, --check)
 *   post-upload  switch-test-pmtiles-to-cdn, regen-thumbnails + thumbnail sync, listed commands
 *
 * Credentials: a step that reads R2 is run as `node --env-file=.env.local ...`, so the keys go
 * from the repository's gitignored .env.local straight into that process and are never printed,
 * exported, or passed on a command line.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { phaseOf, resolveFgbPairs, resolveIds, resolveTreeEntries, batchPath } from './batch.mjs';

/** @typedef {import('./batch.mjs').Batch} Batch */
/** @typedef {import('./batch.mjs').Operation} Operation */
/** @typedef {{ op: string, label: string, argv: string[], credentials: boolean, realOnly: boolean }} Step */
/** @typedef {(argv: string[], options: { cwd: string }) => { status: number, error?: Error | undefined }} Spawn */

const ENV = '--env-file=.env.local';
const DEFAULT_FGB_CHUNK = 40; // keeps each command line well under Windows' 32 KB limit

/**
 * The existing scripts each step calls, in one place: when the scripts/ reorganisation moves
 * them (scripts/publish/...), this table is the only part of the intake tool that changes.
 */
export const SCRIPTS = Object.freeze({
  fgb: 'scripts/publish/r2-upload-files.mjs',
  tree: 'scripts/publish/r2-upload-manifest.mjs',
  cacheControl: 'scripts/publish/r2-cache-control.mjs',
  cdnManifest: 'scripts/publish/r2-manifest.mjs',
  pmtiles: 'scripts/publish/r2-upload-pmtiles.mjs',
  verifyCdn: 'scripts/publish/verify-pmtiles-cdn.mjs',
  stampTokens: 'scripts/build/stamp-map-cache-tokens.mjs',
  switchToCdn: 'scripts/publish/switch-pmtiles-to-cdn.mjs',
  thumbnails: 'scripts/build/thumbnails/regen-thumbnails.py',
  thumbnailSync: 'scripts/publish/r2-upload-tree.mjs',
});

/**
 * A step: { op, label, argv, credentials, realOnly }. realOnly steps have no dry-run form
 * (the CDN check, the token stamp, the manifest refresh) and are listed but not run in a dry run.
 * @param {Operation} op
 * @param {string} label
 * @param {string[]} argv
 * @param {{ credentials?: boolean, realOnly?: boolean }} [options]
 * @returns {Step}
 */
function step(op, label, argv, { credentials = false, realOnly = false } = {}) {
  const full = credentials && argv[0] === 'node' ? ['node', ENV, ...argv.slice(1)] : argv;
  return { op: op.id, label, argv: full, credentials, realOnly };
}

/**
 * Write the [{local, rel}] manifest upload-tree-r2 takes, for an op that lists its files inline.
 * `tmpDir` is injectable so tests (and a plan) need not touch the batch folder.
 * @param {Batch} batch
 * @param {import('./batch.mjs').OperationOf<'r2-tree'>} op
 * @param {() => string} tmpDir
 * @param {boolean} writeManifests
 */
function treeManifestFor(batch, op, tmpDir, writeManifests) {
  if (op.manifest) return batchPath(batch, op.manifest);
  const name = `upload-manifest-${op.id}.json`;
  if (!writeManifests) return `<tmp>/${name}`;
  const entries = resolveTreeEntries(batch, op).map(({ local, rel }) => ({ local, rel }));
  const file = path.join(tmpDir(), name);
  writeFileSync(file, `${JSON.stringify(entries, null, 1)}\n`);
  return file;
}

/** @type {string | null} */
let sharedTmp = null;
const defaultTmpDir = () => (sharedTmp ||= mkdtempSync(path.join(os.tmpdir(), 'civgraph-intake-')));

/**
 * @param {Batch} batch
 * @param {object} [options]
 * @param {boolean} [options.dryRun]        build each script's own dry-run form
 * @param {() => string} [options.tmpDir]   where inline file lists' manifests are written
 * @param {boolean} [options.writeManifests] write upload-tree-r2 manifests for inline file lists
 *                                           (false for plan/report, which show `<tmp>/...`)
 * @returns {Step[]}
 */
export function buildUploadSteps(batch, { dryRun, tmpDir = defaultTmpDir, writeManifests = true } = {}) {
  /** @type {Step[]} */
  const steps = [];
  for (const op of batch.manifest.operations) {
    if (phaseOf(op) !== 'upload') continue;
    switch (op.type) {
      case 'r2-fgb': {
        const pairs = resolveFgbPairs(batch, op).map((p) => `${p.file}=${p.key}`);
        const size = op.chunkSize || DEFAULT_FGB_CHUNK;
        for (let i = 0; i < pairs.length; i += size) {
          const chunk = pairs.slice(i, i + size);
          steps.push(step(op, `FlatGeobufs ${i + 1}-${i + chunk.length} of ${pairs.length}`,
            ['node', SCRIPTS.fgb, ...chunk, ...(dryRun ? ['--dry-run'] : [])], { credentials: true }));
        }
        break;
      }
      case 'r2-tree': {
        const source = op.dir ? ['--dir', op.dir] : ['--manifest', treeManifestFor(batch, op, tmpDir, writeManifests)];
        steps.push(step(op, `files to ${op.prefix}`,
          ['node', SCRIPTS.tree, ...source, '--prefix', op.prefix, ...(op.force ? ['--force'] : []), ...(dryRun ? ['--dry'] : [])],
          { credentials: true }));
        if (op.verify !== false) {
          steps.push(step(op, `verify what ${op.prefix} now holds`,
            ['node', SCRIPTS.tree, ...source, '--prefix', op.prefix, '--verify-only'],
            { credentials: true, realOnly: true }));
        }
        break;
      }
      case 'r2-cache-control':
        for (const prefix of op.prefixes) {
          steps.push(step(op, `Cache-Control on ${prefix}${op.ext ? ` (${op.ext})` : ''}`,
            ['node', SCRIPTS.cacheControl, '--prefix', prefix, ...(op.ext ? ['--ext', op.ext] : []), ...(dryRun ? [] : ['--apply'])],
            { credentials: true }));
        }
        break;
      case 'r2-pmtiles': {
        const ids = resolveIds(batch, op).join(',');
        if (op.refreshCdnManifest !== false) {
          steps.push(step(op, 'refresh render/metadata/cdn-upload-manifest.json (new layers are otherwise never uploaded)',
            ['node', SCRIPTS.cdnManifest], { realOnly: true }));
        }
        steps.push(step(op, `PMTiles (${ids.split(',').length})`,
          ['node', SCRIPTS.pmtiles, '--ids', ids, ...(dryRun ? ['--dry-run'] : [])], { credentials: true }));
        if (op.verifyCdn !== false) {
          steps.push(step(op, 'CDN byte-range check (writes render/metadata/cdn-range-report.json)',
            ['node', SCRIPTS.verifyCdn, '--ids', ids], { credentials: true, realOnly: true }));
        }
        break;
      }
      case 'stamp-cache-tokens': {
        const scope = (op.mapIds || []).flatMap((/** @type {string} */ id) => ['--id', id]);
        steps.push(step(op, 'content cache tokens (?v=<etag>) on the catalogue URLs',
          ['node', SCRIPTS.stampTokens, '--write', ...scope], { credentials: true, realOnly: true }));
        steps.push(step(op, 'cache tokens match R2',
          ['node', SCRIPTS.stampTokens, '--check'], { credentials: true, realOnly: true }));
        break;
      }
      case 'command':
        steps.push(step(op, op.note || op.argv.join(' '), op.argv, { credentials: !!op.credentials, realOnly: !!op.realOnly }));
        break;
      default:
        break;
    }
  }
  return steps;
}

/** @param {Batch} batch @returns {Step[]} */
export function buildPostUploadSteps(batch) {
  /** @type {Step[]} */
  const steps = [];
  for (const op of batch.manifest.operations) {
    if (phaseOf(op) !== 'post-upload') continue;
    if (op.type === 'switch-to-cdn') {
      steps.push(step(op, 'point the layers at their verified CDN copies',
        ['node', SCRIPTS.switchToCdn, '--ids', resolveIds(batch, op).join(',')]));
    } else if (op.type === 'thumbnails') {
      steps.push(step(op, `thumbnails for ${op.mapIds.length} map(s) (reads the FGBs from R2)`,
        ['python', SCRIPTS.thumbnails, '--download', '--ids', op.mapIds.join(',')]));
      if (op.sync !== false) {
        steps.push(step(op, 'thumbnail sync to R2 (npm run sync:thumbnails)',
          ['node', SCRIPTS.thumbnailSync, 'assets/thumbnails', 'assets/thumbnails', '--concurrency=16', '--changed-only'],
          { credentials: true }));
      }
    } else if (op.type === 'command') {
      steps.push(step(op, op.note || op.argv.join(' '), op.argv, { credentials: !!op.credentials }));
    }
  }
  return steps;
}

/**
 * How a step is shown: exactly what would be typed in the repository root.
 * @param {{ argv: string[] }} s
 */
export function formatStep(s) {
  return s.argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
}

/** @type {Spawn} */
function defaultSpawn(argv, { cwd }) {
  const [prog, ...args] = argv;
  // node runs as this very executable; npm is a .cmd shim on Windows and needs the shell.
  const exe = prog === 'node' ? process.execPath : prog;
  const res = spawnSync(exe, args, { cwd, stdio: 'inherit', shell: prog === 'npm' && process.platform === 'win32' });
  return { status: res.status ?? 1, error: res.error };
}

/**
 * Run steps in order. In a dry run, realOnly steps are listed and skipped, and a failing step is
 * reported and passed over (upload-tree-r2 --dry exits 1 when it has files to send); in a real
 * run the first failure stops everything.
 * @param {Step[]} steps
 * @param {{ cwd: string, dryRun?: boolean, spawn?: Spawn, log?: (line: string) => void }} options
 */
export function runSteps(steps, { cwd, dryRun, spawn = defaultSpawn, log = console.log }) {
  if (steps.some((s) => s.credentials && !(dryRun && s.realOnly)) && !existsSync(path.join(cwd, '.env.local'))) {
    throw new Error(`.env.local is missing from ${cwd} (R2 credentials); nothing was run`);
  }
  /** @type {(Step & { status: number | 'skipped' })[]} */
  const results = [];
  for (const s of steps) {
    if (dryRun && s.realOnly) {
      log(`-- skipped in a dry run: ${formatStep(s)}`);
      results.push({ ...s, status: 'skipped' });
      continue;
    }
    log(`>> ${formatStep(s)}`);
    const { status, error } = spawn(s.argv, { cwd });
    results.push({ ...s, status });
    if (status !== 0) {
      if (dryRun) { log(`(dry run: step exited ${status}, continuing)`); continue; }
      throw new Error(`step failed (exit ${status}${error ? `, ${error.message}` : ''}): ${formatStep(s)}`);
    }
  }
  return results;
}
