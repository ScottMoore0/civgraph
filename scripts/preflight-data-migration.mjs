#!/usr/bin/env node
/**
 * Preflight gate: prove the CDN already serves every file before you delete it
 * from git.
 *
 * The one unrecoverable mistake in moving data out of the repo is removing a
 * file that the remote store does not actually have. Git can restore it, but
 * only after the site has been serving 404s. This tool makes that mistake
 * impossible to make silently: point it at a directory you intend to untrack,
 * and it fails unless every single file is already fetchable from the public
 * data host.
 *
 * It deliberately checks the PUBLIC URL rather than the R2 bucket via S3:
 *   - no credentials, so it is safe to run anywhere including CI
 *   - it exercises what users actually hit (DNS, CDN, cache, Pages Function),
 *     not merely "an object exists in a bucket"
 *   - no new dependencies (@aws-sdk/client-s3 is not even installed in this
 *     tree, which is why scripts/upload-tile-pyramid-s3.mjs cannot run today)
 *
 * R2 keys mirror repo-relative paths, so data/maps/foo.fgb is expected at
 * https://data.civgraph.net/data/maps/foo.fgb.
 *
 * Compressed variants: functions/data/maps/[[path]].js serves .br / .gz keys
 * for binary payloads, so a base-key 404 is retried against those before a
 * file is reported missing.
 *
 * Usage:
 *   node scripts/preflight-data-migration.mjs data/timeline-transitions
 *   node scripts/preflight-data-migration.mjs data/maps --json
 *   node scripts/preflight-data-migration.mjs data/books --limit 200
 *
 * Options:
 *   --base <url>       default https://data.civgraph.net
 *   --concurrency <n>  default 8
 *   --limit <n>        check only the first N files (sampling, NOT a pass)
 *   --json             machine-readable report on stdout
 *   --no-size-check    existence only; skip Content-Length comparison
 *
 * Exit codes: 0 = every file verified. 1 = at least one gap. 2 = bad usage.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const targets = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const BASE = String(opt('base', 'https://data.civgraph.net')).replace(/\/+$/, '');
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 8)));
const LIMIT = Number(opt('limit', 0));
const JSON_OUT = has('json');
const SIZE_CHECK = !has('no-size-check');

if (!targets.length) {
  console.error('Usage: node scripts/preflight-data-migration.mjs <repo-relative-path...> [--base url] [--concurrency n] [--limit n] [--json] [--no-size-check]');
  process.exit(2);
}

const walk = (target) => {
  if (!existsSync(target)) {
    console.error(`No such path: ${target}`);
    process.exit(2);
  }
  if (statSync(target).isFile()) return [target];
  const out = [];
  const recurse = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.posix.join(dir.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) recurse(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  recurse(target);
  return out;
};

const files = targets.flatMap(walk).sort();
const selected = LIMIT > 0 ? files.slice(0, LIMIT) : files;

const head = async (url) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      return res;
    } catch {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  return null;
};

const checkOne = async (relPath) => {
  const localBytes = statSync(relPath).size;
  const encoded = relPath.split('/').map(encodeURIComponent).join('/');

  for (const [variant, suffix] of [['base', ''], ['br', '.br'], ['gz', '.gz']]) {
    const res = await head(`${BASE}/${encoded}${suffix}`);
    if (!res) return { relPath, status: 'UNREACHABLE', localBytes };
    if (!res.ok) continue;

    const remoteBytes = Number(res.headers.get('content-length'));
    // Only the uncompressed base key is size-comparable; .br/.gz legitimately differ.
    if (SIZE_CHECK && variant === 'base' && Number.isFinite(remoteBytes) && remoteBytes !== localBytes) {
      return { relPath, status: 'SIZE_MISMATCH', localBytes, remoteBytes, variant };
    }
    return { relPath, status: 'OK', localBytes, remoteBytes, variant };
  }
  return { relPath, status: 'MISSING', localBytes };
};

const results = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
    while (cursor < selected.length) {
      const idx = cursor;
      cursor += 1;
      results.push(await checkOne(selected[idx]));
      if (!JSON_OUT && results.length % 100 === 0) {
        process.stderr.write(`  checked ${results.length}/${selected.length}\r`);
      }
    }
  })
);

const bad = results.filter((r) => r.status !== 'OK');
const byStatus = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

if (JSON_OUT) {
  console.log(JSON.stringify({ base: BASE, targets, totalFiles: files.length, checked: selected.length, byStatus, failures: bad }, null, 2));
} else {
  process.stderr.write(' '.repeat(40) + '\r');
  console.log(`Preflight against ${BASE}`);
  console.log(`- targets: ${targets.join(', ')}`);
  console.log(`- files found: ${files.length}${LIMIT > 0 ? ` (sampled ${selected.length})` : ''}`);
  for (const [status, count] of Object.entries(byStatus)) console.log(`- ${status}: ${count}`);
  if (bad.length) {
    console.error('\nNot safe to untrack — unresolved files:');
    for (const f of bad.slice(0, 40)) {
      const detail = f.status === 'SIZE_MISMATCH' ? ` (local ${f.localBytes} vs remote ${f.remoteBytes})` : '';
      console.error(`- ${f.status}: ${f.relPath}${detail}`);
    }
    if (bad.length > 40) console.error(`- ... and ${bad.length - 40} more`);
  }
}

if (bad.length) process.exit(1);

if (LIMIT > 0 && selected.length < files.length) {
  console.log(`\nSAMPLE ONLY — ${selected.length}/${files.length} checked. Re-run without --limit before untracking anything.`);
  process.exit(1);
}

console.log(`\nPASS: all ${selected.length} file(s) are served from ${BASE}. Safe to untrack.`);
