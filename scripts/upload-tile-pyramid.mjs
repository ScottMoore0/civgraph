#!/usr/bin/env node
/**
 * Upload an XYZ tile pyramid directory tree to the boundaries-data R2 bucket.
 *
 * Usage:
 *   node scripts/upload-tile-pyramid.mjs <local-dir> <r2-key-prefix> [--dry-run] [--skip-check] [--concurrency=N]
 *
 * Example:
 *   node scripts/upload-tile-pyramid.mjs \
 *     _tmp_osni_phase3/tiles/eire-thuaidh \
 *     data/maps/osni-raster/eire-thuaidh
 *
 * Authenticates via wrangler's stored OAuth token (same as r2-upload-missing.mjs).
 */
import { readFileSync, statSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--') && !a.includes('=')));
const opts = Object.fromEntries(args.filter(a => a.startsWith('--') && a.includes('=')).map(a => a.slice(2).split('=')));
const positional = args.filter(a => !a.startsWith('--'));

if (positional.length < 2) {
    console.error('Usage: node scripts/upload-tile-pyramid.mjs <local-dir> <r2-key-prefix> [--dry-run] [--skip-check] [--concurrency=N]');
    process.exit(1);
}

const [LOCAL_DIR, KEY_PREFIX] = positional;
const DRY_RUN = flags.has('--dry-run');
const SKIP_CHECK = flags.has('--skip-check');
const CONCURRENCY = parseInt(opts.concurrency || '24', 10);

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'e51cbcff3bf6c7509f93f4e4ed67a394';
const BUCKET = 'boundaries-data';

const CONFIG_PATH = join(process.env.APPDATA || process.env.HOME, 'xdg.config', '.wrangler', 'config', 'default.toml');
const cfg = readFileSync(CONFIG_PATH, 'utf8');
const TOKEN = cfg.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!TOKEN) { console.error('No oauth_token in wrangler config — run `npx wrangler whoami`'); process.exit(1); }

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
    return 'application/octet-stream';
}

async function r2Head(key) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'HEAD', headers: { 'Authorization': `Bearer ${TOKEN}` } });
    return res.status === 200;
}

async function r2Put(key, body, contentType) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    let lastErr;
    for (let attempt = 0; attempt < 6; attempt++) {
        let res;
        try {
            res = await fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': contentType },
                body
            });
        } catch (e) {
            lastErr = e;
            await sleep(500 * (1 << attempt));
            continue;
        }
        if (res.ok) return;
        if (res.status === 429 || res.status >= 500) {
            const retryAfter = parseFloat(res.headers.get('retry-after') || '0');
            const wait = Math.max(retryAfter * 1000, 500 * (1 << attempt));
            await sleep(wait);
            lastErr = new Error(`${res.status}`);
            continue;
        }
        const text = await res.text();
        throw new Error(`PUT ${key} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    throw lastErr || new Error('upload failed after retries');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function uploadOne(localPath, stats) {
    const rel = relative(LOCAL_DIR, localPath).split(sep).join('/');
    const key = `${KEY_PREFIX}/${rel}`;
    const ct = ctOf(localPath);

    if (DRY_RUN) {
        stats.planned++;
        if (stats.planned <= 3) console.log(`[dry] ${key}`);
        return;
    }

    let need = true;
    if (!SKIP_CHECK) { try { need = !(await r2Head(key)); } catch { need = true; } }
    if (need) {
        const body = readFileSync(localPath);
        await r2Put(key, body, ct);
        stats.uploaded++;
    } else {
        stats.skipped++;
    }
    stats.done++;
    if (stats.done % 200 === 0) {
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
                if (stats.errors <= 5) console.error(`\n  ✗ ${items[idx]}: ${e.message}`);
            }
        }
    });
    await Promise.all(workers);
    return stats;
}

(async () => {
    console.log(`Walking ${LOCAL_DIR}...`);
    const files = walk(LOCAL_DIR);
    const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0);
    console.log(`  ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  → r2://${BUCKET}/${KEY_PREFIX}/`);
    console.log(`  concurrency=${CONCURRENCY}${DRY_RUN ? ' [DRY RUN]' : ''}${SKIP_CHECK ? ' [skip-check]' : ''}`);
    if (!files.length) return;

    const stats = await runPool(files, uploadOne, CONCURRENCY);
    const secs = ((Date.now() - stats.start) / 1000).toFixed(1);
    console.log(`\nDone in ${secs}s — uploaded=${stats.uploaded} skipped=${stats.skipped} errors=${stats.errors}`);
})();
