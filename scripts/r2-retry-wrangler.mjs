#!/usr/bin/env node
/**
 * Retry failed R2 uploads using the wrangler CLI directly.
 * Slower than raw fetch() but handles OAuth token refresh transparently.
 *
 * Input:  _r2-still-missing.json (produced by r2-check-missing.mjs)
 * Output: uploads raw file + generated .br / .gz variants as needed
 *
 * Usage: node scripts/r2-retry-wrangler.mjs
 *
 * Prerequisites:
 *   - wrangler installed and logged in (`npx wrangler whoami`)
 *   - Note: on Windows this invokes `npx wrangler` via `cmd /c`;
 *     on macOS/Linux the same `npx wrangler` call works natively.
 */
import { readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { resolve, join, relative, basename, dirname } from 'path';
import { tmpdir, platform } from 'os';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUCKET = 'boundaries-data';
const IS_WINDOWS = platform() === 'win32';

const missing = JSON.parse(readFileSync(join(ROOT, '_r2-still-missing.json'), 'utf8'));

function runWrangler(args) {
    // Use `npx wrangler` so auth/token refresh works transparently and the
    // wrangler version tracks whatever `npm`/`npx` has available. On Windows
    // npx resolves to npx.cmd, which requires shell:true for correct spawning.
    const fullArgs = ['wrangler', ...args];
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('npx', fullArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: IS_WINDOWS,
        });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => stdout += d);
        child.stderr.on('data', d => stderr += d);
        child.on('close', code => {
            if (code === 0) resolvePromise(stdout);
            else rejectPromise(new Error(`exit ${code}: ${stderr || stdout}`));
        });
        child.on('error', rejectPromise);
    });
}

async function uploadViaFile(r2Key, localFile) {
    return runWrangler([
        'r2', 'object', 'put',
        `${BUCKET}/${r2Key}`,
        '--file', localFile,
        '--remote',
    ]);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function uploadOneKey(r2Key, sourcePath) {
    const ext = r2Key.match(/\.(br|gz)$/)?.[1];
    let tmpFile = null;
    let uploadPath;

    try {
        if (ext) {
            const body = readFileSync(sourcePath);
            const compressed = ext === 'br'
                ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
                : gzipSync(body, { level: 6 });
            tmpFile = join(tmpdir(), `r2-${Date.now()}-${Math.random().toString(36).slice(2)}-${basename(r2Key)}`);
            writeFileSync(tmpFile, compressed);
            uploadPath = tmpFile;
            console.log(`  [${r2Key}] ${ext} (${(body.length/1024/1024).toFixed(1)}MB -> ${(compressed.length/1024/1024).toFixed(1)}MB)`);
        } else {
            uploadPath = sourcePath;
            console.log(`  [${r2Key}] raw (${(statSync(sourcePath).size/1024/1024).toFixed(1)}MB)`);
        }

        // Retry each wrangler call up to 4 times with backoff
        let lastErr;
        for (let attempt = 1; attempt <= 4; attempt++) {
            try {
                await uploadViaFile(r2Key, uploadPath);
                console.log(`  ✓ ${r2Key}`);
                return true;
            } catch (err) {
                lastErr = err;
                const delay = 1000 * attempt;
                console.warn(`  retry ${attempt}/4 for ${r2Key} in ${delay}ms`);
                await sleep(delay);
            }
        }
        throw lastErr;
    } finally {
        if (tmpFile) { try { unlinkSync(tmpFile); } catch {} }
    }
}

async function uploadFile(entry) {
    // Source path = the original file, regardless of which variant keys are missing
    const sourcePath = entry.file;
    const results = [];
    for (const r2Key of entry.missingKeys) {
        try {
            await uploadOneKey(r2Key, sourcePath);
            results.push({ key: r2Key, ok: true });
        } catch (err) {
            console.error(`  ✗ ${r2Key}: ${String(err.message).slice(0, 200)}`);
            results.push({ key: r2Key, ok: false, error: String(err.message).slice(0, 200) });
        }
        await sleep(500); // deliberate pacing between calls
    }
    return results;
}

const summary = { fullyOk: 0, partial: 0, fullyFailed: 0, keyOk: 0, keyFail: 0 };
for (const [i, entry] of missing.entries()) {
    const relFile = relative(ROOT, entry.file).replace(/\\/g, '/');
    console.log(`\n[${i + 1}/${missing.length}] ${relFile}`);
    const results = await uploadFile(entry);
    const oks = results.filter(r => r.ok).length;
    const fails = results.length - oks;
    summary.keyOk += oks;
    summary.keyFail += fails;
    if (fails === 0) summary.fullyOk++;
    else if (oks === 0) summary.fullyFailed++;
    else summary.partial++;
}

console.log(`\n=== Final ===`);
console.log(`entries: fullyOk=${summary.fullyOk} partial=${summary.partial} fullyFailed=${summary.fullyFailed}`);
console.log(`keys:    ok=${summary.keyOk} fail=${summary.keyFail}`);
