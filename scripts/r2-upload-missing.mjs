#!/usr/bin/env node
/**
 * Upload new/missing map assets to the boundaries-data R2 bucket.
 *
 * For each source file this script produces up to three R2 objects:
 *   - the raw file
 *   - a brotli-compressed variant at <key>.br  (FGB / JSON only)
 *   - a gzip-compressed variant at <key>.gz    (FGB / JSON only)
 * PNGs are uploaded uncompressed.
 *
 * The Cloudflare Pages function at functions/data/maps/[[path]].js serves
 * these via content-encoding negotiation, so all three variants should
 * be kept in sync.
 *
 * Usage:
 *   node scripts/r2-upload-missing.mjs [--dry-run] [--skip-check]
 *
 * Prerequisites:
 *   - `wrangler` installed and logged in (`npx wrangler whoami` should work)
 *   - CLOUDFLARE_ACCOUNT_ID env var set, OR wrangler's own config used
 *
 * Safety: checks R2 existence before each PUT unless --skip-check is passed.
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, resolve, relative, extname } from 'path';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'boundaries-data';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT_ID) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID env var (see `npx wrangler whoami` output)');
    process.exit(1);
}

const CONFIG_PATH = join(process.env.APPDATA || process.env.HOME, 'xdg.config', '.wrangler', 'config', 'default.toml');
const cfg = readFileSync(CONFIG_PATH, 'utf8');
const TOKEN = cfg.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!TOKEN) { console.error('No oauth_token in wrangler config — run `npx wrangler whoami` to refresh'); process.exit(1); }

const CONCURRENCY = 12;
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CHECK = process.argv.includes('--skip-check');

function walkSync(dir, files = []) {
    const entries = require('fs').readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkSync(p, files);
        else files.push(p);
    }
    return files;
}

async function collectFiles() {
    const targets = [];

    // Townland chunks (new split only)
    const chunksDir = join(ROOT, 'data/maps/townlands/chunks');
    const fs = await import('fs');
    for (const name of fs.readdirSync(chunksDir)) {
        if (/^(ni|roi|all-ireland)-townlands_.*\.fgb$/.test(name)) {
            const p = join(chunksDir, name);
            if (statSync(p).size === 0) continue;
            targets.push({ localPath: p, compress: true });
        }
    }

    // Townland metadata
    const tlDir = join(ROOT, 'data/maps/townlands');
    for (const name of fs.readdirSync(tlDir)) {
        if (/^(ni|roi|all-ireland)-townlands-(chunks|feature-index)\.json$/.test(name)) {
            targets.push({ localPath: join(tlDir, name), compress: true });
        }
    }

    // Raster PNGs (not compressed - PNG is already compressed)
    const rasterDir = join(ROOT, 'data/maps/raster');
    for (const name of fs.readdirSync(rasterDir)) {
        if (name.endsWith('.png')) {
            targets.push({ localPath: join(rasterDir, name), compress: false });
        }
    }

    // ROI FGBs + geojsons + Wards 1993 variants
    const roiPaths = [
        'data/maps/local-government/ROI_Gaeltacht_Areas.fgb',
        'data/maps/local-government/ROI_Garda_Districts.fgb',
        'data/maps/local-government/ROI_Garda_Divisions.fgb',
        'data/maps/local-government/ROI_Garda_Regions.fgb',
        'data/maps/local-government/ROI_Garda_Sub_Districts.fgb',
        'data/maps/local-government/ROI_LEA_2008.fgb',
        'data/maps/local-government/ROI_Local_Authorities_2008.fgb',
        'data/maps/local-government/ROI_Small_Areas_2011.fgb',
        'data/maps/local-government/Catholic_Parishes_Dublin.fgb',
        'data/maps/local-government/Wards_1993_50k.fgb',
        'data/maps/local-government/Wards_1993_Largescale.fgb',
        'data/maps/baronies-parishes/ROI_Counties_2011.fgb',
        'data/maps/electoral-divisions/ROI_EDs_Census_2011.fgb',
        'data/maps/census-areas/NUTS2_All_Ireland.fgb',
        'data/maps/census-areas/ROI_NUTS2.fgb',
        'data/maps/physical/ROI_Legal_Towns_and_Cities.fgb',
        'data/maps/physical/ROI_Settlements_2011.fgb',
    ];
    for (const rel of roiPaths) {
        const p = join(ROOT, rel);
        if (existsSync(p)) targets.push({ localPath: p, compress: true });
    }

    // Baronies: all-Ireland + ROI
    const baroniesPaths = [
        'data/maps/baronies-parishes/ROI_Baronies.fgb',
        'data/maps/baronies-parishes/Baronies_AllIreland.fgb',
    ];
    for (const rel of baroniesPaths) {
        const p = join(ROOT, rel);
        if (existsSync(p)) targets.push({ localPath: p, compress: true });
    }

    // NI local-government additions
    const niLocalGovPaths = [
        'data/maps/local-government/Admin_Areas_01-04-1930.fgb',
        'data/maps/local-government/Unchanged_Districts_1921-1969.fgb',
        'data/maps/local-government/NI_Admin_Areas_1921-1936.fgb',
        'data/maps/local-government/NI_Admin_Areas_1937-1963.fgb',
        'data/maps/local-government/NI_Admin_Areas_1964.fgb',
        'data/maps/local-government/NI_Admin_Areas_1965-1968.fgb',
        'data/maps/local-government/NI_Admin_Areas_1969.fgb',
    ];
    for (const rel of niLocalGovPaths) {
        const p = join(ROOT, rel);
        if (existsSync(p)) targets.push({ localPath: p, compress: true });
    }

    return targets;
}

async function r2Head(key) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'HEAD', headers: { 'Authorization': `Bearer ${TOKEN}` } });
    return res.status === 200;
}

async function r2Put(key, body, contentType, contentEncoding = null) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    const headers = {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': contentType,
    };
    // Note: Content-Encoding is set by the Pages function at serve time,
    // so we don't need to store it as R2 metadata.
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PUT ${key} -> ${res.status}: ${text.slice(0, 200)}`);
    }
}

function contentTypeFor(path) {
    if (path.endsWith('.fgb')) return 'application/octet-stream';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.geojson')) return 'application/geo+json';
    return 'application/octet-stream';
}

async function uploadOne(target, stats) {
    const { localPath, compress } = target;
    const relPath = relative(ROOT, localPath).replace(/\\/g, '/');
    const baseKey = relPath;
    const ct = contentTypeFor(localPath);
    const body = readFileSync(localPath);

    // Check original
    let needUpload = true;
    if (!SKIP_CHECK) {
        try { needUpload = !(await r2Head(baseKey)); } catch { needUpload = true; }
    }

    if (DRY_RUN) {
        console.log(`[dry] ${baseKey} (${body.length}B)${compress ? ' +.br +.gz' : ''}${needUpload ? '' : ' [exists]'}`);
        stats.planned++;
        return;
    }

    if (needUpload) {
        await r2Put(baseKey, body, ct);
        stats.uploaded++;
    } else {
        stats.skipped++;
    }

    if (compress) {
        // Brotli
        const brKey = `${baseKey}.br`;
        let needBr = true;
        if (!SKIP_CHECK) { try { needBr = !(await r2Head(brKey)); } catch {} }
        if (needBr) {
            const br = brotliCompressSync(body, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
            });
            await r2Put(brKey, br, ct);
            stats.uploaded++;
        } else {
            stats.skipped++;
        }

        // Gzip
        const gzKey = `${baseKey}.gz`;
        let needGz = true;
        if (!SKIP_CHECK) { try { needGz = !(await r2Head(gzKey)); } catch {} }
        if (needGz) {
            const gz = gzipSync(body, { level: 6 });
            await r2Put(gzKey, gz, ct);
            stats.uploaded++;
        } else {
            stats.skipped++;
        }
    }

    stats.done++;
    if (stats.done % 20 === 0) {
        const pct = ((stats.done / stats.total) * 100).toFixed(1);
        process.stdout.write(`\r  ${stats.done}/${stats.total} (${pct}%) up=${stats.uploaded} skip=${stats.skipped}  `);
    }
}

async function runPool(tasks, worker, n) {
    let i = 0;
    const stats = { total: tasks.length, done: 0, uploaded: 0, skipped: 0, planned: 0, errors: 0 };
    const workers = Array.from({ length: n }, async () => {
        while (i < tasks.length) {
            const idx = i++;
            try { await worker(tasks[idx], stats); }
            catch (e) {
                stats.errors++;
                console.error(`\n  ✗ ${tasks[idx].localPath}: ${e.message}`);
            }
        }
    });
    await Promise.all(workers);
    return stats;
}

(async () => {
    console.log('Collecting files...');
    const targets = await collectFiles();
    console.log(`Found ${targets.length} files to process.`);
    const byKind = {
        chunks: targets.filter(t => t.localPath.includes('townlands/chunks')).length,
        metadata: targets.filter(t => t.localPath.includes('townlands') && t.localPath.endsWith('.json')).length,
        png: targets.filter(t => !t.compress).length,
        fgb: targets.filter(t => t.compress && !t.localPath.includes('townlands')).length,
    };
    console.log('  breakdown:', byKind);
    const totalBytes = targets.reduce((s, t) => s + statSync(t.localPath).size, 0);
    console.log(`  total size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

    if (DRY_RUN) console.log('\n*** DRY RUN ***');

    const start = Date.now();
    const stats = await runPool(targets, uploadOne, CONCURRENCY);
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone in ${secs}s — uploaded=${stats.uploaded} skipped=${stats.skipped} errors=${stats.errors}`);
})();
