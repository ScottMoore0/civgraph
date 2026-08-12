#!/usr/bin/env node
/**
 * Upload an XYZ tile pyramid directory tree to R2 via the S3-compatible
 * endpoint. Much faster than the Cloudflare REST API path because it
 * doesn't share the account-level rate limit.
 *
 * Usage:
 *   R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...  R2_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
 *   node scripts/upload-tile-pyramid-s3.mjs <local-dir> <r2-key-prefix> [--concurrency=N] [--dry-run] [--check]
 *
 *   --check       HEAD each key first and skip if already uploaded (default: skip checks)
 */
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, sep, resolve as resolvePath } from 'path';
import { execFileSync } from 'child_process';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { assertPublishable } from './lib/r2-publication-gate.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && !a.includes('=')));
const opts = Object.fromEntries(args.filter(a => a.startsWith('--') && a.includes('=')).map(a => a.slice(2).split('=')));
const positional = args.filter(a => !a.startsWith('--'));

if (positional.length < 2) {
    console.error('Usage: node scripts/upload-tile-pyramid-s3.mjs <local-dir> <r2-key-prefix> [--concurrency=N] [--dry-run] [--check]');
    process.exit(1);
}

const [LOCAL_DIR, KEY_PREFIX] = positional;
const DRY_RUN = flags.has('--dry-run');
const GATE_OVERRIDE = flags.has('--i-have-reviewed-this-publication');
const CHECK_FIRST = flags.has('--check');
const CONCURRENCY = parseInt(opts.concurrency || '32', 10);

const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const ENDPOINT = process.env.R2_S3_ENDPOINT;
const BUCKET = process.env.R2_BUCKET || 'boundaries-data';

if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !ENDPOINT) {
    console.error('Missing one of R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_S3_ENDPOINT in env.');
    process.exit(1);
}

const s3 = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    forcePathStyle: false,
    maxAttempts: 5,
});

function walk(dir, files = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, files);
        else files.push(p);
    }
    return files;
}

function ctOf(name) {
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
}

async function uploadOne(localPath, stats) {
    const rel = relative(LOCAL_DIR, localPath).split(sep).join('/');
    const key = `${KEY_PREFIX}/${rel}`;
    const ct = ctOf(localPath);

    if (DRY_RUN) {
        stats.planned++;
        if (stats.planned <= 3) console.log(`[dry] ${key}`);
        return;
    }

    if (CHECK_FIRST) {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
            stats.skipped++;
            stats.done++;
            return;
        } catch (e) {
            if (e.name !== 'NotFound' && e.$metadata?.httpStatusCode !== 404) {
                // proceed to upload anyway
            }
        }
    }

    const body = readFileSync(localPath);
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: ct,
    }));
    stats.uploaded++;
    stats.done++;
    if (stats.done % 500 === 0) {
        const pct = ((stats.done / stats.total) * 100).toFixed(1);
        const rate = (stats.done / ((Date.now() - stats.start) / 1000)).toFixed(1);
        process.stdout.write(`\r  ${stats.done}/${stats.total} (${pct}%) up=${stats.uploaded} skip=${stats.skipped} ${rate}/s   `);
    }
}

async function runPool(items, worker, n) {
    let i = 0;
    const stats = { total: items.length, done: 0, uploaded: 0, skipped: 0, planned: 0, errors: 0, start: Date.now() };
    const workers = Array.from({ length: n }, async () => {
        while (i < items.length) {
            const idx = i++;
            try { await worker(items[idx], stats); }
            catch (e) {
                stats.errors++;
                if (stats.errors <= 5) console.error(`\n  ✗ ${items[idx]}: ${e.message || e}`);
            }
        }
    });
    await Promise.all(workers);
    return stats;
}

(async () => {
    console.log(`Walking ${LOCAL_DIR}...`);
    let files = walk(LOCAL_DIR);

    // --tracked-only: publish only what git tracks.
    //
    // The allowlist gate below governs PREFIXES. It cannot see that a directory
    // holds local working files alongside the approved ones, because it never
    // looks at individual paths -- so an approved prefix silently authorises
    // anything sitting under it on disk.
    //
    // That gap nearly published two sets on 2026-08-12. data/timeline-transitions
    // is 6 tracked files and 139 on disk: the other 133 are gitignored QA
    // sidecars, 5.4 GB of them. data/census carries data/census/statistical-
    // staging/, also gitignored. Approval had been given for the tracked
    // contents; nobody had looked at the rest, and there is no unpublish.
    //
    // Being gitignored is the closest thing to an explicit "this is local only"
    // marker the repository has, so it is the right filter.
    if (args.includes('--tracked-only')) {
        const tracked = new Set(
            execFileSync('git', ['ls-files', LOCAL_DIR], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
                .split(/\r?\n/).filter(Boolean).map((f) => resolvePath(f.replace(/\\/g, '/')))
        );
        const before = files.length;
        files = files.filter((f) => tracked.has(resolvePath(f.replace(/\\/g, '/'))));
        const skipped = before - files.length;
        if (skipped) console.log(`  --tracked-only: skipping ${skipped} untracked file(s) that git does not track`);
        if (!files.length) {
            console.error('FAIL: --tracked-only left nothing to upload. Is this directory entirely untracked?');
            process.exit(1);
        }
    }

    const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0);
    console.log(`  ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  → s3://${BUCKET}/${KEY_PREFIX}/  (concurrency=${CONCURRENCY}${DRY_RUN ? ' [DRY]' : ''}${CHECK_FIRST ? ' [check]' : ''})`);
    if (!files.length) return;

    // Fail closed before the first PUT. Objects under this bucket are served
    // publicly at data.civgraph.net, so an upload is a publication event and
    // there is no unpublish. Runs even under --dry-run so the gate can be
    // rehearsed safely. Override: --i-have-reviewed-this-publication
    assertPublishable([`${KEY_PREFIX}/`], { override: GATE_OVERRIDE });

    const stats = await runPool(files, uploadOne, CONCURRENCY);
    const secs = ((Date.now() - stats.start) / 1000).toFixed(1);
    console.log(`\nDone in ${secs}s — uploaded=${stats.uploaded} skipped=${stats.skipped} errors=${stats.errors}`);
})();
