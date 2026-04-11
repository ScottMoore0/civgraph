#!/usr/bin/env node
/**
 * Check which files from _r2-failed.txt are still missing on R2.
 * Re-reads the OAuth token before each request so wrangler-initiated
 * refreshes are picked up automatically.
 *
 * Input:   _r2-failed.txt (one absolute local path per line)
 * Output:  _r2-still-missing.json (used by r2-retry-wrangler.mjs)
 *
 * Usage:   node scripts/r2-check-missing.mjs
 *
 * Prerequisites:
 *   - wrangler installed and logged in (`npx wrangler whoami`)
 *   - CLOUDFLARE_ACCOUNT_ID env var set
 */
import { readFileSync } from 'fs';
import { resolve, relative, join } from 'path';
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
    const cfg = readFileSync(CONFIG_PATH, 'utf8');
    return cfg.match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
}

async function r2Exists(key) {
    // Cloudflare R2 REST API sometimes returns 405 for HEAD on objects that exist.
    // Use GET with Range: bytes=0-0 to fetch just 1 byte as an existence check.
    const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Range': 'bytes=0-0',
        },
    });
    // Discard the body so it doesn't stay open
    if (res.body) { try { await res.arrayBuffer(); } catch {} }
    return res.status === 200 || res.status === 206;
}

const failed = readFileSync(join(ROOT, '_r2-failed.txt'), 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const missing = [];
const present = [];

for (const f of failed) {
    const relPath = relative(ROOT, f).replace(/\\/g, '/');
    // Check all 3 variants for FGB/JSON, or just 1 for PNG
    const isPng = f.endsWith('.png');
    const keys = isPng ? [relPath] : [relPath, relPath + '.br', relPath + '.gz'];
    const statuses = await Promise.all(keys.map(k => r2Exists(k)));
    const missingKeys = keys.filter((_, i) => !statuses[i]);
    if (missingKeys.length) {
        missing.push({ file: f, missingKeys });
        console.log(`  MISSING ${missingKeys.length}/${keys.length}: ${relPath}`);
    } else {
        present.push(f);
        console.log(`  ok: ${relPath}`);
    }
}

console.log(`\nResult: ${present.length}/${failed.length} fully uploaded, ${missing.length} still have missing keys`);
if (missing.length) {
    const { writeFileSync } = await import('fs');
    writeFileSync(join(ROOT, '_r2-still-missing.json'), JSON.stringify(missing, null, 2));
    console.log('Wrote _r2-still-missing.json');
}
