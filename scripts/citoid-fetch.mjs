#!/usr/bin/env node
/**
 * Fetch citation metadata for a list of URLs from Wikipedia's public Citoid
 * REST API and emit reference entries in the maps.json schema:
 *   { "label": "...", "url": "...", "note": "" }
 *
 * Usage:
 *   node scripts/citoid-fetch.mjs URL [URL ...]
 *   node scripts/citoid-fetch.mjs --file urls.txt
 *   cat urls.txt | node scripts/citoid-fetch.mjs -
 *
 * Output:
 *   JSON array on stdout, ready to paste into a maps.json `references` field.
 *   Progress + errors go to stderr so the JSON output stays clean for piping.
 *
 * Notes:
 *   - Hits https://en.wikipedia.org/api/rest_v1/data/citation/zotero/<url>
 *   - 1 second delay between requests to be polite to the public Wikimedia API
 *   - On any failure (404, timeout, parse error) the entry falls back to
 *     { label: <url>, url: <url>, note: "" } so the URL is never lost
 *   - The `note` field is always emitted empty — fill it in by hand to
 *     record licensing or context, since Citoid doesn't expose that
 */
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
let urls = [];

if (args.includes('--file')) {
    const idx = args.indexOf('--file');
    const path = args[idx + 1];
    if (!path) {
        console.error('--file requires a path argument');
        process.exit(1);
    }
    urls = readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
} else if (args[0] === '-') {
    urls = readFileSync(0, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
} else {
    urls = args.filter(a => /^https?:\/\//i.test(a));
}

if (urls.length === 0) {
    console.error('No URLs provided.');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/citoid-fetch.mjs URL [URL ...]');
    console.error('  node scripts/citoid-fetch.mjs --file urls.txt');
    console.error('  cat urls.txt | node scripts/citoid-fetch.mjs -');
    process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildLabel(meta, fallback) {
    if (!meta) return fallback;
    const title = (meta.title || '').trim();
    const site = (meta.publisher || meta.websiteTitle || meta.publicationTitle || '').trim();
    if (title && site && title.toLowerCase() !== site.toLowerCase()) return `${title} (${site})`;
    if (title) return title;
    if (site) return site;
    return fallback;
}

async function fetchOne(url) {
    const apiUrl = `https://en.wikipedia.org/api/rest_v1/data/citation/zotero/${encodeURIComponent(url)}`;
    try {
        const res = await fetch(apiUrl, {
            headers: {
                'User-Agent': 'civgraph-citoid-fetch/1.0 (https://civgraph.net; scott@example.invalid)',
                'Accept': 'application/json',
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error(`  ! ${url} -> HTTP ${res.status} ${body.slice(0, 120)}`);
            return { label: url, url, note: '' };
        }
        const data = await res.json();
        const meta = Array.isArray(data) && data[0] ? data[0] : null;
        if (!meta) {
            console.error(`  ! ${url} -> empty response`);
            return { label: url, url, note: '' };
        }
        return {
            label: buildLabel(meta, url),
            url: meta.url || url,
            note: '',
        };
    } catch (err) {
        console.error(`  ! ${url} -> ${err.message}`);
        return { label: url, url, note: '' };
    }
}

const results = [];
for (const [i, url] of urls.entries()) {
    process.stderr.write(`[${i + 1}/${urls.length}] ${url}\n`);
    results.push(await fetchOne(url));
    if (i < urls.length - 1) await sleep(1000);
}

process.stdout.write(JSON.stringify(results, null, 2) + '\n');
