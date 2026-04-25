#!/usr/bin/env node
/**
 * Resolve file sizes for Open Data NI resources whose CKAN metadata has no
 * size (typically external links). Sends a HEAD request per URL; falls back
 * to GET with Range: bytes=0-0 when the host doesn't expose Content-Length
 * on HEAD. Updates data/external/opendatani-resources.json in place with
 * new fields:
 *   - resolved_size (bytes or null)
 *   - resolved_from ('ckan' | 'head' | 'range-get' | null)
 *   - resolve_error (string | null)
 *
 * Concurrency: 10 in-flight. Per-request timeout: 10 s.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const INPUT = resolve('data/external/opendatani-resources.json');
const OUTPUT = INPUT; // write in place
const PROGRESS = resolve('data/external/opendatani-sizes-progress.json');
const CONCURRENCY = 10;
const TIMEOUT_MS = 10000;

const UA = 'civgraph-catalogue-enumerator/1.0 (+https://civgraph.net)';

function parseSize(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function headWithTimeout(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA }
        });
        return res;
    } finally {
        clearTimeout(t);
    }
}

async function rangeGetWithTimeout(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA, Range: 'bytes=0-0' }
        });
        // Drain body so sockets can close cleanly.
        try { await res.arrayBuffer(); } catch {}
        return res;
    } finally {
        clearTimeout(t);
    }
}

async function resolveOne(row) {
    const url = row.url;
    if (!url || !/^https?:\/\//i.test(url)) {
        return { size: null, from: null, error: 'not-http' };
    }

    // HEAD first
    try {
        const r = await headWithTimeout(url);
        if (r.ok || r.status === 206) {
            const cl = parseSize(r.headers.get('content-length'));
            if (cl != null) return { size: cl, from: 'head', error: null };
        }
        // If HEAD returned no size but status ok, fall through to Range GET
        if (!r.ok && r.status !== 405 && r.status !== 501) {
            // For 4xx/5xx that aren't "HEAD not supported", record error early
            // but still try Range GET as a fallback (some CDNs reject HEAD).
        }
    } catch (e) {
        // swallow, try range-GET
    }

    // Fallback: partial GET
    try {
        const r = await rangeGetWithTimeout(url);
        if (r.status === 206) {
            const cr = r.headers.get('content-range');
            if (cr) {
                const m = cr.match(/\/(\d+)\s*$/);
                if (m) return { size: Number(m[1]), from: 'range-get', error: null };
            }
        }
        if (r.ok) {
            const cl = parseSize(r.headers.get('content-length'));
            if (cl != null) return { size: cl, from: 'range-get', error: null };
            return { size: null, from: null, error: `no-content-length (status ${r.status})` };
        }
        return { size: null, from: null, error: `http ${r.status}` };
    } catch (e) {
        const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
        return { size: null, from: null, error: msg };
    }
}

async function runPool(items, fn, concurrency, onProgress) {
    let cursor = 0;
    let done = 0;
    const total = items.length;
    const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= total) return;
            await fn(items[i], i);
            done++;
            if (onProgress) onProgress(done, total);
        }
    });
    await Promise.all(workers);
}

async function main() {
    if (!existsSync(INPUT)) {
        console.error(`Input not found: ${INPUT}`);
        process.exit(1);
    }
    const rows = JSON.parse(readFileSync(INPUT, 'utf8'));
    console.log(`Loaded ${rows.length} resources from ${INPUT}`);

    // Pre-populate resolved_size from CKAN's own size where present.
    for (const r of rows) {
        const ckanSize = parseSize(r.size);
        if (r.resolved_size == null && ckanSize != null) {
            r.resolved_size = ckanSize;
            r.resolved_from = 'ckan';
            r.resolve_error = null;
        } else if (r.resolved_size == null) {
            r.resolved_size = null;
            r.resolved_from = null;
            r.resolve_error = null;
        }
    }

    const needed = rows.filter(r => r.resolved_from == null && r.url && /^https?:\/\//i.test(r.url));
    console.log(`Needs network resolution: ${needed.length}`);

    const startedAt = Date.now();
    let lastReport = Date.now();
    await runPool(needed, async (row) => {
        const result = await resolveOne(row);
        row.resolved_size = result.size;
        row.resolved_from = result.from;
        row.resolve_error = result.error;
    }, CONCURRENCY, (done, total) => {
        const now = Date.now();
        if (now - lastReport > 5000 || done === total) {
            lastReport = now;
            const rate = done / ((now - startedAt) / 1000);
            const eta = (total - done) / rate;
            console.log(`  ${done}/${total}  (${rate.toFixed(1)}/s, ETA ${Math.max(0, Math.round(eta))}s)`);
            // Incremental save so a crash doesn't lose progress
            writeFileSync(PROGRESS, JSON.stringify({ done, total, at: new Date().toISOString() }));
        }
    });

    writeFileSync(OUTPUT, JSON.stringify(rows, null, 2));
    console.log(`\nWrote: ${OUTPUT}`);

    // Summary
    let ckan = 0, head = 0, rangeGet = 0, stillNull = 0, errorCount = 0;
    const errByCategory = {};
    let totalBytes = 0;
    for (const r of rows) {
        if (r.resolved_from === 'ckan') ckan++;
        else if (r.resolved_from === 'head') head++;
        else if (r.resolved_from === 'range-get') rangeGet++;
        if (r.resolved_size == null) {
            stillNull++;
            if (r.resolve_error) {
                errorCount++;
                const k = r.resolve_error.replace(/\d+/g, '#').slice(0, 40);
                errByCategory[k] = (errByCategory[k] || 0) + 1;
            }
        } else {
            totalBytes += r.resolved_size;
        }
    }
    console.log(`\nBy source: ckan=${ckan}  head=${head}  range-get=${rangeGet}  unresolved=${stillNull}`);
    console.log(`Total known bytes: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
    if (errorCount > 0) {
        console.log(`\nTop unresolved error categories:`);
        const top = Object.entries(errByCategory).sort((a, b) => b[1] - a[1]).slice(0, 10);
        for (const [k, c] of top) console.log(`  ${c.toString().padStart(4)}  ${k}`);
    }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
