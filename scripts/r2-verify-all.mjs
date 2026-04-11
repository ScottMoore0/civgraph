#!/usr/bin/env node
/**
 * Comprehensive R2 inventory check for the boundaries-data bucket.
 *
 * Walks maps.json and the three townland chunks.json files and verifies
 * every referenced asset exists on R2:
 *   - townland chunks (via ni-/roi-/all-ireland-townlands-chunks.json)
 *   - townland metadata (chunks + feature-index JSONs)
 *   - raster overlay PNGs (from maps.json `files.image` fields)
 *   - ROI FGBs and their .br / .gz compression variants
 *
 * Reads the OAuth token fresh on each request so wrangler refreshes are
 * picked up automatically. Handles 429 with retry-after, and backs off on
 * transient errors.
 *
 * Usage: node scripts/r2-verify-all.mjs
 *
 * Prerequisites:
 *   - wrangler installed and logged in (`npx wrangler whoami`)
 *   - CLOUDFLARE_ACCOUNT_ID env var set
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'boundaries-data';
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!ACCOUNT_ID) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID env var');
    process.exit(1);
}
const CONFIG_PATH = join(process.env.APPDATA || process.env.HOME, 'xdg.config', '.wrangler', 'config', 'default.toml');
function getToken() {
    return readFileSync(CONFIG_PATH, 'utf8').match(/oauth_token\s*=\s*"([^"]+)"/)[1];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function r2Exists(key, maxAttempts = 6) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'Range': 'bytes=0-0' },
        });
        if (res.body) { try { await res.arrayBuffer(); } catch {} }
        if (res.status === 200 || res.status === 206) return true;
        if (res.status === 404) return false;
        if (res.status === 401) {
            // Token expired — subsequent getToken() calls pick up refreshed token from config
            // Wait briefly for external refresh; fail if still bad after max attempts
            if (attempt < maxAttempts) { await sleep(2000); continue; }
            return false;
        }
        if (res.status === 429) {
            const retryAfter = parseInt(res.headers.get('retry-after') || '30', 10);
            const wait = Math.min(Math.max(retryAfter, 5) * 1000, 60000);
            if (attempt < maxAttempts) { await sleep(wait); continue; }
        }
        await sleep(1000 * attempt);
    }
    return false;
}

// Parallel pool
async function checkBatch(keys, concurrency = 4) {
    const results = new Array(keys.length);
    let i = 0;
    async function worker() {
        while (i < keys.length) {
            const idx = i++;
            try { results[idx] = await r2Exists(keys[idx]); }
            catch { results[idx] = false; }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

async function verifyMap(mapId) {
    const chunksFile = join(ROOT, 'data/maps/townlands', `${mapId}-chunks.json`);
    const c = JSON.parse(readFileSync(chunksFile, 'utf8'));
    const keys = new Set();
    for (const ch of c.chunks) {
        keys.add(ch.file);
        for (const zv of Object.values(ch.zoomFiles || {})) keys.add(zv.file);
    }
    const keyArr = [...keys];
    console.log(`\n${mapId}: checking ${keyArr.length} chunk files on R2...`);
    const results = await checkBatch(keyArr);
    const missing = keyArr.filter((_, i) => !results[i]);
    if (missing.length) {
        console.log(`  ✗ ${missing.length} MISSING:`);
        for (const m of missing.slice(0, 20)) console.log('    ', m);
    } else {
        console.log(`  ✓ All ${keyArr.length} present on R2`);
    }
    return missing;
}

// Also verify metadata + chunks.json files themselves
async function verifyMetadata() {
    console.log('\nmetadata JSONs:');
    const metaKeys = [
        'data/maps/townlands/ni-townlands-chunks.json',
        'data/maps/townlands/ni-townlands-feature-index.json',
        'data/maps/townlands/roi-townlands-chunks.json',
        'data/maps/townlands/roi-townlands-feature-index.json',
        'data/maps/townlands/all-ireland-townlands-chunks.json',
        'data/maps/townlands/all-ireland-townlands-feature-index.json',
    ];
    const results = await checkBatch(metaKeys);
    const missing = metaKeys.filter((_, i) => !results[i]);
    if (missing.length) console.log(`  ✗ ${missing.length} missing:`, missing);
    else console.log(`  ✓ All ${metaKeys.length} present`);
    return missing;
}

async function verifyRasters() {
    // Collect from maps.json
    const maps = JSON.parse(readFileSync(join(ROOT, 'data/database/maps.json'), 'utf8'));
    const rasterKeys = new Set();
    const walk = (obj) => {
        if (!obj) return;
        if (Array.isArray(obj)) { for (const x of obj) walk(x); return; }
        if (typeof obj === 'object') {
            for (const [k, v] of Object.entries(obj)) {
                if (k === 'image' && typeof v === 'string' && v.endsWith('.png')) rasterKeys.add(v);
                else walk(v);
            }
        }
    };
    walk(maps);
    const keyArr = [...rasterKeys];
    console.log(`\nraster PNGs: checking ${keyArr.length}...`);
    const results = await checkBatch(keyArr);
    const missing = keyArr.filter((_, i) => !results[i]);
    if (missing.length) console.log(`  ✗ ${missing.length} missing:`, missing.slice(0, 20));
    else console.log(`  ✓ All ${keyArr.length} present`);
    return missing;
}

async function verifyROIs() {
    const roiKeys = [
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
    // Check each + its .br + .gz
    const all = [];
    for (const k of roiKeys) {
        all.push(k, k + '.br', k + '.gz');
    }
    console.log(`\nROI FGBs: checking ${all.length} (${roiKeys.length} files × 3 variants)...`);
    const results = await checkBatch(all);
    const missing = all.filter((_, i) => !results[i]);
    if (missing.length) {
        console.log(`  ✗ ${missing.length} missing:`);
        for (const m of missing) console.log('    ', m);
    } else console.log(`  ✓ All ${all.length} present`);
    return missing;
}

(async () => {
    const all = [];
    all.push(...await verifyMap('ni-townlands'));
    all.push(...await verifyMap('roi-townlands'));
    all.push(...await verifyMap('all-ireland-townlands'));
    all.push(...await verifyMetadata());
    all.push(...await verifyRasters());
    all.push(...await verifyROIs());

    console.log(`\n=== TOTAL MISSING: ${all.length} ===`);
    if (all.length === 0) console.log('✓ Everything uploaded to R2.');
})();
