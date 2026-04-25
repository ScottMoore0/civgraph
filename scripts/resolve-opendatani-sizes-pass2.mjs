#!/usr/bin/env node
/**
 * Second-pass resolver for Open Data NI resources still unresolved after
 * pass 1. Handles two buckets:
 *
 *   1. Streamed GET for rows with resolve_error = "no-content-length..." —
 *      downloads the body and counts bytes. Capped at MAX_STREAM_BYTES per
 *      file to avoid accidentally pulling a multi-GB object.
 *   2. Plain retry (HEAD → Range-GET) for rows with HTTP or network errors
 *      (429/5xx, fetch-failed, timeout) — many of those are transient.
 *
 * Updates opendatani-resources.json in place; sets resolved_from =
 * 'stream-get' or 'retry-head' / 'retry-range-get' when successful.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const FILE = resolve('data/external/opendatani-resources.json');
const STREAM_CONCURRENCY = 4;
const RETRY_CONCURRENCY = 8;
const TIMEOUT_MS = 30000;
const MAX_STREAM_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB safety cap
const UA = 'civgraph-catalogue-enumerator/1.0 (+https://civgraph.net)';

function parseSize(v) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function streamMeasure(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA }
        });
        if (!res.ok) return { size: null, error: `http ${res.status}` };
        // If server now volunteers a content-length on plain GET, trust it.
        const cl = parseSize(res.headers.get('content-length'));
        if (cl != null) {
            try { await res.arrayBuffer(); } catch {}
            return { size: cl, error: null };
        }
        // Otherwise drain and count bytes.
        let total = 0;
        const reader = res.body?.getReader();
        if (!reader) return { size: null, error: 'no-body-stream' };
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_STREAM_BYTES) {
                try { await reader.cancel(); } catch {}
                return { size: null, error: `exceeds-cap-${MAX_STREAM_BYTES}` };
            }
        }
        return { size: total, error: null };
    } catch (e) {
        return { size: null, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e)) };
    } finally {
        clearTimeout(t);
    }
}

async function headOrRange(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        try {
            const res = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                signal: ctrl.signal,
                headers: { 'User-Agent': UA }
            });
            if (res.ok || res.status === 206) {
                const cl = parseSize(res.headers.get('content-length'));
                if (cl != null) return { size: cl, from: 'retry-head', error: null };
            }
        } catch {}
        const res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: ctrl.signal,
            headers: { 'User-Agent': UA, Range: 'bytes=0-0' }
        });
        try { await res.arrayBuffer(); } catch {}
        if (res.status === 206) {
            const cr = res.headers.get('content-range');
            const m = cr?.match(/\/(\d+)\s*$/);
            if (m) return { size: Number(m[1]), from: 'retry-range-get', error: null };
        }
        if (res.ok) {
            const cl = parseSize(res.headers.get('content-length'));
            if (cl != null) return { size: cl, from: 'retry-range-get', error: null };
            return { size: null, from: null, error: `no-content-length (status ${res.status})` };
        }
        return { size: null, from: null, error: `http ${res.status}` };
    } catch (e) {
        return { size: null, from: null, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e)) };
    } finally {
        clearTimeout(t);
    }
}

async function runPool(items, fn, concurrency, onProgress) {
    let cursor = 0, done = 0;
    const total = items.length;
    const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= total) return;
            await fn(items[i]);
            done++;
            onProgress?.(done, total);
        }
    });
    await Promise.all(workers);
}

async function main() {
    const rows = JSON.parse(readFileSync(FILE, 'utf8'));
    console.log(`Loaded ${rows.length} rows`);

    const streamCandidates = rows.filter(r =>
        r.resolved_size == null && r.url && /^https?:\/\//i.test(r.url) &&
        /^no-content-length/.test(r.resolve_error || '')
    );
    const retryCandidates = rows.filter(r =>
        r.resolved_size == null && r.url && /^https?:\/\//i.test(r.url) &&
        /^(http \d|fetch failed|timeout|network|ECONNREFUSED|ENOTFOUND)/.test(r.resolve_error || '')
    );
    console.log(`Stream-GET candidates (no-content-length): ${streamCandidates.length}`);
    console.log(`Retry candidates (transient errors): ${retryCandidates.length}`);

    // Pass A: stream-measure
    if (streamCandidates.length) {
        console.log('\n--- Pass A: stream-measure ---');
        const start = Date.now();
        let lastReport = start;
        await runPool(streamCandidates, async (row) => {
            const r = await streamMeasure(row.url);
            if (r.size != null) {
                row.resolved_size = r.size;
                row.resolved_from = 'stream-get';
                row.resolve_error = null;
            } else {
                row.resolve_error = r.error || row.resolve_error;
            }
        }, STREAM_CONCURRENCY, (done, total) => {
            const now = Date.now();
            if (now - lastReport > 5000 || done === total) {
                lastReport = now;
                const rate = done / ((now - start) / 1000);
                console.log(`  ${done}/${total}  (${rate.toFixed(2)}/s)`);
            }
        });
    }

    // Pass B: retry
    if (retryCandidates.length) {
        console.log('\n--- Pass B: retry HEAD/Range-GET ---');
        await new Promise(r => setTimeout(r, 5000)); // cool-down
        const start = Date.now();
        let lastReport = start;
        await runPool(retryCandidates, async (row) => {
            const r = await headOrRange(row.url);
            if (r.size != null) {
                row.resolved_size = r.size;
                row.resolved_from = r.from;
                row.resolve_error = null;
            } else {
                row.resolve_error = r.error || row.resolve_error;
            }
        }, RETRY_CONCURRENCY, (done, total) => {
            const now = Date.now();
            if (now - lastReport > 5000 || done === total) {
                lastReport = now;
                const rate = done / ((now - start) / 1000);
                console.log(`  ${done}/${total}  (${rate.toFixed(2)}/s)`);
            }
        });
    }

    writeFileSync(FILE, JSON.stringify(rows, null, 2));
    console.log(`\nWrote: ${FILE}`);

    // Summary
    const counts = {};
    let totalBytes = 0, stillNull = 0;
    const errByCat = {};
    for (const r of rows) {
        counts[r.resolved_from || '—'] = (counts[r.resolved_from || '—'] || 0) + 1;
        if (r.resolved_size != null) totalBytes += r.resolved_size;
        else {
            stillNull++;
            if (r.resolve_error) {
                const k = r.resolve_error.replace(/\d+/g, '#').slice(0, 50);
                errByCat[k] = (errByCat[k] || 0) + 1;
            }
        }
    }
    console.log('\nBy source:');
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(v).padStart(5)}  ${k}`);
    }
    console.log(`\nTotal known bytes: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`Still unresolved: ${stillNull}`);
    if (stillNull) {
        console.log('\nRemaining error categories:');
        for (const [k, v] of Object.entries(errByCat).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
            console.log(`  ${String(v).padStart(4)}  ${k}`);
        }
    }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
